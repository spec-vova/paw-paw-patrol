/**
 * Runs the parser over a whole declaration captured from the live registry.
 *
 * The unit tests check individual quirks on hand-written snippets; this one
 * checks that a real 2022 document — 18 steps, arrays and numeric-keyed maps
 * side by side, placeholders everywhere — comes out readable end to end.
 *
 * Names and workplaces in the fixture are replaced with test values; the
 * structure, keys and placeholder strings are exactly as the registry sent them.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { countFields, flattenDocument, summarizeDocument } from '../src/lib/declaration.js';

const doc = JSON.parse(readFileSync(new URL('./fixtures/declaration-2022.json', import.meta.url), 'utf8'));
const sections = flattenDocument(doc);
const section = (key) => sections.find((item) => item.key === key);

test('the card is filled from the document alone', () => {
  const summary = summarizeDocument(doc);

  assert.equal(summary.pib, 'Тестенко Тест Тестович');
  assert.equal(summary.position, 'тестова посада');
  assert.equal(summary.agency, 'Тестова установа');
  assert.equal(summary.year, 2022);
  assert.equal(summary.type, 'Щорічна');
  assert.equal(summary.id, 'c7543bb2-80d3-402b-8b7e-fccc12fc323e');
});

test('only sections with content survive, in form order', () => {
  assert.deepEqual(
    sections.map((item) => item.key),
    ['step_0', 'step_1', 'step_2', 'step_3', 'step_6', 'step_11', 'step_17'],
    'the eleven empty steps of this declaration are dropped'
  );
  assert.equal(section('step_17').title, 'Банківські та інші фінансові установи, у яких відкрито рахунки');
});

test('every section is split into records a person can scan', () => {
  assert.equal(section('step_2').entries.length, 4, 'four family members');
  assert.equal(section('step_2').entries[0].title, 'Тестенко Богдан Ростиславович — батько');

  assert.equal(section('step_3').entries.length, 7, 'seven properties');
  assert.deepEqual(
    section('step_3').entries.slice(0, 3).map((entry) => entry.title),
    ['Житловий будинок', 'Житловий будинок', 'Земельна ділянка']
  );

  assert.equal(section('step_6').entries[0].title, 'OPEL VECTRA');
  assert.equal(section('step_17').entries[0].title, 'АТ «ТЕСТБАНК»');
});

test('internal codes are filtered out of the reading view', () => {
  const rows = sections.flatMap((item) => item.entries.flatMap((entry) => entry.rows));
  const visible = rows.filter((row) => !row.empty && !row.technical);

  assert.equal(countFields(sections), visible.length);
  assert.ok(visible.length > 300, `expected a substantial document, got ${visible.length}`);

  for (const key of ['districtPath', 'cityPath', 'iteration', 'region_extendedstatus']) {
    assert.ok(
      rows.some((row) => row.key === key),
      `${key} is still parsed and available under the switch`
    );
    assert.ok(
      !visible.some((row) => row.key === key),
      `${key} is a classifier code or an internal id, not declared information`
    );
  }
});

test('registry placeholders keep their different meanings', () => {
  const rows = sections.flatMap((item) => item.entries.flatMap((entry) => entry.rows));
  const withText = (text) => rows.filter((row) => row.text === text);

  assert.ok(withText('[Конфіденційна інформація]').length > 0);
  assert.ok(
    withText('[Конфіденційна інформація]').every((row) => !row.empty),
    'withheld data is a statement, not a blank'
  );
  assert.ok(
    withText('[Не застосовується]').every((row) => row.empty),
    '"not applicable" is a blank'
  );

  const refused = rows.find((row) => row.text === "[Член сім'ї не надав інформацію]");
  assert.ok(refused && !refused.empty, 'a refusal to disclose is worth showing');
});

test('nested structures are expanded rather than stringified', () => {
  const property = section('step_3').entries[0].rows;
  const ownership = property.find((row) => row.key === 'ownershipType');
  assert.ok(ownership, 'rights[] is expanded into rows');
  assert.match(ownership.path, /^rights\.\d+\.ownershipType$/);

  const bank = section('step_17').entries[0].rows;
  const account = bank.find((row) => row.key === 'account_number');
  assert.ok(account, 'accounts keyed by timestamp are expanded');
  assert.equal(account.label, 'Номер рахунку');
});

test('no value is lost: every scalar in the document reaches a row', () => {
  const count = (node) => {
    if (node === null || typeof node !== 'object') return 1;
    return Object.values(node).reduce((sum, value) => sum + count(value), 0);
  };

  const scalarsInSteps = count(doc.data);
  const rows = sections.flatMap((item) => item.entries.flatMap((entry) => entry.rows));
  // Steps carry an isNotApplicable flag that is metadata, not a field.
  assert.ok(rows.length >= scalarsInSteps - 18, `${rows.length} rows for ${scalarsInSteps} scalars`);
});
