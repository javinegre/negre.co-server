import express, { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { auth } from '../auth/auth';
import { INVITE_PREFIX, createInvite, inviteUrl } from '../auth/invites';
import { appStatuses } from './ops';
import { requireSameOrigin } from './require-same-origin';

export const api: Router = Router();

// Mounted below the better-auth handler in server.ts, per the mount-order rule
// documented there: better-auth reads raw request bodies itself, so no JSON
// parser may sit in front of it. This one is scoped to these routes only.
// The cast is the same shape of mismatch server.ts documents for toNodeHandler:
// body-parser's NextHandleFunction doesn't structurally match this version of
// @types/express's RequestHandler, though it is one at runtime.
api.use(express.json({ limit: '32kb' }) as RequestHandler);

api.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/** The only record of who did what: it lands in `pm2 logs` with everything else. */
function audit(req: Request, action: string, target: string, outcome: string) {
  const actor = req.session?.user.email ?? 'unknown';
  console.log(`[backoffice] ${actor}  ${action}  ${target}  ${outcome}`);
}

interface PasskeyRow {
  userId: string;
}

interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date | string;
  createdAt: Date | string;
}

/** Guards `deleteUser` against ids that aren't real, and gives the audit log a name. */
async function emailForUser(id: string): Promise<string | null> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserById(id);
  return found?.email ?? null;
}

// The reload flow polls this once process control lands; a 200 means the router
// is back and this admin's session survived the restart.
api.get('/health', (_req, res) => {
  res.json({ ok: true });
});

api.get('/users', async (_req, res) => {
  const ctx = await auth.$context;

  const users = await ctx.internalAdapter.listUsers(200, 0, {
    field: 'createdAt',
    direction: 'desc',
  });

  // One query over the whole table, tallied here — a count() per user would be
  // an N+1 over the same rows.
  const passkeys = await ctx.adapter.findMany<PasskeyRow>({
    model: 'passkey',
    select: ['userId'],
  });
  const counts = new Map<string, number>();
  for (const row of passkeys) {
    counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }

  res.json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      passkeys: counts.get(user.id) ?? 0,
    })),
  });
});

api.get('/invites', async (_req, res) => {
  const ctx = await auth.$context;

  // findVerificationValue takes an exact identifier and invite tokens are
  // random, so this prefix query is the only way to enumerate them.
  const rows = await ctx.adapter.findMany<VerificationRow>({
    model: 'verification',
    where: [{ field: 'identifier', operator: 'starts_with', value: INVITE_PREFIX }],
    sortBy: { field: 'createdAt', direction: 'desc' },
  });

  const now = Date.now();
  res.json({
    invites: rows.map((row) => {
      const token = row.identifier.slice(INVITE_PREFIX.length);
      return {
        id: row.id,
        email: row.value,
        // Returned so the UI can offer Copy link on any pending invite. The
        // token is stored in plain text, so this is a re-read, not a reveal.
        url: inviteUrl(token),
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        expired: new Date(row.expiresAt).getTime() < now,
      };
    }),
  });
});

api.post('/invites', requireSameOrigin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  // Deliberately loose: the invite is sent out of band and the address only has
  // to be one a human recognises. Rejecting obvious nonsense is enough.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'A valid email address is required' });
    return;
  }

  const invite = await createInvite(email);
  audit(req, 'invite.create', email, 'ok');

  res.status(201).json({
    email: invite.email,
    url: invite.url,
    expiresAt: invite.expiresAt,
  });
});

api.delete('/invites/:id', requireSameOrigin, async (req, res) => {
  const ctx = await auth.$context;
  const { id } = req.params;

  // Check the row is an invite before deleting it. Without this, the endpoint
  // would delete any verification row by id — a password-reset or email-change
  // token included.
  const rows = await ctx.adapter.findMany<VerificationRow>({
    model: 'verification',
    where: [{ field: 'id', value: id }],
    limit: 1,
  });
  const row = rows[0];

  if (!row || !row.identifier.startsWith(INVITE_PREFIX)) {
    audit(req, 'invite.revoke', id, 'not-found');
    res.status(404).json({ error: 'No such invite' });
    return;
  }

  await ctx.adapter.delete({ model: 'verification', where: [{ field: 'id', value: id }] });
  audit(req, 'invite.revoke', row.value, 'ok');
  res.json({ ok: true });
});

api.delete('/users/:id', requireSameOrigin, async (req, res) => {
  const ctx = await auth.$context;
  const { id } = req.params;

  const email = await emailForUser(id);
  if (!email) {
    audit(req, 'user.delete', id, 'not-found');
    res.status(404).json({ error: 'No such user' });
    return;
  }

  // Checked on the email as well as the id: the email is the value requireAdmin
  // already gated on, so it is certain to be there, while a session shape that
  // somehow lacked `id` would make an id-only check silently pass and let an
  // admin delete themselves.
  const self = req.session?.user.email?.toLowerCase();
  if (req.session?.user.id === id || (self !== undefined && self === email.toLowerCase())) {
    audit(req, 'user.delete', email, 'refused-self');
    res.status(400).json({ error: 'You cannot delete your own account here' });
    return;
  }

  // The generated schema puts ON DELETE CASCADE on passkey.userId and
  // session.userId, and better-sqlite3 enforces foreign keys by default — but
  // that only holds for a database built by that migration. Deleting them
  // explicitly first is the same outcome either way, and a credential that
  // outlives its user is not a bug worth risking on a schema assumption.
  await ctx.adapter.deleteMany({ model: 'passkey', where: [{ field: 'userId', value: id }] });
  await ctx.adapter.deleteMany({ model: 'session', where: [{ field: 'userId', value: id }] });
  await ctx.internalAdapter.deleteUser(id);

  audit(req, 'user.delete', email, 'ok');
  res.json({ ok: true });
});

api.get('/apps', async (_req, res) => {
  // Read-only: shells out to git, never writes. Deploying is phase 4.
  res.json({ apps: await appStatuses() });
});
