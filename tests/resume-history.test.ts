import test from "node:test";
import assert from "node:assert/strict";
import { blankResume } from "../lib/initial";
import { documentId, updateDocument, type Workspace } from "../lib/model";
import {
  newResumeHistory,
  resumeHistoryReducer as reduce,
} from "../lib/resume-history";
function fixture(): Workspace {
  return {
    templates: [
      {
        id: "base",
        docId: "t:base",
        name: "Resume",
        sourceFile: "",
        source: "",
      },
    ],
    docs: { "t:base": { ...blankResume(), name: "Original" } },
    jobs: [
      {
        id: "job",
        templateId: "base",
        title: "Engineer",
        company: "Employer",
        location: "",
        rawDescription: "Build tools",
        keywords: [{ term: "Python", category: "Tools", required: true }],
        source: "",
      },
    ],
    notes: [],
    selectedJobId: "job",
    viewTemplateId: "base",
  };
}
const editName = (name: string, group?: string) => ({
  type: "edit" as const,
  group,
  change: (w: Workspace) => updateDocument(w, (d) => ({ ...d, name })),
});
test("typing in a field is one undo step and committed edits are separate", () => {
  let state = newResumeHistory(fixture());
  state = reduce(state, editName("O", "name"));
  state = reduce(state, editName("Changed", "name"));
  assert.equal(state.past.length, 1);
  state = reduce(state, { type: "boundary" });
  state = reduce(state, editName("Second", "name"));
  assert.equal(state.past.length, 2);
  state = reduce(state, { type: "undo" });
  assert.equal(state.present.docs["t:base"].name, "Changed");
  state = reduce(state, { type: "undo" });
  assert.equal(state.present.docs["t:base"].name, "Original");
  state = reduce(state, { type: "redo" });
  assert.equal(state.present.docs["t:base"].name, "Changed");
});
test("undo and redo restore tailored-copy creation without changing shared template", () => {
  const w = fixture();
  w.viewTemplateId = null;
  let state = reduce(newResumeHistory(w), {
    type: "edit",
    change: (w) => updateDocument(w, (d) => ({ ...d, skills: "Python" }), true),
  });
  assert.equal(documentId(state.present), "j:job");
  state = reduce(state, { type: "undo" });
  assert.equal(documentId(state.present), "t:base");
  assert.equal(state.present.docs["j:job"], undefined);
  state = reduce(state, { type: "redo" });
  assert.equal(documentId(state.present), "j:job");
  assert.equal(state.present.docs["j:job"].skills, "Python");
  assert.equal(state.present.docs["t:base"].skills, "");
});
test("undo returns to edited resume, preserves notes and clears redo after new edits", () => {
  let state = reduce(newResumeHistory(fixture()), editName("Changed"));
  state = reduce(state, {
    type: "set",
    change: (w) => ({
      ...w,
      viewTemplateId: null,
      notes: [{ id: "note", text: "Keep this note", createdAt: "today" }],
    }),
  });
  state = reduce(state, { type: "undo" });
  assert.equal(state.present.viewTemplateId, "base");
  assert.equal(state.present.notes.length, 1);
  state = reduce(state, editName("New branch"));
  assert.equal(state.future.length, 0);
  assert.equal(reduce(state, { type: "redo" }), state);
});
test("history includes structural edits, accepted AI bullets, page count and discarded tailoring", () => {
  const w = fixture();
  w.viewTemplateId = null;
  let state = newResumeHistory(w);
  state = reduce(state, {
    type: "edit",
    change: (w) =>
      updateDocument(
        w,
        (d) => ({
          ...d,
          roles: [
            {
              company: "Employer",
              team: "Platform",
              title: "Engineer",
              dates: "",
              bullets: ["Built tools."],
            },
          ],
          pageCount: 2,
        }),
        true,
      ),
  });
  const edited = state.present.docs["j:job"];
  state = reduce(state, {
    type: "edit",
    change: (w) => ({
      ...w,
      docs: { "t:base": w.docs["t:base"] },
      jobs: w.jobs.map((j) => ({ ...j, tailoredDocId: undefined })),
    }),
  });
  state = reduce(state, { type: "undo" });
  assert.deepEqual(state.present.docs["j:job"], edited);
  state = reduce(state, { type: "undo" });
  assert.equal(documentId(state.present), "t:base");
  state = reduce(state, { type: "redo" });
  assert.deepEqual(state.present.docs["j:job"], edited);
});
test("no-op edits keep redo, history is bounded, and imports/deletions clear invalid history", () => {
  let state = reduce(newResumeHistory(fixture()), editName("Changed"));
  state = reduce(state, { type: "undo" });
  state = reduce(state, editName("Original"));
  assert.equal(state.future.length, 1);
  for (let i = 0; i < 105; i++) state = reduce(state, editName(String(i)));
  assert.equal(state.past.length, 100);
  state = reduce(state, {
    type: "set",
    change: (w) => ({ ...w, docs: {}, templates: [], jobs: [] }),
  });
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
});
