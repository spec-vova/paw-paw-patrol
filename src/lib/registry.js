/**
 * Registry endpoints and request routing.
 *
 * The registry sits behind Cloudflare, which answers 403 to cross-origin
 * browser requests. Hence three possible routes to the same data:
 *   1. own backend  — api/registry.js or workers/registry.worker.js
 *   2. direct       — works only where Cloudflare lets the browser through
 *   3. CORS proxy   — third-party fallback, off by default
 */

import { normalizePib } from './pib.js';

export const API_BASE = 'https://public-api.nazk.gov.ua/v2';

/** Query parameters the backend agrees to forward upstream. */
export const FORWARDED_PARAMS = ['query', 'page', 'declaration_year', 'user_declarant_id'];

const SAFE_PATH = /^documents\/(list|[A-Za-z0-9-]{1,64})$/;

// ─────────────────────────── direct registry ───────────────────────────

/**
 * Registry document-list URL.
 * @param {string} pib
 * @param {{page?: number, base?: string, declarationYear?: number|string}} [options]
 */
export function buildSearchUrl(pib, options = {}) {
  const { page = 1, base = API_BASE, declarationYear } = options;
  const params = new URLSearchParams({ query: normalizePib(pib) });
  if (page && page > 1) params.set('page', String(page));
  if (declarationYear) params.set('declaration_year', String(declarationYear));
  return `${base}/documents/list?${params.toString()}`;
}

/** Registry URL of a single document. */
export function buildDocumentUrl(id, options = {}) {
  const { base = API_BASE } = options;
  return `${base}/documents/${encodeURIComponent(String(id))}`;
}

/** Link to the document page in the registry web interface. */
export function buildRegistryLink(id) {
  return `https://${REGISTRY_WEB_HOST}/documents/${encodeURIComponent(String(id))}`;
}

const REGISTRY_WEB_HOST = 'public.nazk.gov.ua';

// ──────────────────────────── own backend ──────────────────────────────

/**
 * Turns a backend request into a safe upstream registry URL.
 *
 * Only two known paths and a narrow parameter list are allowed — otherwise
 * the backend would be an open proxy to any address (SSRF).
 *
 * @param {URLSearchParams|{get(name: string): string|null}} searchParams
 * @param {{base?: string}} [options]
 * @returns {{ok: true, url: string} | {ok: false, error: string}}
 */
export function resolveUpstream(searchParams, options = {}) {
  const { base = API_BASE } = options;
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

/**
 * Cleans up a hand-typed backend address.
 *
 * A page served over https cannot call an http endpoint — the browser blocks
 * it as mixed content before any request leaves, and fetch fails with the same
 * generic error as "no network". Upgrading the scheme here removes the trap.
 *
 * @param {string} input
 * @param {{pageProtocol?: string}} [options]
 * @returns {{value: string, warning: string|null}}
 */
export function normalizeBackendBase(input, options = {}) {
  const { pageProtocol = 'https:' } = options;
  const raw = trimSlashes(input);

  if (!raw) return { value: '', warning: null };
  // A same-origin path such as /api/registry needs no scheme at all.
  if (raw.startsWith('/')) return { value: raw, warning: null };

  if (/^http:\/\//i.test(raw)) {
    if (pageProtocol === 'https:') {
      return {
        value: raw.replace(/^http:\/\//i, 'https://'),
        warning: 'Адресу виправлено на https:// — браузер блокує http-запити зі сторінки https.',
      };
    }
    return { value: raw, warning: null };
  }

  if (/^https:\/\//i.test(raw)) return { value: raw, warning: null };

  return { value: `https://${raw}`, warning: 'До адреси бекенда додано https://.' };
}

/** Document-list URL addressed to the own backend. */
export function buildBackendSearchUrl(backendBase, pib, options = {}) {
  const { page = 1, declarationYear } = options;
  const params = new URLSearchParams({ path: 'documents/list', query: normalizePib(pib) });
  if (page && page > 1) params.set('page', String(page));
  if (declarationYear) params.set('declaration_year', String(declarationYear));
  return `${trimSlashes(backendBase)}?${params.toString()}`;
}

/** Single-document URL addressed to the own backend. */
export function buildBackendDocumentUrl(backendBase, id) {
  const params = new URLSearchParams({ path: `documents/${String(id)}` });
  return `${trimSlashes(backendBase)}?${params.toString()}`;
}

function trimSlashes(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
}

// ───────────────────────────── CORS proxy ──────────────────────────────

/**
 * Wraps a URL into a CORS proxy template containing a {url} placeholder.
 * An empty template returns the URL unchanged.
 */
export function applyProxy(url, template) {
  const tpl = String(template ?? '').trim();
  if (!tpl) return url;
  if (tpl.includes('{url}')) return tpl.replace('{url}', encodeURIComponent(url));
  return tpl.endsWith('=') || tpl.endsWith('?') || tpl.endsWith('/')
    ? tpl + encodeURIComponent(url)
    : `${tpl}${encodeURIComponent(url)}`;
}

// ─────────────────────────── upstream headers ──────────────────────────

/**
 * Header sets the backend tries, in order, before giving up.
 *
 * Cloudflare decides per request, and the two profiles fail in opposite
 * directions: a self-identifying client is refused by bot rules, while a
 * browser impersonation is refused when the TLS fingerprint does not match the
 * claimed browser. Trying both costs one extra request and sometimes wins.
 *
 * Neither profile can fake a TLS fingerprint, so a determined block still
 * holds — see docs/api.md for what to do then.
 */
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

// ──────────────────────────── response guard ───────────────────────────

/**
 * Detects a Cloudflare interstitial or any HTML served instead of JSON,
 * so the UI can explain the cause instead of dumping markup on screen.
 */
export function looksLikeChallenge(text) {
  const head = String(text ?? '').slice(0, 1500);
  return (
    /__CF\$cv\$params|cdn-cgi\/challenge|Attention Required|Just a moment/i.test(head) ||
    /^\s*<(!doctype|html)\b/i.test(head)
  );
}
