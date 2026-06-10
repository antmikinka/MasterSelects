import type {
  ElevenLabsCreateSpeechParams,
  ElevenLabsModel,
  ElevenLabsSpeechResult,
  ElevenLabsVoiceSearchParams,
  ElevenLabsVoiceSearchResult,
} from './elevenLabs/apiContracts';
import { listElevenLabsModels, listElevenLabsVoices } from './elevenLabs/catalogCommands';
import { createElevenLabsSpeech } from './elevenLabs/speechCommands';
import { createElevenLabsTransport, type ElevenLabsTransport } from './elevenLabs/transport';

export type {
  ElevenLabsCreateSpeechParams,
  ElevenLabsErrorCode,
  ElevenLabsFineTuningState,
  ElevenLabsLanguage,
  ElevenLabsModel,
  ElevenLabsModelRates,
  ElevenLabsSpeechResult,
  ElevenLabsVerifiedLanguage,
  ElevenLabsVoice,
  ElevenLabsVoiceCategory,
  ElevenLabsVoiceSearchParams,
  ElevenLabsVoiceSearchResult,
  ElevenLabsVoiceSettings,
  ElevenLabsVoiceSort,
  ElevenLabsVoiceSortDirection,
  ElevenLabsVoiceType,
  HostedElevenLabsSpeechCostEstimate,
} from './elevenLabs/apiContracts';
export {
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_EXTENSION,
  ELEVENLABS_MP3_MIME_TYPE,
  ELEVENLABS_MP3_OUTPUT_FORMATS,
  ELEVENLABS_PROVIDER_USD_PER_CREDIT,
  isElevenLabsMp3OutputFormat,
  MASTERSELECTS_HOSTED_USD_PER_CREDIT,
} from './elevenLabs/config';
export type { ElevenLabsMp3OutputFormat } from './elevenLabs/config';
export { ElevenLabsServiceError } from './elevenLabs/errors';
export {
  calculateHostedElevenLabsCredits,
  estimateHostedElevenLabsSpeechCredits,
  getElevenLabsModelCharacterCostMultiplier,
  isFlashOrTurboElevenLabsModel,
} from './elevenLabs/speechCost';

export class ElevenLabsService {
  private apiKey = '';
  private readonly transport: ElevenLabsTransport;

  constructor() {
    this.transport = createElevenLabsTransport(
      () => this.apiKey,
      () => this.hasApiKey(),
    );
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(signal?: AbortSignal): Promise<ElevenLabsModel[]> {
    return listElevenLabsModels(this.transport, signal);
  }

  async listVoices(
    params: ElevenLabsVoiceSearchParams = {},
    signal?: AbortSignal,
  ): Promise<ElevenLabsVoiceSearchResult> {
    return listElevenLabsVoices(this.transport, params, signal);
  }

  async createSpeech(
    params: ElevenLabsCreateSpeechParams,
    signal?: AbortSignal,
  ): Promise<ElevenLabsSpeechResult> {
    return createElevenLabsSpeech(this.transport, params, signal);
  }
}

export const elevenLabsService = new ElevenLabsService();
