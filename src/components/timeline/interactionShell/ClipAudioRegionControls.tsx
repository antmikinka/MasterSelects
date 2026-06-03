import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipAudioRegionSelectionOverlay, type AudioRegionGainHandleMode } from '../components/ClipAudioRegionSelectionOverlay';
import {
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
} from '../utils/activeRegionOverlays';
import type { ClipAudioEditOperation } from '../../../types';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import { useTimelineStore } from '../../../stores/timeline';
import {
  audioRegionGainDbFromClientY,
} from '../utils/audioRegionDisplay';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
} from '../utils/audioEditSelection';
import type {
  ClipInteractionShellAudioRegionModuleState,
  ClipInteractionShellCommandContext,
} from './types';

interface ClipAudioRegionControlsProps {
  context: ClipInteractionShellCommandContext;
}

interface ClipAudioRegionControlsActiveProps {
  context: ClipInteractionShellCommandContext;
  audioRegion: ClipInteractionShellAudioRegionModuleState;
  selection: TimelineAudioRegionSelection;
}

type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};

type AudioRegionGainDragState = {
  mode: AudioRegionGainHandleMode;
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};

function findSelectedGainOperation(
  operations: readonly ClipAudioEditOperation[],
  selection: TimelineAudioRegionSelection,
): ClipAudioEditOperation | null {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (
      operation?.type === 'gain' &&
      operation.enabled !== false &&
      operation.timeRange &&
      Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
      Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
    ) {
      return operation;
    }
  }

  return null;
}

function getMatchingAudioRegionOperationIds(
  operations: readonly ClipAudioEditOperation[],
  selection: TimelineAudioRegionSelection,
): string[] {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  return operations
    .filter((operation) => {
      if (!operation.timeRange) return false;
      const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
      const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
      return Math.abs(operationStart - start) <= 0.001 &&
        Math.abs(operationEnd - end) <= 0.001;
    })
    .map((operation) => operation.id);
}

export function ClipAudioRegionControls({ context }: ClipAudioRegionControlsProps) {
  const audioRegion = context.activeModules.audioRegion;
  const selection = audioRegion?.selection;
  if (!audioRegion?.enabled || !selection) return null;

  return (
    <ClipAudioRegionControlsActive
      context={context}
      audioRegion={audioRegion}
      selection={selection}
    />
  );
}

function ClipAudioRegionControlsActive({
  context,
  audioRegion,
  selection,
}: ClipAudioRegionControlsActiveProps) {
  const [moveDrag, setMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [resizeDrag, setResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [gainDrag, setGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const setAudioRegionSelection = useTimelineStore(state => state.setAudioRegionSelection);
  const setClipAudioEditOperationRange = useTimelineStore(state => state.setClipAudioEditOperationRange);
  const setAudioRegionGainPreview = useTimelineStore(state => state.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(state => state.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(state => state.setAudioRegionGainEdit);

  const operations = useMemo(
    () => context.clip.audioState?.editStack ?? [],
    [context.clip.audioState?.editStack],
  );
  const canInteract = context.track.locked !== true;
  const selectionClip = useMemo(() => ({
    id: context.clip.id,
    trackId: context.clip.trackId,
    startTime: context.clip.startTime,
    duration: Math.max(0.001, context.clip.duration),
    inPoint: context.clip.inPoint,
    outPoint: context.clip.outPoint,
    reversed: context.clip.reversed,
    waveform: context.clip.waveform,
  }), [
    context.clip.duration,
    context.clip.id,
    context.clip.inPoint,
    context.clip.outPoint,
    context.clip.reversed,
    context.clip.startTime,
    context.clip.trackId,
    context.clip.waveform,
  ]);

  const overlay = resolveAudioRegionOverlay({
    selection,
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
  });

  const selectedOperation = findSelectedGainOperation(
    operations,
    selection,
  );
  const gainControl = overlay
    ? resolveAudioRegionGainControl({
        selection,
        overlayWidth: overlay.width,
        selectedOperation,
        dragState: typeof audioRegion.gainPreviewDb === 'number'
          ? {
              currentGainDb: audioRegion.gainPreviewDb,
              currentFadeInSeconds: 0,
              currentFadeOutSeconds: 0,
            }
          : null,
      })
    : null;

  const resolveMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [selectionClip]);

  const resolveResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    const focusTimelineTime = selectionClip.startTime +
      (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, selectionClip.duration);
    return resizeTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      edge: drag.edge,
      focusTimelineTime,
      snapThresholdSeconds: 0,
    });
  }, [selectionClip]);

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    nextSelection: TimelineAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    setClipAudioEditOperationRange(context.clip.id, operationIds, nextSelection, {
      captureHistory: true,
      historyLabel,
    });
  }, [context.clip.id, setClipAudioEditOperationRange]);

  const handleSelectionMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMoveDrag({
      startClientX: event.clientX,
      clipWidth: Math.max(1, context.geometry.clip.width),
      clipDuration: Math.max(0.001, context.clip.duration),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.clip.duration,
    context.geometry.clip.width,
    operations,
    selection,
  ]);

  const handleEdgeMouseDown = useCallback((edge: 'left' | 'right') => (
    event: React.MouseEvent<HTMLSpanElement>,
  ) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const shellElement = event.currentTarget.closest('.clip-interaction-shell');
    const rect = shellElement?.getBoundingClientRect();
    setResizeDrag({
      edge,
      rectLeft: rect?.left ?? context.geometry.clip.x,
      rectWidth: Math.max(1, rect?.width ?? context.geometry.clip.width),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.geometry.clip.width,
    context.geometry.clip.x,
    operations,
    selection,
  ]);

  const publishGainPreview = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainPreview({
      clipId: context.clip.id,
      trackId: selection.trackId,
      startTime: selection.startTime,
      endTime: selection.endTime,
      sourceInPoint: selection.sourceInPoint,
      sourceOutPoint: selection.sourceOutPoint,
      gainDb: gainInput.gainDb,
      fadeInSeconds: gainInput.fadeInSeconds,
      fadeOutSeconds: gainInput.fadeOutSeconds,
    });
  }, [context.clip.id, selection, setAudioRegionGainPreview]);

  const commitGainEdit = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainEdit({
      gainDb: gainInput.gainDb,
      fadeInSeconds: gainInput.fadeInSeconds,
      fadeOutSeconds: gainInput.fadeOutSeconds,
      keepSelection: true,
    });
  }, [setAudioRegionGainEdit]);

  const handleGainMouseDown = useCallback((mode: AudioRegionGainHandleMode) => (
    event: React.MouseEvent<HTMLButtonElement | HTMLDivElement>,
  ) => {
    if (!canInteract || event.button !== 0 || !gainControl) return;
    const regionElement = event.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(event.clientY, rect).toFixed(1))
      : gainControl.gainDb;
    publishGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: gainControl.fadeInSeconds,
      fadeOutSeconds: gainControl.fadeOutSeconds,
    });
    setGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: gainControl.regionDuration,
      currentGainDb: startGainDb,
      currentFadeInSeconds: gainControl.fadeInSeconds,
      currentFadeOutSeconds: gainControl.fadeOutSeconds,
    });
  }, [canInteract, gainControl, publishGainPreview]);

  const handleResetGain = useCallback(() => {
    if (!canInteract) return;
    commitGainEdit({
      gainDb: 0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  }, [canInteract, commitGainEdit]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!moveDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      setAudioRegionSelection(resolveMoveSelection(moveDrag, event.clientX));
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveMoveSelection(moveDrag, event.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(moveDrag.operationIds, nextSelection, 'Move audio region edit');
      setMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    moveDrag,
    resolveMoveSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!resizeDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      setAudioRegionSelection(resolveResizeSelection(resizeDrag, event.clientX));
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveResizeSelection(resizeDrag, event.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(resizeDrag.operationIds, nextSelection, 'Resize audio region edit');
      setResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    resizeDrag,
    resolveResizeSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!gainDrag || !canInteract) return undefined;

    const getNextDragState = (event: MouseEvent): AudioRegionGainDragState => {
      if (gainDrag.mode === 'gain') {
        return {
          ...gainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(event.clientY, {
            top: gainDrag.regionTop,
            height: gainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(gainDrag.regionWidth, event.clientX - gainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, gainDrag.regionWidth)) * gainDrag.regionDuration;
      const maxFadeSeconds = gainDrag.regionDuration / 2;

      return {
        ...gainDrag,
        currentFadeInSeconds: gainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: gainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, gainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const next = getNextDragState(event);
      publishGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setGainDrag(next);
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const next = getNextDragState(event);
      commitGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    clearAudioRegionGainPreview,
    commitGainEdit,
    gainDrag,
    publishGainPreview,
  ]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === context.clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [context.clip.id]);

  if (!overlay) return null;

  return (
    <div
      className="shell-audio-region-module"
      data-clip-interaction-slot="audio-region"
    >
      <ClipAudioRegionSelectionOverlay
        overlay={overlay}
        snappedToZeroCrossing={Boolean(selection.snappedToZeroCrossing)}
        moving={Boolean(moveDrag)}
        resizing={Boolean(resizeDrag)}
        gainControl={gainControl}
        onSelectionMouseDown={handleSelectionMouseDown}
        onContextMenu={handleContextMenu}
        onEdgeMouseDown={handleEdgeMouseDown}
        onGainMouseDown={handleGainMouseDown}
        onResetGain={handleResetGain}
        interactive={canInteract}
      />
    </div>
  );
}
