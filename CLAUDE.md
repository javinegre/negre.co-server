# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A thin Express router (`server.ts`) that mounts a set of independently-repo'd
sub-apps as middleware. Each directory under `apps/` and `apis/` is its own
separate git repo (own remote, own history), checked out as a sibling
directory in production. They are gitignored here on purpose — this repo
tracks the glue that mounts them plus the cross-cutting pieces that cannot
live in any one sub-app: the shared auth system, and the backoffice that
administers the lot.

```
/.well-known  -> well-known-folder/           (static, SSL cert validation)
/files        -> public-files/                (static)
/login        -> auth/public/                 (static passkey login page)
/api/auth/*   -> better-auth handler           (Better Auth, see auth/auth.ts)
/bicing/api/  -> apis/bicing-api               (Express, cached proxy to Barcelona Open Data)
/bicing/      -> apps/bicing-2023/dist         (static, React+Vite SPA)
/bicing-2026/ -> apps/bicing-2026/dist         (static, Svelte 5+Vite SPA)
/staging-bicing-2026/
              -> apps/staging-bicing-2026/dist (static, staging clone of the above; noindex)
/bicing-2021/ -> apps/bicing-2021              (Express, older React+CRA app)
/slides/      -> apps/slides                   (static)
/concept-app/ -> placeholder route             (auth-gated, proves SSO end to end)
/backoffice/  -> backoffice/public/            (admin-only, ADMIN_EMAILS allowlist)
/             -> apps/home                     (Express, catch-all: /, /des, /cv, 404 handler)
```

There is no submodule/lockfile pinning the sub-repos to specific commits —
each is deployed independently via its own `deploy.sh`. Since `apps/` and
`apis/` are gitignored, they generally won't exist in a fresh clone/worktree
of this repo; `server.ts` will fail to `require()` them until those sibling
repos are checked out.

## Commands

```
yarn dev          # tsx watch --env-file=.env server.ts (builds both bundles first via predev)
yarn typecheck     # tsc --noEmit, then again against tsconfig.client.json
yarn lint          # eslint server.ts auth/*.ts backoffice/*.ts scripts/*.ts --max-warnings=0
yarn build         # both client bundles: build:login + build:backoffice
yarn build:login   # esbuild auth/client-entry.ts -> auth/public/client.js (gitignored)
yarn build:backoffice # esbuild backoffice/client-entry.ts -> backoffice/public/client.js (gitignored)
yarn invite <email> # generate a single-use 24h passkey invite link (scripts/invite.ts)
yarn auth:migrate  # run Better Auth's CLI migration against auth/auth.ts's config
yarn pm2:start     # build, then pm2 start ecosystem.config.js
yarn pm2:reload    # build, then pm2 reload ecosystem.config.js --update-env
yarn pm2:logs      # pm2 logs negre-co-server
```

There is no test suite (`yarn test` is a stub). CI (`.github/workflows/ci.yml`)
runs only `yarn lint` and `yarn typecheck` on push/PR to `master`.

`yarn typecheck` runs **two** tsc projects. `tsconfig.json` covers the server
(`server.ts`, `auth/`, `backoffice/`, `scripts/`) and deliberately excludes
`**/client-entry.ts`; `tsconfig.client.json` covers exactly those browser
entries and is the only one with the DOM lib. Keeping DOM out of the server
project is the point — with it there, `server.ts` could reference `document`
and still typecheck. A new top-level directory of `.ts` files needs adding to
`tsconfig.json`'s `include` **and** the `lint` glob, or CI silently skips it.

`yarn dev` requires a local `.env` (copy `.env.example`) — Better Auth needs
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_RP_ID`, `AUTH_DB_PATH`, and the
backoffice needs `ADMIN_EMAILS` (unset means nobody gets in, including you).

## Process model

Production runs `tsx server.ts` directly under PM2 (`ecosystem.config.js`) —
no build step for the router itself; `tsx` transpiles on-demand, including
transitively into the mounted sub-apps' `.ts` source. It runs in fork mode,
1 instance, not clustered: each mounted sub-app is a shared in-process
module (notably `apis/bicing-api`'s in-memory cache), and clustering would
multiply independent caches/upstream API calls instead of speeding anything
up. Secrets (`BETTER_AUTH_SECRET`, etc.) live only in the droplet's own
`.env`, loaded via PM2's `interpreter_args: '--env-file=.env'` — never
hardcoded or committed.

**Static assets:** nginx serves `/files`, `/.well-known`, `/bicing/`, and
`/bicing-2021/` directly (see `nginx/negre.co.conf`), bypassing Node for
those paths. This is additive/reversible — the `express.static` mounts stay
in `server.ts` as a fallback. The `home` app (`/`, `/des`, `/cv`, custom 404)
stays proxied to Node since it's the catch-all route with real routing logic.

## Staging (`/staging-bicing-2026/`)

A second, hand-deployed clone of the `bicing-2026` repo lives at
`apps/staging-bicing-2026` on the droplet and is mounted alongside the real
one. Built there directly:

```
BASE_PATH=/staging-bicing-2026/ npm run build
```

Two deliberate choices:

- **It lives on this origin, not a `stg.` subdomain.** The app resolves
  `/api/auth/get-session`, `/api/auth/sign-out` and `/login` as
  origin-relative literals with no env override, and its API client uses
  `credentials: 'include'`. Off negre.co the session fetch 404s — and the
  client swallows that, rendering permanently signed out — while the config
  API would need CORS with credentials. On-origin, the session cookie, the
  passkey RP and the referrer-restricted Maps key all keep working untouched.
  A subdomain would also imply isolation it wouldn't deliver: same droplet,
  same PM2 process, same `bicing-api`, same SQLite files.
- **It gets no nginx alias**, unlike the static apps above. Those blocks set
  `expires 7d`, which would keep serving a stale `index.html` for a week after
  each rebuild. Served by Node it revalidates via ETag, so a rebuild is live
  immediately with no PM2 reload and no `nginx -t`.

It shares production's per-user config document — the same better-auth user id
hits the same row in `data/bicing.db`, so a staging bug can scribble on real
settings. Note also that `PUT /bicing/api/v2/config` rejects unknown keys, so
testing a **new** setting still needs the `bicing-api` change deployed first;
staging the client does not stage the contract.

## Auth (Better Auth + passkeys)

`auth/auth.ts` configures a single shared Better Auth instance (SQLite via
`better-sqlite3`, `@better-auth/passkey` plugin) used for SSO across every
mounted app under negre.co. Key points:

- **Mount order matters**: `app.all('/api/auth/*', toNodeHandler(auth))` is
  mounted in `server.ts` *before* any `express.json()`. Better Auth reads
  the raw request body itself; a JSON parser ahead of it silently breaks
  the client (stuck on "pending", no error). There is currently no
  `express.json()` in this router at all — if one is ever added, it must go
  only on routes mounted after the auth handler.
- **Invite-only signup, no passwords**: there's no self-serve signup. An
  admin runs `yarn invite <email>` to mint a single-use, 24h token; passkey
  *registration itself* doubles as account creation via the `resolveUser`
  callback in `auth/auth.ts` (validates the invite token, creates the user,
  consumes the token so replay fails).
- **Login page**: `auth/public/index.html` + `auth/public/client.js`. The
  client bundle is built locally with esbuild from `auth/client-entry.ts`
  (`yarn build:login`) specifically so the login page never loads auth code
  from a third-party CDN. `auth/public/client.js` is gitignored and must be
  rebuilt after any change to `auth/client-entry.ts` — `predev`/`prestart`/
  `pm2:start`/`pm2:reload` all run `yarn build`, which covers this bundle and
  the backoffice's. Point any of them back at `build:login` and a reload ships
  a missing backoffice bundle.
- **Gating a route**: use the `requireAuth` middleware
  (`auth/require-auth.ts`) — redirects to `/login?next=...` for HTML
  requests, 401 JSON otherwise. `req.session` is populated on success. See
  the `/concept-app/` route in `server.ts` for the pattern (a placeholder
  proving the SSO gate works end-to-end until that sub-app's repo exists).
- `trustedOrigins` in `auth/auth.ts` is the source of truth for which
  origins can use the auth client (production domains + the bicing app's
  local Vite dev server) — update it if a new app/origin needs auth.

## Per-user Bicing settings

`apis/bicing-api` exposes a second, auth-gated entry point (`config-api.ts`,
separate from its public `index.ts`) mounted here as:

```ts
app.use('/bicing/api/v2/config', requireAuth, BicingConfigApi);
```

It must stay **above** the general `app.use('/bicing/api/', BicingApi)` so the
gate wraps only those routes. `requireAuth` lives here rather than in the API's
repo, which keeps that repo free of any dependency on the auth instance — the
router only reads `req.session.user.id`, and returns 401 if it is absent.

That router mounts its own `express.json()` internally. That is the *only*
JSON parser in this process and it sits below the better-auth handler, as the
mount-order rule above requires. Do not hoist it.

Storage is `data/bicing.db` (SQLite via `better-sqlite3`, `BICING_DB_PATH`
override), created on first use beside `data/auth.db`. One JSON document per
user; see `apis/bicing-api/README.md` for the schema and the reasoning.

`apps/bicing-2026` is the Svelte 5 client for it. Like the other sub-apps it is
its own repo and gitignored here.

## Backoffice (`/backoffice`)

An admin area for the things that otherwise need an SSH session: who has an
account, what is deployed where, per-user app state, and the PM2 process.

It lives in this repo rather than as a sibling app under `apps/` for three
reasons. It needs the auth instance, `data/auth.db` and `req.session`, and
every sub-app repo is deliberately auth-ignorant (see below). Its subject
matter *is* this repo — the mount table, the PM2 process, the shared SQLite
files. And `server.ts` `require()`s sub-apps at module load, so a bad deploy of
any one of them takes the whole router down; the tool you reach for when things
are broken should not be one more `require()` that can throw at startup.

```ts
app.use('/backoffice', noIndex, requireAuth, requireAdmin, backoffice);
```

Mounted above the `app.use('/', HomeApp)` catch-all and below the better-auth
handler. No nginx alias — the catch-all `location /` proxy block covers it, and
being Node-served means ETag revalidation, so a rebuilt bundle is live without a
PM2 reload (same reasoning as the staging app above).

- **The gate is `auth/require-admin.ts`**, an `ADMIN_EMAILS` allowlist
  (comma-separated, trimmed, lowercased, parsed once at import). It must run
  *after* `requireAuth`, which is what populates `req.session`. Denial is a
  **403 and never a redirect**: a session already exists by then, so `/login`
  would loop. Unset `ADMIN_EMAILS` denies everyone and warns at startup — fail
  closed.
- **The two denied pages carry inline `<style>` on purpose.** They are served
  from behind the gate that just refused the request, so a `<link>` to
  `backoffice/public/style.css` would 403 and render them unstyled.
- **`backoffice/api.ts` mounts the second `express.json()` in this process.**
  It sits below the better-auth handler, as the mount-order rule above
  requires. Do not hoist it.
- **`requireSameOrigin` guards every mutating route.** The API is
  cookie-authenticated and better-auth's `trustedOrigins` check covers
  `/api/auth/*` only — without this, any page an admin visits could POST here
  with their session attached. It reads the same `trustedOrigins` list, now
  exported from `auth/auth.ts` alongside `baseURL`.
- **`backoffice/registry.ts` is the single source of truth** for the mounted
  apps, kept in step with `server.ts` by hand. Client input is matched against
  its keys and never used to build a path: `../../etc` fails the lookup before
  anything touches the filesystem.

### Shell safety (`backoffice/ops.ts`)

The only module that spawns anything. The rules are not optional:

- **`execFile`/`spawn` with a literal argv, never `exec` and never a shell
  string.** Nothing gets word-split or glob-expanded.
- The only variable is a directory from `registry.ts`, a server-side constant.
  No path, branch or flag from a client reaches a process.
- Every spawn has a timeout and an output cap, and the resolved directory is
  asserted to sit inside the repo.
- **`git -C` walks up to the nearest enclosing repository.** A sub-app
  directory that is not its own checkout would otherwise report *this* repo's
  branch and sha, which on a status screen reads as an app sitting at the
  router's commit. Each directory's `--show-toplevel` is compared against
  itself before any ref is trusted.

### Deploys are jobs, not requests

`nginx/negre.co.conf` sets no `proxy_read_timeout`, so nginx cuts a proxied
request at its 60s default. A deploy runs `npm ci && npm run build` and takes
minutes — a synchronous endpoint would return a 504 while the deploy carried on
invisibly. So `POST /api/deploy/:key` starts a job and returns an id, and the
client polls `GET /api/deploy/:id`. Jobs are in memory: a reload replaces this
process, and the deploy script's own output is the durable record.

`deploy.sh` is run directly rather than through `sh`, so its shebang picks the
interpreter — which means it has to be executable. Present-and-runnable,
present-but-not-executable, and absent are three different states, and only the
first is offered a Deploy button.

### Reload restarts the process serving the request

`pm2` is probed **before** the 202: responding "accepted" and only then finding
pm2 missing would leave the page waiting on a restart that was never going to
happen. After responding, the spawn is detached with its streams closed, since
pm2 replaces this process and anything still buffered never arrives. The client
confirms via `/backoffice/api/health`, ignoring a 200 that comes back too
quickly to be the new process — the old one answers right up until pm2 kills it.

### App data is read-only, deliberately

`PUT /bicing/api/v2/config` keys off `req.session.user.id`, so it can only ever
write the *signed-in* user's row — there is no admin write in that API. Writing
to `data/bicing.db` directly would skip the validation that endpoint enforces
(unknown-key rejection, coordinate and zoom ranges, the `savedStationIds` cap),
which is the corruption the validation exists to prevent. Editing another user's
config wants an endpoint in `bicing-api`, not a shortcut here.

`backoffice/bicing.ts` opens that database **read-only** and never creates it —
`bicing-api` creates the file on first save, not on import, so a machine that
only serves station feeds never grows one. The schema is owned by that repo; see
its README and `src/v2/config/config.db.ts`.

### Audit log

Every mutating action logs actor, verb, target and outcome to stdout, so it
lands in `pm2 logs` beside everything else. It is the only record of who
triggered what.
