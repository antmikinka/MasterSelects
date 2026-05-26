import { describe, expect, it } from 'vitest';

import { getCatalogEntries } from '../../src/services/flashboard/FlashBoardModelCatalog';
import { getFlashBoardPriceEstimate } from '../../src/services/flashboard/FlashBoardPricing';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  createDefaultFlashBoardComposer,
} from '../../src/stores/flashboardStore/defaults';
import {
  DEFAULT_AUDIO_NODE_ASPECT_RATIO,
  resolveFlashBoardNodeAspectRatio,
} from '../../src/components/panels/flashboard/nodeSizing';
import type { FlashBoardNode } from '../../src/stores/flashboardStore/types';

describe('FlashBoard audio catalog contract', () => {
  it('exposes ElevenLabs as an audio generation provider', () => {
    const entry = getCatalogEntries().find((candidate) => candidate.providerId === 'elevenlabs-tts');

    expect(entry).toMatchObject({
      service: 'elevenlabs',
      providerId: 'elevenlabs-tts',
      outputType: 'audio',
      supportsTextToAudio: true,
      supportsTextToVideo: false,
      supportsImageToVideo: false,
      supportsTextToImage: false,
      versions: [DEFAULT_ELEVENLABS_MODEL_ID],
    });
  });

  it('does not estimate Kie or hosted credits for ElevenLabs audio', () => {
    expect(
      getFlashBoardPriceEstimate({
        providerId: 'elevenlabs-tts',
        service: 'elevenlabs',
        outputType: 'audio',
      }),
    ).toBeNull();
  });

  it('creates default audio composer settings for every reset path', () => {
    expect(createDefaultFlashBoardComposer()).toMatchObject({
      languageOverride: false,
      outputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
      voiceSettings: DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    });
  });

  it('uses a compact audio aspect ratio for audio nodes', () => {
    const node: FlashBoardNode = {
      id: 'audio-node',
      kind: 'generation',
      createdAt: 1,
      updatedAt: 1,
      position: { x: 0, y: 0 },
      size: { width: 280, height: 157.5 },
      result: {
        mediaFileId: 'audio-media',
        mediaType: 'audio',
      },
    };

    expect(resolveFlashBoardNodeAspectRatio(node)).toBeCloseTo(DEFAULT_AUDIO_NODE_ASPECT_RATIO);
  });
});
