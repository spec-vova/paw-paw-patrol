/**
 * Server-side backend for the declarations registry (Vercel function).
 *
 * Why it exists: public-api.nazk.gov.ua sits behind Cloudflare, which answers
 * 403 to browser requests. A server request carries no Origin header and a
 * plain User-Agent, so it gets through; the response is handed back to the
 * browser with permissive CORS.
 *
 * Only documents/list and documents/{id} plus a narrow parameter list are
 * allowed — see resolveUpstream(), otherwise this would be an open proxy.
 */

import { looksLikeChallenge, resolveUpstream } from '../src/lib/index.js';

// Message language follows the audience: misuse of the endpoint (wrong method
// or path) is reported in English, while upstream failures are shown verbatim
// in the Ukrainian UI and are therefore written in Ukrainian.
const UPSTREAM_TIMEOUT_MS = 15000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60',
};

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, null);
  }
  if (request.method !== 'GET') {
    return sendJson(response, 405, { error: 'Only GET is allowed.' });
  }

  const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  // REGISTRY_API_BASE retargets the backend without touching the code.
  const base = process.env.REGISTRY_API_BASE;
  const resolved = resolveUpstream(url.searchParams, base ? { base } : {});
  if (!resolved.ok) {
    return sendJson(response, 400, { error: resolved.error });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(resolved.url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'uk-UA,uk;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; declaration-lookup/1.0)',
      },
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return sendJson(response, 502, {
        error: `Реєстр відповів помилкою ${upstream.status}.`,
        upstreamStatus: upstream.status,
        challenge: looksLikeChallenge(text),
        upstreamUrl: resolved.url,
      });
    }

    if (looksLikeChallenge(text)) {
      return sendJson(response, 502, {
        error: 'Реєстр повернув сторінку-заглушку замість JSON.',
        challenge: true,
        upstreamUrl: resolved.url,
      });
    }

    try {
      return sendJson(response, 200, JSON.parse(text));
    } catch {
      return sendJson(response, 502, { error: 'Відповідь реєстру не є коректним JSON.' });
    }
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return sendJson(response, timedOut ? 504 : 502, {
      error: timedOut ? 'Реєстр не відповів вчасно.' : `Не вдалося звернутися до реєстру: ${error.message}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(response, status, body) {
  for (const [name, value] of Object.entries(CORS)) response.setHeader(name, value);
  if (body === null) {
    response.status(status).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(status).send(JSON.stringify(body));
}
