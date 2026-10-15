import { moveJob, type Job } from "./model";

export type JobListFilters = {
  query: string;
  status: string;
  templateId: string;
};

function searchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function filterJobs(jobs: Job[], filters: JobListFilters) {
  const terms = searchText(filters.query).trim().split(/\s+/).filter(Boolean);
  return jobs.filter((job) => {
    if (
      filters.status &&
      (filters.status === "none" ? !!job.status : job.status !== filters.status)
    )
      return false;
    if (
      filters.templateId &&
      (filters.templateId === "__none__"
        ? !!job.templateId
        : job.templateId !== filters.templateId)
    )
      return false;
    const text = searchText(
      [
        job.company,
        job.title,
        job.location,
        ...job.keywords.map((k) => k.term),
      ].join(" "),
    );
    return terms.every((term) => text.includes(term));
  });
}

// Reorder the displayed jobs while leaving hidden jobs in their existing slots.
export function reorderVisibleJobs(
  jobs: Job[],
  visibleIds: string[],
  id: string,
  to: number,
) {
  const ids = new Set(visibleIds);
  const visible = jobs.filter((job) => ids.has(job.id));
  const reordered = moveJob(visible, id, to);
  if (visible === reordered) return jobs;
  let index = 0;
  return jobs.map((job) => (ids.has(job.id) ? reordered[index++] : job));
}
