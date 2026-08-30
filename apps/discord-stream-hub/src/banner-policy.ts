export const DSH_BANNER_VERSION = "2026-08-28-role-aware-1";
export const DSH_BANNER_WIDTH = 960;
export const DSH_BANNER_HEIGHT = 100;
export const DSH_BANNER_FPS = 10;
export const DSH_BANNER_DURATION_SECONDS = 20;

export type DshBannerVariantV1 = "commander" | "crew" | "mountaineer";
export interface DshBannerIdentityV1 {
  twitchLogin: string;
  group?: string | null;
  discordUserId?: string | null;
  twitchUserId?: string | null;
  adminDiscordUserId?: string | null;
  adminTwitchUserId?: string | null;
}

export const DSH_BANNER_VARIANTS = Object.freeze({
  commander: { labelHtml: "COMMANDER MT", messageHtml: "THE MOUNTAIN IS LIVE &bull; ALL SYSTEMS GO", primaryColor: "#ffd24a", secondaryColor: "#fff0a6", showUsername: false },
  crew: { labelHtml: "SPACEMOUNTAIN CREW", messageHtml: "CREW SIGNAL LOCKED &bull; LIVE NOW", primaryColor: "#00b7ff", secondaryColor: "#79dcff", showUsername: true },
  mountaineer: { labelHtml: 'MOUNTAINEER <span class="heart">&hearts;</span>', messageHtml: "SIGNAL RECEIVED &bull; LIVE NOW", primaryColor: "#39e58c", secondaryColor: "#a3f7c7", showUsername: true },
} satisfies Record<DshBannerVariantV1, { labelHtml: string; messageHtml: string; primaryColor: string; secondaryColor: string; showUsername: boolean }>);

const COMMANDER_TWITCH_LOGINS = new Set(["mtman1987", "spacemountainlive"]);

export function resolveDshBannerVariant(identity: DshBannerIdentityV1): DshBannerVariantV1 {
  const twitchLogin = normalized(identity.twitchLogin);
  const discordUserId = normalized(identity.discordUserId);
  const twitchUserId = normalized(identity.twitchUserId);
  const adminDiscordUserId = normalized(identity.adminDiscordUserId);
  const adminTwitchUserId = normalized(identity.adminTwitchUserId);
  if (COMMANDER_TWITCH_LOGINS.has(twitchLogin)
    || Boolean(discordUserId && adminDiscordUserId && discordUserId === adminDiscordUserId)
    || Boolean(twitchUserId && adminTwitchUserId && twitchUserId === adminTwitchUserId)) return "commander";
  return normalized(identity.group) === "crew" ? "crew" : "mountaineer";
}

export function normalizeDshBannerVariant(value: unknown): DshBannerVariantV1 {
  const variant = normalized(value);
  return variant === "commander" || variant === "crew" ? variant : "mountaineer";
}

export function dshBannerStorageKey(twitchLogin: string): string {
  return normalized(twitchLogin).replace(/[^a-z0-9_-]/g, "").slice(0, 64);
}

export function buildDshBannerHtml(twitchLogin: string, requestedVariant: DshBannerVariantV1): string {
  const variant = normalizeDshBannerVariant(requestedVariant);
  const appearance = DSH_BANNER_VARIANTS[variant];
  const username = escapeHtml(twitchLogin.toUpperCase());
  const identity = appearance.showUsername ? ` <span class="separator">&bull;</span> <span class="username">${username}</span>` : "";
  const message = `${appearance.labelHtml}${identity} <span class="separator">&bull;</span> ${appearance.messageHtml}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden}body{display:flex;align-items:center;color:${appearance.primaryColor};background:radial-gradient(circle at 4% 24%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 13% 72%,#b9d7ff 0 1px,transparent 1.5px),radial-gradient(circle at 24% 38%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 37% 82%,#b9d7ff 0 1px,transparent 1.5px),radial-gradient(circle at 49% 18%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 61% 65%,#b9d7ff 0 1px,transparent 1.5px),radial-gradient(circle at 74% 31%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 88% 76%,#b9d7ff 0 1px,transparent 1.5px),linear-gradient(135deg,#070b1a 0%,#10182f 55%,#070b1a 100%)}
.banner-shell{position:relative;width:100%;overflow:hidden;border-top:1px solid ${appearance.primaryColor};border-bottom:1px solid ${appearance.primaryColor};background:#0408159e;box-shadow:inset 0 0 18px #000a}.ticker-track{display:flex;width:max-content;align-items:center;animation:banner-scroll 20s linear infinite;will-change:transform}.message{flex:none;padding:13px 88px;white-space:nowrap;font-family:"Arial Black","Liberation Sans",Arial,sans-serif;font-size:40px;font-weight:900;letter-spacing:1.5px;line-height:1.2;color:${appearance.primaryColor};text-shadow:0 0 5px ${appearance.primaryColor},2px 2px 2px #000}.username{color:${appearance.secondaryColor}}.heart{color:#4aa8ff}.separator{color:#dce8ff}@keyframes banner-scroll{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}
</style></head><body><div class="banner-shell"><div class="ticker-track"><div class="message">${message}</div><div class="message">${message}</div></div></div></body></html>`;
}

export function dshBannerFrameTimesMs(): number[] {
  return Array.from({ length: DSH_BANNER_FPS * DSH_BANNER_DURATION_SECONDS }, (_, index) => (index * 1_000) / DSH_BANNER_FPS);
}

export const DSH_BANNER_GIF_PALETTE = Object.freeze({ maxColors: 96, statsMode: "diff", dither: "bayer", bayerScale: 5, diffMode: "rectangle" });

function normalized(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
