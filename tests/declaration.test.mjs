import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countFields,
  extractList,
  flattenDocument,
  formatValue,
  isEmptyValue,
  labelFor,
  summarizeDocument,
  unwrapDocument,
} from '../src/lib/declaration.js';

/**
 * Shape captured from a live response, not invented: every step wraps its
 * payload in `data`, keys mix snake_case and camelCase, `_extendedstatus`
 * flags shadow most fields, and unavailable values arrive as placeholders.
 */
const LIVE_DOCUMENT = {
  continue_perform_functions: 1,
  corruption_affected: 2,
  data: {
    step_0: {
      data: {
        declaration_type: 'Щорічна',
        continue_perform_functions: 1,
        declaration_period: '2025',
        declaration_year: 2025,
      },
      isNotApplicable: 0,
    },
    step_1: {
      data: {
        lastname: 'Хміль',
        firstname: 'Владислав',
        middlename: 'Богданович',
        cityType: 'Село',
        country: '1',
        postCategory: '[Не застосовується]',
        passport: '[Конфіденційна інформація]',
        responsiblePosition: 'Ні',
        community_extendedstatus: '0',
        region_extendedstatus: '0',
        actual_cityType_extendedstatus: '1',
      },
    },
    step_3: {
      data: {
        1: { objectType: 'Квартира', totalArea: '74.5', ua_cityType: 'м. Київ' },
        2: { objectType: 'Гараж', totalArea: '18' },
      },
      isNotApplicable: 0,
    },
  },
};

/** step_2 and step_3 arrive as arrays, and step_2 is family, not an address. */
const LIVE_SECTIONS = {
  data: {
    step_2: {
      data: [
        { lastname: 'Хміль', firstname: 'Богдан', middlename: 'Ростиславович', subjectRelation: 'батько' },
        { lastname: 'Петринець', firstname: 'Віра', middlename: 'Петрівна', subjectRelation: 'баба' },
      ],
      isNotApplicable: 0,
    },
    step_3: {
      data: [
        {
          objectType: 'Житловий будинок',
          totalArea: '80,5',
          owningDate: '27.03.2001',
          cost_date_assessment: '[Не відомо]',
          rights: [{ ownershipType: 'Власність', rightBelongs: '1617259788313' }],
        },
        { objectType: 'Земельна ділянка', totalArea: '0.25', owningDate: '13.03.2012' },
      ],
      isNotApplicable: 0,
    },
  },
};

test('family records are titled by name and relation', () => {
  const family = flattenDocument(LIVE_SECTIONS).find((section) => section.key === 'step_2');

  assert.equal(family.title, 'Інформація про членів сімʼї');
  assert.equal(family.entries.length, 2);
  assert.equal(family.entries[0].title, 'Хміль Богдан Ростиславович — батько');
  assert.equal(family.entries[1].title, 'Петринець Віра Петрівна — баба');
});

test('property records are titled by object type instead of a bare index', () => {
  const property = flattenDocument(LIVE_SECTIONS).find((section) => section.key === 'step_3');

  assert.equal(property.entries[0].title, 'Житловий будинок');
  assert.equal(property.entries[1].title, 'Земельна ділянка');

  const nested = property.entries[0].rows.find((row) => row.key === 'ownershipType');
  assert.equal(nested.path, 'rights.1.ownershipType', 'nested rights are expanded, not stringified');
});

test('"[Не відомо]" stays visible — a declared unknown is itself information', () => {
  const property = flattenDocument(LIVE_SECTIONS).find((section) => section.key === 'step_3');
  const row = property.entries[0].rows.find((item) => item.key === 'cost_date_assessment');
  assert.equal(row.empty, false);
  assert.equal(row.text, '[Не відомо]');
});

test('each step is unwrapped so records stay separate', () => {
  const sections = flattenDocument(LIVE_DOCUMENT);
  const property = sections.find((section) => section.key === 'step_3');

  assert.equal(property.entries.length, 2, 'two properties, not one blob of dotted paths');
  assert.equal(property.entries[0].rows[0].label, 'Тип обʼєкта');
  assert.equal(property.entries[0].rows[0].text, 'Квартира');
  assert.ok(
    property.entries[0].rows.every((row) => !row.path.startsWith('data.')),
    'the wrapper level does not leak into field paths'
  );
});

test('registry placeholders and internal flags are separated from real data', () => {
  const sections = flattenDocument(LIVE_DOCUMENT);
  const general = sections.find((section) => section.key === 'step_1').entries[0];
  const row = (key) => general.rows.find((item) => item.key === key);

  assert.equal(row('postCategory').empty, true, '"[Не застосовується]" carries nothing');
  assert.equal(row('passport').empty, false, '"[Конфіденційна інформація]" is a real statement');
  assert.equal(row('community_extendedstatus').technical, true);
  assert.equal(row('lastname').technical, false);

  // Both kinds are hidden by default, so the count reflects declared data only:
  // lastname, firstname, middlename, cityType, country, passport, responsiblePosition.
  assert.equal(countFields([{ entries: [general] }]), 7);
});

test('the card finds a name however deeply the registry buried it', () => {
  const summary = summarizeDocument(LIVE_DOCUMENT);
  assert.equal(summary.pib, 'Хміль Владислав Богданович');
  assert.equal(summary.year, 2025);
  assert.equal(summary.type, 'Щорічна');
});

test('extractList finds the array in different response shapes', () => {
  assert.deepEqual(extractList([{ id: 1 }]).items, [{ id: 1 }]);
  assert.deepEqual(extractList({ items: [{ id: 2 }] }).items, [{ id: 2 }]);
  assert.deepEqual(extractList({ data: [{ id: 3 }] }).items, [{ id: 3 }]);
  assert.deepEqual(extractList({ data: { items: [{ id: 4 }] } }).items, [{ id: 4 }]);
  assert.deepEqual(extractList({ nothing: true }).items, []);
  assert.deepEqual(extractList(null).items, []);
});

test('extractList reads counters from several places', () => {
  assert.equal(extractList({ items: [], total: 42 }).total, 42);
  assert.equal(extractList({ items: [], meta: { total_count: '7', page: 2 } }).total, 7);
  assert.equal(extractList({ items: [], meta: { total_count: '7', page: 2 } }).page, 2);
  assert.equal(extractList({ items: [] }).total, null);
});

test('summarizeDocument builds a card from alternative key sets', () => {
  const flat = summarizeDocument({
    id: 'abc',
    lastname: 'Іваненко',
    firstname: 'Іван',
    middlename: 'Іванович',
    position: 'Головний спеціаліст',
    declaration_year: 2023,
    declaration_type_name: 'Щорічна',
  });
  assert.equal(flat.id, 'abc');
  assert.equal(flat.pib, 'Іваненко Іван Іванович');
  assert.equal(flat.year, 2023);
  assert.equal(flat.type, 'Щорічна');

  const nested = summarizeDocument({
    doc_uuid: 'uuid-1',
    data: { step_1: { lastname: 'Петренко', firstname: 'Петро', workPost: 'Суддя' } },
  });
  assert.equal(nested.id, 'uuid-1');
  assert.equal(nested.pib, 'Петренко Петро');
  assert.equal(nested.position, 'Суддя');

  const empty = summarizeDocument(null);
  assert.equal(empty.pib, '—');
  assert.equal(empty.id, null);
});

test('unwrapDocument finds the data root inside nested wrappers', () => {
  const steps = { step_1: { lastname: 'І' } };
  assert.deepEqual(unwrapDocument({ data: steps }), steps);
  assert.deepEqual(unwrapDocument({ data: { data: steps } }), steps);
  assert.deepEqual(unwrapDocument(steps), steps);
  assert.equal(unwrapDocument(null), null);
});

test('flattenDocument orders sections by step number', () => {
  const doc = {
    data: {
      step_11: { 1: { objectTypeName: 'Заробітна плата', sizeIncome: '250000' } },
      step_1: { lastname: 'Іваненко', firstname: 'Іван' },
      step_3: {
        1: { objectType: 'Квартира', totalArea: '75' },
        2: { objectType: 'Гараж', totalArea: '18' },
      },
    },
  };
  const sections = flattenDocument(doc);
  assert.deepEqual(
    sections.map((section) => section.key),
    ['step_1', 'step_3', 'step_11']
  );
  assert.equal(sections[0].title, 'Загальна інформація про субʼєкта декларування');
  assert.equal(sections[1].entries.length, 2, 'numeric keys become separate entries');
  assert.equal(sections[1].entries[0].rows[0].label, 'Тип обʼєкта');
  assert.equal(sections[1].entries[0].rows[0].text, 'Квартира');
});

test('flattenDocument expands nested objects into paths', () => {
  const sections = flattenDocument({ data: { step_2: { rights: { 1: { ownershipType: 'Власність' } } } } });
  const row = sections[0].entries[0].rows.find((item) => item.key === 'ownershipType');
  assert.ok(row, 'nested field is found');
  assert.equal(row.path, 'rights.1.ownershipType');
});

test('flattenDocument drops empty sections and survives junk input', () => {
  assert.deepEqual(flattenDocument(null), []);
  assert.deepEqual(flattenDocument({ data: {} }), []);
  assert.deepEqual(flattenDocument('a string'), []);
});

test('flattenDocument does not run away on deep nesting', () => {
  let deep = { value: 'bottom' };
  for (let i = 0; i < 30; i += 1) deep = { nested: deep };
  const sections = flattenDocument({ data: { step_1: deep } });
  assert.ok(sections[0].entries[0].rows.length > 0);
});

test('countFields counts non-empty fields only', () => {
  const sections = flattenDocument({
    data: { step_1: { lastname: 'Іваненко', firstname: '', middlename: null } },
  });
  assert.equal(countFields(sections), 1);
});

test('labelFor translates known keys and de-camel-cases the rest', () => {
  assert.equal(labelFor('lastname'), 'Прізвище');
  assert.equal(labelFor('sizeIncome'), 'Розмір доходу');
  assert.equal(labelFor('someUnknownField'), 'Some Unknown Field');
  assert.equal(labelFor('another_key'), 'Another key');
});

test('formatValue renders booleans and large amounts', () => {
  assert.equal(formatValue('publicPerson', true), 'так');
  assert.equal(formatValue('publicPerson', false), 'ні');
  assert.equal(formatValue('totalArea', '75'), '75');
  assert.equal(formatValue('sizeIncome', '250000').replace(/\s/g, ' '), '250 000');
  assert.equal(formatValue('sizeIncome', '250'), '250', 'small numbers are left alone');
  assert.equal(formatValue('lastname', null), '');
});

test('isEmptyValue recognises empty values', () => {
  assert.equal(isEmptyValue(null), true);
  assert.equal(isEmptyValue(''), true);
  assert.equal(isEmptyValue('   '), true);
  assert.equal(isEmptyValue('[]'), true);
  assert.equal(isEmptyValue(0), false);
  assert.equal(isEmptyValue('Іваненко'), false);
});
