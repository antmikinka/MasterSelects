import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineToolId, TimelineToolPreview } from '../../../stores/timeline/types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  isTimelineBladeTool,
} from '../tools/pointer/timelineToolPointerDispatcher';

type ApplyTimelineEditOperation = (
  operation: TimelineEditOperation,
  options: { source: 'ui'; historyLabel: string },
) => unknown;

export function useClipTimelineToolPointer(input: {
  clip: TimelineClip;
  track: TimelineTrack;
  clips: TimelineClip[];
  activeTimelineToolId: TimelineToolId;
  timelineToolPreview: TimelineToolPreview | null;
  canHandleTimelineToolPointer: boolean;
  playheadPosition: number;
  snappingEnabled: boolean;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  isBladeToolActive: boolean;
  setTimelineToolPreview: (preview: TimelineToolPreview | null) => void;
  applyTimelineEditOperation: ApplyTimelineEditOperation;
  setActiveTimelineTool: (toolId: TimelineToolId) => void;
}) {
  const {
    clip,
    track,
    clips,
    activeTimelineToolId,
    timelineToolPreview,
    canHandleTimelineToolPointer,
    playheadPosition,
    snappingEnabled,
    displayStartTime,
    displayDuration,
    width,
    isBladeToolActive,
    setTimelineToolPreview,
    applyTimelineEditOperation,
    setActiveTimelineTool,
  } = input;

  const linkedClip = clip.linkedClipId
    ? clips.find(candidate => candidate.id === clip.linkedClipId)
    : null;
  const reverseLinkedClip = clips.find(candidate => candidate.linkedClipId === clip.id);
  const isDirectlyHovered = timelineToolPreview?.clipId === clip.id;
  const isLinkedToHovered = linkedClip && timelineToolPreview?.clipId === linkedClip.id;
  const isReverseLinkedToHovered = reverseLinkedClip && timelineToolPreview?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = isBladeToolActive &&
    timelineToolPreview &&
    isTimelineBladeTool(timelineToolPreview.toolId) &&
    timelineToolPreview.plane === 'clip-local' &&
    !timelineToolPreview.blocked &&
    (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

  const getClipPointerContext = useCallback((e: ReactMouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition,
      snappingEnabled,
      displayStartTime,
      displayDuration,
      width,
      clientX: e.clientX,
      rectLeft: rect.left,
      altKey: e.altKey,
    };
  }, [
    activeTimelineToolId,
    clip,
    clips,
    displayDuration,
    displayStartTime,
    playheadPosition,
    snappingEnabled,
    track,
    width,
  ]);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!canHandleTimelineToolPointer) return;

    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
      return;
    }
    setTimelineToolPreview(result.preview ?? null);
  }, [
    canHandleTimelineToolPointer,
    clip.id,
    getClipPointerContext,
    setTimelineToolPreview,
    timelineToolPreview?.clipId,
  ]);

  const handleMouseLeave = useCallback(() => {
    if (!canHandleTimelineToolPointer) return;

    if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
  }, [
    canHandleTimelineToolPointer,
    clip.id,
    setTimelineToolPreview,
    timelineToolPreview?.clipId,
  ]);

  const handleClick = useCallback((e: ReactMouseEvent) => {
    const result = dispatchTimelineClipPointerClick(getClipPointerContext(e));
    if (!result.handled) return;
    e.preventDefault();
    e.stopPropagation();

    if (result.operation) {
      applyTimelineEditOperation(result.operation, {
        source: 'ui',
        historyLabel: result.operation.type === 'select-clips-from-time'
          ? 'Track select'
          : result.operation.type === 'split-all-at-time'
            ? 'Blade all tracks'
            : 'Blade clip',
      });
    }
    if (result.nextToolId) setActiveTimelineTool(result.nextToolId);
    setTimelineToolPreview(null);
  }, [
    applyTimelineEditOperation,
    getClipPointerContext,
    setActiveTimelineTool,
    setTimelineToolPreview,
  ]);

  const cutIndicatorX = shouldShowCutIndicator && timelineToolPreview?.time !== undefined
    ? ((timelineToolPreview.time - displayStartTime) / displayDuration) * width
    : null;

  return {
    shouldShowCutIndicator: Boolean(shouldShowCutIndicator),
    cutIndicatorX,
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  };
}
