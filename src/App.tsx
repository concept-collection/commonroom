import {useEffect, useRef, useState} from 'react'
import {MAX_PARTICIPANTS, type ParticipantInfo} from './p2p/network'
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
  mirror
}: {
  stream: MediaStream | null
  muted: boolean
  mirror: boolean
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
        objectFit: 'cover',
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
  connecting
}: {
  stream: MediaStream | null
  label: string
  isSelf: boolean
  mirror: boolean
  audioMuted: boolean
  videoMuted: boolean
  connecting: boolean
}) {
  return (
    <div
      style={{
        position: 'relative',
        background: '#000',
        borderRadius: 10,
        overflow: 'hidden',
        aspectRatio: '4 / 3',
        border: isSelf ? '1px solid #444' : '1px solid #222'
      }}
    >
      {/* The video element stays mounted even when their camera is off so the
          audio keeps playing; the placeholder just covers it. */}
      <VideoView stream={stream} muted={isSelf} mirror={mirror} />
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

function ParticipantTile({p}: {p: ParticipantInfo}) {
  return (
    <Tile
      stream={p.stream}
      label={p.name}
      isSelf={false}
      mirror={false}
      audioMuted={p.audioMuted}
      videoMuted={p.videoMuted}
      connecting={!p.connected}
    />
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
    notice
  } = snapshot

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

      <main style={{flex: 1, overflowY: 'auto', padding: '1rem'}}>
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

        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: alone
              ? 'minmax(0, 480px)'
              : 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
            justifyContent: 'center',
            maxWidth: 1100,
            margin: '0 auto'
          }}
        >
          <Tile
            stream={screenStream ?? localStream}
            label={`${name} (you)`}
            isSelf
            mirror={!sharing}
            audioMuted={audioMuted}
            videoMuted={videoMuted && !sharing}
            connecting={false}
          />
          {participants.map(p => (
            <ParticipantTile key={p.peerId} p={p} />
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
      </main>

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
