import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyProxy,
  buildBackendDocumentUrl,
  buildBackendSearchUrl,
  buildDocumentUrl,
  buildSearchUrl,
  looksLikeChallenge,
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
