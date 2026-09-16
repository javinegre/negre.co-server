import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

// Read once at import time, like auth.ts does with AUTH_DB_PATH: PM2 loads the
// droplet's .env through interpreter_args before this module is required.
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

if (adminEmails.size === 0) {
  // Fail closed, and say so at startup rather than only when someone is
  // mysteriously locked out of a page that used to work.
  console.warn(
    '[backoffice] ADMIN_EMAILS is unset — /backoffice will deny everyone, including you.',
  );
}

const DENIED_PAGE = path.join(__dirname, '..', 'backoffice', 'public', 'denied.html');
const NO_ADMINS_PAGE = path.join(__dirname, '..', 'backoffice', 'public', 'no-admins.html');

/**
 * Admin gate. Must be mounted *after* requireAuth, which is what populates
 * req.session.
 *
 * Denial is a 403 and never a redirect: requireAuth has already established a
 * session by this point, so sending them to /login would bounce them straight
 * back here forever.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const email = req.session?.user.email?.toLowerCase();

  if (!email || !adminEmails.has(email)) {
    if (req.accepts('html')) {
      // Both pages carry their own inline <style>: everything under
      // backoffice/public/ is served behind this gate, so a denied user cannot
      // fetch style.css to go with them.
      res.status(403).sendFile(adminEmails.size === 0 ? NO_ADMINS_PAGE : DENIED_PAGE);
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
    return;
  }

  next();
}
