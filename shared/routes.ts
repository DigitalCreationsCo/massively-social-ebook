import { z } from 'zod';
import { insertChatSchema, insertVoteSchema } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const sessionResponseSchema = z.object({
  id: z.number(),
  channelId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  status: z.enum([ 'scheduled', 'active', 'completed', 'cancelled' ]),
  createdAt: z.string(),
});

export const api = {
  chat: {
    history: {
      method: 'GET' as const,
      path: '/api/chat' as const,
      responses: {
        200: z.array(z.object({
          id: z.number(),
          username: z.string(),
          text: z.string(),
          createdAt: z.string() // date strings from pg
        })),
      },
    },
  },
  blocks: {
    current: {
      method: 'GET' as const,
      path: '/api/blocks/current' as const,
      responses: {
        200: z.object({
          id: z.number(),
          content: z.string(),
          imageUrl: z.string().nullable(),
          createdAt: z.string(),
          phase: z.enum(['reading', 'voting']),
          timeRemaining: z.number(),
          timeToNextDecision: z.number(),
          initialTimeToNextDecision: z.number(),
          turnsToNextChoice: z.number()
        }),
      }
    }
  },
  sessions: {
    next: {
      method: 'GET' as const,
      path: '/api/sessions/next' as const,
      responses: {
        200: sessionResponseSchema.nullable(),
      },
    },
    reminder: {
      method: 'POST' as const,
      path: '/api/sessions/reminder' as const,
      body: z.object({
        sessionId: z.number(),
        email: z.string().email().optional(), // for future SMTP
      }),
    },
  },
  admin: {
    sessions: {
      list: {
        method: 'GET' as const,
        path: '/api/admin/sessions' as const,
        responses: {
          200: z.array(sessionResponseSchema),
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/admin/sessions' as const,
        body: z.object({
          channelId: z.string(),
          title: z.string(),
          description: z.string().optional(),
          scheduledStart: z.string(),
          scheduledEnd: z.string(),
        }),
        responses: {
          201: sessionResponseSchema,
        },
      },
      cancel: {
        method: 'PATCH' as const,
        path: '/api/admin/sessions/:id/cancel' as const,
        responses: {
          200: sessionResponseSchema,
        },
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
