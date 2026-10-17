"use client";
import { useEffect, useState } from "react";
import type { JobListFilters } from "@/lib/job-list";

const STORAGE = "resume-builder.job-filters.v1";
type Filters = Required<JobListFilters>;
const emptyFilters: Filters = {
  query: "",
  status: "",
  templateId: "",
  companies: [],
};

export function useJobFilters() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(STORAGE) || "null",
      );
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const value = saved as Record<string, unknown>;
        setFilters({
          query: typeof value.query === "string" ? value.query : "",
          status:
            typeof value.status === "string" &&
            ["", "none", "to-apply", "applied", "rejected"].includes(
              value.status,
            )
              ? value.status
              : "",
          templateId:
            typeof value.templateId === "string" ? value.templateId : "",
          companies: Array.isArray(value.companies)
            ? [
                ...new Set(
                  value.companies.filter(
                    (company): company is string => typeof company === "string",
                  ),
                ),
              ]
            : [],
        });
      }
    } catch {
      // Invalid or unavailable browser storage leaves the list unfiltered.
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(filters));
    } catch {
      // Filtering remains available if browser preferences cannot be saved.
    }
  }, [filters, ready]);
  return [filters, setFilters] as const;
}
