import { useCallback, useEffect, type Dispatch, type SetStateAction, type MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionSelection,
  TimelineVideoBakeRegionSelection,
} from '../../../stores/timeline/types';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from '../utils/audioEditSelection';
import { isAudioRegionModifierPressed, isVideoBakeRegionModifierPressed } from '../utils/audioRegionDisplay';
import {
  frequencyHzFromSpectralY,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
} from '../utils/spectralSelection';

const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;

export type AudioRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};

export type VideoBakeRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};

export type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

export type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

export type SpectralRegionDragState = AudioRegionDragState & {
  anchorFrequencyHz: number;
  startClientY: number;
  rectTop: number;
  rectHeight: number;
  maxFrequencyHz: number;
  mode: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
};

type CommitAudioRegionOperationRange = (
  operationIds: string[],
  selection: TimelineAudioRegionSelection,
  historyLabel: string,
) => void;

export interface ClipRegionInteractions {
  timelineTimeFromAudioRegionClientX: (
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ) => number;
  sourceTimeToVideoBakeTimelineTime: (sourceTime: number) => number;
  handleAudioRegionMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleAudioRegionDoubleClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleVideoBakeRegionMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleVideoBakeRegionDoubleClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleAudioRegionSelectionMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleAudioRegionEdgeMouseDown: (
    edge: AudioRegionResizeDragState['edge'],
  ) => (e: ReactMouseEvent<HTMLSpanElement>) => void;
  handleSpectralRegionMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  handleSpectralRegionDoubleClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export function useClipRegionInteractions(input: {
  clip: TimelineClip;
  track: Pick<TimelineTrack, 'id'>;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  width: number;
  zoom: number;
  spectralMaxFrequencyHz: number;
  canSelectAudioRegion: boolean;
  canSelectSpectralRegion: boolean;
  canSelectVideoBakeRegion: boolean;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  audioRegionDrag: AudioRegionDragState | null;
  videoBakeRegionDrag: VideoBakeRegionDragState | null;
  audioRegionMoveDrag: AudioRegionMoveDragState | null;
  audioRegionResizeDrag: AudioRegionResizeDragState | null;
  spectralRegionDrag: SpectralRegionDragState | null;
  setAudioRegionDrag: Dispatch<SetStateAction<AudioRegionDragState | null>>;
  setVideoBakeRegionDrag: Dispatch<SetStateAction<VideoBakeRegionDragState | null>>;
  setAudioRegionMoveDrag: Dispatch<SetStateAction<AudioRegionMoveDragState | null>>;
  setAudioRegionResizeDrag: Dispatch<SetStateAction<AudioRegionResizeDragState | null>>;
  setSpectralRegionDrag: Dispatch<SetStateAction<SpectralRegionDragState | null>>;
  getMatchingAudioRegionOperationIds: (selection: TimelineAudioRegionSelection) => string[];
  commitAudioRegionOperationRange: CommitAudioRegionOperationRange;
  closeAudioRegionContextMenu: () => void;
  setAudioRegionSelection: (selection: TimelineAudioRegionSelection) => void;
  clearAudioRegionSelection: () => void;
  setAudioSpectralRegionSelection: (selection: TimelineSpectralRegionSelection) => void;
  clearAudioSpectralRegionSelection: () => void;
  setVideoBakeRegionSelection: (selection: TimelineVideoBakeRegionSelection) => void;
  clearVideoBakeRegionSelection: () => void;
  addClipVideoBakeRegion: (
    clipId: string,
    selection: Omit<TimelineVideoBakeRegionSelection, 'scope' | 'clipId'>,
  ) => TimelineVideoBakeRegionSelection | null;
}): ClipRegionInteractions {
  const {
    clip,
    track,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    zoom,
    spectralMaxFrequencyHz,
    canSelectAudioRegion,
    canSelectSpectralRegion,
    canSelectVideoBakeRegion,
    audioRegionSelection,
    audioRegionDrag,
    videoBakeRegionDrag,
    audioRegionMoveDrag,
    audioRegionResizeDrag,
    spectralRegionDrag,
    setAudioRegionDrag,
    setVideoBakeRegionDrag,
    setAudioRegionMoveDrag,
    setAudioRegionResizeDrag,
    setSpectralRegionDrag,
    getMatchingAudioRegionOperationIds,
    commitAudioRegionOperationRange,
    closeAudioRegionContextMenu,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    setAudioSpectralRegionSelection,
    clearAudioSpectralRegionSelection,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addClipVideoBakeRegion,
  } = input;

  const timelineTimeFromAudioRegionClientX = useCallback((
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, displayDuration);
  }, [displayDuration, displayStartTime]);

  const timelineTimeFromVideoBakeClientX = useCallback((
    clientX: number,
    drag: Pick<VideoBakeRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
  }, [displayDuration, displayStartTime]);

  const sourceTimeFromVideoBakeTimelineTime = useCallback((timelineTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const timelineRatio = Math.max(0, Math.min(1, (timelineTime - displayStartTime) / clipDuration));
    const sourceRatio = clip.reversed ? 1 - timelineRatio : timelineRatio;
    return sourceStart + sourceRatio * (sourceEnd - sourceStart);
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const sourceTimeToVideoBakeTimelineTime = useCallback((sourceTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * clipDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const resolveVideoBakeRegionDragSelection = useCallback((
    drag: VideoBakeRegionDragState,
    clientX: number,
  ): TimelineVideoBakeRegionSelection => {
    const focusTimelineTime = timelineTimeFromVideoBakeClientX(clientX, drag);
    return {
      scope: 'clip',
      clipId: clip.id,
      trackId: track.id,
      startTime: drag.anchorTimelineTime,
      endTime: focusTimelineTime,
      sourceInPoint: sourceTimeFromVideoBakeTimelineTime(drag.anchorTimelineTime),
      sourceOutPoint: sourceTimeFromVideoBakeTimelineTime(focusTimelineTime),
    };
  }, [
    clip.id,
    sourceTimeFromVideoBakeTimelineTime,
    timelineTimeFromVideoBakeClientX,
    track.id,
  ]);

  const resolveAudioRegionDragSelection = useCallback((
    drag: AudioRegionDragState,
    clientX: number,
  ) => resolveTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    anchorTimelineTime: drag.anchorTimelineTime,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveAudioRegionMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
  ]);

  const resolveAudioRegionResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => resizeTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    selection: drag.initialSelection,
    edge: drag.edge,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveSpectralRegionDragSelection = useCallback((
    drag: SpectralRegionDragState,
    clientX: number,
    clientY: number,
  ) => {
    const selectionClip = {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    };
    const focusTimelineTime = timelineTimeFromAudioRegionClientX(clientX, drag);
    const focusFrequencyHz = frequencyHzFromSpectralY(clientY - drag.rectTop, drag.rectHeight, drag.maxFrequencyHz);

    if (drag.mode === 'brush') {
      return resolveTimelineSpectralBrushSelection({
        clip: selectionClip,
        centerTimelineTime: focusTimelineTime,
        centerFrequencyHz: focusFrequencyHz,
        timeRadiusSeconds: drag.brushTimeRadiusSeconds ?? 0.08,
        frequencyRadiusHz: drag.brushFrequencyRadiusHz ?? drag.maxFrequencyHz * 0.04,
        maxFrequencyHz: drag.maxFrequencyHz,
      });
    }

    return resolveTimelineSpectralRegionSelection({
      clip: selectionClip,
      anchorTimelineTime: drag.anchorTimelineTime,
      focusTimelineTime,
      anchorFrequencyHz: drag.anchorFrequencyHz,
      focusFrequencyHz,
      maxFrequencyHz: drag.maxFrequencyHz,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
  ]);

  const handleAudioRegionMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: AudioRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setAudioRegionDrag(drag);
    setAudioRegionSelection(resolveAudioRegionDragSelection(drag, e.clientX));
  }, [
    canSelectAudioRegion,
    resolveAudioRegionDragSelection,
    setAudioRegionDrag,
    setAudioRegionSelection,
    timelineTimeFromAudioRegionClientX,
  ]);

  const handleAudioRegionDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    closeAudioRegionContextMenu();
    setAudioRegionSelection(resolveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: displayStartTime,
      focusTimelineTime: displayStartTime + Math.max(0.001, displayDuration),
      snapThresholdSeconds: 0,
    }));
  }, [
    canSelectAudioRegion,
    clip,
    closeAudioRegionContextMenu,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    setAudioRegionSelection,
  ]);

  const handleVideoBakeRegionMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0 || !isVideoBakeRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: VideoBakeRegionDragState = {
      anchorTimelineTime: timelineTimeFromVideoBakeClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setVideoBakeRegionDrag(drag);
    setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(drag, e.clientX));
  }, [
    canSelectVideoBakeRegion,
    resolveVideoBakeRegionDragSelection,
    setVideoBakeRegionDrag,
    setVideoBakeRegionSelection,
    timelineTimeFromVideoBakeClientX,
  ]);

  const handleVideoBakeRegionDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    addClipVideoBakeRegion(clip.id, {
      trackId: track.id,
      startTime: displayStartTime,
      endTime: displayStartTime + Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration),
      sourceInPoint: displayInPoint,
      sourceOutPoint: displayOutPoint,
    });
  }, [
    addClipVideoBakeRegion,
    canSelectVideoBakeRegion,
    clip.id,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    track.id,
  ]);

  const handleAudioRegionSelectionMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    closeAudioRegionContextMenu();
    setAudioRegionMoveDrag({
      startClientX: e.clientX,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  }, [
    audioRegionSelection,
    canSelectAudioRegion,
    closeAudioRegionContextMenu,
    displayDuration,
    getMatchingAudioRegionOperationIds,
    setAudioRegionMoveDrag,
    width,
  ]);

  const handleAudioRegionEdgeMouseDown = useCallback((
    edge: AudioRegionResizeDragState['edge'],
  ) => (e: ReactMouseEvent<HTMLSpanElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    const clipElement = e.currentTarget.closest('.timeline-clip');
    if (!clipElement) return;

    e.preventDefault();
    e.stopPropagation();
    closeAudioRegionContextMenu();
    const rect = clipElement.getBoundingClientRect();
    setAudioRegionResizeDrag({
      edge,
      rectLeft: rect.left,
      rectWidth: Math.max(1, rect.width),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  }, [
    audioRegionSelection,
    canSelectAudioRegion,
    closeAudioRegionContextMenu,
    getMatchingAudioRegionOperationIds,
    setAudioRegionResizeDrag,
  ]);

  const handleSpectralRegionMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const brushMode = e.shiftKey || e.altKey;
    const drag: SpectralRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      anchorFrequencyHz: frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz),
      startClientX: e.clientX,
      startClientY: e.clientY,
      rectLeft: rect.left,
      rectWidth: rect.width,
      rectTop: rect.top,
      rectHeight: rect.height,
      maxFrequencyHz: spectralMaxFrequencyHz,
      mode: brushMode ? 'brush' : 'rectangle',
      brushTimeRadiusSeconds: brushMode ? Math.max(0.025, Math.min(0.5, 18 / Math.max(1, zoom))) : undefined,
      brushFrequencyRadiusHz: brushMode ? Math.max(80, spectralMaxFrequencyHz * 0.045) : undefined,
    };

    setSpectralRegionDrag(drag);
    setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(drag, e.clientX, e.clientY));
  }, [
    canSelectSpectralRegion,
    resolveSpectralRegionDragSelection,
    setAudioSpectralRegionSelection,
    setSpectralRegionDrag,
    spectralMaxFrequencyHz,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const handleSpectralRegionDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();
    clearAudioSpectralRegionSelection();
  }, [clearAudioSpectralRegionSelection]);

  useEffect(() => {
    if (!audioRegionDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setAudioRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionDragSelection(audioRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (Math.abs(e.clientX - audioRegionDrag.startClientX) < 3) {
        clearAudioRegionSelection();
      }
      setAudioRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionDrag,
    canSelectAudioRegion,
    clearAudioRegionSelection,
    resolveAudioRegionDragSelection,
    setAudioRegionDrag,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!videoBakeRegionDrag || !canSelectVideoBakeRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isVideoBakeRegionModifierPressed(e)) {
        setVideoBakeRegionDrag(null);
        clearVideoBakeRegionSelection();
        return;
      }
      e.preventDefault();
      setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const draggedFarEnough = Math.abs(e.clientX - videoBakeRegionDrag.startClientX) >= 3;
      if (draggedFarEnough) {
        const selection = resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX);
        addClipVideoBakeRegion(clip.id, selection);
      } else {
        clearVideoBakeRegionSelection();
      }
      setVideoBakeRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    addClipVideoBakeRegion,
    canSelectVideoBakeRegion,
    clearVideoBakeRegionSelection,
    clip.id,
    resolveVideoBakeRegionDragSelection,
    setVideoBakeRegionDrag,
    setVideoBakeRegionSelection,
    videoBakeRegionDrag,
  ]);

  useEffect(() => {
    if (!audioRegionMoveDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionMoveDrag.operationIds,
        nextSelection,
        'Move audio region edit',
      );
      setAudioRegionMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionMoveDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionMoveSelection,
    setAudioRegionMoveDrag,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionResizeDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionResizeDrag.operationIds,
        nextSelection,
        'Resize audio region edit',
      );
      setAudioRegionResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionResizeDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionResizeSelection,
    setAudioRegionResizeDrag,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-audio-region-selection')) return;
      if (target.closest('.clip-audio-region-context-menu')) return;
      if (target.closest('.clip-audio-edit-operation-overlay')) return;

      closeAudioRegionContextMenu();
      clearAudioRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [audioRegionSelection, clearAudioRegionSelection, closeAudioRegionContextMenu]);

  useEffect(() => {
    if (!spectralRegionDrag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setSpectralRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(spectralRegionDrag, e.clientX, e.clientY));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (
        spectralRegionDrag.mode !== 'brush' &&
        Math.abs(e.clientX - spectralRegionDrag.startClientX) < 3 &&
        Math.abs(e.clientY - spectralRegionDrag.startClientY) < 3
      ) {
        clearAudioSpectralRegionSelection();
      }
      setSpectralRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canSelectSpectralRegion,
    clearAudioSpectralRegionSelection,
    resolveSpectralRegionDragSelection,
    setAudioSpectralRegionSelection,
    setSpectralRegionDrag,
    spectralRegionDrag,
  ]);

  return {
    timelineTimeFromAudioRegionClientX,
    sourceTimeToVideoBakeTimelineTime,
    handleAudioRegionMouseDown,
    handleAudioRegionDoubleClick,
    handleVideoBakeRegionMouseDown,
    handleVideoBakeRegionDoubleClick,
    handleAudioRegionSelectionMouseDown,
    handleAudioRegionEdgeMouseDown,
    handleSpectralRegionMouseDown,
    handleSpectralRegionDoubleClick,
  };
}
