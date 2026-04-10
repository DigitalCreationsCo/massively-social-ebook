import { usePWAUpdate } from '../../hooks/use-pwa-update';

export function UpdatePrompt() {
  const { updateError } = usePWAUpdate();

  if (updateError) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-destructive/10 border border-destructive p-4 rounded-lg max-w-sm">
        <p className="text-destructive text-sm">{updateError}</p>
      </div>
    );
  }

  return null;
}