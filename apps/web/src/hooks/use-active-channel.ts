import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "nexu:activeChannelId";

/**
 * Hook to manage the active channel state in localStorage.
 *
 * The "active" channel is a UI-only concept - it determines which channel
 * the CTA button links to and which channel is visually highlighted.
 *
 * @param connectedChannelIds - Array of currently connected channel IDs
 * @returns [activeChannelId, setActiveChannelId]
 */
export function useActiveChannel(
  connectedChannelIds: string[],
): [string | null, (id: string | null) => void] {
  const [activeChannelId, setActiveChannelIdState] = useState<string | null>(
    () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored;
      } catch {
        return null;
      }
    },
  );

  // Sync with localStorage
  const setActiveChannelId = useCallback((id: string | null) => {
    setActiveChannelIdState(id);
    try {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Auto-select first connected channel if none selected or if selected channel is disconnected
  useEffect(() => {
    if (connectedChannelIds.length === 0) {
      // No channels connected - clear active
      if (activeChannelId !== null) {
        setActiveChannelId(null);
      }
      return;
    }

    // If no active channel or active channel is no longer connected, select first
    if (
      activeChannelId === null ||
      !connectedChannelIds.includes(activeChannelId)
    ) {
      setActiveChannelId(connectedChannelIds[0] ?? null);
    }
  }, [connectedChannelIds, activeChannelId, setActiveChannelId]);

  return [activeChannelId, setActiveChannelId];
}
