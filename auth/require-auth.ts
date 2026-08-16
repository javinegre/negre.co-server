import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Awaited<ReturnType<typeof auth.api.getSession>>;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    if (req.accepts('html')) {
      res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
    return;
  }
  req.session = session;
  next();
}
