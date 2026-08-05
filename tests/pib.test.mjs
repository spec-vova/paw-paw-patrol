import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildGoogleQuery,
  buildGoogleUrl,
  latestReportingYear,
  normalizePib,
  titleCasePib,
  validatePib,
} from '../src/lib/pib.js';

test('normalizePib collapses multi-line input into one line', () => {
  assert.equal(normalizePib('Іваненко\nІван\nІванович'), 'Іваненко Іван Іванович');
  assert.equal(normalizePib('  Іваненко \r\n  Іван\t Іванович  '), 'Іваненко Іван Іванович');
  assert.equal(normalizePib('Іваненко, Іван; Іванович'), 'Іваненко Іван Іванович');
});

test('normalizePib unifies apostrophes and dashes', () => {
  assert.equal(normalizePib("Дʼяченко Мар'яна"), 'Дʼяченко Марʼяна');
  assert.equal(normalizePib('Дʼяченко Мар’яна'), 'Дʼяченко Марʼяна');
  assert.equal(normalizePib('Нечуй—Левицький Іван'), 'Нечуй-Левицький Іван');
});

test('normalizePib drops dots after initials', () => {
  assert.equal(normalizePib('Іваненко І. І.'), 'Іваненко І І');
});

test('validatePib accepts well-formed names', () => {
  const ok = validatePib('Іваненко\nІван\nІванович');
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'Іваненко Іван Іванович');
  assert.equal(ok.tokens.length, 3);

  assert.equal(validatePib('Нечуй-Левицький Іван Семенович').ok, true);
  assert.equal(validatePib("Мар'яна Дʼяченко").ok, true);
  assert.equal(validatePib('Petrenko Ivan').ok, true);
});

test('validatePib rejects malformed input with a precise hint', () => {
  assert.equal(validatePib('').ok, false);
  assert.equal(validatePib('Іван').ok, false, 'one word is not enough');
  assert.match(validatePib('Іван').error, /прізвище/, 'hints about word count, not length');
  assert.match(validatePib('Ів Ів').error, /Замало символів/);
  assert.equal(validatePib('Іваненко Іван Іванович Петрович Сидорович').ok, false, 'too many words');
  assert.equal(validatePib('Іваненко 12345').ok, false, 'digits are not part of a name');
  assert.ok(validatePib('Іваненко 12345').error.includes('12345'));
});

test('titleCasePib fixes casing, including hyphenated surnames', () => {
  assert.equal(titleCasePib('іВАНЕНКО іван іванович'), 'Іваненко Іван Іванович');
  assert.equal(titleCasePib('нечуй-левицький іван'), 'Нечуй-Левицький Іван');
});

test('buildGoogleQuery appends the word "декларація" to the name', () => {
  assert.equal(buildGoogleQuery('Іваненко Іван Іванович'), '"Іваненко Іван Іванович" декларація');
  assert.equal(
    buildGoogleQuery('Іваненко\nІван', { site: 'public.nazk.gov.ua' }),
    '"Іваненко Іван" декларація site:public.nazk.gov.ua'
  );
});

test('buildGoogleQuery can pin the query to a year', () => {
  // Without a year Google ranks by link count, which favours an old filing.
  assert.equal(buildGoogleQuery('Іваненко Іван', { year: 2025 }), '"Іваненко Іван" декларація 2025');
  assert.equal(
    buildGoogleQuery('Іваненко Іван', { year: 2025, site: 'public.nazk.gov.ua' }),
    '"Іваненко Іван" декларація 2025 site:public.nazk.gov.ua'
  );
  assert.equal(buildGoogleQuery('Іваненко Іван', { year: 0 }), '"Іваненко Іван" декларація', 'no year, no noise');
});

test('the search year is the last one that can already have a filing', () => {
  // A declaration for 2026 is filed in 2027, so in 2026 the answer is 2025 —
  // searching for the calendar year finds a year nobody has declared for.
  assert.equal(latestReportingYear(new Date('2026-08-05T00:00:00Z')), 2025);
  assert.equal(latestReportingYear(new Date('2026-01-02T00:00:00Z')), 2025);
  assert.equal(latestReportingYear(new Date('2027-03-01T00:00:00Z')), 2026);
});

test('buildGoogleUrl encodes the query', () => {
  const url = new URL(buildGoogleUrl('Іваненко Іван'));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/search');
  assert.equal(url.searchParams.get('q'), '"Іваненко Іван" декларація');
});
