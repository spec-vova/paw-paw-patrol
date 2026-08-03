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

/**
 * Flattens an item into "key → first non-empty scalar", ignoring nesting.
 *
 * The registry buries the same field at different depths depending on the
 * endpoint and the year, so probing fixed paths misses it and the card ends up
 * showing a dash. A shallow key lookup finds it wherever it sits.
 *
 * Only a fallback: exact top-level keys are preferred, because a deep scan can
 * pick up a relative's name from a nested record.
 */
function collectFields(node, depth = 0, out = new Map()) {
  if (!node || typeof node !== 'object' || depth > 5) return out;

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      collectFields(value, depth + 1, out);
    } else if (!out.has(key) && !isEmptyValue(value)) {
      out.set(key, String(value).trim());
    }
  }
  return out;
}

/** Reduces a list item to the fields a result card needs. */
export function summarizeDocument(item) {
  const src = item && typeof item === 'object' ? item : {};
  const data = src.data && typeof src.data === 'object' ? src.data : {};
  const step1 = data.step_1 && typeof data.step_1 === 'object' ? data.step_1 : {};
  const deep = collectFields(src);
  const at = (...keys) => firstString(...keys.map((key) => deep.get(key)));

  const pib =
    firstString(
      src.pib,
      src.fullname,
      src.full_name,
      src.declarant_name,
      joinName(src.lastname, src.firstname, src.middlename),
      joinName(src.last_name, src.first_name, src.middle_name),
      joinName(step1.lastname, step1.firstname, step1.middlename),
      at('pib', 'fullname', 'full_name', 'declarant_name', 'eng_full_name'),
      joinName(deep.get('lastname'), deep.get('firstname'), deep.get('middlename')),
      joinName(deep.get('last_name'), deep.get('first_name'), deep.get('middle_name'))
    ) || '—';

  return {
    id: firstString(src.id, src.doc_uuid, src.document_id, src.uuid, src.declaration_id, at('id', 'doc_uuid')),
    pib,
    position: firstString(
      src.position,
      src.post,
      src.workPost,
      src.work_post,
      step1.workPost,
      step1.post,
      at('workPost', 'position', 'post', 'actual_workPost')
    ),
    agency: firstString(
      src.placeOfWork,
      src.place_of_work,
      src.organization,
      src.department,
      step1.workPlace,
      step1.placeOfWork,
      at('workPlace', 'placeOfWork', 'organization', 'actual_workPlace')
    ),
    year: firstNumber(src.declaration_year, src.declarationYear, src.year, src.period, deep.get('declaration_year')),
    type: firstString(
      src.declaration_type_name,
      src.type_name,
      src.declarationType,
      src.doc_type_name,
      at('declaration_type')
    ),
    typeId: firstNumber(src.doc_type, src.type),
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
  step_2: 'Інформація про членів сімʼї',
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
  step_17: 'Банківські та інші фінансові установи, у яких відкрито рахунки',
};

/** Labels for the most common fields. Unknown keys are shown as they are. */
export const FIELD_LABELS = {
  declaration_type: 'Тип декларації',
  declaration_period: 'Звітний період',
  declaration_year: 'Звітний рік',
  isNotApplicable: 'Не застосовується',
  postCategory: 'Категорія посади',
  postType: 'Тип посади',
  workPlaceEdrpou: 'ЄДРПОУ місця роботи',
  corruptionAffected: 'Причетність до корупції',
  sameRegLivingAddress: 'Фактичне місце проживання збігається з реєстрацією',
  region: 'Область',
  district: 'Район',
  community: 'Громада',
  city: 'Населений пункт',
  regNumber: 'Реєстраційний номер',
  rightBelongs: 'Право належить',
  otherOwnership: 'Інше право користування',
  owningDate: 'Дата набуття права',
  iteration: 'Ідентифікатор запису',
  usage: 'Використання',
  taxNumber: 'РНОКПП',
  unzr: 'УНЗР',
  previous_firstname: 'Попереднє імʼя',
  previous_middlename: 'Попереднє по батькові',
  passport: 'Паспорт',
  cityArea: 'Район міста',
  ua_street: 'Вулиця',
  ua_streetType: 'Тип вулиці',
  ua_postCode: 'Поштовий індекс',
  ua_apartmentsNum: 'Квартира',
  ua_housePartNum: 'Частина будинку',
  housePartNum: 'Частина будинку',
  object_cost_type: 'Тип вартості обʼєкта',
  establishment_ua_company_name: 'Установа',
  establishment_type: 'Тип установи',
  establishment_ua_company_code: 'Код ЄДРПОУ установи',
  accounts: 'Рахунки',
  account_number: 'Номер рахунку',
  account_type: 'Тип рахунку',
  person_open_account: 'Хто відкрив рахунок',
  persons_has_accounts: 'Особи, які мають рахунки',
  person_has_account: 'Особа має рахунок',
  person_who_care: 'Особа, яка перебуває на утриманні',
  nui_info_exists: 'Є документ іншої держави',
  nui_first_name: 'Імʼя (за документом іншої держави)',
  nui_last_name: 'Прізвище (за документом іншої держави)',
  nui_middle_name: 'По батькові (за документом іншої держави)',
  nui_document_type: 'Тип документа',
  nui_document_country: 'Країна видачі',
  nui_document_number: 'Номер документа',
  nui_identity_number: 'Ідентифікаційний номер',
  non_ukraine_identity: 'Документ іншої держави',
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

// Internal flags that accompany almost every field and carry nothing for a
// reader: "<field>_extendedstatus" marks how the value was filled in.
// "<field>_extendedstatus" marks how the value was filled in; "<field>Path" is
// a KATOTTG classifier code such as "1.UA61000000000060328.UA61040000000090285";
// "iteration" is an internal record id. None of it is declared information.
const TECHNICAL_KEY = /(_extendedstatus$|Path$|^iteration$)/i;

// The registry writes placeholders instead of values. "not applicable" is
// noise; "confidential" is meaningful — it says the data exists but is hidden.
const NOT_APPLICABLE = /^\[(не застосовується|не застосовано|не заповнено)\]$/i;

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
      const node = unwrapStep(root[key]);
      return {
        key,
        title: sectionTitle(key, root[key]),
        entries: toEntries(node).map((entry, index) => ({
          title: entryTitle(entry.value, index, entry.key),
          rows: toRows(entry.value, key),
        })),
      };
    })
    .filter((section) => section.entries.some((entry) => entry.rows.length));
}

/**
 * Every step wraps its payload one level deeper:
 * `step_3: { data: {"1": {...}, "2": {...}}, isNotApplicable: 0 }`.
 *
 * Without unwrapping, a section with twenty properties collapses into a single
 * entry holding hundreds of dotted paths instead of twenty readable records.
 */
function unwrapStep(node) {
  if (node && typeof node === 'object' && !Array.isArray(node) && node.data && typeof node.data === 'object') {
    return node.data;
  }
  return node;
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
      value.emitent_ua_company_name,
      value.establishment_ua_company_name,
      // Property and vehicle records carry no name — the type reads better
      // than "Запис 3" when a section lists a dozen of them.
      value.objectType
    );
    if (named) {
      // "батько", "дружина" — the relation is the point of a family record.
      const relation = firstString(value.subjectRelation);
      return relation ? `${named} — ${relation}` : named;
    }
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
    technical: isTechnicalKey(key),
  };
}

/** Whether a value counts as empty (such rows can be hidden). */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  if (text === '' || text === '[]' || text === '{}' || text.toLowerCase() === 'null') return true;
  return NOT_APPLICABLE.test(text);
}

/** Whether a key is an internal flag rather than declared information. */
export function isTechnicalKey(key) {
  return TECHNICAL_KEY.test(String(key));
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
      total +
      section.entries.reduce(
        (sum, entry) => sum + entry.rows.filter((row) => !row.empty && !row.technical).length,
        0
      ),
    0
  );
}
