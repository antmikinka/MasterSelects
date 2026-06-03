import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetTimelineThumbnailGenerationWarmupForTest,
  scheduleVisibleTimelineThumbnailGeneration,
  warmVisibleTimelineThumbnailGeneration,
  type TimelineThumbnailGenerationWarmupDeps,
} from '../../src/services/timeline/timelineThumbnailGenerationWarmup';
import type { ThumbnailStatus } from '../../src/services/thumbnailCacheService';

function createVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    src: 'blob:video-a',
    currentSrc: 'blob:video-a',
    duration: 4,
    ...overrides,
  } as HTMLVideoElement;
}

function createDeps(
  overrides: Partial<ReturnType<TimelineThumbnailGenerationWarmupDeps['getState']>> = {},
  status: ThumbnailStatus = 'none',
): TimelineThumbnailGenerationWarmupDeps {
  const generateForSource = vi.fn<TimelineThumbnailGenerationWarmupDeps['generateForSource']>()
    .mockResolvedValue(undefined);
  const video = createVideo();

  return {
    getState: () => ({
      clips: [
        {
          id: 'clip-a',
          duration: 4,
          outPoint: 4,
          source: {
            type: 'video',
            mediaFileId: 'media-a',
            videoElement: video,
            naturalDuration: 4,
          },
        },
      ],
      mediaFiles: [
        {
          id: 'media-a',
          fileHash: 'hash-a',
          duration: 4,
        },
      ],
      isPlaying: false,
      clipDragPreview: null,
      ...overrides,
    }),
    getStatus: vi.fn().mockReturnValue(status),
    generateForSource,
    setTimeout,
    clearTimeout,
  };
}

describe('timeline thumbnail generation warmup', () => {
  afterEach(() => {
    resetTimelineThumbnailGenerationWarmupForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates thumbnails for visible refs with an available video element', async () => {
    const deps = createDeps();

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);

    expect(deps.generateForSource).toHaveBeenCalledTimes(1);
    expect(deps.generateForSource).toHaveBeenCalledWith(
      'media-a',
      expect.objectContaining({ src: 'blob:video-a' }),
      4,
      'hash-a',
    );
  });

  it('blocks thumbnail generation while playback is active', async () => {
    const deps = createDeps({ isPlaying: true });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'blocked' },
    ]);

    expect(deps.generateForSource).not.toHaveBeenCalled();
  });

  it('does not generate when thumbnails are already ready or generating', async () => {
    const deps = createDeps({}, 'ready');

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'ready' },
    ]);

    expect(deps.generateForSource).not.toHaveBeenCalled();
  });

  it('coalesces overlapping generation requests by media id and file hash', async () => {
    let resolveGeneration: (() => void) | undefined;
    const deps = createDeps();
    vi.mocked(deps.generateForSource).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveGeneration = resolve;
      }),
    );

    const refs = [{ mediaFileId: 'media-a', fileHash: 'hash-a' }];
    const first = warmVisibleTimelineThumbnailGeneration(refs, { deps });
    const second = warmVisibleTimelineThumbnailGeneration(refs, { deps });

    expect(deps.generateForSource).toHaveBeenCalledTimes(1);
    resolveGeneration?.();

    await expect(first).resolves.toEqual([{ mediaFileId: 'media-a', status: 'generated' }]);
    await expect(second).resolves.toEqual([{ mediaFileId: 'media-a', status: 'generated' }]);
  });

  it('can cancel scheduled thumbnail generation before work starts', () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const cancel = scheduleVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], {
      deps,
      delayMs: 50,
    });

    cancel();
    vi.advanceTimersByTime(60);

    expect(deps.generateForSource).not.toHaveBeenCalled();
  });

  it('binds default browser timers before scheduling visible generation', () => {
    const receiverAwareSetTimeout = vi.fn(function (
      this: typeof globalThis,
      _callback: () => void,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return 1 as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const receiverAwareClearTimeout = vi.fn(function (
      this: typeof globalThis,
      _handle?: ReturnType<typeof setTimeout>,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
    }) as unknown as typeof clearTimeout;

    vi.stubGlobal('setTimeout', receiverAwareSetTimeout);
    vi.stubGlobal('clearTimeout', receiverAwareClearTimeout);

    const cancel = scheduleVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { delayMs: 50 });

    expect(receiverAwareSetTimeout).toHaveBeenCalledTimes(1);
    cancel();
    expect(receiverAwareClearTimeout).toHaveBeenCalledTimes(1);
  });

  it('skips refs when no matching video element is available', async () => {
    const deps = createDeps({
      clips: [
        {
          id: 'clip-a',
          duration: 4,
          source: { type: 'video', mediaFileId: 'media-a' },
        },
      ],
    });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'skipped' },
    ]);
    expect(deps.generateForSource).not.toHaveBeenCalled();
  });
});
