import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThumbnailGenerationVideo,
  createThumbnailGenerationVideoFromUrl,
  thumbnailCacheService,
} from '../../src/services/thumbnailCacheService';
import {
  clearThumbnailBitmapCache,
  ensureThumbnailBitmap,
  getThumbnailBitmap,
} from '../../src/services/timeline/thumbnailBitmapCache';

type ThumbnailCacheServiceTestAccess = typeof thumbnailCacheService & {
  loadFromDB(mediaFileId: string, fileHash?: string): Promise<boolean>;
  loadFramesIntoCache(
    mediaFileId: string,
    frames: Array<{ secondIndex: number; blob: Blob }>,
  ): void;
  generateThumbnails(
    mediaFileId: string,
    video: HTMLVideoElement,
    duration: number,
    fileHash: string | undefined,
    signal: AbortSignal,
  ): Promise<void>;
};

describe('thumbnailCacheService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearThumbnailBitmapCache();
  });

  afterEach(() => {
    clearThumbnailBitmapCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates an isolated thumbnail video from the source element', () => {
    const clonedVideo = {
      src: '',
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(clonedVideo);

    const sourceVideo = {
      src: 'blob:source-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;

    const result = createThumbnailGenerationVideo(sourceVideo);

    expect(result).toBe(clonedVideo);
    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(clonedVideo.src).toBe('blob:source-video');
    expect(clonedVideo.preload).toBe('auto');
    expect(clonedVideo.muted).toBe(true);
    expect(clonedVideo.playsInline).toBe(true);
    expect(clonedVideo.crossOrigin).toBe('anonymous');
    expect(clonedVideo.load).toHaveBeenCalled();
  });

  it('creates an isolated thumbnail video from a source URL', () => {
    const clonedVideo = {
      src: '',
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(clonedVideo);

    const result = createThumbnailGenerationVideoFromUrl('blob:source-url', 'use-credentials');

    expect(result).toBe(clonedVideo);
    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(clonedVideo.src).toBe('blob:source-url');
    expect(clonedVideo.preload).toBe('auto');
    expect(clonedVideo.muted).toBe(true);
    expect(clonedVideo.playsInline).toBe(true);
    expect(clonedVideo.crossOrigin).toBe('use-credentials');
    expect(clonedVideo.load).toHaveBeenCalled();
  });

  it('generates thumbnails from the isolated video instead of the preview video', async () => {
    const previewVideo = {
      src: 'blob:preview-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);

    await thumbnailCacheService.generateForSource(
      `media-thumb-test-${Date.now()}`,
      previewVideo,
      12
    );

    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      isolatedVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(generateSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      previewVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('generates thumbnails from a source URL without a hydrated preview video', async () => {
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);

    await thumbnailCacheService.generateForSourceUrl(
      `media-thumb-url-test-${Date.now()}`,
      'blob:source-url',
      12,
      'hash-a',
      'use-credentials',
    );

    expect(isolatedVideo.src).toBe('blob:source-url');
    expect(isolatedVideo.crossOrigin).toBe('use-credentials');
    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      isolatedVideo,
      12,
      'hash-a',
      expect.any(AbortSignal),
    );
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('loads cached thumbnails without creating a video element or generating frames', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-cached-thumb-test-${Date.now()}`;
    const loadFromDbSpy = vi.spyOn(service, 'loadFromDB').mockResolvedValue(true);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);
    const createElementSpy = vi.spyOn(document, 'createElement');

    await expect(thumbnailCacheService.loadCachedForSource(mediaFileId, 'hash-a')).resolves.toBe(true);

    expect(loadFromDbSpy).toHaveBeenCalledWith(mediaFileId, 'hash-a');
    expect(generateSpy).not.toHaveBeenCalled();
    expect(createElementSpy).not.toHaveBeenCalled();
  });

  it('closes decoded thumbnail bitmaps before revoking source blob URLs on memory eviction', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-bitmap-evict-test-${Date.now()}`;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source-thumb-frame');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));

    service.loadFramesIntoCache(mediaFileId, [
      { secondIndex: 0, blob: new Blob(['thumb']) },
    ]);
    ensureThumbnailBitmap('blob:source-thumb-frame', vi.fn(), mediaFileId);
    await vi.waitFor(() => expect(getThumbnailBitmap('blob:source-thumb-frame')).toBe(bitmap));

    thumbnailCacheService.evictFromMemory(mediaFileId);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:source-thumb-frame');
    expect(getThumbnailBitmap('blob:source-thumb-frame')).toBeNull();
  });
});
