import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyProxy,
  buildBackendDocumentUrl,
  buildBackendSearchUrl,
  buildDocumentUrl,
  buildSearchUrl,
  DEFAULT_PROXY_TEMPLATE,
  isWorkersHost,
  looksLikeChallenge,
  migrateProxyTemplate,
  normalizeBackendBase,
  resolveUpstream,
} from '../src/lib/registry.js';

const params = (obj) => new URLSearchParams(obj);

test('buildSearchUrl targets the registry list endpoint', () => {
  const url = new URL(buildSearchUrl('Іваненко\nІван Іванович'));
  assert.equal(url.origin, 'https://public-api.nazk.gov.ua');
  assert.equal(url.pathname, '/v2/documents/list');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван Іванович');
  assert.equal(url.searchParams.get('page'), null, 'the first page needs no parameter');

  const second = new URL(buildSearchUrl('Іваненко Іван', { page: 3, declarationYear: 2023 }));
  assert.equal(second.searchParams.get('page'), '3');
  assert.equal(second.searchParams.get('declaration_year'), '2023');
});

test('buildSearchUrl honours a custom API base', () => {
  const url = buildSearchUrl('Іваненко Іван', { base: 'https://example.test/api' });
  assert.ok(url.startsWith('https://example.test/api/documents/list?'));
});

test('buildDocumentUrl escapes the identifier', () => {
  assert.equal(
    buildDocumentUrl('82e5aea2-2935-4902-bf2b-765e7c9db079'),
    'https://public-api.nazk.gov.ua/v2/documents/82e5aea2-2935-4902-bf2b-765e7c9db079'
  );
  assert.ok(buildDocumentUrl('a/b').endsWith('/documents/a%2Fb'));
});

test('applyProxy substitutes the URL into the template', () => {
  const target = 'https://api.test/x?y=1';
  assert.equal(applyProxy(target, ''), target, 'an empty template changes nothing');
  assert.equal(applyProxy(target, 'https://p.test/?{url}'), `https://p.test/?${encodeURIComponent(target)}`);
  assert.equal(applyProxy(target, 'https://p.test/raw?url='), `https://p.test/raw?url=${encodeURIComponent(target)}`);
});

test('resolveUpstream passes the allowed paths through', () => {
  const list = resolveUpstream(params({ path: 'documents/list', query: 'Іваненко Іван' }));
  assert.equal(list.ok, true);
  const url = new URL(list.url);
  assert.equal(url.origin + url.pathname, 'https://public-api.nazk.gov.ua/v2/documents/list');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван');

  const doc = resolveUpstream(params({ path: 'documents/82e5aea2-2935-4902-bf2b-765e7c9db079' }));
  assert.equal(doc.ok, true);
  assert.ok(doc.url.endsWith('/documents/82e5aea2-2935-4902-bf2b-765e7c9db079'));
});

test('resolveUpstream refuses to become an open proxy', () => {
  const cases = [
    { path: 'https://evil.test/steal' },
    { path: '../../admin' },
    { path: 'documents/../../secret' },
    { path: 'users/list' },
    { path: 'documents/list/../../etc/passwd' },
    {},
  ];
  for (const input of cases) {
    assert.equal(resolveUpstream(params(input)).ok, false, `should reject: ${JSON.stringify(input)}`);
  }
});

test('resolveUpstream forwards known parameters only', () => {
  const resolved = resolveUpstream(
    params({ path: 'documents/list', query: 'Іваненко', page: '2', declaration_year: '2023', evil: 'x', token: 'y' })
  );
  const url = new URL(resolved.url);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('declaration_year'), '2023');
  assert.equal(url.searchParams.get('evil'), null);
  assert.equal(url.searchParams.get('token'), null);
});

test('resolveUpstream skips empty parameter values', () => {
  const resolved = resolveUpstream(params({ path: 'documents/list', query: 'Іваненко', page: '' }));
  assert.equal(new URL(resolved.url).searchParams.has('page'), false);
});

test('backend URLs survive a full round trip through resolveUpstream', () => {
  const built = new URL(buildBackendSearchUrl('https://x.vercel.app/api/registry', 'Іваненко Іван', { page: 2 }));
  assert.equal(built.pathname, '/api/registry');
  assert.equal(built.searchParams.get('path'), 'documents/list');

  const resolved = resolveUpstream(built.searchParams);
  assert.equal(resolved.ok, true);
  const upstream = new URL(resolved.url);
  assert.equal(upstream.pathname, '/v2/documents/list');
  assert.equal(upstream.searchParams.get('query'), 'Іваненко Іван');
  assert.equal(upstream.searchParams.get('page'), '2');

  const doc = resolveUpstream(
    new URL(buildBackendDocumentUrl('https://x.vercel.app/api/registry', 'uuid-1')).searchParams
  );
  assert.equal(doc.ok, true);
  assert.ok(doc.url.endsWith('/v2/documents/uuid-1'));
});

test('buildBackendSearchUrl trims a trailing slash and collapses the name', () => {
  const url = new URL(buildBackendSearchUrl('https://x.vercel.app/api/registry/', 'Іваненко\nІван'));
  assert.equal(url.pathname, '/api/registry');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван');
  assert.equal(url.searchParams.get('page'), null);
});

test('normalizeBackendBase upgrades http to https on an https page', () => {
  // Mixed content is blocked by the browser before the request leaves, and the
  // resulting failure is indistinguishable from "no network".
  const fixed = normalizeBackendBase('http://paw-paw-patrol-eta.vercel.app/api/registry');
  assert.equal(fixed.value, 'https://paw-paw-patrol-eta.vercel.app/api/registry');
  assert.match(fixed.warning, /https/);
});

test('normalizeBackendBase leaves http alone when the page itself is http', () => {
  const kept = normalizeBackendBase('http://localhost:3000/api/registry', { pageProtocol: 'http:' });
  assert.equal(kept.value, 'http://localhost:3000/api/registry');
  assert.equal(kept.warning, null);
});

test('a path is never mistaken for a hostname', () => {
  // Typing "/api/registry" and getting "https://api/registry" back is what a
  // phone actually produced: the scheme was glued onto a path.
  for (const input of ['api/registry', '/api/registry', 'https://api/registry', 'https:///api/registry']) {
    assert.equal(normalizeBackendBase(input).value, '/api/registry', `input: ${input}`);
  }

  // A real host keeps its scheme.
  assert.equal(
    normalizeBackendBase('paw-paw-patrol-eta.vercel.app/api/registry').value,
    'https://paw-paw-patrol-eta.vercel.app/api/registry'
  );
  assert.equal(normalizeBackendBase('localhost:3000/api', { pageProtocol: 'http:' }).value, 'https://localhost:3000/api');
  assert.equal(normalizeBackendBase('127.0.0.1:8099/api', { pageProtocol: 'http:' }).value, 'https://127.0.0.1:8099/api');
});

test('a half-cleared field becomes empty rather than nonsense', () => {
  for (const input of ['https://', 'https:', 'http://', '  ']) {
    assert.deepEqual(normalizeBackendBase(input), { value: '', warning: null }, `input: ${input}`);
  }
});

test('normalizeBackendBase accepts a same-origin path and adds a missing scheme', () => {
  assert.deepEqual(normalizeBackendBase('/api/registry'), { value: '/api/registry', warning: null });
  assert.deepEqual(normalizeBackendBase('  /api/registry/  '), { value: '/api/registry', warning: null });

  const bare = normalizeBackendBase('project.vercel.app/api/registry');
  assert.equal(bare.value, 'https://project.vercel.app/api/registry');
  assert.match(bare.warning, /https/);

  assert.deepEqual(normalizeBackendBase('https://x.test/api'), { value: 'https://x.test/api', warning: null });
  assert.deepEqual(normalizeBackendBase(''), { value: '', warning: null });
  assert.deepEqual(normalizeBackendBase(null), { value: '', warning: null });
});

test('a normalized same-origin path still builds a usable request', () => {
  const url = buildBackendSearchUrl(normalizeBackendBase('/api/registry').value, 'Іваненко Іван');
  assert.equal(url, '/api/registry?path=documents%2Flist&query=%D0%86%D0%B2%D0%B0%D0%BD%D0%B5%D0%BD%D0%BA%D0%BE+%D0%86%D0%B2%D0%B0%D0%BD');

  const resolved = resolveUpstream(new URL(url, 'https://app.test').searchParams);
  assert.equal(resolved.ok, true);
  assert.ok(resolved.url.includes('/documents/list'));
});

test('a retired proxy template is replaced instead of failing forever', () => {
  // corsproxy.io answers "Free usage is limited to localhost" without a key,
  // and a stored setting would otherwise keep showing that error for good.
  assert.equal(migrateProxyTemplate('https://corsproxy.io/?{url}'), DEFAULT_PROXY_TEMPLATE);
  assert.equal(migrateProxyTemplate(''), DEFAULT_PROXY_TEMPLATE);
  assert.equal(migrateProxyTemplate(null), DEFAULT_PROXY_TEMPLATE);

  const custom = 'https://my-proxy.test/?{url}';
  assert.equal(migrateProxyTemplate(custom), custom, 'a deliberate choice is left alone');
});

test('a Cloudflare Workers backend is recognised', () => {
  // Cloudflare refuses subrequests from its own Workers to origins it fronts,
  // so the advice for this host differs from any other backend.
  assert.equal(isWorkersHost('https://5be059f1-paw-paw-patrol.lazarchuk-v-u.workers.dev'), true);
  assert.equal(isWorkersHost('https://project.vercel.app/api/registry'), false);
  assert.equal(isWorkersHost('/api/registry'), false);
  assert.equal(isWorkersHost(''), false);
  assert.equal(isWorkersHost(null), false);
  assert.equal(isWorkersHost('https://workers.dev.evil.test'), false, 'suffix match, not substring');
});

test('looksLikeChallenge detects the Cloudflare interstitial', () => {
  const cloudflare =
    '<html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> ' +
    "<script>window.__CF$cv$params={r:'a250eba08facbabc'};</script>";
  assert.equal(looksLikeChallenge(cloudflare), true);
  assert.equal(looksLikeChallenge('<!doctype html><html><body>text</body></html>'), true);
  assert.equal(looksLikeChallenge('  <html>'), true);
  assert.equal(looksLikeChallenge('{"items":[]}'), false);
  assert.equal(looksLikeChallenge('[]'), false);
  assert.equal(looksLikeChallenge(''), false);
  assert.equal(looksLikeChallenge(null), false);
});
