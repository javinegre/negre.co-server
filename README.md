# negre.co server

* [Architecture](#Architecture)
* [Ubuntu 18.04 Setup](#Ubuntu-18.04-Setup)
* [Nginx setup](#Nginx-setup)
* [Node.js](#Node.js)
* [Gzip](#Gzip)
* [Https](#Https)
* [Commands](#Commands)

---

## Architecture

This repo is a thin Express router (`server.ts`) that mounts a set of
independently-repo'd sub-apps as middleware. Each directory under `apps/`
and `apis/` is its own separate git repo (own remote, own history) checked
out as a sibling directory in production — they're gitignored here on
purpose, this repo only ever tracks the glue that mounts them:

```
/.well-known  -> well-known-folder/           (static, SSL cert validation)
/files        -> public-files/                (static)
/bicing/api/  -> apis/bicing-api               (Express, cached proxy to Barcelona Open Data)
/bicing/      -> apps/bicing-2023/dist         (static, React+Vite SPA)
/bicing-2026/ -> apps/bicing-2026/dist         (static, Svelte 5+Vite SPA)
/staging-bicing-2026/
              -> apps/staging-bicing-2026/dist (static, staging clone of the above; noindex)
/bicing-2021/ -> apps/bicing-2021              (Express, older React+CRA app)
/slides/      -> apps/slides                   (static)
/concept-app/ -> placeholder route             (auth-gated, proves SSO end to end)
/             -> apps/home                     (Express, catch-all: /, /des, /cv, 404 handler)
```

There is no submodule/lockfile pinning these sub-repos to specific commits —
each is deployed independently via its own `deploy.sh`.

**Process model:** production runs `tsx server.ts` (no build step; `tsx`
transpiles on-demand, including transitively into the mounted sub-apps'
`.ts` source) under PM2 in fork mode, 1 instance — not clustered, since
each mounted sub-app is a shared in-process module (notably
`apis/bicing-api`'s in-memory cache), and clustering would multiply
independent caches/upstream API calls instead of speeding anything up.

**Static assets:** nginx serves `/files`, `/.well-known`, `/bicing/`, and
`/bicing-2021/` directly (see `nginx/negre.co.conf`), bypassing Node
entirely for those paths — this is additive/reversible, Express's
`express.static` mounts stay in `server.ts` as a fallback. The `home` app
(`/`, `/des`, `/cv`, custom 404) stays proxied to Node since it's the
catch-all route with real routing logic.

**Staging:** `/staging-bicing-2026/` serves a second, hand-deployed clone of
the `bicing-2026` repo from `apps/staging-bicing-2026/dist`, built on the
droplet with `BASE_PATH=/staging-bicing-2026/ npm run build`. It stays on this
origin rather than a `stg.` subdomain because the app hardcodes
origin-relative auth paths (`/api/auth/get-session`, `/login`) and sends
`credentials: 'include'` — off negre.co it would silently render signed out
and the config API would need CORS. It is intentionally *not* given an nginx
alias: those blocks set `expires 7d`, which would serve a stale `index.html`
for a week after each rebuild. Public but `noindex`, and it shares
production's per-user config storage. See `CLAUDE.md` for the full rationale.

**Commands:**
```
yarn dev        # tsx watch server.ts
yarn typecheck  # tsc --noEmit
yarn lint       # eslint server.ts
yarn pm2:start  # pm2 start ecosystem.config.js
yarn pm2:reload # pm2 reload ecosystem.config.js --update-env
yarn pm2:logs   # pm2 logs negre-co-server
```

## Ubuntu 18.04 Setup
Reference: https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-18-04

### User creation
    # ssh root@[server_ip]
    # adduser [username]
    # usermod -aG sudo [username]

### Firewall setup
    # ufw allow OpenSSH
    # ufw enable

### Allow ssh login for [username]
    # rsync --archive --chown=[username]:[username] ~/.ssh /home/[username]

## Nginx setup

Reference: https://www.digitalocean.com/community/tutorials/how-to-install-nginx-on-ubuntu-18-04

### Installation
    $ sudo apt update
    $ sudo apt install nginx

### Adjusting the Firewall
    $ sudo ufw app list
    $ sudo ufw allow 'Nginx Full'
    $ sudo ufw status

### Checking your Web Server
    $ systemctl status nginx
    $ ip addr show eth0 | grep inet | awk '{ print $2; }' | sed 's/\/.*$//'

## Node.js

Reference: https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-18-04

### Installation (including npm)

    $ cd ~
    $ curl -sL https://deb.nodesource.com/setup_10.x -o nodesource_setup.sh
    $ sudo bash nodesource_setup.sh
    $ sudo apt install -y nodejs
    $ sudo apt install npm
    $ nodejs -v

### Yarn

    $ cd ~
    $ curl -sL https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
     echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
    $ sudo apt-get update && sudo apt-get install yarn
    $ yarn -v

### Forever

    $ sudo npm install -g forever

## Gzip

Reference: https://www.digitalocean.com/community/tutorials/how-to-add-the-gzip-module-to-nginx-on-ubuntu-16-04

    $ sudo vim /etc/nginx/nginx.conf
    (Apply changes to config files)
    $ sudo systemctl reload nginx

File changes:
* Uncomment lines on gzip section
* Add `gzip_min_length 256;` after `gzip_http_version`
* Add `application/vnd.ms-fontobject application/x-font-ttf font/opentype image/svg+xml image/x-icon`
 to `gzip_types`;

## Https

Certs are **Certbot-managed (Let's Encrypt)**, auto-renewing, installed via the
nginx plugin. The lineage lives at `/etc/letsencrypt/live/negre.co/` and covers
`negre.co`, `www.negre.co` and `javi.negre.co` — it is **not** a wildcard, so a
new subdomain needs adding explicitly:

    $ sudo certbot --nginx -d negre.co -d www.negre.co -d javi.negre.co -d <new> --expand

`/.well-known/` is deliberately proxied to Node rather than served by an nginx
`alias` — Certbot writes ACME HTTP-01 challenges under
`/.well-known/acme-challenge/` during renewal, and an alias there can shadow
them and silently break auto-renewal. See the header comment in
`nginx/negre.co.conf`.

<details>
<summary>Legacy: commercial CA (Namecheap/Sectigo) setup — no longer used</summary>

The site originally used a purchased cert with manual CSR generation and
HTTP-based domain validation; `well-known-folder/pki-validation/` is a leftover
from that flow.

* https://www.digitalocean.com/community/questions/how-do-i-generate-a-csr-key
* https://www.namecheap.com/support/knowledgebase/article.aspx/794/67/how-do-i-activate-an-ssl-certificate
* https://www.namecheap.com/support/knowledgebase/article.aspx/10025/68/how-to-complete-httpbased-validation
* https://www.digitalocean.com/community/tutorials/how-to-install-an-ssl-certificate-from-a-commercial-certificate-authority

</details>

More info:
* https://www.digitalocean.com/community/tutorials/how-to-set-up-nginx-with-http-2-support-on-ubuntu-18-04

## Commands

> The sections above document the original Ubuntu 18.04 / `forever` setup
> (kept for historical reference). Current process management is PM2 — see
> [Architecture](#Architecture) for the up-to-date commands.

### Nginx

    /* Configuration */
    $ sudo vim /etc/nginx/conf.d/[file.conf]

    $ sudo service nginx start
    $ sudo service nginx restart
    $ sudo service nginx stop
    $ sudo service nginx status
    $ sudo nginx -t

### Forever (legacy — superseded by PM2, see Architecture section)
    $ forever start -v -c ts-node server.ts
    $ forever restart server.ts
    $ forever stop server.ts
    $ forever list

### PM2
    $ pm2 start ecosystem.config.js
    $ pm2 reload ecosystem.config.js --update-env
    $ pm2 stop negre-co-server
    $ pm2 status
    $ pm2 logs negre-co-server -f
