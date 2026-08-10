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
/bicing-2021/ -> apps/bicing-2021              (Express, older React+CRA app)
/slides/      -> apps/slides                   (static)
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

Reference:

* https://www.digitalocean.com/community/questions/how-do-i-generate-a-csr-key
* https://www.namecheap.com/support/knowledgebase/article.aspx/794/67/how-do-i-activate-an-ssl-certificate
* https://www.namecheap.com/support/knowledgebase/article.aspx/10025/68/how-to-complete-httpbased-validation
* https://www.digitalocean.com/community/tutorials/how-to-install-an-ssl-certificate-from-a-commercial-certificate-authority

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
