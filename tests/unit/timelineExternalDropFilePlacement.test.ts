import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/timelineExternalDropMediaResolver', () => ({
  getTimelineDropMediaTypeOverride: vi.fn(),
  resolveTimelineDropMediaFile: vi.fn(),
  setTimelineDroppedFilePath: vi.fn(),
}));

import {
  getTimelineDropMediaTypeOverride,
  resolveTimelineDropMediaFile,
  setTimelineDroppedFilePath,
} from '../../src/services/timeline/timelineExternalDropMediaResolver';
import { placeTimelineExternalDropFiles } from '../../src/services/timeline/timelineExternalDropFilePlacement';
import type { MediaFile } from '../../src/stores/mediaStore';

const getTimelineDropMediaTypeOverrideMock = vi.mocked(getTimelineDropMediaTypeOverride);
const resolveTimelineDropMediaFileMock = vi.mocked(resolveTimelineDropMediaFile);
const setTimelineDroppedFilePathMock = vi.mocked(setTimelineDroppedFilePath);

function mediaFile(overrides: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    name: 'media.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    ...overrides,
  } as MediaFile;
}

describe('timeline external drop file placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTimelineDropMediaTypeOverrideMock.mockReturnValue(undefined);
    resolveTimelineDropMediaFileMock.mockImplementation(async ({ file }) =>
      mediaFile({
        id: `media-${file.name}`,
        name: file.name,
        type: file.type.startsWith('audio/') ? 'audio' : 'video',
        file,
        duration: file.name.includes('second') ? 3 : 4,
      })
    );
  });

  it('places supported dropped files sequentially through injected clip actions', async () => {
    const addClip = vi.fn();
    const firstFile = new File(['video'], 'first.mp4', { type: 'video/mp4' });
    const secondFile = new File(['video'], 'second.mp4', { type: 'video/mp4' });

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip },
      records: [
        { file: firstFile, absolutePath: 'C:/media/first.mp4' },
        { file: secondFile, absolutePath: 'C:/media/second.mp4' },
      ],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 2,
    });

    expect(placed).toBe(true);
    expect(setTimelineDroppedFilePathMock).toHaveBeenCalledWith(firstFile, 'C:/media/first.mp4');
    expect(setTimelineDroppedFilePathMock).toHaveBeenCalledWith(secondFile, 'C:/media/second.mp4');
    expect(addClip).toHaveBeenNthCalledWith(
      1,
      'video-1',
      firstFile,
      2,
      4,
      'media-first.mp4',
      'video',
    );
    expect(addClip).toHaveBeenNthCalledWith(
      2,
      'video-1',
      secondFile,
      6,
      3,
      'media-second.mp4',
      'video',
    );
  });

  it('skips files that do not match the target track kind before importing media', async () => {
    const addClip = vi.fn();
    const audioFile = new File(['audio'], 'dialog.wav', { type: 'audio/wav' });

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip },
      records: [{ file: audioFile }],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 0,
    });

    expect(placed).toBe(false);
    expect(resolveTimelineDropMediaFileMock).not.toHaveBeenCalled();
    expect(addClip).not.toHaveBeenCalled();
  });

  it('uses source-specific media type overrides after media resolution', async () => {
    const addClip = vi.fn();
    const modelFile = new File(['model'], 'hero.glb', { type: 'model/gltf-binary' });
    getTimelineDropMediaTypeOverrideMock.mockReturnValue('model');
    resolveTimelineDropMediaFileMock.mockResolvedValue(mediaFile({
      id: 'model-1',
      name: 'hero.glb',
      type: 'model',
      file: modelFile,
      duration: 9,
    }));

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip },
      records: [{ file: modelFile }],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 5,
      fallbackDuration: 8,
      resolveStartTime: (desiredStartTime, duration) => desiredStartTime + (duration ?? 0),
    });

    expect(placed).toBe(true);
    expect(addClip).toHaveBeenCalledWith(
      'video-1',
      modelFile,
      13,
      9,
      'model-1',
      'model',
    );
  });
});
