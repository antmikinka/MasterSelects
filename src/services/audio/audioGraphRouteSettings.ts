import { AUDIO_EQ_BAND_PARAMS, hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { clampAudioPan, dbToLinearGain, finiteNumber } from '../../engine/audio/audioMath';
import type {
  AudioEffectInstance,
  Effect,
  MasterAudioState,
  TimelineClip,
  TimelineTrack,
} from '../../types';
import type { AudioGraphEffectPlanStep } from '../../engine/audio/AudioGraphTypes';

export interface AudioRouteEffectSettings {
  volume: number;
  eqGains: number[];
  processors: LiveAudioRouteProcessor[];
}

export interface LiveAudioRouteSettings extends AudioRouteEffectSettings {
  muted: boolean;
  pan: number;
}

export type LiveAudioRouteProcessor =
  | {
      id: string;
      type: 'high-pass' | 'low-pass';
      frequencyHz: number;
      q: number;
    }
  | {
      id: string;
      type: 'compressor';
      thresholdDb: number;
      ratio: number;
      kneeDb: number;
      attackMs: number;
      releaseMs: number;
      makeupGainDb: number;
    }
  | {
      id: string;
      type: 'de-esser';
      frequencyHz: number;
      thresholdDb: number;
      ratio: number;
      kneeDb: number;
      attackMs: number;
      releaseMs: number;
      makeupGainDb: number;
    }
  | {
      id: string;
      type: 'delay';
      delayMs: number;
      feedback: number;
      mix: number;
      toneHz: number;
    }
  | {
      id: string;
      type: 'reverb';
      roomSize: number;
      decaySeconds: number;
      damping: number;
      mix: number;
    };

type AudioEffectInstanceWithRuntimeFlags = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

function createNeutralEffectSettings(): AudioRouteEffectSettings {
  return {
    volume: 1,
    eqGains: new Array(AUDIO_EQ_BAND_PARAMS.length).fill(0),
    processors: [],
  };
}

function mergeEffectSettings(
  target: AudioRouteEffectSettings,
  source: AudioRouteEffectSettings,
): void {
  target.volume *= source.volume;
  for (let index = 0; index < target.eqGains.length; index += 1) {
    target.eqGains[index] += source.eqGains[index] ?? 0;
  }
  target.processors.push(...source.processors);
}

function readAudioEffectParams(
  descriptorId: string,
  params: Record<string, unknown> | undefined,
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  if (descriptorId === 'audio-volume') {
    settings.volume *= Math.max(0, finiteNumber(params?.volume, 1));
    return settings;
  }

  if (descriptorId === 'audio-eq') {
    AUDIO_EQ_BAND_PARAMS.forEach((paramName, index) => {
      settings.eqGains[index] += finiteNumber(params?.[paramName], 0);
    });
    return settings;
  }

  if (descriptorId === 'audio-high-pass') {
    settings.processors.push({
      id: descriptorId,
      type: 'high-pass',
      frequencyHz: finiteNumber(params?.frequencyHz, 20),
      q: finiteNumber(params?.q, 0.707),
    });
    return settings;
  }

  if (descriptorId === 'audio-low-pass') {
    settings.processors.push({
      id: descriptorId,
      type: 'low-pass',
      frequencyHz: finiteNumber(params?.frequencyHz, 22000),
      q: finiteNumber(params?.q, 0.707),
    });
    return settings;
  }

  if (descriptorId === 'audio-compressor') {
    settings.processors.push({
      id: descriptorId,
      type: 'compressor',
      thresholdDb: finiteNumber(params?.thresholdDb, 0),
      ratio: finiteNumber(params?.ratio, 1),
      kneeDb: finiteNumber(params?.kneeDb, 0),
      attackMs: finiteNumber(params?.attackMs, 10),
      releaseMs: finiteNumber(params?.releaseMs, 120),
      makeupGainDb: finiteNumber(params?.makeupGainDb, 0),
    });
  }

  if (descriptorId === 'audio-de-esser') {
    settings.processors.push({
      id: descriptorId,
      type: 'de-esser',
      frequencyHz: finiteNumber(params?.frequencyHz, 6500),
      thresholdDb: finiteNumber(params?.thresholdDb, 0),
      ratio: finiteNumber(params?.ratio, 1),
      kneeDb: finiteNumber(params?.kneeDb, 6),
      attackMs: finiteNumber(params?.attackMs, 1),
      releaseMs: finiteNumber(params?.releaseMs, 80),
      makeupGainDb: finiteNumber(params?.makeupGainDb, 0),
    });
  }

  if (descriptorId === 'audio-delay') {
    const mix = finiteNumber(params?.mix, 0);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'delay',
        delayMs: finiteNumber(params?.delayMs, 250),
        feedback: finiteNumber(params?.feedback, 0),
        mix,
        toneHz: finiteNumber(params?.toneHz, 12000),
      });
    }
  }

  if (descriptorId === 'audio-reverb') {
    const mix = finiteNumber(params?.mix, 0);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'reverb',
        roomSize: finiteNumber(params?.roomSize, 0.35),
        decaySeconds: finiteNumber(params?.decaySeconds, 1.2),
        damping: finiteNumber(params?.damping, 0.35),
        mix,
      });
    }
  }

  return settings;
}

export function getTrackAudioMuted(track: TimelineTrack): boolean {
  return track.audioState?.muted ?? track.muted === true;
}

export function getTrackAudioSolo(track: TimelineTrack): boolean {
  return track.audioState?.solo ?? track.solo === true;
}

export function getTrackVolumeDb(track: TimelineTrack): number {
  return finiteNumber(track.audioState?.volumeDb, 0);
}

export function getTrackPan(track: TimelineTrack): number {
  return clampAudioPan(track.audioState?.pan);
}

function getTrackSendReturnGain(track: TimelineTrack, trackVolume: number): number {
  return (track.audioState?.sends ?? []).reduce((total, send) => {
    if (send.enabled === false) return total;
    const sendGain = dbToLinearGain(send.gainDb);
    const faderGain = send.preFader ? 1 : trackVolume;
    return total + sendGain * faderGain;
  }, 0);
}

export function collectLegacyAudioEffectRouteSettings(
  effects: readonly Effect[] | undefined,
  excludedIds: ReadonlySet<string> = new Set(),
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  for (const effect of effects ?? []) {
    if (excludedIds.has(effect.id)) continue;
    if (effect.enabled === false || !hasAudioEffect(effect.type)) continue;
    const effectSettings = readAudioEffectParams(effect.type, effect.params);
    effectSettings.processors = effectSettings.processors.map(processor => ({
      ...processor,
      id: effect.id,
    }));
    mergeEffectSettings(settings, effectSettings);
  }

  return settings;
}

export function collectAudioEffectInstanceRouteSettings(
  effects: readonly AudioEffectInstance[] | undefined,
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  for (const effect of effects ?? []) {
    const runtimeEffect = effect as AudioEffectInstanceWithRuntimeFlags;
    if (
      runtimeEffect.enabled === false
      || runtimeEffect.disabled === true
      || runtimeEffect.bypassed === true
      || !hasAudioEffect(runtimeEffect.descriptorId)
    ) {
      continue;
    }
    const effectSettings = readAudioEffectParams(runtimeEffect.descriptorId, runtimeEffect.params);
    effectSettings.processors = effectSettings.processors.map(processor => ({
      ...processor,
      id: runtimeEffect.id,
    }));
    mergeEffectSettings(settings, effectSettings);
  }

  return settings;
}

export function audioGraphPlanStepsToEffectInstances(
  steps: readonly AudioGraphEffectPlanStep[] | undefined,
): AudioEffectInstance[] {
  return (steps ?? [])
    .filter(step => hasAudioEffect(step.descriptorId))
    .map(step => {
      const params: AudioEffectInstance['params'] = {};
      for (const [paramName, value] of Object.entries(step.params)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          params[paramName] = value;
        }
      }

      return {
        id: step.effectId,
        descriptorId: step.descriptorId,
        enabled: true,
        params,
        automationMode: step.automationMode,
      };
    });
}

export function createLiveAudioRouteSettings(input: {
  clip: TimelineClip;
  track?: TimelineTrack;
  masterAudioState?: MasterAudioState;
  interpolatedClipEffects: readonly Effect[];
}): LiveAudioRouteSettings {
  const clipAudioEffectIds = new Set((input.clip.audioState?.effectStack ?? []).map(effect => effect.id));
  const clipAudioSettings = collectAudioEffectInstanceRouteSettings(input.clip.audioState?.effectStack);
  const legacyClipSettings = collectLegacyAudioEffectRouteSettings(input.interpolatedClipEffects, clipAudioEffectIds);
  const trackEffectSettings = collectAudioEffectInstanceRouteSettings(input.track?.audioState?.effectStack);
  const masterEffectSettings = collectAudioEffectInstanceRouteSettings(input.masterAudioState?.effectStack);

  const route = createNeutralEffectSettings();
  mergeEffectSettings(route, clipAudioSettings);
  mergeEffectSettings(route, legacyClipSettings);
  mergeEffectSettings(route, trackEffectSettings);
  mergeEffectSettings(route, masterEffectSettings);

  const trackVolume = input.track ? dbToLinearGain(getTrackVolumeDb(input.track)) : 1;
  const sendReturnGain = input.track ? getTrackSendReturnGain(input.track, trackVolume) : 0;
  const masterVolume = dbToLinearGain(input.masterAudioState?.volumeDb);

  route.volume *= (trackVolume + sendReturnGain) * masterVolume;

  return {
    ...route,
    muted: input.clip.audioState?.muted === true || (input.track ? getTrackAudioMuted(input.track) : false),
    pan: input.track ? getTrackPan(input.track) : 0,
  };
}
