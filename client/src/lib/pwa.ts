import { trackEvent } from './analytics';

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered: ', registration);
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    });

    // Detect PWA installation
    window.addEventListener('appinstalled', () => {
      trackEvent('PWA Installed');
      console.log('PWA was installed');
    });

    // We cannot reliably detect uninstallation (deletion) from the client side 
    // because the app is removed from the device entirely.
    // However, we can track if the user launches in standalone mode vs browser
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    trackEvent('App Launch', { mode: isStandalone ? 'standalone' : 'browser' });
  }
}
