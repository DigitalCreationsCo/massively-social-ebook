import { z } from 'zod';

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
  timezone: z.string(),
  status: z.enum(['scheduled', 'active', 'completed', 'cancelled']),
  backingTrackUrl: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const channelSchema = z.object({
  id: z.number(),
  channelId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  coverImage: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const api = {
  channels: {
    list: {
      method: 'GET' as const,
      path: '/api/channels' as const,
      responses: {
        200: z.array(channelSchema),
      },
    },
    active: {
      method: 'GET' as const,
      path: '/api/channels/active' as const,
      responses: {
        200: z.array(channelSchema),
      },
    },
  },
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
          dialogue: z.string().nullable(),
          ttsEnabled: z.boolean(),
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
  nextSessionResponse: z.object({
    session: sessionResponseSchema.nullable(),
    channel: channelSchema,
  }),

  sessions: {
    next: {
      method: 'GET' as const,
      path: '/api/sessions/next' as const,
      responses: {
        200: z.object({
          session: sessionResponseSchema.nullable(),
          channel: channelSchema,
        }),
      },
    },
    reminder: {
      method: 'POST' as const,
      path: '/api/sessions/reminder' as const,
      body: z.object({
        sessionId: z.number(),
        email: z.email().optional(), // for future SMTP
      }),
    },
  },
  admin: {
    channels: {
      list: {
        method: 'GET' as const,
        path: '/api/admin/channels' as const,
        responses: {
          200: z.array(channelSchema),
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/admin/channels' as const,
        body: z.object({
          channelId: z.string(),
          name: z.string(),
          description: z.string().optional(),
        }),
        responses: {
          201: channelSchema,
        },
      },
    },
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
