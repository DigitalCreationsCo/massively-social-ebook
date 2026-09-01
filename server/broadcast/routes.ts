import crypto from "node:crypto";
import type { Express, Request } from "express";

import { isAdmin } from "../middleware/auth";
import type { BroadcastRuntime } from "./runtime";

export interface ChatIdentity {
  authorId: string;
  displayName: string;
}

export function getChatIdentity(req: Request): ChatIdentity | null {
  if (req.session.userId && req.session.username) {
    return { authorId: `user:${req.session.userId}`, displayName: req.session.username };
  }
  if (req.session.guestId && req.session.guestDisplayName) {
    return { authorId: `guest:${req.session.guestId}`, displayName: req.session.guestDisplayName };
  }
  return null;
}

export function registerBroadcastRoutes(app: Express, runtime: BroadcastRuntime): void {
  app.post("/api/chat/identity", (req, res, next) => {
    const existing = getChatIdentity(req);
    if (existing) return res.json(existing);
    const guestId = crypto.randomUUID();
    req.session.guestId = guestId;
    req.session.guestDisplayName = `Guest ${guestId.slice(0, 6).toUpperCase()}`;
    req.session.save((cause) => {
      if (cause) return next(cause);
      return res.status(201).json(getChatIdentity(req));
    });
  });

  app.get("/api/channels/:channelId/playback", async (req, res) => {
    const channelId = String(req.params.channelId || "");
    if (!runtime.hasChannel(channelId)) {
      return res.status(404).json({ message: "Broadcast is not configured for this channel" });
    }
    return res.json(await runtime.getPlaybackStatus(channelId));
  });

  app.get("/api/admin/broadcasts/:channelId", isAdmin, (req, res) => {
    const channelId = String(req.params.channelId || "");
    if (!runtime.hasChannel(channelId)) return res.status(404).json({ message: "Broadcast not found" });
    return res.json(runtime.getCoordinatorStatus(channelId));
  });

  app.post("/api/admin/broadcasts/:channelId/stop", isAdmin, async (req, res) => {
    const channelId = String(req.params.channelId || "");
    if (!runtime.hasChannel(channelId)) return res.status(404).json({ message: "Broadcast not found" });
    await runtime.stop(channelId);
    return res.json(runtime.getCoordinatorStatus(channelId));
  });

  app.post("/api/admin/broadcasts/:channelId/restart", isAdmin, async (req, res) => {
    const channelId = String(req.params.channelId || "");
    if (!runtime.hasChannel(channelId)) return res.status(404).json({ message: "Broadcast not found" });
    await runtime.restart(channelId);
    return res.json(runtime.getCoordinatorStatus(channelId));
  });
}
