import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Notes System — REST API for block-level notes
//
// Notes re-use the `chat` table where `blockId` is set.
// This is a RESTful micro-API layered on top of the existing chat
// infrastructure.
//
// Endpoints:
//   GET    /api/notes/:blockId          — List notes for a block
//   POST   /api/notes/:blockId          — Create a note on a block
//   POST   /api/notes/:noteId/like      — Like a note
//   DELETE /api/notes/:noteId/like      — Unlike a note
//   GET    /api/notes/:blockId/status   — Note count + liked-by-user status
// ---------------------------------------------------------------------------

export function registerNotesRoutes(app: Express) {
  // ── List notes for a block ────────────────────────────────────────────────

  app.get("/api/notes/:blockId", async (req: Request, res: Response) => {
    try {
      const blockIdParam = req.params.blockId;
      const blockId = parseInt(Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam, 10);
      if (isNaN(blockId)) {
        return res.status(400).json({ message: "Invalid blockId" });
      }

      const notes = await storage.getNotesForBlock(blockId);

      // Enrich each note with like count and whether the current user liked it
      const username =
        (req.session?.username as string | undefined) ?? null;
      const enriched = await Promise.all(
        notes.map(async (note) => {
          const likeCount = await storage.getNoteLikeCount(note.id);
          const likedByMe =
            username ? await storage.hasUserLikedNote(note.id, username) : false;
          return {
            ...note,
            createdAt:
              note.createdAt?.toISOString() ?? new Date().toISOString(),
            likeCount,
            likedByMe,
          };
        }),
      );

      return res.json(enriched);
    } catch (err) {
      const blockIdParam = req.params.blockId;
      const blockIdStr = Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam;
      logger.error(
        `Failed to fetch notes for block ${blockIdStr}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  // ── Create a note on a block ──────────────────────────────────────────────

  app.post("/api/notes/:blockId", async (req: Request, res: Response) => {
    try {
      const blockIdParam = req.params.blockId;
      const blockId = parseInt(Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam, 10);
      if (isNaN(blockId)) {
        return res.status(400).json({ message: "Invalid blockId" });
      }

      const { text } = req.body as { text?: string };
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ message: "Note text is required" });
      }

      if (text.length > 1000) {
        return res.status(400).json({ message: "Note must be 1000 characters or less" });
      }

      // Require authentication
      const username = req.session?.username as string | undefined;
      if (!username) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get the block to find its channel and session
      const block = await storage.getBlockById(blockId);
      if (!block) {
        return res.status(404).json({ message: "Block not found" });
      }

      const note = await storage.createChat({
        channelId: block.channelId,
        sessionId: block.sessionId,
        blockId: block.id,
        username,
        text: text.trim(),
      });

      return res.status(201).json({
        ...note,
        createdAt:
          note.createdAt?.toISOString() ?? new Date().toISOString(),
        likeCount: 0,
        likedByMe: false,
      });
    } catch (err) {
      const blockIdParam = req.params.blockId;
      const blockIdStr = Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam;
      logger.error(
        `Failed to create note on block ${blockIdStr}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to create note" });
    }
  });

  // ── Like a note ───────────────────────────────────────────────────────────

  app.post("/api/notes/:noteId/like", async (req: Request, res: Response) => {
    try {
      const noteIdParam = req.params.noteId;
      const noteId = parseInt(Array.isArray(noteIdParam) ? noteIdParam[0] : noteIdParam, 10);
      if (isNaN(noteId)) {
        return res.status(400).json({ message: "Invalid noteId" });
      }

      // Require authentication
      const username = req.session?.username as string | undefined;
      if (!username) {
        return res.status(401).json({ message: "Authentication required" });
      }

      await storage.likeNote(noteId, username);
      const likeCount = await storage.getNoteLikeCount(noteId);

      return res.json({ liked: true, likeCount });
    } catch (err) {
      const noteIdParam = req.params.noteId;
      const noteIdStr = Array.isArray(noteIdParam) ? noteIdParam[0] : noteIdParam;
      logger.error(
        `Failed to like note ${noteIdStr}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to like note" });
    }
  });

  // ── Unlike a note ─────────────────────────────────────────────────────────

  app.delete("/api/notes/:noteId/like", async (req: Request, res: Response) => {
    try {
      const noteIdParam = req.params.noteId;
      const noteId = parseInt(Array.isArray(noteIdParam) ? noteIdParam[0] : noteIdParam, 10);
      if (isNaN(noteId)) {
        return res.status(400).json({ message: "Invalid noteId" });
      }

      // Require authentication
      const username = req.session?.username as string | undefined;
      if (!username) {
        return res.status(401).json({ message: "Authentication required" });
      }

      await storage.unlikeNote(noteId, username);
      const likeCount = await storage.getNoteLikeCount(noteId);

      return res.json({ liked: false, likeCount });
    } catch (err) {
      const noteIdParam = req.params.noteId;
      const noteIdStr = Array.isArray(noteIdParam) ? noteIdParam[0] : noteIdParam;
      logger.error(
        `Failed to unlike note ${noteIdStr}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to unlike note" });
    }
  });

  // ── Get note status for a block ───────────────────────────────────────────
  // Returns total note count for a block, useful for the "N notes" indicator

  app.get("/api/notes/:blockId/status", async (req: Request, res: Response) => {
    try {
      const blockIdParam = req.params.blockId;
      const blockId = parseInt(Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam, 10);
      if (isNaN(blockId)) {
        return res.status(400).json({ message: "Invalid blockId" });
      }

      const notes = await storage.getNotesForBlock(blockId);
      return res.json({ count: notes.length });
    } catch (err) {
      const blockIdParam = req.params.blockId;
      const blockIdStr = Array.isArray(blockIdParam) ? blockIdParam[0] : blockIdParam;
      logger.error(
        `Failed to get note status for block ${blockIdStr}`,
        "routes",
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ message: "Failed to get note status" });
    }
  });
}
