import { useState, useEffect, useCallback } from 'react';
import { trackEvent } from '@/lib/analytics';

const stateSyncChannel = new BroadcastChannel('app-sync');

export function usePWAUpdate() {
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      trackEvent('PWA Controller Changed');
      window.location.reload();
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'HARD_UPDATE') {
        trackEvent('PWA Hard Update Received');
      }
    });
  }, []);

  useEffect(() => {
    const handleSync = (event: MessageEvent) => {
      if (event.data && event.data.type === 'STATE_SYNC') {
        trackEvent('PWA State Sync');
        window.location.reload();
      }
    };

    stateSyncChannel.addEventListener('message', handleSync);
    return () => stateSyncChannel.removeEventListener('message', handleSync);
  }, []);

  return { updateError };
}