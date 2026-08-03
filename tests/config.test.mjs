/**
 * Guards the deployment configs. A wrong entry point here does not fail
 * locally — it fails minutes later inside someone else's build.
 */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) =>
  access(new URL(`../${path}`, import.meta.url)).then(
    () => true,
    () => false
  );

test('wrangler.toml points at a worker entry point that exists', async () => {
  const toml = await read('wrangler.toml');

  const main = /^\s*main\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  assert.ok(main, 'main is declared — without it wrangler guesses "static site"');
  assert.equal(await exists(main), true, `${main} does not exist`);

  const module = await import(`../${main}`);
  assert.equal(typeof module.default?.fetch, 'function', 'the entry point exports a fetch handler');

  assert.match(toml, /^\s*name\s*=\s*"[^"]+"/m);
  assert.match(toml, /^\s*compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m);
});

test('wrangler does not upload the repository as static assets', async () => {
  const toml = await read('wrangler.toml');
  // An [assets] section with directory "." pulls in node_modules and blows
  // past the 25 MiB per-file limit.
  const assetsDirective = /^\s*\[assets\]/m.test(toml);
  assert.equal(assetsDirective, false, 'assets are served elsewhere, see docs/deploy.md');
});

test('vercel.json does not pin a builder version', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  const fn = vercel.functions?.['api/registry.js'];
  assert.ok(fn, 'the function is declared');
  // A pinned @vercel/node drifts out of step with the project Node version.
  assert.equal(fn.runtime, undefined, 'the builder version must not be pinned');
});

test('the declared Node version matches what CI runs', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.engines?.node, '22.x');

  const workflow = await read('.github/workflows/pages.yml');
  assert.match(workflow, /node-version: '22'/);
});
