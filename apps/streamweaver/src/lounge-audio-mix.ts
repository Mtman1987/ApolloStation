import { loungeDataPath, readLoungeJson, writeLoungeJson } from './lounge-store.js';

export type LoungeMixOutput = 'stella' | 'spotlight' | 'media' | 'all';
export type LoungeAudioMix = {
  levels: Record<LoungeMixOutput, number>;
  selected: LoungeMixOutput;
  updatedAt: number;
  unmutePulseAt: number;
};

const mixPath = () => loungeDataPath('spacemountainlive', 'lounge-audio-mix.json');
const DEFAULTS: LoungeAudioMix = {
  levels: { stella: 100, spotlight: 58, media: 85, all: 100 },
  selected: 'media',
  updatedAt: 0,
  unmutePulseAt: 0,
};
const OUTPUTS = new Set<LoungeMixOutput>(['stella', 'spotlight', 'media', 'all']);

function normalize(input: Partial<LoungeAudioMix> | null): LoungeAudioMix {
  const volume = (output: LoungeMixOutput) => {
    const value = Number(input?.levels?.[output]);
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : DEFAULTS.levels[output];
  };
  return {
    levels: { stella: volume('stella'), spotlight: volume('spotlight'), media: volume('media'), all: volume('all') },
    selected: input?.selected && OUTPUTS.has(input.selected) ? input.selected : DEFAULTS.selected,
    updatedAt: Number(input?.updatedAt) || 0,
    unmutePulseAt: Number(input?.unmutePulseAt) || 0,
  };
}

export async function getLoungeAudioMix(): Promise<LoungeAudioMix> {
  return normalize(readLoungeJson<Partial<LoungeAudioMix>>(mixPath(), DEFAULTS));
}

export async function selectLoungeMixOutput(output: LoungeMixOutput): Promise<LoungeAudioMix> {
  if (!OUTPUTS.has(output)) throw new Error('Choose Stella, Spotlight, media, or all.');
  const state = await getLoungeAudioMix();
  state.selected = output;
  state.updatedAt = Date.now();
  writeLoungeJson(mixPath(), state);
  return state;
}

export async function setLoungeMixVolume(output: LoungeMixOutput | null, value: number): Promise<LoungeAudioMix> {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Volume must be 0-100.');
  const state = await getLoungeAudioMix();
  const target = output || state.selected;
  if (!OUTPUTS.has(target)) throw new Error('Choose Stella, Spotlight, or media.');
  state.levels[target] = value;
  state.selected = target;
  state.updatedAt = Date.now();
  writeLoungeJson(mixPath(), state);
  return state;
}


export async function pulseLoungePlaybackUnmute(): Promise<LoungeAudioMix> {
  const state = await getLoungeAudioMix();
  const now = Date.now();
  if (now - state.unmutePulseAt < 3_000) return state;
  state.unmutePulseAt = now;
  state.updatedAt = now;
  writeLoungeJson(mixPath(), state);
  return state;
}

/** Effective 0..1 level for a Lounge broadcast output (ported from the useLoungeBroadcastVolume React hook). */
export function loungeBroadcastLevel(mix: Pick<LoungeAudioMix, "levels">, output: "stella" | "spotlight" | "media", source: { volume: number; muted: boolean } = { volume: 1, muted: false }): number {
  const value = mix.levels[output] ?? 100, master = mix.levels.all ?? 100;
  return (value / 100) * (master / 100) * (source.muted ? 0 : Math.min(1, Math.max(0, source.volume)));
}
