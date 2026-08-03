/**
 * Parsing of registry responses and flattening of a declaration document.
 *
 * The response schema differs between registry versions, so every reader here
 * probes several likely keys instead of trusting one. Whatever arrives, the
 * raw JSON is still shown in the UI, so nothing is silently dropped.
 *
 * Label dictionaries are Ukrainian on purpose — they are rendered as-is.
 */

const LIST_KEYS = ['items', 'data', 'results', 'documents', 'docs', 'rows'];

/**
 * Extracts the document array from a list response.
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
      // Nested shapes such as {data: {items: [...]}} also occur.
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
  for (const value of values) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Reduces a list item to the fields a result card needs. */
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
    agency: firstString(
      src.placeOfWork,
      src.place_of_work,
      src.organization,
      src.department,
      step1.workPlace,
      step1.placeOfWork
    ),
    year: firstNumber(src.declaration_year, src.declarationYear, src.year, src.period),
    type: firstString(src.declaration_type_name, src.type_name, src.declarationType, src.doc_type_name),
    typeId: firstNumber(src.declaration_type, src.doc_type, src.type),
    date: firstString(src.date, src.created_date, src.submitted_at, src.declaration_date, src.userDeclarantDate),
    corrected: Boolean(src.corrected ?? src.is_corrected),
    raw: src,
  };
}

function joinName(...parts) {
  const joined = parts
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();
  return joined || null;
}

// ───────────────────────── document flattening ─────────────────────────

/** Declaration section titles (best effort: the schema varies by year). */
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

/** Labels for the most common fields. Unknown keys are shown as they are. */
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
 * Splits a document into sections and flat "field → value" rows.
 * Titles come from the payload when present, otherwise from the dictionaries.
 *
 * @param {any} doc full `/documents/{id}` response
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

/** Finds the declaration data root across the possible response wrappers. */
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
  return Object.keys(node).some((key) => /^step_\d+$/.test(key));
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
 * The registry often stores lists as objects with numeric keys
 * ({"1": {...}, "2": {...}}), so everything is normalised to entries.
 */
function toEntries(node) {
  if (Array.isArray(node)) return node.map((value, index) => ({ key: String(index + 1), value }));
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    const allNumeric = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
    if (allNumeric) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((key) => ({ key, value: node[key] }));
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

/** Recursively turns an entry into flat rows. */
function toRows(value, sectionKey, prefix = '', depth = 0) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return [makeRow(prefix || sectionKey, value, prefix || sectionKey)];
  }
  if (depth > 6) {
    return [makeRow(prefix || sectionKey, JSON.stringify(value), prefix || sectionKey)];
  }

  const rows = [];
  const entries = Array.isArray(value) ? value.map((item, i) => [String(i + 1), item]) : Object.entries(value);

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
  return {
    key,
    path,
    label: labelFor(key),
    value,
    text: formatValue(key, value),
    empty: isEmptyValue(value),
  };
}

/** Whether a value counts as empty (such rows can be hidden). */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '' || text === '[]' || text === '{}' || text.toLowerCase() === 'null';
}

/** Human label for a field: dictionary → de-camel-cased key → key itself. */
export function labelFor(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const base = key.replace(/_encr$/, '');
  if (FIELD_LABELS[base]) return FIELD_LABELS[base];
  return prettifyKey(key);
}

function prettifyKey(key) {
  return String(key)
    .replace(/[_.]+/g, ' ')
    .replace(/([a-zа-яіїєґ])([A-ZА-ЯІЇЄҐ])/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toLocaleUpperCase('uk'));
}

/** Formats a value for display: booleans, numbers, money amounts. */
export function formatValue(key, value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';

  const text = String(value).trim();
  if (text === '') return '';

  if (MONEY_KEY.test(key) && /^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && Math.abs(n) >= 1000) {
      return n.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    }
  }
  return text;
}

/** Counts non-empty fields across a flattened document. */
export function countFields(sections) {
  return sections.reduce(
    (total, section) =>
      total + section.entries.reduce((sum, entry) => sum + entry.rows.filter((row) => !row.empty).length, 0),
    0
  );
}
