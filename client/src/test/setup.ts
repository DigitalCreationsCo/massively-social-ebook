import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
