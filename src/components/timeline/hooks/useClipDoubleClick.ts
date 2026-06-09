import { useCallback } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { Logger } from '../../../services/logger';
import { useDockStore } from '../../../stores/dockStore';
import { requestMediaSourceReveal } from '../../../services/mediaSourceReveal';
import { openPianoRoll } from '../../pianoRoll/PianoRollBoot';

const log = Logger.create('useClipDoubleClick');

interface UseClipDoubleClickProps {
  clipMap: Map<string, TimelineClip>;
  tracks: TimelineTrack[];
  openCompositionTab: (compositionId: string) => void;
}

export function useClipDoubleClick({
  clipMap,
  tracks,
  openCompositionTab,
}: UseClipDoubleClickProps): (e: React.MouseEvent, clipId: string) => void {
  return useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      e.preventDefault();

      const clip = clipMap.get(clipId);
      if (!clip) return;

      if (clip.source?.type === 'midi') {
        openPianoRoll(clip.id);
        return;
      }

      if (clip.isComposition && clip.compositionId) {
        log.debug('Double-click on composition clip, opening:', clip.compositionId);
        openCompositionTab(clip.compositionId);
        return;
      }

      const track = tracks.find((candidate) => candidate.id === clip.trackId);
      const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
      const sourceType = clip.source?.type;
      const isMediaLayerClip =
        track?.type === 'video' ||
        track?.type === 'audio' ||
        sourceType === 'video' ||
        sourceType === 'audio';

      if (mediaFileId && isMediaLayerClip) {
        useDockStore.getState().activatePanelType('media');
        requestMediaSourceReveal(mediaFileId, 'timeline');
      }
    },
    [clipMap, openCompositionTab, tracks],
  );
}
