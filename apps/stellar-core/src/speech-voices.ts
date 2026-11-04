export type TTSProvider = 'edenai' | 'deepgram' | 'kokoro';
export type EdenAITTSProvider = 'google' | 'microsoft' | 'amazon' | 'openai';
export type TTSVoiceGender = 'MALE' | 'FEMALE';

export type TTSVoiceOption = {
  id: string;
  label: string;
  provider: TTSProvider;
  providerLabel: string;
  gender: 'Male' | 'Female';
  description: string;
  edenaiProvider?: EdenAITTSProvider;
  edenaiOption?: TTSVoiceGender;
  edenaiVoiceModel?: string;
  kokoroVoice?: string;
  deepgramModel?: string;
  livekitDescriptor?: string;
};

export const KOKORO_VOICE_OPTIONS: TTSVoiceOption[] = [
  { id: 'kokoro:af_heart', label: 'Athena · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Female', description: 'Free local neural speech; no paid voice API.', kokoroVoice: 'af_heart' },
  { id: 'kokoro:af_bella', label: 'Bella · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Female', description: 'Warm local neural voice.', kokoroVoice: 'af_bella' },
  { id: 'kokoro:af_nicole', label: 'Nicole · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Female', description: 'Clear local neural voice.', kokoroVoice: 'af_nicole' },
  { id: 'kokoro:am_michael', label: 'Apollo · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Male', description: 'Free local neural speech; no paid voice API.', kokoroVoice: 'am_michael' },
  { id: 'kokoro:am_puck', label: 'Puck · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Male', description: 'Expressive local neural voice.', kokoroVoice: 'am_puck' },
  { id: 'kokoro:am_fenrir', label: 'Fenrir · Kokoro (local)', provider: 'kokoro', providerLabel: 'Kokoro ONNX · local', gender: 'Male', description: 'Deeper local neural voice.', kokoroVoice: 'am_fenrir' },
];

export const ATHENA_CANONICAL_TTS_VOICE = 'deepgram:aura-2:athena';
export const ATHENA_DEEPGRAM_TTS_MODEL = 'aura-2-athena-en';
export const ATHENA_LIVEKIT_TTS_DESCRIPTOR = 'deepgram/aura-2:athena';

export const DEEPGRAM_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: ATHENA_CANONICAL_TTS_VOICE,
    label: 'Athena',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Female',
    description: 'Athena canonical voice across direct Deepgram and LiveKit Inference',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: ATHENA_DEEPGRAM_TTS_MODEL,
    deepgramModel: ATHENA_DEEPGRAM_TTS_MODEL,
    livekitDescriptor: ATHENA_LIVEKIT_TTS_DESCRIPTOR,
  },
  {
    id: 'deepgram:aura-2:apollo',
    label: 'Apollo',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Male',
    description: 'Comfortable, casual US English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'aura-2-apollo-en',
    deepgramModel: 'aura-2-apollo-en',
    livekitDescriptor: 'deepgram/aura-2:apollo',
  },
  {
    id: 'deepgram:aura-2:odysseus',
    label: 'Odysseus',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Male',
    description: 'Calm, professional US English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'aura-2-odysseus-en',
    deepgramModel: 'aura-2-odysseus-en',
    livekitDescriptor: 'deepgram/aura-2:odysseus',
  },
  {
    id: 'deepgram:aura-2:theia',
    label: 'Theia',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Female',
    description: 'Expressive Australian English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'aura-2-theia-en',
    deepgramModel: 'aura-2-theia-en',
    livekitDescriptor: 'deepgram/aura-2:theia',
  },
];

// Named voice catalog ported from deployed StreamWeaver 4cb3c65.
// Apollo provider acceptance is tested separately; a catalog is not a health claim.
export const EDENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'edenai:openai:nova',
    label: 'Nova',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Female',
    description: 'Bright, natural, and inexpensive',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'nova',
  },
  {
    id: 'edenai:openai:shimmer',
    label: 'Shimmer',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Female',
    description: 'Clear and expressive',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'shimmer',
  },
  {
    id: 'edenai:openai:echo',
    label: 'Echo',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Warm and rounded',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'echo',
  },
  {
    id: 'edenai:openai:fable',
    label: 'Fable',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Expressive and animated',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'fable',
  },
  {
    id: 'edenai:openai:onyx',
    label: 'Onyx',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Deep and authoritative',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'onyx',
  },
  {
    id: 'edenai:google:en-US-Wavenet-F',
    label: 'WaveNet F',
    provider: 'edenai',
    providerLabel: 'Google via Eden AI',
    gender: 'Female',
    description: 'Natural Google WaveNet voice',
    edenaiProvider: 'google',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'en-US-Wavenet-F',
  },
  {
    id: 'edenai:google:en-US-Wavenet-D',
    label: 'WaveNet D',
    provider: 'edenai',
    providerLabel: 'Google via Eden AI',
    gender: 'Male',
    description: 'Natural Google WaveNet voice',
    edenaiProvider: 'google',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'en-US-Wavenet-D',
  },
  {
    id: 'edenai:microsoft:en-US-JennyNeural',
    label: 'Jenny Neural',
    provider: 'edenai',
    providerLabel: 'Microsoft via Eden AI',
    gender: 'Female',
    description: 'Conversational Microsoft neural voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'en-US-JennyNeural',
  },
  {
    id: 'edenai:microsoft:en-US-GuyNeural',
    label: 'Guy Neural',
    provider: 'edenai',
    providerLabel: 'Microsoft via Eden AI',
    gender: 'Male',
    description: 'Conversational Microsoft neural voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'en-US-GuyNeural',
  },
  {
    id: 'edenai:amazon:Ruth',
    label: 'Ruth',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Female',
    description: 'Natural Amazon generative/neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'Ruth',
  },
  {
    id: 'edenai:amazon:Joanna',
    label: 'Joanna',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Female',
    description: 'Polished Amazon neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'Joanna',
  },
  {
    id: 'edenai:amazon:Matthew',
    label: 'Matthew',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Male',
    description: 'Natural Amazon generative/neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'Matthew',
  },
];

export const TTS_VOICE_OPTIONS = [...KOKORO_VOICE_OPTIONS];
export const DEFAULT_TTS_PROVIDER: TTSProvider = 'kokoro';
export const DEFAULT_TTS_VOICE = 'kokoro:af_heart';

const LEGACY_VOICE_MAP: Record<string, string> = {
  'openai:nova': 'kokoro:af_heart',
  'openai:shimmer': 'kokoro:af_bella',
  'openai:alloy': 'kokoro:af_heart',
  'openai:echo': 'kokoro:am_michael',
  'openai:fable': 'kokoro:am_puck',
  'openai:onyx': 'kokoro:am_fenrir',
  nova: 'kokoro:af_heart',
  shimmer: 'kokoro:af_bella',
  alloy: 'kokoro:af_heart',
  echo: 'kokoro:am_michael',
  fable: 'kokoro:am_puck',
  onyx: 'kokoro:am_fenrir',
  'edenai:google:female': 'kokoro:af_heart',
  'edenai:google:male': 'kokoro:am_michael',
  'edenai:microsoft:female': 'kokoro:af_bella',
  'edenai:microsoft:male': 'kokoro:am_michael',
  'edenai:amazon:female': 'kokoro:af_nicole',
  'edenai:amazon:male': 'kokoro:am_fenrir',
  athena: 'kokoro:af_heart',
  'deepgram:athena': 'kokoro:af_heart',
  'deepgram/aura-2:athena': 'kokoro:af_heart',
  'aura-2-athena-en': 'kokoro:af_heart',
  apollo: 'kokoro:am_michael',
  odysseus: 'kokoro:am_fenrir',
  theia: 'kokoro:af_bella',
  'deepgram:aura-2:athena': 'kokoro:af_heart',
  'deepgram:aura-2:apollo': 'kokoro:am_michael',
  'deepgram:aura-2:odysseus': 'kokoro:am_fenrir',
  'deepgram:aura-2:theia': 'kokoro:af_bella',
  'edenai:openai:nova': 'kokoro:af_heart',
  'edenai:openai:shimmer': 'kokoro:af_bella',
  'edenai:openai:echo': 'kokoro:am_michael',
  'edenai:openai:fable': 'kokoro:am_puck',
  'edenai:openai:onyx': 'kokoro:am_fenrir',
  'edenai:google:en-US-Wavenet-F': 'kokoro:af_heart',
  'edenai:google:en-US-Wavenet-D': 'kokoro:am_michael',
  'edenai:microsoft:en-US-JennyNeural': 'kokoro:af_bella',
  'edenai:microsoft:en-US-GuyNeural': 'kokoro:am_michael',
  'edenai:amazon:Ruth': 'kokoro:af_nicole',
  'edenai:amazon:Joanna': 'kokoro:af_heart',
  'edenai:amazon:Matthew': 'kokoro:am_fenrir',
};;

export function normalizeTtsProvider(_provider: unknown): TTSProvider { return DEFAULT_TTS_PROVIDER; }

export function isSupportedTtsVoice(voice: string | undefined | null): boolean {
  const value = String(voice ?? "").trim().toLowerCase();
  return TTS_VOICE_OPTIONS.some(option => option.id.toLowerCase() === value) || Object.prototype.hasOwnProperty.call(LEGACY_VOICE_MAP, value);
}

export function normalizeTtsVoice(voice: string | undefined | null, _provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) return DEFAULT_TTS_VOICE;
  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((option) => option.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;

  const legacy = LEGACY_VOICE_MAP[trimmed.toLowerCase()];
  if (legacy) return legacy;

  const lower = trimmed.toLowerCase();
  if (lower.includes('female')) return DEFAULT_TTS_VOICE;
  if (lower.includes('male') || ['charon', 'fenrir', 'puck', 'orus', 'algieba'].includes(lower)) {
    return 'kokoro:am_michael';
  }
  return DEFAULT_TTS_VOICE;
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  return TTS_VOICE_OPTIONS.find((option) => option.id === normalized) || TTS_VOICE_OPTIONS[0]!;
}

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return getTtsVoiceOption(voice, fallback)?.provider || fallback;
}

export function getFallbackVoiceForProvider(_provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice);
  return selected.gender === 'Male' ? 'kokoro:am_michael' : DEFAULT_TTS_VOICE;
}

// Backward-compatible exports used by older workflow/config callers.
export function normalizePiperVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeEdenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeOpenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
