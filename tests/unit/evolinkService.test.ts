import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVOLINK_NANO_BANANA_2_MODEL,
  EVOLINK_NANO_BANANA_2_PROVIDER_ID,
  evolinkService,
} from '../../src/services/evolinkService';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('evolinkService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    evolinkService.setApiKey('ev-test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates Nano Banana 2 image tasks through the BYO proxy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'task-1',
      progress: 0,
      status: 'pending',
    }));

    const taskId = await evolinkService.createTextToImage({
      provider: EVOLINK_NANO_BANANA_2_PROVIDER_ID,
      prompt: 'A clean studio product photo',
      aspectRatio: '16:9',
      resolution: '2K',
      outputFormat: 'png',
    });

    expect(taskId).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/evolink/byo/request', expect.objectContaining({
      headers: expect.objectContaining({
        'x-evolink-api-key': 'ev-test-key',
      }),
      method: 'POST',
    }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toEqual({
      endpoint: '/v1/images/generations',
      method: 'POST',
      body: {
        model: EVOLINK_NANO_BANANA_2_MODEL,
        prompt: 'A clean studio product photo',
        quality: '2K',
        size: '16:9',
      },
    });
  });

  it('normalizes completed image task results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      created: 1756817821,
      id: 'task-1',
      progress: 100,
      results: ['https://files.evolink.ai/generated.png'],
      status: 'completed',
      type: 'image',
    }));

    const task = await evolinkService.getImageTaskStatus('task-1');

    expect(task).toMatchObject({
      id: 'task-1',
      imageUrl: 'https://files.evolink.ai/generated.png',
      progress: 1,
      status: 'completed',
    });
    expect(task.createdAt).toBeInstanceOf(Date);
    expect(task.completedAt).toBeInstanceOf(Date);
  });
});
