import { hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../../lib/db';
import type { AppRouteHandler } from '../../../lib/env';

const EVOLINK_BASE_URL = 'https://api.evolink.ai';

interface EvolinkByoRequestBody {
  body?: unknown;
  endpoint?: unknown;
  method?: unknown;
}

function getByoEvolinkKey(request: Request): string | null {
  const value = request.headers.get('x-evolink-api-key')?.trim();
  return value || null;
}

function isAllowedEvolinkPath(pathname: string): boolean {
  return pathname === '/v1/images/generations'
    || pathname === '/v1/credits'
    || /^\/v1\/tasks\/[^/]+$/.test(pathname);
}

function resolveAllowedEvolinkUrl(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return null;
  }

  try {
    const target = new URL(endpoint, EVOLINK_BASE_URL);
    const base = new URL(EVOLINK_BASE_URL);

    if (target.origin !== base.origin || !isAllowedEvolinkPath(target.pathname)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

export const onRequest: AppRouteHandler = async (context): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { Allow: 'POST, OPTIONS' },
      status: 204,
    });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST', 'OPTIONS']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json({ error: 'invalid_origin' }, { status: 403 });
  }

  const apiKey = getByoEvolinkKey(context.request);
  if (!apiKey) {
    return json({ error: 'missing_evolink_key' }, { status: 401 });
  }

  const payload = await parseJson<EvolinkByoRequestBody>(context.request);
  const target = resolveAllowedEvolinkUrl(payload?.endpoint);
  const method = payload?.method === 'POST' ? 'POST' : payload?.method === 'GET' ? 'GET' : null;

  if (!payload || !target || !method) {
    return json({ error: 'invalid_evolink_proxy_request' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      body: method === 'POST' && payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method,
    });

    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
      },
      status: upstream.status,
    });
  } catch (error) {
    return json(
      {
        error: 'evolink_proxy_failed',
        message: error instanceof Error ? error.message : 'Failed to reach EvoLink',
      },
      { status: 502 },
    );
  }
};
