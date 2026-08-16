import { Express, RequestHandler } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth';
import { requireAuth } from './auth/require-auth';

const express = require('express');
const app: Express = express();

const BicingApi = require('./apis/bicing-api/index');

const BicingApp = express.static(__dirname + '/apps/bicing-2023/dist');
const Bicing2021App = require('./apps/bicing-2021/index');
const HomeApp = require('./apps/home/index');
const SlidesApp = require('./apps/slides/index');

// Must be mounted before any express.json(): Better Auth reads the raw
// request body itself, and a JSON parser ahead of it leaves the client
// stuck on "pending" with no error. There is no express.json() in this
// router today — keep it that way, or mount it only on routes below this.
//
// toNodeHandler's plain (IncomingMessage, ServerResponse) signature doesn't
// structurally match Express's typed RequestHandler, even though Express's
// req/res are IncomingMessage/ServerResponse subclasses at runtime.
app.all('/api/auth/*', toNodeHandler(auth) as RequestHandler);

app.use('/login', express.static(__dirname + '/auth/public'));

app.use('/.well-known', express.static(__dirname + '/well-known-folder'));
app.use('/files', express.static(__dirname + '/public-files'));

app.use('/bicing/api/', BicingApi);
app.use('/bicing/', BicingApp);
app.use('/bicing-2021/', Bicing2021App);
app.use('/slides/', SlidesApp);

// Placeholder until the concept-app sub-repo exists (apps/ is gitignored,
// checked out separately in production like the other apps). This proves
// the auth gate and single sign-on work end to end: log in once at
// /login, and this route sees the same session as any other app under
// negre.co.
app.get('/concept-app/', requireAuth, (req, res) => {
  res.type('text/plain').send(
    `Signed in as ${req.session?.user.email}\n\n` +
    'This is a placeholder route — replace with the real concept-app once its repo exists.',
  );
});

app.use('/', HomeApp);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { console.log(`Listening on ${PORT}`); });
