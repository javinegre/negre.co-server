import path from 'node:path';
import express, { Router } from 'express';
import { api } from './api';

/**
 * The backoffice router.
 *
 * Mounted in server.ts at /backoffice behind requireAuth + requireAdmin, so
 * everything below — the JSON API and the static shell alike — is already
 * gated by the time a request gets here.
 *
 * Wiring only: the routes live in api.ts, which is also where this process's
 * second express.json() sits, below the better-auth handler as the mount-order
 * rule in server.ts requires.
 */
export const backoffice: Router = Router();

backoffice.use('/api', api);

// Served by Node rather than aliased in nginx, so the ETag makes a rebuilt
// bundle live immediately — the static apps' `expires 7d` blocks would serve a
// week-old index.html instead.
backoffice.use(express.static(path.join(__dirname, 'public')));
