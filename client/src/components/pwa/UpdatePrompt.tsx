import React from 'react';
import { trackEvent } from '@/lib/analytics';
import { usePWAUpdate } from '../../hooks/use-pwa-update';

export function UpdatePrompt() {
  const { isUpdateAvailable, isHardUpdate, updateApp } = usePWAUpdate();

  if (isHardUpdate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="bg-destructive text-destructive-foreground p-6 rounded-lg shadow-lg max-w-md w-full text-center">
          <h2 className="text-2xl font-bold mb-4">Critical Update Required</h2>
          <p className="mb-6">
            A critical update is required to continue using the application.
            Please refresh to apply the latest changes.
          </p>
          <button
            onClick={() => {
              trackEvent('PWA Hard Refresh Clicked');
              localStorage.removeItem('pwa_hard_update');
              window.location.reload();
            }}
            className="bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90 transition-colors"
          >
            Refresh Now
          </button>
        </div>
      </div>
    );
  }

  if (isUpdateAvailable) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-background border border-border p-4 rounded-lg shadow-lg max-w-sm w-full animate-in slide-in-from-bottom-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">Update Available</h3>
            <p className="text-sm text-muted-foreground mt-1">
              A new version is available. Update now to get the latest features.
            </p>
          </div>
          <button
            onClick={() => {
              trackEvent('PWA Update Clicked');
              updateApp();
            }}
            className="bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            Update
          </button>
        </div>
      </div>
    );
  }

  return null;
}
