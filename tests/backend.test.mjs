import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildBackendDocumentUrl,
  buildBackendSearchUrl,
  looksLikeChallenge,
  resolveUpstream,
} from '../src/lib.js';
import { looksLikeChallenge as workerChallenge, resolveUpstream as workerResolve } from '../worker.js';

const params = (obj) => new URLSearchParams(obj);

test('resolveUpstream пропускає дозволені шляхи', () => {
  const list = resolveUpstream(params({ path: 'documents/list', query: 'Іваненко Іван' }));
  assert.equal(list.ok, true);
  const url = new URL(list.url);
  assert.equal(url.origin + url.pathname, 'https://public-api.nazk.gov.ua/v2/documents/list');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван');

  const doc = resolveUpstream(params({ path: 'documents/82e5aea2-2935-4902-bf2b-765e7c9db079' }));
  assert.equal(doc.ok, true);
  assert.ok(doc.url.endsWith('/documents/82e5aea2-2935-4902-bf2b-765e7c9db079'));
});

test('resolveUpstream не дає перетворити посередника на відкритий проксі', () => {
  const cases = [
    { path: 'https://evil.test/steal' },
    { path: '../../admin' },
    { path: 'documents/../../secret' },
    { path: 'users/list' },
    { path: 'documents/list/../../etc/passwd' },
    {},
  ];
  for (const input of cases) {
    assert.equal(resolveUpstream(params(input)).ok, false, `мав відхилити: ${JSON.stringify(input)}`);
  }
});

test('resolveUpstream передає лише відомі параметри', () => {
  const resolved = resolveUpstream(
    params({ path: 'documents/list', query: 'Іваненко', page: '2', declaration_year: '2023', evil: 'x', token: 'y' })
  );
  const url = new URL(resolved.url);
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('declaration_year'), '2023');
  assert.equal(url.searchParams.get('evil'), null);
  assert.equal(url.searchParams.get('token'), null);
});

test('resolveUpstream відкидає порожні значення параметрів', () => {
  const resolved = resolveUpstream(params({ path: 'documents/list', query: 'Іваненко', page: '' }));
  assert.equal(new URL(resolved.url).searchParams.has('page'), false);
});

test('looksLikeChallenge розпізнає заглушку Cloudflare', () => {
  const cloudflare =
    '<html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> ' +
    "<script>window.__CF$cv$params={r:'a250eba08facbabc'};</script>";
  assert.equal(looksLikeChallenge(cloudflare), true);
  assert.equal(looksLikeChallenge('<!doctype html><html><body>щось</body></html>'), true);
  assert.equal(looksLikeChallenge('  <html>'), true);
  assert.equal(looksLikeChallenge('{"items":[]}'), false);
  assert.equal(looksLikeChallenge('[]'), false);
  assert.equal(looksLikeChallenge(''), false);
  assert.equal(looksLikeChallenge(null), false);
});

test('worker.js поводиться так само, як src/lib.js', () => {
  const inputs = [
    { path: 'documents/list', query: 'Іваненко Іван', page: '3' },
    { path: 'documents/abc-123' },
    { path: 'https://evil.test/x' },
    { path: '../secret' },
    {},
  ];
  for (const input of inputs) {
    assert.deepEqual(
      workerResolve(params(input)),
      resolveUpstream(params(input)),
      `розбіжність на ${JSON.stringify(input)}`
    );
  }

  for (const text of ['<html>', '{"a":1}', 'window.__CF$cv$params={}', '', 'Just a moment...']) {
    assert.equal(workerChallenge(text), looksLikeChallenge(text), `розбіжність на ${JSON.stringify(text)}`);
  }
});

test('buildBackendSearchUrl складає запит до посередника', () => {
  const url = new URL(buildBackendSearchUrl('https://x.vercel.app/api/registry', 'Іваненко\nІван'));
  assert.equal(url.pathname, '/api/registry');
  assert.equal(url.searchParams.get('path'), 'documents/list');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван');
  assert.equal(url.searchParams.get('page'), null);

  const second = new URL(buildBackendSearchUrl('https://x.vercel.app/api/registry/', 'Іваненко Іван', { page: 2 }));
  assert.equal(second.pathname, '/api/registry', 'зайвий слеш прибирається');
  assert.equal(second.searchParams.get('page'), '2');
});

test('buildBackendDocumentUrl складає запит документа', () => {
  const url = new URL(buildBackendDocumentUrl('https://x.vercel.app/api/registry', 'abc-123'));
  assert.equal(url.searchParams.get('path'), 'documents/abc-123');
});

test('URL посередника переживає повний обіг через resolveUpstream', () => {
  // Те, що будує застосунок, має бути прийняте посередником.
  const built = new URL(buildBackendSearchUrl('https://x.vercel.app/api/registry', 'Іваненко Іван', { page: 2 }));
  const resolved = resolveUpstream(built.searchParams);
  assert.equal(resolved.ok, true);
  const upstream = new URL(resolved.url);
  assert.equal(upstream.pathname, '/v2/documents/list');
  assert.equal(upstream.searchParams.get('query'), 'Іваненко Іван');
  assert.equal(upstream.searchParams.get('page'), '2');

  const doc = resolveUpstream(new URL(buildBackendDocumentUrl('https://x.vercel.app/api/registry', 'uuid-1')).searchParams);
  assert.equal(doc.ok, true);
  assert.ok(doc.url.endsWith('/v2/documents/uuid-1'));
});
