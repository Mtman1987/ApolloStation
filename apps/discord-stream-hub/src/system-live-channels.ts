export interface DshSystemLiveChannelV1 {
  id: string;
  twitchLogin: string;
  displayName: string;
  role: "lounge";
  spotlightEligible: boolean;
  raidPileTargetEligible: false;
  raidTrainFallbackEligible: boolean;
  virtualHost: "stella";
}

/**
 * System-owned community channels are real public community surfaces, but they are
 * never ordinary Raid Pile destinations. SpaceMountainLive is a controlled
 * Lounge/continuity anchor, not a normal Community Spotlight candidate; it remains
 * available for Raid Train fallback and continuity recovery.
 */
export const DSH_SYSTEM_LIVE_CHANNELS: readonly DshSystemLiveChannelV1[] = Object.freeze([
  Object.freeze({
    id: "spacemountain-live-lounge",
    twitchLogin: "spacemountainlive",
    displayName: "SpaceMountainLive",
    role: "lounge",
    spotlightEligible: false,
    raidPileTargetEligible: false,
    raidTrainFallbackEligible: true,
    virtualHost: "stella",
  }),
]);

export function dshSystemLiveChannelByLogin(twitchLogin: string) {
  const normalized = twitchLogin.trim().toLowerCase();
  return DSH_SYSTEM_LIVE_CHANNELS.find((channel) => channel.twitchLogin === normalized);
}

export function isDshSystemOwnedTwitchLogin(twitchLogin: string) {
  return Boolean(dshSystemLiveChannelByLogin(twitchLogin));
}
