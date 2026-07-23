import {selfId} from './identity'
import {Nostr, peerTopic, roomTopic} from './nostr'
import {Peer, type Signal, type VideoSendParams} from './peer'
import {
  DEFAULT_SETTINGS,
  QUALITY_PARAMS,
  SETTING_VALIDATORS,
  type RoomSettings,
  type VideoQuality
} from './settings'

// ---------------------------------------------------------------------------
// CommonRoom network layer: a full-mesh group video call.
//
// Rooms: the room ID is any string (no spaces); it is hashed into a nostr
// topic, so there is no room registry anywhere — knowing the name IS the key.
//
// Presence: everyone in the room announces {peerId, name} on the room topic
// every few seconds; entries expire when announcements stop.
//
// Mesh: unlike commoncall (mutual consent, one call at a time), being in the
// room IS the consent — every participant automatically brings up a WebRTC
// connection with every other participant (commonview's approach, but carrying
// media). Camera/mic are requested on entry, but both start MUTED; if access
// is denied you still join, sending synthetic silent/black placeholder tracks,
// and unmuting retries the device and upgrades the tracks in place.
//
// Everything else (deterministic initiator = smaller peer ID, per-peer nostr
// signaling topics, control data channel, track-swap screen share, quality
// caps via setParameters) is the commoncall design, applied per-peer.
// ---------------------------------------------------------------------------

/** Soft cap: peers at capacity turn newcomers away with {t:'room-full'}. */
export const MAX_PARTICIPANTS = 8

interface Announcement {
  peerId: string
  name: string
}

// Messages on per-peer nostr topics (pre-connection).
type PeerMsg = {t: 'signal'; signal: Signal} | {t: 'room-full'}

// Messages on the per-peer control data channels (WebRTC, not nostr).
interface SettingEntry {
  key: string
  value: unknown
  rev: number
  by: string
}
type ControlMsg =
  | {
      t: 'hello'
      name: string
      audioMuted: boolean
      videoMuted: boolean
      settings: SettingEntry[]
    }
  | ({t: 'set'} & SettingEntry)
  | {t: 'mute'; audio: boolean; video: boolean}
  | {t: 'bye'}

const ANNOUNCE_INTERVAL_MS = 5000
const PRESENCE_TTL_MS = 15000
// A connection attempt that hasn't opened after this long is torn down and
// retried on the peer's next announcement. Signaling events are ephemeral, so
// an offer published before the other side was listening is simply lost —
// without a retry the pair would deadlock forever.
const CONNECT_RETRY_MS = 15000

const NAME_KEY = 'commonroom:name'

export type Phase = 'landing' | 'joining' | 'room'

interface Conn {
  peer: Peer
  /** When this connection attempt started (local clock), for retry pacing. */
  createdAt: number
  /** Name from the hello message (presence announcements may lag behind). */
  name: string | null
  connected: boolean
  stream: MediaStream | null
  /** Their reported effective outgoing mute state (muted until told otherwise
   *  — everyone starts muted). */
  audioMuted: boolean
  videoMuted: boolean
}

export interface ParticipantInfo {
  peerId: string
  name: string
  connected: boolean
  stream: MediaStream | null
  audioMuted: boolean
  videoMuted: boolean
}

export interface Snapshot {
  selfId: string
  phase: Phase
  roomId: string | null
  name: string | null
  /** Everyone else in the room (connected or still connecting). */
  participants: ParticipantInfo[]
  audioMuted: boolean
  videoMuted: boolean
  micAvailable: boolean
  camAvailable: boolean
  localStream: MediaStream | null
  screenStream: MediaStream | null
  settings: RoomSettings
  notice: string | null
}

export class Network {
  private nostr = new Nostr()
  private phase: Phase = 'landing'
  private roomId: string | null = null
  private root = ''
  private name: string | null = null
  private presence = new Map<string, {name: string; lastSeen: number}>()
  private conns = new Map<string, Conn>()
  private unsubs: (() => void)[] = []
  private announceTimer: number | null = null
  private sweepTimer: number | null = null
  /** Bumped on every join/leave so stale async work can detect it's obsolete. */
  private joinSeq = 0

  private localStream: MediaStream | null = null
  private screenStream: MediaStream | null = null
  private micAvailable = false
  private camAvailable = false
  private audioMuted = true
  private videoMuted = true
  private audioCtx: AudioContext | null = null

  private settings: RoomSettings = {...DEFAULT_SETTINGS}
  /** Per-key revision + setter for the last-writer-wins settings sync. */
  private settingsMeta: Partial<
    Record<keyof RoomSettings, {rev: number; by: string}>
  > = {}

  private notice: string | null = null

  private snapshot!: Snapshot
  private listeners = new Set<() => void>()

  /** Last name used on this browser, for prefilling the join form. */
  readonly savedName: string = localStorage.getItem(NAME_KEY) ?? ''

  constructor() {
    this.rebuildSnapshot()
    window.addEventListener('online', () => void this.announce())
    // Best-effort goodbye so tiles vanish immediately instead of after the
    // presence TTL when a tab closes.
    window.addEventListener('pagehide', () => {
      if (this.phase === 'room') this.broadcastControl({t: 'bye'})
    })
  }

  // ---- joining and leaving ----------------------------------------------

  async enterRoom(name: string, room: string) {
    if (this.phase !== 'landing') return
    const nm = name.trim().slice(0, 40)
    const rm = room.replace(/\s+/g, '').slice(0, 100)
    if (!nm || !rm) return
    this.name = nm
    this.roomId = rm
    localStorage.setItem(NAME_KEY, nm)
    // Put the room in the URL so the address bar is the invite link.
    try {
      location.hash = encodeURIComponent(rm)
    } catch {
      /* ignore */
    }
    this.notice = null
    this.phase = 'joining'
    this.rebuildSnapshot()
    const seq = ++this.joinSeq

    const media = await this.acquireMedia()
    if (this.joinSeq !== seq) {
      for (const t of media.stream.getTracks()) t.stop()
      return
    }
    this.localStream = media.stream
    this.micAvailable = media.mic
    this.camAvailable = media.cam
    // Everyone enters muted.
    this.audioMuted = true
    this.videoMuted = true
    for (const t of media.stream.getTracks()) t.enabled = false

    this.root = await roomTopic(rm)
    if (this.joinSeq !== seq) return
    const selfTopic = await peerTopic(this.root, selfId)
    if (this.joinSeq !== seq) return

    // WebRTC signaling (and room-full notices) addressed to us.
    this.unsubs.push(
      this.nostr.subscribe(selfTopic, (content, from) => {
        if (from === selfId) return
        let msg: PeerMsg
        try {
          msg = JSON.parse(content)
        } catch {
          return
        }
        this.handlePeerMsg(from, msg)
      })
    )

    // Presence announcements on the room topic.
    this.unsubs.push(
      this.nostr.subscribe(this.root, (content, from) => {
        if (from === selfId) return
        let ann: Partial<Announcement>
        try {
          ann = JSON.parse(content)
        } catch {
          return
        }
        if (ann.peerId !== from || typeof ann.name !== 'string') return
        const prev = this.presence.get(from)
        const annName = ann.name.slice(0, 40)
        this.presence.set(from, {name: annName, lastSeen: Date.now()})
        if (!prev || prev.name !== annName) this.rebuildSnapshot()
        this.maybeConnect(from)
      })
    )

    this.phase = 'room'
    void this.announce()
    this.announceTimer = window.setInterval(
      () => void this.announce(),
      ANNOUNCE_INTERVAL_MS
    )
    this.sweepTimer = window.setInterval(
      () => this.sweepPresence(),
      ANNOUNCE_INTERVAL_MS
    )
    this.rebuildSnapshot()
  }

  leave() {
    if (this.phase === 'landing') return
    this.teardown()
    this.notice = null
    this.rebuildSnapshot()
  }

  private teardown() {
    this.joinSeq++
    this.broadcastControl({t: 'bye'})
    const conns = [...this.conns.values()]
    this.conns.clear() // cleared first so close handlers no-op
    for (const c of conns) c.peer.destroy()
    this.presence.clear()
    for (const u of this.unsubs.splice(0)) u()
    if (this.announceTimer !== null) clearInterval(this.announceTimer)
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer)
    this.announceTimer = null
    this.sweepTimer = null
    if (this.screenStream) {
      for (const t of this.screenStream.getTracks()) t.stop()
      this.screenStream = null
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop()
      this.localStream = null
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined)
      this.audioCtx = null
    }
    this.micAvailable = false
    this.camAvailable = false
    this.audioMuted = true
    this.videoMuted = true
    this.settings = {...DEFAULT_SETTINGS}
    this.settingsMeta = {}
    this.root = ''
    this.roomId = null
    this.phase = 'landing'
  }

  // ---- local media -------------------------------------------------------
  //
  // Every participant always carries exactly one audio and one video track so
  // the WebRTC offer/answer is symmetric for everyone. If a device is missing
  // or permission is denied, a synthetic placeholder (silent audio / black
  // video) stands in; unmuting later retries getUserMedia and upgrades the
  // placeholder via replaceTrack on every connection — no renegotiation.

  private async acquireMedia(): Promise<{
    stream: MediaStream
    mic: boolean
    cam: boolean
  }> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      })
      return {stream: s, mic: true, cam: true}
    } catch {
      /* fall through to per-kind attempts */
    }
    let audio: MediaStreamTrack | null = null
    let video: MediaStreamTrack | null = null
    try {
      const s = await navigator.mediaDevices.getUserMedia({audio: true})
      audio = s.getAudioTracks()[0] ?? null
    } catch {
      /* no mic */
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({video: true})
      video = s.getVideoTracks()[0] ?? null
    } catch {
      /* no camera */
    }
    const stream = new MediaStream()
    stream.addTrack(audio ?? this.silentAudioTrack())
    stream.addTrack(video ?? blackVideoTrack())
    return {stream, mic: audio !== null, cam: video !== null}
  }

  private silentAudioTrack(): MediaStreamTrack {
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    const dst = this.audioCtx.createMediaStreamDestination()
    return dst.stream.getAudioTracks()[0]
  }

  /** The tracks we send to a (new) peer: mic audio plus screen or camera. */
  private outgoingStream(): MediaStream {
    const s = new MediaStream()
    const audio = this.localStream?.getAudioTracks()[0]
    if (audio) s.addTrack(audio)
    const video =
      this.screenStream?.getVideoTracks()[0] ??
      this.localStream?.getVideoTracks()[0]
    if (video) s.addTrack(video)
    return s
  }

  // ---- presence and the mesh ----------------------------------------------

  private async announce() {
    if (this.phase !== 'room' || !this.name || !this.root) return
    const ann: Announcement = {peerId: selfId, name: this.name}
    void this.nostr.publish(this.root, JSON.stringify(ann))
  }

  private sweepPresence() {
    const cutoff = Date.now() - PRESENCE_TTL_MS
    let changed = false
    for (const [peerId, p] of this.presence) {
      if (p.lastSeen < cutoff) {
        this.presence.delete(peerId)
        changed = true
      }
    }
    if (changed) this.rebuildSnapshot()
  }

  private async sendToPeer(peerId: string, msg: PeerMsg) {
    if (!this.root) return
    const topic = await peerTopic(this.root, peerId)
    void this.nostr.publish(topic, JSON.stringify(msg))
  }

  private atCapacity(): boolean {
    return this.conns.size >= MAX_PARTICIPANTS - 1
  }

  private maybeConnect(peerId: string) {
    if (this.phase !== 'room' || !this.localStream || peerId === selfId) return
    const existing = this.conns.get(peerId)
    if (existing) {
      const stalled =
        !existing.connected &&
        Date.now() - existing.createdAt > CONNECT_RETRY_MS
      if (!stalled) return
      this.conns.delete(peerId) // deleted first so the close handler no-ops
      existing.peer.destroy()
    }
    if (this.atCapacity()) {
      // The room is full from our point of view: turn the newcomer away.
      void this.sendToPeer(peerId, {t: 'room-full'})
      return
    }
    // Deterministic initiator: the peer with the smaller ID makes the offer.
    this.createPeer(peerId, selfId < peerId)
  }

  private createPeer(peerId: string, initiator: boolean): Conn {
    const peer = new Peer(initiator, this.outgoingStream())
    const conn: Conn = {
      peer,
      createdAt: Date.now(),
      name: null,
      connected: false,
      stream: null,
      audioMuted: true,
      videoMuted: true
    }
    this.conns.set(peerId, conn)

    peer.setHandlers({
      signal: signal => {
        void this.sendToPeer(peerId, {t: 'signal', signal})
      },
      track: stream => {
        conn.stream = stream
        this.rebuildSnapshot()
      },
      connect: () => {
        conn.connected = true
        this.sendHello(conn)
        this.applyVideoParamsTo(conn)
        this.rebuildSnapshot()
      },
      data: raw => this.handleControl(peerId, conn, raw),
      close: () => {
        if (this.conns.get(peerId) === conn) {
          this.conns.delete(peerId)
          this.rebuildSnapshot()
        }
      }
    })

    this.rebuildSnapshot()
    return conn
  }

  private handlePeerMsg(from: string, msg: PeerMsg) {
    if (this.phase !== 'room') return
    switch (msg.t) {
      case 'signal': {
        let conn = this.conns.get(from)
        if (!conn) {
          // An offer can arrive before we've seen the peer's announcement.
          if (msg.signal?.type !== 'offer') return
          if (this.atCapacity()) {
            void this.sendToPeer(from, {t: 'room-full'})
            return
          }
          conn = this.createPeer(from, false)
        }
        void conn.peer.signal(msg.signal)
        return
      }
      case 'room-full': {
        // Only honor this while we haven't gotten a foothold in the room —
        // once we have any connection, we're in.
        if (this.conns.size === 0) {
          this.teardown()
          this.notice = `That room is full — up to ${MAX_PARTICIPANTS} people can be in a room.`
          this.rebuildSnapshot()
        }
        return
      }
    }
  }

  // ---- control channel ----------------------------------------------------

  private broadcastControl(msg: ControlMsg) {
    const payload = JSON.stringify(msg)
    for (const conn of this.conns.values()) conn.peer.send(payload)
  }

  private sendHello(conn: Conn) {
    const settings: SettingEntry[] = []
    for (const [key, meta] of Object.entries(this.settingsMeta)) {
      settings.push({
        key,
        value: this.settings[key as keyof RoomSettings],
        rev: meta.rev,
        by: meta.by
      })
    }
    conn.peer.send(
      JSON.stringify({
        t: 'hello',
        name: this.name ?? '',
        audioMuted: this.audioMuted,
        videoMuted: this.effectiveVideoMuted(),
        settings
      } satisfies ControlMsg)
    )
  }

  private handleControl(peerId: string, conn: Conn, raw: string) {
    if (this.conns.get(peerId) !== conn) return
    let msg: ControlMsg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.t) {
      case 'hello': {
        if (typeof msg.name === 'string') conn.name = msg.name.slice(0, 40)
        conn.audioMuted = msg.audioMuted !== false
        conn.videoMuted = msg.videoMuted !== false
        if (Array.isArray(msg.settings)) {
          for (const entry of msg.settings) this.applyRemoteSetting(entry)
        }
        this.rebuildSnapshot()
        return
      }
      case 'set': {
        this.applyRemoteSetting(msg)
        return
      }
      case 'mute': {
        if (typeof msg.audio !== 'boolean' || typeof msg.video !== 'boolean') {
          return
        }
        conn.audioMuted = msg.audio
        conn.videoMuted = msg.video
        this.rebuildSnapshot()
        return
      }
      case 'bye': {
        this.presence.delete(peerId)
        conn.peer.destroy() // its close handler removes it and rebuilds
        return
      }
    }
  }

  // ---- shared room settings ------------------------------------------------
  //
  // ONE settings object for the whole room, editable by anyone. Sync is
  // per-key last-writer-wins: every change bumps that key's revision and is
  // broadcast as {t:'set'} to every peer (the mesh is a complete graph, so no
  // relaying is needed). Late joiners receive the current entries in each
  // hello. Concurrent changes at the same revision must resolve identically
  // everywhere, so the SETTER with the smaller peer ID wins the tie.

  private setSetting<K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K]
  ) {
    if (this.phase !== 'room' || this.settings[key] === value) return
    const rev = (this.settingsMeta[key]?.rev ?? 0) + 1
    this.settingsMeta[key] = {rev, by: selfId}
    this.settings = {...this.settings}
    this.settings[key] = value
    this.broadcastControl({t: 'set', key, value, rev, by: selfId})
    this.settingChanged(key)
    this.rebuildSnapshot()
  }

  private applyRemoteSetting(entry: SettingEntry) {
    if (typeof entry !== 'object' || entry === null) return
    if (typeof entry.key !== 'string' || !(entry.key in SETTING_VALIDATORS)) {
      return
    }
    const key = entry.key as keyof RoomSettings
    if (!SETTING_VALIDATORS[key](entry.value)) return
    if (!Number.isInteger(entry.rev) || entry.rev < 1) return
    if (typeof entry.by !== 'string' || entry.by.length !== 64) return
    const cur = this.settingsMeta[key]
    const curRev = cur?.rev ?? 0
    if (entry.rev < curRev) return // stale
    if (entry.rev === curRev && cur && cur.by <= entry.by) return // tie: they lose
    this.settingsMeta[key] = {rev: entry.rev, by: entry.by}
    if (this.settings[key] !== entry.value) {
      this.settings = {...this.settings}
      this.settings[key] = entry.value
      this.settingChanged(key)
    }
    this.rebuildSnapshot()
  }

  /** Side effects of a setting taking a new value (local or remote). */
  private settingChanged(key: keyof RoomSettings) {
    if (key === 'videoQuality') this.applyVideoParamsAll()
  }

  private videoParams(): VideoSendParams {
    const p = QUALITY_PARAMS[this.settings.videoQuality]
    const sharing = this.screenStream !== null
    return {
      maxBitrate: p.maxBitrate,
      // Downscaled screen text is unreadable: while sharing, send full
      // resolution and let the bitrate/framerate caps do the limiting.
      scaleResolutionDownBy: sharing ? undefined : p.scaleResolutionDownBy,
      maxFramerate: p.maxFramerate,
      degradationPreference: sharing ? 'maintain-resolution' : undefined
    }
  }

  private applyVideoParamsAll() {
    for (const conn of this.conns.values()) this.applyVideoParamsTo(conn)
  }

  private applyVideoParamsTo(conn: Conn) {
    void conn.peer.setVideoParameters(this.videoParams()).then(ok => {
      if (!ok) {
        // Right at 'connected' the encoding may not be negotiated yet.
        window.setTimeout(
          () => void conn.peer.setVideoParameters(this.videoParams()),
          1500
        )
      }
    })
  }

  // ---- mute -----------------------------------------------------------------
  //
  // Mute is per-participant state, not a shared setting: each participant owns
  // its own flags and just notifies the others (the ordered channel makes
  // last-sent win). Toggling track.enabled sends silence/black without
  // renegotiation. Unmuting without a usable device retries getUserMedia and,
  // on success, upgrades the placeholder track in place on every connection.

  setAudioMuted(muted: boolean) {
    if (this.phase !== 'room' || !this.localStream) return
    if (this.audioMuted === muted) return
    if (!muted && !this.micAvailable) {
      void this.enableAudioWithRetry()
      return
    }
    this.audioMuted = muted
    for (const t of this.localStream.getAudioTracks()) t.enabled = !muted
    this.broadcastMuteNotice()
    this.rebuildSnapshot()
  }

  setVideoMuted(muted: boolean) {
    if (this.phase !== 'room' || !this.localStream) return
    if (this.videoMuted === muted) return
    if (!muted && !this.camAvailable) {
      void this.enableVideoWithRetry()
      return
    }
    this.videoMuted = muted
    for (const t of this.localStream.getVideoTracks()) t.enabled = !muted
    this.broadcastMuteNotice()
    this.rebuildSnapshot()
  }

  private async enableAudioWithRetry() {
    const seq = this.joinSeq
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true})
    } catch {
      this.notice =
        'Could not access your microphone — check browser permissions.'
      this.rebuildSnapshot()
      return
    }
    const track = stream.getAudioTracks()[0]
    if (!track || this.joinSeq !== seq || !this.localStream) {
      for (const t of stream.getTracks()) t.stop()
      return
    }
    const old = this.localStream.getAudioTracks()[0] ?? null
    for (const conn of this.conns.values()) {
      void conn.peer.replaceTrack('audio', track)
    }
    if (old) {
      this.localStream.removeTrack(old)
      old.stop()
    }
    this.localStream.addTrack(track)
    this.micAvailable = true
    this.audioMuted = false
    track.enabled = true
    this.broadcastMuteNotice()
    this.rebuildSnapshot()
  }

  private async enableVideoWithRetry() {
    const seq = this.joinSeq
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: true})
    } catch {
      this.notice = 'Could not access your camera — check browser permissions.'
      this.rebuildSnapshot()
      return
    }
    const track = stream.getVideoTracks()[0]
    if (!track || this.joinSeq !== seq || !this.localStream) {
      for (const t of stream.getTracks()) t.stop()
      return
    }
    const old = this.localStream.getVideoTracks()[0] ?? null
    // While screen sharing, the connections carry the screen track; the new
    // camera track takes over when the share stops.
    if (!this.screenStream) {
      for (const conn of this.conns.values()) {
        void conn.peer.replaceTrack('video', track)
      }
    }
    if (old) {
      this.localStream.removeTrack(old)
      old.stop()
    }
    this.localStream.addTrack(track)
    this.camAvailable = true
    this.videoMuted = false
    track.enabled = true
    this.broadcastMuteNotice()
    this.rebuildSnapshot()
  }

  /** While screen sharing the outgoing video is the (always live) screen, so
   *  a muted camera is latent until the share ends. */
  private effectiveVideoMuted(): boolean {
    return this.videoMuted && !this.screenStream
  }

  private broadcastMuteNotice() {
    this.broadcastControl({
      t: 'mute',
      audio: this.audioMuted,
      video: this.effectiveVideoMuted()
    })
  }

  // ---- screen share ---------------------------------------------------------

  /** Swap the outgoing camera track for a screen capture on EVERY connection.
   *  Everyone sees the screen in place of the camera; no renegotiation. */
  async startScreenShare() {
    if (this.phase !== 'room' || this.screenStream) return
    const seq = this.joinSeq
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({video: true})
    } catch {
      return // user canceled the picker (or capture is unsupported)
    }
    const track = stream.getVideoTracks()[0]
    if (!track || this.joinSeq !== seq) {
      for (const t of stream.getTracks()) t.stop()
      return
    }
    this.screenStream = stream
    for (const conn of this.conns.values()) {
      void conn.peer.replaceTrack('video', track)
    }
    this.applyVideoParamsAll() // re-derive caps for screen-share mode
    this.broadcastMuteNotice() // outgoing video is now the live screen
    // The browser's own "Stop sharing" bar ends the track; swap back then.
    track.onended = () => void this.stopScreenShare()
    this.rebuildSnapshot()
  }

  async stopScreenShare() {
    if (!this.screenStream) return
    const screen = this.screenStream
    this.screenStream = null
    const camTrack = this.localStream?.getVideoTracks()[0]
    if (camTrack) {
      for (const conn of this.conns.values()) {
        void conn.peer.replaceTrack('video', camTrack)
      }
    }
    for (const t of screen.getTracks()) t.stop()
    if (this.phase === 'room') {
      this.applyVideoParamsAll() // restore camera-mode caps
      this.broadcastMuteNotice() // the camera, with its mute state, is back
      this.rebuildSnapshot()
    }
  }

  // ---- public API -------------------------------------------------------

  /** Change the room-wide video-quality preset. Anyone can change it; every
   *  participant caps its own outgoing video, and the change syncs across. */
  setVideoQuality(quality: VideoQuality) {
    this.setSetting('videoQuality', quality)
  }

  dismissNotice() {
    this.notice = null
    this.rebuildSnapshot()
  }

  getSnapshot = (): Snapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private rebuildSnapshot() {
    const ids = new Set<string>([...this.conns.keys(), ...this.presence.keys()])
    const participants: ParticipantInfo[] = [...ids]
      .map(peerId => {
        const conn = this.conns.get(peerId)
        return {
          peerId,
          name:
            this.presence.get(peerId)?.name ??
            conn?.name ??
            peerId.slice(0, 8),
          connected: conn?.connected ?? false,
          stream: conn?.stream ?? null,
          audioMuted: conn?.audioMuted ?? true,
          videoMuted: conn?.videoMuted ?? true
        }
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.peerId.localeCompare(b.peerId)
      )

    this.snapshot = {
      selfId,
      phase: this.phase,
      roomId: this.roomId,
      name: this.name,
      participants,
      audioMuted: this.audioMuted,
      videoMuted: this.videoMuted,
      micAvailable: this.micAvailable,
      camAvailable: this.camAvailable,
      localStream: this.localStream,
      screenStream: this.screenStream,
      settings: this.settings,
      notice: this.notice
    }
    for (const l of this.listeners) l()
  }
}

/** A tiny black video track, used as a placeholder when there is no camera. */
const blackVideoTrack = (): MediaStreamTrack => {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height)
  return canvas.captureStream(2).getVideoTracks()[0]
}
