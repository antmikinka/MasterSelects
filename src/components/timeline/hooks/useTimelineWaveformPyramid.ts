import { useEffect, useState } from 'react';
import type { TimelineWaveformPyramid } from '../utils/waveformLod';
import {
  getCachedTimelineWaveformPyramid,
  loadTimelineWaveformPyramid,
} from '../../../services/audio/timelineWaveformPyramidCache';

export type TimelineWaveformPyramidLoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface TimelineWaveformPyramidLoadState {
  refId: string | undefined;
  pyramid: TimelineWaveformPyramid | null;
  status: TimelineWaveformPyramidLoadStatus;
}

function createInitialState(refId: string | undefined): TimelineWaveformPyramidLoadState {
  const cached = getCachedTimelineWaveformPyramid(refId);
  if (cached) {
    return { refId, pyramid: cached, status: 'ready' };
  }

  return {
    refId,
    pyramid: null,
    status: refId ? 'loading' : 'idle',
  };
}

export function useTimelineWaveformPyramidState(
  refId: string | undefined,
): TimelineWaveformPyramidLoadState {
  const cached = getCachedTimelineWaveformPyramid(refId);
  const [loaded, setLoaded] = useState<TimelineWaveformPyramidLoadState>(() => createInitialState(refId));

  useEffect(() => {
    let cancelled = false;

    if (!refId || cached) {
      return () => {
        cancelled = true;
      };
    }

    loadTimelineWaveformPyramid(refId)
      .then((loaded) => {
        if (!cancelled) {
          setLoaded({ refId, pyramid: loaded, status: loaded ? 'ready' : 'missing' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ refId, pyramid: null, status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cached, refId]);

  if (cached) {
    return { refId, pyramid: cached, status: 'ready' };
  }

  return loaded.refId === refId ? loaded : createInitialState(refId);
}

export function useTimelineWaveformPyramid(
  refId: string | undefined,
): TimelineWaveformPyramid | null {
  return useTimelineWaveformPyramidState(refId).pyramid;
}
