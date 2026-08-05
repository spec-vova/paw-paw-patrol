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
  latestReportingYear,
  DEFAULT_PROXY_TEMPLATE,
  assetChanges,
  backendLabel,
  buildBackendDeclarantUrl,
  buildDeclarantSearchUrl,
  buildProfile,
  isWorkersHost,
  parseBackends,
  registryError,
  looksLikeChallenge,
  migrateProxyTemplate,
  normalizeBackendBase,
  normalizePib,
  REGISTRY_HOST,
  summarizeDocument,
  titleCasePib,
  validatePib,
} from './lib/index.js';

const APP_VERSION = '1.0.0';
// Added to the Google query so the freshest filing ranks first. Not the
// calendar year: a declaration for 2026 will only be filed in 2027.
const SEARCH_YEAR = latestReportingYear();
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
  profileBtn: $('profileBtn'),
  profileDialog: $('profileDialog'),
  profileTitle: $('profileTitle'),
  profileSubtitle: $('profileSubtitle'),
  profileView: $('profileView'),
  profileCloseBtn: $('profileCloseBtn'),
  profileCopyBtn: $('profileCopyBtn'),
  profileDownloadBtn: $('profileDownloadBtn'),
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
  proxyTemplate: DEFAULT_PROXY_TEMPLATE,
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
  profile: null,
  profileDocs: [],
  summaries: [],
  demoMode: false,
  demo: null,
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
    els.googleChip.href = buildGoogleUrl(normalized, { year: SEARCH_YEAR });
    els.googleChipLabel.textContent = `Загуглити «${buildGoogleQuery(normalized, { year: SEARCH_YEAR })}»`;
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

/**
 * Demo mode: answers requests from a bundled sample instead of the network.
 *
 * The registry is behind Cloudflare and refuses server traffic for hours at a
 * time, which leaves no way to look at the app at all. With ?demo=1 every
 * screen is reachable offline, and the sample is three years of one person so
 * the consolidated view has something to consolidate.
 */
async function demoAnswer(url) {
  if (!state.demo) {
    const response = await fetch('./demo/declarations.json');
    state.demo = await response.json();
  }

  const query = new URL(url, location.href).searchParams;
  const path = query.get('path') || new URL(url, location.href).pathname;

  const single = /documents\/(?!list)([^/?]+)/.exec(path);
  if (single) {
    const found = state.demo.find((doc) => doc.id === decodeURIComponent(single[1]));
    return found || { error: 1310002 };
  }

  // The sample is one person, so any name matches; an obviously different
  // surname returns nothing, which keeps the empty state reachable too.
  const wanted = (query.get('query') || '').toLocaleLowerCase('uk');
  const matches =
    !wanted || state.demo.some((doc) => JSON.stringify(doc.data.step_1.data).toLocaleLowerCase('uk').includes(wanted.split(' ')[0]));

  return { total: matches ? state.demo.length : 0, items: matches ? state.demo : [] };
}

async function fetchOnce(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (state.demoMode) return demoAnswer(url);

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

  // The registry answers with HTTP 200 and {"error": <code>}; without this it
  // would render as a document whose only field is called "error".
  const failure = registryError(parsed);
  if (failure) {
    throw new ApiError(failure.message, { kind: 'registry', url, status: failure.code });
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

  // One route per configured backend: the upstream block comes and goes, so
  // whichever answers today wins without the user editing settings.
  for (const backend of parseBackends(backendBase).value) {
    routes.push({
      id: `backend:${backend}`,
      label: backendLabel(backend),
      url:
        kind === 'list'
          ? buildBackendSearchUrl(backend, params.pib, { page: params.page })
          : buildBackendDocumentUrl(backend, params.id),
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
  state.summaries = [];
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
    state.summaries = append ? [...state.summaries, ...summaries] : summaries;
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
  // The list endpoint carries no declarant name; a dash reads as breakage, so
  // fall back to the document type. The real name appears once it is opened.
  name.textContent = summary.pib === '—' ? summary.type || 'Декларація' : summary.pib;
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
  googleLink.href = buildGoogleUrl(state.query, { year: SEARCH_YEAR });
  googleLink.textContent = `Загуглити «${buildGoogleQuery(state.query, { year: SEARCH_YEAR })}»`;

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
        `Спроби посередника: ${(error.tried || []).map((t) => `${t.profile} → ${t.status}`).join(', ') || '—'}.`
      );
      lines.push(
        'Блокування то зникає, то повертається, і залежить від майданчика. Додайте в налаштуваннях другу адресу бекенда з іншого хостингу — застосунок сам візьме той, що відповідає.'
      );
      // Only when every configured backend is on the same platform — with two
      // of them the hint would be plainly wrong, as the settings screen shows.
      const backends = parseBackends(state.settings.backendBase).value;
      if (backends.length && backends.every(isWorkersHost)) {
        lines.push('Усі налаштовані бекенди — на Cloudflare Workers; варто дописати ще й адресу на іншому хостингу.');
      }
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
    googleLink.href = buildGoogleUrl(state.query, { year: SEARCH_YEAR });
    googleLink.textContent = `Загуглити «${buildGoogleQuery(state.query, { year: SEARCH_YEAR })}»`;
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

  // The list endpoint does not carry the declarant's name, but the document
  // does — so fill in the heading once the full document has arrived.
  const fromDoc = summarizeDocument(doc);
  if (fromDoc.pib !== '—') {
    els.docTitle.textContent = fromDoc.pib;
    state.currentSummary = { ...state.currentSummary, pib: fromDoc.pib };
  }

  const parts = [];
  const year = state.currentSummary?.year ?? fromDoc.year;
  if (year) parts.push(`за ${year} рік`);
  if (fromDoc.type) parts.push(fromDoc.type.toLowerCase());
  if (fromDoc.position) parts.push(fromDoc.position);

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

// ────────────────────── consolidated profile ───────────────────

const PROFILE_DOC_LIMIT = 12;

/** Routes for "every declaration of this declarant", by registry id. */
function declarantRoutes(declarantId) {
  const { backendBase, apiBase, proxyEnabled, proxyTemplate } = state.settings;
  const routes = parseBackends(backendBase).value.map((backend) => ({
    id: `backend:${backend}`,
    label: backendLabel(backend),
    url: buildBackendDeclarantUrl(backend, declarantId),
  }));

  const direct = buildDeclarantSearchUrl(declarantId, { base: apiBase });
  routes.push({ id: 'direct', label: 'напряму до реєстру', url: direct });
  if (proxyEnabled) routes.push({ id: 'proxy', label: 'через проксі', url: applyProxy(direct, proxyTemplate) });
  return routes;
}

/**
 * Collects every declaration of the person and shows what changed between them.
 * Grouping is by user_declarant_id when the registry supplies it, so namesakes
 * are not merged; otherwise it falls back to the documents already listed.
 */
async function openProfile() {
  const listed = [...els.resultsList.children].length;
  if (!listed) return;

  state.profile = null;
  state.profileDocs = [];
  els.profileTitle.textContent = titleCasePib(state.query);
  els.profileSubtitle.textContent = 'Збираю декларації…';
  els.profileView.replaceChildren();
  if (!els.profileDialog.open) els.profileDialog.showModal();

  try {
    const declarantId = state.summaries.find((summary) => summary.declarantId)?.declarantId ?? null;
    let summaries = state.summaries;

    if (declarantId) {
      const payload = await fetchViaRoutes(declarantRoutes(declarantId));
      const byDeclarant = extractList(payload).items.map(summarizeDocument);
      if (byDeclarant.length) summaries = byDeclarant;
    }

    const wanted = summaries.filter((summary) => summary.id).slice(0, PROFILE_DOC_LIMIT);
    const documents = [];
    for (const [index, summary] of wanted.entries()) {
      els.profileSubtitle.textContent = `Завантажую документ ${index + 1} з ${wanted.length}…`;
      try {
        documents.push(await fetchViaRoutes(buildRoutes('document', { id: summary.id })));
      } catch {
        // One unreadable document must not sink the whole summary.
      }
    }

    if (!documents.length) {
      els.profileSubtitle.textContent = 'Не вдалося завантажити жодного документа.';
      return;
    }

    state.profileDocs = documents;
    state.profile = buildProfile(documents);
    renderProfile(state.profile, summaries.length);
  } catch (error) {
    els.profileSubtitle.textContent = error.message;
  }
}

function renderProfile(profile, foundCount) {
  els.profileTitle.textContent = profile.pib || titleCasePib(state.query);

  const parts = [`${profile.documents} з ${foundCount} декларацій`];
  if (profile.years.length) parts.push(`${profile.years[profile.years.length - 1]}–${profile.years[0]}`);
  if (profile.missingYears.length) parts.push(`без декларації: ${profile.missingYears.join(', ')}`);
  els.profileSubtitle.textContent = parts.join(' · ');

  const blocks = [];

  const income = profile.income.filter((year) => year.year);
  if (income.length) {
    blocks.push(
      profileBlock(
        'Доходи за роками',
        income.map((year) =>
          profileRow(
            String(year.year),
            year.total === null ? 'не вказано' : year.total.toLocaleString('uk-UA', { maximumFractionDigits: 0 }),
            year.withheld ? plural(year.withheld, 'позицію', 'позиції', 'позицій') + ' приховано' : describeIncome(year.items)
          )
        )
      )
    );
  }

  const changes = assetChanges(profile);
  if (changes.length) {
    blocks.push(
      profileBlock(
        'Що змінилося',
        changes.map((change) => {
          const row = profileRow(change.title, change.span || String(change.year), `${change.kind} · ${change.event}`);
          row.classList.add('profile__change');
          if (change.event === 'зникло') row.classList.add('profile__change--gone');
          return row;
        })
      )
    );
  }

  for (const [title, items] of [
    ['Посади', null],
    ['Нерухомість', profile.property],
    ['Транспорт', profile.vehicles],
    ['Банки та фінансові установи', profile.banks],
    ['Родина', profile.family],
  ]) {
    if (title === 'Посади') {
      const rows = profile.positions.map((entry) =>
        profileRow(entry.post || '—', String(entry.year ?? ''), entry.place)
      );
      if (rows.length) blocks.push(profileBlock(title, rows));
      continue;
    }
    if (!items?.length) continue;
    blocks.push(
      profileBlock(
        title,
        items.map((item) => profileRow(item.title, formatYears(item.years), detailOf(item)))
      )
    );
  }

  els.profileView.replaceChildren(...blocks);
}

/** Ukrainian plural agreement: 1 позицію, 2 позиції, 5 позицій. */
function plural(count, one, few, many) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function describeIncome(items) {
  const named = items.map((item) => item.type).filter(Boolean);
  return named.length ? [...new Set(named)].join(', ') : null;
}

function detailOf(item) {
  return [item.detail, item.rights?.length ? item.rights.join(', ') : null].filter(Boolean).join(' · ') || null;
}

function formatYears(years) {
  if (!years.length) return '';
  if (years.length === 1) return String(years[0]);
  const consecutive = years[0] - years[years.length - 1] === years.length - 1;
  return consecutive ? `${years[years.length - 1]}–${years[0]}` : years.join(', ');
}

function profileBlock(title, rows) {
  const block = document.createElement('section');
  block.className = 'profile__block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  block.append(heading, ...rows);
  return block;
}

function profileRow(title, years, meta) {
  const row = document.createElement('div');
  row.className = 'profile__row';

  const left = document.createElement('div');
  const strong = document.createElement('b');
  strong.textContent = title;
  left.append(strong);
  if (meta) {
    const note = document.createElement('span');
    note.className = 'profile__meta';
    note.textContent = meta;
    left.append(note);
  }

  const right = document.createElement('span');
  right.className = 'profile__years';
  right.textContent = years;

  row.append(left, right);
  return row;
}

/** Plain-text rendering, so the summary can leave the app in a message. */
function profileAsText(profile) {
  const lines = [profile.pib || state.query, ''];
  if (profile.years.length) lines.push(`Декларації: ${profile.years.join(', ')}`);
  if (profile.missingYears.length) lines.push(`Немає за: ${profile.missingYears.join(', ')}`);

  const section = (title, rows) => {
    if (!rows.length) return;
    lines.push('', title);
    for (const row of rows) lines.push(`  ${row}`);
  };

  section(
    'Доходи',
    profile.income
      .filter((year) => year.year)
      .map((year) => `${year.year}: ${year.total === null ? 'не вказано' : year.total}`)
  );
  section(
    'Що змінилося',
    assetChanges(profile).map((change) => `${change.year} ${change.event}: ${change.title} (${change.kind})`)
  );
  section('Посади', profile.positions.map((entry) => `${entry.year ?? '—'}: ${entry.post || '—'} — ${entry.place || '—'}`));
  section('Нерухомість', profile.property.map((item) => `${formatYears(item.years)} ${item.title} ${item.detail || ''}`));
  section('Транспорт', profile.vehicles.map((item) => `${formatYears(item.years)} ${item.title}`));
  section('Родина', profile.family.map((item) => `${item.title} — ${item.detail || ''}`));

  return lines.join('\n');
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
  const backends = parseBackends(els.backendBase.value, { pageProtocol: location.protocol });
  const backendValue = backends.value.join('\n');
  if (backends.warnings.length) {
    els.backendBase.value = backendValue;
    toast(backends.warnings[0]);
  }

  state.settings = {
    apiBase: els.apiBase.value.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.apiBase,
    backendBase: backendValue,
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

els.profileBtn.addEventListener('click', openProfile);
els.profileCloseBtn.addEventListener('click', () => els.profileDialog.close());
els.profileCopyBtn.addEventListener('click', async () => {
  if (!state.profile) return;
  try {
    await navigator.clipboard.writeText(profileAsText(state.profile));
    toast('Зведення скопійовано');
  } catch {
    toast('Браузер не дозволив копіювання');
  }
});
els.profileDownloadBtn.addEventListener('click', () => {
  if (!state.profile) return;
  const blob = new Blob([JSON.stringify(state.profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.profile.pib || 'profile').replace(/[^\p{L}\d]+/gu, '-').toLowerCase()}-зведення.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
for (const dialog of [els.docDialog, els.settingsDialog, els.profileDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ───────────────────────────── start ───────────────────────────

function init() {
  state.settings = { ...DEFAULT_SETTINGS, ...readStore(STORAGE.settings, {}) };
  // A previously saved address may still carry http:// or a glued-on scheme.
  state.settings.backendBase = parseBackends(state.settings.backendBase, {
    pageProtocol: location.protocol,
  }).value.join('\n');
  // A stored proxy may point at a service that has since closed its free tier.
  state.settings.proxyTemplate = migrateProxyTemplate(state.settings.proxyTemplate);
  writeStore(STORAGE.settings, state.settings);
  applyTheme(readStore(STORAGE.theme, 'plain'));
  renderRecent();
  onInput();

  const params = new URLSearchParams(location.search);

  // ?demo=1 runs the whole app on a bundled sample, with no network at all.
  state.demoMode = params.get('demo') === '1';
  if (state.demoMode) {
    document.body.classList.add('is-demo');
    els.subtitle.textContent = 'Демонстраційний режим — приклад, не реальні дані';
    els.pib.value = 'Тестенко Тест Тестович';
    onInput();
    startSearch();
  }

  // Allows opening the app with a name prefilled: ?pib=Іваненко Іван
  const fromUrl = params.get('pib');
  if (fromUrl && !state.demoMode) {
    els.pib.value = fromUrl;
    onInput();
    startSearch();
  }

  // Tells the inline recovery script that the module is alive.
  window.__appBooted = true;
  window.dispatchEvent(new Event('app-booted'));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* the offline cache is optional */
      });
    });
  }
}

init();
