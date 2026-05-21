import { type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";
import { logger } from "../logger";

export function createAdminStaticMiddleware() {
  const pathAdminDist = path.resolve(process.cwd(), "admin", "dist");

  return (req: Request, res: Response, next: NextFunction) => {
    const flagHostControl = req.hostname === 'control.25thchapter.com';
    const flagPathAdmin = req.path.startsWith('/admin') && !req.path.startsWith('/admin/api');

    if (flagHostControl || flagPathAdmin) {
      logger.info(`[AdminStatic] Intercepted admin request. Host: ${req.hostname}, Path: ${req.path}`, "admin-static");
      
      const usernameAdmin = process.env.ADMIN_USERNAME || 'admin';
      const passwordAdmin = process.env.ADMIN_PASSWORD;

      if (passwordAdmin) {
        const authHeader = req.headers.authorization || '';
        const authHeaderCredentialsBase64 = authHeader.split(' ')[1] || '';
        
        try {
          const [credentialUsername, credentialPassword] = Buffer.from(authHeaderCredentialsBase64, 'base64')
            .toString('utf8')
            .split(':');

          if (credentialUsername !== usernameAdmin || credentialPassword !== passwordAdmin) {
            logger.warn(`[AdminStatic] Unauthorized login attempt for user: ${credentialUsername}`, "admin-static");
            res.set('WWW-Authenticate', 'Basic realm="401"');
            return res.status(401).send('Authentication required.');
          }
        } catch (errorAuthDecode) {
          logger.error(`[AdminStatic] Failed to decode authorization header`, "admin-static", errorAuthDecode instanceof Error ? errorAuthDecode : new Error(String(errorAuthDecode)));
          res.set('WWW-Authenticate', 'Basic realm="401"');
          return res.status(401).send('Authentication required.');
        }
      }

      if (!fs.existsSync(pathAdminDist)) {
        logger.error(`[AdminStatic] Admin distribution path does not exist: ${pathAdminDist}`, "admin-static", new Error("Admin app not built."));
        if (process.env.NODE_ENV !== "production") {
          logger.info(`[AdminStatic] Bypassing middleware in non-production mode`, "admin-static");
          return next(); // Let Vite handle it in dev if applicable
        }
        return res.status(500).send("Admin app not built.");
      }

      let pathUrlAdminRelative = req.path;
      if (flagPathAdmin) {
        pathUrlAdminRelative = req.path.replace(/^\/admin/, '') || '/';
      }

      // Prevent path traversal attacks by resolving and verifying the path is within the adminDistPath directory
      const pathFileAdminTarget = path.join(pathAdminDist, pathUrlAdminRelative);
      if (!pathFileAdminTarget.startsWith(pathAdminDist)) {
        logger.warn(`[AdminStatic] Blocked path traversal attempt: ${pathFileAdminTarget}`, "admin-static");
        return res.status(403).send("Forbidden");
      }

      try {
        if (fs.existsSync(pathFileAdminTarget) && fs.statSync(pathFileAdminTarget).isFile()) {
          logger.debug(`[AdminStatic] Serving static file: ${pathFileAdminTarget}`, "admin-static");
          return res.sendFile(pathFileAdminTarget);
        }
      } catch (errorFileCheck) {
        logger.error(`[AdminStatic] Error checking file existence or status: ${pathFileAdminTarget}`, "admin-static", errorFileCheck instanceof Error ? errorFileCheck : new Error(String(errorFileCheck)));
        return res.status(500).send("Internal Server Error");
      }

      const pathFileAdminIndex = path.join(pathAdminDist, "index.html");
      logger.debug(`[AdminStatic] File not found. Serving fallback index: ${pathFileAdminIndex}`, "admin-static");
      return res.sendFile(pathFileAdminIndex);
    }
    
    next();
  };
}
