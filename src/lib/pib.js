/**
 * Full-name (ПІБ) handling: normalisation, validation, Google query building.
 *
 * User-facing strings stay in Ukrainian — they are rendered in the app UI.
 */

/** Word appended to the full name in the Google query. */
export const GOOGLE_KEYWORD = 'декларація';

/** Public registry domain, used for site-scoped Google searches. */
export const REGISTRY_HOST = 'public.nazk.gov.ua';

const APOSTROPHES = /[’`´ʼ‘'']/g;
const DASHES = /[‐‑‒–—―]/g;
// Cyrillic and Latin letters, with apostrophes and hyphens allowed inside a word.
const NAME_TOKEN = /^[\p{L}][\p{L}'-]*$/u;

/**
 * Collapses input to a canonical single line: trims whitespace, drops commas
 * and trailing dots, unifies apostrophes and dashes.
 *
 * Line breaks collapse too, so the name may be typed across several lines.
 * @param {string} input
 * @returns {string}
 */
export function normalizePib(input) {
  return String(input ?? '')
    .replace(APOSTROPHES, 'ʼ') // U+02BC is the recommended Ukrainian apostrophe
    .replace(DASHES, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether the string looks like a full name (2–4 words of letters).
 * @param {string} input
 * @returns {{ok: boolean, value: string, tokens: string[], error?: string}}
 */
export function validatePib(input) {
  const value = normalizePib(input);
  if (!value) {
    return { ok: false, value, tokens: [], error: 'Введіть прізвище, імʼя та по батькові.' };
  }

  const tokens = value.split(' ');
  // Word count is checked first: for "Іван" it is a more precise hint than length.
  if (tokens.length < 2) {
    return { ok: false, value, tokens, error: 'Потрібно щонайменше прізвище та імʼя.' };
  }
  if (value.replace(/[\sʼ'-]/g, '').length < 5) {
    return { ok: false, value, tokens, error: 'Замало символів — введіть ПІБ повністю.' };
  }
  if (tokens.length > 4) {
    return { ok: false, value, tokens, error: 'Забагато слів — очікується прізвище, імʼя та по батькові.' };
  }

  const bad = tokens.find((token) => !NAME_TOKEN.test(token));
  if (bad) {
    return { ok: false, value, tokens, error: `«${bad}» не схоже на частину імені.` };
  }
  return { ok: true, value, tokens };
}

/** Capitalises every word, including both halves of hyphenated surnames. */
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

/**
 * Builds the search query: quoted full name plus the word "декларація".
 *
 * @param {string} pib
 * @param {{site?: string, year?: number|string}} [options]
 *   site — restrict the search to a domain;
 *   year — pushes the most recent filing to the top, which is what a reader
 *   almost always wants; without it Google favours whichever year has the most
 *   links, usually an old one.
 */
export function buildGoogleQuery(pib, options = {}) {
  const parts = [`"${normalizePib(pib)}"`, GOOGLE_KEYWORD];
  if (options.year) parts.push(String(options.year));
  if (options.site) parts.push(`site:${options.site}`);
  return parts.join(' ');
}

/**
 * The most recent reporting year that can already have a filing.
 *
 * A declaration for year N is filed during N+1, so in 2026 the freshest
 * document on record covers 2025. Searching for the calendar year returns
 * nothing useful — it is a year nobody has declared for yet.
 *
 * @param {Date} [now] injected in tests; never read implicitly
 */
export function latestReportingYear(now = new Date()) {
  return now.getFullYear() - 1;
}

/** Full Google search URL for the given name. */
export function buildGoogleUrl(pib, options = {}) {
  return `https://www.google.com/search?q=${encodeURIComponent(buildGoogleQuery(pib, options))}`;
}
