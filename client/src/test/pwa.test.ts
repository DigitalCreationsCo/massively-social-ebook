import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { existsSync } from 'node:fs';

describe('PWA with vite-plugin-pwa', () => {
  const distPath = path.resolve(__dirname, '../../../dist/public');

  it('should generate sw.js in dist', () => {
    const swPath = path.resolve(distPath, 'sw.js');
    expect(existsSync(swPath)).toBe(true);
  });

  it('should generate workbox in dist', () => {
    const workboxPath = path.resolve(distPath, 'workbox-*.js');
    const files = fs.readdirSync(distPath);
    const hasWorkbox = files.some(f => f.startsWith('workbox-'));
    expect(hasWorkbox).toBe(true);
  });

  it('should generate registerSW.js in dist', () => {
    const registerPath = path.resolve(distPath, 'registerSW.js');
    expect(existsSync(registerPath)).toBe(true);
  });

  it('service worker should use workbox', () => {
    const swPath = path.resolve(distPath, 'sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    expect(swContent).toContain('workbox');
  });

  it('service worker should precache assets', () => {
    const swPath = path.resolve(distPath, 'sw.js');
    const swContent = fs.readFileSync(swPath, 'utf-8');
    expect(swContent).toContain('precacheAndRoute');
  });

  it('index.html should be linked to manifest', () => {
    const indexHtmlPath = path.resolve(__dirname, '../../../dist/public/index.html');
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).toContain('<link rel="manifest"');
  });

  it('index.html should have iOS meta tags', () => {
    const indexHtmlPath = path.resolve(__dirname, '../../../dist/public/index.html');
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    expect(html).toContain('apple-mobile-web-app-capable');
  });
});