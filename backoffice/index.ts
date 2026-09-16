import path from 'node:path';
import express, { Router } from 'express';

/**
 * The backoffice router.
 *
 * Mounted in server.ts at /backoffice behind requireAuth + requireAdmin, so
 * everything below — the JSON API and the static shell alike — is already
 * gated by the time a request gets here.
 *
 * No express.json() yet. When a later phase needs one it goes on this router,
 * not on the app: the better-auth handler in server.ts must keep seeing raw
 * request bodies (see the comment above it).
 */
export const backoffice: Router = Router();

backoffice.get('/api/health', (_req, res) => {
  // Also the signal the reload flow polls for once process control lands: a
  // 200 here means the router is back up and this admin's session survived.
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Served by Node rather than aliased in nginx, so the ETag makes a rebuilt
// bundle live immediately — the static apps' `expires 7d` blocks would serve a
// week-old index.html instead.
backoffice.use(express.static(path.join(__dirname, 'public')));
