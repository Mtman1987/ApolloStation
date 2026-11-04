export type SpaceMountainGoLiveState =
  | "live" | "already_live" | "login_required" | "local_host_active"
  | "start_failed" | "not_live" | "verification_unavailable"
  | "service_unavailable" | "in_progress";

export type SpaceMountainGoLiveResult = {
  ok: boolean;
  state: SpaceMountainGoLiveState;
  startedAt?: string | null;
  verifiedAt?: string;
};

export type SpaceMountainGoLiveInput = {
  message: string;
  channel: string;
  tenantId: string;
  username: string;
  userId: string;
  self: boolean;
  mirrored: boolean;
  botAuthored: boolean;
  broadcasterBadge: boolean;
};

export type SpaceMountainGoLiveDependencies = {
  start: () => Promise<SpaceMountainGoLiveResult>;
  reply: (message: string) => Promise<unknown>;
};

const SYSTEM_TENANT_ID = "spacemountainlive";
const SYSTEM_CHANNEL = "spacemountainlive";
const BROADCASTER_LOGIN = "spacemountainlive";

export function isSpaceMountainGoLiveCommand(message: string, channel: string): boolean {
  return channel.replace(/^#/, "").trim().toLowerCase() === SYSTEM_CHANNEL
    && /^!golive$/i.test(String(message || "").trim());
}

export function isAuthorizedSpaceMountainGoLive(input: SpaceMountainGoLiveInput): boolean {
  return input.tenantId === SYSTEM_TENANT_ID
    && input.channel.replace(/^#/, "").trim().toLowerCase() === SYSTEM_CHANNEL
    && input.username.trim().toLowerCase() === BROADCASTER_LOGIN
    && Boolean(input.userId.trim())
    && input.broadcasterBadge === true
    && input.self !== true
    && input.mirrored !== true
    && input.botAuthored !== true;
}

function resultMessage(result: SpaceMountainGoLiveResult): string {
  switch (result.state) {
    case "live": return "@spacemountainlive, Twitch confirms SpaceMountainLive is live.";
    case "already_live": return "@spacemountainlive, Twitch already confirms SpaceMountainLive is live.";
    case "login_required": return "@spacemountainlive, Restream needs you to sign in in the saved Studio browser. Twitch is not live, so I have not reported success.";
    case "local_host_active": return "@spacemountainlive, the local Companion currently owns the Restream host. I did not start a second host; use the existing local Studio session.";
    case "start_failed": return "@spacemountainlive, the saved Restream Studio could not start. Twitch is not live, so I have not reported success.";
    case "not_live": return "@spacemountainlive, Restream was asked to start, but Twitch did not confirm SpaceMountainLive live within 90 seconds. No success reported.";
    case "verification_unavailable": return "@spacemountainlive, I could not verify Twitch live status, so I will not claim the stream started.";
    case "in_progress": return "@spacemountainlive, a SpaceMountainLive start/check is already in progress. I will not trigger a second start.";
    default: return "@spacemountainlive, the Restream control service is unavailable. I could not verify the broadcast, so I will not claim it started.";
  }
}

/** Donor-compatible owner-only command. Start execution is injected by the SPMT control adapter. */
export async function handleSpaceMountainGoLiveMessage(
  input: SpaceMountainGoLiveInput,
  deps: SpaceMountainGoLiveDependencies,
): Promise<boolean> {
  if (!isSpaceMountainGoLiveCommand(input.message, input.channel)) return false;
  if (!isAuthorizedSpaceMountainGoLive(input)) return true;

  await deps.reply("@spacemountainlive, checking the saved Restream browser now. I will only confirm once Twitch reports SpaceMountainLive live.").catch(() => undefined);

  let result: SpaceMountainGoLiveResult;
  try { result = await deps.start(); }
  catch { result = { ok: false, state: "service_unavailable" }; }

  if (!(result.ok && (result.state === "live" || result.state === "already_live"))) {
    if (result.state === "live" || result.state === "already_live") result = { ...result, ok: false, state: "verification_unavailable" };
  }
  await deps.reply(resultMessage(result)).catch(() => undefined);
  return true;
}
