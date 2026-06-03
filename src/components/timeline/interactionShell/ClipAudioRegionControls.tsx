import { ClipAudioRegionSelectionOverlay } from '../components/ClipAudioRegionSelectionOverlay';
import {
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
} from '../utils/activeRegionOverlays';
import type { ClipAudioEditOperation } from '../../../types';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { ClipInteractionShellCommandContext } from './types';

interface ClipAudioRegionControlsProps {
  context: ClipInteractionShellCommandContext;
}

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

export function ClipAudioRegionControls({ context }: ClipAudioRegionControlsProps) {
  const audioRegion = context.activeModules.audioRegion;
  const selection = audioRegion?.selection;
  if (!audioRegion?.enabled || !selection) return null;

  const overlay = resolveAudioRegionOverlay({
    selection,
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
  });
  if (!overlay) return null;

  const selectedOperation = findSelectedGainOperation(
    context.clip.audioState?.editStack ?? [],
    selection,
  );
  const gainControl = resolveAudioRegionGainControl({
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
  });

  return (
    <div
      className="shell-audio-region-module"
      data-clip-interaction-slot="audio-region"
      aria-hidden="true"
    >
      <ClipAudioRegionSelectionOverlay
        overlay={overlay}
        snappedToZeroCrossing={Boolean(selection.snappedToZeroCrossing)}
        moving={audioRegion.mode === 'move'}
        resizing={audioRegion.mode === 'resize'}
        gainControl={gainControl}
        interactive={false}
      />
    </div>
  );
}
