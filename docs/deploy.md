# Deployment

The app is static, but it needs a backend to reach the registry — see the
Cloudflare section in [api.md](api.md). Pick one of the options below.

## Vercel — recommended

Hosts the page and the backend on one origin, so CORS never enters the picture.

1. vercel.com → **Add New → Project** → import `spec-vova/paw-paw-patrol`.
2. Leave the settings alone (`vercel.json` already describes the static files
   and the function) → **Deploy**.
3. Open the Vercel URL on the phone, then Settings → **Адреса власного
   бекенда** → `/api/registry`.

The relative path works because the page and the function share an origin.

### Node version

`package.json` declares `engines.node: "22.x"`, which is what Vercel uses for
the function runtime — it overrides the dashboard setting, so a project created
with Node 24.x still builds. `vercel.json` deliberately does not pin a
`@vercel/node` version: a pinned builder eventually stops matching the Node
version the project is configured with, and the build fails with
`Found invalid Node.js Version`. If that error appears anyway, set **Project
Settings → Node.js Version → 22.x**.

## Cloudflare Workers

Useful when the page stays on GitHub Pages.

1. dash.cloudflare.com → **Workers & Pages → Create → Worker**.
2. Replace the editor contents with `workers/registry.worker.js` → **Deploy**.
   The file is self-contained, so this works from a phone.
3. Put the resulting `https://<name>.<account>.workers.dev` into app settings.

## GitHub Pages

Serves the static app only; pair it with one of the backends above.

1. **Settings → Pages → Source: GitHub Actions**.
2. `.github/workflows/pages.yml` runs the tests and publishes on every push.
3. Open `https://<owner>.github.io/paw-paw-patrol/` and set the backend address
   in settings.

## Verifying

Open Settings → **«Перевірити зʼєднання»**. It probes every route separately
and marks the working one. Do this on the phone that will actually use the app:
the result depends on the local network and on what Cloudflare allows.

## Local

```bash
npm start   # http://127.0.0.1:8099/index.html
```

The static server does not run `api/registry.js`; to exercise the backend
locally use `vercel dev`, or point the app at a deployed backend.
