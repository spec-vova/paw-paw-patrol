import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyProxy,
  buildDocumentUrl,
  buildGoogleQuery,
  buildGoogleUrl,
  buildSearchUrl,
  countFields,
  extractList,
  flattenDocument,
  formatValue,
  isEmptyValue,
  labelFor,
  normalizePib,
  summarizeDocument,
  titleCasePib,
  unwrapDocument,
  validatePib,
} from '../src/lib.js';

test('normalizePib склеює багаторядкове введення в один рядок', () => {
  assert.equal(normalizePib('Іваненко\nІван\nІванович'), 'Іваненко Іван Іванович');
  assert.equal(normalizePib('  Іваненко \r\n  Іван\t Іванович  '), 'Іваненко Іван Іванович');
  assert.equal(normalizePib('Іваненко, Іван; Іванович'), 'Іваненко Іван Іванович');
});

test('normalizePib уніфікує апострофи та дефіси', () => {
  assert.equal(normalizePib("Дʼяченко Мар'яна"), 'Дʼяченко Марʼяна');
  assert.equal(normalizePib('Дʼяченко Мар’яна'), 'Дʼяченко Марʼяна');
  assert.equal(normalizePib('Нечуй—Левицький Іван'), 'Нечуй-Левицький Іван');
});

test('normalizePib прибирає крапки після ініціалів', () => {
  assert.equal(normalizePib('Іваненко І. І.'), 'Іваненко І І');
});

test('validatePib приймає коректні ПІБ', () => {
  const ok = validatePib('Іваненко\nІван\nІванович');
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'Іваненко Іван Іванович');
  assert.equal(ok.tokens.length, 3);

  assert.equal(validatePib('Нечуй-Левицький Іван Семенович').ok, true);
  assert.equal(validatePib("Мар'яна Дʼяченко").ok, true);
  assert.equal(validatePib('Petrenko Ivan').ok, true);
});

test('validatePib відхиляє некоректне введення', () => {
  assert.equal(validatePib('').ok, false);
  assert.equal(validatePib('Іван').ok, false, 'одного слова замало');
  assert.match(validatePib('Іван').error, /прізвище/, 'підказка про кількість слів, а не про довжину');
  assert.match(validatePib('Ів Ів').error, /Замало символів/);
  assert.equal(validatePib('Іваненко Іван Іванович Петрович Сидорович').ok, false, 'забагато слів');
  assert.equal(validatePib('Іваненко 12345').ok, false, 'цифри не є частиною імені');
  assert.ok(validatePib('Іваненко 12345').error.includes('12345'));
});

test('titleCasePib нормалізує регістр, зокрема у складених прізвищах', () => {
  assert.equal(titleCasePib('іВАНЕНКО іван іванович'), 'Іваненко Іван Іванович');
  assert.equal(titleCasePib('нечуй-левицький іван'), 'Нечуй-Левицький Іван');
});

test('buildGoogleQuery додає слово «декларація» до ПІБ', () => {
  assert.equal(buildGoogleQuery('Іваненко Іван Іванович'), '"Іваненко Іван Іванович" декларація');
  assert.equal(
    buildGoogleQuery('Іваненко\nІван', { site: 'public.nazk.gov.ua' }),
    '"Іваненко Іван" декларація site:public.nazk.gov.ua'
  );
});

test('buildGoogleUrl кодує запит', () => {
  const url = new URL(buildGoogleUrl('Іваненко Іван'));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/search');
  assert.equal(url.searchParams.get('q'), '"Іваненко Іван" декларація');
});

test('buildSearchUrl формує запит до реєстру', () => {
  const url = new URL(buildSearchUrl('Іваненко\nІван Іванович'));
  assert.equal(url.origin, 'https://public-api.nazk.gov.ua');
  assert.equal(url.pathname, '/v2/documents/list');
  assert.equal(url.searchParams.get('query'), 'Іваненко Іван Іванович');
  assert.equal(url.searchParams.get('page'), null, 'перша сторінка не потребує параметра');

  const second = new URL(buildSearchUrl('Іваненко Іван', { page: 3, declarationYear: 2023 }));
  assert.equal(second.searchParams.get('page'), '3');
  assert.equal(second.searchParams.get('declaration_year'), '2023');
});

test('buildSearchUrl поважає власну адресу API', () => {
  const url = buildSearchUrl('Іваненко Іван', { base: 'https://example.test/api' });
  assert.ok(url.startsWith('https://example.test/api/documents/list?'));
});

test('buildDocumentUrl екранує ідентифікатор', () => {
  assert.equal(
    buildDocumentUrl('82e5aea2-2935-4902-bf2b-765e7c9db079'),
    'https://public-api.nazk.gov.ua/v2/documents/82e5aea2-2935-4902-bf2b-765e7c9db079'
  );
  assert.ok(buildDocumentUrl('a/b').endsWith('/documents/a%2Fb'));
});

test('applyProxy підставляє URL у шаблон', () => {
  const target = 'https://api.test/x?y=1';
  assert.equal(applyProxy(target, ''), target, 'порожній шаблон нічого не змінює');
  assert.equal(applyProxy(target, 'https://p.test/?{url}'), `https://p.test/?${encodeURIComponent(target)}`);
  assert.equal(applyProxy(target, 'https://p.test/raw?url='), `https://p.test/raw?url=${encodeURIComponent(target)}`);
});

test('extractList знаходить масив у різних формах відповіді', () => {
  assert.deepEqual(extractList([{ id: 1 }]).items, [{ id: 1 }]);
  assert.deepEqual(extractList({ items: [{ id: 2 }] }).items, [{ id: 2 }]);
  assert.deepEqual(extractList({ data: [{ id: 3 }] }).items, [{ id: 3 }]);
  assert.deepEqual(extractList({ data: { items: [{ id: 4 }] } }).items, [{ id: 4 }]);
  assert.deepEqual(extractList({ nothing: true }).items, []);
  assert.deepEqual(extractList(null).items, []);
});

test('extractList дістає лічильники з різних місць', () => {
  assert.equal(extractList({ items: [], total: 42 }).total, 42);
  assert.equal(extractList({ items: [], meta: { total_count: '7', page: 2 } }).total, 7);
  assert.equal(extractList({ items: [], meta: { total_count: '7', page: 2 } }).page, 2);
  assert.equal(extractList({ items: [] }).total, null);
});

test('summarizeDocument збирає картку з різних наборів ключів', () => {
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

test('unwrapDocument дістає корінь із вкладених обгорток', () => {
  const steps = { step_1: { lastname: 'І' } };
  assert.deepEqual(unwrapDocument({ data: steps }), steps);
  assert.deepEqual(unwrapDocument({ data: { data: steps } }), steps);
  assert.deepEqual(unwrapDocument(steps), steps);
  assert.equal(unwrapDocument(null), null);
});

test('flattenDocument розкладає розділи в порядку номерів кроків', () => {
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
    sections.map((s) => s.key),
    ['step_1', 'step_3', 'step_11']
  );
  assert.equal(sections[0].title, 'Загальна інформація про субʼєкта декларування');
  assert.equal(sections[1].entries.length, 2, 'числові ключі стають окремими записами');
  assert.equal(sections[1].entries[0].rows[0].label, 'Тип обʼєкта');
  assert.equal(sections[1].entries[0].rows[0].text, 'Квартира');
});

test('flattenDocument розгортає вкладені обʼєкти в шляхи', () => {
  const sections = flattenDocument({ data: { step_2: { rights: { 1: { ownershipType: 'Власність' } } } } });
  const rows = sections[0].entries[0].rows;
  const row = rows.find((r) => r.key === 'ownershipType');
  assert.ok(row, 'вкладене поле знайдено');
  assert.equal(row.path, 'rights.1.ownershipType');
});

test('flattenDocument відкидає порожні розділи та не падає на сміттєвих даних', () => {
  assert.deepEqual(flattenDocument(null), []);
  assert.deepEqual(flattenDocument({ data: {} }), []);
  assert.deepEqual(flattenDocument('рядок'), []);
});

test('flattenDocument не зациклюється на глибокому вкладенні', () => {
  let deep = { value: 'дно' };
  for (let i = 0; i < 30; i += 1) deep = { nested: deep };
  const sections = flattenDocument({ data: { step_1: deep } });
  assert.ok(sections[0].entries[0].rows.length > 0);
});

test('countFields рахує лише заповнені поля', () => {
  const sections = flattenDocument({
    data: { step_1: { lastname: 'Іваненко', firstname: '', middlename: null } },
  });
  assert.equal(countFields(sections), 1);
});

test('labelFor перекладає відомі ключі й розшиває невідомі', () => {
  assert.equal(labelFor('lastname'), 'Прізвище');
  assert.equal(labelFor('sizeIncome'), 'Розмір доходу');
  assert.equal(labelFor('someUnknownField'), 'Some Unknown Field');
  assert.equal(labelFor('another_key'), 'Another key');
});

test('formatValue форматує булеві значення та великі суми', () => {
  assert.equal(formatValue('publicPerson', true), 'так');
  assert.equal(formatValue('publicPerson', false), 'ні');
  assert.equal(formatValue('totalArea', '75'), '75');
  assert.equal(formatValue('sizeIncome', '250000').replace(/\s/g, ' '), '250 000');
  assert.equal(formatValue('sizeIncome', '250'), '250', 'малі числа не форматуються');
  assert.equal(formatValue('lastname', null), '');
});

test('isEmptyValue розпізнає порожні значення', () => {
  assert.equal(isEmptyValue(null), true);
  assert.equal(isEmptyValue(''), true);
  assert.equal(isEmptyValue('   '), true);
  assert.equal(isEmptyValue('[]'), true);
  assert.equal(isEmptyValue(0), false);
  assert.equal(isEmptyValue('Іваненко'), false);
});
