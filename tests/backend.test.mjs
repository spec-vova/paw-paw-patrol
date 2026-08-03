/**
 * Exercises both backend implementations against a fake registry: the real
 * public-api.nazk.gov.ua is unreachable from the build environment.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';

import handler from '../api/registry.js';
import worker, { looksLikeChallenge as workerChallenge, resolveUpstream as workerResolve } from '../workers/registry.worker.js';
import { looksLikeChallenge, resolveUpstream } from '../src/lib/registry.js';

// ─── fake registry ───

let mode = 'ok';
const upstream = http.createServer((req, res) => {
  if (mode === 'challenge') {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end(
      '<html> <head><title>403 Forbidden</title></head> <body><center><h1>403 Forbidden</h1></center>' +
        "<script>window.__CF$cv$params={r:'abc'};</script></body></html>"
    );
    return;
  }
  if (mode === 'garbage') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not json at all');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ items: [{ id: 'x1', lastname: 'Іваненко' }], total: 1, echo: req.url }));
});

await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${upstream.address().port}/v2`;
process.env.REGISTRY_API_BASE = BASE;

after(() => upstream.close());

// ─── minimal Vercel-style req/res stubs ───

function makeResponse(onEnd) {
  return {
    headers: {},
    statusCode: 0,
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      onEnd?.(this);
      return this;
    },
  };
}

function callHandler(query, method = 'GET') {
  const res = makeResponse();
  return handler({ method, url: `/api/registry${query}`, headers: { host: 'app.test' } }, res).then(() => res);
}

const callWorker = (query) => worker.fetch(new Request(`https://worker.test/${query}`), { REGISTRY_API_BASE: BASE });

// ─── tests ───

test('the backend returns registry JSON with permissive CORS', async () => {
  mode = 'ok';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');

  const body = JSON.parse(res.body);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].lastname, 'Іваненко');
  assert.match(decodeURIComponent(body.echo), /query=Іваненко/, 'the parameter reached the registry');
});

test('a Cloudflare interstitial becomes a clear error, not raw HTML', async () => {
  mode = 'challenge';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 502);

  const body = JSON.parse(res.body);
  assert.equal(body.challenge, true);
  assert.equal(body.upstreamStatus, 403);
  assert.doesNotMatch(body.error, /<html/i, 'markup does not leak into the message');
});

test('malformed upstream JSON does not break the backend', async () => {
  mode = 'garbage';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /JSON/);
});

test('a disallowed path is rejected before any network call', async () => {
  mode = 'ok';
  const res = await callHandler('?path=https://evil.test/steal');
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /not allowed/);
});

test('preflight and non-GET methods are handled', async () => {
  const preflight = await new Promise((resolve) => {
    const res = makeResponse(resolve);
    handler({ method: 'OPTIONS', url: '/api/registry', headers: {} }, res);
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');

  const post = await callHandler('?path=documents/list', 'POST');
  assert.equal(post.statusCode, 405);
});

test('the worker answers exactly like the Vercel function', async () => {
  mode = 'ok';
  const ok = await callWorker('?path=documents/list&query=Іваненко');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  assert.equal((await ok.json()).total, 1);

  mode = 'challenge';
  const blocked = await callWorker('?path=documents/list&query=Іваненко');
  assert.equal(blocked.status, 502);
  assert.equal((await blocked.json()).challenge, true);

  mode = 'ok';
  const rejected = await callWorker('?path=../secret');
  assert.equal(rejected.status, 400);
});

test('the worker copy of the shared helpers has not drifted', () => {
  const inputs = [
    { path: 'documents/list', query: 'Іваненко Іван', page: '3' },
    { path: 'documents/abc-123' },
    { path: 'https://evil.test/x' },
    { path: '../secret' },
    {},
  ];
  for (const input of inputs) {
    assert.deepEqual(
      workerResolve(new URLSearchParams(input)),
      resolveUpstream(new URLSearchParams(input)),
      `mismatch on ${JSON.stringify(input)}`
    );
  }

  for (const text of ['<html>', '{"a":1}', 'window.__CF$cv$params={}', '', 'Just a moment...']) {
    assert.equal(workerChallenge(text), looksLikeChallenge(text), `mismatch on ${JSON.stringify(text)}`);
  }
});
