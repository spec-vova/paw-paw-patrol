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
