import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Pluggable JSON persistence for the Lounge layout (ported from StreamWeaver storage). */
export interface LoungeMediaLayoutStorage {
  read(): Promise<unknown | null>;
  write(value: unknown): Promise<void>;
}

export function createFileLoungeMediaLayoutStorage(filePath = join(process.env.STREAMWEAVER_DATA_DIR || 'data', 'spacemountainlive', 'lounge-media-layout.json')): LoungeMediaLayoutStorage {
  return {
    async read() { try { return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null; } catch { return null; } },
    async write(value) { mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, JSON.stringify(value, null, 2)); },
  };
}

let storage: LoungeMediaLayoutStorage = createFileLoungeMediaLayoutStorage();
export function setLoungeMediaLayoutStorage(next: LoungeMediaLayoutStorage) { storage = next; }

export type LoungeMediaLayoutMode = 'stream' | 'media';

type LoungeMediaLayoutState = {
  mode: LoungeMediaLayoutMode;
  locked: boolean;
  updatedAt: number;
  updatedBy?: string | undefined;
  votes: { stream: Record<string, number>; media: Record<string, number> };
};

const VOTE_WINDOW_MS = 5 * 60 * 1000;
export const LOUNGE_MEDIA_BUMP_VOTES = Math.max(2, Number(process.env.LOUNGE_MEDIA_BUMP_VOTES) || 3);

function emptyState(): LoungeMediaLayoutState {
  return { mode: 'stream', locked: false, updatedAt: Date.now(), votes: { stream: {}, media: {} } };
}

function normalizeState(input: Partial<LoungeMediaLayoutState> | null | undefined): LoungeMediaLayoutState {
  const now = Date.now();
  const prune = (votes: Record<string, number> | undefined) => Object.fromEntries(
    Object.entries(votes || {}).filter(([, timestamp]) => now - Number(timestamp) <= VOTE_WINDOW_MS),
  );
  return {
    mode: input?.mode === 'media' ? 'media' : 'stream',
    locked: input?.locked === true,
    updatedAt: Number(input?.updatedAt) || now,
    updatedBy: String(input?.updatedBy || '') || undefined,
    votes: { stream: prune(input?.votes?.stream), media: prune(input?.votes?.media) },
  };
}

async function readState(): Promise<LoungeMediaLayoutState> {
  return normalizeState(((await storage.read()) as Partial<LoungeMediaLayoutState> | null) ?? emptyState());
}

async function saveState(state: LoungeMediaLayoutState): Promise<LoungeMediaLayoutState> {
  await storage.write(state);
  return state;
}

export async function getLoungeMediaLayout() {
  const state = await readState();
  return {
    mode: state.mode,
    locked: state.locked,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy || null,
    votes: {
      stream: Object.keys(state.votes.stream).length,
      media: Object.keys(state.votes.media).length,
      required: LOUNGE_MEDIA_BUMP_VOTES,
    },
  };
}

export async function voteLoungeMediaLayout(target: LoungeMediaLayoutMode, voter: string) {
  const state = await readState();
  const voterKey = String(voter || '').trim().toLowerCase();
  if (!voterKey) throw new Error('A Twitch voter identity is required.');
  if (state.locked) return { ...(await getLoungeMediaLayout()), changed: false, accepted: false };

  const other = target === 'media' ? 'stream' : 'media';
  delete state.votes[other][voterKey];
  state.votes[target][voterKey] = Date.now();
  const count = Object.keys(state.votes[target]).length;
  let changed = false;
  if (count >= LOUNGE_MEDIA_BUMP_VOTES) {
    state.mode = target;
    state.updatedAt = Date.now();
    state.updatedBy = `vote:${voterKey}`;
    state.votes = { stream: {}, media: {} };
    changed = true;
  }
  await saveState(state);
  return { ...(await getLoungeMediaLayout()), changed, accepted: true, count };
}

export async function overrideLoungeMediaLayout(target: LoungeMediaLayoutMode | 'auto', actor: string) {
  const state = await readState();
  if (target === 'auto') {
    state.locked = false;
    state.votes = { stream: {}, media: {} };
  } else {
    state.mode = target;
    state.locked = true;
    state.votes = { stream: {}, media: {} };
  }
  state.updatedAt = Date.now();
  state.updatedBy = actor;
  return saveState(state).then(() => getLoungeMediaLayout());
}

export async function setLoungeMediaLayout(target: LoungeMediaLayoutMode | 'toggle', actor: string) {
  const state = await readState();
  state.mode = target === 'toggle' ? (state.mode === 'media' ? 'stream' : 'media') : target;
  state.locked = false;
  state.votes = { stream: {}, media: {} };
  state.updatedAt = Date.now();
  state.updatedBy = actor;
  await saveState(state);
  return getLoungeMediaLayout();
}
