import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'http';
import express from 'express';

describe('Server Initialization', () => {
  it('should be able to bind to a port without ENOTSUP error', async () => {
    const app = express();
    const server = createServer(app);
    
    const listenPromise = new Promise<void>((resolve, reject) => {
      server.listen({ port: 0, host: '0.0.0.0' }, () => {
        server.close();
        resolve();
      });
      server.on('error', reject);
    });

    await expect(listenPromise).resolves.toBeUndefined();
  });
});