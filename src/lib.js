/**
 * Чиста логіка застосунку: нормалізація ПІБ, побудова URL, розбір відповідей
 * реєстру та розкладання документа на поля.
 *
 * Модуль не торкається DOM і не робить мережевих запитів — його імпортують
 * і браузер (app.js), і тести (tests/lib.test.mjs).
 */

export const API_BASE = 'https://public-api.nazk.gov.ua/v2';

/** Слово, яке додається до ПІБ у пошуковому запиті Google. */
export const GOOGLE_KEYWORD = 'декларація';

/** Домен публічного реєстру — для пошуку Google у межах сайту. */
export const REGISTRY_HOST = 'public.nazk.gov.ua';

// ─────────────────────────────── ПІБ ────────────────────────────────

const APOSTROPHES = /[’`´ʼ‘'']/g;
const DASHES = /[‐‑‒–—―]/g;
// Кирилиця (укр./рос.) + латиниця, апостроф і дефіс усередині слова.
const NAME_TOKEN = /^[\p{L}][\p{L}'-]*$/u;

/**
 * Зводить введений рядок до канонічного вигляду: прибирає зайві пробіли,
 * коми та крапки, уніфікує апострофи й дефіси.
 * @param {string} input
 * @returns {string}
 */
export function normalizePib(input) {
  return String(input ?? '')
    .replace(APOSTROPHES, 'ʼ') // ʼ — рекомендований для української
    .replace(DASHES, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Перевіряє, чи схожий рядок на ПІБ (2–4 слова з літер).
 * @param {string} input
 * @returns {{ok: boolean, value: string, tokens: string[], error?: string}}
 */
export function validatePib(input) {
  const value = normalizePib(input);
  if (!value) {
    return { ok: false, value, tokens: [], error: 'Введіть прізвище, імʼя та по батькові.' };
  }
  const tokens = value.split(' ');
  // Кількість слів перевіряємо першою: для «Іван» це точніша підказка, ніж довжина.
  if (tokens.length < 2) {
    return { ok: false, value, tokens, error: 'Потрібно щонайменше прізвище та імʼя.' };
  }
  if (value.replace(/[\sʼ'-]/g, '').length < 5) {
    return { ok: false, value, tokens, error: 'Замало символів — введіть ПІБ повністю.' };
  }
  if (tokens.length > 4) {
    return { ok: false, value, tokens, error: 'Забагато слів — очікується прізвище, імʼя та по батькові.' };
  }
  const bad = tokens.find((t) => !NAME_TOKEN.test(t));
  if (bad) {
    return { ok: false, value, tokens, error: `«${bad}» не схоже на частину імені.` };
  }
  return { ok: true, value, tokens };
}

/** Приводить кожне слово до вигляду Іваненко (перша літера велика). */
export function titleCasePib(input) {
  return normalizePib(input)
    .split(' ')
    .map((token) =>
      token
        .split('-')
        .map((part) => (part ? part[0].toLocaleUpperCase('uk') + part.slice(1).toLocaleLowerCase('uk') : part))
        .join('-')
    )
    .join(' ');
}

// ────────────────────────────── Google ──────────────────────────────

/**
 * Складає пошуковий запит: ПІБ у лапках + слово «декларація».
 * @param {string} pib
 * @param {{site?: string}} [options] site — обмежити пошук доменом
 */
export function buildGoogleQuery(pib, options = {}) {
  const value = normalizePib(pib);
  const parts = [`"${value}"`, GOOGLE_KEYWORD];
  if (options.site) parts.push(`site:${options.site}`);
  return parts.join(' ');
}

/** Повний URL пошуку Google для заданого ПІБ. */
export function buildGoogleUrl(pib, options = {}) {
  return `https://www.google.com/search?q=${encodeURIComponent(buildGoogleQuery(pib, options))}`;
}

// ──────────────────────────── URL реєстру ───────────────────────────

/**
 * URL списку документів реєстру.
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

/** URL повного документа за його ідентифікатором. */
export function buildDocumentUrl(id, options = {}) {
  const { base = API_BASE } = options;
  return `${base}/documents/${encodeURIComponent(String(id))}`;
}

/** Посилання на картку документа у вебінтерфейсі реєстру. */
export function buildRegistryLink(id) {
  return `https://${REGISTRY_HOST}/documents/${encodeURIComponent(String(id))}`;
}

/**
 * Загортає URL у CORS-проксі за шаблоном із плейсхолдером {url}.
 * Якщо шаблон порожній — повертає URL без змін.
 */
export function applyProxy(url, template) {
  const tpl = String(template ?? '').trim();
  if (!tpl) return url;
  if (tpl.includes('{url}')) return tpl.replace('{url}', encodeURIComponent(url));
  return tpl.endsWith('=') || tpl.endsWith('?') || tpl.endsWith('/')
    ? tpl + encodeURIComponent(url)
    : `${tpl}${encodeURIComponent(url)}`;
}

// ───────────────────────── Розбір відповідей ────────────────────────

const LIST_KEYS = ['items', 'data', 'results', 'documents', 'docs', 'rows'];

/**
 * Витягує масив документів із відповіді списку.
 *
 * Форма відповіді реєстру різниться між версіями, тому перебираємо
 * найімовірніші контейнери, а не покладаємось на один ключ.
 * @param {any} payload
 * @returns {{items: any[], total: number|null, page: number|null, raw: any}}
 */
export function extractList(payload) {
  let items = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else if (payload && typeof payload === 'object') {
    for (const key of LIST_KEYS) {
      const candidate = payload[key];
      if (Array.isArray(candidate)) {
        items = candidate;
        break;
      }
      // Трапляється вкладення виду {data: {items: [...]}}.
      if (candidate && typeof candidate === 'object') {
        for (const inner of LIST_KEYS) {
          if (Array.isArray(candidate[inner])) {
            items = candidate[inner];
            break;
          }
        }
        if (items.length) break;
      }
    }
  }

  const meta = (payload && typeof payload === 'object' && (payload.meta || payload.pagination)) || payload || {};
  const total = firstNumber(meta.total, meta.count, meta.total_count, meta.totalCount, meta.records);
  const page = firstNumber(meta.page, meta.current_page, meta.currentPage);

  return { items, total, page, raw: payload };
}

function firstNumber(...values) {
  for (const v of values) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Зводить елемент списку до полів, потрібних для картки результату.
 * Усі ключі — «найімовірніші», бо схема відповіді не гарантована.
 */
export function summarizeDocument(item) {
  const src = item && typeof item === 'object' ? item : {};
  const data = src.data && typeof src.data === 'object' ? src.data : {};
  const step1 = data.step_1 && typeof data.step_1 === 'object' ? data.step_1 : {};

  const pib =
    firstString(
      src.pib,
      src.fullname,
      src.full_name,
      src.declarant_name,
      joinName(src.lastname, src.firstname, src.middlename),
      joinName(src.last_name, src.first_name, src.middle_name),
      joinName(step1.lastname, step1.firstname, step1.middlename)
    ) || '—';

  return {
    id: firstString(src.id, src.doc_uuid, src.document_id, src.uuid, src.declaration_id),
    pib,
    position: firstString(src.position, src.post, src.workPost, src.work_post, step1.workPost, step1.post),
    agency: firstString(src.placeOfWork, src.place_of_work, src.organization, src.department, step1.workPlace, step1.placeOfWork),
    year: firstNumber(src.declaration_year, src.declarationYear, src.year, src.period),
    type: firstString(src.declaration_type_name, src.type_name, src.declarationType, src.doc_type_name),
    typeId: firstNumber(src.declaration_type, src.doc_type, src.type),
    date: firstString(src.date, src.created_date, src.submitted_at, src.declaration_date, src.userDeclarantDate),
    corrected: Boolean(src.corrected ?? src.is_corrected),
    raw: src,
  };
}

function joinName(...parts) {
  const joined = parts.filter((p) => typeof p === 'string' && p.trim()).join(' ').trim();
  return joined || null;
}

// ──────────────────── Розкладання документа на поля ─────────────────

/** Назви розділів декларації (best-effort: схема різниться між роками). */
export const SECTION_TITLES = {
  step_0: 'Тип декларації та звітний період',
  step_1: 'Загальна інформація про субʼєкта декларування',
  step_2: 'Місце проживання',
  step_3: 'Обʼєкти нерухомості',
  step_4: 'Обʼєкти незавершеного будівництва',
  step_5: 'Цінне рухоме майно (крім транспортних засобів)',
  step_6: 'Транспортні засоби',
  step_7: 'Цінні папери',
  step_8: 'Корпоративні права',
  step_9: 'Юридичні особи, бенефіціарним власником яких є субʼєкт',
  step_10: 'Нематеріальні активи',
  step_11: 'Доходи, у тому числі подарунки',
  step_12: 'Грошові активи',
  step_13: 'Фінансові зобовʼязання',
  step_14: 'Видатки та правочини',
  step_15: 'Робота за сумісництвом',
  step_16: 'Членство в організаціях та їх органах',
};

/** Назви найпоширеніших полів. Невідомі ключі показуються як є. */
export const FIELD_LABELS = {
  lastname: 'Прізвище',
  firstname: 'Імʼя',
  middlename: 'По батькові',
  previous_lastname: 'Попереднє прізвище',
  changedName: 'Змінював(ла) ПІБ',
  birthday: 'Дата народження',
  citizenship: 'Громадянство',
  country: 'Країна',
  postCode: 'Поштовий індекс',
  cityType: 'Тип населеного пункту',
  streetType: 'Тип вулиці',
  street: 'Вулиця',
  houseNum: 'Будинок',
  apartmentsNum: 'Квартира',
  workPlace: 'Місце роботи',
  workPost: 'Посада',
  actual_workPlace: 'Фактичне місце роботи',
  actual_workPost: 'Фактична посада',
  responsiblePosition: 'Відповідальне становище',
  publicPerson: 'Публічна особа',
  eng_full_name: 'ПІБ (латиницею)',
  subjectRelation: 'Звʼязок із субʼєктом',
  person: 'Особа',
  personWhoCare: 'Особа, яка перебуває на утриманні',
  objectType: 'Тип обʼєкта',
  otherObjectType: 'Інший тип обʼєкта',
  owningDate: 'Дата набуття права',
  costDate: 'Вартість на дату набуття',
  costAssessment: 'Вартість за оцінкою',
  cost_date_assessment: 'Вартість на дату оцінки',
  totalArea: 'Загальна площа, м²',
  ua_cityType: 'Населений пункт',
  ua_street: 'Вулиця',
  ua_houseNum: 'Будинок',
  rights: 'Права на обʼєкт',
  ownershipType: 'Тип власності',
  percent_ownership: 'Частка власності, %',
  brand: 'Марка',
  model: 'Модель',
  graduationYear: 'Рік випуску',
  otherOwnership: 'Інша форма власності',
  emitent: 'Емітент',
  emitent_ua_company_name: 'Емітент (назва)',
  typeProperty: 'Вид майна',
  amount: 'Кількість',
  is_foreign: 'За кордоном',
  objectName: 'Назва обʼєкта',
  name: 'Назва',
  legalForm: 'Організаційно-правова форма',
  edrpou: 'Код ЄДРПОУ',
  organization_type: 'Тип організації',
  organization_name: 'Назва організації',
  objectTypeName: 'Вид доходу',
  source_citizen: 'Джерело (тип)',
  source_ua_company_name: 'Джерело (назва)',
  source_ua_company_code: 'Джерело (код ЄДРПОУ)',
  sizeIncome: 'Розмір доходу',
  incomeSource: 'Джерело доходу',
  assetsCurrency: 'Валюта',
  sizeAssets: 'Розмір активу',
  otherObjectType_encr: 'Інший тип (уточнення)',
  sizeObligation: 'Розмір зобовʼязання',
  dateOrigin: 'Дата виникнення',
  guarantee: 'Забезпечення',
  specExpenses: 'Вид правочину',
  costAmount: 'Сума',
  declarationType: 'Тип декларації',
  declarationYear1: 'Звітний рік',
  changesYear: 'Рік, за який подано зміни',
  public_person: 'Публічна особа',
};

const MONEY_KEY = /(cost|size|amount|sum|price|income|assets)/i;

/**
 * Розкладає документ на розділи та плоскі рядки «поле → значення».
 * Порядок і назви беруться з даних, якщо вони там є, інакше — зі словників.
 * @param {any} doc повна відповідь `/documents/{id}`
 * @returns {{key: string, title: string, entries: {title: string, rows: {key: string, label: string, path: string, value: any, text: string, empty: boolean}[]}[]}[]}
 */
export function flattenDocument(doc) {
  const root = unwrapDocument(doc);
  if (!root || typeof root !== 'object') return [];

  return Object.keys(root)
    .sort(compareStepKeys)
    .map((key) => {
      const node = root[key];
      return {
        key,
        title: sectionTitle(key, node),
        entries: toEntries(node).map((entry, index) => ({
          title: entryTitle(entry.value, index, entry.key),
          rows: toRows(entry.value, key),
        })),
      };
    })
    .filter((section) => section.entries.some((entry) => entry.rows.length));
}

/** Дістає корінь із даними декларації з різних форм відповіді. */
export function unwrapDocument(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.data && typeof doc.data === 'object') {
    if (hasStepKeys(doc.data)) return doc.data;
    if (doc.data.data && typeof doc.data.data === 'object' && hasStepKeys(doc.data.data)) return doc.data.data;
    return doc.data;
  }
  return doc;
}

function hasStepKeys(node) {
  return Object.keys(node).some((k) => /^step_\d+$/.test(k));
}

function compareStepKeys(a, b) {
  const na = /^step_(\d+)$/.exec(a);
  const nb = /^step_(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.localeCompare(b, 'uk');
}

function sectionTitle(key, node) {
  const fromData =
    node && typeof node === 'object' && !Array.isArray(node)
      ? firstString(node.title, node.sectionTitle, node.name)
      : null;
  return fromData || SECTION_TITLES[key] || prettifyKey(key);
}

/**
 * Реєстр часто зберігає списки як обʼєкт із числовими ключами
 * ({"1": {...}, "2": {...}}), тому нормалізуємо все до масиву записів.
 */
function toEntries(node) {
  if (Array.isArray(node)) return node.map((value, i) => ({ key: String(i + 1), value }));
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    const allNumeric = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
    if (allNumeric) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({ key: k, value: node[k] }));
    }
    return [{ key: '1', value: node }];
  }
  return [{ key: '1', value: node }];
}

function entryTitle(value, index, key) {
  if (value && typeof value === 'object') {
    const named = firstString(
      joinName(value.lastname, value.firstname, value.middlename),
      value.objectName,
      value.name,
      value.brand && value.model ? `${value.brand} ${value.model}` : null,
      value.organization_name,
      value.emitent_ua_company_name
    );
    if (named) return named;
  }
  return `Запис ${index + 1}${key && key !== String(index + 1) ? ` (${key})` : ''}`;
}

/** Рекурсивно перетворює запис на плоскі рядки. */
function toRows(value, sectionKey, prefix = '', depth = 0) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return [makeRow(prefix || sectionKey, value, prefix || sectionKey)];
  }
  if (depth > 6) {
    return [makeRow(prefix || sectionKey, JSON.stringify(value), prefix || sectionKey)];
  }

  const rows = [];
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v])
    : Object.entries(value);

  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') {
      rows.push(...toRows(child, sectionKey, path, depth + 1));
    } else {
      rows.push(makeRow(key, child, path));
    }
  }
  return rows;
}

function makeRow(key, value, path) {
  const text = formatValue(key, value);
  return {
    key,
    path,
    label: labelFor(key),
    value,
    text,
    empty: isEmptyValue(value),
  };
}

/** Чи вважається значення порожнім (такі рядки можна ховати). */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const s = String(value).trim();
  return s === '' || s === '[]' || s === '{}' || s.toLowerCase() === 'null';
}

/** Людська назва поля: словник → «розшитий» camelCase → сам ключ. */
export function labelFor(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const base = key.replace(/_encr$/, '');
  if (FIELD_LABELS[base]) return `${FIELD_LABELS[base]}`;
  return prettifyKey(key);
}

function prettifyKey(key) {
  return String(key)
    .replace(/[_.]+/g, ' ')
    .replace(/([a-zа-яіїєґ])([A-ZА-ЯІЇЄҐ])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toLocaleUpperCase('uk'));
}

/** Форматує значення для показу: булеві, числа, гроші. */
export function formatValue(key, value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  const s = String(value).trim();
  if (s === '') return '';
  if (MONEY_KEY.test(key) && /^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Math.abs(n) >= 1000) {
      return n.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    }
  }
  return s;
}

/** Кількість непорожніх полів у розкладеному документі. */
export function countFields(sections) {
  return sections.reduce(
    (total, section) =>
      total + section.entries.reduce((sum, entry) => sum + entry.rows.filter((r) => !r.empty).length, 0),
    0
  );
}
