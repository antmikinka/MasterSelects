// React hook for accessing source-based thumbnail cache
// Clips use this instead of clip.thumbnails for filmstrip display

import { useState, useEffect, useMemo } from 'react';
import { thumbnailCacheService, type ThumbnailCacheEvent } from '../services/thumbnailCacheService';

function getThumbnailCacheEventSeconds(event: ThumbnailCacheEvent | undefined): readonly number[] | null {
  if (!event) return null;
  if (event.secondIndices && event.secondIndices.length > 0) return event.secondIndices;
  return typeof event.secondIndex === 'number' ? [event.secondIndex] : null;
}

function thumbnailCacheEventIntersectsRange(
  event: ThumbnailCacheEvent | undefined,
  inPoint: number,
  outPoint: number,
): boolean {
  const changedSeconds = getThumbnailCacheEventSeconds(event);
  if (!changedSeconds) return true;

  const startSecond = Math.max(0, Math.floor(Math.min(inPoint, outPoint)) - 1);
  const endSecond = Math.max(0, Math.ceil(Math.max(inPoint, outPoint)) + 1);
  return changedSeconds.some((secondIndex) => secondIndex >= startSecond && secondIndex <= endSecond);
}

/**
 * Hook to get thumbnails for a clip's visible range from the source cache.
 * Returns array of blob URLs (or null for not-yet-loaded thumbs).
 */
export function useThumbnailCache(
  mediaFileId: string | undefined,
  inPoint: number,
  outPoint: number,
  visibleCount: number,
  reversed?: boolean
): (string | null)[] {
  const [cacheVersion, setCacheVersion] = useState(0);

  // Subscribe to thumbnail cache status changes
  useEffect(() => {
    if (!mediaFileId) return;

    const unsubscribe = thumbnailCacheService.subscribe((changedId, _status, event) => {
      if (changedId === mediaFileId) {
        if (!thumbnailCacheEventIntersectsRange(event, inPoint, outPoint)) return;
        setCacheVersion(n => n + 1);
      }
    });

    return unsubscribe;
  }, [mediaFileId, inPoint, outPoint]);

  // Compute thumbnails for the requested range
  return useMemo(() => {
    void cacheVersion;
    if (!mediaFileId || visibleCount <= 0) {
      return [];
    }
    return thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      inPoint,
      outPoint,
      visibleCount,
      reversed
    );
  }, [cacheVersion, mediaFileId, inPoint, outPoint, visibleCount, reversed]);
}
