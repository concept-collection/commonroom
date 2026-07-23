# CLAUDE.md

Tips for future agents working in this repo. It combines the p2p techniques of
the sibling projects `commonview` (auto-connecting mesh) and `commoncall`
(WebRTC media, settings, screen share) — read those first; this file only
covers what is different here.

## Architecture

```
src/p2p/
  identity.ts  schnorr keypair; pubkey hex = peer ID     — ported from commoncall
  nostr.ts     minimal relay client + topic scheme        — ported (roomTopic takes a room ID)
  peer.ts      WebRTC wrapper: media + control channel    — ported (replaceTrack generalized to audio|video)
  settings.ts  shared ROOM settings, quality presets      — default quality is 'medium', not 'auto'
  network.ts   the heart: rooms, presence, mesh, media, settings sync
src/App.tsx    landing form (light) + in-room view (dark), video grid with
               click-to-spotlight (gallery ↔ one big tile + filmstrip; Esc or
               click again to return), control bar, chat panel (side panel on
               wide screens, overlay ≤700px, unread badge)
```

## Key design decisions

- **Rooms, no registry.** The room ID is any string (whitespace stripped,
  exact otherwise, case-sensitive); `roomTopic` hashes it into the nostr
  presence topic. The URL hash holds the room (`#<encoded-room>`) so the
  address bar is the invite link.
- **Auto-mesh, no consent handshake.** Unlike commoncall, entering the room IS
  the consent: on every presence announcement, `maybeConnect` brings up a
  `Peer` (initiator = smaller peer ID, commonview's stalled-connection retry
  at 15 s). All of commoncall's call-request/accept machinery is gone.
- **Muted by default; placeholder tracks.** getUserMedia runs at entry but
  tracks start `enabled = false`. Every participant ALWAYS carries exactly one
  audio + one video track (denied/missing devices get a silent
  AudioContext-destination track / black canvas-capture track), so
  offer/answer stays symmetric and the one-offer, no-renegotiation design
  holds. Unmuting without a real device retries getUserMedia and upgrades the
  placeholder via `replaceTrack` on every connection. getUserMedia failures
  surface a cause-specific notice (`mediaErrorMessage`: permission vs
  not-found vs device-busy, error name included) both at join and on retry —
  on Linux, a camera held by another browser fails with NotReadableError,
  which is NOT a permissions problem. The combined audio+video request fails
  as a whole in that case, so `acquireMedia` retries each kind separately.
- **Soft cap of 8** (`MAX_PARTICIPANTS`). A peer already holding 7 connections
  answers an unknown peer's announcement/offer with `{t:'room-full'}` on the
  newcomer's topic instead of connecting; a newcomer with zero connections
  that receives room-full tears down and shows a notice. Two simultaneous
  joiners racing for the last slot can briefly exceed the cap — accepted.
- **Settings are room-wide, multi-party LWW.** One entry per key in
  `settingsMeta` (`{rev, by}`); changes broadcast `{t:'set', key, value, rev,
  by}` to all peers (complete graph — no relaying), late joiners get every
  entry inside each peer's `hello`, and a same-rev tie is won by the SMALLER
  setter ID. Default quality is `medium` — so quality caps are applied to each
  sender on connect (`applyVideoParamsTo`, with one delayed retry because
  encodings may not exist right at 'connected'), not only on change.
- **Mute is per-participant, NOT a shared setting** — same as commoncall: own
  flags, `{t:'mute'}` notices, `track.enabled` toggling, and the notice
  carries the EFFECTIVE outgoing video state (screen share overrides camera
  mute). Remote participants are assumed muted until told otherwise.
- **Screen share = track swap on every connection.** `getDisplayMedia` +
  `replaceTrack` per peer; a peer that joins mid-share gets the screen track
  from `outgoingStream()`. Same-kind replacement avoids renegotiation — never
  addTrack mid-connection.
- **Chat is ephemeral and never relayed.** `{t:'chat', text}` broadcasts on
  the control channels; every message arrives directly from its author over a
  channel established via signed signaling, so authorship needs no extra
  crypto. There is deliberately NO history replay for late joiners — replay
  would mean peers relaying others' messages, which a malicious peer could
  fabricate; adding history requires signing each message. Log capped at 500,
  messages at 2000 chars. Join/left lines are derived locally: hello carries a
  self-reported `joinedAt`, and a peer whose join predates ours gets no
  "joined" line on first sight (they were already here) — but `chatSeen`
  ensures a blip-reconnect logs "joined" to match its "left". Links: only
  http(s) URLs matched by `withLinks` become anchors (target=_blank,
  rel=noopener noreferrer); never linkify other schemes.
- **Cleanup is join-generation-guarded.** `joinSeq` is bumped on every
  join/leave; async work (getUserMedia, topic hashing, display capture)
  re-checks it after each await. `leave()` unsubscribes topics, stops all
  tracks, closes the AudioContext, and resets settings to defaults.

## Testing

`npm run dev`, then open the room in two browsers (identity is
per-browser-profile via localStorage, so two tabs in one profile are the SAME
peer — use a private window or second browser). `npm run build` type-checks
(`tsc -b`) and bundles. Let the user test multi-party media in real browsers;
don't try to automate camera/mic flows.
