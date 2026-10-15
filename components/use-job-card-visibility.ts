"use client";
import { useEffect, useState } from "react";

const STORAGE = "resume-builder.job-card-visibility.v1";

export function useJobCardVisibility() {
  const [collapsedJobs, setCollapsedJobs] = useState<Record<string, boolean>>(
    {},
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        setCollapsedJobs(
          Object.fromEntries(
            Object.entries(saved).filter(
              (entry): entry is [string, boolean] =>
                typeof entry[1] === "boolean",
            ),
          ),
        );
    } catch {
      // Invalid preferences leave the cards expanded.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(collapsedJobs));
    } catch {
      // Cards can still be collapsed when browser storage is unavailable.
    }
  }, [collapsedJobs, ready]);

  return [collapsedJobs, setCollapsedJobs] as const;
}
