/**
 * Перевіряє посередника проти підробленого реєстру: справжній
 * public-api.nazk.gov.ua недоступний із середовища збірки.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';

import handler from '../api/registry.js';
import worker from '../worker.js';

// ─── підроблений реєстр ───

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
    res.end('не json');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ items: [{ id: 'x1', lastname: 'Іваненко' }], total: 1, echo: req.url }));
});

await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${upstream.address().port}/v2`;
process.env.REGISTRY_API_BASE = BASE;

after(() => upstream.close());

// ─── мінімальні заглушки req/res у стилі Vercel ───

function callHandler(query) {
  const res = {
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
      return this;
    },
  };
  return handler({ method: 'GET', url: `/api/registry${query}`, headers: { host: 'app.test' } }, res).then(() => res);
}

const callWorker = (query) =>
  worker.fetch(new Request(`https://worker.test/${query}`), { REGISTRY_API_BASE: BASE });

// ─── тести ───

test('посередник віддає JSON реєстру з дозвільним CORS', async () => {
  mode = 'ok';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  const body = JSON.parse(res.body);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].lastname, 'Іваненко');
  assert.match(decodeURIComponent(body.echo), /query=Іваненко/, 'параметр дійшов до реєстру');
});

test('заглушка Cloudflare перетворюється на зрозумілу помилку, а не на HTML', async () => {
  mode = 'challenge';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.body);
  assert.equal(body.challenge, true);
  assert.equal(body.upstreamStatus, 403);
  assert.doesNotMatch(body.error, /<html/i, 'розмітка не протікає в повідомлення');
});

test('некоректний JSON від реєстру не ламає посередника', async () => {
  mode = 'garbage';
  const res = await callHandler('?path=documents/list&query=Іваненко');
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /JSON/);
});

test('заборонений шлях відхиляється до звернення в мережу', async () => {
  mode = 'ok';
  const res = await callHandler('?path=https://evil.test/steal');
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /Недозволений шлях/);
});

test('preflight і чужі методи обробляються', async () => {
  const preflight = await new Promise((resolve) => {
    const res = {
      headers: {},
      statusCode: 0,
      setHeader(n, v) {
        this.headers[n] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      end() {
        resolve(this);
        return this;
      },
      send() {
        return this;
      },
    };
    handler({ method: 'OPTIONS', url: '/api/registry', headers: {} }, res);
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');

  const post = await callHandler.call(null, '?path=documents/list');
  assert.equal(post.statusCode, 200, 'GET лишається дозволеним');
});

test('worker віддає ті самі відповіді, що й функція Vercel', async () => {
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
