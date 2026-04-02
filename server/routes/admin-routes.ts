import type { Express } from "express";
import { storage } from "../storage";
import { isAdmin } from "../middleware/auth";
import { logger } from "../logger";
import type { InsertSchedule, ScheduleDay } from "@shared/schema";
import { datetimeLocalToUTC } from "@shared/date";

function toString(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/**
 * Parses a datetime-local value (YYYY-MM-DDTHH:mm) from the frontend
 * and converts it to a UTC Date using the specified timezone.
 */
function parseDateTimeLocal(dt: string, tz: string): Date {
  return datetimeLocalToUTC(dt, tz);
}

function parseDatabaseUrl(url: string | undefined): { name: string; host: string; connected: boolean; } {
  if (!url) {
    return { name: 'unknown', host: 'unknown', connected: false };
  }
  try {
    // postgres://user:pass@host:5432/dbname
    const match = url.match(/postgres(?:ql)?:\/\/[^@]+@([^:]+):\d+\/(\w+)/);
    if (match) {
      return { host: match[ 1 ], name: match[ 2 ], connected: true };
    }
    // Fallback: just show the full URL parsed
    const urlObj = new URL(url);
    return { name: urlObj.pathname.slice(1) || 'unknown', host: urlObj.hostname, connected: true };
  } catch {
    return { name: 'unknown', host: 'unknown', connected: true };
  }
}

export function registerAdminRoutes(app: Express): void {
  app.get('/admin/api/info', isAdmin, async (req, res) => {
    const dbInfo = parseDatabaseUrl(process.env.DATABASE_URL);
    res.json({
      database: dbInfo,
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  app.get('/admin/api/sessions', isAdmin, async (req, res) => {
    try {
      const channelId = toString(req.query.channelId);
      const status = req.query.status as 'scheduled' | 'active' | 'completed' | 'cancelled' | undefined;
      const sessions = await storage.listSessions(channelId, status);
      res.json(sessions);
    } catch (err) {
      logger.error("Failed to list sessions", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list sessions" });
    }
  });

  app.post('/admin/api/sessions', isAdmin, async (req, res) => {
    try {
      const channelId = req.body.channelId as string;
      const title = req.body.title as string;
      const description = req.body.description as string | undefined;
      const scheduledStartStr = req.body.scheduledStart as string;
      const scheduledEndStr = req.body.scheduledEnd as string;
      const timezone = (req.body.timezone as string) || 'UTC';
      const scheduleId = req.body.scheduleId as number | undefined;

      const session = await storage.createSession({
        channelId,
        title,
        description,
        scheduledStart: parseDateTimeLocal(scheduledStartStr, timezone),
        scheduledEnd: parseDateTimeLocal(scheduledEndStr, timezone),
        timezone,
        scheduleId,
      });
      res.status(201).json(session);
    } catch (err) {
      logger.error("Failed to create session", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.patch('/admin/api/sessions/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const title = toString(req.body.title);
      const description = req.body.description as string | undefined;
      const scheduledStart = toString(req.body.scheduledStart);
      const scheduledEnd = toString(req.body.scheduledEnd);
      const timezone = toString(req.body.timezone);
      const scheduleId = req.body.scheduleId as number | null | undefined;

      // Get current session to know the timezone for conversion
      const currentSession = await storage.getSessionById(id);
      const tz = timezone || currentSession?.timezone || 'UTC';

      const session = await storage.updateSession(id, {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(scheduledStart && { scheduledStart: parseDateTimeLocal(scheduledStart, tz) }),
        ...(scheduledEnd && { scheduledEnd: parseDateTimeLocal(scheduledEnd, tz) }),
        ...(timezone && { timezone }),
        ...(scheduleId !== undefined && { scheduleId }),
      });
      res.json(session);
    } catch (err) {
      logger.error("Failed to update session", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.patch('/admin/api/sessions/:id/cancel', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const session = await storage.cancelSession(id);
      res.json(session);
    } catch (err) {
      logger.error("Failed to cancel session", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to cancel session" });
    }
  });

  app.delete('/admin/api/sessions/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.updateSessionStatus(id, 'cancelled');
      res.status(204).send();
    } catch (err) {
      logger.error("Failed to delete session", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  // Channels CRUD
  app.get('/admin/api/channels', isAdmin, async (req, res) => {
    try {
      const channels = await storage.getChannels();
      res.json(channels);
    } catch (err) {
      logger.error("Failed to list channels", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list channels" });
    }
  });

  app.post('/admin/api/channels', isAdmin, async (req, res) => {
    try {
      const { channelId, name, description } = req.body;
      const channel = await storage.createChannel({ channelId, name, description });
      res.status(201).json(channel);
    } catch (err) {
      logger.error("Failed to create channel", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to create channel" });
    }
  });

  app.patch('/admin/api/channels/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { channelId, name, description } = req.body;
      const channel = await storage.updateChannel(id, { channelId, name, description });
      res.json(channel);
    } catch (err) {
      logger.error("Failed to update channel", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to update channel" });
    }
  });

  app.delete('/admin/api/channels/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteChannel(id);
      res.status(204).send();
    } catch (err) {
      logger.error("Failed to delete channel", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to delete channel" });
    }
  });

  // Lore CRUD
  app.get('/admin/api/lore', isAdmin, async (req, res) => {
    try {
      const { channelId } = req.query;
      const lore = await storage.getLore(channelId as string | undefined);
      res.json(lore);
    } catch (err) {
      logger.error("Failed to list lore", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list lore" });
    }
  });

  app.post('/admin/api/lore', isAdmin, async (req, res) => {
    try {
      const { channelId, content } = req.body;
      const lore = await storage.createLore({ channelId, content, isActive: true });
      res.status(201).json(lore);
    } catch (err) {
      logger.error("Failed to create lore", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to create lore" });
    }
  });

  app.delete('/admin/api/lore/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deactivateLore(id);
      res.status(204).send();
    } catch (err) {
      logger.error("Failed to delete lore", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to delete lore" });
    }
  });

  // Blocks CRUD
  app.get('/admin/api/blocks', isAdmin, async (req, res) => {
    try {
      const channelId = toString(req.query.channelId);
      const blocks = await storage.getBlocks(channelId);
      res.json(blocks);
    } catch (err) {
      logger.error("Failed to list blocks", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list blocks" });
    }
  });

  app.get('/admin/api/blocks/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const block = await storage.getBlockById(id);
      if (!block) {
        return res.status(404).json({ message: "Block not found" });
      }
      res.json(block);
    } catch (err) {
      logger.error("Failed to get block", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to get block" });
    }
  });

  app.post('/admin/api/blocks', isAdmin, async (req, res) => {
    try {
      const { channelId, sessionId, title, content, imageUrl, optionA, optionB, isNotable } = req.body;
      
      if (!channelId || !sessionId || !content) {
        return res.status(400).json({ message: "channelId, sessionId, and content are required" });
      }
      
      const block = await storage.createBlock({
        channelId,
        sessionId,
        title: title || null,
        content,
        imageUrl: imageUrl || null,
        optionA: optionA || null,
        optionB: optionB || null,
        isNotable: isNotable ?? false,
      });
      res.status(201).json(block);
    } catch (err) {
      logger.error("Failed to create block", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to create block" });
    }
  });

  app.patch('/admin/api/blocks/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { title, content, imageUrl, optionA, optionB, isNotable } = req.body;
      
      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title;
      if (content !== undefined) updateData.content = content;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      if (optionA !== undefined) updateData.optionA = optionA;
      if (optionB !== undefined) updateData.optionB = optionB;
      if (isNotable !== undefined) updateData.isNotable = isNotable;
      
      const block = await storage.updateBlock(id, updateData);
      res.json(block);
    } catch (err) {
      logger.error("Failed to update block", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to update block" });
    }
  });

  app.delete('/admin/api/blocks/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteBlock(id);
      res.status(204).send();
    } catch (err) {
      logger.error("Failed to delete block", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to delete block" });
    }
  });

  // Users CRUD
  app.get('/admin/api/users', isAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const result = await storage.getUsers(page, limit);
      res.json(result);
    } catch (err) {
      logger.error("Failed to list users", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list users" });
    }
  });

  app.patch('/admin/api/users/:id/ban', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { banned } = req.body;
      const user = await storage.banUser(id, banned);
      res.json(user);
    } catch (err) {
      logger.error("Failed to ban user", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to ban user" });
    }
  });

  // System Settings
  app.get('/admin/api/settings', isAdmin, async (req, res) => {
    try {
      const { key } = req.query;
      if (key) {
        const value = await storage.getSystemSetting(key as string);
        res.json({ key, value });
      } else {
        res.json({ message: "Key parameter required" });
      }
    } catch (err) {
      logger.error("Failed to get setting", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to get setting" });
    }
  });

  app.post('/admin/api/settings', isAdmin, async (req, res) => {
    try {
      const { key, value } = req.body;
      await storage.setSystemSetting(key, value);
      res.status(201).json({ success: true });
    } catch (err) {
      logger.error("Failed to set setting", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to set setting" });
    }
  });

  app.get('/admin/api/schedules', isAdmin, async (req, res) => {
    try {
      const channelId = toString(req.query.channelId);
      if (channelId) {
        const schedules = await storage.getSchedulesByChannel(channelId);
        return res.json(schedules);
      }
      res.json([]);
    } catch (err) {
      logger.error("Failed to list schedules", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to list schedules" });
    }
  });

  app.get('/admin/api/schedules/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const schedule = await storage.getSchedule(id);
      if (!schedule) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      res.json(schedule);
    } catch (err) {
      logger.error("Failed to get schedule", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to get schedule" });
    }
  });

  app.post('/admin/api/schedules', isAdmin, async (req, res) => {
    try {
      const channelId = req.body.channelId as string;
      const scheduledDays = req.body.scheduledDays as ScheduleDay[] | undefined;
      const scheduledTime = toString(req.body.scheduledTime);
      const intervalEnabled = req.body.intervalEnabled as boolean | undefined;
      const timezone = toString(req.body.timezone);
      const titleConfig = req.body.titleConfig;

      const schedule = await storage.createSchedule({
        channelId,
        scheduledDays,
        scheduledTime,
        intervalEnabled: intervalEnabled ?? false,
        timezone: timezone ?? 'UTC',
        titleConfig,
      });
      res.status(201).json(schedule);
    } catch (err) {
      logger.error("Failed to create schedule", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to create schedule" });
    }
  });

  app.patch('/admin/api/schedules/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const scheduledDays = req.body.scheduledDays as ScheduleDay[] | undefined;
      const scheduledTime = toString(req.body.scheduledTime);
      const intervalEnabled = req.body.intervalEnabled as boolean | undefined;
      const timezone = toString(req.body.timezone);
      const nextRunAt = req.body.nextRunAt as string | undefined;
      const titleConfig = req.body.titleConfig;

      const schedule = await storage.updateSchedule(id, {
        ...(scheduledDays !== undefined && { scheduledDays }),
        ...(scheduledTime !== undefined && { scheduledTime }),
        ...(intervalEnabled !== undefined && { intervalEnabled }),
        ...(timezone && { timezone }),
        ...(nextRunAt && { nextRunAt: new Date(nextRunAt) }),
        ...(titleConfig !== undefined && { titleConfig }),
      });
      res.json(schedule);
    } catch (err) {
      logger.error("Failed to update schedule", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to update schedule" });
    }
  });

  app.delete('/admin/api/schedules/:id', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteSchedule(id);
      res.status(204).send();
    } catch (err) {
      logger.error("Failed to delete schedule", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.get('/admin/api/sessions/:id/with-schedule', isAdmin, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const session = await storage.getSessionWithSchedule(id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json(session);
    } catch (err) {
      logger.error("Failed to get session with schedule", "admin", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ message: "Failed to get session with schedule" });
    }
  });
}
