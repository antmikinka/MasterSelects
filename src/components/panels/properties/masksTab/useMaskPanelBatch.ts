import { useCallback } from 'react';

import { endBatch, startBatch } from '../../../../stores/historyStore';
import { useTimelineStore } from '../../../../stores/timeline';

export function useMaskPanelBatch() {
  const setMaskDragging = useTimelineStore.getState().setMaskDragging;

  const handleBatchStart = useCallback(() => {
    startBatch('Adjust mask');
    setMaskDragging(true);
  }, [setMaskDragging]);

  const handleBatchEnd = useCallback(() => {
    useTimelineStore.getState().invalidateCache();
    setMaskDragging(false);
    endBatch();
  }, [setMaskDragging]);

  return { handleBatchEnd, handleBatchStart };
}
