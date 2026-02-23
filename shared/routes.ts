import { z } from 'zod';
import { insertChatSchema, insertVoteSchema } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

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
          timeRemaining: z.number()
        }),
      }
    }
  }
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
