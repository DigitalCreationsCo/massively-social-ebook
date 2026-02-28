import { useState, useCallback, useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import type { Session } from "@shared/schema";

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const subscribeUser = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push messaging is not supported');
      }

      const registration = await navigator.serviceWorker.ready;
      
      // Check for existing subscription
      let subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        setIsSubscribed(true);
        console.log('User is already subscribed:', subscription);
        return; // Already subscribed
      }

      // VAPID Public Key (This should come from server config usually)
      // For now, I'll use a placeholder or check if server provides one.
      // If server uses FCM, we might need a different approach.
      // Assuming standard Web Push with VAPID for now as per prompt "Unified Listener... in SW".
      const vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIhbQFLXYp5Nksh8U'; 
      // NOTE: This is a placeholder key. In production, this must match the private key on server.

      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });

      console.log('User is subscribed:', subscription);

      // Send subscription to server
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
      });

      setIsSubscribed(true);
      toast({
        title: "Subscribed!",
        description: "You will now receive updates for new chapters.",
      });

    } catch (err) {
      console.error('Failed to subscribe the user: ', err);
      toast({
        title: "Subscription Failed",
        description: "Could not subscribe to push notifications.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);
  const checkSubscription = useCallback(async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        setIsSubscribed(true);
      }
    }
  }, []);
  const scheduleLocalReminders = useCallback((session: Session) => {
    if (!('Notification' in window)) {
      console.log('This browser does not support desktop notification');
      return;
    }

    if (Notification.permission !== 'granted') {
      console.log('Notifications not granted for local reminders');
      return;
    }

    const start = new Date(session.scheduledStart).getTime();
    const now = Date.now();
    
    // 15 minute warning
    const timeUntil15 = start - (15 * 60 * 1000) - now;
    if (timeUntil15 > 0) {
      setTimeout(() => {
        new Notification("Upcoming Session", {
          body: `${session.title} starts in 15 minutes.`,
          icon: '/favicon.png',
          tag: `session-${session.id}-15m`
        });
      }, timeUntil15);
    }

    // 5 minute warning
    const timeUntil5 = start - (5 * 60 * 1000) - now;
    if (timeUntil5 > 0) {
      setTimeout(() => {
        new Notification("Get Ready!", {
          body: `${session.title} starts in 5 minutes.`,
          icon: '/favicon.png',
          tag: `session-${session.id}-5m`
        });
      }, timeUntil5);
    }
    
    console.log(`Scheduled local reminders for session ${session.id}`);
  }, []);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  return { isSubscribed, isLoading, subscribeUser, scheduleLocalReminders };
}
