// Shared room settings. Everyone in the room sees and controls ONE settings
// object; anyone can change any setting and it applies to the whole room.
// Changes sync over the per-peer control data channels with per-key
// last-writer-wins (see network.ts).
//
// To add a future setting: extend RoomSettings, DEFAULT_SETTINGS, and
// SETTING_VALIDATORS, then handle its side effect in Network.settingChanged.

export const VIDEO_QUALITIES = ['low', 'medium', 'high', 'auto'] as const
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]

export interface RoomSettings {
  videoQuality: VideoQuality
}

export const DEFAULT_SETTINGS: RoomSettings = {videoQuality: 'medium'}

/** Encoder caps for each preset, applied by EACH participant to every one of
 *  its outgoing video senders (the setting is room-wide and symmetric).
 *  'auto' clears all caps and leaves adaptation entirely to the browser's
 *  congestion control; the others are proactive ceilings — important in a
 *  mesh, where upload cost multiplies by the number of other participants. */
export const QUALITY_PARAMS: Record<
  VideoQuality,
  {maxBitrate?: number; scaleResolutionDownBy?: number; maxFramerate?: number}
> = {
  auto: {},
  high: {maxBitrate: 2_500_000, maxFramerate: 30},
  medium: {maxBitrate: 800_000, scaleResolutionDownBy: 2, maxFramerate: 24},
  low: {maxBitrate: 200_000, scaleResolutionDownBy: 4, maxFramerate: 15}
}

/** Settings arrive over the network, so every value is validated before use. */
export const SETTING_VALIDATORS: {
  [K in keyof RoomSettings]: (v: unknown) => v is RoomSettings[K]
} = {
  videoQuality: (v): v is VideoQuality =>
    (VIDEO_QUALITIES as readonly unknown[]).includes(v)
}
