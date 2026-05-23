import React from 'react';
import { usePushNotifications } from '../../hooks/use-push-notifications';
import { Bell, BellOff } from 'lucide-react';

export function PushToggle() {
  const { isSubscribed, isLoading, subscribeUser } = usePushNotifications();

  // If already subscribed, we might want to show "Unsubscribe" (not implemented in hook yet)
  // Or just show "Notifications On".
  // For now, if subscribed, just show static indicator or disable button.

  if (isSubscribed) {
    return (
      <>
        {/* <button
        disabled
        className="flex items-center gap-2 text-sm text-green-500 font-medium px-3 py-1.5 border border-green-500/20 bg-green-500/10 rounded-full"
      >
        <Bell className="w-4 h-4" />
        <span>Updates On</span>
      </button> */}
      </>
    )
  }

  return (
    <button
      onClick={subscribeUser}
      disabled={isLoading}
      className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium px-3 py-1.5 border-primary/20 hover:bg-primary/5 rounded-full transition-colors"
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <BellOff className="w-4 h-4" />
      )}
      <span>Turn on notifications</span>
    </button>
  );
}
