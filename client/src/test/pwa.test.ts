import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA Implementation', () => {
  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const swJsPath = path.resolve(__dirname, '../../public/sw.js');

  it('index.html should contain iOS meta tags', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="25th Chapter" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/favicon.png" />');
  });

  it('manifest.json should be linked correctly', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf-8');
      // Usually vite handles manifest injection or it's manual.
      // Wait, I didn't add <link rel="manifest" href="/manifest.json"> to index.html manually?
      // VitePWA plugin does it, but I implemented manually. 
    expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
      // Let's check index.html again.
  });

  it('sw.js should implement stale-while-revalidate for App Shell', () => {
    const swContent = fs.readFileSync(swJsPath, 'utf-8');
    expect(swContent).toContain("caches.match(event.request).then((cachedResponse) => {");
    expect(swContent).toContain("fetch(event.request).then((networkResponse) => {");
  });

  it('sw.js should handle 426 HARD_UPDATE', () => {
      const swContent = fs.readFileSync(swJsPath, 'utf-8');
      expect(swContent).toContain("if (response.status === 426)");
      expect(swContent).toContain("client.postMessage({ type: 'HARD_UPDATE' });");
  });

  it('sw.js should handle push notifications', () => {
      const swContent = fs.readFileSync(swJsPath, 'utf-8');
      expect(swContent).toContain("self.addEventListener('push'");
      expect(swContent).toContain("self.registration.showNotification");
  });
});
