import { NextFunction, Request, Response } from "express";
import { JwtPayload, verifyToken } from "../auth/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// Cookie name is deliberately NOT "token" (the main backend's cookie name): both
// services run on localhost during local development, and a browser's cookie jar is
// keyed by hostname, not port - a same-named cookie from each service would silently
// clobber the other's session.
export const AUDIT_TOKEN_COOKIE = "audit_token";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : req.cookies?.[AUDIT_TOKEN_COOKIE];

  if (!token) {
    return res.status(401).json({ error: "Missing or invalid credentials" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: JwtPayload["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${roles.join(", ")}` });
    }
    next();
  };
}
