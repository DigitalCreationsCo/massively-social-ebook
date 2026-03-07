import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VersionOverlay } from '../VersionOverlay';
import pkg from "../../../../package.json";

describe('VersionOverlay Component Logic', () => {
    const originalEnv = import.meta.env;

    beforeEach(() => {
        vi.resetModules();
        // Reset env to a clean state
        (import.meta.env as any) = { ...originalEnv };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should display the full build tag in production when VITE_APP_BUILD_TAG is present', () => {
        const mockTag = "v1.2.3-build.456";
        (import.meta.env as any).PROD = true;
        (import.meta.env as any).VITE_APP_BUILD_TAG = mockTag;

        render(<VersionOverlay />);
        expect(screen.getByText(mockTag)).toBeDefined();
    });

    it('should fallback to local dev string when VITE_APP_BUILD_TAG is missing', () => {
        (import.meta.env as any).PROD = false;
        (import.meta.env as any).VITE_APP_BUILD_TAG = undefined;

        render(<VersionOverlay />);
        expect(screen.getByText(`v${pkg.version}-dev.local`)).toBeDefined();
    });

    it('should handle edge case where PROD is true but build tag failed to bake in', () => {
        // This identifies the "Silent Metadata Loss" root cause
        (import.meta.env as any).PROD = true;
        (import.meta.env as any).VITE_APP_BUILD_TAG = undefined;

        render(<VersionOverlay />);
        expect(screen.getByText(`v${pkg.version}-dev.local`)).toBeDefined();
    });
});