import {useEffect, useRef, useState} from 'react'
import {
  MAX_PARTICIPANTS,
  type ChatItem,
  type ParticipantInfo
} from './p2p/network'
import {VIDEO_QUALITIES, type VideoQuality} from './p2p/settings'
import {useNetwork} from './useNetwork'

// Screen capture is desktop-only in practice; hide the button where the API
// doesn't exist (most mobile browsers).
const canShareScreen =
  typeof navigator.mediaDevices?.getDisplayMedia === 'function'

const initialRoomFromHash = (): string => {
  try {
    return decodeURIComponent(location.hash.slice(1)).replace(/\s/g, '')
  } catch {
    return ''
  }
}

// ---- styles ---------------------------------------------------------------

const lightBtn: React.CSSProperties = {
  padding: '0.45rem 1.1rem',
  borderRadius: 6,
  border: '1px solid #888',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '1rem'
}

const primaryBtn: React.CSSProperties = {
  ...lightBtn,
  background: '#1a7f37',
  borderColor: '#1a7f37',
  color: '#fff'
}

const disabledStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed'
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  fontSize: '1rem',
  borderRadius: 6,
  border: '1px solid #bbb',
  width: '100%',
  boxSizing: 'border-box'
}

// Dark in-room controls.
const darkBtn: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: 8,
  border: '1px solid #555',
  background: '#2a2a2a',
  color: '#eee',
  cursor: 'pointer',
  fontSize: '0.95rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem'
}

// Square icon-only buttons for the control bar. Their meaning is carried by
// the icon plus a title tooltip and aria-label.
const iconBtn: React.CSSProperties = {
  ...darkBtn,
  padding: '0.65rem',
  justifyContent: 'center'
}

// A mute button while muted — red, the universal "you are muted" signal.
const mutedIconBtn: React.CSSProperties = {
  ...iconBtn,
  background: '#c62828',
  borderColor: '#c62828',
  color: '#fff'
}

// The screen-share button while sharing.
const sharingIconBtn: React.CSSProperties = {
  ...iconBtn,
  background: '#1a7f37',
  borderColor: '#1a7f37',
  color: '#fff'
}

const leaveBtn: React.CSSProperties = {
  ...darkBtn,
  background: '#c62828',
  borderColor: '#c62828',
  color: '#fff'
}

// Chip overlaid on a tile (name label, mute badges).
const tileChip: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#fff',
  borderRadius: 6,
  padding: '0.2rem 0.5rem',
  fontSize: '0.85rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  maxWidth: '90%'
}

// ---- icons (stroke-style paths from Feather icons, MIT) --------------------

const ICONS = {
  mic: (
    <>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
    </>
  ),
  micOff: (
    <>
      <path d="M1 1l22 22" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
    </>
  ),
  video: (
    <>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </>
  ),
  videoOff: (
    <>
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
      <path d="M1 1l22 22" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  x: (
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  send: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  )
} as const

function Icon({
  name,
  size = 18,
  style
}: {
  name: keyof typeof ICONS
  size?: number
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{display: 'block', ...style}}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}

// ---- video tile -------------------------------------------------------------

function VideoView({
  stream,
  muted,
  mirror,
  fit
}: {
  stream: MediaStream | null
  muted: boolean
  mirror: boolean
  fit: 'cover' | 'contain'
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: fit,
        transform: mirror ? 'scaleX(-1)' : undefined
      }}
    />
  )
}

function Tile({
  stream,
  label,
  isSelf,
  mirror,
  audioMuted,
  videoMuted,
  connecting,
  fill = false,
  onClick,
  tooltip
}: {
  stream: MediaStream | null
  label: string
  isSelf: boolean
  mirror: boolean
  audioMuted: boolean
  videoMuted: boolean
  connecting: boolean
  /** Fill the parent box (spotlight) instead of a fixed 4:3 grid cell. */
  fill?: boolean
  onClick?: () => void
  tooltip?: string
}) {
  return (
    <div
      onClick={onClick}
      title={tooltip}
      style={{
        position: 'relative',
        background: '#000',
        borderRadius: 10,
        overflow: 'hidden',
        // The spotlight tile letterboxes (contain) so screen shares and faces
        // are never cropped; grid/filmstrip cells crop to fill (cover).
        ...(fill ? {width: '100%', height: '100%'} : {aspectRatio: '4 / 3'}),
        border: isSelf ? '1px solid #444' : '1px solid #222',
        cursor: onClick ? 'pointer' : undefined
      }}
    >
      {/* The video element stays mounted even when their camera is off so the
          audio keeps playing; the placeholder just covers it. */}
      <VideoView
        stream={stream}
        muted={isSelf}
        mirror={mirror}
        fit={fill ? 'contain' : 'cover'}
      />
      {(videoMuted || connecting) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#222',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#3a3a3a',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
              fontFamily: 'sans-serif'
            }}
          >
            {(label[0] ?? '?').toUpperCase()}
          </div>
          {connecting && (
            <span style={{color: '#999', fontSize: '0.9rem'}}>Connecting…</span>
          )}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          display: 'flex',
          gap: '0.35rem',
          alignItems: 'center'
        }}
      >
        <span style={tileChip}>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {label}
          </span>
          {audioMuted && <Icon name="micOff" size={13} />}
        </span>
      </div>
    </div>
  )
}

// ---- landing ------------------------------------------------------------------

function Landing({
  notice,
  initialName,
  onDismissNotice,
  onEnter
}: {
  notice: string | null
  initialName: string
  onDismissNotice: () => void
  onEnter: (name: string, room: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [room, setRoom] = useState(initialRoomFromHash)
  const canEnter = name.trim().length > 0 && room.length > 0
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canEnter) onEnter(name, room)
  }
  return (
    <div
      style={{
        fontFamily: 'sans-serif',
        maxWidth: 460,
        margin: '3rem auto',
        padding: '0 1rem'
      }}
    >
      <h1 style={{marginBottom: '0.25rem'}}>CommonRoom</h1>
      <p style={{color: '#666', marginTop: 0}}>
        Group video calls with no server. Pick a room, share the link, and
        talk — everything flows peer-to-peer.
      </p>

      {notice && (
        <div
          style={{
            background: '#fff3cd',
            border: '1px solid #e0c968',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            margin: '0.75rem 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <span>{notice}</span>
          <button style={lightBtn} onClick={onDismissNotice}>
            OK
          </button>
        </div>
      )}

      <form onSubmit={submit} style={{marginTop: '1.5rem'}}>
        <label style={{display: 'block', marginBottom: '1rem'}}>
          <div style={{marginBottom: '0.3rem'}}>Your name</div>
          <input
            autoFocus={!initialName}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Jeremy"
            maxLength={40}
            style={inputStyle}
          />
        </label>
        <label style={{display: 'block', marginBottom: '1.25rem'}}>
          <div style={{marginBottom: '0.3rem'}}>Room name</div>
          <input
            autoFocus={!!initialName}
            value={room}
            onChange={e => setRoom(e.target.value.replace(/\s/g, ''))}
            placeholder="any-name-you-like (no spaces)"
            maxLength={100}
            style={inputStyle}
          />
        </label>
        <button
          type="submit"
          style={canEnter ? primaryBtn : {...primaryBtn, ...disabledStyle}}
          disabled={!canEnter}
        >
          Enter room
        </button>
      </form>

      <p style={{color: '#888', fontSize: '0.85rem', marginTop: '1.5rem'}}>
        Anyone who knows the room name can join — up to {MAX_PARTICIPANTS}{' '}
        people per room. You enter with your microphone and camera off.
      </p>
    </div>
  )
}

// ---- room ----------------------------------------------------------------------

function CopyLinkButton({compact}: {compact: boolean}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable; the address bar still has the link */
    }
  }
  return (
    <button
      style={darkBtn}
      onClick={() => void copy()}
      title="Copy the room link to share"
    >
      <Icon name="link" size={15} />
      {copied ? 'Copied!' : compact ? 'Copy link' : 'Copy room link'}
    </button>
  )
}

// ---- chat -----------------------------------------------------------------

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Make http(s) URLs clickable. Only URLs we matched ourselves become hrefs
// (never arbitrary schemes), and common trailing punctuation stays as text.
const URL_RE = /https?:\/\/[^\s]+/g

function withLinks(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text))) {
    let url = m[0]
    const trail = url.match(/[.,!?;:)\]'"]+$/)
    if (trail) url = url.slice(0, -trail[0].length)
    if (url.replace(/^https?:\/\//, '') === '') continue // scheme only
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{color: '#9cc4ff', wordBreak: 'break-all'}}
      >
        {url}
      </a>
    )
    last = m.index + url.length
    URL_RE.lastIndex = last
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const timeLabel = (t: number): string =>
  new Date(t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})

function ChatPanel({
  items,
  overlay,
  onSend,
  onClose
}: {
  items: ChatItem[]
  overlay: boolean
  onSend: (text: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  // Stick to the bottom unless the user has scrolled up to read.
  const stickRef = useRef(true)
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    onSend(draft)
    setDraft('')
    stickRef.current = true
  }

  return (
    <aside
      style={{
        ...(overlay
          ? {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(320px, 88vw)',
              zIndex: 10,
              boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.5)'
            }
          : {width: 300, flex: '0 0 auto'}),
        background: '#161616',
        borderLeft: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.45rem 0.45rem 0.45rem 0.75rem',
          borderBottom: '1px solid #333'
        }}
      >
        <strong>Chat</strong>
        <button
          style={{...iconBtn, padding: '0.35rem', border: 'none', background: 'none'}}
          onClick={onClose}
          title="Close chat"
          aria-label="Close chat"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current
          if (el) {
            stickRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 60
          }
        }}
        style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.6rem 0.75rem'}}
      >
        {items.length === 0 && (
          <p style={{color: '#777', fontSize: '0.85rem'}}>
            No messages yet. Only people in the room see the chat, and nothing
            is stored anywhere.
          </p>
        )}
        {items.map(item =>
          item.kind === 'system' ? (
            <div
              key={item.seq}
              style={{
                textAlign: 'center',
                color: '#888',
                fontStyle: 'italic',
                fontSize: '0.8rem',
                margin: '0.45rem 0'
              }}
            >
              {item.text} · {timeLabel(item.time)}
            </div>
          ) : (
            <div key={item.seq} style={{marginBottom: '0.55rem'}}>
              <div style={{fontSize: '0.75rem', color: '#888'}}>
                <strong style={{color: '#ccc'}}>{item.name}</strong>{' '}
                {timeLabel(item.time)}
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '0.92rem'
                }}
              >
                {withLinks(item.text)}
              </div>
            </div>
          )
        )}
      </div>
      <form
        onSubmit={submit}
        style={{
          display: 'flex',
          gap: '0.4rem',
          padding: '0.6rem',
          borderTop: '1px solid #333'
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Message…"
          maxLength={2000}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '0.45rem 0.6rem',
            borderRadius: 8,
            border: '1px solid #555',
            background: '#2a2a2a',
            color: '#eee',
            fontSize: '0.92rem'
          }}
        />
        <button
          type="submit"
          style={draft.trim() ? iconBtn : {...iconBtn, ...disabledStyle}}
          disabled={!draft.trim()}
          title="Send"
          aria-label="Send message"
        >
          <Icon name="send" size={16} />
        </button>
      </form>
    </aside>
  )
}

export default function App() {
  const {snapshot, network} = useNetwork()
  const {
    phase,
    roomId,
    name,
    participants,
    audioMuted,
    videoMuted,
    micAvailable,
    camAvailable,
    localStream,
    screenStream,
    settings,
    chat,
    notice
  } = snapshot

  // Spotlight: which tile is enlarged ('self', a peer ID, or null = gallery).
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusValid =
    focusedId !== null &&
    (focusedId === 'self' || participants.some(p => p.peerId === focusedId))
  const focus = focusValid ? focusedId : null
  useEffect(() => {
    // Drop the spotlight when its subject leaves (or we leave the room).
    if (focusedId !== null && (phase !== 'room' || !focusValid)) {
      setFocusedId(null)
    }
  }, [phase, focusedId, focusValid])
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

  // Chat panel: side panel on wide screens, overlay on narrow ones. The
  // unread badge counts real messages (not join/left lines) that arrived
  // while the panel was closed.
  const [chatOpen, setChatOpen] = useState(false)
  const [readCount, setReadCount] = useState(0)
  const narrow = useMediaQuery('(max-width: 700px)')
  useEffect(() => {
    if (phase !== 'room' && chatOpen) setChatOpen(false)
  }, [phase, chatOpen])
  useEffect(() => {
    // Follows the log while open; also snaps back when the log resets on leave.
    if ((chatOpen || readCount > chat.length) && readCount !== chat.length) {
      setReadCount(chat.length)
    }
  }, [chatOpen, readCount, chat.length])
  const unread = chatOpen
    ? 0
    : chat.slice(readCount).filter(m => m.kind === 'chat').length

  if (phase === 'landing') {
    return (
      <Landing
        notice={notice}
        initialName={network.savedName}
        onDismissNotice={() => network.dismissNotice()}
        onEnter={(n, r) => void network.enterRoom(n, r)}
      />
    )
  }

  if (phase === 'joining') {
    return (
      <div
        style={{
          fontFamily: 'sans-serif',
          maxWidth: 460,
          margin: '3rem auto',
          padding: '0 1rem'
        }}
      >
        <h1 style={{marginBottom: '0.25rem'}}>CommonRoom</h1>
        <p>
          Joining <strong>#{roomId}</strong>… your browser may ask for camera
          and microphone access (you'll still be muted until you turn them on).
        </p>
        <button style={lightBtn} onClick={() => network.leave()}>
          Cancel
        </button>
      </div>
    )
  }

  // ---- in-room (dark) ----
  const sharing = screenStream !== null
  const count = participants.length + 1
  const alone = participants.length === 0

  const tileTooltip = (focused: boolean) =>
    focused ? 'Click to return to the gallery (Esc)' : 'Click to enlarge'
  const selfTile = (focused: boolean) => (
    <Tile
      stream={screenStream ?? localStream}
      label={`${name} (you)`}
      isSelf
      mirror={!sharing}
      audioMuted={audioMuted}
      videoMuted={videoMuted && !sharing}
      connecting={false}
      fill={focused}
      tooltip={tileTooltip(focused)}
      onClick={() => setFocusedId(focused ? null : 'self')}
    />
  )
  const peerTile = (p: ParticipantInfo, focused: boolean) => (
    <Tile
      stream={p.stream}
      label={p.name}
      isSelf={false}
      mirror={false}
      audioMuted={p.audioMuted}
      videoMuted={p.videoMuted}
      connecting={!p.connected}
      fill={focused}
      tooltip={tileTooltip(focused)}
      onClick={() => setFocusedId(focused ? null : p.peerId)}
    />
  )
  const focusedPeer =
    focus && focus !== 'self'
      ? participants.find(p => p.peerId === focus)
      : undefined
  const stripPeers = focus
    ? participants.filter(p => p.peerId !== focus)
    : []

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#111',
        color: '#eee',
        fontFamily: 'sans-serif',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.55rem 1rem',
          background: '#1c1c1c',
          borderBottom: '1px solid #333',
          flexWrap: 'wrap'
        }}
      >
        <strong>CommonRoom</strong>
        <span
          style={{
            color: '#bbb',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '40%'
          }}
        >
          #{roomId}
        </span>
        <span style={{color: '#888', fontSize: '0.9rem'}}>
          {count} of {MAX_PARTICIPANTS}
        </span>
        <span style={{flex: 1}} />
        <CopyLinkButton compact />
        <button
          style={leaveBtn}
          onClick={() => network.leave()}
          title="Leave the room"
        >
          <Icon name="logout" size={15} />
          Leave
        </button>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          position: 'relative'
        }}
      >
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: focus ? 'hidden' : 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {notice && (
          <div
            style={{
              background: '#3a2f10',
              border: '1px solid #8a6d1a',
              color: '#f0dfa2',
              borderRadius: 8,
              padding: '0.5rem 0.75rem',
              margin: '0 auto 1rem',
              maxWidth: 1100,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span>{notice}</span>
            <button style={darkBtn} onClick={() => network.dismissNotice()}>
              OK
            </button>
          </div>
        )}

        {focus ? (
          <>
            {/* Spotlight: the chosen tile takes the available space… */}
            <div style={{flex: 1, minHeight: 0}}>
              {focus === 'self'
                ? selfTile(true)
                : focusedPeer && peerTile(focusedPeer, true)}
            </div>
            {/* …and everyone else shrinks to a filmstrip below it. */}
            {(focus !== 'self' || stripPeers.length > 0) && (
              <div
                style={{
                  overflowX: 'auto',
                  flex: '0 0 auto',
                  marginTop: '0.75rem'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    width: 'max-content',
                    margin: '0 auto'
                  }}
                >
                  {focus !== 'self' && (
                    <div style={{width: 150, flex: '0 0 auto'}}>
                      {selfTile(false)}
                    </div>
                  )}
                  {stripPeers.map(p => (
                    <div key={p.peerId} style={{width: 150, flex: '0 0 auto'}}>
                      {peerTile(p, false)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: alone
                  ? 'minmax(0, 480px)'
                  : 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
                justifyContent: 'center',
                maxWidth: 1100,
                width: '100%',
                margin: '0 auto'
              }}
            >
              {selfTile(false)}
              {participants.map(p => (
                <div key={p.peerId} style={{minWidth: 0}}>
                  {peerTile(p, false)}
                </div>
              ))}
            </div>

            {alone && (
              <div
                style={{
                  maxWidth: 480,
                  margin: '1.25rem auto 0',
                  background: '#1c1c1c',
                  border: '1px solid #333',
                  borderRadius: 10,
                  padding: '1rem',
                  textAlign: 'center'
                }}
              >
                <p style={{marginTop: 0}}>
                  You're the only one here. Share this link so others can join:
                </p>
                <p
                  style={{
                    color: '#9cc4ff',
                    wordBreak: 'break-all',
                    fontSize: '0.9rem',
                    userSelect: 'all'
                  }}
                >
                  {location.href}
                </p>
                <CopyLinkButton compact={false} />
              </div>
            )}
          </>
        )}
      </main>
      {chatOpen && (
        <ChatPanel
          items={chat}
          overlay={narrow}
          onSend={text => network.sendChat(text)}
          onClose={() => setChatOpen(false)}
        />
      )}
      </div>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '0.6rem',
          padding: '0.7rem 1rem',
          background: '#1c1c1c',
          borderTop: '1px solid #333'
        }}
      >
        <button
          style={audioMuted ? mutedIconBtn : iconBtn}
          title={
            audioMuted
              ? micAvailable
                ? 'Unmute your microphone'
                : 'Microphone unavailable — click to try again'
              : 'Mute your microphone'
          }
          aria-label={audioMuted ? 'Unmute your microphone' : 'Mute your microphone'}
          onClick={() => network.setAudioMuted(!audioMuted)}
        >
          <Icon name={audioMuted ? 'micOff' : 'mic'} />
        </button>
        <button
          style={videoMuted ? mutedIconBtn : iconBtn}
          title={
            videoMuted
              ? camAvailable
                ? 'Turn your camera on'
                : 'Camera unavailable — click to try again'
              : 'Turn your camera off'
          }
          aria-label={videoMuted ? 'Turn your camera on' : 'Turn your camera off'}
          onClick={() => network.setVideoMuted(!videoMuted)}
        >
          <Icon name={videoMuted ? 'videoOff' : 'video'} />
        </button>
        {canShareScreen && (
          <button
            style={sharing ? sharingIconBtn : iconBtn}
            title={sharing ? 'Stop sharing your screen' : 'Share your screen'}
            aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
            onClick={() =>
              sharing
                ? void network.stopScreenShare()
                : void network.startScreenShare()
            }
          >
            <Icon name="monitor" />
          </button>
        )}
        <span style={{position: 'relative', display: 'inline-flex'}}>
          <button
            style={chatOpen ? {...iconBtn, background: '#3a3a3a'} : iconBtn}
            title={chatOpen ? 'Close the chat' : 'Open the chat'}
            aria-label={chatOpen ? 'Close the chat' : 'Open the chat'}
            onClick={() => setChatOpen(!chatOpen)}
          >
            <Icon name="chat" />
          </button>
          {unread > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -5,
                right: -5,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: '#c62828',
                color: '#fff',
                fontSize: '0.7rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                pointerEvents: 'none'
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        <label
          title="Video quality for the whole room — anyone can change it, and it applies to everyone"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.9rem',
            color: '#ccc'
          }}
        >
          Quality
          <select
            value={settings.videoQuality}
            onChange={e => network.setVideoQuality(e.target.value as VideoQuality)}
            style={{
              padding: '0.4rem',
              borderRadius: 8,
              border: '1px solid #555',
              background: '#2a2a2a',
              color: '#eee',
              fontSize: '0.9rem'
            }}
          >
            {VIDEO_QUALITIES.map(q => (
              <option key={q} value={q}>
                {q[0].toUpperCase() + q.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </div>
  )
}
