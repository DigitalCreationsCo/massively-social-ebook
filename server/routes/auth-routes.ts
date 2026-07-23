import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Session-based authentication (express-session is configured in server/index.ts)
//
// Endpoints:
//   POST /api/auth/register  — Create account (username + password)
//   POST /api/auth/login     — Login
//   POST /api/auth/logout    — Logout
//   GET  /api/auth/me        — Get current user (or 401)
//   GET  /api/auth/check-username — Check if username is available
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 1000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const verify = crypto
    .pbkdf2Sync(password, salt!, 1000, 64, "sha512")
    .toString("hex");
  return hash === verify;
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

export function registerAuthRoutes(app: Express) {
  // ── Register ──────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body as {
        username?: string;
        password?: string;
      };

      if (!username || !password) {
        return res.status(400).json({
          message: "Username and password are required",
        });
      }

      if (!isValidUsername(username)) {
        return res.status(400).json({
          message:
            "Username must be 3-30 characters and contain only letters, numbers, and underscores",
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          message: "Password must be at least 6 characters",
        });
      }

      // Check if username already exists
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({
          message: "Username is already taken",
        });
      }

      const passwordHash = hashPassword(password);
      const user = await storage.createUserWithPassword(username, passwordHash);

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username ?? undefined;

      logger.info(`User registered: ${username}`, "auth");

      return res.status(201).json({
        id: user.id,
        username: user.username,
        createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        "Registration failed",
        "auth",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body as {
        username?: string;
        password?: string;
      };

      if (!username || !password) {
        return res.status(400).json({
          message: "Username and password are required",
        });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      if (user.isBanned) {
        return res.status(403).json({ message: "Account is suspended" });
      }

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username ?? undefined;

      logger.info(`User logged in: ${username}`, "auth");

      return res.json({
        id: user.id,
        username: user.username,
        createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        "Login failed",
        "auth",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Login failed" });
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        logger.error(
          "Logout failed",
          "auth",
          err instanceof Error ? err : new Error(String(err)),
        );
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });

  // ── Get current user ──────────────────────────────────────────────────────

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        // Not authenticated — return null instead of 401
        return res.json(null);
      }

      const user = await storage.getUserById(req.session.userId);
      if (!user) {
        // Session exists but user was deleted — clean up session
        req.session.destroy(() => {});
        return res.json(null);
      }

      return res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    } catch (err) {
      logger.error(
        "Failed to get current user",
        "auth",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to get current user" });
    }
  });

  // ── Check username availability ───────────────────────────────────────────

  app.get("/api/auth/check-username", async (req: Request, res: Response) => {
    try {
      const username = String(req.query.username || "");
      if (!username) {
        return res.status(400).json({ message: "username query parameter is required" });
      }
      const user = await storage.getUserByUsername(username);
      return res.json({ available: !user });
    } catch (err) {
      logger.error(
        "Failed to check username",
        "auth",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to check username" });
    }
  });
}
