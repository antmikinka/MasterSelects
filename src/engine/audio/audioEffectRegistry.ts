/**
 * Audio Effect Registry
 *
 * Defines all available audio effects for the DAW-style modular chain.
 * Each effect declares its params with type, range, and display metadata.
 */

import type { AudioEffectType } from '../../types';

export interface AudioEffectParamDef {
  label: string;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  animatable?: boolean;
  // Display hint: show as dB (value is linear gain, display as 20*log10)
  displayAsDb?: boolean;
}

export interface AudioEffectDef {
  type: AudioEffectType;
  name: string;
  category: 'utility' | 'eq' | 'dynamics' | 'filter';
  params: Record<string, AudioEffectParamDef>;
}

export const AUDIO_EFFECT_REGISTRY = new Map<AudioEffectType, AudioEffectDef>([
  ['audio-volume', {
    type: 'audio-volume',
    name: 'Volume',
    category: 'utility',
    params: {
      volume: {
        label: 'Gain', type: 'number', default: 1,
        min: 0, max: 2, step: 0.01,
        suffix: 'dB', displayAsDb: true, animatable: true,
      },
    },
  }],

  ['audio-eq', {
    type: 'audio-eq',
    name: '10-Band EQ',
    category: 'eq',
    params: {
      band31:  { label: '31 Hz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band62:  { label: '62 Hz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band125: { label: '125 Hz', type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band250: { label: '250 Hz', type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band500: { label: '500 Hz', type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band1k:  { label: '1 kHz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band2k:  { label: '2 kHz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band4k:  { label: '4 kHz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band8k:  { label: '8 kHz',  type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
      band16k: { label: '16 kHz', type: 'number', default: 0, min: -12, max: 12, step: 0.5, suffix: 'dB', animatable: true },
    },
  }],

  ['audio-compressor', {
    type: 'audio-compressor',
    name: 'Compressor',
    category: 'dynamics',
    params: {
      threshold:  { label: 'Threshold',   type: 'number', default: -24,   min: -100, max: 0,   step: 1,     suffix: 'dB', animatable: true },
      knee:       { label: 'Knee',        type: 'number', default: 30,    min: 0,    max: 40,  step: 1,     suffix: 'dB', animatable: false },
      ratio:      { label: 'Ratio',       type: 'number', default: 4,     min: 1,    max: 20,  step: 0.5,   suffix: ':1', animatable: true },
      attack:     { label: 'Attack',      type: 'number', default: 0.003, min: 0,    max: 1,   step: 0.001, suffix: 's',  animatable: true },
      release:    { label: 'Release',     type: 'number', default: 0.25,  min: 0,    max: 1,   step: 0.01,  suffix: 's',  animatable: true },
      makeupGain: { label: 'Makeup Gain', type: 'number', default: 0,     min: 0,    max: 30,  step: 0.5,   suffix: 'dB', animatable: true },
    },
  }],

  ['audio-highpass', {
    type: 'audio-highpass',
    name: 'High Pass',
    category: 'filter',
    params: {
      frequency: { label: 'Cutoff',    type: 'number', default: 80,    min: 20, max: 20000, step: 1,   suffix: 'Hz', animatable: true },
      Q:         { label: 'Resonance', type: 'number', default: 0.707, min: 0.1, max: 20,  step: 0.1,               animatable: false },
    },
  }],

  ['audio-lowpass', {
    type: 'audio-lowpass',
    name: 'Low Pass',
    category: 'filter',
    params: {
      frequency: { label: 'Cutoff',    type: 'number', default: 8000,  min: 20, max: 20000, step: 1,   suffix: 'Hz', animatable: true },
      Q:         { label: 'Resonance', type: 'number', default: 0.707, min: 0.1, max: 20,  step: 0.1,               animatable: false },
    },
  }],
]);

export const EQ_BAND_PARAMS = [
  'band31', 'band62', 'band125', 'band250', 'band500',
  'band1k', 'band2k', 'band4k', 'band8k', 'band16k',
];

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function getAudioEffectDef(type: AudioEffectType): AudioEffectDef | undefined {
  return AUDIO_EFFECT_REGISTRY.get(type);
}

export function getAudioEffectDefaultParams(type: AudioEffectType): Record<string, number | boolean | string> {
  const def = AUDIO_EFFECT_REGISTRY.get(type);
  if (!def) return {};
  return Object.fromEntries(
    Object.entries(def.params).map(([key, param]) => [key, param.default])
  );
}

export function getAudioEffectsByCategory(): Array<{ category: string; effects: AudioEffectDef[] }> {
  const byCategory = new Map<string, AudioEffectDef[]>();
  for (const def of AUDIO_EFFECT_REGISTRY.values()) {
    if (!byCategory.has(def.category)) byCategory.set(def.category, []);
    byCategory.get(def.category)!.push(def);
  }
  const categoryOrder = ['utility', 'eq', 'dynamics', 'filter'];
  return categoryOrder
    .filter(c => byCategory.has(c))
    .map(c => ({ category: c, effects: byCategory.get(c)! }));
}
