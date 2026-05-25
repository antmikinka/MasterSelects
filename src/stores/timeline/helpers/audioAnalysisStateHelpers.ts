import type { TimelineClip } from '../../../types';

const AUDIO_RELEVANT_UPDATE_KEYS = new Set<keyof TimelineClip>([
  'audioState',
  'speed',
  'reversed',
  'inPoint',
  'outPoint',
  'duration',
]);

export function clipUpdatesInvalidateProcessedAudioAnalysis(updates: Partial<TimelineClip>): boolean {
  return (Object.keys(updates) as Array<keyof TimelineClip>).some(key => AUDIO_RELEVANT_UPDATE_KEYS.has(key));
}

export function clearProcessedAudioAnalysisRefs(clip: TimelineClip): TimelineClip {
  if (!clip.audioState?.processedAnalysisRefs) {
    return clip;
  }

  const audioState = { ...clip.audioState };
  delete audioState.processedAnalysisRefs;
  return {
    ...clip,
    audioState,
  };
}

export function applyClipUpdatesWithAudioAnalysisInvalidation(
  clip: TimelineClip,
  updates: Partial<TimelineClip>,
): TimelineClip {
  const invalidateProcessedAnalysis = clipUpdatesInvalidateProcessedAudioAnalysis(updates);
  const hasAudioStateUpdate = Object.prototype.hasOwnProperty.call(updates, 'audioState');
  const nextClip: TimelineClip = {
    ...clip,
    ...updates,
    ...(hasAudioStateUpdate && updates.audioState
      ? { audioState: { ...clip.audioState, ...updates.audioState } }
      : hasAudioStateUpdate
        ? { audioState: updates.audioState }
      : {}),
  };

  return invalidateProcessedAnalysis ? clearProcessedAudioAnalysisRefs(nextClip) : nextClip;
}
