# commonroom

Serverless group video calls in the browser.

**Live page:** https://concept-collection.github.io/commonroom/

Enter your name and a room name — any string you like (no spaces) — and you're
in. Share the room URL with anyone; everyone who joins the same room is
connected to everyone else over a full WebRTC mesh, up to 8 people. You enter
with your microphone and camera **off** and turn them on when you're ready.
Click any tile to enlarge it (the rest shrink to a filmstrip); click it again
or press Esc to return to the gallery.

The room has shared settings that anyone can change and that apply to
everyone — currently the video quality (low / medium / high / auto, medium by
default). You can also share your screen in place of your camera, and there's
a room chat (with join/left notices and clickable links) that is as ephemeral
as the call itself: you only see what's said while you're in the room, and
nothing is stored anywhere.

## How it works

There is no backend and no room registry. The techniques come from the sibling
projects [commonview](https://github.com/concept-collection/commonview) (the
auto-connecting mesh) and
[commoncall](https://github.com/concept-collection/commoncall) (WebRTC media,
quality presets, screen share):

- **Identity** — each browser generates a secp256k1 (BIP340 schnorr) keypair,
  persisted in localStorage. The x-only public key is the peer ID, and every
  nostr event is signed with it, so peers can't be impersonated.
- **Rooms** — the room name is hashed into a nostr topic; knowing the name IS
  the key. Everyone in the room announces `{peerId, name}` on that topic every
  few seconds via ephemeral events on public relays; entries expire when
  announcements stop.
- **Mesh** — being in the room is the consent: every participant automatically
  brings up a WebRTC connection with every other participant (deterministic
  initiator = smaller peer ID; offer/answer/ICE ride per-peer nostr topics).
  Audio/video flows directly between browsers, with public STUN servers and a
  free TURN relay as fallback. Rooms are softly capped at 8 — peers already at
  capacity turn newcomers away.
- **Muted by default** — camera/mic are requested on entry so unmuting is
  instant, but tracks start disabled. If you deny access you still join,
  sending silent/black placeholder tracks; unmuting retries the device and
  upgrades the track in place (`replaceTrack`, no renegotiation).
- **Shared settings** — one settings object for the whole room, synced over
  the per-peer control data channels with per-key last-writer-wins (revision
  counters; ties resolved by the setter's peer ID). The video-quality presets
  map to `RTCRtpSender.setParameters` caps that each participant applies to
  its own outgoing senders.

## Development

```sh
npm install
npm run dev
```

Identity is per-browser-profile (localStorage), so two tabs in the same
profile are the *same* peer — to try a room with multiple participants, use a
second browser or a private window.

`npm run build` type-checks and bundles to `dist/`. Pushes to `main` deploy to
GitHub Pages via `.github/workflows/deploy.yml`.
