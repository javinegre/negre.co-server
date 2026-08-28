# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A thin Express router (`server.ts`) that mounts a set of independently-repo'd
sub-apps as middleware. Each directory under `apps/` and `apis/` is its own
separate git repo (own remote, own history), checked out as a sibling
directory in production. They are gitignored here on purpose — this repo
only ever tracks the glue that mounts them, plus the shared auth system.

```
/.well-known  -> well-known-folder/           (static, SSL cert validation)
/files        -> public-files/                (static)
/login        -> auth/public/                 (static passkey login page)
/api/auth/*   -> better-auth handler           (Better Auth, see auth/auth.ts)
/bicing/api/  -> apis/bicing-api               (Express, cached proxy to Barcelona Open Data)
/bicing/      -> apps/bicing-2023/dist         (static, React+Vite SPA)
/bicing-2021/ -> apps/bicing-2021              (Express, older React+CRA app)
/slides/      -> apps/slides                   (static)
/             -> apps/home                     (Express, catch-all: /, /des, /cv, 404 handler)
```

There is no submodule/lockfile pinning the sub-repos to specific commits —
each is deployed independently via its own `deploy.sh`. Since `apps/` and
`apis/` are gitignored, they generally won't exist in a fresh clone/worktree
of this repo; `server.ts` will fail to `require()` them until those sibling
repos are checked out.

## Commands

```
yarn dev          # tsx watch --env-file=.env server.ts (rebuilds login bundle first via predev)
yarn typecheck     # tsc --noEmit
yarn lint          # eslint server.ts auth/*.ts scripts/*.ts --max-warnings=0
yarn build:login   # esbuild auth/client-entry.ts -> auth/public/client.js (gitignored, must be built)
yarn invite <email> # generate a single-use 24h passkey invite link (scripts/invite.ts)
yarn auth:migrate  # run Better Auth's CLI migration against auth/auth.ts's config
yarn pm2:start     # build:login, then pm2 start ecosystem.config.js
yarn pm2:reload    # build:login, then pm2 reload ecosystem.config.js --update-env
yarn pm2:logs      # pm2 logs negre-co-server
```

There is no test suite (`yarn test` is a stub). CI (`.github/workflows/ci.yml`)
runs only `yarn lint` and `yarn typecheck` on push/PR to `master`.

`yarn dev` requires a local `.env` (copy `.env.example`) — Better Auth needs
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_RP_ID`, `AUTH_DB_PATH`.

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
  `pm2:start`/`pm2:reload` all do this automatically.
- **Gating a route**: use the `requireAuth` middleware
  (`auth/require-auth.ts`) — redirects to `/login?next=...` for HTML
  requests, 401 JSON otherwise. `req.session` is populated on success. See
  the `/concept-app/` route in `server.ts` for the pattern (a placeholder
  proving the SSO gate works end-to-end until that sub-app's repo exists).
- `trustedOrigins` in `auth/auth.ts` is the source of truth for which
  origins can use the auth client (production domains + the bicing app's
  local Vite dev server) — update it if a new app/origin needs auth.
