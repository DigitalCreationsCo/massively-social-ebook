import { type Request, type Response, type NextFunction } from "express";

function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return undefined;
}

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  const bearerToken = extractBearerToken(req);
  const token = bearerToken || req.headers['x-admin-token'] || req.query.token;

  if (token === process.env.ADMIN_TOKEN || (process.env.NODE_ENV !== 'production' && token === 'dev-token')) {
    return next();
  }

  res.status(401).json({ message: "Unauthorized: Admin token required" });
};

export const isDevOnly = (_req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: "Forbidden: Debugging tools are disabled in production" });
  }
  next();
};
