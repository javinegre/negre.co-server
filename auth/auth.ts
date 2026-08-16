import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { APIError, betterAuth } from 'better-auth';
import { passkey } from '@better-auth/passkey';

const dbPath = process.env.AUTH_DB_PATH || path.join(__dirname, '..', 'data', 'auth.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:8080';

export const auth = betterAuth({
  database: new Database(dbPath),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  // Same-origin app under negre.co: no separate domain needs to be trusted
  // in production, only the local Vite dev server used by the bicing app.
  trustedOrigins: [
    'https://negre.co',
    'https://www.negre.co',
    'https://javi.negre.co',
    'http://127.0.0.1:5173',
  ],
  plugins: [
    passkey({
      rpID: process.env.AUTH_RP_ID || 'localhost',
      rpName: 'negre.co',
      origin: baseURL,
      registration: {
        // No invite-only signup exists without a session yet, so passkey
        // registration itself doubles as account creation: resolveUser
        // validates a single-use invite token and creates the user row.
        requireSession: false,
        resolveUser: async ({ ctx, context: inviteToken }) => {
          if (!inviteToken) {
            throw new APIError('BAD_REQUEST', { message: 'Missing invite token' });
          }

          // Single-use: consuming deletes the row, so a replayed invite
          // link fails from the second attempt onward.
          const invite = await ctx.context.internalAdapter.consumeVerificationValue(
            `invite:${inviteToken}`,
          );
          if (!invite) {
            throw new APIError('BAD_REQUEST', {
              message: 'Invite link is invalid, expired, or already used',
            });
          }

          const email = invite.value;
          const existing = await ctx.context.internalAdapter.findUserByEmail(email);
          if (existing) {
            // Re-inviting an existing member (e.g. to enroll a second
            // passkey) attaches to their current account instead of
            // colliding on the unique email constraint.
            return { id: existing.user.id, name: existing.user.email };
          }

          const user = await ctx.context.internalAdapter.createUser({
            email,
            name: email,
            // The invite itself, sent out-of-band by an admin, stands in
            // for email verification — there is no verification email.
            emailVerified: true,
          });
          return { id: user.id, name: user.email };
        },
      },
    }),
  ],
});
