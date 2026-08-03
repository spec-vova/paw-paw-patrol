/**
 * Wires the UI to the declarations registry.
 *
 * All pure logic (name normalisation, URL building, response parsing) lives in
 * src/lib/ and is covered by tests; this file is DOM, network and state only.
 *
 * User-facing strings stay in Ukrainian — that is the language of the UI.
 */

import {
  API_BASE,
  applyProxy,
  buildBackendDocumentUrl,
  buildBackendSearchUrl,
  buildDocumentUrl,
  buildGoogleQuery,
  buildGoogleUrl,
  buildRegistryLink,
  buildSearchUrl,
  countFields,
  extractList,
  flattenDocument,
  looksLikeChallenge,
  normalizeBackendBase,
  normalizePib,
  REGISTRY_HOST,
  summarizeDocument,
  titleCasePib,
  validatePib,
} from './lib/index.js';

const APP_VERSION = '1.0.0';
const REQUEST_TIMEOUT_MS = 20000;
const RECENT_LIMIT = 8;

const STORAGE = {
  theme: 'pp.theme',
  recent: 'pp.recent',
  settings: 'pp.settings',
};

const $ = (id) => document.getElementById(id);

const els = {
  form: $('searchForm'),
  pib: $('pib'),
  clearBtn: $('clearBtn'),
  preview: $('preview'),
  submitBtn: $('submitBtn'),
  chips: $('actionChips'),
  googleChip: $('googleChip'),
  googleChipLabel: $('googleChipLabel'),
  registryChip: $('registryChip'),
  pawBtn: $('pawBtn'),
  pawBtnTitle: $('pawBtnTitle'),
  pawBtnSub: $('pawBtnSub'),
  subtitle: $('subtitle'),
  recentSection: $('recentSection'),
  recentList: $('recentList'),
  clearRecentBtn: $('clearRecentBtn'),
  status: $('status'),
  results: $('results'),
  resultsList: $('resultsList'),
  resultsCount: $('resultsCount'),
  moreBtn: $('moreBtn'),
  docDialog: $('docDialog'),
  docTitle: $('docTitle'),
  docSubtitle: $('docSubtitle'),
  docCloseBtn: $('docCloseBtn'),
  tabJson: $('tabJson'),
  tabFields: $('tabFields'),
  paneJson: $('paneJson'),
  paneFields: $('paneFields'),
  jsonView: $('jsonView'),
  fieldsView: $('fieldsView'),
  showEmpty: $('showEmpty'),
  copyBtn: $('copyBtn'),
  shareBtn: $('shareBtn'),
  downloadBtn: $('downloadBtn'),
  openRegistryBtn: $('openRegistryBtn'),
  settingsBtn: $('settingsBtn'),
  settingsDialog: $('settingsDialog'),
  settingsCloseBtn: $('settingsCloseBtn'),
  apiBase: $('apiBase'),
  backendBase: $('backendBase'),
  diagnoseBtn: $('diagnoseBtn'),
  diagnostics: $('diagnostics'),
  proxyEnabled: $('proxyEnabled'),
  proxyTemplate: $('proxyTemplate'),
  settingsSaveBtn: $('settingsSaveBtn'),
  settingsResetBtn: $('settingsResetBtn'),
  versionLine: $('versionLine'),
  toast: $('toast'),
};

const DEFAULT_SETTINGS = {
  apiBase: API_BASE,
  // Own backend address (api/registry.js or workers/registry.worker.js).
  // Empty means requests go to the registry directly.
  backendBase: '',
  proxyEnabled: false,
  // corsproxy.io now requires an API key outside localhost, so it is a poor default.
  proxyTemplate: 'https://api.allorigins.win/raw?url={url}',
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  query: '',
  page: 1,
  exhausted: false,
  loading: false,
  currentDoc: null,
  currentSummary: null,
  lastRoute: null,
};

// ──────────────────────────── storage ──────────────────────────

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage — not critical */
  }
}

// ───────────────────────────── theme ───────────────────────────

/** Switches the skin: 'plain' is the default one, 'paw' is the playful one. */
function applyTheme(theme, { animate = false } = {}) {
  const paw = theme === 'paw';
  document.documentElement.dataset.theme = paw ? 'paw' : 'plain';
  els.pawBtn.setAttribute('aria-pressed', String(paw));
  els.pawBtnTitle.textContent = paw ? 'Щенячий патруль увімкнено' : 'Щенячий патруль';
  els.pawBtnSub.textContent = paw ? 'Натисніть, щоб повернути звичайний вигляд' : 'Увімкнути грайливий вигляд';
  els.subtitle.textContent = paw ? 'Патруль на чолі! Шукаємо декларації' : 'Єдиний державний реєстр декларацій';
  els.submitBtn.querySelector('.primary-btn__label').textContent = paw ? 'Гав! Шукати' : 'Знайти декларації';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paw ? '#eaf4ff' : '#0b1220');

  if (animate) {
    els.pawBtn.classList.add('is-switching');
    setTimeout(() => els.pawBtn.classList.remove('is-switching'), 520);
  }
  writeStore(STORAGE.theme, theme);
}

// ─────────────────────────── recent list ───────────────────────

function getRecent() {
  const list = readStore(STORAGE.recent, []);
  return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
}

function pushRecent(pib) {
  const list = getRecent().filter((item) => item.toLowerCase() !== pib.toLowerCase());
  list.unshift(pib);
  writeStore(STORAGE.recent, list.slice(0, RECENT_LIMIT));
  renderRecent();
}

function renderRecent() {
  const list = getRecent();
  els.recentSection.hidden = list.length === 0;
  els.recentList.replaceChildren(
    ...list.map((pib) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = pib;
      chip.addEventListener('click', () => {
        els.pib.value = pib;
        onInput();
        startSearch();
      });
      return chip;
    })
  );
}

// ───────────────────────── name input ──────────────────────────

function onInput() {
  const raw = els.pib.value;
  const normalized = normalizePib(raw);
  els.clearBtn.hidden = raw.length === 0;

  // Show how multi-line input collapsed into a single line.
  const multiline = /\n/.test(raw.trim());
  if (normalized && multiline) {
    els.preview.hidden = false;
    els.preview.replaceChildren(document.createTextNode('Запит: '), boldNode(normalized));
  } else {
    els.preview.hidden = true;
  }

  if (normalized) {
    els.chips.hidden = false;
    els.googleChip.href = buildGoogleUrl(normalized);
    els.googleChipLabel.textContent = `Загуглити «${buildGoogleQuery(normalized)}»`;
    els.registryChip.href = buildGoogleUrl(normalized, { site: REGISTRY_HOST });
  } else {
    els.chips.hidden = true;
  }
}

function boldNode(text) {
  const strong = document.createElement('strong');
  strong.textContent = text;
  return strong;
}

// ──────────────────────────── network ──────────────────────────

class ApiError extends Error {
  constructor(message, { kind, url, status, body, fromBackend, tried } = {}) {
    super(message);
    this.kind = kind;
    this.url = url;
    this.status = status;
    this.body = body;
    // Set when our own backend reported the failure rather than the browser
    // hitting it: the advice to give the user is different.
    this.fromBackend = fromBackend;
    this.tried = tried;
  }
}

async function fetchOnce(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new ApiError('Сервер не відповів вчасно.', { kind: 'timeout', url });
    }
    // fetch throws TypeError both on CORS and on a dead network, and the page
    // cannot tell them apart — so the message covers both cases.
    throw new ApiError('Не вдалося зʼєднатися.', { kind: 'network', url });
  }
  clearTimeout(timer);

  const text = await response.text();

  if (!response.ok) {
    // The own backend reports the reason as machine-readable JSON.
    const parsed = safeParse(text);
    if (parsed?.error) {
      throw new ApiError(parsed.error, {
        kind: parsed.challenge ? 'challenge' : 'http',
        url,
        status: response.status,
        fromBackend: true,
        tried: parsed.tried,
      });
    }
    throw new ApiError(`Сервер відповів помилкою ${response.status}.`, {
      kind: looksLikeChallenge(text) ? 'challenge' : 'http',
      url,
      status: response.status,
      body: looksLikeChallenge(text) ? null : text.slice(0, 300),
    });
  }

  if (looksLikeChallenge(text)) {
    throw new ApiError('Замість даних повернулась сторінка-заглушка.', { kind: 'challenge', url });
  }

  const parsed = safeParse(text);
  if (parsed === undefined) {
    throw new ApiError('Відповідь не є коректним JSON.', { kind: 'parse', url, body: text.slice(0, 300) });
  }
  return parsed;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Request routes in attempt order: own backend → direct → CORS proxy.
 * The registry sits behind Cloudflare, so a direct browser request often
 * returns 403; the first route that works is remembered and tried first.
 */
function buildRoutes(kind, params) {
  const { backendBase, apiBase, proxyEnabled, proxyTemplate } = state.settings;
  const routes = [];

  if (backendBase) {
    routes.push({
      id: 'backend',
      label: 'власний бекенд',
      url:
        kind === 'list'
          ? buildBackendSearchUrl(backendBase, params.pib, { page: params.page })
          : buildBackendDocumentUrl(backendBase, params.id),
    });
  }

  const directUrl =
    kind === 'list'
      ? buildSearchUrl(params.pib, { page: params.page, base: apiBase })
      : buildDocumentUrl(params.id, { base: apiBase });
  routes.push({ id: 'direct', label: 'напряму до реєстру', url: directUrl });

  if (proxyEnabled) {
    routes.push({ id: 'proxy', label: 'через проксі', url: applyProxy(directUrl, proxyTemplate) });
  }

  // Try the route that worked last time before the others.
  routes.sort((a, b) => (a.id === state.lastRoute ? -1 : b.id === state.lastRoute ? 1 : 0));
  return routes;
}

/** Tries routes one by one; throws the last error if none succeeded. */
async function fetchViaRoutes(routes) {
  const failures = [];
  for (const route of routes) {
    try {
      const payload = await fetchOnce(route.url, routes.length > 1 ? 12000 : REQUEST_TIMEOUT_MS);
      state.lastRoute = route.id;
      return payload;
    } catch (error) {
      error.routeLabel = route.label;
      failures.push(error);
    }
  }
  // Report the most informative failure, not simply the last one: an error our
  // own backend explained beats the browser's generic "could not connect".
  const best = failures.find((error) => error.fromBackend) || failures[failures.length - 1];
  best.attempts = failures.map((error) => `${error.routeLabel}: ${error.message}`);
  throw best;
}

// ──────────────────────────── search ───────────────────────────

function startSearch() {
  const check = validatePib(els.pib.value);
  if (!check.ok) {
    showStatus('error', [check.error]);
    els.results.hidden = true;
    return;
  }
  state.query = check.value;
  state.page = 1;
  state.exhausted = false;
  els.resultsList.replaceChildren();
  els.results.hidden = true;
  pushRecent(titleCasePib(check.value));
  loadPage();
}

async function loadPage() {
  if (state.loading) return;
  setLoading(true);
  const append = state.page > 1;
  if (!append) showStatus('info', ['Шукаю в реєстрі…']);

  try {
    const payload = await fetchViaRoutes(buildRoutes('list', { pib: state.query, page: state.page }));
    const { items, total } = extractList(payload);
    const summaries = items.map(summarizeDocument);

    if (!append && summaries.length === 0) {
      showEmptyResult(payload);
      return;
    }

    hideStatus();
    els.results.hidden = false;
    els.resultsList.append(...summaries.map(renderCard));
    els.resultsCount.textContent = total !== null ? `${total} всього` : `${els.resultsList.childElementCount} показано`;

    // Hide "show more" once a page comes back empty or everything is shown.
    const shown = els.resultsList.childElementCount;
    state.exhausted = summaries.length === 0 || (total !== null && shown >= total);
    els.moreBtn.hidden = state.exhausted;
  } catch (error) {
    showError(error);
  } finally {
    setLoading(false);
  }
}

function setLoading(value) {
  state.loading = value;
  els.submitBtn.disabled = value;
  els.submitBtn.classList.toggle('is-busy', value);
  els.moreBtn.disabled = value;
}

function renderCard(summary) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'doc-card';

  const name = document.createElement('div');
  name.className = 'doc-card__name';
  name.textContent = summary.pib;
  card.append(name);

  for (const value of [summary.position, summary.agency]) {
    if (!value) continue;
    const p = document.createElement('p');
    p.className = 'doc-card__meta';
    p.textContent = value;
    card.append(p);
  }

  const tags = document.createElement('div');
  tags.className = 'doc-card__tags';
  if (summary.year) tags.append(tagNode(`за ${summary.year} рік`, 'tag--year'));
  if (summary.type) tags.append(tagNode(summary.type));
  if (summary.date) tags.append(tagNode(summary.date));
  if (summary.corrected) tags.append(tagNode('виправлена'));
  if (tags.childElementCount) card.append(tags);

  card.addEventListener('click', () => openDocument(summary));
  return card;
}

function tagNode(text, extra) {
  const span = document.createElement('span');
  span.className = extra ? `tag ${extra}` : 'tag';
  span.textContent = text;
  return span;
}

// ────────────────────── status messages ────────────────────────

function showStatus(kind, lines) {
  els.status.hidden = false;
  els.status.className = `status status--${kind}`;
  els.status.replaceChildren(
    ...lines.map((line) => {
      if (line instanceof Node) return line;
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    })
  );
  // The message may sit below the fold — bring it into view.
  if (kind !== 'info') {
    els.status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function hideStatus() {
  els.status.hidden = true;
}

function showEmptyResult(payload) {
  const googleLink = document.createElement('a');
  googleLink.className = 'chip';
  googleLink.target = '_blank';
  googleLink.rel = 'noopener noreferrer';
  googleLink.href = buildGoogleUrl(state.query);
  googleLink.textContent = `Загуглити «${buildGoogleQuery(state.query)}»`;

  const lines = [
    `У реєстрі нічого не знайдено за запитом «${state.query}».`,
    'Перевірте написання або спробуйте лише прізвище та імʼя.',
    googleLink,
  ];

  // Non-empty payload we failed to read as a list: show it raw.
  if (payload && typeof payload === 'object' && Object.keys(payload).length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Показати відповідь реєстру';
    const pre = document.createElement('pre');
    pre.className = 'json';
    pre.textContent = JSON.stringify(payload, null, 2).slice(0, 4000);
    details.append(summary, pre);
    lines.push(details);
  }

  showStatus('empty', lines);
  els.results.hidden = true;
}

function showError(error) {
  const lines = [error.message];

  if (error.kind === 'challenge' || (error.kind === 'http' && error.status === 403)) {
    if (error.fromBackend) {
      // The backend is alive and reached the registry — Cloudflare refused the
      // server too, so pointing at «deploy a backend» would be wrong advice.
      lines.push(
        'Посередник працює і дійшов до реєстру, але Cloudflare відхилив і серверний запит.',
        `Спроби посередника: ${(error.tried || []).map((t) => `${t.profile} → ${t.status}`).join(', ') || '—'}.`,
        'Наступний крок — розгорнути посередника у Cloudflare Workers: запит піде зсередини мережі Cloudflare. Інструкція в docs/deploy.md.'
      );
    } else {
      lines.push(
        'Реєстр стоїть за Cloudflare, і той відхиляє запити просто з браузера — до самого API вони не доходять.',
        'Лікується власним посередником: розгорніть api/registry.js на Vercel або workers/registry.worker.js у Cloudflare Workers і впишіть його адресу в налаштуваннях.'
      );
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'chip';
    open.textContent = 'Відкрити налаштування';
    open.addEventListener('click', openSettings);
    lines.push(open);
  }

  if (error.kind === 'network') {
    lines.push(
      'Причина зазвичай одна з двох: немає інтернету або реєстр не дозволяє запити з браузера (CORS).',
      'Якщо інтернет є — увімкніть проксі в налаштуваннях або скористайтесь пошуком Google нижче.'
    );
    const enable = document.createElement('button');
    enable.type = 'button';
    enable.className = 'chip';
    enable.textContent = state.settings.proxyEnabled ? 'Змінити проксі' : 'Увімкнути проксі й повторити';
    enable.addEventListener('click', () => {
      if (state.settings.proxyEnabled) {
        openSettings();
      } else {
        state.settings.proxyEnabled = true;
        writeStore(STORAGE.settings, state.settings);
        syncSettingsForm();
        loadPage();
      }
    });
    lines.push(enable);
  }

  if (error.kind === 'http' && error.status === 429) {
    lines.push('Реєстр обмежив частоту запитів — зачекайте хвилину й спробуйте ще раз.');
  }

  // The attempt list shows which route is still worth fixing.
  if (error.attempts?.length > 1) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Спроби (${error.attempts.length})`;
    details.append(summary);
    for (const attempt of error.attempts) {
      const p = document.createElement('p');
      p.textContent = attempt;
      details.append(p);
    }
    lines.push(details);
  }

  if (error.body) {
    const code = document.createElement('code');
    code.textContent = error.body;
    const wrap = document.createElement('p');
    wrap.append(code);
    lines.push(wrap);
  }

  if (state.query) {
    const googleLink = document.createElement('a');
    googleLink.className = 'chip';
    googleLink.target = '_blank';
    googleLink.rel = 'noopener noreferrer';
    googleLink.href = buildGoogleUrl(state.query);
    googleLink.textContent = `Загуглити «${buildGoogleQuery(state.query)}»`;
    lines.push(googleLink);
  }

  showStatus('error', lines);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

// ─────────────────────────── document ──────────────────────────

async function openDocument(summary) {
  state.currentSummary = summary;
  state.currentDoc = null;
  els.docTitle.textContent = summary.pib === '—' ? 'Декларація' : summary.pib;
  els.docSubtitle.textContent = 'Завантажую повний документ…';
  els.jsonView.textContent = '';
  els.fieldsView.replaceChildren();
  els.openRegistryBtn.href = summary.id ? buildRegistryLink(summary.id) : buildGoogleUrl(summary.pib);
  showTab('json');
  if (!els.docDialog.open) els.docDialog.showModal();

  // Without an id there is nothing to fetch — show what the list gave us.
  if (!summary.id) {
    state.currentDoc = summary.raw;
    renderDocument(summary.raw);
    els.docSubtitle.textContent = 'Дані зі списку (ідентифікатор документа відсутній)';
    return;
  }

  try {
    const doc = await fetchViaRoutes(buildRoutes('document', { id: summary.id }));
    state.currentDoc = doc;
    renderDocument(doc);
  } catch (error) {
    // The full document failed to load — do not leave the sheet blank.
    state.currentDoc = summary.raw;
    renderDocument(summary.raw);
    els.docSubtitle.textContent = `${error.message} Показано дані зі списку.`;
  }
}

function renderDocument(doc) {
  const json = JSON.stringify(doc, null, 2);
  els.jsonView.innerHTML = highlightJson(json);

  const sections = flattenDocument(doc);
  renderFields(sections);

  const parts = [];
  if (state.currentSummary?.year) parts.push(`за ${state.currentSummary.year} рік`);
  const fields = countFields(sections);
  if (fields) parts.push(`${fields} заповнених полів`);
  els.docSubtitle.textContent = parts.join(' · ') || 'Повний документ';
}

function renderFields(sections) {
  // The same switch reveals empty values and internal flags: both are noise
  // for a reader, and both matter when checking what the registry actually sent.
  const showEmpty = els.showEmpty.checked;
  if (!sections.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Структуровані розділи не розпізнані — дивіться вкладку JSON.';
    els.fieldsView.replaceChildren(p);
    return;
  }

  const nodes = [];
  for (const section of sections) {
    const visibleEntries = section.entries
      .map((entry) => ({
        ...entry,
        rows: entry.rows.filter((row) => showEmpty || (!row.empty && !row.technical)),
      }))
      .filter((entry) => entry.rows.length);
    if (!visibleEntries.length) continue;

    const details = document.createElement('details');
    details.className = 'section';
    details.open = nodes.length === 0; // перший розділ одразу розгорнутий
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = section.title;
    const count = document.createElement('span');
    count.className = 'section__count';
    count.textContent = String(visibleEntries.reduce((n, e) => n + e.rows.length, 0));
    summary.append(title, count);
    details.append(summary);

    for (const entry of visibleEntries) {
      const block = document.createElement('div');
      block.className = 'entry';
      if (visibleEntries.length > 1 || entry.title) {
        const h = document.createElement('p');
        h.className = 'entry__title';
        h.textContent = entry.title;
        block.append(h);
      }
      for (const row of entry.rows) {
        const line = document.createElement('div');
        line.className = row.empty ? 'row row--empty' : 'row';

        const label = document.createElement('div');
        label.className = 'row__label';
        label.textContent = row.label;
        if (row.label !== row.key) {
          const key = document.createElement('span');
          key.className = 'row__key';
          key.textContent = ` ${row.key}`;
          label.append(key);
        }

        const value = document.createElement('div');
        value.className = 'row__value';
        value.textContent = row.empty ? '—' : row.text;

        line.append(label, value);
        block.append(line);
      }
      details.append(block);
    }
    nodes.push(details);
  }

  els.fieldsView.replaceChildren(...nodes);
}

/** Highlights JSON: escape HTML first, then wrap tokens in spans. */
function highlightJson(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'n';
      if (match.startsWith('"')) cls = match.endsWith(':') ? 'k' : 's';
      else if (/true|false|null/.test(match)) cls = 'b';
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function showTab(which) {
  const json = which === 'json';
  els.tabJson.setAttribute('aria-selected', String(json));
  els.tabFields.setAttribute('aria-selected', String(!json));
  els.paneJson.hidden = !json;
  els.paneFields.hidden = json;
}

function currentJsonText() {
  return JSON.stringify(state.currentDoc ?? {}, null, 2);
}

function suggestedFileName() {
  const base = (state.currentSummary?.pib || 'declaration').replace(/[^\p{L}\d]+/gu, '-').toLowerCase();
  const year = state.currentSummary?.year ? `-${state.currentSummary.year}` : '';
  return `${base}${year}.json`;
}

// ─────────────────────────── settings ──────────────────────────

function syncSettingsForm() {
  els.apiBase.value = state.settings.apiBase;
  els.backendBase.value = state.settings.backendBase;
  els.proxyEnabled.checked = state.settings.proxyEnabled;
  els.proxyTemplate.value = state.settings.proxyTemplate;
}

/**
 * Probes every route separately and reports which one works.
 * Running this from the actual phone is the only reliable way to learn what
 * the local network and Cloudflare let through.
 */
async function runDiagnostics() {
  saveSettingsValues();
  const probe = 'Іваненко Іван';
  const routes = buildRoutes('list', { pib: probe, page: 1 });

  els.diagnostics.hidden = false;
  els.diagnoseBtn.disabled = true;
  els.diagnostics.replaceChildren(diagnosticLine('Перевіряю…', 'pending'));

  const results = [];
  for (const route of routes) {
    try {
      const payload = await fetchOnce(route.url, 12000);
      const { items } = extractList(payload);
      results.push(diagnosticLine(`${route.label} — працює (документів: ${items.length})`, 'ok'));
    } catch (error) {
      results.push(diagnosticLine(`${route.label} — ${error.message}`, 'fail'));
    }
    els.diagnostics.replaceChildren(...results);
  }

  if (!results.length) els.diagnostics.replaceChildren(diagnosticLine('Немає жодного маршруту.', 'fail'));
  els.diagnoseBtn.disabled = false;
}

function diagnosticLine(text, kind) {
  const p = document.createElement('p');
  p.className = `diagnostics__line diagnostics__line--${kind}`;
  p.textContent = text;
  return p;
}

function openSettings() {
  syncSettingsForm();
  els.versionLine.textContent = `Версія ${APP_VERSION}`;
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function saveSettingsValues() {
  const backend = normalizeBackendBase(els.backendBase.value, { pageProtocol: location.protocol });
  if (backend.warning) {
    els.backendBase.value = backend.value;
    toast(backend.warning);
  }

  state.settings = {
    apiBase: els.apiBase.value.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.apiBase,
    backendBase: backend.value,
    proxyEnabled: els.proxyEnabled.checked,
    proxyTemplate: els.proxyTemplate.value.trim() || DEFAULT_SETTINGS.proxyTemplate,
  };
  // Routes changed — forget which one used to work.
  state.lastRoute = null;
  writeStore(STORAGE.settings, state.settings);
}

function saveSettings() {
  saveSettingsValues();
  els.settingsDialog.close();
  toast('Збережено');
}

// ──────────────────────────── events ───────────────────────────

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  els.pib.blur();
  startSearch();
});

els.pib.addEventListener('input', onInput);

els.clearBtn.addEventListener('click', () => {
  els.pib.value = '';
  onInput();
  els.pib.focus();
});

els.moreBtn.addEventListener('click', () => {
  state.page += 1;
  loadPage();
});

els.pawBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'paw' ? 'plain' : 'paw';
  applyTheme(next, { animate: true });
});

els.clearRecentBtn.addEventListener('click', () => {
  writeStore(STORAGE.recent, []);
  renderRecent();
});

els.tabJson.addEventListener('click', () => showTab('json'));
els.tabFields.addEventListener('click', () => showTab('fields'));
els.showEmpty.addEventListener('change', () => renderFields(flattenDocument(state.currentDoc)));
els.docCloseBtn.addEventListener('click', () => els.docDialog.close());
els.settingsCloseBtn.addEventListener('click', () => els.settingsDialog.close());
els.settingsBtn.addEventListener('click', openSettings);
els.settingsSaveBtn.addEventListener('click', saveSettings);
els.diagnoseBtn.addEventListener('click', runDiagnostics);
els.settingsResetBtn.addEventListener('click', () => {
  state.settings = { ...DEFAULT_SETTINGS };
  writeStore(STORAGE.settings, state.settings);
  syncSettingsForm();
  toast('Скинуто до типових значень');
});

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentJsonText());
    toast('JSON скопійовано');
  } catch {
    toast('Браузер не дозволив копіювання');
  }
});

els.shareBtn.addEventListener('click', async () => {
  const link = state.currentSummary?.id ? buildRegistryLink(state.currentSummary.id) : els.openRegistryBtn.href;
  const payload = { title: state.currentSummary?.pib || 'Декларація', text: state.currentSummary?.pib, url: link };
  if (navigator.share) {
    try {
      await navigator.share(payload);
    } catch {
      /* user cancelled — stay quiet */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Посилання скопійовано');
  } catch {
    toast('Поділитися не вдалося');
  }
});

els.downloadBtn.addEventListener('click', () => {
  const blob = new Blob([currentJsonText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Clicking the backdrop closes the sheet.
for (const dialog of [els.docDialog, els.settingsDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ───────────────────────────── start ───────────────────────────

function init() {
  state.settings = { ...DEFAULT_SETTINGS, ...readStore(STORAGE.settings, {}) };
  // A previously saved address may still carry http:// — repair it on load.
  state.settings.backendBase = normalizeBackendBase(state.settings.backendBase, {
    pageProtocol: location.protocol,
  }).value;
  applyTheme(readStore(STORAGE.theme, 'plain'));
  renderRecent();
  onInput();

  // Allows opening the app with a name prefilled: ?pib=Іваненко Іван
  const fromUrl = new URLSearchParams(location.search).get('pib');
  if (fromUrl) {
    els.pib.value = fromUrl;
    onInput();
    startSearch();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* the offline cache is optional */
      });
    });
  }
}

init();
