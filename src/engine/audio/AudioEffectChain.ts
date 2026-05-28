/**
 * AudioEffectChain — Pure Web Audio subgraph builder
 *
 * Builds a series of Web Audio API nodes from an AudioEffect[] array.
 * The chain is context-agnostic: works with AudioContext (real-time)
 * or OfflineAudioContext (export).
 *
 * Usage:
 *   const chain = buildAudioEffectChain(ctx, audioEffects);
 *   sourceNode.connect(chain.input);
 *   chain.output.connect(destination);
 *
 *   // Real-time param update (every frame):
 *   chain.setParam(effectId, 'volume', 0.8);
 *
 *   // Export keyframe automation:
 *   const param = chain.getAudioParam(effectId, 'band1k');
 *   param?.linearRampToValueAtTime(3.0, 2.5);
 */

import type { AudioEffect } from '../../types';
import { EQ_FREQUENCIES, EQ_BAND_PARAMS } from './audioEffectRegistry';

interface EffectNodes {
  input: AudioNode;
  output: AudioNode;
  audioParams: Map<string, AudioParam>;
  setParamValue(paramName: string, value: number): void;
  dispose(): void;
}

export interface AudioEffectChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Signature changes when effect list order or enabled state changes — triggers rebuild */
  readonly signature: string;
  setParam(effectId: string, paramName: string, value: number): void;
  getAudioParam(effectId: string, paramName: string): AudioParam | null;
  dispose(): void;
}

// ─── Effect node builders ──────────────────────────────────────────────────

function buildVolumeNodes(ctx: BaseAudioContext, params: Record<string, number | boolean | string>): EffectNodes {
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, (params.volume as number) ?? 1);

  return {
    input: gain,
    output: gain,
    audioParams: new Map([['volume', gain.gain]]),
    setParamValue(name, value) {
      if (name === 'volume') gain.gain.value = Math.max(0, value);
    },
    dispose() { try { gain.disconnect(); } catch { /* ignore */ } },
  };
}

function buildEQNodes(ctx: BaseAudioContext, params: Record<string, number | boolean | string>): EffectNodes {
  const filters: BiquadFilterNode[] = EQ_FREQUENCIES.map((freq, i) => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    f.gain.value = (params[EQ_BAND_PARAMS[i]] as number) ?? 0;
    return f;
  });

  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);

  return {
    input: filters[0],
    output: filters[filters.length - 1],
    audioParams: new Map(EQ_BAND_PARAMS.map((name, i) => [name, filters[i].gain])),
    setParamValue(name, value) {
      const idx = EQ_BAND_PARAMS.indexOf(name);
      if (idx >= 0) filters[idx].gain.value = value;
    },
    dispose() {
      for (const f of filters) try { f.disconnect(); } catch { /* ignore */ }
    },
  };
}

function buildCompressorNodes(ctx: BaseAudioContext, params: Record<string, number | boolean | string>): EffectNodes {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = (params.threshold as number) ?? -24;
  comp.knee.value      = (params.knee as number) ?? 30;
  comp.ratio.value     = (params.ratio as number) ?? 4;
  comp.attack.value    = (params.attack as number) ?? 0.003;
  comp.release.value   = (params.release as number) ?? 0.25;

  const makeupDb = (params.makeupGain as number) ?? 0;
  const makeup = ctx.createGain();
  makeup.gain.value = makeupDb <= -60 ? 0 : Math.pow(10, makeupDb / 20);

  comp.connect(makeup);

  return {
    input: comp,
    output: makeup,
    audioParams: new Map([
      ['threshold', comp.threshold],
      ['knee',      comp.knee],
      ['ratio',     comp.ratio],
      ['attack',    comp.attack],
      ['release',   comp.release],
    ]),
    setParamValue(name, value) {
      switch (name) {
        case 'threshold': comp.threshold.value = value; break;
        case 'knee':      comp.knee.value      = value; break;
        case 'ratio':     comp.ratio.value     = value; break;
        case 'attack':    comp.attack.value    = value; break;
        case 'release':   comp.release.value   = value; break;
        case 'makeupGain':
          makeup.gain.value = value <= -60 ? 0 : Math.pow(10, value / 20);
          break;
      }
    },
    dispose() {
      try { comp.disconnect(); } catch { /* ignore */ }
      try { makeup.disconnect(); } catch { /* ignore */ }
    },
  };
}

function buildHighpassNodes(ctx: BaseAudioContext, params: Record<string, number | boolean | string>): EffectNodes {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = (params.frequency as number) ?? 80;
  f.Q.value         = (params.Q as number) ?? 0.707;

  return {
    input: f, output: f,
    audioParams: new Map([['frequency', f.frequency], ['Q', f.Q]]),
    setParamValue(name, value) {
      if (name === 'frequency') f.frequency.value = value;
      else if (name === 'Q')   f.Q.value = value;
    },
    dispose() { try { f.disconnect(); } catch { /* ignore */ } },
  };
}

function buildLowpassNodes(ctx: BaseAudioContext, params: Record<string, number | boolean | string>): EffectNodes {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = (params.frequency as number) ?? 8000;
  f.Q.value         = (params.Q as number) ?? 0.707;

  return {
    input: f, output: f,
    audioParams: new Map([['frequency', f.frequency], ['Q', f.Q]]),
    setParamValue(name, value) {
      if (name === 'frequency') f.frequency.value = value;
      else if (name === 'Q')   f.Q.value = value;
    },
    dispose() { try { f.disconnect(); } catch { /* ignore */ } },
  };
}

function buildPassthrough(ctx: BaseAudioContext): EffectNodes {
  const g = ctx.createGain();
  g.gain.value = 1;
  return {
    input: g, output: g,
    audioParams: new Map(),
    setParamValue() {},
    dispose() { try { g.disconnect(); } catch { /* ignore */ } },
  };
}

function buildEffectNodes(ctx: BaseAudioContext, effect: AudioEffect): EffectNodes {
  switch (effect.type) {
    case 'audio-volume':     return buildVolumeNodes(ctx, effect.params);
    case 'audio-eq':         return buildEQNodes(ctx, effect.params);
    case 'audio-compressor': return buildCompressorNodes(ctx, effect.params);
    case 'audio-highpass':   return buildHighpassNodes(ctx, effect.params);
    case 'audio-lowpass':    return buildLowpassNodes(ctx, effect.params);
    default:                 return buildPassthrough(ctx);
  }
}

// ─── Chain signature ───────────────────────────────────────────────────────

function computeSignature(effects: AudioEffect[]): string {
  // Include ID and enabled state — either change requires a graph rebuild
  return effects.map(e => `${e.id}:${e.enabled ? '1' : '0'}`).join('|');
}

// ─── Public builder ────────────────────────────────────────────────────────

export function buildAudioEffectChain(
  ctx: BaseAudioContext,
  effects: AudioEffect[]
): AudioEffectChain {
  const signature = computeSignature(effects);
  const activeEffects = effects.filter(e => e.enabled);

  // No active effects → passthrough node
  if (activeEffects.length === 0) {
    const pt = buildPassthrough(ctx);
    return {
      input: pt.input,
      output: pt.output,
      signature,
      setParam: () => {},
      getAudioParam: () => null,
      dispose: pt.dispose,
    };
  }

  // Build nodes for each active effect
  const nodeMap = new Map<string, EffectNodes>();
  for (const effect of activeEffects) {
    nodeMap.set(effect.id, buildEffectNodes(ctx, effect));
  }

  // Connect in series: effect[0].output → effect[1].input → ...
  const nodeArray = activeEffects.map(e => nodeMap.get(e.id)!);
  for (let i = 0; i < nodeArray.length - 1; i++) {
    nodeArray[i].output.connect(nodeArray[i + 1].input);
  }

  return {
    input:     nodeArray[0].input,
    output:    nodeArray[nodeArray.length - 1].output,
    signature,

    setParam(effectId, paramName, value) {
      nodeMap.get(effectId)?.setParamValue(paramName, value);
    },

    getAudioParam(effectId, paramName) {
      return nodeMap.get(effectId)?.audioParams.get(paramName) ?? null;
    },

    dispose() {
      for (const nodes of nodeMap.values()) nodes.dispose();
    },
  };
}
