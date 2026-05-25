/**
 * AudioEffectRenderer - Apply EQ and volume effects with keyframe automation
 *
 * Uses OfflineAudioContext for sample-accurate offline rendering of:
 * - 10-band parametric EQ
 * - Volume/gain with keyframe automation
 *
 * Features:
 * - Keyframe interpolation for smooth automation
 * - Bezier curve support
 * - Offline rendering (not real-time)
 */

import { Logger } from '../../services/logger';
import type { AudioEffectInstance, Keyframe, Effect, EffectType, AnimatableProperty } from '../../types';
import { normalizeEasingType } from '../../utils/easing';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  type AudioEffectId,
  type AudioEffectParamValue,
} from './AudioEffectRegistry';

const log = Logger.create('AudioEffectRenderer');

// Standard 10-band EQ frequencies
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// EQ parameter names matching the effect params
export const EQ_BAND_PARAMS = getAudioEffectParamNames('audio-eq');

const AUDIO_EQ_EFFECT_ID = 'audio-eq' satisfies AudioEffectId;
const AUDIO_VOLUME_EFFECT_ID = 'audio-volume' satisfies AudioEffectId;
const AUDIO_HIGH_PASS_EFFECT_ID = 'audio-high-pass' satisfies AudioEffectId;
const AUDIO_LOW_PASS_EFFECT_ID = 'audio-low-pass' satisfies AudioEffectId;
const AUDIO_COMPRESSOR_EFFECT_ID = 'audio-compressor' satisfies AudioEffectId;
const AUDIO_DE_ESSER_EFFECT_ID = 'audio-de-esser' satisfies AudioEffectId;
const AUDIO_LIMITER_EFFECT_ID = 'audio-limiter' satisfies AudioEffectId;
const AUDIO_NOISE_GATE_EFFECT_ID = 'audio-noise-gate' satisfies AudioEffectId;
const AUDIO_DELAY_EFFECT_ID = 'audio-delay' satisfies AudioEffectId;
const AUDIO_REVERB_EFFECT_ID = 'audio-reverb' satisfies AudioEffectId;
const AUDIO_VOLUME_PARAM = getAudioEffectParamNames(AUDIO_VOLUME_EFFECT_ID)[0] ?? 'volume';
const LEGACY_AUDIO_EFFECT_RENDER_ORDER = [
  AUDIO_HIGH_PASS_EFFECT_ID,
  AUDIO_LOW_PASS_EFFECT_ID,
  AUDIO_EQ_EFFECT_ID,
  AUDIO_DE_ESSER_EFFECT_ID,
  AUDIO_COMPRESSOR_EFFECT_ID,
  AUDIO_NOISE_GATE_EFFECT_ID,
  AUDIO_DELAY_EFFECT_ID,
  AUDIO_REVERB_EFFECT_ID,
  AUDIO_LIMITER_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
] as const satisfies readonly AudioEffectId[];

const DEFAULT_PARAM_EPSILON = 0.001;
const EQ_PARAM_EPSILON = 0.01;

type RenderableAudioEffectInstance = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

function hasRenderableAudioEffect(effect: AudioEffectInstance & { bypassed?: boolean; disabled?: boolean }): boolean {
  return effect.enabled !== false &&
    effect.disabled !== true &&
    effect.bypassed !== true &&
    getAudioEffect(effect.descriptorId) !== undefined;
}

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export interface EffectRenderProgress {
  phase: 'preparing' | 'rendering' | 'complete';
  percent: number;
}

export type EffectRenderProgressCallback = (progress: EffectRenderProgress) => void;

export class AudioEffectRenderer {
  /**
   * Render all audio effects for a clip
   * @param buffer - Source AudioBuffer (already speed-processed)
   * @param effects - Array of effects (audio-eq, audio-volume)
   * @param keyframes - All keyframes for this clip
   * @param clipDuration - Duration for automation (usually same as buffer duration)
   * @param onProgress - Optional progress callback
   * @returns Processed AudioBuffer
   */
  async renderEffects(
    buffer: AudioBuffer,
    effects: Effect[],
    keyframes: Keyframe[],
    clipDuration?: number,
    onProgress?: EffectRenderProgressCallback
  ): Promise<AudioBuffer> {
    const renderableEffects = this.getRenderableAudioEffects(effects)
      .filter(effect => this.shouldRenderAudioEffect(effect, keyframes));
    return this.renderEffectInstances(
      buffer,
      renderableEffects.flatMap(effect => {
        const descriptor = getAudioEffect(effect.type);
        if (!descriptor) return [];
        return [{
          id: effect.id,
          descriptorId: descriptor.id,
          enabled: effect.enabled !== false,
          params: { ...effect.params },
          automationMode: 'clip' as const,
        }];
      }),
      keyframes,
      clipDuration,
      onProgress
    );
  }

  /**
   * Render registry-backed audio effect instances from the new audio graph
   * contract through the legacy-compatible offline renderer path.
   */
  async renderEffectInstances(
    buffer: AudioBuffer,
    effectStack: readonly AudioEffectInstance[],
    keyframes: Keyframe[],
    clipDuration?: number,
    onProgress?: EffectRenderProgressCallback
  ): Promise<AudioBuffer> {
    const duration = clipDuration ?? buffer.duration;
    const renderableEffects = this.getRenderableAudioEffectInstances(effectStack);
    const effectsToApply = renderableEffects.filter(effect =>
      this.shouldRenderAudioEffectInstance(effect, keyframes)
    );

    if (effectsToApply.length === 0) {
      log.debug('No effects to apply, returning original');
      return buffer;
    }

    log.debug(`Rendering ${effectsToApply.length} audio effects for ${duration.toFixed(2)}s audio`);

    onProgress?.({ phase: 'preparing', percent: 0 });

    let workingBuffer = buffer;
    let pendingOfflineEffects: RenderableAudioEffectInstance[] = [];

    const flushOfflineEffects = async () => {
      if (pendingOfflineEffects.length === 0) return;
      workingBuffer = await this.renderOfflineNodeEffects(
        workingBuffer,
        pendingOfflineEffects,
        keyframes,
        duration,
      );
      pendingOfflineEffects = [];
    };

    for (const effect of effectsToApply) {
      if (this.isPureSampleEffect(effect.descriptorId)) {
        await flushOfflineEffects();
        workingBuffer = this.renderPureSampleEffect(workingBuffer, effect);
      } else {
        pendingOfflineEffects.push(effect);
      }
    }

    await flushOfflineEffects();

    onProgress?.({ phase: 'complete', percent: 100 });
    log.debug(`Rendered ${workingBuffer.duration.toFixed(2)}s with effects`);
    return workingBuffer;
  }

  /**
   * Select legacy audio effects that have registry descriptors, preserving the
   * historical EQ -> volume render chain independently of UI stack order.
   */
  private getRenderableAudioEffects(effects: Effect[]): Effect[] {
    return LEGACY_AUDIO_EFFECT_RENDER_ORDER.flatMap(effectId => {
      const descriptor = getAudioEffect(effectId);
      if (!descriptor) return [];

      const effect = effects.find(candidate =>
        candidate.type === descriptor.id &&
        candidate.enabled !== false
      );
      return effect ? [effect] : [];
    });
  }

  private getRenderableAudioEffectInstances(
    effectStack: readonly AudioEffectInstance[]
  ): RenderableAudioEffectInstance[] {
    return effectStack.flatMap(effect => {
      if (!hasRenderableAudioEffect(effect)) return [];
      return [{
        ...effect,
        params: { ...effect.params },
      }];
    });
  }

  /**
   * Check if a selected legacy audio effect needs offline rendering.
   */
  private shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean {
    if (effect.enabled === false) {
      return false;
    }

    const descriptor = getAudioEffect(effect.type);
    if (!descriptor) return false;

    if (this.hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return this.hasNonDefaultEQ(effect);
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return this.hasNonDefaultVolume(effect);
    }

    return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
  }

  private shouldRenderAudioEffectInstance(
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[]
  ): boolean {
    if (effect.enabled === false || effect.disabled === true || effect.bypassed === true) {
      return false;
    }

    const descriptor = getAudioEffect(effect.descriptorId);
    if (!descriptor) return false;

    if (this.hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return this.hasNonDefaultRegistryParams(descriptor.id, effect.params, EQ_PARAM_EPSILON);
    }

    return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
  }

  audioEffectInstanceToLegacyEffect(
    effect: RenderableAudioEffectInstance
  ): Effect | null {
    const descriptor = getAudioEffect(effect.descriptorId);
    if (!descriptor) return null;

    return {
      id: effect.id,
      name: descriptor.name,
      type: descriptor.id as EffectType,
      enabled: effect.enabled !== false && effect.disabled !== true && effect.bypassed !== true,
      params: { ...effect.params },
    };
  }

  private async renderOfflineNodeEffects(
    buffer: AudioBuffer,
    effects: readonly RenderableAudioEffectInstance[],
    keyframes: Keyframe[],
    duration: number,
  ): Promise<AudioBuffer> {
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    let currentNode: AudioNode = source;

    for (const effect of effects) {
      switch (effect.descriptorId) {
        case AUDIO_EQ_EFFECT_ID:
          currentNode = this.createEQChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_VOLUME_EFFECT_ID:
          currentNode = this.createGainNode(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_HIGH_PASS_EFFECT_ID:
          currentNode = this.createFilterNode(offlineContext, currentNode, effect, 'highpass', keyframes, duration);
          break;
        case AUDIO_LOW_PASS_EFFECT_ID:
          currentNode = this.createFilterNode(offlineContext, currentNode, effect, 'lowpass', keyframes, duration);
          break;
        case AUDIO_COMPRESSOR_EFFECT_ID:
          currentNode = this.createCompressorChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_DE_ESSER_EFFECT_ID:
          currentNode = this.createDeEsserChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
      }
    }

    currentNode.connect(offlineContext.destination);
    source.start(0);
    return offlineContext.startRendering();
  }

  private isPureSampleEffect(effectId: string): boolean {
    return effectId === AUDIO_LIMITER_EFFECT_ID ||
      effectId === AUDIO_NOISE_GATE_EFFECT_ID ||
      effectId === AUDIO_DELAY_EFFECT_ID ||
      effectId === AUDIO_REVERB_EFFECT_ID;
  }

  private renderPureSampleEffect(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    switch (effect.descriptorId) {
      case AUDIO_LIMITER_EFFECT_ID:
        return this.applyPeakLimiter(buffer, effect);
      case AUDIO_NOISE_GATE_EFFECT_ID:
        return this.applyNoiseGate(buffer, effect);
      case AUDIO_DELAY_EFFECT_ID:
        return this.applyDelay(buffer, effect);
      case AUDIO_REVERB_EFFECT_ID:
        return this.applyReverb(buffer, effect);
      default:
        return buffer;
    }
  }

  private createFilterNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    filterEffect: RenderableAudioEffectInstance,
    type: BiquadFilterType,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const filter = context.createBiquadFilter();
    filter.type = type;
    const effectId = filterEffect.descriptorId as AudioEffectId;
    const defaultFrequency = this.getNumericEffectParamDefault(effectId, 'frequencyHz', type === 'highpass' ? 20 : 22000);
    const defaultQ = this.getNumericEffectParamDefault(effectId, 'q', 0.707);
    const frequency = this.getNumericEffectParam(filterEffect, 'frequencyHz', defaultFrequency);
    const q = this.getNumericEffectParam(filterEffect, 'q', defaultQ);

    this.automateEffectParam(filter.frequency, filterEffect, 'frequencyHz', frequency, keyframes, duration);
    this.automateEffectParam(filter.Q, filterEffect, 'q', q, keyframes, duration);

    inputNode.connect(filter);
    return filter;
  }

  private createCompressorChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    compressorEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const compressor = context.createDynamicsCompressor();
    const threshold = this.getNumericEffectParam(compressorEffect, 'thresholdDb', 0);
    const ratio = this.getNumericEffectParam(compressorEffect, 'ratio', 1);
    const knee = this.getNumericEffectParam(compressorEffect, 'kneeDb', 0);
    const attackSeconds = this.getNumericEffectParam(compressorEffect, 'attackMs', 10) / 1000;
    const releaseSeconds = this.getNumericEffectParam(compressorEffect, 'releaseMs', 120) / 1000;

    this.automateEffectParam(compressor.threshold, compressorEffect, 'thresholdDb', threshold, keyframes, duration);
    this.automateEffectParam(compressor.ratio, compressorEffect, 'ratio', ratio, keyframes, duration);
    this.automateEffectParam(compressor.knee, compressorEffect, 'kneeDb', knee, keyframes, duration);
    this.automateEffectParam(compressor.attack, compressorEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(compressor.release, compressorEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);

    inputNode.connect(compressor);

    const makeupGainDb = this.getNumericEffectParam(compressorEffect, 'makeupGainDb', 0);
    if (Math.abs(makeupGainDb) <= 0.001 && !this.hasEffectParamKeyframes(keyframes, compressorEffect.id, 'makeupGainDb')) {
      return compressor;
    }

    const makeupGain = context.createGain();
    this.automateEffectParam(
      makeupGain.gain,
      compressorEffect,
      'makeupGainDb',
      dbToLinearGain(makeupGainDb),
      keyframes,
      duration,
      dbToLinearGain,
    );
    compressor.connect(makeupGain);
    return makeupGain;
  }

  private createDeEsserChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    deEsserEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const splitFrequency = this.getNumericEffectParam(deEsserEffect, 'frequencyHz', 6500);
    const threshold = this.getNumericEffectParam(deEsserEffect, 'thresholdDb', 0);
    const ratio = this.getNumericEffectParam(deEsserEffect, 'ratio', 1);
    const knee = this.getNumericEffectParam(deEsserEffect, 'kneeDb', 6);
    const attackSeconds = this.getNumericEffectParam(deEsserEffect, 'attackMs', 1) / 1000;
    const releaseSeconds = this.getNumericEffectParam(deEsserEffect, 'releaseMs', 80) / 1000;
    const makeupGainDb = this.getNumericEffectParam(deEsserEffect, 'makeupGainDb', 0);
    const lowBand = context.createBiquadFilter();
    const highBand = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const makeupGain = context.createGain();
    const output = context.createGain();

    lowBand.type = 'lowpass';
    lowBand.Q.value = 0.707;
    highBand.type = 'highpass';
    highBand.Q.value = 0.707;

    this.automateEffectParam(lowBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
    this.automateEffectParam(highBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
    this.automateEffectParam(compressor.threshold, deEsserEffect, 'thresholdDb', threshold, keyframes, duration);
    this.automateEffectParam(compressor.ratio, deEsserEffect, 'ratio', ratio, keyframes, duration);
    this.automateEffectParam(compressor.knee, deEsserEffect, 'kneeDb', knee, keyframes, duration);
    this.automateEffectParam(compressor.attack, deEsserEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(compressor.release, deEsserEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(
      makeupGain.gain,
      deEsserEffect,
      'makeupGainDb',
      dbToLinearGain(makeupGainDb),
      keyframes,
      duration,
      dbToLinearGain,
    );

    inputNode.connect(lowBand);
    inputNode.connect(highBand);
    lowBand.connect(output);
    highBand.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(output);

    return output;
  }

  /**
   * Create 10-band EQ filter chain
   */
  private createEQChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    eqEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const filters: BiquadFilterNode[] = [];

    // Create filter for each band
    EQ_FREQUENCIES.forEach((freq, index) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4; // Standard Q for 10-band EQ

      // Get default gain from effect params
      const paramName = EQ_BAND_PARAMS[index];
      const defaultGain = (eqEffect.params?.[paramName] as number) ??
        this.getNumericEffectParamDefault(AUDIO_EQ_EFFECT_ID, paramName, 0);

      // Get keyframes for this band
      const property = `effect.${eqEffect.id}.${paramName}` as AnimatableProperty;
      const bandKeyframes = keyframes.filter(k => k.property === property);

      if (bandKeyframes.length > 0) {
        // Automate the gain parameter
        this.automateParam(filter.gain, bandKeyframes, defaultGain, duration);
      } else {
        // Set constant value
        filter.gain.value = defaultGain;
      }

      filters.push(filter);
    });

    // Connect filters in series
    inputNode.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }

    // Return last filter as output
    return filters[filters.length - 1];
  }

  /**
   * Create gain node for volume control
   */
  private createGainNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    volumeEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const gainNode = context.createGain();

    // Get default volume
    const defaultVolume = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ??
      this.getNumericEffectParamDefault(AUDIO_VOLUME_EFFECT_ID, AUDIO_VOLUME_PARAM, 1);

    // Get keyframes for volume
    const property = `effect.${volumeEffect.id}.${AUDIO_VOLUME_PARAM}` as AnimatableProperty;
    const volumeKeyframes = keyframes.filter(k => k.property === property);

    if (volumeKeyframes.length > 0) {
      // Automate the gain parameter
      this.automateParam(gainNode.gain, volumeKeyframes, defaultVolume, duration);
    } else {
      // Set constant value
      gainNode.gain.value = defaultVolume;
    }

    inputNode.connect(gainNode);
    return gainNode;
  }

  /**
   * Automate an AudioParam using keyframes
   */
  private automateParam(
    param: AudioParam,
    keyframes: Keyframe[],
    defaultValue: number,
    duration: number
  ): void {
    if (keyframes.length === 0) {
      param.setValueAtTime(defaultValue, 0);
      return;
    }

    // Sort keyframes by time
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    // Set initial value at time 0
    if (sorted[0].time > 0) {
      // Interpolate value at time 0
      const valueAt0 = this.interpolateValue(sorted, 0, defaultValue);
      param.setValueAtTime(valueAt0, 0);
    }

    // Process each keyframe
    for (let i = 0; i < sorted.length; i++) {
      const kf = sorted[i];
      const time = Math.max(0, kf.time);

      // Ensure gain values are positive (required for exponential ramp)
      const value = kf.property.includes('volume')
        ? Math.max(0.0001, kf.value)
        : kf.value;

      if (i === 0) {
        // First keyframe - set initial value
        param.setValueAtTime(value, time);
      } else {
        // Subsequent keyframes - ramp to value
        const prevKf = sorted[i - 1];

        switch (normalizeEasingType(kf.easing, 'linear')) {
          case 'linear':
            param.linearRampToValueAtTime(value, time);
            break;

          case 'ease-in':
          case 'ease-out':
          case 'ease-in-out':
            // Approximate with exponential for smooth curves
            // Only use exponential if value > 0
            if (value > 0 && param.value > 0) {
              param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
            } else {
              param.linearRampToValueAtTime(value, time);
            }
            break;

          case 'bezier':
            // For bezier, sample the curve at multiple points
            this.automateBezier(param, prevKf, kf);
            break;

          default:
            // Step/hold
            param.setValueAtTime(value, time);
        }
      }
    }

    // Hold last value until end
    const lastKf = sorted[sorted.length - 1];
    if (lastKf.time < duration) {
      param.setValueAtTime(lastKf.value, lastKf.time);
    }
  }

  /**
   * Automate using bezier curve by sampling points
   */
  private automateBezier(
    param: AudioParam,
    prevKf: Keyframe,
    kf: Keyframe
  ): void {
    // Sample bezier curve at multiple points
    const numSamples = 10;
    const duration = kf.time - prevKf.time;

    for (let i = 1; i <= numSamples; i++) {
      const t = i / numSamples;
      const time = prevKf.time + t * duration;

      // Interpolate using the keyframe interpolation utility
      // This handles bezier handles properly
      const value = this.bezierInterpolate(prevKf, kf, t);

      param.linearRampToValueAtTime(value, time);
    }
  }

  /**
   * Bezier interpolation between two keyframes
   */
  private bezierInterpolate(prevKf: Keyframe, kf: Keyframe, t: number): number {
    // If no handles, use linear
    if (!prevKf.handleOut && !kf.handleIn) {
      return prevKf.value + (kf.value - prevKf.value) * t;
    }

    // Cubic bezier with handles
    const p0 = prevKf.value;
    const p3 = kf.value;

    // Handle positions (time, value) relative to keyframe
    const h1 = prevKf.handleOut || { x: 0.33, y: 0 };
    const h2 = kf.handleIn || { x: -0.33, y: 0 };

    // Convert to absolute values
    const valueDiff = p3 - p0;
    const p1 = p0 + h1.y * valueDiff;
    const p2 = p3 + h2.y * valueDiff;

    // Cubic bezier formula
    const mt = 1 - t;
    return mt * mt * mt * p0 +
           3 * mt * mt * t * p1 +
           3 * mt * t * t * p2 +
           t * t * t * p3;
  }

  /**
   * Interpolate value at a specific time using keyframes
   */
  private interpolateValue(keyframes: Keyframe[], time: number, defaultValue: number): number {
    if (keyframes.length === 0) return defaultValue;

    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    // Before first keyframe
    if (time <= sorted[0].time) {
      return sorted[0].value;
    }

    // After last keyframe
    if (time >= sorted[sorted.length - 1].time) {
      return sorted[sorted.length - 1].value;
    }

    // Find surrounding keyframes
    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
        return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t;
      }
    }

    return defaultValue;
  }

  /**
   * Check if effect has keyframes
   */
  private hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean {
    return keyframes.some(k => k.property.startsWith(`effect.${effectId}.`));
  }

  /**
   * Get a registry default param value for an audio effect.
   */
  private getEffectParamDefault(
    effectId: AudioEffectId,
    paramName: string
  ): AudioEffectParamValue | undefined {
    return getAudioEffectDefaultParams(effectId)[paramName];
  }

  /**
   * Get a numeric registry default param value.
   */
  private getNumericEffectParamDefault(
    effectId: AudioEffectId,
    paramName: string,
    fallback: number
  ): number {
    const defaultValue = this.getEffectParamDefault(effectId, paramName);
    return typeof defaultValue === 'number' ? defaultValue : fallback;
  }

  private getNumericEffectParam(
    effect: RenderableAudioEffectInstance,
    paramName: string,
    fallback: number
  ): number {
    const value = effect.params?.[paramName];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private hasEffectParamKeyframes(
    keyframes: Keyframe[],
    effectId: string,
    paramName: string,
  ): boolean {
    return keyframes.some(k => k.property === `effect.${effectId}.${paramName}`);
  }

  private automateEffectParam(
    param: AudioParam,
    effect: RenderableAudioEffectInstance,
    paramName: string,
    defaultValue: number,
    keyframes: Keyframe[],
    duration: number,
    transformValue: (value: number) => number = value => value,
  ): void {
    const property = `effect.${effect.id}.${paramName}` as AnimatableProperty;
    const paramKeyframes = keyframes
      .filter(k => k.property === property)
      .map(k => ({ ...k, value: transformValue(k.value) }));

    if (paramKeyframes.length > 0) {
      this.automateParam(param, paramKeyframes, defaultValue, duration);
    } else {
      param.value = defaultValue;
    }
  }

  private hasNonDefaultRegistryParams(
    effectId: AudioEffectId,
    params: Record<string, number | boolean | string> | undefined,
    epsilon = DEFAULT_PARAM_EPSILON,
  ): boolean {
    const descriptor = getAudioEffect(effectId);
    if (!descriptor) return false;

    const defaults = getAudioEffectDefaultParams(effectId);
    return descriptor.paramNames.some(paramName => {
      const defaultValue = defaults[paramName];
      const value = params?.[paramName];
      if (value === undefined) return false;
      if (typeof defaultValue === 'number') {
        return typeof value !== 'number' || Math.abs(value - defaultValue) > epsilon;
      }
      return value !== defaultValue;
    });
  }

  /**
   * Check if volume has a non-default value.
   */
  private hasNonDefaultVolume(volumeEffect: Effect): boolean {
    const defaultVolume = this.getNumericEffectParamDefault(
      AUDIO_VOLUME_EFFECT_ID,
      AUDIO_VOLUME_PARAM,
      1
    );
    const value = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ?? defaultVolume;
    return value !== defaultVolume;
  }

  /**
   * Check if EQ has non-default values
   */
  private hasNonDefaultEQ(eqEffect: Effect): boolean {
    const defaults = getAudioEffectDefaultParams(AUDIO_EQ_EFFECT_ID);

    return EQ_BAND_PARAMS.some(param => {
      const value = eqEffect.params?.[param] as number;
      const defaultValue = defaults[param];
      return value !== undefined &&
        typeof defaultValue === 'number' &&
        Math.abs(value - defaultValue) > 0.01;
    });
  }

  private createMutableAudioBufferLike(buffer: AudioBuffer): AudioBuffer {
    const maybeWindow = globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is required for audio effect sample processing.');
    }

    const audioContext = new AudioContextCtor();
    const nextBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    audioContext.close();
    return nextBuffer;
  }

  private applyPeakLimiter(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const ceilingDb = this.getNumericEffectParam(effect, 'ceilingDb', 0);
    const inputGainDb = this.getNumericEffectParam(effect, 'inputGainDb', 0);
    const ceiling = Math.max(0.000001, dbToLinearGain(ceilingDb));
    const inputGain = dbToLinearGain(inputGainDb);
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      for (let index = 0; index < buffer.length; index += 1) {
        const value = (input[index] ?? 0) * inputGain;
        target[index] = clamp(value, -ceiling, ceiling);
      }
    }

    return output;
  }

  private applyNoiseGate(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const threshold = dbToLinearGain(this.getNumericEffectParam(effect, 'thresholdDb', -120));
    const floorGain = dbToLinearGain(this.getNumericEffectParam(effect, 'floorDb', -80));
    const attackMs = Math.max(0.001, this.getNumericEffectParam(effect, 'attackMs', 2));
    const releaseMs = Math.max(0.001, this.getNumericEffectParam(effect, 'releaseMs', 80));
    const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * attackMs / 1000));
    const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * releaseMs / 1000));
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      let gain = 1;

      for (let index = 0; index < buffer.length; index += 1) {
        const sample = input[index] ?? 0;
        const targetGain = Math.abs(sample) >= threshold ? 1 : floorGain;
        const coefficient = targetGain > gain ? attackCoefficient : releaseCoefficient;
        gain = targetGain + coefficient * (gain - targetGain);
        target[index] = sample * gain;
      }
    }

    return output;
  }

  private applyDelay(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const delayMs = clamp(this.getNumericEffectParam(effect, 'delayMs', 250), 1, 2000);
    const feedback = clamp(this.getNumericEffectParam(effect, 'feedback', 0), 0, 0.95);
    const mix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    const delaySamples = Math.max(1, Math.round(buffer.sampleRate * delayMs / 1000));

    if (mix <= 0.0001) {
      return buffer;
    }

    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      const feedbackBuffer = new Float32Array(buffer.length);

      for (let index = 0; index < buffer.length; index += 1) {
        const dry = input[index] ?? 0;
        const delayed = index >= delaySamples ? feedbackBuffer[index - delaySamples] : 0;
        feedbackBuffer[index] = clamp(dry + delayed * feedback, -4, 4);
        target[index] = dry * (1 - mix) + delayed * mix;
      }
    }

    return output;
  }

  private applyReverb(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const mix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    if (mix <= 0.0001) {
      return buffer;
    }

    const roomSize = clamp(this.getNumericEffectParam(effect, 'roomSize', 0.35), 0, 1);
    const decaySeconds = clamp(this.getNumericEffectParam(effect, 'decaySeconds', 1.2), 0.1, 12);
    const damping = clamp(this.getNumericEffectParam(effect, 'damping', 0.35), 0, 1);
    const output = this.createMutableAudioBufferLike(buffer);
    const baseDelaysMs = [23, 31, 37, 43, 53, 61];
    const roomScale = 0.35 + roomSize * 1.65;
    const dampingKeep = 1 - damping * 0.72;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      const channelOffset = channel * 0.17;
      const delays = baseDelaysMs.map(delayMs =>
        Math.max(1, Math.round(buffer.sampleRate * (delayMs * (roomScale + channelOffset)) / 1000))
      );
      const lines = delays.map(delay => new Float32Array(delay));
      const positions = delays.map(() => 0);
      const filtered = delays.map(() => 0);
      const feedbacks = delays.map(delay => {
        const delaySeconds = delay / buffer.sampleRate;
        return clamp(Math.pow(0.001, delaySeconds / decaySeconds), 0.08, 0.93);
      });

      for (let index = 0; index < buffer.length; index += 1) {
        const dry = input[index] ?? 0;
        let wet = 0;

        for (let tap = 0; tap < lines.length; tap += 1) {
          const line = lines[tap];
          const position = positions[tap];
          const delayed = line[position] ?? 0;
          filtered[tap] = filtered[tap] * (1 - dampingKeep) + delayed * dampingKeep;
          wet += filtered[tap];
          line[position] = clamp(dry + filtered[tap] * feedbacks[tap], -4, 4);
          positions[tap] = (position + 1) % line.length;
        }

        wet /= Math.max(1, lines.length);
        target[index] = dry * (1 - mix) + wet * mix;
      }
    }

    return output;
  }

  /**
   * Apply simple gain without automation (utility function)
   */
  async applyGain(buffer: AudioBuffer, gain: number): Promise<AudioBuffer> {
    if (Math.abs(gain - 1) < 0.001) {
      return buffer;
    }

    const audioContext = new AudioContext();
    const newBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const inputData = buffer.getChannelData(ch);
      const outputData = newBuffer.getChannelData(ch);

      for (let i = 0; i < buffer.length; i++) {
        outputData[i] = inputData[i] * gain;
      }
    }

    audioContext.close();
    return newBuffer;
  }

  /**
   * Apply simple EQ without automation (utility function)
   */
  async applyEQ(buffer: AudioBuffer, gains: number[]): Promise<AudioBuffer> {
    // Check if all gains are zero (no EQ)
    if (gains.every(g => Math.abs(g) < 0.01)) {
      return buffer;
    }

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    // Create and connect filters
    const filters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = offlineContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = gains[i] ?? 0;
      return filter;
    });

    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(offlineContext.destination);

    source.start(0);
    return await offlineContext.startRendering();
  }
}

// Default instance
export const audioEffectRenderer = new AudioEffectRenderer();
