/**
 * The same backend, packaged as a Cloudflare Worker.
 *
 * This file is deliberately self-contained: it can be pasted into the editor
 * on dash.cloudflare.com straight from a phone, with no build and no repo.
 * It duplicates resolveUpstream()/looksLikeChallenge() from src/lib/registry.js;
 * tests/backend.test.mjs compares both implementations so they cannot drift.
 */

const API_BASE = 'https://public-api.nazk.gov.ua/v2';
const FORWARDED_PARAMS = ['query', 'page', 'declaration_year', 'user_declarant_id'];
const SAFE_PATH = /^documents\/(list|[A-Za-z0-9-]{1,64})$/;
const UPSTREAM_TIMEOUT_MS = 15000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60',
};

export function resolveUpstream(searchParams, options = {}) {
  const base = options.base || API_BASE;
  const path = (searchParams.get('path') || '').trim();

  if (!path) return { ok: false, error: 'Missing "path" parameter.' };
  if (!SAFE_PATH.test(path)) return { ok: false, error: `Path is not allowed: ${path}` };

  const forwarded = new URLSearchParams();
  for (const name of FORWARDED_PARAMS) {
    const value = searchParams.get(name);
    if (value !== null && String(value).trim() !== '') forwarded.set(name, String(value));
  }

  const qs = forwarded.toString();
  return { ok: true, url: `${base}/${path}${qs ? `?${qs}` : ''}` };
}

export function looksLikeChallenge(text) {
  const head = String(text ?? '').slice(0, 1500);
  return (
    /__CF\$cv\$params|cdn-cgi\/challenge|Attention Required|Just a moment/i.test(head) ||
    /^\s*<(!doctype|html)\b/i.test(head)
  );
}

function json(status, body) {
  if (body === null) return new Response(null, { status, headers: CORS });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env = {}) {
    if (request.method === 'OPTIONS') return json(204, null);
    if (request.method !== 'GET') return json(405, { error: 'Only GET is allowed.' });

    // REGISTRY_API_BASE retargets the backend without touching the code.
    const base = env.REGISTRY_API_BASE;
    const resolved = resolveUpstream(new URL(request.url).searchParams, base ? { base } : {});
    if (!resolved.ok) return json(400, { error: resolved.error });

    try {
      const upstream = await fetch(resolved.url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'uk-UA,uk;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; declaration-lookup/1.0)',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      const text = await upstream.text();

      if (!upstream.ok) {
        return json(502, {
          error: `Реєстр відповів помилкою ${upstream.status}.`,
          upstreamStatus: upstream.status,
          challenge: looksLikeChallenge(text),
          upstreamUrl: resolved.url,
        });
      }
      if (looksLikeChallenge(text)) {
        return json(502, { error: 'Реєстр повернув сторінку-заглушку замість JSON.', challenge: true });
      }

      try {
        return json(200, JSON.parse(text));
      } catch {
        return json(502, { error: 'Відповідь реєстру не є коректним JSON.' });
      }
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      return json(timedOut ? 504 : 502, {
        error: timedOut ? 'Реєстр не відповів вчасно.' : `Не вдалося звернутися до реєстру: ${error.message}`,
      });
    }
  },
};
