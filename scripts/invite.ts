import crypto from 'node:crypto';
import { auth } from '../auth/auth';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: yarn invite <email>');
    process.exitCode = 1;
    return;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `invite:${token}`,
    value: email,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:8080';
  console.log(`Invite for ${email} — valid 24h, single use:`);
  console.log(`${baseURL}/login?invite=${token}`);
}

main();
