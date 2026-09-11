import { usePWAUpdate } from '../../hooks/use-pwa-update';

export function UpdatePrompt() {
  const { updateError } = usePWAUpdate();

  if (updateError) {
    return (
      <div className="fixed bottom-2 right-2 z-50 bg-destructive/10 border border-destructive p-2 rounded-md max-w-sm">
        <p className="text-destructive text-sm">{updateError}</p>
      </div>
    );
  }

  return null;
}