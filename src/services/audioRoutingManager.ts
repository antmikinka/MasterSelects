/**
 * AudioRoutingManager - Routes audio through Web Audio API for live EQ and volume
 *
 * Architecture:
 * HTMLMediaElement → MediaElementSourceNode → GainNode → EQ Filters → Destination
 *
 * Efficiency:
 * - Single shared AudioContext
 * - Lazy connection (only when playing)
 * - Node caching per element (MediaElementSourceNode can only be created once)
 * - Delta updates for filter gains
 */

import { clampAudioPan, dbToLinearGain, finiteNumber } from '../engine/audio/audioMath';
import { Logger } from './logger';
import type { LiveAudioRouteProcessor } from './audio/audioGraphRouteSettings';
import type { AudioMeterSnapshot } from '../types';
import { calculateAudioMeterSnapshot } from './audio/audioMetering';

const log = Logger.create('AudioRouting');

// EQ frequencies (10-band)
const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface AudioRoute {
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  analyserNode: AnalyserNode;
  eqFilters: BiquadFilterNode[];
  processorNodes: AudioRouteProcessorNode[];
  meterBuffer: Float32Array<ArrayBuffer>;
  isConnected: boolean;
  lastVolume: number;
  lastPan: number;
  lastEQGains: number[];
  lastProcessorSignature: string;
}

interface AudioRouteProcessorNode {
  type: LiveAudioRouteProcessor['type'];
  nodes: AudioNode[];
  inputNode?: AudioNode;
  outputNode?: AudioNode;
  filter?: BiquadFilterNode;
  compressor?: DynamicsCompressorNode;
  makeupGain?: GainNode;
  delay?: DelayNode;
  feedbackGain?: GainNode;
  dryGain?: GainNode;
  wetGain?: GainNode;
  toneFilter?: BiquadFilterNode;
  convolver?: ConvolverNode;
  lastReverbSignature?: string;
  lowBandFilter?: BiquadFilterNode;
  highBandFilter?: BiquadFilterNode;
}

function clampFrequency(ctx: BaseAudioContext, value: number): number {
  const nyquist = Math.max(20, ctx.sampleRate / 2 - 1);
  return Math.max(10, Math.min(nyquist, finiteNumber(value, 1000)));
}

function processorSignature(processors: readonly LiveAudioRouteProcessor[] = []): string {
  return processors.map(processor => `${processor.id}:${processor.type}`).join('|');
}

function updateProcessorNode(
  ctx: BaseAudioContext,
  node: AudioRouteProcessorNode,
  processor: LiveAudioRouteProcessor,
): void {
  if ((processor.type === 'high-pass' || processor.type === 'low-pass') && node.filter) {
    node.filter.type = processor.type === 'high-pass' ? 'highpass' : 'lowpass';
    node.filter.frequency.value = clampFrequency(ctx, processor.frequencyHz);
    node.filter.Q.value = Math.max(0.0001, Math.min(30, finiteNumber(processor.q, 0.707)));
    return;
  }

  if (processor.type === 'compressor' && node.compressor) {
    node.compressor.threshold.value = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
    node.compressor.ratio.value = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
    node.compressor.knee.value = Math.max(0, Math.min(40, finiteNumber(processor.kneeDb, 0)));
    node.compressor.attack.value = Math.max(0, Math.min(1, finiteNumber(processor.attackMs, 10) / 1000));
    node.compressor.release.value = Math.max(0.001, Math.min(1, finiteNumber(processor.releaseMs, 120) / 1000));
    if (node.makeupGain) {
      node.makeupGain.gain.value = Math.max(0, Math.min(4, dbToLinearGain(processor.makeupGainDb)));
    }
    return;
  }

  if (
    processor.type === 'de-esser' &&
    node.lowBandFilter &&
    node.highBandFilter &&
    node.compressor &&
    node.makeupGain
  ) {
    const frequency = clampFrequency(ctx, processor.frequencyHz);
    node.lowBandFilter.frequency.value = frequency;
    node.highBandFilter.frequency.value = frequency;
    node.lowBandFilter.Q.value = 0.707;
    node.highBandFilter.Q.value = 0.707;
    node.compressor.threshold.value = Math.max(-100, Math.min(0, finiteNumber(processor.thresholdDb, 0)));
    node.compressor.ratio.value = Math.max(1, Math.min(20, finiteNumber(processor.ratio, 1)));
    node.compressor.knee.value = Math.max(0, Math.min(40, finiteNumber(processor.kneeDb, 6)));
    node.compressor.attack.value = Math.max(0, Math.min(1, finiteNumber(processor.attackMs, 1) / 1000));
    node.compressor.release.value = Math.max(0.001, Math.min(1, finiteNumber(processor.releaseMs, 80) / 1000));
    node.makeupGain.gain.value = Math.max(0, Math.min(4, dbToLinearGain(processor.makeupGainDb)));
    return;
  }

  if (processor.type === 'delay' && node.delay && node.feedbackGain && node.dryGain && node.wetGain && node.toneFilter) {
    node.delay.delayTime.value = Math.max(0.001, Math.min(2, finiteNumber(processor.delayMs, 250) / 1000));
    node.feedbackGain.gain.value = Math.max(0, Math.min(0.95, finiteNumber(processor.feedback, 0)));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    node.toneFilter.frequency.value = clampFrequency(ctx, finiteNumber(processor.toneHz, 12000));
    return;
  }

  if (processor.type === 'reverb' && node.convolver && node.dryGain && node.wetGain) {
    const roomSize = Math.max(0, Math.min(1, finiteNumber(processor.roomSize, 0.35)));
    const decaySeconds = Math.max(0.1, Math.min(12, finiteNumber(processor.decaySeconds, 1.2)));
    const damping = Math.max(0, Math.min(1, finiteNumber(processor.damping, 0.35)));
    const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
    const signature = `${ctx.sampleRate}:${roomSize.toFixed(3)}:${decaySeconds.toFixed(3)}:${damping.toFixed(3)}`;
    node.dryGain.gain.value = 1 - mix;
    node.wetGain.gain.value = mix;
    if (node.lastReverbSignature !== signature) {
      node.convolver.buffer = createReverbImpulse(ctx, roomSize, decaySeconds, damping);
      node.lastReverbSignature = signature;
    }
  }
}

function createReverbImpulse(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * decaySeconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const highDamping = 0.08 + damping * 0.72;
  const roomGain = 0.18 + roomSize * 0.42;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let filteredNoise = 0;
    let seed = 0x12345678 + channel * 0x9e3779b9;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      filteredNoise = filteredNoise * highDamping + noise * (1 - highDamping);
      const decay = Math.pow(1 - index / length, 2.4 + damping * 2.2);
      data[index] = filteredNoise * decay * roomGain;
    }
  }

  return buffer;
}

function reconnectCustomProcessorInternal(node: AudioRouteProcessorNode): void {
  if (
    node.type === 'delay' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.delay &&
    node.feedbackGain &&
    node.toneFilter &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.delay);
    node.delay.connect(node.toneFilter);
    node.toneFilter.connect(node.feedbackGain);
    node.feedbackGain.connect(node.delay);
    node.toneFilter.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'reverb' &&
    node.inputNode &&
    node.outputNode &&
    node.dryGain &&
    node.convolver &&
    node.wetGain
  ) {
    node.inputNode.connect(node.dryGain);
    node.dryGain.connect(node.outputNode);
    node.inputNode.connect(node.convolver);
    node.convolver.connect(node.wetGain);
    node.wetGain.connect(node.outputNode);
    return;
  }

  if (
    node.type === 'de-esser' &&
    node.inputNode &&
    node.outputNode &&
    node.lowBandFilter &&
    node.highBandFilter &&
    node.compressor &&
    node.makeupGain
  ) {
    node.inputNode.connect(node.lowBandFilter);
    node.inputNode.connect(node.highBandFilter);
    node.lowBandFilter.connect(node.outputNode);
    node.highBandFilter.connect(node.compressor);
    node.compressor.connect(node.makeupGain);
    node.makeupGain.connect(node.outputNode);
  }
}

class AudioRoutingManager {
  private audioContext: AudioContext | null = null;
  private routes = new Map<HTMLMediaElement, AudioRoute>();
  private contextResumePromise: Promise<void> | null = null;

  /**
   * Get or create the shared AudioContext
   */
  private async getContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      log.info('Created new AudioContext');
    }

    // Resume if suspended (autoplay policy)
    if (this.audioContext.state === 'suspended') {
      if (!this.contextResumePromise) {
        this.contextResumePromise = this.audioContext.resume().then(() => {
          this.contextResumePromise = null;
        });
      }
      await this.contextResumePromise;
    }

    return this.audioContext;
  }

  /**
   * Get or create audio route for an element
   */
  private async getOrCreateRoute(element: HTMLMediaElement): Promise<AudioRoute | null> {
    // Check if route already exists
    let route = this.routes.get(element);
    if (route) return route;

    try {
      const ctx = await this.getContext();

      // Create source node (can only be done ONCE per element)
      const sourceNode = ctx.createMediaElementSource(element);

      // Create gain node for volume
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1;

      const panNode = ctx.createStereoPanner();
      panNode.pan.value = 0;

      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.2;

      // Create EQ filter chain
      const eqFilters: BiquadFilterNode[] = EQ_FREQUENCIES.map(freq => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4; // Standard Q for 10-band EQ
        filter.gain.value = 0; // Default: no boost/cut
        return filter;
      });

      // Connect chain: source → gain → eq[0] → eq[1] → ... → eq[9] → destination
      route = {
        sourceNode,
        gainNode,
        panNode,
        analyserNode,
        eqFilters,
        processorNodes: [],
        meterBuffer: new Float32Array(analyserNode.fftSize),
        isConnected: true,
        lastVolume: 1,
        lastPan: 0,
        lastEQGains: new Array(10).fill(0),
        lastProcessorSignature: '',
      };
      this.reconnectRouteChain(route);

      this.routes.set(element, route);
      log.debug('Created audio route for element');

      return route;
    } catch (err) {
      // MediaElementSourceNode can fail if element is already connected elsewhere
      // or if there's a CORS issue with the audio source
      log.warn('Failed to create audio route:', err);
      return null;
    }
  }

  /**
   * Apply volume and EQ to an audio element
   * Call this every frame for elements that are playing
   */
  async applyEffects(
    element: HTMLMediaElement,
    volume: number,
    eqGains: number[], // Array of 10 gain values in dB (-12 to +12)
    pan = 0,
    processors: readonly LiveAudioRouteProcessor[] = []
  ): Promise<boolean> {
    const route = await this.getOrCreateRoute(element);
    if (!route) {
      // Fallback: just set element volume directly (no EQ)
      element.volume = Math.max(0, Math.min(1, volume));
      return false;
    }

    const ctx = this.audioContext;
    if (!ctx) return false;
    this.updateRouteProcessors(route, ctx, processors);

    // Update volume if changed (with small delta threshold)
    if (Math.abs(route.lastVolume - volume) > 0.001) {
      // Web Audio gain can go above 1, but clamp for sanity
      route.gainNode.gain.value = Math.max(0, Math.min(4, volume));
      route.lastVolume = volume;
    }

    const clampedPan = clampAudioPan(pan);
    if (Math.abs(route.lastPan - clampedPan) > 0.001) {
      route.panNode.pan.value = clampedPan;
      route.lastPan = clampedPan;
    }

    // Update EQ gains if changed
    for (let i = 0; i < 10; i++) {
      const gain = eqGains[i] ?? 0;
      if (Math.abs(route.lastEQGains[i] - gain) > 0.01) {
        route.eqFilters[i].gain.value = gain;
        route.lastEQGains[i] = gain;
      }
    }

    // When using Web Audio routing, the element volume should be 1
    // (volume is controlled by the GainNode)
    if (element.volume !== 1) {
      element.volume = 1;
    }

    return true;
  }

  /**
   * Check if an element has an active audio route
   */
  hasRoute(element: HTMLMediaElement): boolean {
    return this.routes.has(element);
  }

  getMeterSnapshot(element: HTMLMediaElement, updatedAt = performance.now()): AudioMeterSnapshot | null {
    const route = this.routes.get(element);
    if (!route) return null;

    route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
    return calculateAudioMeterSnapshot(route.meterBuffer, updatedAt);
  }

  /**
   * Disconnect and remove route for an element
   * Call when element is no longer needed
   */
  removeRoute(element: HTMLMediaElement): void {
    const route = this.routes.get(element);
    if (route) {
      try {
        route.sourceNode.disconnect();
        route.gainNode.disconnect();
        route.panNode.disconnect();
        route.analyserNode.disconnect();
        route.eqFilters.forEach(f => f.disconnect());
        route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      } catch {
        // Ignore disconnect errors
      }
      this.routes.delete(element);
      log.debug('Removed audio route');
    }
  }

  /**
   * Clean up all routes and close context
   */
  dispose(): void {
    for (const [element] of this.routes) {
      this.removeRoute(element);
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    log.info('AudioRoutingManager disposed');
  }

  /**
   * Get the number of active routes (for debugging)
   */
  get activeRouteCount(): number {
    return this.routes.size;
  }

  private createProcessorNode(
    ctx: BaseAudioContext,
    processor: LiveAudioRouteProcessor,
  ): AudioRouteProcessorNode {
    if (processor.type === 'high-pass' || processor.type === 'low-pass') {
      const filter = ctx.createBiquadFilter();
      const node: AudioRouteProcessorNode = {
        type: processor.type,
        nodes: [filter],
        filter,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'delay') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const delay = ctx.createDelay(2);
      const feedbackGain = ctx.createGain();
      const toneFilter = ctx.createBiquadFilter();
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      toneFilter.type = 'lowpass';
      input.connect(dryGain);
      dryGain.connect(output);
      input.connect(delay);
      delay.connect(toneFilter);
      toneFilter.connect(feedbackGain);
      feedbackGain.connect(delay);
      toneFilter.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        type: 'delay',
        nodes: [input, dryGain, delay, feedbackGain, toneFilter, wetGain, output],
        inputNode: input,
        outputNode: output,
        delay,
        feedbackGain,
        dryGain,
        wetGain,
        toneFilter,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'reverb') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const convolver = ctx.createConvolver();
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      input.connect(dryGain);
      dryGain.connect(output);
      input.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(output);
      const node: AudioRouteProcessorNode = {
        type: 'reverb',
        nodes: [input, dryGain, convolver, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        convolver,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'de-esser') {
      const input = ctx.createGain();
      const lowBandFilter = ctx.createBiquadFilter();
      const highBandFilter = ctx.createBiquadFilter();
      const compressor = ctx.createDynamicsCompressor();
      const makeupGain = ctx.createGain();
      const output = ctx.createGain();
      lowBandFilter.type = 'lowpass';
      highBandFilter.type = 'highpass';
      input.connect(lowBandFilter);
      input.connect(highBandFilter);
      lowBandFilter.connect(output);
      highBandFilter.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(output);
      const node: AudioRouteProcessorNode = {
        type: 'de-esser',
        nodes: [input, lowBandFilter, highBandFilter, compressor, makeupGain, output],
        inputNode: input,
        outputNode: output,
        lowBandFilter,
        highBandFilter,
        compressor,
        makeupGain,
      };
      updateProcessorNode(ctx, node, processor);
      return node;
    }

    const compressor = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const node: AudioRouteProcessorNode = {
      type: 'compressor',
      nodes: [compressor, makeupGain],
      compressor,
      makeupGain,
    };
    updateProcessorNode(ctx, node, processor);
    return node;
  }

  private updateRouteProcessors(
    route: AudioRoute,
    ctx: BaseAudioContext,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    const signature = processorSignature(processors);
    if (signature !== route.lastProcessorSignature) {
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      route.processorNodes = processors.map(processor => this.createProcessorNode(ctx, processor));
      route.lastProcessorSignature = signature;
      this.reconnectRouteChain(route);
      return;
    }

    processors.forEach((processor, index) => {
      const node = route.processorNodes[index];
      if (node) updateProcessorNode(ctx, node, processor);
    });
  }

  private reconnectRouteChain(route: AudioRoute): void {
    try {
      route.sourceNode.disconnect();
      route.gainNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.panNode.disconnect();
      route.analyserNode.disconnect();
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Disconnecting a partially connected graph can throw; rebuild below.
    }

    let tail: AudioNode = route.gainNode;
    route.sourceNode.connect(route.gainNode);

    for (const processor of route.processorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectCustomProcessorInternal(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }

    tail.connect(route.eqFilters[0]);
    for (let i = 0; i < route.eqFilters.length - 1; i++) {
      route.eqFilters[i].connect(route.eqFilters[i + 1]);
    }
    route.eqFilters[route.eqFilters.length - 1].connect(route.panNode);
    route.panNode.connect(route.analyserNode);
    route.analyserNode.connect(this.audioContext!.destination);
  }
}

// Singleton instance
export const audioRoutingManager = new AudioRoutingManager();
