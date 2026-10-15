import { pruneBlankRoles, type Resume, type Workspace } from "./model";

export function initialWorkspace(): Workspace {
  return {
    templates: [],
    docs: {},
    jobs: [],
    notes: [],
    references: [],
    selectedJobId: null,
    viewTemplateId: null,
  };
}

export function blankResume(): Resume {
  return {
    name: "",
    headline: "",
    contact: "",
    summary: "",
    roles: [],
    skills: "",
    edu: [],
  };
}

/** Remove data supplied by the old demo, retaining user imports, jobs and notes. */
export function migrateWorkspace(saved: Workspace): Workspace {
  const templates = saved.templates.filter(
    (t) => t.source !== "Example resume",
  );
  const templateIds = new Set(templates.map((t) => t.id));
  const jobs = saved.jobs
    .filter((j) => j.rawDescription !== "Example job from the design handoff.")
    .map((j) =>
      templateIds.has(j.templateId) || j.templateId === ""
        ? j
        : {
            ...j,
            templateId: templates[0]?.id || "",
            tailoredDocId: undefined,
          },
    );
  const docIds = new Set([
    ...templates.map((t) => t.docId),
    ...jobs.flatMap((j) => (j.tailoredDocId ? [j.tailoredDocId] : [])),
  ]);
  const selectedJobId = jobs.some((j) => j.id === saved.selectedJobId)
    ? saved.selectedJobId
    : jobs[0]?.id || null;
  const viewTemplateId = templateIds.has(saved.viewTemplateId || "")
    ? saved.viewTemplateId
    : selectedJobId
      ? null
      : templates[0]?.id || null;
  return {
    templates,
    jobs,
    docs: Object.fromEntries(
      Object.entries(saved.docs)
        .filter(([id]) => docIds.has(id))
        .map(([id, doc]) => [id, pruneBlankRoles(doc).doc]),
    ),
    notes: saved.notes.filter(
      (n) =>
        !(/^n[012]$/.test(n.id) && n.createdAt === new Date(0).toISOString()),
    ),
    references: saved.references || [],
    selectedJobId,
    viewTemplateId,
  };
}
