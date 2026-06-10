import type {
  ElevenLabsModel,
  ElevenLabsVoice,
  ElevenLabsVoiceSearchParams,
  ElevenLabsVoiceSearchResult,
  ElevenLabsVoicesApiResponse,
} from './apiContracts';
import { ElevenLabsServiceError } from './errors';
import { asNumber, asString, normalizeModel, normalizeVoice } from './resultMapping';
import type { ElevenLabsTransport } from './transport';

function appendQueryParam(searchParams: URLSearchParams, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined || value === '') {
    return;
  }

  searchParams.set(key, String(value));
}

export async function listElevenLabsModels(
  transport: ElevenLabsTransport,
  signal?: AbortSignal,
): Promise<ElevenLabsModel[]> {
  const response = await transport.fetchJson<unknown>(
    '/v1/models',
    {
      method: 'GET',
      headers: transport.jsonHeaders(),
      signal,
    },
    'listModels',
  );

  if (!Array.isArray(response)) {
    throw new ElevenLabsServiceError('ElevenLabs returned an invalid models response.', 'invalid_response');
  }

  return response.map(normalizeModel).filter((model): model is ElevenLabsModel => model !== null);
}

export async function listElevenLabsVoices(
  transport: ElevenLabsTransport,
  params: ElevenLabsVoiceSearchParams = {},
  signal?: AbortSignal,
): Promise<ElevenLabsVoiceSearchResult> {
  const searchParams = new URLSearchParams();
  const pageSize = params.pageSize === undefined
    ? undefined
    : Math.min(100, Math.max(1, Math.floor(params.pageSize)));

  appendQueryParam(searchParams, 'next_page_token', params.nextPageToken);
  appendQueryParam(searchParams, 'page_size', pageSize);
  appendQueryParam(searchParams, 'search', params.search?.trim());
  appendQueryParam(searchParams, 'sort', params.sort);
  appendQueryParam(searchParams, 'sort_direction', params.sortDirection);
  appendQueryParam(searchParams, 'voice_type', params.voiceType);
  appendQueryParam(searchParams, 'category', params.category);
  appendQueryParam(searchParams, 'fine_tuning_state', params.fineTuningState);
  appendQueryParam(searchParams, 'collection_id', params.collectionId);
  appendQueryParam(searchParams, 'include_total_count', params.includeTotalCount);

  for (const voiceId of params.voiceIds ?? []) {
    if (voiceId.trim()) {
      searchParams.append('voice_ids', voiceId.trim());
    }
  }

  const endpoint = `/v2/voices${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`;
  const response = await transport.fetchJson<ElevenLabsVoicesApiResponse>(
    endpoint,
    {
      method: 'GET',
      headers: transport.jsonHeaders(),
      signal,
    },
    'listVoices',
  );

  if (!Array.isArray(response.voices)) {
    throw new ElevenLabsServiceError('ElevenLabs returned an invalid voices response.', 'invalid_response');
  }

  return {
    voices: response.voices.map(normalizeVoice).filter((voice): voice is ElevenLabsVoice => voice !== null),
    hasMore: response.has_more === true,
    totalCount: asNumber(response.total_count),
    nextPageToken: asString(response.next_page_token) ?? null,
  };
}
