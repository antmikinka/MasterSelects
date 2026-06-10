import type { ElevenLabsErrorCode } from './apiContracts';
import { isRecord } from './resultMapping';

interface ServiceErrorOptions {
  status?: number;
  retryable?: boolean;
}

export class ElevenLabsServiceError extends Error {
  code: ElevenLabsErrorCode;
  status?: number;
  retryable: boolean;

  constructor(message: string, code: ElevenLabsErrorCode, options: ServiceErrorOptions = {}) {
    super(message);
    this.name = 'ElevenLabsServiceError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function extractProviderMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractProviderMessage(item);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['message', 'detail', 'error', 'msg']) {
    const message = extractProviderMessage(value[key]);
    if (message) {
      return message;
    }
  }

  return null;
}

function errorCodeForStatus(status: number): ElevenLabsErrorCode {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 402) {
    return 'quota_exceeded';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 400 || status === 422) {
    return 'invalid_request';
  }
  return 'provider_error';
}

function retryableForStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function messageForProviderError(status: number, providerMessage: string | null): string {
  if (status === 401 || status === 403) {
    return 'ElevenLabs API key was rejected. Check the key in Settings.';
  }
  if (status === 402) {
    return providerMessage ?? 'ElevenLabs quota is exhausted for this account.';
  }
  if (status === 429) {
    return 'ElevenLabs rate limit reached. Try again later.';
  }
  if (providerMessage) {
    return `ElevenLabs request failed: ${providerMessage}`;
  }
  return `ElevenLabs request failed with status ${status}.`;
}

export async function providerErrorFromResponse(response: Response): Promise<ElevenLabsServiceError> {
  const status = response.status;
  const providerMessage = await readProviderMessage(response);
  return new ElevenLabsServiceError(
    messageForProviderError(status, providerMessage),
    errorCodeForStatus(status),
    {
      status,
      retryable: retryableForStatus(status),
    },
  );
}

async function readProviderMessage(response: Response): Promise<string | null> {
  let text = '';

  try {
    text = await response.text();
  } catch {
    return null;
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return extractProviderMessage(JSON.parse(text));
  } catch {
    return null;
  }
}

export function normalizeElevenLabsError(error: unknown): ElevenLabsServiceError {
  if (error instanceof ElevenLabsServiceError) {
    return error;
  }

  if (isAbortError(error)) {
    return new ElevenLabsServiceError('ElevenLabs request was canceled.', 'aborted');
  }

  if (error instanceof TypeError) {
    return new ElevenLabsServiceError('Network error while contacting ElevenLabs.', 'network_error', {
      retryable: true,
    });
  }

  return new ElevenLabsServiceError('Unexpected ElevenLabs request failure.', 'provider_error');
}
