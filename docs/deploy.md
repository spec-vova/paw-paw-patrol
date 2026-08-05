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

Both platforms have been observed working and being refused, at different
hours, with the same code:

| When | Vercel | Worker |
| --- | --- | --- |
| first attempt | `challenge: true` | worked — nine declarations returned |
| later that day | worked | `challenge: true` |

So the block is not a property of the platform, as an earlier version of this
document claimed. It varies. **Configure both backends** — the app takes
whichever answers, one address per line in settings — instead of editing
settings whenever the edge network changes its mind.

**From the dashboard (no repository needed).**

1. dash.cloudflare.com → **Workers & Pages → Create → Worker**.
2. Replace the editor contents with `workers/registry.worker.js` → **Deploy**.
   The file is self-contained, so this works from a phone.
3. Put the resulting `https://<name>.<account>.workers.dev` into app settings.

**From the repository (Workers Builds).**

`wrangler.toml` declares the entry point, so `npx wrangler deploy` publishes the
backend only. Without it wrangler guesses "static site", tries to upload the
whole checkout as assets — `node_modules` included — and fails with
`Asset too large` on the 122 MiB `workerd` binary. If you hit that error, the
config is missing or not at the repository root.

The Worker serves no static files by design: the page lives on Vercel or GitHub
Pages, and only the registry calls go through Cloudflare.

## GitHub Pages

Serves the static app only; pair it with one of the backends above.

1. **Settings → Pages → Source: GitHub Actions**.
2. `.github/workflows/pages.yml` runs the tests and publishes on every push.
3. Open `https://<owner>.github.io/paw-paw-patrol/` and set the backend address
   in settings.

## Updating an installed app

The service worker is network-first: online, the page always comes from the
server, and the cache only serves an offline launch. An earlier cache-first
version pinned phones to a stale `index.html` after files moved into folders,
which showed up as a blank screen — hence the change.

If a device is ever stuck on a broken copy, the page itself offers a way out:
when the app has not booted a few seconds after load, a panel appears with
**«Очистити копію та перезапустити»**, which drops the caches, unregisters the
service worker and reloads. No digging through phone settings.

## Verifying

Open Settings → **«Перевірити зʼєднання»**. It probes every route separately
and marks the working one. Do this on the phone that will actually use the app:
the result depends on the local network and on what Cloudflare allows.

If the backend row says «Не вдалося зʼєднатися», check in this order:

1. **Scheme.** The address must be https (or a bare `/api/registry` path). The
   app now repairs `http://` automatically, but a stale saved value from an
   older build could still be wrong.
2. **Function deployed.** Open `<backend>?path=documents/list&query=test` in the
   browser directly — it should return JSON, not a 404 page.
3. **Cloudflare.** A `challenge: true` error means the request reached
   Cloudflare and was refused there — the backend works, the block is upstream.
   If the backend is a Worker, that is expected: move it to Vercel. On Vercel,
   check that the deployment is current, since the browser header profile is
   what makes the registry answer.

## Local

```bash
npm start   # http://127.0.0.1:8099/index.html
```

The static server does not run `api/registry.js`; to exercise the backend
locally use `vercel dev`, or point the app at a deployed backend.
