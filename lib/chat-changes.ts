import { z } from "zod";
import {
  documentId,
  resumeSchema,
  updateDocument,
  type Resume,
  type Workspace,
} from "./model";

export const chatFieldPattern =
  /^(?:name|headline|contact|summary|skills|roles\.(?:[0-9]|[12][0-9])\.(?:title|company|dates|bullets\.(?:[0-9]|[1-9][0-9]))|edu\.(?:[0-9]|[12][0-9])\.(?:degree|school|dates)|extraSections\.(?:[0-9]|[12][0-9])\.(?:title|text))$/;
export const chatEditSchema = z.object({
  field: z.string().regex(chatFieldPattern),
  before: z.string().max(30000),
  after: z.string().max(30000),
  reason: z.string().min(1).max(1000),
});
export const chatChangeSchema = chatEditSchema.extend({
  label: z.string().max(1200),
  target: z.object({
    kind: z.enum(["job", "template"]),
    id: z.string().min(1),
    docId: z.string().min(1),
    templateId: z.string().optional(),
    label: z.string().max(1200),
  }),
  anchor: z.string().max(32000),
  status: z.enum(["applied", "dismissed"]).optional(),
});
export type ChatEdit = z.infer<typeof chatEditSchema>;
export type ChatChange = z.infer<typeof chatChangeSchema>;

export function editableChatResume(workspace: Workspace) {
  const docId = documentId(workspace);
  const doc = docId && workspace.docs[docId];
  if (!doc || !docId) return undefined;
  const template = workspace.templates.find(
    (t) => t.id === workspace.viewTemplateId,
  );
  const job =
    !workspace.viewTemplateId &&
    workspace.jobs.find((j) => j.id === workspace.selectedJobId);
  const target: ChatChange["target"] | undefined = template
    ? { kind: "template", id: template.id, docId, label: template.name }
    : job
      ? {
          kind: "job",
          id: job.id,
          docId,
          templateId: job.templateId,
          label: `${job.company} · ${job.title}`,
        }
      : undefined;
  return target ? { target, doc } : undefined;
}

function fieldInfo(doc: Resume, field: string) {
  if (!chatFieldPattern.test(field)) return undefined;
  const parts = field.split(".");
  if (parts.length === 1) {
    const key = parts[0] as
      "name" | "headline" | "contact" | "summary" | "skills";
    return {
      value: doc[key],
      anchor: "",
      label: key[0].toUpperCase() + key.slice(1),
      write: (value: string) => {
        doc[key] = value;
      },
    };
  }
  const index = Number(parts[1]);
  if (parts[0] === "roles") {
    const role = doc.roles[index];
    if (!role) return undefined;
    const identity = {
      title: role.title,
      company: role.company,
      dates: role.dates,
    };
    if (parts[2] === "bullets") {
      const bulletIndex = Number(parts[3]);
      if (bulletIndex > role.bullets.length) return undefined;
      return {
        value: role.bullets[bulletIndex] ?? "",
        anchor: JSON.stringify(identity),
        label: `${role.company || role.title || "Experience"} · Bullet ${bulletIndex + 1}`,
        write: (value: string) => {
          role.bullets[bulletIndex] = value;
        },
      };
    }
    const key = parts[2] as keyof typeof identity;
    const { [key]: ignored, ...anchor } = identity;
    void ignored;
    return {
      value: role[key] || "",
      anchor: JSON.stringify(anchor),
      label: `${role.company || "Experience"} · ${key}`,
      write: (value: string) => {
        role[key] = value;
      },
    };
  }
  if (parts[0] === "edu") {
    const education = doc.edu[index];
    if (!education) return undefined;
    const key = parts[2] as keyof typeof education;
    const { [key]: ignored, ...anchor } = education;
    void ignored;
    return {
      value: education[key],
      anchor: JSON.stringify(anchor),
      label: `Education ${index + 1} · ${key}`,
      write: (value: string) => {
        education[key] = value;
      },
    };
  }
  const section = doc.extraSections?.[index];
  if (!section) return undefined;
  const key = parts[2] as keyof typeof section;
  const { [key]: ignored, ...anchor } = section;
  void ignored;
  return {
    value: section[key],
    anchor: JSON.stringify(anchor),
    label: `${section.title || "Extra section"} · ${key}`,
    write: (value: string) => {
      section[key] = value;
    },
  };
}

function editedResume(doc: Resume, edit: ChatEdit) {
  const next = structuredClone(doc);
  const field = fieldInfo(next, edit.field);
  if (!field || field.value !== edit.before || edit.before === edit.after)
    return undefined;
  field.write(edit.after);
  const result = resumeSchema.safeParse(next);
  return result.success ? result.data : undefined;
}

export function prepareChatChanges(
  workspace: Workspace,
  edits: ChatEdit[],
): ChatChange[] {
  const current = editableChatResume(workspace);
  if (!current) return [];
  const fields = new Set<string>();
  return edits.flatMap((edit) => {
    const field = fieldInfo(current.doc, edit.field);
    if (!field || fields.has(edit.field) || !editedResume(current.doc, edit))
      return [];
    fields.add(edit.field);
    return [
      {
        ...edit,
        label: field.label,
        target: current.target,
        anchor: field.anchor,
      },
    ];
  });
}

export function chatChangeState(workspace: Workspace, change: ChatChange) {
  const current = editableChatResume(workspace);
  const fallback = { label: change.label, state: "stale" as const };
  if (
    !current ||
    current.target.kind !== change.target.kind ||
    current.target.id !== change.target.id
  ) {
    return {
      ...fallback,
      message: `Open ${change.target.label} to review this change.`,
    };
  }
  const baseDocId = workspace.templates.find(
    (t) => t.id === change.target.templateId,
  )?.docId;
  const sameSource =
    current.target.docId === change.target.docId ||
    (change.target.kind === "job" &&
      change.target.docId === baseDocId &&
      current.target.docId === `j:${change.target.id}`);
  const field = fieldInfo(current.doc, change.field);
  if (
    !sameSource ||
    current.target.templateId !== change.target.templateId ||
    !field ||
    field.anchor !== change.anchor
  ) {
    return {
      ...fallback,
      message: "This resume changed. Ask for an updated suggestion.",
    };
  }
  if (field.value === change.after)
    return {
      label: field.label,
      state: "applied" as const,
      message: "Applied",
    };
  if (!editedResume(current.doc, change))
    return {
      label: field.label,
      state: "stale" as const,
      message: "This field changed. Ask for an updated suggestion.",
    };
  return { label: field.label, state: "ready" as const, message: "" };
}

export function applyChatChange(
  workspace: Workspace,
  change: ChatChange,
): Workspace {
  if (
    !chatChangeSchema.safeParse(change).success ||
    change.status === "dismissed" ||
    chatChangeState(workspace, change).state !== "ready"
  )
    return workspace;
  return updateDocument(
    workspace,
    (doc) => editedResume(doc, change) || doc,
    change.target.kind === "job",
  );
}
