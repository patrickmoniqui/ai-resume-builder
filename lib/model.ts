import type { ReferenceDocument } from "./reference-documents";
import type { SavedAssessment } from "./saved-matches";
import { z } from "zod";
export const resumeSchema = z.object({
  sectionOrder: z
    .array(
      z.union([
        z.enum(["summary", "experience", "skills", "education"]),
        z.string().regex(/^extra-(?:[0-9]|[12][0-9])$/),
      ]),
    )
    .max(34)
    .optional(),
  extraSections: z
    .array(
      z.object({
        title: z.string().max(300),
        text: z.string().max(30000),
      }),
    )
    .max(30)
    .optional(),
  pageCount: z.union([z.literal(1), z.literal(2)]).optional(),
  name: z.string().max(300),
  headline: z.string().max(500),
  contact: z.string().max(1500),
  summary: z.string().max(10000),
  roles: z
    .array(
      z.object({
        title: z.string().max(500),
        company: z.string().max(500),
        dates: z.string().max(200),
        bullets: z.array(z.string().max(5000)).max(100),
      }),
    )
    .max(30),
  skills: z.string().max(10000),
  edu: z
    .array(
      z.object({
        degree: z.string().max(500),
        school: z.string().max(500),
        dates: z.string().max(200),
      }),
    )
    .max(30),
});
export type Resume = z.infer<typeof resumeSchema>;
export const keywordSchema = z.object({
  term: z.string().min(1).max(100),
  category: z.enum(["Hard skills", "Tools", "Domain", "Soft skills"]),
  required: z.boolean(),
  aliases: z.array(z.string().min(1).max(100)).optional(),
});
export type Keyword = z.infer<typeof keywordSchema>;
export const jobInputSchema = z.object({
  title: z.string().min(1).max(500),
  company: z.string().min(1).max(500),
  location: z.string().max(500),
  rawDescription: z.string().max(60000),
  keywords: z.array(keywordSchema).min(1).max(100),
});
export const jobStatuses = ["to-apply", "applied", "rejected"] as const;
export type JobStatus = (typeof jobStatuses)[number];
export type Job = z.infer<typeof jobInputSchema> & {
  id: string;
  templateId: string;
  source: string;
  url?: string;
  additionalUrls?: string[];
  tailoredDocId?: string;
  assessment?: SavedAssessment;
  comparisonDocIds?: string[];
  comparisonAssessments?: Record<string, SavedAssessment>;
  status?: JobStatus;
};
export function moveJob(jobs: Job[], id: string, to: number): Job[] {
  const from = jobs.findIndex((j) => j.id === id);
  if (from < 0 || !Number.isInteger(to)) return jobs;
  const target = Math.max(0, Math.min(jobs.length - 1, to));
  if (from === target) return jobs;
  const next = [...jobs];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
export type Template = {
  id: string;
  name: string;
  sourceFile: string;
  source: string;
  docId: string;
};
export type Note = { id: string; text: string; createdAt: string };
export type Workspace = {
  templates: Template[];
  docs: Record<string, Resume>;
  jobs: Job[];
  notes: Note[];
  references?: ReferenceDocument[];
  selectedJobId: string | null;
  viewTemplateId: string | null;
};
export const aiConnectionSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("apiKey"),
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().min(1).max(100),
    key: z.string().min(1).max(1000),
  }),
  z.object({
    method: z.literal("subscription"),
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().max(100),
  }),
]);
export type AIConnection = z.infer<typeof aiConnectionSchema>;
export const aiProviderName = (
  provider: AIConnection["provider"],
  method: AIConnection["method"],
) =>
  provider === "anthropic"
    ? "Claude"
    : method === "subscription"
      ? "Codex"
      : "OpenAI";
export const suggestionSchema = z.object({
  keyword: z.string().max(100),
  roleIndex: z.number().int().nonnegative(),
  bullet: z.string().min(1).max(5000),
});
export type Suggestion = z.infer<typeof suggestionSchema>;
export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Splits a skills line like "Frontend: React, Vue" so the label can be bold.
export function skillLabel(line: string) {
  const match = line.match(/^([^:•▪●\n]{1,60}):\s+(\S.*)$/);
  return match
    ? { lead: match[1] + ": ", text: match[2] }
    : { lead: "", text: line };
}
export function fullText(doc: Resume) {
  return [
    doc.name,
    doc.headline,
    doc.contact,
    doc.summary,
    doc.skills,
    ...doc.roles.flatMap((r) => [r.title, r.company, r.dates, ...r.bullets]),
    ...doc.edu.flatMap((e) => [e.degree, e.school, e.dates]),
    ...(doc.extraSections || []).flatMap((s) => [s.title, s.text]),
  ].join("\n");
}
export function documentId(w: Workspace) {
  if (w.viewTemplateId)
    return w.templates.find((t) => t.id === w.viewTemplateId)?.docId;
  const j = w.jobs.find((j) => j.id === w.selectedJobId);
  return (
    j?.tailoredDocId || w.templates.find((t) => t.id === j?.templateId)?.docId
  );
}
export function updateDocument(
  w: Workspace,
  change: (doc: Resume) => Resume,
  fork = false,
): Workspace {
  let id = documentId(w);
  if (!id || !w.docs[id]) return w;
  let jobs = w.jobs;
  if (fork && !w.viewTemplateId) {
    const job = w.jobs.find((j) => j.id === w.selectedJobId);
    if (job && !job.tailoredDocId) {
      id = "j:" + job.id;
      jobs = w.jobs.map((j) =>
        j.id === job.id ? { ...j, tailoredDocId: id } : j,
      );
    }
  }
  return {
    ...w,
    jobs,
    docs: { ...w.docs, [id]: change(structuredClone(w.docs[documentId(w)!])) },
  };
}
export function jobDocument(w: Workspace, j: Job) {
  return w.docs[
    j.tailoredDocId ||
      w.templates.find((t) => t.id === j.templateId)?.docId ||
      ""
  ];
}
export function tier(pct: number) {
  return pct >= 75
    ? "Strong match"
    : pct >= 55
      ? "Partial match"
      : "Weak match";
}

export function deleteTemplate(
  w: Workspace,
  templateId: string,
  replacementId = "",
): Workspace {
  const removed = w.templates.find((t) => t.id === templateId);
  if (!removed) return w;
  const templates = w.templates.filter((t) => t.id !== templateId);
  if (replacementId && !templates.some((t) => t.id === replacementId))
    throw new Error("Choose an existing replacement template.");
  const docs = { ...w.docs };
  delete docs[removed.docId];
  return {
    ...w,
    templates,
    docs,
    jobs: w.jobs.map((j) =>
      j.templateId === templateId ? { ...j, templateId: replacementId } : j,
    ),
    viewTemplateId:
      w.viewTemplateId === templateId
        ? replacementId || templates[0]?.id || null
        : w.viewTemplateId,
  };
}

export type ExperienceRole = { role: Resume["roles"][number]; index: number };
export type ExperienceCompany = { company: string; roles: ExperienceRole[] };
/** Group adjacent entries only, preserving chronology and original AI role indices. */
export function groupExperience(
  roles: Resume["roles"],
  editing: { company?: number[] } = {},
): ExperienceCompany[] {
  const groups: ExperienceCompany[] = [];
  const key = (s: string) => s.trim().toLocaleLowerCase();
  let previousCompany = "";
  roles.forEach((role, index) => {
    const companyKey = editing.company?.includes(index)
      ? "editing-company"
      : role.company.trim()
        ? `company:${key(role.company)}`
        : `empty:${index}`;
    let company = groups.at(-1);
    if (!company || companyKey !== previousCompany) {
      company = { company: role.company, roles: [] };
      groups.push(company);
    }
    company.roles.push({ role, index });
    previousCompany = companyKey;
  });
  return groups;
}
export function insertExperienceRole(
  doc: Resume,
  afterIndex: number,
  company = "",
): Resume {
  const roles = [...doc.roles];
  roles.splice(afterIndex + 1, 0, {
    company,
    title: "",
    dates: "",
    bullets: [],
  });
  return { ...doc, roles };
}
export function hasRoleContent(role: Resume["roles"][number]) {
  return !!(
    role.title.trim() ||
    role.dates.trim() ||
    role.bullets.some((b) => b.trim())
  );
}
/**
 * A role with no title, dates or bullets can be removed unless it is the only
 * entry carrying its company name: a company with no roles is stored that way.
 */
export function isBlankRole(roles: Resume["roles"], index: number) {
  const role = roles[index];
  if (!role || hasRoleContent(role)) return false;
  const company = role.company.trim();
  return (
    !company ||
    roles.some((r, i) => i !== index && r.company.trim() === company)
  );
}
export function removeExperienceRole(doc: Resume, index: number): Resume {
  return { ...doc, roles: doc.roles.filter((_, i) => i !== index) };
}
/** Drops blank roles, keeping `keep`; returns that role's index afterwards. */
export function pruneBlankRoles(
  doc: Resume,
  keep = -1,
): { doc: Resume; index: number } {
  const roles = [...doc.roles];
  let index = keep;
  // Back to front, so each check sees the roles still remaining.
  for (let i = roles.length - 1; i >= 0; i--)
    if (i !== keep && isBlankRole(roles, i)) {
      roles.splice(i, 1);
      if (i < index) index--;
    }
  return {
    doc: roles.length === doc.roles.length ? doc : { ...doc, roles },
    index,
  };
}
export function resumeSections(doc: Resume) {
  const available = [
    { id: "summary", title: "Summary" },
    { id: "experience", title: "Experience" },
    { id: "skills", title: "Skills" },
    { id: "education", title: "Education" },
    ...(doc.extraSections || []).map((s, i) => ({
      id: `extra-${i}`,
      title: s.title,
    })),
  ];
  const order = [
    ...new Set([...(doc.sectionOrder || []), ...available.map((s) => s.id)]),
  ];
  return order.flatMap((id) => {
    const section = available.find((s) => s.id === id);
    return section ? [section] : [];
  });
}
export function moveResumeSection(doc: Resume, id: string, to: number): Resume {
  const order = resumeSections(doc).map((s) => s.id);
  const from = order.indexOf(id);
  if (from < 0 || !Number.isInteger(to)) return doc;
  const target = Math.max(0, Math.min(order.length - 1, to));
  if (from === target) return doc;
  order.splice(from, 1);
  order.splice(target, 0, id);
  return { ...doc, sectionOrder: order };
}
