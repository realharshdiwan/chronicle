import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border border-amber-400/40 glass-panel px-3 py-1.5 text-xs font-medium text-amber-200 shadow-xl"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-300" aria-hidden="true" />
      <span>Offline mode — local IndexedDB workspace active</span>
    </div>
  );
}
