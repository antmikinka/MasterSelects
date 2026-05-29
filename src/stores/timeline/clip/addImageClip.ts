// Image clip addition - extracted from addClip
// Handles image file loading and thumbnail generation

import type { TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM, calculateNativeScale } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { generateImageThumbnail } from '../helpers/thumbnailHelpers';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';

export interface AddImageClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
}

/**
 * Create placeholder image clip immediately.
 * Returns clip ready to be added to state while media loads in background.
 */
export function createImageClipPlaceholder(params: AddImageClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, mediaFileId } = params;
  const clipId = generateClipId('clip-img');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'image', naturalDuration: estimatedDuration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export interface LoadImageMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * Load image media in background - handles loading and thumbnail generation.
 */
export async function loadImageMedia(params: LoadImageMediaParams): Promise<void> {
  const { clip, updateClip } = params;
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;

  // Create and load image element - track URL for cleanup
  const img = new Image();
  img.src = blobUrlManager.create(clip.id, clip.file, 'image');

  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });

  // Generate thumbnail
  const thumbnail = generateImageThumbnail(img);
  const thumbnails = thumbnail ? [thumbnail] : [];

  // Calculate native pixel scale so content appears at actual size
  const nativeScale = (img.naturalWidth && img.naturalHeight)
    ? calculateNativeScale(img.naturalWidth, img.naturalHeight)
    : { x: 1, y: 1 };

  updateClip(clip.id, {
    source: { type: 'image', imageElement: img, naturalDuration: clip.duration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM, scale: nativeScale },
    thumbnails,
    isLoading: false,
  });

  // Sync to media store
  const mediaStore = useMediaStore.getState();
  if (!mediaStore.getFileByName(clip.file.name)) {
    mediaStore.importFile(clip.file);
  }
}
