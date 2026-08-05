/**
 * Consolidates several declarations of one person into a single profile.
 *
 * A single declaration is a snapshot; the interesting part is what changes
 * between them — income that jumps, property that appears or disappears, a
 * position that moves. That comparison is impossible to do by eye across nine
 * documents of several hundred fields each, which is the whole point of this
 * module.
 *
 * Everything here is derived from the registry's own data. Values are reported
 * as declared: no estimates, no filling of gaps, and a year with no filing is
 * shown as missing rather than interpolated.
 */

import { flattenDocument, isEmptyValue, summarizeDocument, unwrapDocument } from './declaration.js';

/** Section keys, named so the intent survives a schema change. */
const STEP = {
  general: 'step_1',
  family: 'step_2',
  property: 'step_3',
  vehicles: 'step_6',
  income: 'step_11',
  banks: 'step_17',
};

/**
 * Parses a declared amount. The registry writes "482000", "80,5" and
 * "1 234,56" — and placeholders where a number is expected.
 * @returns {number|null} null when the value is not a number at all
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (isEmptyValue(value)) return null;

  const text = String(value)
    .replace(/\s| /g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

/** Records of a step, whatever container the registry used for them. */
function records(doc, stepKey) {
  const root = unwrapDocument(doc);
  const step = root?.[stepKey];
  const payload = step && typeof step === 'object' && step.data !== undefined ? step.data : step;

  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === 'object');
  if (payload && typeof payload === 'object') {
    return Object.values(payload).filter((item) => item && typeof item === 'object');
  }
  return [];
}

function text(...values) {
  for (const value of values) {
    if (isEmptyValue(value)) continue;
    return String(value).trim();
  }
  return null;
}

function fullName(record) {
  const parts = [record?.lastname, record?.firstname, record?.middlename]
    .filter((part) => !isEmptyValue(part))
    .map((part) => String(part).trim());
  return parts.length ? parts.join(' ') : null;
}

// ─────────────────────────── grouping keys ───────────────────────────

/**
 * Identity of an asset across years.
 *
 * The registry assigns no stable id to a property between filings, so sameness
 * is inferred from the declared attributes. Deliberately coarse: two genuinely
 * different plots of identical size in one village will merge, which is a
 * milder error than reporting the same house as bought anew every year.
 */
function propertyKey(record) {
  return [
    text(record.objectType) || '?',
    text(record.totalArea) || '?',
    text(record.city, record.ua_cityType) || '?',
    text(record.regNumber) || '',
  ].join('|');
}

function vehicleKey(record) {
  return [text(record.brand) || '?', text(record.model) || '?', text(record.graduationYear) || '?'].join('|');
}

function bankKey(record) {
  return text(record.establishment_ua_company_code, record.establishment_ua_company_name) || '?';
}

function personKey(record) {
  return (fullName(record) || '?').toLocaleLowerCase('uk');
}

// ───────────────────────────── the profile ───────────────────────────

/**
 * Builds the consolidated profile.
 *
 * @param {any[]} documents full documents, in any order
 * @returns {{
 *   pib: string|null, years: number[], missingYears: number[],
 *   positions: {year: number|null, post: string|null, place: string|null}[],
 *   income: {year: number|null, total: number|null, items: {type: string|null, amount: number|null, source: string|null}[]}[],
 *   property: {title: string, detail: string|null, years: number[], rights: string[]}[],
 *   vehicles: {title: string, detail: string|null, years: number[]}[],
 *   banks: {title: string, detail: string|null, years: number[]}[],
 *   family: {title: string, detail: string|null, years: number[]}[],
 *   documents: number
 * }}
 */
export function buildProfile(documents) {
  const list = (Array.isArray(documents) ? documents : []).filter(Boolean);

  const dated = list
    .map((doc) => ({ doc, summary: summarizeDocument(doc) }))
    .sort((a, b) => (b.summary.year ?? 0) - (a.summary.year ?? 0));

  const years = [...new Set(dated.map((entry) => entry.summary.year).filter((year) => typeof year === 'number'))].sort(
    (a, b) => b - a
  );

  const pib = dated.map((entry) => entry.summary.pib).find((name) => name && name !== '—') || null;

  const positions = dated
    .map(({ doc, summary }) => {
      const general = records(doc, STEP.general)[0] || {};
      return {
        year: summary.year,
        post: text(general.workPost, summary.position),
        place: text(general.workPlace, summary.agency),
      };
    })
    .filter((entry) => entry.post || entry.place);

  const income = dated.map(({ doc, summary }) => {
    const items = records(doc, STEP.income).map((record) => ({
      type: text(record.objectTypeName, record.objectType),
      amount: parseAmount(record.sizeIncome),
      source: text(record.source_ua_company_name, record.source_citizen, record.incomeSource),
    }));

    const known = items.map((item) => item.amount).filter((amount) => amount !== null);
    return {
      year: summary.year,
      // Null, not zero: "nothing declared" and "declared nothing" differ, and
      // some amounts are withheld as confidential.
      total: known.length ? known.reduce((sum, amount) => sum + amount, 0) : null,
      withheld: items.length - known.length,
      items,
    };
  });

  return {
    pib,
    years,
    missingYears: gapsIn(years),
    documents: list.length,
    positions,
    income,
    property: collect(dated, STEP.property, propertyKey, (record) => ({
      title: text(record.objectType) || 'Обʼєкт',
      detail: joinDetails([
        text(record.totalArea) && `${text(record.totalArea)} м²`,
        text(record.city, record.ua_cityType),
        text(record.owningDate) && `з ${text(record.owningDate)}`,
      ]),
      rights: rightsOf(record),
    })),
    vehicles: collect(dated, STEP.vehicles, vehicleKey, (record) => ({
      title: [text(record.brand), text(record.model)].filter(Boolean).join(' ') || 'Транспортний засіб',
      detail: joinDetails([text(record.graduationYear) && `${text(record.graduationYear)} р. в.`, text(record.objectType)]),
      rights: rightsOf(record),
    })),
    banks: collect(dated, STEP.banks, bankKey, (record) => ({
      title: text(record.establishment_ua_company_name) || 'Установа',
      detail: joinDetails([text(record.establishment_ua_company_code), text(record.establishment_type)]),
      rights: [],
    })),
    family: collect(dated, STEP.family, personKey, (record) => ({
      title: fullName(record) || 'Особа',
      detail: text(record.subjectRelation),
      rights: [],
    })),
  };
}

/** Groups a step's records across documents and records the years each appears. */
function collect(dated, stepKey, keyOf, describe) {
  const groups = new Map();

  for (const { doc, summary } of dated) {
    for (const record of records(doc, stepKey)) {
      const key = keyOf(record);
      const described = describe(record);

      if (!groups.has(key)) {
        groups.set(key, { ...described, years: [], rights: new Set(described.rights || []) });
      }
      const group = groups.get(key);
      if (typeof summary.year === 'number' && !group.years.includes(summary.year)) group.years.push(summary.year);
      for (const right of described.rights || []) group.rights.add(right);
      // A later filing may spell out a detail the earlier one left blank.
      if (!group.detail && described.detail) group.detail = described.detail;
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, years: group.years.sort((a, b) => b - a), rights: [...group.rights] }))
    .sort((a, b) => (b.years[0] ?? 0) - (a.years[0] ?? 0) || a.title.localeCompare(b.title, 'uk'));
}

function rightsOf(record) {
  const rights = Array.isArray(record.rights) ? record.rights : Object.values(record.rights || {});
  return rights
    .filter((right) => right && typeof right === 'object')
    .map((right) => text(right.ownershipType, right.otherOwnership))
    .filter(Boolean);
}

function joinDetails(parts) {
  const joined = parts.filter(Boolean).join(' · ');
  return joined || null;
}

/** Reporting years with no filing between the first and the last one. */
function gapsIn(years) {
  if (years.length < 2) return [];
  const missing = [];
  for (let year = years[years.length - 1]; year < years[0]; year += 1) {
    if (!years.includes(year)) missing.push(year);
  }
  return missing.reverse();
}

/**
 * Rows for the "what changed" view: an asset that stops being declared, or
 * starts. Computed from the years each asset appears in, so a gap year with no
 * filing at all does not read as a disappearance.
 */
export function assetChanges(profile) {
  const changes = [];
  const latest = profile.years[0];
  const filed = new Set(profile.years);

  for (const [kind, items] of [
    ['Нерухомість', profile.property],
    ['Транспорт', profile.vehicles],
  ]) {
    for (const item of items) {
      const firstYear = item.years[item.years.length - 1];
      const lastYear = item.years[0];

      if (lastYear !== undefined && lastYear !== latest) {
        changes.push({ kind, title: item.title, event: 'зникло', year: lastYear, detail: item.detail });
      }
      // "Appeared" only counts when an earlier filing exists to have missed it.
      if (firstYear !== undefined && firstYear !== Math.min(...filed)) {
        changes.push({ kind, title: item.title, event: 'зʼявилося', year: firstYear, detail: item.detail });
      }
    }
  }

  return changes.sort((a, b) => b.year - a.year);
}

/** Total number of declared fields across the documents, for a sanity line. */
export function countProfileFields(documents) {
  return (Array.isArray(documents) ? documents : []).reduce((total, doc) => {
    const sections = flattenDocument(doc);
    return (
      total +
      sections.reduce(
        (sum, section) =>
          sum + section.entries.reduce((n, entry) => n + entry.rows.filter((row) => !row.empty && !row.technical).length, 0),
        0
      )
    );
  }, 0);
}
