import type { Resume, Workspace } from "./model";
type Snapshot = {
  docs: Record<string, Resume | undefined>;
  bindings: Record<string, string | undefined>;
  selectedJobId: string | null;
  viewTemplateId: string | null;
};
type Entry = { before: Snapshot; after: Snapshot; group?: string };
export type ResumeHistory = {
  present: Workspace;
  past: Entry[];
  future: Entry[];
  group?: string;
};
export type HistoryAction =
  | { type: "set"; change: Workspace | ((w: Workspace) => Workspace) }
  | { type: "edit"; change: (w: Workspace) => Workspace; group?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "boundary" };
export const newResumeHistory = (present: Workspace): ResumeHistory => ({
  present,
  past: [],
  future: [],
});
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const bindings = (w: Workspace) =>
  w.jobs.map((j) => ({
    id: j.id,
    templateId: j.templateId,
    tailoredDocId: j.tailoredDocId,
  }));
function snapshots(before: Workspace, after: Workspace): [Snapshot, Snapshot] {
  const ids = [
    ...new Set([...Object.keys(before.docs), ...Object.keys(after.docs)]),
  ].filter((id) => !equal(before.docs[id], after.docs[id]));
  const jobs = after.jobs
    .filter(
      (j) =>
        before.jobs.find((b) => b.id === j.id)?.tailoredDocId !==
        j.tailoredDocId,
    )
    .map((j) => j.id);
  const capture = (w: Workspace): Snapshot => ({
    docs: Object.fromEntries(ids.map((id) => [id, w.docs[id]])),
    bindings: Object.fromEntries(
      jobs.map((id) => [id, w.jobs.find((j) => j.id === id)?.tailoredDocId]),
    ),
    selectedJobId: w.selectedJobId,
    viewTemplateId: w.viewTemplateId,
  });
  return [capture(before), capture(after)];
}
function apply(w: Workspace, snapshot: Snapshot): Workspace {
  const docs = { ...w.docs };
  for (const [id, doc] of Object.entries(snapshot.docs)) {
    if (doc) docs[id] = doc;
    else delete docs[id];
  }
  return {
    ...w,
    docs,
    jobs: w.jobs.map((j) =>
      Object.hasOwn(snapshot.bindings, j.id)
        ? { ...j, tailoredDocId: snapshot.bindings[j.id] }
        : j,
    ),
    selectedJobId: snapshot.selectedJobId,
    viewTemplateId: snapshot.viewTemplateId,
  };
}
function merge(a: Snapshot, b: Snapshot, first: boolean): Snapshot {
  return {
    ...b,
    docs: first ? { ...b.docs, ...a.docs } : { ...a.docs, ...b.docs },
    bindings: first
      ? { ...b.bindings, ...a.bindings }
      : { ...a.bindings, ...b.bindings },
  };
}
/** In-memory edit history. Navigation/notes remain current; lifecycle changes start a new history. */
export function resumeHistoryReducer(
  state: ResumeHistory,
  action: HistoryAction,
): ResumeHistory {
  if (action.type === "boundary") return { ...state, group: undefined };
  if (action.type === "undo" || action.type === "redo") {
    const source = action.type === "undo" ? state.past : state.future;
    const entry = source.at(-1);
    if (!entry) return state;
    return {
      present: apply(
        state.present,
        action.type === "undo" ? entry.before : entry.after,
      ),
      past:
        action.type === "undo"
          ? state.past.slice(0, -1)
          : [...state.past, entry],
      future:
        action.type === "undo"
          ? [...state.future, entry]
          : state.future.slice(0, -1),
      group: undefined,
    };
  }
  const present =
    typeof action.change === "function"
      ? action.change(state.present)
      : action.change;
  if (action.type === "set") {
    if (
      !equal(present.docs, state.present.docs) ||
      !equal(bindings(present), bindings(state.present))
    )
      return newResumeHistory(present);
    return { ...state, present };
  }
  const [before, after] = snapshots(state.present, present);
  if (!Object.keys(before.docs).length && !Object.keys(before.bindings).length)
    return state;
  const last = state.past.at(-1);
  const combine =
    action.group &&
    state.group === action.group &&
    last?.group === action.group;
  const entry: Entry =
    combine && last
      ? {
          before: merge(last.before, before, true),
          after: merge(last.after, after, false),
          group: action.group,
        }
      : { before, after, group: action.group };
  return {
    present,
    past: [...(combine ? state.past.slice(0, -1) : state.past), entry].slice(
      -100,
    ),
    future: [],
    group: action.group,
  };
}
