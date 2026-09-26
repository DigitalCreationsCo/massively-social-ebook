import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Several server modules construct clients at import time and throw when the
// credential is missing, so a test that merely imports a route fails before it
// can assert anything. Unit tests must not need real credentials: these are
// syntactically valid placeholders and nothing sends on them. Tests that assert
// on delivery mock the client.
process.env.RESEND_API_KEY ??= 're_test_placeholder';
// sendEmail rejects a configured client without a from-address, so supply one
// here rather than in each suite that exercises the real implementation.
process.env.RESEND_FROM_EMAIL ??= 'test@25thchapter.com';
// server/db throws at import time without this. pg.Pool connects lazily, so a
// placeholder does not open a socket; a test that queries still fails loudly.
process.env.DATABASE_URL ??= 'postgres://localhost:5432/mse_test';

// Mock matchMedia if not available in jsdom
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock mixpanel to prevent errors in tests
vi.mock('mixpanel-browser', () => ({
  default: {
    init: vi.fn(),
    track: vi.fn(),
    identify: vi.fn(),
    people: {
      set: vi.fn(),
    },
  },
}));

// Mock AudioContext for jsdom (used by audio-manager.ts / use-tts.ts)
if (typeof window !== 'undefined' && typeof window.AudioContext === 'undefined') {
  class MockAudioContext {
    state = 'running';
    destination = {};

    createBufferSource() {
      return {
        buffer: null,
        connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
        start: vi.fn(),
        stop: vi.fn(),
      } as unknown as AudioBufferSourceNode;
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as GainNode;
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }
  }

  window.AudioContext = MockAudioContext as unknown as typeof AudioContext;
}
