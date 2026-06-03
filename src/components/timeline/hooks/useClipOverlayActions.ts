import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
} from '../../../stores/timeline/types';
import type { AudioEditOperationOverlay } from '../utils/activeRegionOverlays';

export function useClipOverlayActions(input: {
  clipId: string;
  canUnbakeAudioEditStack: boolean;
  bakeClipVideoBakeRegion: (clipId: string, regionId: string) => Promise<unknown> | unknown;
  unbakeClipVideoBakeRegion: (clipId: string, regionId: string) => unknown;
  removeClipVideoBakeRegion: (clipId: string, regionId: string) => unknown;
  closeAudioRegionContextMenu: () => void;
  setAudioRegionSelection: (selection: TimelineAudioRegionSelection) => void;
  setClipAudioEditOperationEnabled: (clipId: string, operationId: string, enabled: boolean) => void;
  removeClipAudioEditOperation: (clipId: string, operationId: string) => void;
  applySpectralRegionEdit: (type: TimelineSpectralRegionEditType) => unknown;
  clearClipAudioEditStack: (clipId: string) => void;
  bakeClipAudioEditStack: (clipId: string) => Promise<unknown>;
  unbakeClipAudioEditStack: (clipId: string) => unknown;
}) {
  const [audioBakePending, setAudioBakePending] = useState(false);

  const handleBakeClipVideoRegion = useCallback((regionId: string) => {
    void input.bakeClipVideoBakeRegion(input.clipId, regionId);
  }, [input]);

  const handleUnbakeClipVideoRegion = useCallback((regionId: string) => {
    input.unbakeClipVideoBakeRegion(input.clipId, regionId);
  }, [input]);

  const handleRemoveClipVideoRegion = useCallback((regionId: string) => {
    input.removeClipVideoBakeRegion(input.clipId, regionId);
  }, [input]);

  const handleAudioEditOperationOverlayActivate = useCallback((overlay: AudioEditOperationOverlay) => {
    input.closeAudioRegionContextMenu();
    input.setAudioRegionSelection(overlay.selection);
  }, [input]);

  const handleToggleAudioEditOperation = useCallback((operationId: string, disabled: boolean) => {
    input.setClipAudioEditOperationEnabled(input.clipId, operationId, disabled);
  }, [input]);

  const handleRemoveAudioEditOperation = useCallback((operationId: string) => {
    input.removeClipAudioEditOperation(input.clipId, operationId);
  }, [input]);

  const handleApplySpectralRegionEdit = useCallback((
    type: TimelineSpectralRegionEditType,
  ) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    input.applySpectralRegionEdit(type);
  }, [input]);

  const handleAudioEditStackMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleBakeAudioEditStack = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending) return;
    setAudioBakePending(true);
    void input.bakeClipAudioEditStack(input.clipId).finally(() => {
      setAudioBakePending(false);
    });
  }, [audioBakePending, input]);

  const handleUnbakeAudioEditStack = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending || !input.canUnbakeAudioEditStack) return;
    input.unbakeClipAudioEditStack(input.clipId);
  }, [audioBakePending, input]);

  const handleClearAudioEditStack = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    input.clearClipAudioEditStack(input.clipId);
  }, [input]);

  return {
    audioBakePending,
    handleBakeClipVideoRegion,
    handleUnbakeClipVideoRegion,
    handleRemoveClipVideoRegion,
    handleAudioEditOperationOverlayActivate,
    handleToggleAudioEditOperation,
    handleRemoveAudioEditOperation,
    handleApplySpectralRegionEdit,
    handleAudioEditStackMouseDown,
    handleBakeAudioEditStack,
    handleUnbakeAudioEditStack,
    handleClearAudioEditStack,
  };
}
