# API reference

## Upstream: Unified State Register of Declarations

Base URL `https://public-api.nazk.gov.ua/v2` (configurable in app settings).

| Endpoint | Purpose |
| --- | --- |
| `GET /documents/list?query=<full name>` | search declarations; also accepts `page`, `declaration_year`, `user_declarant_id` |
| `GET /documents/{id}` | one declaration in full |

### Parsing is deliberately defensive

The response schema differs between registry versions, so nothing relies on a
single key:

- the document array is looked up under `items`, `data`, `results`, `documents`,
  `docs`, `rows`, including one level of nesting (`{data: {items: [...]}}`);
- card fields are collected from several likely names (`pib`, `fullname`,
  `lastname`+`firstname`+`middlename`, `data.step_1.*`, …);
- the **Усі поля** tab walks whatever structure arrives recursively, so lists
  stored as objects with numeric keys (`{"1": {...}, "2": {...}}`) still render.

Section names (`step_1` … `step_16`) and field labels come from a best-effort
dictionary in `src/lib/declaration.js`; unknown keys are shown verbatim next to
their label. Whatever happens, the **JSON** tab shows the full response, so no
data is silently lost.

### Quirks confirmed against live responses

- **Every step wraps its payload once more:**
  `step_3: { data: { "1": {...}, "2": {...} }, isNotApplicable: 0 }`. Without
  unwrapping that level, a section with twenty properties renders as one entry
  holding hundreds of dotted paths.
- **Keys mix conventions** — `declaration_type` next to `cityType` next to
  `actual_workPost` — so labels are matched by exact key, not by pattern.
- **`<field>_extendedstatus` flags** shadow most fields and describe how a value
  was filled in. They are marked technical and hidden with the empty values.
- **Placeholders instead of values:** `[Не застосовується]` counts as empty,
  while `[Конфіденційна інформація]` does not — the latter states that data
  exists but is withheld, which is information in itself.
- **Names can sit at any depth**, so the result card falls back to a shallow
  key scan when the expected paths are absent. Exact top-level keys win first,
  since a deep scan could otherwise pick up a relative's name.

## The Cloudflare problem

The registry sits behind Cloudflare. A direct cross-origin request from a
browser gets `403 Forbidden` — an nginx page carrying a
`window.__CF$cv$params` script — and never reaches the API. This is not CORS
and not a bug in the client: Cloudflare drops the request because of the
foreign `Origin` header.

The fix is a server-side backend. A server request has no `Origin` and a plain
User-Agent, so it passes; the response is returned to the browser with
permissive CORS.

## Own backend contract

Two implementations, same behaviour, compared against each other in
`tests/backend.test.mjs`:

| File | Target |
| --- | --- |
| `api/registry.js` | Vercel serverless function |
| `workers/registry.worker.js` | Cloudflare Workers, self-contained (pasteable from a phone) |

**Request** — `GET <backend>?path=<endpoint>&<forwarded params>`

- `path` must match `documents/list` or `documents/{id}`; anything else is
  rejected with `400` before any network call.
- Only `query`, `page`, `declaration_year` and `user_declarant_id` are
  forwarded upstream. Without this allowlist the backend would be an open
  proxy to any address (SSRF).
- `REGISTRY_API_BASE` retargets the upstream host without code changes.

The backend attempts each request with more than one header profile (see
`UPSTREAM_HEADER_PROFILES`): a browser-like one first, a self-identifying one
second. Cloudflare refuses these for opposite reasons, so trying both costs one
request and occasionally wins. Only a block (`403`, `429`, or an interstitial)
triggers the retry — a `404` is a real answer. Neither profile can fake a TLS
fingerprint, so a determined block still holds.

**Response**

| Status | Meaning |
| --- | --- |
| `200` | upstream JSON, passed through unchanged |
| `400` | disallowed `path` |
| `405` | method other than GET |
| `502` | upstream error, Cloudflare interstitial (`challenge: true`), or unparseable body |
| `504` | upstream timed out (15 s) |

Errors are JSON:
`{ error, challenge?, upstreamStatus?, upstreamUrl?, tried? }`, where `tried`
lists the header profiles attempted and what each got back. The app uses
`challenge` to tell "Cloudflare refused the server too" apart from "no backend
deployed" and shows the right next step for each.
Messages about endpoint misuse are in English; upstream failures are in
Ukrainian because the app displays them as-is.

## Client request routing

The app tries routes in order and remembers the one that worked:

1. **own backend** — when its address is set in settings;
2. **direct** — works only where Cloudflare lets the browser through;
3. **CORS proxy** — off by default; when enabled, a third party sees the query.
   The default template points at allorigins; corsproxy.io now rejects anything
   outside localhost without an API key.

The backend address is normalised on save and on load: a missing scheme gets
`https://`, and `http://` is upgraded whenever the page itself is served over
https. Without that, the browser blocks the call as mixed content and `fetch`
fails with the same generic error as a dead network — a trap that costs an
evening to diagnose. A same-origin path such as `/api/registry` is accepted
as is and is the simplest option when the page and the backend share a host.

Settings contain a **«Перевірити зʼєднання»** button that probes each route
separately and reports which one is alive. Running it from the actual phone is
the only reliable check — external hosts are blocked from the build
environment, so the backend was verified against a fake registry (including a
Cloudflare 403 response) rather than the live API.

If every route fails, the Google buttons remain: the app appends the word
`декларація` to the name and can also restrict the search to
`site:public.nazk.gov.ua`.
