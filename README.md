# negre.co server

* [Ubuntu 18.04 Setup](#Ubuntu-18.04-Setup)
* [Nginx setup](#Nginx-setup)
* [Node.js](#Node.js)
* [Gzip](#Gzip)
* [Https](#Https)
* [Commands](#Commands)

---

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

### Server

    $ yarn start
    $ yarn restart-server

### Nginx

    /* Configuration */
    $ sudo vim /etc/nginx/conf.d/[file.conf]

    $ sudo service nginx start
    $ sudo service nginx restart
    $ sudo service nginx stop
    $ sudo service nginx status
    $ sudo nginx -t

### Forever

    $ forever start --spinSleepTime 10000 server.js
    $ forever restart server.js
    $ forever stop server.js
    $ forever list
