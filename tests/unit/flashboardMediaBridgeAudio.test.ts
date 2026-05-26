import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import type { MediaFile, MediaFolder } from '../../src/stores/mediaStore';

describe('FlashBoardMediaBridge audio imports', () => {
  beforeEach(() => {
    flashBoardMediaBridge.hydrateMetadata({});
    useFlashBoardStore.setState({
      activeBoardId: 'board-1',
      boards: [{
        id: 'board-1',
        name: 'Board',
        createdAt: 1,
        updatedAt: 1,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        nodes: [{
          id: 'node-audio',
          kind: 'generation',
          createdAt: 1,
          updatedAt: 1,
          position: { x: 0, y: 0 },
          size: { width: 280, height: 100 },
          job: { status: 'processing' },
          request: {
            service: 'elevenlabs',
            providerId: 'elevenlabs-tts',
            version: 'eleven_multilingual_v2',
            outputType: 'audio',
            prompt: 'Hello board',
            voiceId: 'voice-1',
            voiceName: 'Narrator',
            languageOverride: true,
            languageCode: 'en',
            outputFormat: 'mp3_44100_128',
            voiceSettings: {
              speed: 1,
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0,
              useSpeakerBoost: true,
            },
            referenceMediaFileIds: [],
          },
        }],
      }],
      selectedNodeIds: [],
      composer: createDefaultFlashBoardComposer(),
      hoveredComposerReference: null,
    });
  });

  it('imports generated audio files into AI Gen / Audio and completes the node', async () => {
    const folders: MediaFolder[] = [];
    const importedAudio: MediaFile = {
      id: 'media-audio',
      name: 'voice.mp3',
      type: 'audio',
      file: new File(['mp3'], 'voice.mp3', { type: 'audio/mpeg' }),
      url: 'blob:voice',
      duration: 1.5,
      parentId: 'folder-audio',
      createdAt: Date.now(),
    };
    const createFolder = vi.fn((name: string, parentId: string | null = null): MediaFolder => {
      const folder: MediaFolder = {
        id: `folder-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        parentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      folders.push(folder);
      return folder;
    });
    const importFile = vi.fn().mockResolvedValue(importedAudio);

    vi.mocked(useMediaStore.getState).mockReturnValue({
      folders,
      files: [],
      createFolder,
      importFile,
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    const file = new File(['mp3'], 'voice.mp3', { type: 'audio/mpeg' });
    const result = await flashBoardMediaBridge.importGeneratedFile('node-audio', file, 'audio');

    const aiGenFolder = folders.find((folder) => folder.name === 'AI Gen');
    const audioFolder = folders.find((folder) => folder.name === 'Audio');

    expect(aiGenFolder).toBeDefined();
    expect(audioFolder).toMatchObject({ parentId: aiGenFolder?.id });
    expect(importFile).toHaveBeenCalledWith(file, audioFolder?.id, {
      forceCopyToProject: true,
    });
    expect(result).toMatchObject({
      mediaFileId: 'media-audio',
      mediaType: 'audio',
      duration: 1.5,
    });
    expect(useFlashBoardStore.getState().boards[0].nodes[0].result).toMatchObject({
      mediaFileId: 'media-audio',
      mediaType: 'audio',
    });
    expect(flashBoardMediaBridge.getMetadata('media-audio')).toMatchObject({
      service: 'elevenlabs',
      outputType: 'audio',
      mediaType: 'audio',
      voiceId: 'voice-1',
      voiceName: 'Narrator',
      languageCode: 'en',
      outputFormat: 'mp3_44100_128',
    });
  });
});
