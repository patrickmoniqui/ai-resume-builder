"use client";
import { useEffect, useRef, useState } from "react";
import {
  locateMatchedSkill,
  findTermRange,
  type ResumeFocusTarget,
} from "@/lib/resume-focus";
import type { ResumeMatch } from "@/lib/resume-match";
import { referenceStorageKey } from "@/lib/reference-documents";
import ReferenceDocuments from "./reference-documents";
import { initialWorkspace, blankResume } from "@/lib/initial";
import {
  aiProviderName,
  documentId,
  deleteTemplate,
  groupExperience,
  resumeSections,
  moveResumeSection,
  jobStatuses,
  insertExperienceRole,
  hasRoleContent,
  type ExperienceCompany,
  isBlankRole,
  pruneBlankRoles,
  removeExperienceRole,
  updateDocument,
  tier,
  type Workspace,
  type Resume,
  type Job,
  type Suggestion,
} from "@/lib/model";
import { useAIMatches } from "./use-ai-matches";
import ResumeComparisons from "./resume-comparisons";
import { pendingAssessments } from "@/lib/resume-comparisons";
import { useResumeHistory } from "./use-resume-history";
import { usePanelWidths, PanelResizer } from "./resizable-panels";
import InlineField from "./inline-field";
import Dialog from "./dialog";
import { useSavedAI } from "./use-saved-ai";
import { filterJobs, reorderVisibleJobs } from "@/lib/job-list";
import { useJobFilters } from "./use-job-filters";
import SkillMatchList from "./skill-match-list";
import JobLinks from "./job-links";
import { jobLinks, jobLinkSchema, withJobLinks } from "@/lib/job-links";
import MatchingDiagnostics from "./matching-diagnostics";
import AIConnector from "./ai-connector";
import AIChat from "./ai-chat";
import {
  applyChatChange,
  chatChangeState,
  type ChatChange,
} from "@/lib/chat-changes";
import ResumeSourceViewer from "./resume-source";
import { useWorkspaceStorage } from "./use-workspace-storage";
import BackupRecovery from "./backup-recovery";
import {
  saveResumeSource,
  getResumeSource,
  deleteResumeSource,
} from "@/lib/resume-sources";
import { connectDrive, type DriveFile, downloadDriveFile } from "@/lib/drive";
const emptyDoc = blankResume();
const uid = () => crypto.randomUUID();
async function request(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(data.error || "Request failed. Please try again."),
      { code: data.code },
    );
  }
  return res;
}
function ScorePill({ pct }: { pct: number }) {
  return (
    <span
      className={
        "score-pill " + (pct >= 75 ? "strong" : pct >= 55 ? "partial" : "weak")
      }
    >
      {pct}%
    </span>
  );
}
export default function ResumeBuilder() {
  const history = useResumeHistory(initialWorkspace);
  const w = history.workspace,
    setW = history.set;
  const [preferredPages, setPreferredPages] = useState<1 | 2 | null>(null);
  const storage = useWorkspaceStorage(
    w,
    preferredPages,
    setW,
    setPreferredPages,
  );
  const [returnToJob, setReturnToJob] = useState(false);
  const [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [notesOpen, setNotesOpen] = useState(false),
    [noteDraft, setNoteDraft] = useState("");
  const panelWidths = usePanelWidths(left, right);
  const [editing, setEditing] = useState<string | null>(null),
    [focus, setFocus] = useState<string | null>(null),
    [highlightStyle, setHighlightStyle] = useState("marker");
  const [focusTarget, setFocusTarget] = useState<
    ResumeFocusTarget | undefined
  >();
  const focusRequest = useRef(0);
  const [deletingTemplate, setDeletingTemplate] = useState("");
  const [renamingTemplate, setRenamingTemplate] = useState("");
  const [resumeName, setResumeName] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  const [replacementTemplate, setReplacementTemplate] = useState("");
  const [chatResetKey, setChatResetKey] = useState(0);
  const workspaceEpoch = useRef(0);
  const referenceEpoch = workspaceEpoch.current;
  const [chatOpen, setChatOpen] = useState(false);
  const chatTrigger = useRef<HTMLButtonElement>(null);
  const [pdfPreview, setPdfPreview] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (pdfPreview) URL.revokeObjectURL(pdfPreview);
    },
    [pdfPreview],
  );
  const [draggingJob, setDraggingJob] = useState<string | null>(null),
    [dropJobIndex, setDropJobIndex] = useState<number | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"jobs" | "resumes">("jobs");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterControl = useRef<HTMLDivElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!filterControl.current?.contains(event.target as Node))
        setFiltersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFiltersOpen(false);
        filterTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [filtersOpen]);
  const [jobFilters, setJobFilters] = useJobFilters();
  const {
    query: jobSearch,
    status: jobStatusFilter,
    templateId: jobTemplateFilter,
    companies: jobCompanyFilter,
  } = jobFilters;
  const setJobSearch = (query: string) =>
    setJobFilters((current) => ({ ...current, query }));
  const setJobStatusFilter = (status: string) =>
    setJobFilters((current) => ({ ...current, status }));
  const setJobTemplateFilter = (templateId: string) =>
    setJobFilters((current) => ({ ...current, templateId }));
  const setJobCompanyFilter = (
    change: string[] | ((current: string[]) => string[]),
  ) =>
    setJobFilters((current) => ({
      ...current,
      companies:
        typeof change === "function" ? change(current.companies) : change,
    }));
  const jobCompanies = [
    ...new Set(w.jobs.map((job) => job.company).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const activeJobCompanyFilter = jobCompanyFilter.filter((company) =>
    jobCompanies.includes(company),
  );
  const activeJobTemplateFilter =
    jobTemplateFilter === "__none__" ||
    w.templates.some((t) => t.id === jobTemplateFilter)
      ? jobTemplateFilter
      : "";
  const visibleJobs = filterJobs(w.jobs, {
    query: jobSearch,
    status: jobStatusFilter,
    templateId: activeJobTemplateFilter,
    companies: activeJobCompanyFilter,
  });
  const jobFiltersActive = !!(
    jobSearch.trim() ||
    jobStatusFilter ||
    activeJobTemplateFilter ||
    activeJobCompanyFilter.length
  );
  const clearJobFilters = () => {
    setJobSearch("");
    setJobStatusFilter("");
    setJobTemplateFilter("");
    setJobCompanyFilter([]);
  };
  const [modal, setModal] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loadingName, setLoadingName] = useState("");
  const [ai, setAI] = useSavedAI();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]),
    [aiBusy, setAiBusy] = useState(false),
    [suggestionMode, setSuggestionMode] = useState<"suggest" | "notes">(
      "suggest",
    );
  const [jobTab, setJobTab] = useState("url"),
    [jobUrl, setJobUrl] = useState(""),
    [description, setDescription] = useState(""),
    [pending, setPending] = useState<Job | null>(null),
    [pendingTemplate, setPendingTemplate] = useState(""),
    [customKeyword, setCustomKeyword] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]),
    [driveSelected, setDriveSelected] = useState("");
  const experienceEditGroups = useRef<{ company?: number[] }>({});
  const duplicatePending = useRef(false);
  const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<
    string | null
  >(null);
  const driveToken = useRef("");
  const fileInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    contextVersion = useRef(0),
    importSource = useRef("Uploaded file");
  const flash = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  };
  useEffect(() => {
    if (modal === "rename-template") {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [modal]);
  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setLeft(false);
      setRight(false);
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    setEditing(null);
    setFocus(null);
    setFocusTarget(undefined);
    setSuggestions([]);
    contextVersion.current++;
    experienceEditGroups.current = {};
    history.boundary();
  }, [w.selectedJobId, w.viewTemplateId]);
  const job = w.viewTemplateId
      ? undefined
      : w.jobs.find((j) => j.id === w.selectedJobId),
    template = w.templates.find(
      (t) => t.id === (w.viewTemplateId || job?.templateId),
    );
  const docId = documentId(w),
    doc = docId ? w.docs[docId] : undefined,
    tailored = !!job?.tailoredDocId;
  const matches = useAIMatches(ai, (jobId, assessment, comparisonId) =>
    setW((state) => ({
      ...state,
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? comparisonId
            ? {
                ...j,
                comparisonAssessments: {
                  ...j.comparisonAssessments,
                  [comparisonId]: assessment,
                },
              }
            : { ...j, assessment }
          : j,
      ),
    })),
  );
  const reassessSelected = () => {
    if (!job) return;
    const pending = pendingAssessments(w, job);
    if (!pending.length) {
      flash("All selected resume assessments are up to date.");
      return;
    }
    void Promise.all(
      pending.map(({ doc, comparisonId }) =>
        matches.reassess(job, doc, comparisonId),
      ),
    );
  };
  const comparisonPanel = job && doc && (
    <ResumeComparisons
      key={job.id}
      workspace={w}
      job={job}
      matches={matches}
      onSelect={(ids) =>
        setW((state) => ({
          ...state,
          jobs: state.jobs.map((j) =>
            j.id === job.id ? { ...j, comparisonDocIds: ids } : j,
          ),
        }))
      }
    />
  );
  const analysis = job ? matches.get(job) : undefined;
  const debugJob = job || w.jobs[0];
  const matchingStatus = job && (
    <>
      {matches.busy(job) ? (
        <>
          <div className="loading-row" role="status">
            <span className="spinner" />
            AI is assessing selected resumes…{" "}
            {matches.progress(job)?.completed || 0}/{job.keywords.length} skills
            · {matches.elapsed(job)}s
          </div>
          <button
            className="ghost full-width"
            onClick={() => matches.cancel(job)}
          >
            Cancel AI assessment
          </button>
        </>
      ) : matches.error(job) ? (
        <p role="alert">{matches.error(job)}</p>
      ) : !analysis ? (
        <p className="muted">No saved assessment yet.</p>
      ) : null}
    </>
  );
  const uses = template
    ? w.jobs.filter((j) => j.templateId === template.id).length
    : 0;
  const aiLabel = ai
    ? aiProviderName(ai.provider, ai.method) +
      " · " +
      (ai.method === "subscription" ? "Subscription" : ai.model)
    : "Not connected";
  const open = (value: string) => {
    setReturnToJob(false);
    setError("");
    setModal(value);
    if (value === "job") {
      setPending(null);
      setJobUrl("");
      setDescription("");
    }
  };
  const close = () => {
    if (!busy) {
      setReturnToJob(false);
      if (modal === "pdf-preview") setPdfPreview(null);
      setModal(null);
      setError("");
    }
  };
  const askDeleteTemplate = (id: string) => {
    setDeletingTemplate(id);
    setReplacementTemplate(w.templates.find((t) => t.id !== id)?.id || "");
    open("delete-template");
  };
  const selectJob = (id: string) => {
    setW((s) => ({ ...s, selectedJobId: id, viewTemplateId: null }));
  };
  const selectTemplate = (id: string) =>
    setW((s) => ({ ...s, viewTemplateId: id }));
  const mutate = (fn: (doc: Resume) => Resume, fork = false) =>
    history.edit(
      (s) => updateDocument(s, fn, fork),
      editing ? `${docId}:${editing}` : undefined,
    );
  const travelHistory = (direction: "undo" | "redo") => {
    const next = history.preview(direction);
    const nextId = documentId(next);
    const nextPageCount = nextId ? next.docs[nextId]?.pageCount : undefined;
    if (nextPageCount) setPreferredPages(nextPageCount);
    experienceEditGroups.current = {};
    setEditing(null);
    setSuggestions([]);
    setFocus(null);
    setFocusTarget(undefined);
    contextVersion.current++;
    if (direction === "undo") history.undo();
    else history.redo();
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        modal ||
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest("[role=dialog]") ||
        (target.closest("input, textarea, [contenteditable=true]") &&
          !target.matches("textarea[data-resume-field]"))
      )
        return;
      // Resume editors use the same history as committed edits, so moving
      // focus after undo doesn't strand redo in the textarea's native history.
      const key = event.key.toLowerCase();
      const direction =
        key === "z"
          ? event.shiftKey
            ? "redo"
            : "undo"
          : key === "y"
            ? "redo"
            : null;
      if (!direction) return;
      event.preventDefault();
      if (direction === "undo" ? history.canUndo : history.canRedo)
        travelHistory(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    modal,
    history.canUndo,
    history.canRedo,
    history.undo,
    history.redo,
    history.preview,
  ]);
  /** Companies are stored on roles; a company without roles keeps one empty entry. */
  const addExperienceRole = (afterIndex: number, company = "") => {
    if (!doc || doc.roles.length >= 30) return;
    // Adding a role also clears roles left blank by earlier adds.
    const added = (d: typeof doc) =>
      pruneBlankRoles(
        insertExperienceRole(d, afterIndex, company),
        afterIndex + 1,
      );
    mutate((d) => added(d).doc);
    setSuggestions([]);
    contextVersion.current++;
    experienceEditGroups.current = {};
    setEditing(
      `${company ? "role-title" : "role-company"}-${added(doc).index}`,
    );
  };
  const addCompanyRole = (company: ExperienceCompany) => {
    const only = company.roles.length === 1 ? company.roles[0] : undefined;
    if (only && !hasRoleContent(only.role)) {
      experienceEditGroups.current = {};
      setEditing(`role-title-${only.index}`);
    } else addExperienceRole(company.roles.at(-1)!.index, company.company);
  };
  const changeExperience = (change: (d: Resume) => Resume) => {
    mutate(change);
    history.boundary();
    setSuggestions([]);
    contextVersion.current++;
    experienceEditGroups.current = {};
    setEditing(null);
  };
  const removeRole = (index: number, company: ExperienceCompany) =>
    changeExperience((d) =>
      company.roles.length > 1
        ? removeExperienceRole(d, index)
        : {
            ...d,
            roles: d.roles.map((r, i) =>
              i === index ? { ...r, title: "", dates: "", bullets: [] } : r,
            ),
          },
    );
  const removeCompany = (company: ExperienceCompany) =>
    changeExperience((d) => ({
      ...d,
      roles: d.roles.filter(
        (_, i) => !company.roles.some((entry) => entry.index === i),
      ),
    }));
  const commit = (byKey = false) => {
    const ri = Number(
      editing?.match(/^role-(?:title|dates|company)-(\d+)$/)?.[1] ?? -1,
    );
    // Escape/Enter on a still-empty role cancels it. Blur keeps it: removing a
    // role mid-click would shift the role under the pointer.
    if (byKey && doc && isBlankRole(doc.roles, ri)) {
      mutate((d) => removeExperienceRole(d, ri));
      setSuggestions([]);
      contextVersion.current++;
    }
    if (editing?.startsWith("bullet-")) {
      const [, ri, bi] = editing.split("-");
      mutate((d) => ({
        ...d,
        roles: d.roles.map((r, i) =>
          i === Number(ri)
            ? {
                ...r,
                bullets: r.bullets.filter(
                  (b, j) => j !== Number(bi) || b.trim(),
                ),
              }
            : r,
        ),
      }));
    }
    experienceEditGroups.current = {};
    history.boundary();
    setEditing(null);
  };
  const reorderSection = (id: string, to: number) => {
    commit();
    history.edit((w) => updateDocument(w, (d) => moveResumeSection(d, id, to)));
    setSuggestions([]);
    contextVersion.current++;
  };
  const field = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    className = "",
    multiline = false,
    onEdit = (id: string) => {
      experienceEditGroups.current = {};
      setEditing(id);
    },
  ) => (
    <InlineField
      key={id}
      id={id}
      value={value}
      editing={editing}
      onEdit={onEdit}
      onChange={onChange}
      onCommit={commit}
      job={job}
      focus={focus}
      className={className}
      multiline={multiline}
      highlightStyle={highlightStyle}
      navigation={focusTarget?.fieldId === id ? focusTarget : undefined}
      labels={id === "skills"}
    />
  );
  const baseField = (
    key: "name" | "headline" | "contact" | "summary" | "skills",
    className = "",
  ) =>
    doc &&
    field(
      key,
      doc[key],
      (value) => mutate((d) => ({ ...d, [key]: value })),
      className,
      key === "summary",
    );
  const tailor = () => {
    mutate((d) => d, true);
    flash("Created a tailored copy for " + job?.company);
  };
  const focusSkill = (skill: ResumeMatch["items"][number]) => {
    if (!doc) return;
    commit();
    const target = locateMatchedSkill(doc, skill);
    if (!target) {
      flash(
        "Saved match text is no longer in this resume. Reassess with AI to update it.",
      );
      return;
    }
    if (window.matchMedia("(max-width:760px)").matches) {
      setLeft(false);
      setRight(false);
    }
    setFocus(skill.term);
    setFocusTarget({ ...target, request: ++focusRequest.current });
  };
  const addSkill = (term: string) => {
    if (!doc) return;
    commit();
    const existing = findTermRange(doc.skills, term);
    const value = existing
      ? doc.skills
      : doc.skills
        ? doc.skills + ", " + term
        : term;
    const start = existing?.start ?? value.length - term.length,
      end = existing?.end ?? value.length;
    mutate((d) => ({ ...d, skills: value }), true);
    if (window.matchMedia("(max-width:760px)").matches) {
      setLeft(false);
      setRight(false);
    }
    setFocus(term);
    setFocusTarget({
      fieldId: "skills",
      value,
      start,
      end,
      request: ++focusRequest.current,
    });
    setEditing("skills");
    flash(
      existing
        ? term + " is already listed. Focused in the resume."
        : "Added " + term + " to this job’s resume",
    );
  };
  const accept = (s: Suggestion) => {
    mutate(
      (d) => ({
        ...d,
        roles: d.roles.map((r, i) =>
          i === s.roleIndex ? { ...r, bullets: [...r.bullets, s.bullet] } : r,
        ),
      }),
      true,
    );
    setSuggestions((list) => list.filter((item) => item !== s));
    flash("Added to " + (job ? job.company + " version" : "template"));
  };
  const acceptChatChange = (change: ChatChange) => {
    if (chatChangeState(w, change).state !== "ready") return false;
    history.edit((state) => applyChatChange(state, change));
    setEditing(null);
    setFocus(null);
    setFocusTarget(undefined);
    setSuggestions([]);
    contextVersion.current++;
    flash(
      "Applied to " +
        (change.target.kind === "job"
          ? change.target.label + " job resume"
          : change.target.label + " template") +
        ". Undo is available.",
    );
    return true;
  };
  async function runAI(mode: "suggest" | "notes") {
    if (!ai) {
      open("ai");
      return;
    }
    if (!doc) return;
    const version = contextVersion.current;
    setAiBusy(true);
    setSuggestionMode(mode);
    try {
      const res = await request("/api/ai", {
        connection: ai,
        doc,
        job,
        notes: w.notes.map((n) => n.text),
        references: await Promise.all(
          (w.references || []).map(async (document) => {
            const source = await getResumeSource(
              referenceStorageKey(document.id),
            );
            if (!source)
              throw new Error(
                `Reimport ${document.name}: its saved reference text is unavailable.`,
              );
            return { ...document, text: source.text };
          }),
        ),
        mode,
      });
      const data = await res.json();
      if (version === contextVersion.current) {
        setSuggestions(data.suggestions);
        if (!data.suggestions.length)
          flash("No supported changes found. Add more detail to your notes.");
        else if (mode === "notes")
          flash("Review the suggested changes in the right panel.");
      }
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }
  function addTemplate(
    resume: Resume,
    name: string,
    source: string,
    inheritPreference = true,
    id = uid(),
  ) {
    resume = {
      ...resume,
      pageCount:
        (inheritPreference ? preferredPages : null) ?? resume.pageCount ?? 1,
    };
    const newTemplate = {
      id,
      name:
        name
          .replace(/\.(docx|pdf)$/i, "")
          .replace(/[^\p{L}\p{N}]+/gu, "_")
          .replace(/^_|_$/g, "") || "New_Resume",
      sourceFile: name,
      source,
      docId: "t:" + id,
    };
    setW((s) => ({
      ...s,
      templates: [...s.templates, newTemplate],
      docs: { ...s.docs, [newTemplate.docId]: resume },
      jobs: s.templates.length
        ? s.jobs
        : s.jobs.map((j) => ({ ...j, templateId: id })),
      viewTemplateId: id,
    }));
    setModal(null);
    flash("Saved as template “" + newTemplate.name + "”");
    return id;
  }
  function createBlankResume() {
    let number = 1;
    let name = "Untitled_Resume";
    while (
      w.templates.some(
        (template) =>
          template.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      name = `Untitled_Resume_${++number}`;
    }
    addTemplate(blankResume(), name, "Created here");
  }
  async function duplicateTemplate(templateId: string) {
    const original = w.templates.find((template) => template.id === templateId);
    const originalDoc = original && w.docs[original.docId];
    if (!original || !originalDoc || duplicatePending.current) return;
    duplicatePending.current = true;
    setDuplicatingTemplateId(templateId);
    const resume = structuredClone(originalDoc);
    const epoch = workspaceEpoch.current;
    const copyId = uid();
    const copyBase = `${original.name}_copy`
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_|_$/g, "");
    let copyName = copyBase;
    let number = 1;
    while (
      w.templates.some(
        (template) =>
          template.name.toLocaleLowerCase() === copyName.toLocaleLowerCase(),
      )
    )
      copyName = `${copyBase}_${++number}`;
    let sourceNotice = "";
    try {
      try {
        const source = await getResumeSource(templateId);
        if (source) await saveResumeSource(copyId, source);
      } catch {
        sourceNotice =
          " The editable resume was copied, but its original file could not be saved.";
      }
      if (epoch !== workspaceEpoch.current) {
        void deleteResumeSource(copyId).catch(() => {});
        return;
      }
      addTemplate(resume, copyName, original.source, false, copyId);
      if (sourceNotice) flash(`Created “${copyName}”.${sourceNotice}`);
    } finally {
      duplicatePending.current = false;
      setDuplicatingTemplateId(null);
    }
  }
  async function importFile(file: File, source = importSource.current) {
    if (!/\.(docx|pdf)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setError("Choose a .docx or .pdf file under 10 MB.");
      setModal("import");
      return;
    }
    setBusy(true);
    setError("");
    setLoadingName(file.name);
    setModal("importing");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await request("/api/import", form),
        data = await res.json();
      const importedId = uid();
      let sourceNotice = "";
      if (/\.(pdf|docx)$/i.test(file.name)) {
        try {
          await saveResumeSource(importedId, {
            file: new Blob([file], {
              type: /\.pdf$/i.test(file.name)
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }),
            name: file.name,
            text: data.text,
          });
        } catch {
          sourceNotice =
            " Original file storage unavailable; keep your file separately.";
        }
      }
      addTemplate(data.doc, file.name, source, true, importedId);
      flash(data.notice + sourceNotice);
    } catch (e) {
      setModal("import");
      setError((e as Error).message);
    } finally {
      setBusy(false);
      importSource.current = "Uploaded file";
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function importJob() {
    if (!ai) {
      setError("Connect Claude or Codex to scan this job.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const referenceUrl = jobUrl.trim();
      if (referenceUrl && !jobLinkSchema.safeParse(referenceUrl).success)
        throw new Error("Enter a valid HTTP or HTTPS job URL.");
      const res = await request(
        "/api/jobs",
        jobTab === "url"
          ? { url: jobUrl, connection: ai }
          : { description, connection: ai },
      );
      const data = await res.json();
      const best = w.templates[0];
      setPending({
        ...data,
        id: uid(),
        templateId: best?.id || "",
        source: jobTab === "paste" ? "Pasted description" : "Company site",
        url: referenceUrl || undefined,
      });
      setPendingTemplate(best?.id || "");
    } catch (e) {
      if ((e as Error & { code?: string }).code === "JOB_TEXT_UNAVAILABLE")
        setJobTab("paste");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportPDF(preview = false) {
    if (!doc) return;
    try {
      const res = await request("/api/export", doc);
      const url = URL.createObjectURL(await res.blob());
      if (preview) {
        setPdfPreview(url);
        setModal("pdf-preview");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (job?.company || template?.name || "Resume").replace(/[^\w-]+/g, "_") +
        ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("PDF exported");
    } catch (e) {
      flash((e as Error).message);
    }
  }
  async function loadDrive() {
    setBusy(true);
    setError("");
    try {
      const data = await connectDrive();
      driveToken.current = data.token;
      setDriveFiles(data.files);
      setDriveSelected(data.files[0]?.id || "");
      setModal("drive");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importDrive() {
    const file = driveFiles.find((f) => f.id === driveSelected);
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const actual = await downloadDriveFile(file, driveToken.current);
      await importFile(actual, "Google Drive · imported");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const suggestionCards = (
    <>
      {suggestions.map((s, i) => (
        <div className="suggestion" key={i}>
          <div className="suggestion-label">
            + {s.keyword} → {doc?.roles[s.roleIndex]?.company || "Resume"}
          </div>
          <p>{s.bullet}</p>
          <div className="row">
            <button className="primary small" onClick={() => accept(s)}>
              Add to resume
            </button>
            <button
              className="text-button muted"
              onClick={() =>
                setSuggestions((list) => list.filter((x) => x !== s))
              }
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </>
  );
  async function replaceWorkspace(action: Record<string, unknown>) {
    await storage.replace(action);
    clearJobFilters();
    workspaceEpoch.current++;
    matches.cancelAll();
    setChatResetKey((v) => v + 1);
    setSuggestions([]);
  }
  if (!storage.ready)
    return (
      <main className="storage-loading">
        <h1>Resume Builder</h1>
        <p role={storage.loadError ? "alert" : "status"}>
          {storage.loadError || "Loading your saved workspace…"}
        </p>
        {storage.loadError && (
          <>
            <p>
              No changes have been written. Your existing data has been
              preserved.
            </p>
            <button className="ghost" onClick={() => location.reload()}>
              Retry loading
            </button>
            <BackupRecovery
              ready={false}
              flush={storage.flush}
              replace={replaceWorkspace}
            />
          </>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <input
        hidden
        ref={fileInput}
        type="file"
        data-upload="resume"
        accept=".docx,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      <header className="topbar">
        <button
          className="icon-button"
          aria-label="Toggle jobs and resumes panel"
          aria-expanded={left}
          onClick={() => setLeft((v) => !v)}
        >
          <span className="panel-icon panel-left" />
        </button>
        <div className="brand">
          <span className="logo">R</span>
          <span>Resume Builder</span>
        </div>
        <div className="spacer" />
        <BackupRecovery
          ready={storage.ready}
          flush={storage.flush}
          replace={replaceWorkspace}
        />
        <button className="ghost ai-button" onClick={() => open("ai")}>
          {ai && <span className="connected-dot" />}
          {ai ? aiLabel : "Connect AI"}
        </button>
        <button
          ref={chatTrigger}
          className="ghost chat-button"
          aria-expanded={right && chatOpen}
          aria-controls="ai-chat-panel"
          onClick={() => {
            setChatOpen(!(right && chatOpen));
            setRight(true);
          }}
        >
          AI chatbot
        </button>
        <label className="page-count-label">
          Pages
          <select
            aria-label="Resume page count"
            value={doc?.pageCount || preferredPages || 1}
            onChange={(e) => {
              const pageCount = Number(e.target.value) as 1 | 2;
              setPreferredPages(pageCount);
              if (doc) mutate((d) => ({ ...d, pageCount }));
            }}
          >
            <option value="1">Single page</option>
            <option value="2">Dual page</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={!doc}
          onClick={() => void exportPDF()}
        >
          Export PDF
        </button>
        <button
          className="icon-button"
          aria-label="Toggle right tools panel"
          aria-expanded={right}
          onClick={() => setRight((v) => !v)}
        >
          <span className="panel-icon panel-right" />
        </button>
      </header>
      {(storage.message || storage.notice) && (
        <div
          className="storage-notice"
          role={storage.message ? "alert" : "status"}
        >
          <span>{storage.message || storage.notice}</span>
          {storage.message && (
            <>
              <button className="ghost" onClick={storage.exportUnsaved}>
                Download unsaved work
              </button>
              {storage.status !== "conflict" && (
                <button
                  className="ghost"
                  onClick={() => void storage.flush().catch(() => {})}
                >
                  Retry save
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div
        ref={panelWidths.ref}
        style={
          {
            "--left-panel-width": `${panelWidths.left}px`,
            "--right-panel-width": `${panelWidths.right}px`,
          } as React.CSSProperties
        }
        className={
          "workspace " +
          (!left ? "left-closed " : "") +
          (!right ? "right-closed" : "")
        }
      >
        {left && (
          <PanelResizer
            side="left"
            width={panelWidths.left}
            max={panelWidths.leftMax}
            onResize={(value) => panelWidths.resize("left", value)}
          />
        )}
        {right && (
          <PanelResizer
            side="right"
            width={panelWidths.right}
            max={panelWidths.rightMax}
            onResize={(value) => panelWidths.resize("right", value)}
          />
        )}
        {!left ? (
          <button
            className="rail left-rail"
            aria-label="Expand templates and jobs"
            onClick={() => setLeft(true)}
          >
            <span>»</span>
            <span>Jobs & resumes</span>
          </button>
        ) : (
          <aside className="left-panel">
            <div
              className="sidebar-tabs"
              role="tablist"
              aria-label="Workspace lists"
            >
              {(["jobs", "resumes"] as const).map((tab) => (
                <button
                  key={tab}
                  id={`sidebar-${tab}-tab`}
                  role="tab"
                  aria-selected={sidebarTab === tab}
                  aria-controls={`sidebar-${tab}-panel`}
                  tabIndex={sidebarTab === tab ? 0 : -1}
                  onClick={() => {
                    setSidebarTab(tab);
                    setFiltersOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "jobs"
                        : event.key === "End"
                          ? "resumes"
                          : tab === "jobs"
                            ? "resumes"
                            : "jobs";
                    setSidebarTab(next);
                    setFiltersOpen(false);
                    document.getElementById(`sidebar-${next}-tab`)?.focus();
                  }}
                >
                  {tab === "jobs" ? "Jobs" : "Resumes"}
                  <span>
                    {tab === "jobs" ? w.jobs.length : w.templates.length}
                  </span>
                </button>
              ))}
            </div>
            <div
              className="templates-block sidebar-list-panel"
              id="sidebar-resumes-panel"
              role="tabpanel"
              aria-labelledby="sidebar-resumes-tab"
              hidden={sidebarTab !== "resumes"}
            >
              <div className="section-header">
                <strong>Resumes</strong>
                <button
                  className="text-button"
                  onClick={createBlankResume}
                  aria-label="Create empty resume"
                  title="Create an empty resume"
                >
                  + New
                </button>
              </div>
              <button
                className="ghost sidebar-import-button"
                onClick={() => open("import")}
              >
                Import resume
              </button>
              <div className="template-list">
                {w.templates.length === 0 && (
                  <p className="sidebar-empty muted">
                    Create or import a resume to get started.
                  </p>
                )}
                {w.templates.map((t) => (
                  <div className="template-item" key={t.id}>
                    <button
                      className={
                        "template-row " +
                        (w.viewTemplateId === t.id ? "selected" : "")
                      }
                      aria-pressed={w.viewTemplateId === t.id}
                      onClick={() => selectTemplate(t.id)}
                    >
                      <span className="doc-icon" />
                      <span className="mono template-name" title={t.name}>
                        {t.name}
                      </span>
                      <span className="muted uses">
                        {w.jobs.filter((j) => j.templateId === t.id).length}{" "}
                        jobs
                      </span>
                    </button>
                    <div className="resume-actions">
                      <button
                        className="icon-button"
                        aria-label={`Actions for resume ${t.name}`}
                        title="Resume actions"
                        popoverTarget={`resume-actions-${t.id}`}
                        onClick={(event) => {
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          const menu = document.getElementById(
                            `resume-actions-${t.id}`,
                          );
                          if (menu) {
                            menu.style.left = `${Math.max(8, rect.right - 150)}px`;
                            menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 140)}px`;
                          }
                        }}
                      >
                        ···
                      </button>
                      <div
                        id={`resume-actions-${t.id}`}
                        popover="auto"
                        className="resume-actions-menu"
                        onClick={(event) => event.currentTarget.hidePopover()}
                      >
                        <button
                          className="icon-button rename-template-button"
                          title="Rename resume"
                          aria-label={`Rename resume ${t.name}`}
                          onClick={() => {
                            setRenamingTemplate(t.id);
                            setResumeName(t.name);
                            open("rename-template");
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="icon-button duplicate-template-button"
                          title="Duplicate resume"
                          aria-label={`Duplicate resume ${t.name}`}
                          disabled={duplicatingTemplateId !== null}
                          onClick={() => void duplicateTemplate(t.id)}
                        >
                          Duplicate
                        </button>
                        <button
                          className="icon-button delete-template-button"
                          title="Delete template"
                          aria-label={`Delete template ${t.name}`}
                          onClick={() => askDeleteTemplate(t.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="sidebar-list-panel"
              id="sidebar-jobs-panel"
              role="tabpanel"
              aria-labelledby="sidebar-jobs-tab"
              hidden={sidebarTab !== "jobs"}
            >
              <div className="jobs-header">
                <div>
                  <strong>Jobs</strong>
                  <div className="muted">{w.jobs.length} saved</div>
                </div>
                <button className="primary small" onClick={() => open("job")}>
                  + Add job
                </button>
              </div>
              <div
                className="job-search"
                role="search"
                aria-label="Search and filter jobs"
              >
                <div className="job-search-toolbar">
                  <label className="job-search-input">
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <circle cx="6.5" cy="6.5" r="4.5" />
                      <path d="m10 10 4 4" />
                    </svg>
                    <input
                      type="search"
                      aria-label="Search jobs"
                      placeholder="Search jobs…"
                      title="Search by company, title, location or keyword"
                      value={jobSearch}
                      onChange={(e) => setJobSearch(e.target.value)}
                    />
                  </label>
                  <div
                    className="filter-control"
                    ref={filterControl}
                    onBlur={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      )
                        setFiltersOpen(false);
                    }}
                  >
                    <button
                      className="ghost filter-trigger"
                      ref={filterTrigger}
                      aria-expanded={filtersOpen}
                      aria-controls="job-filters"
                      onClick={() => setFiltersOpen((open) => !open)}
                    >
                      Filters
                      {(jobStatusFilter ||
                        activeJobTemplateFilter ||
                        activeJobCompanyFilter.length > 0) && (
                        <span className="filter-count">
                          {Number(!!jobStatusFilter) +
                            Number(!!activeJobTemplateFilter) +
                            Number(activeJobCompanyFilter.length > 0)}
                        </span>
                      )}
                    </button>
                    {filtersOpen && (
                      <div
                        className="job-filter-popover"
                        id="job-filters"
                        role="group"
                        aria-label="Job filters"
                      >
                        <div className="section-header">
                          <strong>Filter jobs</strong>
                          <button
                            className="text-button"
                            onClick={() => {
                              setJobStatusFilter("");
                              setJobTemplateFilter("");
                              setJobCompanyFilter([]);
                            }}
                          >
                            Reset
                          </button>
                        </div>
                        <div className="job-filter-row">
                          <fieldset className="company-filter">
                            <legend>Company</legend>
                            <button
                              className="text-button"
                              onClick={() => setJobCompanyFilter([])}
                            >
                              All companies
                            </button>
                            <div className="company-filter-options">
                              {jobCompanies.length === 0 && (
                                <span className="muted">
                                  No saved companies
                                </span>
                              )}
                              {jobCompanies.map((company) => (
                                <label key={company}>
                                  <input
                                    type="checkbox"
                                    checked={activeJobCompanyFilter.includes(
                                      company,
                                    )}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setJobCompanyFilter((current) =>
                                        checked
                                          ? [...current, company]
                                          : current.filter(
                                              (value) => value !== company,
                                            ),
                                      );
                                    }}
                                  />
                                  <span>{company}</span>
                                </label>
                              ))}
                            </div>
                            <span className="muted company-filter-hint">
                              {activeJobCompanyFilter.length
                                ? `${activeJobCompanyFilter.length} selected`
                                : "Showing all companies"}
                            </span>
                          </fieldset>
                          <label>
                            <span>Status</span>
                            <select
                              aria-label="Filter jobs by status"
                              value={jobStatusFilter}
                              onChange={(e) =>
                                setJobStatusFilter(e.target.value)
                              }
                            >
                              <option value="">All statuses</option>
                              <option value="none">No status</option>
                              <option value="to-apply">To apply</option>
                              <option value="applied">Applied</option>
                              <option value="rejected">Rejected</option>
                            </select>
                          </label>
                          <label>
                            <span>Resume</span>
                            <select
                              aria-label="Filter jobs by resume"
                              value={activeJobTemplateFilter}
                              onChange={(e) =>
                                setJobTemplateFilter(e.target.value)
                              }
                            >
                              <option value="">All resumes</option>
                              {w.templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name.replaceAll("_", " ")}
                                </option>
                              ))}
                              <option value="__none__">No resume</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {(jobStatusFilter ||
                activeJobTemplateFilter ||
                activeJobCompanyFilter.length > 0) && (
                <div
                  className="active-job-filters"
                  aria-label="Active job filters"
                >
                  {activeJobCompanyFilter.map((company) => (
                    <button
                      key={company}
                      onClick={() =>
                        setJobCompanyFilter((current) =>
                          current.filter((value) => value !== company),
                        )
                      }
                      aria-label={`Remove company filter ${company}`}
                    >
                      {company} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  {jobStatusFilter && (
                    <button
                      onClick={() => setJobStatusFilter("")}
                      aria-label="Remove status filter"
                    >
                      {jobStatusFilter === "none"
                        ? "No status"
                        : jobStatusFilter === "to-apply"
                          ? "To apply"
                          : jobStatusFilter === "applied"
                            ? "Applied"
                            : "Rejected"}{" "}
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                  {activeJobTemplateFilter && (
                    <button
                      onClick={() => setJobTemplateFilter("")}
                      aria-label="Remove resume filter"
                    >
                      {activeJobTemplateFilter === "__none__"
                        ? "No resume"
                        : w.templates
                            .find((t) => t.id === activeJobTemplateFilter)
                            ?.name.replaceAll("_", " ")}{" "}
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                </div>
              )}
              {jobFiltersActive && (
                <div className="job-list-controls">
                  <span className="muted job-result-count" role="status">
                    {visibleJobs.length} of {w.jobs.length} jobs
                  </span>
                  <button className="text-button" onClick={clearJobFilters}>
                    Clear filters
                  </button>
                </div>
              )}
              <div
                className="job-list"
                onDragOver={(e) => {
                  if (!draggingJob) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const items = [
                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                      ".job-item",
                    ),
                  ];
                  const before = items.findIndex((el) => {
                    const r = el.getBoundingClientRect();
                    return e.clientY < r.top + r.height / 2;
                  });
                  setDropJobIndex(before < 0 ? items.length : before);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDropJobIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingJob && dropJobIndex !== null) {
                    const id = draggingJob,
                      from = visibleJobs.findIndex((j) => j.id === id),
                      to =
                        from < dropJobIndex ? dropJobIndex - 1 : dropJobIndex;
                    setW((s) => ({
                      ...s,
                      jobs: reorderVisibleJobs(
                        s.jobs,
                        visibleJobs.map((j) => j.id),
                        id,
                        to,
                      ),
                    }));
                  }
                  setDraggingJob(null);
                  setDropJobIndex(null);
                }}
              >
                {visibleJobs.length === 0 && (
                  <div className="job-list-empty">
                    <p>
                      {jobFiltersActive
                        ? "No jobs match your search or filters."
                        : "No saved jobs yet."}
                    </p>
                    <p className="muted">
                      {jobFiltersActive
                        ? "Try another search or clear the filters above."
                        : "Add a job to get started."}
                    </p>
                  </div>
                )}
                {visibleJobs.map((j, i) => {
                  const selected = job?.id === j.id;
                  return (
                    <div
                      key={j.id}
                      className={
                        "job-item" +
                        (j.status ? " status-" + j.status : "") +
                        (draggingJob === j.id ? " dragging" : "") +
                        (dropJobIndex === i && draggingJob
                          ? " drop-before"
                          : "") +
                        (dropJobIndex === visibleJobs.length &&
                        draggingJob &&
                        i === visibleJobs.length - 1
                          ? " drop-after"
                          : "")
                      }
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", j.id);
                        setDraggingJob(j.id);
                      }}
                      onDragEnd={() => {
                        setDraggingJob(null);
                        setDropJobIndex(null);
                      }}
                    >
                      <button
                        className={
                          "job-card " +
                          (job?.id === j.id ? "selected" : "") +
                          (j.status ? " status-" + j.status : "")
                        }
                        aria-pressed={selected}
                        title="Drag to reorder · Alt+↑/↓ to move"
                        onClick={() => selectJob(j.id)}
                        onKeyDown={(e) => {
                          if (
                            !e.altKey ||
                            (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                          )
                            return;
                          e.preventDefault();
                          const btn = e.currentTarget;
                          setW((s) => ({
                            ...s,
                            jobs: reorderVisibleJobs(
                              s.jobs,
                              visibleJobs.map((job) => job.id),
                              j.id,
                              i + (e.key === "ArrowUp" ? -1 : 1),
                            ),
                          }));
                          requestAnimationFrame(() => btn.focus());
                        }}
                      >
                        <span className="job-summary-line">
                          <span
                            className="company job-summary-company"
                            title={j.company}
                          >
                            {j.company}
                          </span>
                          {matches.get(j) ? (
                            <ScorePill pct={matches.get(j)!.pct} />
                          ) : (
                            <span className="score-pill">—</span>
                          )}
                        </span>
                        <span className="job-title" title={j.title}>
                          {j.title}
                        </span>
                        <span className="job-summary-status">
                          {j.status === "to-apply"
                            ? "To apply"
                            : j.status === "applied"
                              ? "Applied"
                              : j.status === "rejected"
                                ? "Rejected"
                                : "No status"}
                          {j.tailoredDocId ? " · Tailored" : ""}
                        </span>
                        <span
                          className="job-card-details"
                          id={`job-details-${j.id}`}
                          hidden={!selected}
                        >
                          <span
                            className="job-meta"
                            title={`${j.location || "Location not specified"} · ${j.source}`}
                          >
                            <span>
                              {j.location || "Location not specified"}
                            </span>
                            <span className="job-meta-source">
                              {" "}
                              ·{" "}
                              {j.source === "Pasted description"
                                ? "Pasted"
                                : j.source}
                            </span>
                          </span>
                          <span
                            className={
                              "template-tag job-template-tag " +
                              (j.tailoredDocId ? "tailored" : "")
                            }
                            title={
                              w.templates.find((t) => t.id === j.templateId)
                                ?.name || "No template"
                            }
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              aria-hidden="true"
                            >
                              <path d="M3.5 1.5H9l3.5 3.5v9.5h-9z M9 1.5V5h3.5 M5.5 8h5 M5.5 10.5h4" />
                            </svg>
                            <span className="job-template-name">
                              {(
                                w.templates.find((t) => t.id === j.templateId)
                                  ?.name || "No template"
                              ).replaceAll("_", " ")}
                            </span>
                            {j.tailoredDocId && (
                              <span className="job-tailored-badge">
                                Tailored
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <div className="job-card-header" hidden={!selected}>
                        <label className="job-company-line">
                          <span className="muted">Status</span>
                          <select
                            className={"job-status " + (j.status || "unset")}
                            aria-label={`Status for ${j.title} at ${j.company}`}
                            title={
                              j.status ? "Change job status" : "Set job status"
                            }
                            value={j.status || ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              const status = jobStatuses.find(
                                (s) => s === value,
                              );
                              setW((s) => ({
                                ...s,
                                jobs: s.jobs.map((x) =>
                                  x.id === j.id ? { ...x, status } : x,
                                ),
                              }));
                            }}
                          >
                            <option value="">No status</option>
                            <option value="to-apply">To apply</option>
                            <option value="applied">Applied</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="panel-hint">
                Paste a job link or full description to add a job.
              </p>
            </div>
            <span
              className={
                "save-state " +
                (["error", "conflict"].includes(storage.status)
                  ? "save-error"
                  : "")
              }
              aria-live="polite"
            >
              {storage.status === "saving"
                ? "Saving…"
                : storage.status === "saved"
                  ? "Saved on this computer"
                  : "Save failed"}
            </span>
          </aside>
        )}
        <main className="center-panel">
          <div
            className="document-scroll"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && !busy) void importFile(file);
            }}
          >
            {doc ? (
              <>
                <div className="document-bar">
                  <div className="document-bar-row">
                    <span
                      className={
                        "document-type mono " + (tailored ? "tailored" : "")
                      }
                    >
                      {tailored ? "TAILORED" : "TEMPLATE"}
                    </span>
                    <strong>
                      {tailored ? job?.company + " version" : template?.name}
                    </strong>
                    <span className="document-subtext muted">
                      {tailored
                        ? "from " + (template?.name || "deleted template")
                        : "used by " + uses + " jobs"}
                    </span>
                    {job && (
                      <span className="assigned-resume muted">
                        Resume:{" "}
                        {template?.name.replaceAll("_", " ") || "No resume"}
                      </span>
                    )}
                    <div className="spacer" />
                    {template && (
                      <ResumeSourceViewer
                        key={`${chatResetKey}:${template.id}`}
                        templateId={template.id}
                        sourceFile={template.sourceFile}
                      />
                    )}
                    <button
                      className="ghost"
                      onClick={() => void exportPDF(true)}
                    >
                      Preview PDF
                    </button>
                    {job ? (
                      tailored ? (
                        <>
                          <button
                            className="ghost"
                            onClick={() => selectTemplate(job.templateId)}
                            disabled={!template}
                          >
                            View template
                          </button>
                          <button
                            className="ghost"
                            onClick={() => {
                              history.edit((s) => {
                                const docs = { ...s.docs };
                                delete docs[job.tailoredDocId!];
                                return {
                                  ...s,
                                  docs,
                                  jobs: s.jobs.map((j) =>
                                    j.id === job.id
                                      ? { ...j, tailoredDocId: undefined }
                                      : j,
                                  ),
                                };
                              });
                              setSuggestions([]);
                              flash("Reverted to template");
                            }}
                          >
                            Discard tailoring
                          </button>
                        </>
                      ) : (
                        <>
                          <label className="template-select-label">
                            Change resume{" "}
                            <select
                              aria-label="Base template"
                              value={job.templateId}
                              onChange={(e) => {
                                const value = e.target.value;
                                setW((s) => ({
                                  ...s,
                                  jobs: s.jobs.map((j) =>
                                    j.id === job.id
                                      ? { ...j, templateId: value }
                                      : j,
                                  ),
                                }));
                                setEditing(null);
                                setFocus(null);
                                setFocusTarget(undefined);
                                setSuggestions([]);
                                contextVersion.current++;
                              }}
                            >
                              {w.templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="primary" onClick={tailor}>
                            Tailor for {job.company}
                          </button>
                        </>
                      )
                    ) : (
                      <button
                        className="ghost"
                        disabled={duplicatingTemplateId !== null}
                        onClick={() => {
                          if (template) void duplicateTemplate(template.id);
                        }}
                      >
                        Duplicate
                      </button>
                    )}
                    {template && (
                      <button
                        className="ghost danger"
                        aria-label="Delete current resume template"
                        onClick={() => askDeleteTemplate(template.id)}
                      >
                        Delete template
                      </button>
                    )}
                  </div>
                  <p className="document-hint">
                    {tailored
                      ? `Edits only affect this job. Keywords from ${job?.company} are highlighted.`
                      : job
                        ? `Edits here change the template for all ${uses} jobs using it. Tailor it to make changes just for ${job.company}.`
                        : "Changes apply to every job using this template. Select a job to see keyword matches."}
                  </p>
                </div>
                <article
                  className={
                    "resume-page " +
                    ((doc.pageCount || 1) === 1 ? "single-page" : "dual-page")
                  }
                  aria-label="Editable resume"
                >
                  {baseField("name", "resume-name")}
                  {baseField("headline", "resume-headline")}
                  {baseField("contact", "resume-contact")}
                  {resumeSections(doc).map((section, index, sections) => {
                    const extraIndex = section.id.startsWith("extra-")
                      ? Number(section.id.slice(6))
                      : -1;
                    const extra = doc.extraSections?.[extraIndex];
                    return (
                      <section
                        className={
                          "resume-section" +
                          (extra ? " extra-resume-section" : "")
                        }
                        key={section.id}
                        data-section={section.id}
                        onDragOver={(event) => {
                          if (
                            event.dataTransfer.types.includes(
                              "application/x-resume-section",
                            )
                          )
                            event.preventDefault();
                        }}
                        onDrop={(event) => {
                          const raw = event.dataTransfer.getData(
                            "application/x-resume-section",
                          );
                          if (!raw) return;
                          event.preventDefault();
                          event.stopPropagation();
                          try {
                            const dragged = JSON.parse(raw);
                            if (dragged.docId === docId)
                              reorderSection(dragged.id, index);
                          } catch {
                            /* Ignore unrelated drag data. */
                          }
                        }}
                      >
                        <div className="resume-section-heading">
                          <h2>
                            {extra
                              ? field(
                                  `extra-title-${extraIndex}`,
                                  extra.title,
                                  (value) =>
                                    mutate((d) => ({
                                      ...d,
                                      extraSections: d.extraSections?.map(
                                        (s, i) =>
                                          i === extraIndex
                                            ? { ...s, title: value }
                                            : s,
                                      ),
                                    })),
                                )
                              : section.title}
                          </h2>
                          <div
                            className="section-controls"
                            role="group"
                            aria-label={`Reorder ${section.title}`}
                          >
                            <button
                              type="button"
                              className="section-drag"
                              draggable
                              title="Drag to reorder section"
                              aria-label={`Drag ${section.title} section`}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "application/x-resume-section",
                                  JSON.stringify({ id: section.id, docId }),
                                );
                              }}
                            >
                              ⠿
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${section.title} up`}
                              disabled={index === 0}
                              onClick={() =>
                                reorderSection(section.id, index - 1)
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${section.title} down`}
                              disabled={index === sections.length - 1}
                              onClick={() =>
                                reorderSection(section.id, index + 1)
                              }
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                        {section.id === "summary" ? (
                          baseField("summary")
                        ) : section.id === "experience" ? (
                          <>
                            <div className="roles">
                              {groupExperience(
                                doc.roles,
                                experienceEditGroups.current,
                              ).map((company) => {
                                const first = company.roles[0].index;
                                // A company with no roles is stored as one empty entry, shown only while edited.
                                const visibleRoles = company.roles.filter(
                                  ({ role, index }) =>
                                    company.roles.length > 1 ||
                                    hasRoleContent(role) ||
                                    !!editing?.match(
                                      new RegExp(
                                        `^(?:role-(?:title|dates)-${index}|bullet-${index}-\\d+)$`,
                                      ),
                                    ),
                                );
                                return (
                                  <section
                                    className="experience-company"
                                    key={first}
                                  >
                                    <div className="experience-company-header">
                                      {field(
                                        `role-company-${first}`,
                                        company.company,
                                        (value) =>
                                          mutate((d) => ({
                                            ...d,
                                            roles: d.roles.map((r, i) =>
                                              company.roles.some(
                                                (entry) => entry.index === i,
                                              )
                                                ? { ...r, company: value }
                                                : r,
                                            ),
                                          })),
                                        "experience-company-name",
                                        false,
                                        (id) => {
                                          experienceEditGroups.current = {
                                            company: company.roles.map(
                                              (e) => e.index,
                                            ),
                                          };
                                          setEditing(id);
                                        },
                                      )}
                                    </div>
                                    {visibleRoles.map(({ role, index: ri }) => (
                                      <section className="role" key={ri}>
                                        <div className="role-header">
                                          <div className="role-heading">
                                            {field(
                                              `role-title-${ri}`,
                                              role.title,
                                              (value) =>
                                                mutate((d) => ({
                                                  ...d,
                                                  roles: d.roles.map((r, i) =>
                                                    i === ri
                                                      ? { ...r, title: value }
                                                      : r,
                                                  ),
                                                })),
                                              "role-title",
                                            )}
                                          </div>
                                          {field(
                                            `role-dates-${ri}`,
                                            role.dates,
                                            (value) =>
                                              mutate((d) => ({
                                                ...d,
                                                roles: d.roles.map((r, i) =>
                                                  i === ri
                                                    ? { ...r, dates: value }
                                                    : r,
                                                ),
                                              })),
                                            "role-dates",
                                          )}
                                        </div>
                                        <div className="bullets">
                                          {role.bullets.map((bullet, bi) => (
                                            <div className="bullet" key={bi}>
                                              <span className="bullet-dot">
                                                •
                                              </span>
                                              {field(
                                                `bullet-${ri}-${bi}`,
                                                bullet,
                                                (value) =>
                                                  mutate((d) => ({
                                                    ...d,
                                                    roles: d.roles.map(
                                                      (r, i) =>
                                                        i === ri
                                                          ? {
                                                              ...r,
                                                              bullets:
                                                                r.bullets.map(
                                                                  (b, j) =>
                                                                    j === bi
                                                                      ? value
                                                                      : b,
                                                                ),
                                                            }
                                                          : r,
                                                    ),
                                                  })),
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="role-actions">
                                          <button
                                            className="text-button muted"
                                            onClick={() => {
                                              const bi = role.bullets.length;
                                              mutate((d) => ({
                                                ...d,
                                                roles: d.roles.map((r, i) =>
                                                  i === ri
                                                    ? {
                                                        ...r,
                                                        bullets: [
                                                          ...r.bullets,
                                                          "",
                                                        ],
                                                      }
                                                    : r,
                                                ),
                                              }));
                                              setEditing(`bullet-${ri}-${bi}`);
                                            }}
                                          >
                                            + Add bullet
                                          </button>
                                          <button
                                            className="text-button muted"
                                            aria-label={`Remove role ${role.title || ri + 1}`}
                                            onClick={() =>
                                              removeRole(ri, company)
                                            }
                                          >
                                            Remove role
                                          </button>
                                        </div>
                                      </section>
                                    ))}
                                    <div className="experience-actions">
                                      <button
                                        className="text-button muted"
                                        disabled={doc.roles.length >= 30}
                                        onClick={() => addCompanyRole(company)}
                                      >
                                        + Add role
                                      </button>
                                      <button
                                        className="text-button muted"
                                        aria-label={`Remove company ${company.company || ""}`.trim()}
                                        onClick={() => removeCompany(company)}
                                      >
                                        Remove company
                                      </button>
                                    </div>
                                  </section>
                                );
                              })}
                            </div>
                            <button
                              className="text-button add-role muted"
                              disabled={doc.roles.length >= 30}
                              onClick={() =>
                                addExperienceRole(doc.roles.length - 1)
                              }
                            >
                              + Add company
                            </button>
                          </>
                        ) : section.id === "skills" ? (
                          baseField("skills")
                        ) : section.id === "education" ? (
                          <>
                            {doc.edu.map((edu, i) => (
                              <div className="education-row" key={i}>
                                <div className="education-details">
                                  {(["degree", "school"] as const).map((key) =>
                                    field(
                                      "education-" + key + "-" + i,
                                      edu[key],
                                      (value) =>
                                        mutate((d) => ({
                                          ...d,
                                          edu: d.edu.map((e, j) =>
                                            j === i
                                              ? { ...e, [key]: value }
                                              : e,
                                          ),
                                        })),
                                    ),
                                  )}
                                </div>
                                {field(
                                  "education-dates-" + i,
                                  edu.dates,
                                  (value) =>
                                    mutate((d) => ({
                                      ...d,
                                      edu: d.edu.map((e, j) =>
                                        j === i ? { ...e, dates: value } : e,
                                      ),
                                    })),
                                  "role-dates",
                                )}
                              </div>
                            ))}
                            <button
                              className="text-button muted add-role"
                              onClick={() =>
                                mutate((d) => ({
                                  ...d,
                                  edu: [
                                    ...d.edu,
                                    {
                                      degree: "",
                                      school: "",
                                      dates: "",
                                    },
                                  ],
                                }))
                              }
                            >
                              + Add education
                            </button>
                          </>
                        ) : extra ? (
                          field(
                            `extra-text-${extraIndex}`,
                            extra.text,
                            (value) =>
                              mutate((d) => ({
                                ...d,
                                extraSections: d.extraSections?.map((s, i) =>
                                  i === extraIndex ? { ...s, text: value } : s,
                                ),
                              })),
                            "extra-section-text",
                            true,
                          )
                        ) : null}
                      </section>
                    );
                  })}
                </article>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">R</div>
                <h1>Start with your current resume</h1>
                <p>
                  Import once, keep your templates organized, and tailor a copy
                  for every opportunity.
                </p>
                <button
                  className="dropzone"
                  onClick={() => {
                    importSource.current = "Uploaded file";
                    fileInput.current?.click();
                  }}
                >
                  <span className="upload-glyph">↑</span>
                  <strong>Drop a .docx or .pdf here</strong>
                  <span>or click to browse · up to 10 MB</span>
                </button>
                <div className="empty-tiles">
                  <button
                    className="import-tile"
                    onClick={() => open("drive-intro")}
                  >
                    Google Drive <span>→</span>
                  </button>
                </div>
                <button className="text-button" onClick={createBlankResume}>
                  Start with a blank resume
                </button>
              </div>
            )}
          </div>
          <div className="notes-drawer">
            <button
              className="notes-toggle"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((v) => !v)}
            >
              <strong>Notes</strong>
              <span className="muted">
                {w.notes.length} notes · {w.references?.length || 0} references
                · used with AI
              </span>
              <span className="mono">{notesOpen ? "Hide" : "Show"}</span>
            </button>
            {notesOpen && (
              <div className="notes-body">
                <ReferenceDocuments
                  key={referenceEpoch}
                  isCurrent={() => workspaceEpoch.current === referenceEpoch}
                  documents={w.references || []}
                  onAdd={(document) => {
                    contextVersion.current++;
                    setSuggestions([]);
                    setW((state) => ({
                      ...state,
                      references: [...(state.references || []), document],
                    }));
                  }}
                  onRemove={(id) => {
                    contextVersion.current++;
                    setSuggestions([]);
                    setW((state) => ({
                      ...state,
                      references: (state.references || []).filter(
                        (document) => document.id !== id,
                      ),
                    }));
                  }}
                />
                <div className="notes-list">
                  {w.notes.map((n) => (
                    <div className="note" key={n.id}>
                      <span>{n.text}</span>
                      <button
                        aria-label={"Remove note: " + n.text}
                        onClick={() =>
                          setW((s) => ({
                            ...s,
                            notes: s.notes.filter((x) => x.id !== n.id),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <form
                  className="note-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (noteDraft.trim()) {
                      setW((s) => ({
                        ...s,
                        notes: [
                          ...s.notes,
                          {
                            id: uid(),
                            text: noteDraft.trim(),
                            createdAt: new Date().toISOString(),
                          },
                        ],
                      }));
                      setNoteDraft("");
                    }
                  }}
                >
                  <input
                    aria-label="Add a quick note"
                    placeholder="Add a quick note… then press Enter"
                    maxLength={2000}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                  />
                  <button
                    className="primary"
                    type="button"
                    disabled={
                      aiBusy ||
                      !doc ||
                      (!w.notes.length && !w.references?.length)
                    }
                    onClick={() => {
                      setRight(true);
                      setChatOpen(false);
                      void runAI("notes");
                    }}
                  >
                    {aiBusy
                      ? "Drafting…"
                      : ai
                        ? "Apply notes with AI"
                        : "Connect AI to apply notes"}
                  </button>
                </form>
              </div>
            )}
          </div>
        </main>
        {!right && (
          <button
            className="rail right-rail"
            aria-label="Expand right tools"
            onClick={() => setRight(true)}
          >
            <span>«</span>
            <span>{chatOpen ? "AI chat" : "AI resume match"}</span>
          </button>
        )}
        <aside
          className="right-panel right-tools"
          hidden={!right}
          aria-label="Right tools"
        >
          <div
            className="tool-tabs"
            role="tablist"
            aria-label="Right tools"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const nextChat =
                event.key === "Home"
                  ? false
                  : event.key === "End"
                    ? true
                    : !chatOpen;
              setChatOpen(nextChat);
              document
                .getElementById(nextChat ? "chat-tool-tab" : "match-tool-tab")
                ?.focus();
            }}
          >
            <button
              id="match-tool-tab"
              role="tab"
              aria-selected={!chatOpen}
              aria-controls="match-tool-panel"
              tabIndex={chatOpen ? -1 : 0}
              onClick={() => setChatOpen(false)}
            >
              Resume match
            </button>
            <button
              id="chat-tool-tab"
              role="tab"
              aria-selected={chatOpen}
              aria-controls="chat-tool-panel"
              tabIndex={chatOpen ? 0 : -1}
              onClick={() => setChatOpen(true)}
            >
              ✦ AI chat
            </button>
          </div>
          <div
            id="match-tool-panel"
            className="match-tool-panel right-tool-content"
            role="tabpanel"
            aria-labelledby="match-tool-tab"
            hidden={chatOpen}
          >
            {job && doc && !analysis ? (
              <div className="match-header">
                <div className="eyebrow mono">AI RESUME MATCH</div>
                <h1>{job.title}</h1>
                <p className="muted">{job.company}</p>
                <button
                  className="text-button posting-link"
                  onClick={() => open("posting")}
                >
                  Job description & links
                </button>
                {comparisonPanel}
                {matchingStatus}
                {!ai && (
                  <button
                    className="ghost full-width"
                    onClick={() => open("ai")}
                  >
                    Connect AI for matching
                  </button>
                )}
                <button
                  className="primary full-width"
                  disabled={!ai || matches.busy(job)}
                  onClick={reassessSelected}
                >
                  Reassess with AI
                </button>
              </div>
            ) : job && analysis ? (
              <>
                <div className="match-header">
                  <div className="eyebrow mono">AI RESUME MATCH</div>
                  <h1>{job.title}</h1>
                  <div className="muted">
                    {job.company} ·{" "}
                    {jobLinks(job)[0] ? (
                      <a
                        href={jobLinks(job)[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View posting ↗
                      </a>
                    ) : (
                      <button
                        className="text-button posting-link"
                        onClick={() => open("posting")}
                      >
                        View posting ↗
                      </button>
                    )}
                  </div>
                  <button
                    className="text-button posting-link"
                    onClick={() => open("posting")}
                  >
                    Job description & links
                  </button>
                </div>
                <div className="score-block ring">
                  <div
                    className="score-ring"
                    tabIndex={0}
                    aria-label={`${analysis.pct}% resume match`}
                    aria-describedby="match-score-tooltip"
                  >
                    <svg viewBox="0 0 96 96" aria-hidden="true">
                      <circle cx="48" cy="48" r="40" className="ring-track" />
                      <circle
                        cx="48"
                        cy="48"
                        r="40"
                        className="ring-progress"
                        strokeDasharray={`${(analysis.pct / 100) * 251.327} 251.327`}
                      />
                    </svg>
                    <strong>
                      {analysis.pct}
                      <span>%</span>
                    </strong>
                    <div
                      id="match-score-tooltip"
                      className="score-tooltip"
                      role="tooltip"
                    >
                      <b>Why {analysis.pct}%?</b>
                      <p>{analysis.summary}</p>
                      <p>
                        AI assesses the overall fit between this job and your
                        resume evidence. The percentage is not simply the share
                        of matched skills. Use Reassess with AI to update it.
                      </p>
                    </div>
                  </div>
                  <div className="score-copy">
                    <span className="muted">Attached resume</span>
                    <strong>{tier(analysis.pct)}</strong>
                    <span>
                      {analysis.matched} of {analysis.items.length} skills
                      matched
                    </span>
                  </div>
                  {comparisonPanel}
                </div>
                <p className="saved-assessment-label">
                  Saved assessment ·{" "}
                  {job.assessment?.assessedAt
                    ? new Date(job.assessment.assessedAt).toLocaleString()
                    : ""}
                </p>
                {matches.stale(job, doc) && (
                  <p className="assessment-stale" role="status">
                    Resume or job changed since this assessment. Click Reassess
                    with AI to update it.
                  </p>
                )}
                {matchingStatus}
                <div className="match-actions">
                  <button
                    className="text-button"
                    disabled={!ai || !doc || matches.busy(job)}
                    onClick={reassessSelected}
                  >
                    Reassess with AI
                  </button>
                </div>
                <SkillMatchList
                  items={analysis.items}
                  onFocus={focusSkill}
                  onAdd={addSkill}
                />
                <details className="score-explanation">
                  <summary>Why this score?</summary>
                  <p>{analysis.summary}</p>
                  <p className="muted">
                    Assessed by{" "}
                    {job.assessment
                      ? aiProviderName(
                          job.assessment.provider,
                          job.assessment.method,
                        ) +
                        " · " +
                        (job.assessment.model || "CLI default")
                      : aiLabel}
                    . Based on the job and documented resume evidence.
                  </p>
                </details>
                <details
                  className="ai-card"
                  open={aiBusy || suggestions.length > 0 ? true : undefined}
                >
                  <summary>Improve resume with AI</summary>
                  <div className="ai-card-header">
                    <strong>Tailor with AI</strong>
                    <span className="provider-badge mono">
                      {ai
                        ? aiProviderName(ai.provider, ai.method)
                        : "Not connected"}
                    </span>
                  </div>
                  {aiBusy ? (
                    <div className="loading-row">
                      <span className="spinner" />
                      Drafting with{" "}
                      {ai ? aiProviderName(ai.provider, ai.method) : "AI"}…
                    </div>
                  ) : suggestions.length ? (
                    <>
                      <p className="muted">
                        {suggestionMode === "notes"
                          ? "From your notes"
                          : "Grounded in your experience"}
                        . Review before adding.
                      </p>
                      {suggestionCards}
                    </>
                  ) : (
                    <>
                      <p>
                        Draft stronger lines for the missing keywords, grounded
                        in your resume and notes.
                      </p>
                      <button
                        className="primary full-width"
                        disabled={
                          !!ai && !analysis.items.some((k) => !k.matched)
                        }
                        onClick={() => void runAI("suggest")}
                      >
                        {ai
                          ? "Suggest lines for " +
                            analysis.items.filter((k) => !k.matched).length +
                            " gaps"
                          : "Connect Codex or Claude"}
                      </button>
                    </>
                  )}
                </details>
                <details className="display-options">
                  <summary>Display options</summary>
                  <label>
                    Highlights
                    <select
                      value={highlightStyle}
                      onChange={(e) => setHighlightStyle(e.target.value)}
                    >
                      <option value="marker">Marker</option>
                      <option value="underline">Underline</option>
                      <option value="bold">Bold</option>
                    </select>
                  </label>
                </details>
              </>
            ) : template && doc ? (
              <>
                <div className="match-header">
                  <div className="eyebrow mono">TEMPLATE</div>
                  <h1 className="mono">{template.name}</h1>
                  <p className="muted">Used by {uses} jobs</p>
                </div>
                <div className="template-job-groups">
                  {[true, false].map((same) => (
                    <section key={String(same)}>
                      <h3>
                        {same ? "Jobs using this template" : "Other jobs"}
                      </h3>
                      {!same && (
                        <p className="muted">
                          Saved job assessments. Open a job to view its last
                          analysis.
                        </p>
                      )}
                      {w.jobs
                        .filter((j) => (j.templateId === template.id) === same)
                        .map((j) => (
                          <button
                            className="template-job"
                            key={j.id}
                            onClick={() => selectJob(j.id)}
                          >
                            <span>
                              <strong>{j.company}</strong>
                              <span>{j.title}</span>
                            </span>
                            {matches.get(j, doc) ? (
                              <ScorePill pct={matches.get(j, doc)!.pct} />
                            ) : (
                              <span className="score-pill">—</span>
                            )}
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
                {suggestions.length > 0 && (
                  <div className="ai-card">
                    <strong>Changes from your notes</strong>
                    {suggestionCards}
                  </div>
                )}
              </>
            ) : (
              <div className="match-header">
                <div className="eyebrow mono">AI RESUME MATCH</div>
                <h1>Make every application count</h1>
                <p className="muted">
                  Import a resume, connect AI and select a job for an AI
                  assessment.
                </p>
              </div>
            )}
            {debugJob && doc && (
              <MatchingDiagnostics
                report={matches.debug(debugJob, doc)}

                target={debugJob.title + " · " + debugJob.company}
              />
            )}
          </div>
          <div
            id="chat-tool-panel"
            className="chat-tool-panel right-tool-content"
            role="tabpanel"
            aria-labelledby="chat-tool-tab"
            hidden={!chatOpen}
          >
            <AIChat
              open={right && chatOpen}
              onOpenChange={(value) => {
                setChatOpen(value);
                if (!value) chatTrigger.current?.focus();
              }}
              connection={ai}
              workspace={w}
              resetKey={chatResetKey}
              onConnect={() => open("ai")}
              onApplyChange={acceptChatChange}
              beforeSave={storage.flush}
            />
          </div>
        </aside>
      </div>
      {modal && (
        <Dialog
          onClose={close}
          busy={busy}
          title={
            modal === "ai"
              ? "Connect an AI assistant"
              : modal === "rename-template"
                ? "Rename resume"
                : modal === "delete-template"
                  ? "Delete resume template"
                  : modal === "job"
                    ? "Add a job"
                    : "Import resume"
          }
        >
          {modal === "rename-template" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = resumeName.trim();
                if (!name || name.length > 160) {
                  setError("Enter a resume name between 1 and 160 characters.");
                  return;
                }
                if (
                  w.templates.some(
                    (template) =>
                      template.id !== renamingTemplate &&
                      template.name.toLocaleLowerCase() ===
                        name.toLocaleLowerCase(),
                  )
                ) {
                  setError("A resume already uses this name.");
                  return;
                }
                setW((state) => ({
                  ...state,
                  templates: state.templates.map((template) =>
                    template.id === renamingTemplate
                      ? { ...template, name }
                      : template,
                  ),
                }));
                setModal(null);
                flash(`Renamed resume to “${name}”`);
              }}
            >
              <h2>Rename resume</h2>
              <label className="form-field">
                Resume name
                <input
                  ref={renameInput}
                  value={resumeName}
                  required
                  maxLength={160}
                  onChange={(event) => {
                    setResumeName(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <div className="dialog-footer">
                <button type="button" className="ghost" onClick={close}>
                  Cancel
                </button>
                <button className="primary" disabled={!resumeName.trim()}>
                  Save name
                </button>
              </div>
            </form>
          )}
          {modal === "delete-template" && (
            <>
              <h2>Delete resume template?</h2>
              <p className="dialog-description">
                Delete “
                {w.templates.find((t) => t.id === deletingTemplate)?.name}” and
                its edits and saved original file from this device? Saved jobs,
                tailored copies, and notes will be kept.
              </p>
              <p className="muted mono">
                {w.templates.find((t) => t.id === deletingTemplate)?.sourceFile}
              </p>
              {w.jobs.some((j) => j.templateId === deletingTemplate) &&
                (w.templates.length > 1 ? (
                  <label className="form-field">
                    Replacement for linked jobs
                    <select
                      aria-label="Replacement template"
                      value={replacementTemplate}
                      onChange={(e) => setReplacementTemplate(e.target.value)}
                    >
                      {w.templates
                        .filter((t) => t.id !== deletingTemplate)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <p className="dialog-description">
                    Linked jobs will have no base template until you import a
                    new resume. Their tailored copies remain available.
                  </p>
                ))}
              <div className="dialog-footer">
                <button className="ghost" onClick={close}>
                  Cancel
                </button>
                <button
                  className="primary danger"
                  onClick={() => {
                    setW((s) =>
                      deleteTemplate(s, deletingTemplate, replacementTemplate),
                    );
                    void deleteResumeSource(deletingTemplate).catch(() => {});
                    setSuggestions([]);
                    setModal(null);
                    flash(
                      "Resume template deleted. Saved jobs and notes kept.",
                    );
                  }}
                >
                  Delete template
                </button>
              </div>
            </>
          )}
          {modal === "import" && (
            <>
              <h2>Import your resume</h2>
              <p className="dialog-description">
                It’s saved as a new template you can assign to jobs and tailor.
                We’ll read sections, roles and skills.
              </p>
              <div className="import-options">
                <button
                  className="import-tile"
                  onClick={() => open("drive-intro")}
                >
                  <span className="tile-icon mono">GD</span>
                  <span>
                    <strong>Google Drive</strong>
                    <small>A .docx, .pdf or Google Doc from your Drive</small>
                  </span>
                  <span>→</span>
                </button>
                <button
                  className="import-tile"
                  onClick={() => {
                    importSource.current = "Uploaded file";
                    fileInput.current?.click();
                  }}
                >
                  <span className="tile-icon mono">DOC</span>
                  <span>
                    <strong>Upload a file</strong>
                    <small>.docx or .pdf, up to 10 MB</small>
                  </span>
                  <span>→</span>
                </button>
              </div>
              <div className="dialog-footer">
                <button className="text-button" onClick={createBlankResume}>
                  Start blank
                </button>
                <button className="ghost" onClick={() => open("reset")}>
                  Start fresh
                </button>
                <button className="ghost" onClick={close}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {modal === "reset" && (
            <>
              <h2>Start a fresh workspace?</h2>
              <p className="dialog-description">
                This clears every template, saved job, chat, note and reference
                on this computer, including any edits. A recovery snapshot is
                saved before clearing. Old browser copies are kept.
              </p>
              <div className="dialog-footer">
                <button className="ghost" onClick={() => open("import")}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await replaceWorkspace({ action: "reset" });
                      setModal(null);
                      flash("Your workspace is ready for a new resume");
                    } catch (e) {
                      flash((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Clear workspace
                </button>
              </div>
            </>
          )}
          {modal === "importing" && (
            <>
              <h2>Importing</h2>
              <p className="dialog-description">{loadingName}</p>
              <div className="loading-bar">
                <span />
              </div>
              <p className="muted">Reading sections, roles and skills…</p>
            </>
          )}
          {modal === "drive-intro" && (
            <>
              <h2>Import from Google Drive</h2>
              <p className="dialog-description">
                Choose a Word document, PDF or Google Doc. Your Google access
                token stays in memory for this session.
              </p>
              {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                <div className="integration-note">
                  Google Drive needs a Google OAuth client ID configured for
                  this app. You can download your resume from Drive and upload
                  it here now.
                </div>
              )}
              <div className="dialog-footer">
                <button
                  className="ghost"
                  onClick={() => {
                    importSource.current = "Uploaded file";
                    fileInput.current?.click();
                  }}
                >
                  Upload downloaded file
                </button>
                <button
                  className="primary"
                  disabled={busy || !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
                  onClick={loadDrive}
                >
                  {busy ? "Connecting…" : "Connect Google Drive"}
                </button>
              </div>
            </>
          )}
          {modal === "drive" && (
            <>
              <h2>Google Drive</h2>
              <p className="dialog-description">
                Choose the resume to save as a new template.
              </p>
              <div className="drive-list">
                {driveFiles.map((f) => (
                  <label key={f.id}>
                    <input
                      type="radio"
                      name="drive-file"
                      value={f.id}
                      checked={driveSelected === f.id}
                      onChange={() => setDriveSelected(f.id)}
                    />
                    <span>{f.name}</span>
                    <small>
                      {new Date(f.modifiedTime).toLocaleDateString()}
                    </small>
                  </label>
                ))}
                {!driveFiles.length && (
                  <p>No Word documents, PDFs or Google Docs found.</p>
                )}
              </div>
              <div className="dialog-footer">
                <button className="ghost" onClick={close}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || !driveSelected}
                  onClick={importDrive}
                >
                  {busy ? "Importing…" : "Import"}
                </button>
              </div>
            </>
          )}
          {modal === "pdf-preview" && (
            <>
              <h2>
                Resume preview · {doc?.pageCount || 1}{" "}
                {(doc?.pageCount || 1) === 1 ? "page" : "pages"}
              </h2>
              <iframe
                className="pdf-preview"
                title="Resume PDF preview"
                src={pdfPreview || undefined}
              />
              <div className="dialog-footer">
                <button className="ghost" onClick={close}>
                  Close
                </button>
                <button className="primary" onClick={() => void exportPDF()}>
                  Download PDF
                </button>
              </div>
            </>
          )}
          {modal === "ai" && (
            <AIConnector
              connection={ai}
              doc={doc || emptyDoc}
              busy={busy}
              onBusy={setBusy}
              onError={setError}
              onClose={close}
              onDisconnect={() => {
                const removed = setAI(null);
                setSuggestions([]);
                close();
                flash(
                  removed
                    ? "AI disconnected and saved connection removed"
                    : "Disconnected for this session. Browser storage could not remove the saved connection.",
                );
              }}
              onConnected={(connection) => {
                const saved = setAI(connection);
                setModal(returnToJob ? "job" : null);
                setReturnToJob(false);
                flash(
                  saved
                    ? "AI settings saved. All AI features will reuse this connection."
                    : "Connected for this session. Browser storage could not save your AI settings.",
                );
              }}
            />
          )}
          {modal === "job" && (
            <>
              <h2>{pending ? "Review job" : "Add a job"}</h2>
              {!w.templates.length ? (
                <>
                  <p className="dialog-description">
                    Import a resume first so this job has a base template.
                  </p>
                  <button className="primary" onClick={() => open("import")}>
                    Import resume
                  </button>
                </>
              ) : pending ? (
                <>
                  <span className="preview-source mono">{pending.source}</span>
                  <label className="form-field">
                    Job title
                    <input
                      value={pending.title}
                      onChange={(e) =>
                        setPending({ ...pending, title: e.target.value })
                      }
                    />
                  </label>
                  <div className="form-grid">
                    <label className="form-field">
                      Company
                      <input
                        value={pending.company}
                        onChange={(e) =>
                          setPending({ ...pending, company: e.target.value })
                        }
                      />
                    </label>
                    <label className="form-field">
                      Location
                      <input
                        value={pending.location}
                        onChange={(e) =>
                          setPending({ ...pending, location: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <JobLinks
                    links={jobLinks(pending)}
                    onChange={(links) =>
                      setPending(withJobLinks(pending, links))
                    }
                  />
                  <div className="keyword-heading">
                    <strong>
                      {pending.keywords.length} keywords found by AI
                    </strong>
                  </div>
                  <p className="muted small-copy">
                    Review detected keywords. Click a chip to remove it; add any
                    missing term.
                  </p>
                  <div className="preview-keywords">
                    {pending.keywords.map((k) => (
                      <button
                        className="keyword-chip"
                        key={k.term}
                        aria-label={"Remove keyword " + k.term}
                        onClick={() =>
                          setPending({
                            ...pending,
                            keywords: pending.keywords.filter(
                              (x) => x.term !== k.term,
                            ),
                          })
                        }
                      >
                        {k.term}
                        {k.required ? " *" : ""} ×
                      </button>
                    ))}
                  </div>
                  <form
                    className="row keyword-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (
                        customKeyword.trim() &&
                        !pending.keywords.some(
                          (k) =>
                            k.term.toLowerCase() ===
                            customKeyword.trim().toLowerCase(),
                        )
                      ) {
                        setPending({
                          ...pending,
                          keywords: [
                            ...pending.keywords,
                            {
                              term: customKeyword.trim(),
                              category: "Hard skills",
                              required: false,
                            },
                          ],
                        });
                        setCustomKeyword("");
                      }
                    }}
                  >
                    <input
                      aria-label="Add keyword"
                      maxLength={100}
                      placeholder="Add a keyword…"
                      value={customKeyword}
                      onChange={(e) => setCustomKeyword(e.target.value)}
                    />
                    <button className="ghost">Add</button>
                  </form>
                  <label className="form-field">
                    Base template
                    <select
                      value={pendingTemplate}
                      onChange={(e) => setPendingTemplate(e.target.value)}
                    >
                      {w.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="recommendation">
                    AI matching runs once after you add this job. The assessment
                    is saved until you choose Reassess with AI.
                  </p>
                  <div className="dialog-footer">
                    <button className="ghost" onClick={() => setPending(null)}>
                      ← Back
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !pending.title.trim() ||
                        !pending.company.trim() ||
                        !pendingTemplate ||
                        !pending.keywords.length
                      }
                      onClick={() => {
                        const added = {
                          ...pending,
                          templateId: pendingTemplate,
                        };
                        const base = w.templates.find(
                          (t) => t.id === pendingTemplate,
                        );
                        const resume = base ? w.docs[base.docId] : undefined;
                        setW((s) => ({
                          ...s,
                          jobs: [...s.jobs, added],
                          selectedJobId: pending.id,
                          viewTemplateId: null,
                        }));
                        setModal(null);
                        if (resume) void matches.reassess(added, resume);
                        flash("Job saved. Initial AI assessment started.");
                      }}
                    >
                      Add job and analyze
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="dialog-description">
                    AI scans the posting for the job details, required skills,
                    and preferred qualifications. Review the results before
                    saving.
                  </p>
                  <div className="segmented">
                    <button
                      disabled={busy}
                      className={jobTab === "url" ? "active" : ""}
                      onClick={() => {
                        setJobTab("url");
                        setError("");
                      }}
                    >
                      Job link
                    </button>
                    <button
                      disabled={busy}
                      className={jobTab === "paste" ? "active" : ""}
                      onClick={() => {
                        setJobTab("paste");
                        setError("");
                      }}
                    >
                      Paste description
                    </button>
                  </div>
                  {jobTab === "url" ? (
                    <label className="form-field">
                      Job URL
                      <input
                        type="url"
                        disabled={busy}
                        autoFocus
                        placeholder="Paste the job posting URL"
                        value={jobUrl}
                        onChange={(e) => setJobUrl(e.target.value)}
                      />
                      {jobUrl && (
                        <small className="detection">Job posting URL</small>
                      )}
                    </label>
                  ) : (
                    <>
                      <label className="form-field">
                        Job description
                        <textarea
                          aria-label="Job description"
                          autoFocus
                          rows={8}
                          disabled={busy}
                          placeholder="Paste the title, company, responsibilities and requirements…"
                          value={description}
                          maxLength={60000}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                        <small>
                          Include the responsibilities and requirements.{" "}
                          {description.trim().length}/50 characters minimum.
                        </small>
                      </label>
                      <label className="form-field">
                        Job URL (optional)
                        <input
                          type="url"
                          maxLength={2000}
                          disabled={busy}
                          value={jobUrl}
                          onChange={(e) => setJobUrl(e.target.value)}
                          placeholder="Company posting or LinkedIn URL"
                        />
                        <small>
                          Saved for reference. AI scans the pasted description.
                        </small>
                      </label>
                    </>
                  )}
                  {!ai && (
                    <p className="dialog-description">
                      Connect Claude or Codex using an API key or subscription
                      to scan this job.
                    </p>
                  )}
                  <div className="dialog-footer">
                    <button className="ghost" onClick={close}>
                      Cancel
                    </button>
                    {!ai ? (
                      <button
                        className="primary"
                        onClick={() => {
                          setReturnToJob(true);
                          setError("");
                          setModal("ai");
                        }}
                      >
                        Connect AI to scan job
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          (jobTab === "url"
                            ? !jobUrl.trim()
                            : description.trim().length < 50)
                        }
                        onClick={importJob}
                      >
                        {busy ? "Scanning job with AI…" : "Scan job with AI"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {modal === "posting" && (
            <>
              <h2>{job?.title}</h2>
              <p className="dialog-description">{job?.company}</p>
              {job && (
                <JobLinks
                  key={job.id}
                  links={jobLinks(job)}
                  onChange={(links) =>
                    setW((s) => ({
                      ...s,
                      jobs: s.jobs.map((j) =>
                        j.id === job.id ? withJobLinks(j, links) : j,
                      ),
                    }))
                  }
                />
              )}
              <div className="posting-description">{job?.rawDescription}</div>
            </>
          )}
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
