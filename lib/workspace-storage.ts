import { z } from "zod";
import {
  resumeSchema,
  keywordSchema,
  jobStatuses,
  type Workspace,
} from "./model";
import { savedAssessmentSchema } from "./saved-matches";
import { referenceDocumentSchema } from "./reference-documents";
import { chatMessageSchema } from "./chat";
import { jobLinkSchema } from "./job-links";

export const WORKSPACE_STORAGE = "resume-builder.workspace.v1";
export const PAGE_STORAGE = "resume-builder.page-count.v1";
export const INSTRUCTIONS_STORAGE = "resume-builder.chat-instructions.v1";
const id = z.string().min(1).max(500);
export const storedWorkspaceSchema = z.object({
  templates: z
    .array(
      z.object({
        id,
        name: z.string().max(1000),
        sourceFile: z.string().max(1000),
        source: z.string().max(1000),
        docId: id,
      }),
    )
    .max(1000),
  docs: z.record(id, resumeSchema),
  jobs: z
    .array(
      z.object({
        id,
        templateId: z.string().max(500),
        title: z.string().max(500),
        company: z.string().max(500),
        location: z.string().max(500),
        source: z.string().max(1000),
        rawDescription: z.string().max(60000),
        keywords: z.array(keywordSchema).max(100),
        url: z.string().optional(),
        additionalUrls: z.array(jobLinkSchema).max(19).optional(),
        tailoredDocId: id.optional(),
        assessment: savedAssessmentSchema.optional(),
        status: z.enum(jobStatuses).optional(),
      }),
    )
    .max(1000),
  references: z.array(referenceDocumentSchema).max(30).optional(),
  notes: z
    .array(z.object({ id, text: z.string().max(30000), createdAt: z.string() }))
    .max(10000),
  selectedJobId: z.string().nullable(),
  viewTemplateId: z.string().nullable(),
});

export function parseWorkspace(value: unknown): Workspace {
  const w = storedWorkspaceSchema.parse(value);
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(w.templates.map((t) => t.id)) ||
    !unique(w.jobs.map((j) => j.id)) ||
    !unique((w.references || []).map((r) => r.id)) ||
    !unique(w.notes.map((n) => n.id)) ||
    w.templates.some((t) => !Object.hasOwn(w.docs, t.docId)) ||
    w.jobs.some(
      (j) =>
        (j.templateId && !w.templates.some((t) => t.id === j.templateId)) ||
        (j.tailoredDocId && !Object.hasOwn(w.docs, j.tailoredDocId)),
    ) ||
    (w.viewTemplateId !== null &&
      !w.templates.some((t) => t.id === w.viewTemplateId)) ||
    (w.selectedJobId !== null && !w.jobs.some((j) => j.id === w.selectedJobId))
  ) {
    throw new Error(
      "Invalid workspace relationships. Existing saved data has been preserved.",
    );
  }
  return w;
}

export const pagePreferenceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.null(),
]);
export const revisionSchema = z.number().int().nonnegative();
export const historySchema = z.array(chatMessageSchema).max(10000);
export const chatScopeSchema = z
  .string()
  .max(505)
  .refine((s) => s === "workspace" || /^job:.+/.test(s));
export const settingsSchema = z.object({ instructions: z.string().max(6000) });
export const sourceSchema = z.object({
  id,
  name: z.string().min(1).max(1000),
  text: z.string().max(2_000_000),
  mime: z.string().max(200),
  data: z
    .string()
    .max(14_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const recoveryBundleSchema = z.object({
  format: z.literal("resume-builder-backup"),
  version: z.literal(1),
  exportedAt: z.string(),
  origin: z.string().optional(),
  workspace: storedWorkspaceSchema,
  preferredPages: pagePreferenceSchema,
  chats: z.record(chatScopeSchema, historySchema),
  settings: settingsSchema,
  sources: z.array(sourceSchema).max(2030),
  missingSources: z.array(z.string()).optional(),
});
export type RecoveryBundle = z.infer<typeof recoveryBundleSchema>;
export type StoredSource = z.infer<typeof sourceSchema>;
export type WorkspaceState = {
  workspace: Workspace;
  preferredPages: 1 | 2 | null;
  revision: number;
  generation: number;
  initialized: boolean;
  backupWarning?: string;
};
export function sourceIds(w: Workspace) {
  return [
    ...w.templates.map((t) => t.id),
    ...(w.references || []).map((r) => `reference:${r.id}`),
  ];
}
export function expectedSourceIds(w: Workspace) {
  return [
    ...w.templates
      .filter((t) => /\.(pdf|docx)$/i.test(t.sourceFile))
      .map((t) => t.id),
    ...(w.references || []).map((r) => `reference:${r.id}`),
  ];
}
export function parseBundle(value: unknown): RecoveryBundle {
  const bundle = recoveryBundleSchema.parse(value);
  bundle.workspace = parseWorkspace(bundle.workspace);
  const ids = bundle.sources.map((s) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate original files in this backup.");
  const allowed = new Set(sourceIds(bundle.workspace));
  if (ids.some((id) => !allowed.has(id)))
    throw new Error("Backup contains an unrelated original file.");
  bundle.missingSources = expectedSourceIds(bundle.workspace).filter(
    (id) => !ids.includes(id),
  );
  return bundle;
}
