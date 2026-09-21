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
 * never ordinary Raid Pile destinations. SpaceMountainLive remains eligible for
 * normal DSH shoutouts/spotlight while acting as the controlled Lounge/continuity
 * anchor for Raid Pile and Raid Train recovery.
 */
export const DSH_SYSTEM_LIVE_CHANNELS: readonly DshSystemLiveChannelV1[] = Object.freeze([
  Object.freeze({
    id: "spacemountain-live-lounge",
    twitchLogin: "spacemountainlive",
    displayName: "SpaceMountainLive",
    role: "lounge",
    spotlightEligible: true,
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
