import { createInvite } from '../auth/invites';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: yarn invite <email>');
    process.exitCode = 1;
    return;
  }

  const invite = await createInvite(email);

  console.log(`Invite for ${invite.email} — single use, expires ${invite.expiresAt.toISOString()}:`);
  console.log(invite.url);
}

main();
