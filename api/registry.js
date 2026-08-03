/**
 * Server-side backend for the declarations registry (Vercel function).
 *
 * Why it exists: public-api.nazk.gov.ua sits behind Cloudflare, which answers
 * 403 to cross-origin browser requests. Going through a server removes the
 * foreign Origin and returns the data with permissive CORS.
 *
 * Cloudflare may still refuse a datacenter IP, so each request is attempted
 * with more than one header profile before giving up, and the failure is
 * reported in a machine-readable form (`challenge`, `tried`) so the app can
 * tell "blocked" apart from "broken".
 *
 * Only documents/list and documents/{id} plus a narrow parameter list are
 * allowed — see resolveUpstream(), otherwise this would be an open proxy.
 */

import { looksLikeChallenge, resolveUpstream, UPSTREAM_HEADER_PROFILES } from '../src/lib/index.js';

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
  const tried = [];

  try {
    for (const profile of UPSTREAM_HEADER_PROFILES) {
      const upstream = await fetch(resolved.url, { headers: profile.headers, signal: controller.signal });
      const text = await upstream.text();
      const challenge = looksLikeChallenge(text);

      if (upstream.ok && !challenge) {
        try {
          return sendJson(response, 200, JSON.parse(text));
        } catch {
          return sendJson(response, 502, { error: 'Відповідь реєстру не є коректним JSON.', profile: profile.id });
        }
      }

      tried.push({ profile: profile.id, status: upstream.status, challenge });

      // Only a block is worth retrying with different headers; a 404 or 500
      // means the request itself was understood.
      const blocked = challenge || upstream.status === 403 || upstream.status === 429;
      if (!blocked) break;
    }

    const last = tried[tried.length - 1];
    return sendJson(response, 502, {
      error: last.challenge
        ? 'Реєстр відхилив запит (захист Cloudflare).'
        : `Реєстр відповів помилкою ${last.status}.`,
      upstreamStatus: last.status,
      challenge: last.challenge,
      upstreamUrl: resolved.url,
      tried,
    });
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return sendJson(response, timedOut ? 504 : 502, {
      error: timedOut ? 'Реєстр не відповів вчасно.' : `Не вдалося звернутися до реєстру: ${error.message}`,
      tried,
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
