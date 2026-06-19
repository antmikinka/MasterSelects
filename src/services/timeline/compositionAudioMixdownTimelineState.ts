import { useTimelineStore } from '../../stores/timeline';
import type { CompositionAudioMixdownRequestResult } from './compositionAudioMixdownCache';
import { applyCompositionAudioMixdownToClips } from './compositionAudioMixdownClipState';

export function applyCompositionAudioMixdownToTimelineClip(
  clipId: string,
  result: CompositionAudioMixdownRequestResult,
  options: { audioElement?: HTMLAudioElement } = {},
): void {
  useTimelineStore.setState((state) => ({
    clips: applyCompositionAudioMixdownToClips(state.clips, clipId, result, options),
  }));
}
