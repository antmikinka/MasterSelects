// Audio effect chain slice — DAW-style modular inserts per clip

import type { AudioEffect, AudioEffectType } from '../../types';
import type { AudioEffectActions, SliceCreator } from './types';
import { getAudioEffectDefaultParams } from '../../engine/audio/audioEffectRegistry';
import { generateEffectId } from './helpers/idGenerator';

export const createAudioEffectSlice: SliceCreator<AudioEffectActions> = (set, get) => ({
  addAudioEffect: (clipId, effectType) => {
    const { clips, invalidateCache } = get();
    const effect: AudioEffect = {
      id: generateEffectId(),
      type: effectType as AudioEffectType,
      enabled: true,
      params: getAudioEffectDefaultParams(effectType as AudioEffectType),
    };
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, audioEffects: [...(c.audioEffects ?? []), effect] }
          : c
      ),
    });
    invalidateCache();
  },

  removeAudioEffect: (clipId, effectId) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, audioEffects: (c.audioEffects ?? []).filter(e => e.id !== effectId) }
          : c
      ),
    });
    invalidateCache();
  },

  updateAudioEffect: (clipId, effectId, params) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              audioEffects: (c.audioEffects ?? []).map(e =>
                e.id === effectId
                  ? { ...e, params: { ...e.params, ...params } as AudioEffect['params'] }
                  : e
              ),
            }
          : c
      ),
    });
    invalidateCache();
  },

  setAudioEffectEnabled: (clipId, effectId, enabled) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              audioEffects: (c.audioEffects ?? []).map(e =>
                e.id === effectId ? { ...e, enabled } : e
              ),
            }
          : c
      ),
    });
    invalidateCache();
  },

  reorderAudioEffect: (clipId, effectId, newIndex) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c => {
        if (c.id !== clipId) return c;
        const effects = [...(c.audioEffects ?? [])];
        const oldIndex = effects.findIndex(e => e.id === effectId);
        if (oldIndex === -1 || oldIndex === newIndex) return c;
        const [moved] = effects.splice(oldIndex, 1);
        effects.splice(newIndex, 0, moved);
        return { ...c, audioEffects: effects };
      }),
    });
    invalidateCache();
  },
});
