import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeTimelineExternalDropCommand } from '../../src/services/timeline/timelineExternalDropCommandExecutor';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore';

const mockedGetMediaState = useMediaStore.getState as unknown as ReturnType<typeof vi.fn>;

function setMediaState(overrides: Record<string, unknown> = {}): void {
  mockedGetMediaState.mockReturnValue({
    files: [],
    compositions: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    ...overrides,
  });
}

function createActions() {
  return {
    addClip: vi.fn(),
    addCompClip: vi.fn(),
    addTextClip: vi.fn(),
    addSolidClip: vi.fn(),
    addMeshClip: vi.fn(),
    addCameraClip: vi.fn(),
    addSplatEffectorClip: vi.fn(),
    addMathSceneClip: vi.fn(),
    addMotionShapeClip: vi.fn(),
    addSignalAssetClip: vi.fn(),
  };
}

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

describe('timeline external drop command executor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMediaState();
  });

  it('executes visual panel item commands through injected timeline actions', async () => {
    const actions = createActions();
    setMediaState({
      solidItems: [{
        id: 'solid-1',
        name: 'Blue',
        type: 'solid',
        parentId: null,
        createdAt: 1,
        color: '#0000ff',
        duration: 7,
      }],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'solid', itemId: 'solid-1' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: true,
      mediaFilePolicy: 'allow-video-on-audio',
      resolveStartTime: (duration) => (duration ?? 0) + 3,
      trackId: 'video-1',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addSolidClip).toHaveBeenCalledWith('video-1', 10, '#0000ff', 7, true);
  });

  it('executes media-file commands with existing file resolution and media overrides', async () => {
    const actions = createActions();
    const file = new File(['model'], 'hero.glb', { type: 'model/gltf-binary' });
    setMediaState({
      files: [mediaFile({
        id: 'media-model',
        name: 'hero.glb',
        type: 'model',
        file,
        duration: 12,
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-model' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: true,
      mediaFilePolicy: 'strict-track-type',
      resolveStartTime: () => 4,
      trackId: 'video-1',
    });

    expect(result).toEqual({ handled: true });
    expect(actions.addClip).toHaveBeenCalledWith(
      'video-1',
      file,
      4,
      12,
      'media-model',
      'model',
    );
  });

  it('rejects strict media-file commands before creating clips on the wrong track type', async () => {
    const actions = createActions();
    setMediaState({
      files: [mediaFile({
        id: 'media-video',
        type: 'video',
        file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      })],
    });

    const result = await executeTimelineExternalDropCommand({
      actions,
      command: { kind: 'media-file', itemId: 'media-video' },
      isAudioOnlyMediaFile: () => false,
      isVideoTrack: false,
      mediaFilePolicy: 'strict-track-type',
      resolveStartTime: () => 0,
      trackId: 'audio-1',
    });

    expect(result).toEqual({
      handled: true,
      reason: 'visual-media-on-audio-track',
    });
    expect(actions.addClip).not.toHaveBeenCalled();
  });
});
