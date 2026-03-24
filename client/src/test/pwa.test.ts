import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Manifest Integrity Suite', () => {
  const pathManifestFile = resolve(__dirname, './manifest.json');

  it('should exist in the expected directory', () => {
    const isManifestPresent = existsSync(pathManifestFile);

    if (!isManifestPresent) {
      console.error(`[TRACE] Critical Failure: Manifest not found at ${pathManifestFile}`);
    }

    expect(isManifestPresent).toBe(true);
  });

  it('should be a valid JSON format', () => {
    try {
      const contentManifestRaw = readFileSync(pathManifestFile, 'utf-8');
      const parsedManifestBody = JSON.parse(contentManifestRaw);

      // Verbose logging for CI/CD traceability
      console.log('[TRACE] Manifest successfully parsed. Root keys:', Object.keys(parsedManifestBody));

      expect(parsedManifestBody).toBeDefined();
      expect(typeof parsedManifestBody).toBe('object');
    } catch (errJsonParse: any) {
      console.error(`[DEBUG] JSON Parse Error: ${errJsonParse.message}`);
      throw new Error(`Failed to parse manifest.json: Ensure no trailing commas or comments exist.`);
    }
  });

  it('should contain required fields', () => {
    const contentManifestRaw = readFileSync(pathManifestFile, 'utf-8');
    const parsedManifestBody = JSON.parse(contentManifestRaw);

    // Explicitly defining required schema keys
    const listRequiredKeys = [ 'name', 'version', 'manifest_version' ];

    listRequiredKeys.forEach(strKey => {
      const hasKey = Object.prototype.hasOwnProperty.call(parsedManifestBody, strKey);

      if (!hasKey) {
        console.error(`[TRACE] Schema Violation: Missing required key "${strKey}"`);
      }

      expect(hasKey).toBe(true);
    });
  });
});

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
