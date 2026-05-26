import type { FlashBoardComposerState, FlashBoardVoiceSettings } from './types';

export const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

export const DEFAULT_ELEVENLABS_VOICE_SETTINGS: Required<FlashBoardVoiceSettings> = {
  speed: 1,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: true,
};

export function createDefaultFlashBoardComposer(): FlashBoardComposerState {
  return {
    draftNodeId: null,
    isOpen: false,
    generateAudio: false,
    multiShots: false,
    multiPrompt: [],
    languageOverride: false,
    outputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    voiceSettings: { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS },
    referenceMediaFileIds: [],
  };
}
