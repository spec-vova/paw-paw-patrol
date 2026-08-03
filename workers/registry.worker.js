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

// Mirrors src/lib/registry.js; tests/backend.test.mjs compares the two.
export const UPSTREAM_HEADER_PROFILES = [
  {
    id: 'browser',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://public.nazk.gov.ua/',
      Origin: 'https://public.nazk.gov.ua',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    },
  },
  {
    id: 'plain',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'declaration-lookup/1.0',
    },
  },
];

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

    const tried = [];
    try {
      for (const profile of UPSTREAM_HEADER_PROFILES) {
        const upstream = await fetch(resolved.url, {
          headers: profile.headers,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const text = await upstream.text();
        const challenge = looksLikeChallenge(text);

        if (upstream.ok && !challenge) {
          try {
            return json(200, JSON.parse(text));
          } catch {
            return json(502, { error: 'Відповідь реєстру не є коректним JSON.', profile: profile.id });
          }
        }

        tried.push({ profile: profile.id, status: upstream.status, challenge });

        // Only a block is worth retrying with different headers.
        const blocked = challenge || upstream.status === 403 || upstream.status === 429;
        if (!blocked) break;
      }

      const last = tried[tried.length - 1];
      return json(502, {
        error: last.challenge
          ? 'Реєстр відхилив запит (захист Cloudflare).'
          : `Реєстр відповів помилкою ${last.status}.`,
        upstreamStatus: last.status,
        challenge: last.challenge,
        upstreamUrl: resolved.url,
        tried,
      });
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      return json(timedOut ? 504 : 502, {
        error: timedOut ? 'Реєстр не відповів вчасно.' : `Не вдалося звернутися до реєстру: ${error.message}`,
        tried,
      });
    }
  },
};
