import crypto from 'node:crypto';
import { auth, baseURL } from './auth';

/**
 * Invite minting, shared by `yarn invite <email>` (scripts/invite.ts) and the
 * backoffice. One TTL and one token scheme, in one place.
 *
 * The token is stored in plain text as part of the verification row's
 * identifier, so an invite link can be read back and re-copied later — see
 * listInvites in backoffice/api.ts. It is not a shown-once secret.
 */

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Identifier prefix that distinguishes invites from every other verification row. */
export const INVITE_PREFIX = 'invite:';

export interface Invite {
  token: string;
  email: string;
  url: string;
  expiresAt: Date;
}

export function inviteUrl(token: string): string {
  return `${baseURL}/login?invite=${token}`;
}

export async function createInvite(email: string): Promise<Invite> {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `${INVITE_PREFIX}${token}`,
    value: email,
    expiresAt,
  });

  return { token, email, url: inviteUrl(token), expiresAt };
}
