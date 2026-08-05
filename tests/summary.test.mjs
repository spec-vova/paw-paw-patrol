/**
 * The consolidated profile is built from several declarations at once, so the
 * fixtures here are the real 2022 document plus variants of it: a later year
 * with a sold car and a raise, and an earlier year with less property.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { assetChanges, buildProfile, parseAmount } from '../src/lib/summary.js';

const base = JSON.parse(readFileSync(new URL('./fixtures/declaration-2022.json', import.meta.url), 'utf8'));

/** A copy of the fixture for another year, with edits applied to its steps. */
function variant(year, edit = () => {}) {
  const copy = structuredClone(base);
  copy.declaration_year = year;
  copy.data.step_0.data.declaration_year = year;
  copy.data.step_0.data.declaration_period = String(year);
  edit(copy.data);
  return copy;
}

test('parseAmount reads the shapes the registry writes', () => {
  assert.equal(parseAmount('482000'), 482000);
  assert.equal(parseAmount('80,5'), 80.5);
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount(1000), 1000);
  assert.equal(parseAmount('[Конфіденційна інформація]'), null);
  assert.equal(parseAmount('[Не застосовується]'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
});

test('the profile spans every filing and names the person once', () => {
  const profile = buildProfile([variant(2023), base, variant(2021)]);

  assert.equal(profile.pib, 'Тестенко Тест Тестович');
  assert.deepEqual(profile.years, [2023, 2022, 2021]);
  assert.equal(profile.documents, 3);
  assert.deepEqual(profile.missingYears, []);
});

test('a year without a filing is reported as a gap, not smoothed over', () => {
  const profile = buildProfile([variant(2025), base]);
  assert.deepEqual(profile.years, [2025, 2022]);
  assert.deepEqual(profile.missingYears, [2024, 2023]);
});

test('income is totalled per year, and withheld amounts are not counted as zero', () => {
  const profile = buildProfile([
    variant(2023, (data) => {
      data.step_11.data = [
        { objectTypeName: 'Заробітна плата', sizeIncome: '600000', source_ua_company_name: 'Установа' },
        { objectTypeName: 'Подарунок', sizeIncome: '[Конфіденційна інформація]' },
      ];
    }),
  ]);

  const [year] = profile.income;
  assert.equal(year.year, 2023);
  assert.equal(year.total, 600000, 'only declared numbers are summed');
  assert.equal(year.withheld, 1, 'the withheld one is counted, not silently dropped');
  assert.equal(year.items.length, 2);
});

test('an asset is one entry with the years it appears in, not one per filing', () => {
  const profile = buildProfile([variant(2023), base, variant(2021)]);
  const house = profile.property.find((item) => item.title === 'Житловий будинок');

  assert.ok(house, 'the house is found');
  assert.deepEqual(house.years, [2023, 2022, 2021], 'three filings, one asset');
  assert.match(house.detail, /м²/);
  assert.ok(house.rights.length > 0, 'ownership types are collected');
});

test('assets that stop or start being declared surface as changes', () => {
  const documents = [
    // Newest filing: the car is gone, a flat appears.
    variant(2023, (data) => {
      data.step_6.data = [];
      data.step_3.data = [
        ...data.step_3.data,
        { objectType: 'Квартира', totalArea: '54', city: 'Тернопіль', owningDate: '01.02.2023' },
      ];
    }),
    base,
    variant(2021),
  ];

  const profile = buildProfile(documents);
  const changes = assetChanges(profile);

  const sold = changes.find((change) => change.title === 'OPEL VECTRA');
  assert.ok(sold, 'the vehicle that disappeared is reported');
  assert.equal(sold.event, 'зникло');
  assert.equal(sold.year, 2022, 'named by the last year it was declared');

  const bought = changes.find((change) => change.title === 'Квартира');
  assert.ok(bought, 'the property that appeared is reported');
  assert.equal(bought.event, 'зʼявилося');
  assert.equal(bought.year, 2023);

  // The house was there throughout and is not a change.
  assert.equal(
    changes.some((change) => change.title === 'Житловий будинок'),
    false
  );
});

test('assets present in the earliest filing are not reported as newly appeared', () => {
  const profile = buildProfile([variant(2023), base]);
  const changes = assetChanges(profile);
  assert.equal(
    changes.some((change) => change.event === 'зʼявилося' && change.title === 'Житловий будинок'),
    false,
    'it was there from the first document we have'
  );
});

test('positions are listed per year so a move of job is visible', () => {
  const profile = buildProfile([
    variant(2023, (data) => {
      data.step_1.data.workPost = 'начальник відділу';
      data.step_1.data.workPlace = 'Інша установа';
    }),
    base,
  ]);

  assert.deepEqual(
    profile.positions.map((entry) => [entry.year, entry.post]),
    [
      [2023, 'начальник відділу'],
      [2022, 'тестова посада'],
    ]
  );
});

test('family and bank records are grouped by person and institution', () => {
  const profile = buildProfile([variant(2023), base]);

  assert.equal(profile.family.length, 4, 'four relatives, not eight rows');
  assert.ok(profile.family.every((member) => member.years.length === 2));
  assert.ok(profile.family.some((member) => member.detail === 'батько'));

  assert.ok(profile.banks.length > 0);
  assert.ok(profile.banks.every((bank) => bank.years.length === 2));
});

test('an empty or junk input produces an empty profile rather than throwing', () => {
  for (const input of [[], null, undefined, [null], ['nonsense']]) {
    const profile = buildProfile(input);
    assert.deepEqual(profile.years, []);
    assert.deepEqual(profile.property, []);
    assert.deepEqual(assetChanges(profile), []);
  }
});
