"use client";
import { useCallback, useEffect, useState } from "react";
import type { AIConnection } from "@/lib/model";
import {
  loadAISettings,
  saveAISettings,
  AI_SETTINGS_STORAGE,
} from "@/lib/ai-settings";
export function useSavedAI() {
  const [connection, setConnection] = useState<AIConnection | null>(null);
  useEffect(() => {
    const restore = () => {
      try {
        setConnection(loadAISettings(localStorage));
      } catch {
        /* Storage may be disabled. */
      }
    };
    restore();
    const changed = (event: StorageEvent) => {
      if (event.key === AI_SETTINGS_STORAGE || event.key === null) restore();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const set = useCallback((next: AIConnection | null) => {
    setConnection(next);
    try {
      return saveAISettings(localStorage, next);
    } catch {
      return false;
    }
  }, []);
  return [connection, set] as const;
}
