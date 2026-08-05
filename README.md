# paw-paw-patrol

A phone-sized PWA that looks up Ukrainian public-official declarations by full
name. Type the name on one line or across three, tap the button, and the app
searches the [Unified State Register of Declarations](https://public.nazk.gov.ua)
and shows the whole document — raw JSON plus every field grouped by section.
A separate button switches the interface into a playful "paw" skin.

Installs on the home screen from Chrome — no APK, no sideloading.
The interface is in Ukrainian; the codebase is in English.

## Install on a phone

1. Deploy (see [docs/deploy.md](docs/deploy.md)) — Vercel is recommended,
   because the app needs its own backend to reach the registry.
2. Open the deployed URL in Chrome.
3. Menu (⋮) → **Add to Home screen**.

## Develop

```bash
npm start    # serve at http://127.0.0.1:8099/index.html
npm test     # 68 tests, no dependencies
npm run test:e2e  # 23 browser scenarios (needs Playwright + `npm start`)
npm run icons  # regenerate PWA icons (needs Python + Pillow)
```

## Layout

```
index.html                  app shell
sw.js                       service worker (caches the shell, never the data)
manifest.webmanifest        PWA manifest
src/app.js                  DOM, network, state
src/styles.css              default theme and the paw skin
src/lib/pib.js              name normalisation, Google query
src/lib/registry.js         endpoints, routing, SSRF guard
src/lib/declaration.js      response parsing, document flattening
api/registry.js             backend for Vercel
workers/registry.worker.js  the same backend for Cloudflare Workers
wrangler.toml               Workers deployment (entry point, not a static site)
tests/                      node --test suites
tests/e2e/browser.mjs       browser walkthrough (needs Playwright)
tests/fixtures/             a real declaration, names replaced
docs/                       API reference and deployment guide
tools/make_icons.py         icon generator
```

## Docs

- [docs/api.md](docs/api.md) — registry endpoints, the Cloudflare problem, backend contract
- [docs/deploy.md](docs/deploy.md) — Vercel, Cloudflare Workers, GitHub Pages

## Data

Everything comes from the open NAZK API; these are public records. There is no
server of ours: search history and settings live in the phone's `localStorage`.
