import type { TimelinePaintSourceClip } from '../../../timeline';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import {
  resolveTimelineClipCanvasPaintVisuals,
  type TimelineClipCanvasPaintVisuals,
} from './timelineClipCanvasPaintVisualContributors';

export interface TimelineClipCanvasWorkerPaintClipInput {
  id: string;
  trackId?: string;
  label: string;
  startTime: number;
  duration: number;
  isAudio: boolean;
  visuals: TimelineClipCanvasPaintVisuals;
}

export function createTimelineClipCanvasWorkerPaintClipInput(
  clip: TimelinePaintSourceClip,
): TimelineClipCanvasWorkerPaintClipInput {
  return {
    id: clip.id,
    trackId: clip.trackId,
    label: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    isAudio: isTimelineClipCanvasAudioClip(clip),
    visuals: resolveTimelineClipCanvasPaintVisuals(clip),
  };
}
