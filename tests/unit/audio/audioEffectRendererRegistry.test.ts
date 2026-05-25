import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEffectRenderer,
  EQ_BAND_PARAMS,
} from '../../../src/engine/audio/AudioEffectRenderer';
import { getAudioEffectParamNames } from '../../../src/engine/audio/AudioEffectRegistry';
import type { AnimatableProperty, AudioEffectInstance, Effect, Keyframe } from '../../../src/types';

type AudioEffectRendererRegistryTestAccess = AudioEffectRenderer & {
  getRenderableAudioEffects(effects: Effect[]): Effect[];
  getRenderableAudioEffectInstances(effectStack: readonly AudioEffectInstance[]): AudioEffectInstance[];
  hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean;
  hasNonDefaultEQ(eqEffect: Effect): boolean;
  hasNonDefaultVolume(volumeEffect: Effect): boolean;
  shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean;
  shouldRenderAudioEffectInstance(effect: AudioEffectInstance, keyframes: Keyframe[]): boolean;
  audioEffectInstanceToLegacyEffect(effect: AudioEffectInstance): Effect | null;
};

const globalWithOfflineContext = globalThis as typeof globalThis & {
  OfflineAudioContext?: typeof OfflineAudioContext;
  AudioContext?: typeof AudioContext;
};

const originalOfflineAudioContext = globalWithOfflineContext.OfflineAudioContext;
const originalAudioContext = globalWithOfflineContext.AudioContext;

function asRegistryTestAccess(
  renderer: AudioEffectRenderer
): AudioEffectRendererRegistryTestAccess {
  return renderer as unknown as AudioEffectRendererRegistryTestAccess;
}

function makeEffect(options: {
  id: string;
  type: string;
  params?: Effect['params'];
  enabled?: boolean;
}): Effect {
  return {
    id: options.id,
    name: options.type,
    type: options.type as Effect['type'],
    enabled: options.enabled ?? true,
    params: options.params ?? {},
  };
}

function makeKeyframe(effectId: string, paramName: string, value = 1): Keyframe {
  return {
    id: `kf-${effectId}-${paramName}`,
    clipId: 'clip-1',
    time: 0,
    property: `effect.${effectId}.${paramName}` as AnimatableProperty,
    value,
    easing: 'linear',
  };
}

function makeBuffer(): AudioBuffer {
  return {
    numberOfChannels: 1,
    sampleRate: 48000,
    length: 480,
    duration: 0.01,
  } as AudioBuffer;
}

function makeMutableBuffer(samples: number[], sampleRate = 48000): AudioBuffer {
  const channelData = [Float32Array.from(samples)];
  return {
    numberOfChannels: 1,
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function installAudioContextMock(): void {
  class AudioContextMock {
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      const channelData = Array.from({ length: numberOfChannels }, () => Float32Array.from(Array.from({ length }, () => 0)));
      return {
        numberOfChannels,
        sampleRate,
        length,
        duration: length / sampleRate,
        getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
      } as unknown as AudioBuffer;
    }

    close(): void {}
  }

  globalWithOfflineContext.AudioContext = AudioContextMock as unknown as typeof AudioContext;
}

describe('AudioEffectRenderer registry migration', () => {
  let renderer: AudioEffectRenderer;
  let access: AudioEffectRendererRegistryTestAccess;
  let offlineContextConstructor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderer = new AudioEffectRenderer();
    access = asRegistryTestAccess(renderer);
    offlineContextConstructor = vi.fn(() => {
      throw new Error('OfflineAudioContext should not be constructed for no-op registry cases');
    });
    globalWithOfflineContext.OfflineAudioContext =
      offlineContextConstructor as unknown as typeof OfflineAudioContext;
  });

  afterEach(() => {
    if (originalOfflineAudioContext) {
      globalWithOfflineContext.OfflineAudioContext = originalOfflineAudioContext;
    } else {
      Reflect.deleteProperty(globalWithOfflineContext, 'OfflineAudioContext');
    }
    if (originalAudioContext) {
      globalWithOfflineContext.AudioContext = originalAudioContext;
    } else {
      Reflect.deleteProperty(globalWithOfflineContext, 'AudioContext');
    }
  });

  it('exports EQ band params from the audio effect registry', () => {
    expect(EQ_BAND_PARAMS).toEqual(getAudioEffectParamNames('audio-eq'));
  });

  it('treats missing params as registry defaults', () => {
    expect(access.hasNonDefaultVolume(makeEffect({
      id: 'vol-1',
      type: 'audio-volume',
      params: {},
    }))).toBe(false);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: {},
    }))).toBe(false);
  });

  it('detects non-default registry-backed volume and EQ params', () => {
    expect(access.hasNonDefaultVolume(makeEffect({
      id: 'vol-1',
      type: 'audio-volume',
      params: { volume: 0.5 },
    }))).toBe(true);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: { band1k: 0.009 },
    }))).toBe(false);

    expect(access.hasNonDefaultEQ(makeEffect({
      id: 'eq-1',
      type: 'audio-eq',
      params: { band1k: 0.011 },
    }))).toBe(true);
  });

  it('detects keyframes for registered effects but not unknown effects', () => {
    const volume = makeEffect({ id: 'vol-1', type: 'audio-volume' });
    const unknown = makeEffect({
      id: 'phaser-1',
      type: 'audio-phaser',
      params: { mix: 1 },
    });

    expect(access.hasEffectKeyframes([
      makeKeyframe('vol-1', 'volume', 0.25),
    ], 'vol-1')).toBe(true);
    expect(access.shouldRenderAudioEffect(volume, [
      makeKeyframe('vol-1', 'volume', 0.25),
    ])).toBe(true);
    expect(access.shouldRenderAudioEffect(unknown, [
      makeKeyframe('phaser-1', 'mix', 1),
    ])).toBe(false);
  });

  it('detects non-default professional registry-backed params', () => {
    const highPass = makeEffect({
      id: 'hp-1',
      type: 'audio-high-pass',
      params: { frequencyHz: 120, q: 0.707 },
    });
    const defaultLimiter: AudioEffectInstance = {
      id: 'limiter-1',
      descriptorId: 'audio-limiter',
      enabled: true,
      params: {},
    };
    const activeLimiter: AudioEffectInstance = {
      ...defaultLimiter,
      params: { ceilingDb: -1, inputGainDb: 3 },
    };
    const deEsser: AudioEffectInstance = {
      id: 'de-esser-1',
      descriptorId: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7200, thresholdDb: -24, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90 },
    };

    expect(access.shouldRenderAudioEffect(highPass, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(defaultLimiter, [])).toBe(false);
    expect(access.shouldRenderAudioEffectInstance(activeLimiter, [])).toBe(true);
    expect(access.shouldRenderAudioEffectInstance(deEsser, [])).toBe(true);
  });

  it('selects only registered legacy effects in renderer order', () => {
    const volume = makeEffect({
      id: 'vol-primary',
      type: 'audio-volume',
      params: { volume: 0.5 },
    });
    const eq = makeEffect({
      id: 'eq-primary',
      type: 'audio-eq',
      params: { band1k: 3 },
    });
    const delay = makeEffect({
      id: 'delay-1',
      type: 'audio-delay',
      params: { mix: 1 },
    });
    const deEsser = makeEffect({
      id: 'de-esser-1',
      type: 'audio-de-esser',
      params: { thresholdDb: -24, ratio: 4 },
    });
    const duplicateVolume = makeEffect({
      id: 'vol-secondary',
      type: 'audio-volume',
      params: { volume: 0.25 },
    });

    expect(access.getRenderableAudioEffects([
      delay,
      deEsser,
      volume,
      duplicateVolume,
      eq,
    ])).toEqual([eq, deEsser, delay, volume]);
  });

  it('returns the original buffer when registered effects are at defaults', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
      makeEffect({ id: 'vol-1', type: 'audio-volume', params: {} }),
      makeEffect({ id: 'eq-1', type: 'audio-eq', params: {} }),
    ], []);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('skips disabled registered legacy effects even when their params are non-default', async () => {
    const buffer = makeBuffer();
    const disabledVolume = makeEffect({
      id: 'vol-disabled',
      type: 'audio-volume',
      enabled: false,
      params: { volume: 0.1 },
    });

    const result = await renderer.renderEffects(buffer, [disabledVolume], [
      makeKeyframe('vol-disabled', 'volume', 0.25),
    ]);

    expect(access.shouldRenderAudioEffect(disabledVolume, [
      makeKeyframe('vol-disabled', 'volume', 0.25),
    ])).toBe(false);
    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('converts new audio effect instances through registry descriptors', async () => {
    const buffer = makeBuffer();
    const volumeInstance: AudioEffectInstance = {
      id: 'volume-instance',
      descriptorId: 'audio-volume',
      enabled: true,
      params: { volume: 1 },
      automationMode: 'clip',
    };
    const unknownInstance: AudioEffectInstance = {
      id: 'unknown-instance',
      descriptorId: 'audio-phaser',
      enabled: true,
      params: { mix: 1 },
    };
    const delayInstance: AudioEffectInstance = {
      id: 'delay-instance',
      descriptorId: 'audio-delay',
      enabled: true,
      params: { mix: 0 },
    };
    const compressorInstance: AudioEffectInstance = {
      id: 'compressor-instance',
      descriptorId: 'audio-compressor',
      enabled: true,
      params: { thresholdDb: -18, ratio: 3 },
    };
    const deEsserInstance: AudioEffectInstance = {
      id: 'de-esser-instance',
      descriptorId: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7000, thresholdDb: -24, ratio: 4 },
    };

    expect(access.audioEffectInstanceToLegacyEffect(volumeInstance)).toEqual({
      id: 'volume-instance',
      name: 'Volume',
      type: 'audio-volume',
      enabled: true,
      params: { volume: 1 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(unknownInstance)).toBeNull();
    expect(access.audioEffectInstanceToLegacyEffect(delayInstance)).toEqual({
      id: 'delay-instance',
      name: 'Delay',
      type: 'audio-delay',
      enabled: true,
      params: { mix: 0 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(compressorInstance)).toEqual({
      id: 'compressor-instance',
      name: 'Compressor',
      type: 'audio-compressor',
      enabled: true,
      params: { thresholdDb: -18, ratio: 3 },
    });
    expect(access.audioEffectInstanceToLegacyEffect(deEsserInstance)).toEqual({
      id: 'de-esser-instance',
      name: 'De-esser',
      type: 'audio-de-esser',
      enabled: true,
      params: { frequencyHz: 7000, thresholdDb: -24, ratio: 4 },
    });

    const result = await renderer.renderEffectInstances(buffer, [
      volumeInstance,
      unknownInstance,
    ], []);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('renders pure sample audio effect instances without constructing an offline node graph', async () => {
    installAudioContextMock();
    const buffer = makeMutableBuffer([0.02, 0.5, -0.95, 0.01, -0.02, 0, 0, 0, 0, 0], 1000);

    const limited = await renderer.renderEffectInstances(buffer, [{
      id: 'limiter-1',
      descriptorId: 'audio-limiter',
      enabled: true,
      params: { ceilingDb: -6, inputGainDb: 0 },
    }], []);

    expect(limited).not.toBe(buffer);
    expect(Math.max(...Array.from(limited.getChannelData(0)).map(Math.abs))).toBeLessThanOrEqual(0.502);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const gated = await renderer.renderEffectInstances(buffer, [{
      id: 'gate-1',
      descriptorId: 'audio-noise-gate',
      enabled: true,
      params: { thresholdDb: -20, floorDb: -80, attackMs: 0.1, releaseMs: 0.1 },
    }], []);

    expect(gated.getChannelData(0)[0]).toBeLessThan(buffer.getChannelData(0)[0]);
    expect(Math.abs(gated.getChannelData(0)[2])).toBeGreaterThan(0.5);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const delayed = await renderer.renderEffectInstances(buffer, [{
      id: 'delay-1',
      descriptorId: 'audio-delay',
      enabled: true,
      params: { delayMs: 2, feedback: 0, mix: 1 },
    }], []);

    expect(delayed.getChannelData(0)[0]).toBeCloseTo(0);
    expect(delayed.getChannelData(0)[2]).toBeCloseTo(buffer.getChannelData(0)[0]);
    expect(offlineContextConstructor).not.toHaveBeenCalled();

    const reverbed = await renderer.renderEffectInstances(buffer, [{
      id: 'reverb-1',
      descriptorId: 'audio-reverb',
      enabled: true,
      params: { roomSize: 0, decaySeconds: 0.2, damping: 0.2, mix: 1 },
    }], []);
    const wetTailEnergy = Array.from(reverbed.getChannelData(0))
      .slice(1)
      .reduce((sum, sample) => sum + Math.abs(sample), 0);

    expect(wetTailEnergy).toBeGreaterThan(0);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });

  it('returns the original buffer for unknown effects even with params and keyframes', async () => {
    const buffer = makeBuffer();
    const result = await renderer.renderEffects(buffer, [
      makeEffect({ id: 'phaser-1', type: 'audio-phaser', params: { mix: 1 } }),
    ], [
      makeKeyframe('phaser-1', 'mix', 1),
    ]);

    expect(result).toBe(buffer);
    expect(offlineContextConstructor).not.toHaveBeenCalled();
  });
});
