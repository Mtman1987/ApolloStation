/** BRB fallback media for the Lounge (ported from StreamWeaver services/brb-clips getBRBMediaPlaylist). */
export type LoungeBrbMediaV1 = {
  clips: { clipUrl: string; thumbnailUrl: string; user: string; duration: number; videoId?: string; vodOffset?: number }[];
  gifs: { url: string; user: string }[];
};
export interface LoungeBrbClipV1 { url: string; thumbnail_url?: string; broadcaster_name?: string; duration?: number; video_id?: string; vod_offset?: number | null; }
export interface LoungeBrbSourcesV1 {
  /** Current chatters' logins in the Lounge channel. */
  chatters(): Promise<string[]>;
  /** Live community creators (Chat Tag live members / DSH community spotlight). */
  communityLogins(): Promise<string[]>;
  clipsFor(login: string): Promise<LoungeBrbClipV1[]>;
  /** Stored shoutout GIFs (DSH media). Empty users = any. */
  gifs(users: string[]): Promise<LoungeBrbMediaV1["gifs"]>;
  /** Bots / excluded users / the broadcaster. */
  excluded?(login: string): boolean;
  random?(): number;
}

const LOGIN = /^[a-z0-9_]{3,25}$/;

export async function buildLoungeBrbPlaylist(broadcaster: string, sources: LoungeBrbSourcesV1): Promise<LoungeBrbMediaV1> {
  const random = sources.random ?? Math.random, owner = broadcaster.toLowerCase();
  const eligible = (logins: string[]) => [...new Set(logins.map((l) => String(l || "").toLowerCase()))].filter((l) => LOGIN.test(l) && l !== owner && !sources.excluded?.(l));
  const safe = async <T>(fn: () => Promise<T>, fallback: T) => { try { return await fn(); } catch { return fallback; } };
  const chatTargets = eligible(await safe(() => sources.chatters(), [])).slice(0, 12);
  const communityTargets = eligible(await safe(() => sources.communityLogins(), [])).filter((u) => !chatTargets.includes(u)).slice(0, 12);
  const clips: LoungeBrbMediaV1["clips"] = [];
  const collect = async (targets: string[]) => {
    for (const user of targets) {
      const list = await safe(() => sources.clipsFor(user), []);
      const clip = list[Math.floor(random() * list.length)];
      if (!clip?.url) continue;
      clips.push({ clipUrl: clip.url.replace("twitch.tv/", "twitch.tv/embed?clip="), thumbnailUrl: clip.thumbnail_url || "", user: clip.broadcaster_name || user, duration: Math.floor((clip.duration || 30) * 1000) + 700, videoId: String(clip.video_id || ""), ...(typeof clip.vod_offset === "number" && clip.vod_offset >= 0 ? { vodOffset: clip.vod_offset } : {}) });
    }
  };
  await collect(chatTargets);
  if (!clips.length) await collect(communityTargets);
  let gifs = (await safe(() => sources.gifs([...chatTargets, ...communityTargets]), [])).filter((g) => typeof g.url === "string" && g.url.startsWith("https://")).slice(0, 100);
  if (!gifs.length) gifs = (await safe(() => sources.gifs([]), [])).filter((g) => typeof g.url === "string" && g.url.startsWith("https://")).slice(0, 100);
  return { clips, gifs };
}
