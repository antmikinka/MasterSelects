import { useMemo } from 'react';
import type { TimelineClipProps } from '../types';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
} from '../utils/clipSourceTiming';
import {
  resolveHorizontalRenderWindow,
  resolveTimelineViewportWidth,
} from '../utils/waveformRenderGeometry';
import { useClipThumbnailFilmstripPlan } from './useClipThumbnailFilmstripPlan';
import {
  MIN_CLIP_DURATION,
  TIMELINE_RENDER_OVERSCAN_PX,
} from '../timelineRenderConstants';

const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;

function getSlippedSourceWindow(
  clip: TimelineClipProps['clip'],
  sourceDelta: number,
): { inPoint: number; outPoint: number } {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const maxInPoint = Math.max(0, getTimelineClipSourceDuration(clip) - visibleSourceDuration);
  const inPoint = Math.max(0, Math.min(maxInPoint, clip.inPoint + sourceDelta));
  return {
    inPoint,
    outPoint: inPoint + visibleSourceDuration,
  };
}

export function useClipTimelineRenderGeometry(input: {
  clip: TimelineClipProps['clip'];
  clips: readonly TimelineClipProps['clip'][];
  isDragging: boolean;
  isTrimming: boolean;
  isLinkedToDragging: boolean;
  isLinkedToTrimming: boolean;
  isTrimFollower: boolean;
  clipDrag: TimelineClipProps['clipDrag'];
  clipTrim: TimelineClipProps['clipTrim'];
  timelineViewportWidth: number;
  scrollX: number;
  thumbnailsEnabled: boolean;
  isAudioClip: boolean;
  showsStaticClipArtwork: boolean;
  timeToPixel: TimelineClipProps['timeToPixel'];
}) {
  const draggedClip = input.clipDrag
    ? input.clips.find((clip) => clip.id === input.clipDrag?.clipId)
    : null;
  const trimmedClip = input.clipTrim
    ? input.clips.find((clip) => clip.id === input.clipTrim?.clipId)
    : null;

  let displayStartTime = input.clip.startTime;
  let displayDuration = input.clip.duration;
  let displayInPoint = input.clip.inPoint;
  let displayOutPoint = input.clip.outPoint;

  if (input.isTrimming && input.clipTrim) {
    const deltaTime = input.clipTrim.appliedDelta;
    const sourceType = input.clip.source?.type;
    const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'splat-effector' || sourceType === 'math-scene';
    const canLoopExtendRight = canLoopExtendTimelineVectorClip(input.clip);
    const maxDuration = isInfiniteClip
      ? Number.MAX_SAFE_INTEGER
      : (input.clip.source?.naturalDuration || input.clip.duration);

    if (input.clipTrim.edge === 'left') {
      const maxTrim = input.clipTrim.originalDuration - MIN_CLIP_DURATION;
      const minTrim = isInfiniteClip
        ? -input.clipTrim.originalStartTime
        : -input.clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = input.clipTrim.originalStartTime + clampedDelta;
      displayDuration = input.clipTrim.originalDuration - clampedDelta;
      displayInPoint = input.clipTrim.originalInPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - input.clipTrim.originalOutPoint;
      const minTrim = -(input.clipTrim.originalDuration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = input.clipTrim.originalDuration + clampedDelta;
      displayOutPoint = input.clipTrim.originalOutPoint + clampedDelta;
    }
  } else if (input.clipTrim && (input.isTrimFollower || (input.isLinkedToTrimming && trimmedClip))) {
    const deltaTime = input.clipTrim.appliedDelta;
    const canLoopExtendRight = canLoopExtendTimelineVectorClip(input.clip);
    const maxDuration = input.clip.source?.naturalDuration || input.clip.duration;

    if (input.clipTrim.edge === 'left') {
      const maxTrim = input.clip.duration - MIN_CLIP_DURATION;
      const minTrim = -input.clip.inPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = input.clip.startTime + clampedDelta;
      displayDuration = input.clip.duration - clampedDelta;
      displayInPoint = input.clip.inPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - input.clip.outPoint;
      const minTrim = -(input.clip.duration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = input.clip.duration + clampedDelta;
      displayOutPoint = input.clip.outPoint + clampedDelta;
    }
  }

  const isSlipPreview =
    input.clipDrag?.toolGesture === 'slip' &&
    input.clipDrag.sourceTimeDelta !== undefined &&
    (input.isDragging || (!input.clipDrag.altKeyPressed && input.isLinkedToDragging));
  if (isSlipPreview) {
    const sourceWindow = getSlippedSourceWindow(input.clip, input.clipDrag?.sourceTimeDelta ?? 0);
    displayInPoint = sourceWindow.inPoint;
    displayOutPoint = sourceWindow.outPoint;
  }

  const width = input.timeToPixel(displayDuration);
  const isClipPositionDragPreview = !input.clipDrag?.toolGesture && (
    input.isDragging ||
    input.isLinkedToDragging ||
    (
      input.clipDrag?.multiSelectClipIds?.includes(input.clip.id) &&
      input.clipDrag.multiSelectTimeDelta !== undefined
    )
  );

  let left = input.timeToPixel(displayStartTime);
  if (input.isDragging && input.clipDrag) {
    if (input.clipDrag.snappedTime !== null) {
      left = input.timeToPixel(input.clipDrag.snappedTime);
    }
  } else if (input.isLinkedToDragging && input.clipDrag && draggedClip) {
    if (input.clipDrag.snappedTime !== null) {
      const newDragTime = input.clipDrag.snappedTime;
      const timeDelta = newDragTime - draggedClip.startTime;
      left = input.timeToPixel(Math.max(0, input.clip.startTime + timeDelta));
    }
  } else if (input.clipDrag?.multiSelectClipIds?.includes(input.clip.id) && input.clipDrag.multiSelectTimeDelta !== undefined) {
    left = input.timeToPixel(Math.max(0, input.clip.startTime + input.clipDrag.multiSelectTimeDelta));
  }

  const visibleTimelineViewportWidth = input.timelineViewportWidth > 0
    ? input.timelineViewportWidth
    : TIMELINE_VIEWPORT_FALLBACK_PX;
  const renderTimelineViewportWidth = resolveTimelineViewportWidth({
    timelineViewportWidth: input.timelineViewportWidth,
    fallbackPx: TIMELINE_VIEWPORT_FALLBACK_PX,
    minPx: TIMELINE_VIEWPORT_MIN_PX,
  });
  const staticContentRenderLeft = isClipPositionDragPreview
    ? input.timeToPixel(displayStartTime)
    : left;
  const waveformRenderWindow = useMemo(() => (
    resolveHorizontalRenderWindow({
      scrollX: input.scrollX,
      contentLeft: staticContentRenderLeft,
      contentWidth: width,
      viewportWidth: renderTimelineViewportWidth,
      overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    })
  ), [input.scrollX, renderTimelineViewportWidth, staticContentRenderLeft, width]);
  const thumbnailPlan = useClipThumbnailFilmstripPlan({
    clip: input.clip,
    thumbnailsEnabled: input.thumbnailsEnabled,
    isAudioClip: input.isAudioClip,
    showsStaticClipArtwork: input.showsStaticClipArtwork,
    scrollX: input.scrollX,
    contentLeft: staticContentRenderLeft,
    width,
    viewportWidth: renderTimelineViewportWidth,
    displayInPoint,
    displayOutPoint,
  });

  return {
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    left,
    visibleTimelineViewportWidth,
    renderTimelineViewportWidth,
    waveformRenderWindow,
    ...thumbnailPlan,
  };
}
