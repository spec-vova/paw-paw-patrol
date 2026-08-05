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
  // A scheme with nothing after it is what a half-cleared field looks like.
  if (/^https?:?\/*$/i.test(raw)) return { value: '', warning: null };
  // A same-origin path such as /api/registry needs no scheme at all.
  if (raw.startsWith('/')) return { value: raw, warning: null };

  const scheme = /^(https?):\/\/(.*)$/i.exec(raw);
  if (scheme) {
    const rest = scheme[2];
    // "https:///api/registry" and "https://api/registry" are what a scheme
    // glued onto a path looks like. Neither is a host, so keep the path.
    if (!rest || rest.startsWith('/')) {
      return { value: rest ? `/${rest.replace(/^\/+/, '')}` : '', warning: 'Адресу зведено до шляху на цьому ж домені.' };
    }
    if (!isHostLike(rest.split('/')[0])) {
      return { value: `/${rest}`, warning: 'Адресу зведено до шляху на цьому ж домені.' };
    }

    if (scheme[1].toLowerCase() === 'http' && pageProtocol === 'https:') {
      return {
        value: raw.replace(/^http:\/\//i, 'https://'),
        warning: 'Адресу виправлено на https:// — браузер блокує http-запити зі сторінки https.',
      };
    }
    return { value: raw, warning: null };
  }

  // No scheme: decide between a host ("project.vercel.app/api") and a bare
  // path ("api/registry"). Only the former deserves an https:// prefix.
  if (!isHostLike(raw.split('/')[0])) {
    return { value: `/${raw}`, warning: 'Адресу зведено до шляху на цьому ж домені.' };
  }
  return { value: `https://${raw}`, warning: 'До адреси бекенда додано https://.' };
}

/** A host has a dot (example.com) or is localhost, possibly with a port. */
function isHostLike(candidate) {
  const host = String(candidate ?? '').split(':')[0];
  return host === 'localhost' || /\.[a-z]{2,}$/i.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Splits a multi-line backend setting into normalised addresses.
 *
 * More than one is allowed because the upstream block is not deterministic:
 * the same Worker answered at one hour and was refused at another, and Vercel
 * behaved the other way round. Keeping both configured means the app finds a
 * live route by itself instead of the user editing settings after every mood
 * swing of the edge network.
 *
 * @returns {{value: string[], warnings: string[]}}
 */
export function parseBackends(input, options = {}) {
  const lines = String(input ?? '')
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const value = [];
  const warnings = [];
  for (const line of lines) {
    const normalized = normalizeBackendBase(line, options);
    if (!normalized.value) continue;
    if (normalized.warning) warnings.push(normalized.warning);
    if (!value.includes(normalized.value)) value.push(normalized.value);
  }
  return { value, warnings };
}

/** Short label for a backend address, for diagnostics and error lists. */
export function backendLabel(address) {
  const value = String(address ?? '').trim();
  if (!value) return 'бекенд';
  if (value.startsWith('/')) return `цей домен (${value})`;
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
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

/**
 * Proxy templates that are known to be dead, so a stored setting can be
 * migrated instead of failing forever with someone else's error message.
 */
export const RETIRED_PROXY_TEMPLATES = [/corsproxy\.io/i];

/** Default template, also used to replace a retired one. */
export const DEFAULT_PROXY_TEMPLATE = 'https://api.allorigins.win/raw?url={url}';

/** Swaps a retired proxy template for the current default. */
export function migrateProxyTemplate(template) {
  const value = String(template ?? '').trim();
  if (!value) return DEFAULT_PROXY_TEMPLATE;
  return RETIRED_PROXY_TEMPLATES.some((pattern) => pattern.test(value)) ? DEFAULT_PROXY_TEMPLATE : value;
}

/**
 * Whether a backend runs on Cloudflare Workers.
 *
 * Matters for diagnosis: Cloudflare refuses subrequests from its own Workers to
 * origins it fronts, so a Worker backend is blocked where a plain server is not.
 */
export function isWorkersHost(url) {
  try {
    return /\.workers\.dev$/i.test(new URL(String(url), 'https://x.invalid').hostname);
  } catch {
    return false;
  }
}

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
