import { BASE_URL } from './config';
import { ElevenLabsServiceError, normalizeElevenLabsError, providerErrorFromResponse } from './errors';
import { log } from './log';

export interface ElevenLabsTransport {
  fetchAudio: (url: URL, init: RequestInit, operation: string) => Promise<Blob>;
  fetchJson: <T>(endpoint: string, init: RequestInit, operation: string) => Promise<T>;
  jsonHeaders: () => HeadersInit;
}

function safeOperationLog(operation: string, error: ElevenLabsServiceError): void {
  log.warn('ElevenLabs request failed', {
    operation,
    code: error.code,
    status: error.status,
    retryable: error.retryable,
  });
}

export function createElevenLabsTransport(getApiKey: () => string, hasApiKey: () => boolean): ElevenLabsTransport {
  const requireApiKey = (): string => {
    if (!hasApiKey()) {
      throw new ElevenLabsServiceError('ElevenLabs API key is not configured.', 'missing_api_key');
    }

    return getApiKey();
  };

  const jsonHeaders = (): HeadersInit => ({
    'Content-Type': 'application/json',
    'xi-api-key': requireApiKey(),
  });

  const fetchJson = async <T>(endpoint: string, init: RequestInit, operation: string): Promise<T> => {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, init);
      if (!response.ok) {
        throw await providerErrorFromResponse(response);
      }

      try {
        return await response.json() as T;
      } catch {
        throw new ElevenLabsServiceError('ElevenLabs returned an invalid JSON response.', 'invalid_response');
      }
    } catch (error) {
      const serviceError = normalizeElevenLabsError(error);
      safeOperationLog(operation, serviceError);
      throw serviceError;
    }
  };

  const fetchAudio = async (url: URL, init: RequestInit, operation: string): Promise<Blob> => {
    try {
      const response = await fetch(url.toString(), init);
      if (!response.ok) {
        throw await providerErrorFromResponse(response);
      }

      return await response.blob();
    } catch (error) {
      const serviceError = normalizeElevenLabsError(error);
      safeOperationLog(operation, serviceError);
      throw serviceError;
    }
  };

  return {
    fetchAudio,
    fetchJson,
    jsonHeaders,
  };
}
