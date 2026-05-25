import { describe, expect, it } from 'vitest';
import {
  AUDIO_EFFECT_REGISTRY,
  AUDIO_EQ_BAND_PARAMS,
  getAllAudioEffects,
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  hasAudioEffect,
} from '../../src/engine/audio/AudioEffectRegistry';

describe('AudioEffectRegistry', () => {
  it('registers professional audio effect descriptors in stable UI/render order', () => {
    expect(Array.from(AUDIO_EFFECT_REGISTRY.keys())).toEqual([
      'audio-volume',
      'audio-eq',
      'audio-high-pass',
      'audio-low-pass',
      'audio-compressor',
      'audio-de-esser',
      'audio-limiter',
      'audio-noise-gate',
      'audio-delay',
      'audio-reverb',
    ]);
    expect(getAllAudioEffects().map(effect => effect.id)).toEqual([
      'audio-volume',
      'audio-eq',
      'audio-high-pass',
      'audio-low-pass',
      'audio-compressor',
      'audio-de-esser',
      'audio-limiter',
      'audio-noise-gate',
      'audio-delay',
      'audio-reverb',
    ]);
  });

  it('describes audio-volume defaults and params', () => {
    expect(hasAudioEffect('audio-volume')).toBe(true);
    expect(getAudioEffect('audio-volume')).toMatchObject({
      id: 'audio-volume',
      name: 'Volume',
      paramNames: ['volume'],
    });
    expect(getAudioEffectDefaultParams('audio-volume')).toEqual({ volume: 1 });
    expect(getAudioEffectParamNames('audio-volume')).toEqual(['volume']);
  });

  it('describes audio-eq defaults and params in renderer order', () => {
    expect(hasAudioEffect('audio-eq')).toBe(true);
    expect(getAudioEffect('audio-eq')).toMatchObject({
      id: 'audio-eq',
      name: 'EQ',
      paramNames: AUDIO_EQ_BAND_PARAMS,
    });
    expect(getAudioEffectParamNames('audio-eq')).toEqual([
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
    expect(getAudioEffectDefaultParams('audio-eq')).toEqual({
      band31: 0,
      band62: 0,
      band125: 0,
      band250: 0,
      band500: 0,
      band1k: 0,
      band2k: 0,
      band4k: 0,
      band8k: 0,
      band16k: 0,
    });
  });

  it('describes filter and dynamics defaults', () => {
    expect(getAudioEffect('audio-high-pass')).toMatchObject({
      id: 'audio-high-pass',
      name: 'High Pass Filter',
      category: 'filter',
      paramNames: ['frequencyHz', 'q'],
    });
    expect(getAudioEffectDefaultParams('audio-high-pass')).toEqual({ frequencyHz: 20, q: 0.707 });

    expect(getAudioEffect('audio-low-pass')).toMatchObject({
      id: 'audio-low-pass',
      name: 'Low Pass Filter',
      category: 'filter',
      paramNames: ['frequencyHz', 'q'],
    });
    expect(getAudioEffectDefaultParams('audio-low-pass')).toEqual({ frequencyHz: 22000, q: 0.707 });

    expect(getAudioEffect('audio-compressor')).toMatchObject({
      id: 'audio-compressor',
      name: 'Compressor',
      category: 'dynamics',
    });
    expect(getAudioEffectDefaultParams('audio-compressor')).toEqual({
      thresholdDb: 0,
      ratio: 1,
      kneeDb: 0,
      attackMs: 10,
      releaseMs: 120,
      makeupGainDb: 0,
    });
    expect(getAudioEffect('audio-de-esser')).toMatchObject({
      id: 'audio-de-esser',
      name: 'De-esser',
      category: 'dynamics',
      paramNames: ['frequencyHz', 'thresholdDb', 'ratio', 'kneeDb', 'attackMs', 'releaseMs', 'makeupGainDb'],
    });
    expect(getAudioEffectDefaultParams('audio-de-esser')).toEqual({
      frequencyHz: 6500,
      thresholdDb: 0,
      ratio: 1,
      kneeDb: 6,
      attackMs: 1,
      releaseMs: 80,
      makeupGainDb: 0,
    });

    expect(getAudioEffectDefaultParams('audio-limiter')).toEqual({
      ceilingDb: 0,
      inputGainDb: 0,
    });
    expect(getAudioEffectDefaultParams('audio-noise-gate')).toEqual({
      thresholdDb: -120,
      floorDb: -80,
      attackMs: 2,
      releaseMs: 80,
    });
    expect(getAudioEffect('audio-delay')).toMatchObject({
      id: 'audio-delay',
      name: 'Delay',
      category: 'time',
      paramNames: ['delayMs', 'feedback', 'mix', 'toneHz'],
    });
    expect(getAudioEffectDefaultParams('audio-delay')).toEqual({
      delayMs: 250,
      feedback: 0,
      mix: 0,
      toneHz: 12000,
    });
    expect(getAudioEffect('audio-reverb')).toMatchObject({
      id: 'audio-reverb',
      name: 'Reverb',
      category: 'time',
      paramNames: ['roomSize', 'decaySeconds', 'damping', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-reverb')).toEqual({
      roomSize: 0.35,
      decaySeconds: 1.2,
      damping: 0.35,
      mix: 0,
    });
  });

  it('returns defensive copies for arrays and default params', () => {
    const paramNames = getAudioEffectParamNames('audio-volume');
    paramNames.push('mutated');

    const defaults = getAudioEffectDefaultParams('audio-volume');
    defaults.volume = 0.5;

    expect(getAudioEffectParamNames('audio-volume')).toEqual(['volume']);
    expect(getAudioEffectDefaultParams('audio-volume')).toEqual({ volume: 1 });
  });

  it('handles unknown ids without fallback behavior', () => {
    expect(hasAudioEffect('brightness')).toBe(false);
    expect(getAudioEffect('brightness')).toBeUndefined();
    expect(getAudioEffectParamNames('brightness')).toEqual([]);
    expect(getAudioEffectDefaultParams('brightness')).toEqual({});
  });
});
