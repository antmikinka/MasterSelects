import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createFrameContext: vi.fn(),
  syncBackground: vi.fn(),
}));

vi.mock('../../src/services/layerBuilder/FrameContext', () => ({
  createFrameContext: () => hoisted.createFrameContext(),
  getClipTimeInfo: vi.fn(),
  getMediaFileForClip: vi.fn(),
}));

vi.mock('../../src/services/layerPlaybackManager', () => ({
  layerPlaybackManager: {
    syncVideoElements: (...args: unknown[]) => hoisted.syncBackground(...args),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  canUseSharedPreviewRuntimeSession: vi.fn(() => true),
  ensureRuntimeFrameProvider: vi.fn(),
  getPreviewRuntimeSource: vi.fn((source: unknown) => source),
  getRuntimeFrameProvider: vi.fn(() => null),
  getScrubRuntimeSource: vi.fn((source: unknown) => source),
  peekRuntimeFrameProvider: vi.fn(() => null),
  updateRuntimePlaybackTime: vi.fn(),
}));

vi.mock('../../src/services/vfPipelineMonitor', () => ({
  vfPipelineMonitor: {
    record: vi.fn(),
  },
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { VideoSyncManager } from '../../src/services/layerBuilder/VideoSyncManager';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import { releaseAllLazyTimelineMediaElements } from '../../src/services/timeline/lazyMediaElements';
import type { TimelineClip } from '../../src/types';

type VideoSyncManagerTestAccess = VideoSyncManager & {
  syncClipVideo(clip: TimelineClip, ctx: FrameContext): void;
  warmupUpcomingClips(ctx: FrameContext): void;
  preBufferUpcomingVideoAudio(ctx: FrameContext): void;
};

describe('VideoSyncManager same-frame sync gate', () => {
  beforeEach(() => {
    hoisted.createFrameContext.mockReset();
    hoisted.syncBackground.mockReset();
  });

  afterEach(() => {
    releaseAllLazyTimelineMediaElements();
    vi.restoreAllMocks();
  });

  it('does not skip a same-frame playback sync when clip references changed asynchronously', () => {
    const manager = new VideoSyncManager() as unknown as VideoSyncManagerTestAccess;
    const syncClipVideo = vi.spyOn(manager, 'syncClipVideo').mockImplementation(() => {});
    vi.spyOn(manager, 'warmupUpcomingClips').mockImplementation(() => {});
    vi.spyOn(manager, 'preBufferUpcomingVideoAudio').mockImplementation(() => {});

    const mediaFile = { id: 'media-1', name: 'clip.mp4', url: 'blob:clip-video', duration: 10 };

    const clipA = {
      id: 'clip-1',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      mediaFileId: 'media-1',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        naturalDuration: 10,
      },
    } as unknown as TimelineClip;

    const clipB = {
      ...clipA,
      source: {
        ...clipA.source,
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    } as unknown as TimelineClip;

    const createContext = (clip: TimelineClip): FrameContext => ({
      isPlaying: true,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      frameNumber: 10,
      playheadPosition: 1,
      now: 1000,
      playbackSpeed: 1,
      clips: [clip],
      clipsAtTime: [clip],
      clipsByTrackId: new Map([['track-v1', clip]]),
      tracks: [{ id: 'track-v1', type: 'video', visible: true }],
      videoTracks: [{ id: 'track-v1', type: 'video', visible: true }],
      audioTracks: [],
      visibleVideoTrackIds: new Set(['track-v1']),
      unmutedAudioTrackIds: new Set(),
      mediaFiles: [mediaFile],
      mediaFileById: new Map([['media-1', mediaFile]]),
      mediaFileByName: new Map([[mediaFile.name, mediaFile]]),
      compositionById: new Map(),
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 1,
    } as unknown as FrameContext);

    hoisted.createFrameContext
      .mockReturnValueOnce(createContext(clipA))
      .mockReturnValueOnce(createContext(clipB));

    manager.syncVideoElements();
    manager.syncVideoElements();

    expect(syncClipVideo).toHaveBeenCalledTimes(2);
  });
});
