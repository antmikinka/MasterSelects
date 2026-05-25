export type AudioEffectParamValue = number | boolean | string;
export type AudioEffectId =
  | 'audio-volume'
  | 'audio-eq'
  | 'audio-high-pass'
  | 'audio-low-pass'
  | 'audio-compressor'
  | 'audio-de-esser'
  | 'audio-limiter'
  | 'audio-noise-gate'
  | 'audio-delay'
  | 'audio-reverb';

export interface AudioEffectParamDescriptor {
  name: string;
  default: AudioEffectParamValue;
}

export interface AudioEffectDescriptor {
  id: AudioEffectId;
  name: string;
  category?: 'gain' | 'eq' | 'filter' | 'dynamics' | 'time' | 'utility' | 'repair' | 'spectral';
  automation?: 'none' | 'clip' | 'track' | 'sample-accurate';
  latencySamples?: number;
  tailSeconds?: number;
  paramNames: readonly string[];
  params: Readonly<Record<string, AudioEffectParamDescriptor>>;
}

export const AUDIO_EQ_BAND_PARAMS = Object.freeze([
  'band31',
  'band62',
  'band125',
  'band250',
  'band500',
  'band1k',
  'band2k',
  'band4k',
  'band8k',
  'band16k',
]);

function createParamDescriptors(
  defaults: Record<string, AudioEffectParamValue>
): Readonly<Record<string, AudioEffectParamDescriptor>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(defaults).map(([name, defaultValue]) => [
        name,
        Object.freeze({ name, default: defaultValue }),
      ])
    )
  );
}

const AUDIO_VOLUME_DEFAULTS = {
  volume: 1,
} as const;

const AUDIO_EQ_DEFAULTS: Record<string, 0> = Object.fromEntries(
  AUDIO_EQ_BAND_PARAMS.map(paramName => [paramName, 0])
) as Record<string, 0>;

const AUDIO_HIGH_PASS_DEFAULTS = {
  frequencyHz: 20,
  q: 0.707,
} as const;

const AUDIO_LOW_PASS_DEFAULTS = {
  frequencyHz: 22000,
  q: 0.707,
} as const;

const AUDIO_COMPRESSOR_DEFAULTS = {
  thresholdDb: 0,
  ratio: 1,
  kneeDb: 0,
  attackMs: 10,
  releaseMs: 120,
  makeupGainDb: 0,
} as const;

const AUDIO_DE_ESSER_DEFAULTS = {
  frequencyHz: 6500,
  thresholdDb: 0,
  ratio: 1,
  kneeDb: 6,
  attackMs: 1,
  releaseMs: 80,
  makeupGainDb: 0,
} as const;

const AUDIO_LIMITER_DEFAULTS = {
  ceilingDb: 0,
  inputGainDb: 0,
} as const;

const AUDIO_NOISE_GATE_DEFAULTS = {
  thresholdDb: -120,
  floorDb: -80,
  attackMs: 2,
  releaseMs: 80,
} as const;

const AUDIO_DELAY_DEFAULTS = {
  delayMs: 250,
  feedback: 0,
  mix: 0,
  toneHz: 12000,
} as const;

const AUDIO_REVERB_DEFAULTS = {
  roomSize: 0.35,
  decaySeconds: 1.2,
  damping: 0.35,
  mix: 0,
} as const;

const AUDIO_EFFECT_DESCRIPTORS = [
  Object.freeze({
    id: 'audio-volume',
    name: 'Volume',
    category: 'gain',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_VOLUME_DEFAULTS)),
    params: createParamDescriptors(AUDIO_VOLUME_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-eq',
    name: 'EQ',
    category: 'eq',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: AUDIO_EQ_BAND_PARAMS,
    params: createParamDescriptors(AUDIO_EQ_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-high-pass',
    name: 'High Pass Filter',
    category: 'filter',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_HIGH_PASS_DEFAULTS)),
    params: createParamDescriptors(AUDIO_HIGH_PASS_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-low-pass',
    name: 'Low Pass Filter',
    category: 'filter',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_LOW_PASS_DEFAULTS)),
    params: createParamDescriptors(AUDIO_LOW_PASS_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-compressor',
    name: 'Compressor',
    category: 'dynamics',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_COMPRESSOR_DEFAULTS)),
    params: createParamDescriptors(AUDIO_COMPRESSOR_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-de-esser',
    name: 'De-esser',
    category: 'dynamics',
    automation: 'sample-accurate',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_DE_ESSER_DEFAULTS)),
    params: createParamDescriptors(AUDIO_DE_ESSER_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-limiter',
    name: 'Limiter',
    category: 'dynamics',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_LIMITER_DEFAULTS)),
    params: createParamDescriptors(AUDIO_LIMITER_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-noise-gate',
    name: 'Noise Gate',
    category: 'dynamics',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 0,
    paramNames: Object.freeze(Object.keys(AUDIO_NOISE_GATE_DEFAULTS)),
    params: createParamDescriptors(AUDIO_NOISE_GATE_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-delay',
    name: 'Delay',
    category: 'time',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 2,
    paramNames: Object.freeze(Object.keys(AUDIO_DELAY_DEFAULTS)),
    params: createParamDescriptors(AUDIO_DELAY_DEFAULTS),
  }),
  Object.freeze({
    id: 'audio-reverb',
    name: 'Reverb',
    category: 'time',
    automation: 'clip',
    latencySamples: 0,
    tailSeconds: 3,
    paramNames: Object.freeze(Object.keys(AUDIO_REVERB_DEFAULTS)),
    params: createParamDescriptors(AUDIO_REVERB_DEFAULTS),
  }),
] as const satisfies readonly AudioEffectDescriptor[];

export const AUDIO_EFFECT_REGISTRY: ReadonlyMap<AudioEffectId, AudioEffectDescriptor> = new Map(
  AUDIO_EFFECT_DESCRIPTORS.map(descriptor => [descriptor.id, descriptor])
);

export function getAudioEffect(id: string): AudioEffectDescriptor | undefined {
  return AUDIO_EFFECT_REGISTRY.get(id as AudioEffectId);
}

export function hasAudioEffect(id: string): id is AudioEffectId {
  return AUDIO_EFFECT_REGISTRY.has(id as AudioEffectId);
}

export function getAllAudioEffects(): AudioEffectDescriptor[] {
  return Array.from(AUDIO_EFFECT_REGISTRY.values());
}

export function getAudioEffectParamNames(id: string): string[] {
  return [...(getAudioEffect(id)?.paramNames ?? [])];
}

export function getAudioEffectDefaultParams(id: string): Record<string, AudioEffectParamValue> {
  const effect = getAudioEffect(id);
  if (!effect) return {};

  return Object.fromEntries(
    Object.entries(effect.params).map(([paramName, param]) => [paramName, param.default])
  );
}
