/**
 * Browser walkthrough of the whole app on an emulated phone.
 *
 * Not part of `npm test`: it needs Playwright and a running static server.
 *
 *   npm start &
 *   node tests/e2e/browser.mjs
 *
 * Registry responses are stubbed — public-api.nazk.gov.ua is unreachable from
 * the build environment, and the point here is the UI, not the upstream.
 *
 * Env overrides: BASE_URL, PLAYWRIGHT_CHROMIUM, PLAYWRIGHT_PACKAGE, SCREENSHOT_DIR.
 */

// Playwright is not a dependency of this project, so it may live in a global
// install; PLAYWRIGHT_PACKAGE points at it when the bare import cannot resolve.
const playwright = await import('playwright').catch(() => {
  if (!process.env.PLAYWRIGHT_PACKAGE) {
    console.error('Playwright not found. Install it, or set PLAYWRIGHT_PACKAGE to its entry point.');
    process.exit(2);
  }
  return import(process.env.PLAYWRIGHT_PACKAGE);
});
const { chromium, devices } = playwright;

const OUT = process.env.SCREENSHOT_DIR || '';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099/index.html';

// Stubbed registry payloads.
const LIST = {
  total: 2,
  items: [
    {
      id: '82e5aea2-2935-4902-bf2b-765e7c9db079',
      lastname: 'Іваненко',
      firstname: 'Іван',
      middlename: 'Іванович',
      position: 'Головний спеціаліст відділу',
      placeOfWork: 'Міністерство юстиції України',
      declaration_year: 2023,
      declaration_type_name: 'Щорічна',
      date: '2024-03-28',
    },
    {
      id: '11111111-2222-3333-4444-555555555555',
      lastname: 'Іваненко',
      firstname: 'Іван',
      middlename: 'Петрович',
      position: 'Суддя',
      declaration_year: 2022,
      declaration_type_name: 'Перед звільненням',
    },
  ],
};

const DOC = {
  id: '82e5aea2-2935-4902-bf2b-765e7c9db079',
  data: {
    step_1: {
      lastname: 'Іваненко',
      firstname: 'Іван',
      middlename: 'Іванович',
      workPlace: 'Міністерство юстиції України',
      workPost: 'Головний спеціаліст відділу',
      publicPerson: true,
      previous_lastname: '',
    },
    step_3: {
      1: { objectType: 'Квартира', totalArea: '74.5', costDate: '1450000', ua_cityType: 'м. Київ' },
      2: { objectType: 'Гараж', totalArea: '18', costDate: '90000' },
    },
    step_11: {
      1: { objectTypeName: 'Заробітна плата', sizeIncome: '482000', source_ua_company_name: 'Мін’юст' },
    },
    step_6: {},
  },
};

const errors = [];
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'uk-UA' });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Both come from routes this file stubs on purpose (aborted request, 403 page).
  if (m.text().includes('ERR_FAILED')) return;
  if (m.text().includes('403 (Forbidden)')) return;
  errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.route('**/public-api.nazk.gov.ua/**', async (route) => {
  const url = route.request().url();
  const body = url.includes('/documents/list') ? LIST : DOC;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const shot = async (name, fullPage = false) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}`, fullPage });
};

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name} — ${e.message}`);
    errors.push(`${name}: ${e.message}`);
  }
};

await page.goto(BASE, { waitUntil: 'networkidle' });

await step('multi-line name collapses in the preview', async () => {
  await page.fill('#pib', 'іваненко\nіван\nіванович');
  const preview = await page.textContent('#preview');
  if (!preview.includes('іваненко іван іванович')) throw new Error(`preview: ${preview}`);
});

await step('the Google chip carries the word deklaratsiia', async () => {
  const href = await page.getAttribute('#googleChip', 'href');
  const q = new URL(href).searchParams.get('q');
  if (!q.includes('декларація')) throw new Error(`query: ${q}`);
});

await shot('01-plain-input.png');

await step('search renders result cards', async () => {
  await page.click('#submitBtn');
  await page.waitForSelector('.doc-card', { timeout: 8000 });
  const cards = await page.locator('.doc-card').count();
  if (cards !== 2) throw new Error(`cards: ${cards}`);
});

await shot('02-plain-results.png');

await step('opening a document shows JSON', async () => {
  await page.locator('.doc-card').first().click();
  await page.waitForSelector('#docDialog[open]');
  await page.waitForFunction(() => document.getElementById('jsonView').textContent.includes('step_3'), null, {
    timeout: 8000,
  });
});

await shot('03-json.png');

await step('the all-fields tab splits the document into sections', async () => {
  await page.click('#tabFields');
  await page.waitForSelector('.section');
  const sections = await page.locator('.section').count();
  if (sections !== 3) throw new Error(`sections: ${sections} (expected 3, the empty step_6 must drop out)`);
  const first = await page.locator('.section > summary').first().textContent();
  if (!first.includes('Загальна інформація')) throw new Error(`first section: ${first}`);
});

await step('empty fields stay hidden until the switch is on', async () => {
  const before = await page.locator('.row').count();
  await page.check('#showEmpty');
  const after = await page.locator('.row').count();
  if (after <= before) throw new Error(`was ${before}, became ${after}`);
  await page.uncheck('#showEmpty');
});

await page.locator('.section').first().click();
await shot('04-fields.png');
await page.click('#docCloseBtn');

await step('the button switches the UI into paw mode', async () => {
  await page.click('#pawBtn');
  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'paw') throw new Error(`theme: ${theme}`);
  const label = await page.textContent('.primary-btn__label');
  if (!label.includes('Гав')) throw new Error(`button: ${label}`);
});

await shot('05-paw.png', true);

await step('paw mode survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'paw') throw new Error(`after reload: ${theme}`);
});

await step('search history is kept', async () => {
  const chips = await page.locator('#recentList .chip').count();
  if (chips < 1) throw new Error('history is empty');
});

await step('switching back to the plain look', async () => {
  await page.click('#pawBtn');
  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'plain') throw new Error(`theme: ${theme}`);
});

await step('malformed input yields a precise error', async () => {
  await page.fill('#pib', 'Іван');
  await page.click('#submitBtn');
  await page.waitForSelector('.status--error');
  const text = await page.textContent('#status');
  if (!text.includes('прізвище')) throw new Error(`message: ${text}`);
});

// Network failure: the UI must explain it and still offer Google.
await page.unroute('**/public-api.nazk.gov.ua/**');
await page.route('**/public-api.nazk.gov.ua/**', (route) => route.abort('failed'));

await step('a network failure is explained and offers Google', async () => {
  await page.fill('#pib', 'Іваненко Іван Іванович');
  await page.click('#submitBtn');
  await page.waitForSelector('.status--error', { timeout: 8000 });
  const text = await page.textContent('#status');
  if (!text.includes('CORS')) throw new Error(`message: ${text}`);
  if (!text.includes('Загуглити')) throw new Error('no Google fallback');
});

await shot('06-network-error.png');

// Empty result set.
await page.unroute('**/public-api.nazk.gov.ua/**');
await page.route('**/public-api.nazk.gov.ua/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
);

await step('an empty result set offers Google', async () => {
  await page.click('#submitBtn');
  await page.waitForSelector('.status--empty', { timeout: 8000 });
  const text = await page.textContent('#status');
  if (!text.includes('нічого не знайдено')) throw new Error(text);
});

// Cloudflare 403 — exactly what the phone received in the wild.
const CF_403 =
  '<html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center>' +
  "<hr><center>nginx</center><script>window.__CF$cv$params={r:'a250eba08facbabc'};</script></body></html>";

await page.unroute('**/public-api.nazk.gov.ua/**');
await page.route('**/public-api.nazk.gov.ua/**', (route) =>
  route.fulfill({ status: 403, contentType: 'text/html', body: CF_403 })
);

await step('a Cloudflare 403 is explained instead of dumping HTML', async () => {
  await page.fill('#pib', 'Хміль Владислав Богданович');
  await page.click('#submitBtn');
  await page.waitForSelector('.status--error', { timeout: 8000 });
  const text = await page.textContent('#status');
  if (!text.includes('Cloudflare')) throw new Error(`message: ${text}`);
  if (text.includes('<html') || text.includes('nginx')) throw new Error('markup leaks into the UI');
  if (!text.includes('Загуглити')) throw new Error('no Google fallback');
});

await shot('07-cloudflare-403.png');

// Own backend: the direct route keeps returning 403, the backend returns JSON.
await page.route('**/my-backend.test/api/registry**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIST) })
);

await step('a configured backend gets around the block', async () => {
  await page.click('#settingsBtn');
  await page.fill('#backendBase', 'https://my-backend.test/api/registry');
  await page.click('#settingsSaveBtn');
  await page.click('#submitBtn');
  await page.waitForSelector('.doc-card', { timeout: 8000 });
  const cards = await page.locator('.doc-card').count();
  if (cards !== 2) throw new Error(`cards: ${cards}`);
});

await step('diagnostics report which route works', async () => {
  await page.click('#settingsBtn');
  await page.click('#diagnoseBtn');
  await page.waitForSelector('.diagnostics__line--ok', { timeout: 12000 });
  const ok = await page.textContent('.diagnostics__line--ok');
  if (!ok.includes('бекенд')) throw new Error(`working route: ${ok}`);
  await page.waitForSelector('.diagnostics__line--fail', { timeout: 12000 });
  const fail = await page.textContent('.diagnostics__line--fail');
  if (!fail.includes('напряму')) throw new Error(`expected the direct route to fail, got: ${fail}`);
});

await shot('08-diagnostics.png');

await browser.close();

console.log(errors.length ? `\nPROBLEMS (${errors.length}):\n` + errors.join('\n') : '\nAll clean.');
process.exit(errors.length ? 1 : 0);
