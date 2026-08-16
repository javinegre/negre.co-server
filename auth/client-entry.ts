import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

// Bundled locally by esbuild (see package.json's build:login script) so the
// login page never loads auth code from a third-party CDN at runtime.
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});
