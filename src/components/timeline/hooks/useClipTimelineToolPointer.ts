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
  const linkedClip = input.clip.linkedClipId
    ? input.clips.find(candidate => candidate.id === input.clip.linkedClipId)
    : null;
  const reverseLinkedClip = input.clips.find(candidate => candidate.linkedClipId === input.clip.id);
  const isDirectlyHovered = input.timelineToolPreview?.clipId === input.clip.id;
  const isLinkedToHovered = linkedClip && input.timelineToolPreview?.clipId === linkedClip.id;
  const isReverseLinkedToHovered = reverseLinkedClip && input.timelineToolPreview?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = input.isBladeToolActive &&
    input.timelineToolPreview &&
    isTimelineBladeTool(input.timelineToolPreview.toolId) &&
    input.timelineToolPreview.plane === 'clip-local' &&
    !input.timelineToolPreview.blocked &&
    (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

  const getClipPointerContext = useCallback((e: ReactMouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      toolId: input.activeTimelineToolId,
      clip: input.clip,
      track: input.track,
      clips: input.clips,
      playheadPosition: input.playheadPosition,
      snappingEnabled: input.snappingEnabled,
      displayStartTime: input.displayStartTime,
      displayDuration: input.displayDuration,
      width: input.width,
      clientX: e.clientX,
      rectLeft: rect.left,
      altKey: e.altKey,
    };
  }, [
    input.activeTimelineToolId,
    input.clip,
    input.clips,
    input.displayDuration,
    input.displayStartTime,
    input.playheadPosition,
    input.snappingEnabled,
    input.track,
    input.width,
  ]);

  const handleMouseMove = useCallback((e: ReactMouseEvent) => {
    if (!input.canHandleTimelineToolPointer) return;

    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (input.timelineToolPreview?.clipId === input.clip.id) input.setTimelineToolPreview(null);
      return;
    }
    input.setTimelineToolPreview(result.preview ?? null);
  }, [
    getClipPointerContext,
    input.canHandleTimelineToolPointer,
    input.clip.id,
    input.setTimelineToolPreview,
    input.timelineToolPreview?.clipId,
  ]);

  const handleMouseLeave = useCallback(() => {
    if (!input.canHandleTimelineToolPointer) return;

    if (input.timelineToolPreview?.clipId === input.clip.id) input.setTimelineToolPreview(null);
  }, [
    input.canHandleTimelineToolPointer,
    input.clip.id,
    input.setTimelineToolPreview,
    input.timelineToolPreview?.clipId,
  ]);

  const handleClick = useCallback((e: ReactMouseEvent) => {
    const result = dispatchTimelineClipPointerClick(getClipPointerContext(e));
    if (!result.handled) return;
    e.preventDefault();
    e.stopPropagation();

    if (result.operation) {
      input.applyTimelineEditOperation(result.operation, {
        source: 'ui',
        historyLabel: result.operation.type === 'select-clips-from-time'
          ? 'Track select'
          : result.operation.type === 'split-all-at-time'
            ? 'Blade all tracks'
            : 'Blade clip',
      });
    }
    if (result.nextToolId) input.setActiveTimelineTool(result.nextToolId);
    input.setTimelineToolPreview(null);
  }, [
    getClipPointerContext,
    input.applyTimelineEditOperation,
    input.setActiveTimelineTool,
    input.setTimelineToolPreview,
  ]);

  const cutIndicatorX = shouldShowCutIndicator && input.timelineToolPreview?.time !== undefined
    ? ((input.timelineToolPreview.time - input.displayStartTime) / input.displayDuration) * input.width
    : null;

  return {
    shouldShowCutIndicator: Boolean(shouldShowCutIndicator),
    cutIndicatorX,
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  };
}
