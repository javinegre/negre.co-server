import type { NextFunction, Request, Response } from 'express';
import { trustedOrigins } from '../auth/auth';

/**
 * CSRF guard for the backoffice's state-changing routes.
 *
 * This API is cookie-authenticated, so without this any page an admin happens
 * to visit could POST to it with their session attached. better-auth's own
 * `trustedOrigins` check covers `/api/auth/*` only — it does nothing for these
 * routes, so the guard has to be explicit.
 *
 * Sec-Fetch-Site is sent by every current browser and is the real check;
 * the Origin comparison is the fallback, against the same trusted list the
 * auth client uses.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const site = req.get('sec-fetch-site');
  if (site === 'same-origin') {
    next();
    return;
  }

  // Only consulted when the browser sent no Sec-Fetch-Site at all. A request
  // with neither header (curl, a non-browser client) is refused: the only
  // intended caller is the backoffice page itself.
  if (site === undefined) {
    const origin = req.get('origin');
    if (origin && trustedOrigins.includes(origin)) {
      next();
      return;
    }
  }

  res.status(403).json({ error: 'Cross-site request refused' });
}
