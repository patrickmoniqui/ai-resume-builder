import { z } from "zod";
import {
  keywordSchema,
  pruneBlankRoles,
  type AIConnection,
  type Job,
  type Resume,
} from "./model";
import { matchOutputSchema, type ResumeMatch } from "./resume-match";
const resultSchema = matchOutputSchema
  .extend({
    items: z
      .array(keywordSchema.merge(matchOutputSchema.shape.items.element))
      .min(1)
      .max(100),
  })
  .transform((result) => ({
    ...result,
    matched: result.items.filter((i) => i.matched).length,
    required: result.items.filter((i) => i.required).length,
    requiredMatched: result.items.filter((i) => i.required && i.matched).length,
  }));
export const savedAssessmentSchema = z.object({
  result: resultSchema,
  assessedAt: z.string().datetime(),
  inputSignature: z.string().regex(/^[a-f0-9]{16}$/),
  provider: z.enum(["openai", "anthropic"]),
  method: z.enum(["apiKey", "subscription"]),
  model: z.string().max(100),
});
export type SavedAssessment = z.infer<typeof savedAssessmentSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
/** Change detection only; never used to score a resume. */
export function assessmentSignature(job: Job, doc: Resume): string {
  const text = JSON.stringify(
    canonical({
      resume: pruneBlankRoles(doc).doc,
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        rawDescription: job.rawDescription,
        keywords: job.keywords,
      },
    }),
  );
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
export function saveAssessment(
  connection: AIConnection,
  job: Job,
  doc: Resume,
  result: ResumeMatch,
): SavedAssessment {
  return {
    result,
    assessedAt: new Date().toISOString(),
    inputSignature: assessmentSignature(job, doc),
    provider: connection.provider,
    method: connection.method,
    model: connection.model,
  };
}
