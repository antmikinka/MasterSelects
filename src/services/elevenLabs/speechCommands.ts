import type {
  ElevenLabsApiVoiceSettings,
  ElevenLabsCreateSpeechParams,
  ElevenLabsSpeechApiRequest,
  ElevenLabsSpeechResult,
  ElevenLabsVoiceSettings,
} from './apiContracts';
import {
  BASE_URL,
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_EXTENSION,
  ELEVENLABS_MP3_MIME_TYPE,
  ELEVENLABS_MP3_OUTPUT_FORMATS,
  isElevenLabsMp3OutputFormat,
} from './config';
import { ElevenLabsServiceError } from './errors';
import { log } from './log';
import type { ElevenLabsTransport } from './transport';

function normalizeRequestVoiceSettings(settings: ElevenLabsVoiceSettings | undefined): ElevenLabsApiVoiceSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const bodySettings: ElevenLabsApiVoiceSettings = {};

  if (settings.speed !== undefined) {
    bodySettings.speed = settings.speed;
  }
  if (settings.stability !== undefined) {
    bodySettings.stability = settings.stability;
  }
  if (settings.similarityBoost !== undefined) {
    bodySettings.similarity_boost = settings.similarityBoost;
  }
  if (settings.style !== undefined) {
    bodySettings.style = settings.style;
  }
  if (settings.useSpeakerBoost !== undefined) {
    bodySettings.use_speaker_boost = settings.useSpeakerBoost;
  }

  return Object.keys(bodySettings).length > 0 ? bodySettings : undefined;
}

export async function createElevenLabsSpeech(
  transport: ElevenLabsTransport,
  params: ElevenLabsCreateSpeechParams,
  signal?: AbortSignal,
): Promise<ElevenLabsSpeechResult> {
  const voiceId = params.voiceId.trim();
  if (!voiceId) {
    throw new ElevenLabsServiceError('Choose an ElevenLabs voice before generating speech.', 'invalid_request');
  }

  if (!params.text.trim()) {
    throw new ElevenLabsServiceError('Enter text to generate speech.', 'invalid_request');
  }

  const outputFormat = params.outputFormat ?? DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT;
  if (!isElevenLabsMp3OutputFormat(outputFormat)) {
    throw new ElevenLabsServiceError(
      `Unsupported ElevenLabs output format. Supported MP3 formats: ${ELEVENLABS_MP3_OUTPUT_FORMATS.join(', ')}.`,
      'unsupported_format',
    );
  }

  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, BASE_URL);
  url.searchParams.set('output_format', outputFormat);

  const body: ElevenLabsSpeechApiRequest = {
    text: params.text,
    model_id: params.modelId?.trim() || 'eleven_multilingual_v2',
  };

  const languageCode = params.languageCode?.trim();
  if (languageCode) {
    body.language_code = languageCode;
  }

  const voiceSettings = normalizeRequestVoiceSettings(params.voiceSettings);
  if (voiceSettings) {
    body.voice_settings = voiceSettings;
  }

  log.debug('Creating ElevenLabs speech', {
    voiceId,
    modelId: body.model_id,
    languageCode: body.language_code,
    outputFormat,
    textLength: params.text.length,
    hasVoiceSettings: Boolean(voiceSettings),
  });

  const response = await transport.fetchAudio(
    url,
    {
      method: 'POST',
      headers: {
        ...transport.jsonHeaders(),
        Accept: ELEVENLABS_MP3_MIME_TYPE,
      },
      body: JSON.stringify(body),
      signal,
    },
    'createSpeech',
  );

  return {
    audio: response,
    mimeType: ELEVENLABS_MP3_MIME_TYPE,
    extension: ELEVENLABS_MP3_EXTENSION,
    outputFormat,
    size: response.size,
  };
}
