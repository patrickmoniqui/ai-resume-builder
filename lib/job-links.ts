import { z } from "zod";
import type { Job } from "./model";

export const jobLinkSchema = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS job link.");

export function jobLinks(job: Pick<Job, "url" | "additionalUrls">): string[] {
  return [
    ...new Set(
      [job.url, ...(job.additionalUrls || [])].filter(
        (url): url is string => !!url && jobLinkSchema.safeParse(url).success,
      ),
    ),
  ];
}

export function withJobLinks<T extends Pick<Job, "url" | "additionalUrls">>(
  job: T,
  links: string[],
): T {
  return { ...job, url: links[0], additionalUrls: links.slice(1) };
}
