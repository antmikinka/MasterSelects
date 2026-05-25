// Clip effect actions slice - extracted from clipSlice

import type { AudioEffectInstance, Effect, EffectType, Keyframe, TimelineClip } from '../../types';
import type { ClipEffectActions, SliceCreator } from './types';
import { getDefaultEffectParams } from './utils';
import { generateEffectId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import {
  audioEffectInstanceRequiresProcessedAnalysis,
  legacyAudioEffectRequiresProcessedAnalysis,
} from '../../services/audio/processedWaveformEligibility';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';

function updateClipEffectState(
  clip: TimelineClip,
  updater: (clip: TimelineClip) => TimelineClip,
  invalidateProcessedAudio: boolean,
): TimelineClip {
  const updated = updater(clip);
  return invalidateProcessedAudio ? clearProcessedAudioAnalysisRefs(updated) : updated;
}

function createClipAudioEffectInstance(descriptorId: string): AudioEffectInstance | null {
  const descriptor = getAudioEffect(descriptorId);
  if (!descriptor) return null;

  return {
    id: generateEffectId(),
    descriptorId: descriptor.id,
    enabled: true,
    params: getAudioEffectDefaultParams(descriptor.id),
    automationMode: descriptor.automation === 'none' ? 'none' : 'clip',
  };
}

function effectStackRequiresProcessedAnalysis(
  effectStack: readonly AudioEffectInstance[] | undefined,
  keyframes: readonly Keyframe[] = [],
): boolean {
  return (effectStack ?? []).some(effect => audioEffectInstanceRequiresProcessedAnalysis(effect, keyframes));
}

export const createClipEffectSlice: SliceCreator<ClipEffectActions> = (set, get) => ({
  addClipEffect: (clipId, effectType) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const effect: Effect = {
      id: generateEffectId(),
      name: effectType,
      type: effectType as EffectType,
      enabled: true,
      params: getDefaultEffectParams(effectType),
    };
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => c.id === clipId
        ? updateClipEffectState(
            c,
            clip => ({ ...clip, effects: [...(clip.effects || []), effect] }),
            legacyAudioEffectRequiresProcessedAnalysis(effect, keyframes),
          )
        : c),
    });
    invalidateCache();
    return effect.id;
  },

  removeClipEffect: (clipId, effectId) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const removedEffect = c.effects.find(e => e.id === effectId);
        return updateClipEffectState(
          c,
          clip => ({ ...clip, effects: clip.effects.filter(e => e.id !== effectId) }),
          legacyAudioEffectRequiresProcessedAnalysis(removedEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  updateClipEffect: (clipId, effectId, params) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        const nextEffect = updatedEffect
          ? { ...updatedEffect, params: { ...updatedEffect.params, ...params } as Effect['params'] }
          : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId
              ? { ...e, params: { ...e.params, ...params } as Effect['params'] }
              : e),
          }),
          legacyAudioEffectRequiresProcessedAnalysis(updatedEffect, keyframes) ||
            legacyAudioEffectRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  setClipEffectEnabled: (clipId, effectId, enabled) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const updatedEffect = c.effects.find(e => e.id === effectId);
        const nextEffect = updatedEffect ? { ...updatedEffect, enabled } : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            effects: clip.effects.map(e => e.id === effectId ? { ...e, enabled } : e),
          }),
          legacyAudioEffectRequiresProcessedAnalysis(updatedEffect, keyframes) ||
            legacyAudioEffectRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  reorderClipEffect: (clipId, effectId, newIndex) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const movedEffect = c.effects.find(e => e.id === effectId);
        const effects = [...c.effects];
        const oldIndex = effects.findIndex(e => e.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effects.splice(oldIndex, 1);
        effects.splice(newIndex, 0, moved);
        return updateClipEffectState(
          c,
          clip => ({ ...clip, effects }),
          legacyAudioEffectRequiresProcessedAnalysis(movedEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  addClipAudioEffectInstance: (clipId, descriptorId) => {
    if (!hasAudioEffect(descriptorId)) return null;

    const { clips, clipKeyframes, invalidateCache } = get();
    const effect = createClipAudioEffectInstance(descriptorId);
    if (!effect) return null;

    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const audioState = c.audioState ?? {};
        const nextEffectStack = [...(audioState.effectStack ?? []), effect];
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: nextEffectStack,
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(effect, keyframes),
        );
      }),
    });
    invalidateCache();
    return effect.id;
  },

  removeClipAudioEffectInstance: (clipId, effectId) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const removedEffect = c.audioState.effectStack.find(effect => effect.id === effectId);
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: clip.audioState?.effectStack?.filter(effect => effect.id !== effectId) ?? [],
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(removedEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  updateClipAudioEffectInstance: (clipId, effectId, params) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const currentEffect = c.audioState.effectStack.find(effect => effect.id === effectId);
        const nextEffect = currentEffect
          ? { ...currentEffect, params: { ...currentEffect.params, ...params } as AudioEffectInstance['params'] }
          : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: clip.audioState?.effectStack?.map(effect => effect.id === effectId
                ? { ...effect, params: { ...effect.params, ...params } as AudioEffectInstance['params'] }
                : effect) ?? [],
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(currentEffect, keyframes) ||
            audioEffectInstanceRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  setClipAudioEffectInstanceEnabled: (clipId, effectId, enabled) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const currentEffect = c.audioState.effectStack.find(effect => effect.id === effectId);
        const nextEffect = currentEffect ? { ...currentEffect, enabled } : undefined;
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack: clip.audioState?.effectStack?.map(effect => effect.id === effectId
                ? { ...effect, enabled }
                : effect) ?? [],
            },
          }),
          audioEffectInstanceRequiresProcessedAnalysis(currentEffect, keyframes) ||
            audioEffectInstanceRequiresProcessedAnalysis(nextEffect, keyframes),
        );
      }),
    });
    invalidateCache();
  },

  reorderClipAudioEffectInstance: (clipId, effectId, newIndex) => {
    const { clips, clipKeyframes, invalidateCache } = get();
    const keyframes = clipKeyframes.get(clipId) ?? [];
    set({
      clips: clips.map(c => {
        if (c.id !== clipId || !c.audioState?.effectStack?.length) return c;
        const effectStack = [...c.audioState.effectStack];
        const oldIndex = effectStack.findIndex(effect => effect.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effectStack.splice(oldIndex, 1);
        const clampedIndex = Math.max(0, Math.min(effectStack.length, newIndex));
        effectStack.splice(clampedIndex, 0, moved);
        return updateClipEffectState(
          c,
          clip => ({
            ...clip,
            audioState: {
              ...(clip.audioState ?? {}),
              effectStack,
            },
          }),
          effectStackRequiresProcessedAnalysis(c.audioState.effectStack, keyframes),
        );
      }),
    });
    invalidateCache();
  },
});
