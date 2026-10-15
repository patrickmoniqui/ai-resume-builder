import test from "node:test";
import assert from "node:assert/strict";
import { blankResume } from "../lib/initial";
import {
  resumeSections,
  moveResumeSection,
  resumeSchema,
  updateDocument,
  type Workspace,
} from "../lib/model";
import { newResumeHistory, resumeHistoryReducer } from "../lib/resume-history";
import { buildResumePDF } from "../lib/resume-pdf";
import { parseResume } from "../lib/parsing";
import { PDFParse } from "pdf-parse";
import { taggedResumeText } from "../lib/resume-pdf-text";
const doc = {
  ...blankResume(),
  name: "Test Applicant",
  summary: "Builds useful tools.",
  skills: "Python",
  roles: [
    {
      company: "Test Employer",
      title: "Engineer",
      dates: "2020 – Present",
      bullets: ["Built reliable services."],
    },
  ],
  edu: [{ degree: "BSc", school: "University", dates: "2016 – 2020" }],
  extraSections: [
    { title: "Projects", text: "Built Project Beacon." },
    { title: "Languages", text: "French and English" },
  ],
};
test("legacy order, duplicate entries and stale extra references resolve without lost sections", () => {
  assert.deepEqual(
    resumeSections(doc).map((s) => s.id),
    ["summary", "experience", "skills", "education", "extra-0", "extra-1"],
  );
  const resolved = resumeSections({
    ...doc,
    sectionOrder: ["extra-1", "skills", "skills", "extra-29"],
  });
  assert.deepEqual(
    resolved.map((s) => s.id),
    ["extra-1", "skills", "summary", "experience", "education", "extra-0"],
  );
  assert.equal(
    resumeSchema.safeParse({ ...doc, sectionOrder: ["invalid"] }).success,
    false,
  );
});
test("sections can move to first/last positions without changing content", () => {
  const moved = moveResumeSection(doc, "extra-0", 0);
  assert.equal(resumeSections(moved)[0].title, "Projects");
  assert.deepEqual(moved.extraSections, doc.extraSections);
  assert.equal(
    resumeSections(moveResumeSection(moved, "extra-0", 100)).at(-1)?.title,
    "Projects",
  );
  assert.equal(moveResumeSection(doc, "unknown", 0), doc);
  assert.equal(moveResumeSection(doc, "summary", 0), doc);
});
test("section moves participate in undo/redo and remain isolated in tailored copies", () => {
  const w: Workspace = {
    templates: [
      {
        id: "base",
        docId: "t:base",
        name: "Resume",
        source: "",
        sourceFile: "",
      },
    ],
    docs: { "t:base": doc },
    jobs: [
      {
        id: "job",
        title: "Engineer",
        company: "Employer",
        location: "",
        rawDescription: "",
        keywords: [{ term: "Python", category: "Tools", required: true }],
        source: "",
        templateId: "base",
      },
    ],
    notes: [],
    selectedJobId: "job",
    viewTemplateId: null,
  };
  let state = resumeHistoryReducer(newResumeHistory(w), {
    type: "edit",
    change: (w) =>
      updateDocument(w, (d) => moveResumeSection(d, "skills", 0), true),
  });
  assert.equal(resumeSections(state.present.docs["j:job"])[0].id, "skills");
  assert.equal(resumeSections(state.present.docs["t:base"])[0].id, "summary");
  state = resumeHistoryReducer(state, { type: "undo" });
  assert.equal(state.present.docs["j:job"], undefined);
  state = resumeHistoryReducer(state, { type: "redo" });
  assert.equal(resumeSections(state.present.docs["j:job"])[0].id, "skills");
});
test("both PDF layouts export and reimport standard and additional sections in the chosen order", async () => {
  const reordered = {
    ...doc,
    sectionOrder: [
      "extra-0",
      "skills",
      "experience",
      "extra-1",
      "summary",
      "education",
    ],
  };
  for (const pageCount of [1, 2] as const) {
    const bytes = await buildResumePDF({ ...reordered, pageCount });
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const text = (await parser.getText({ pageJoiner: "" })).text;
      const titles = resumeSections(reordered).map((s) => s.title);
      const positions = titles.map((title) =>
        text.toLowerCase().indexOf(title.toLowerCase()),
      );
      assert.ok(
        positions.every(
          (position, i) =>
            position >= 0 && (i === 0 || position > positions[i - 1]),
        ),
      );
      const imported = parseResume((await taggedResumeText(bytes)) ?? text);
      assert.deepEqual(
        resumeSections(imported).map((s) => s.title.toLowerCase()),
        titles.map((title) => title.toLowerCase()),
      );
      assert.ok(
        imported.extraSections?.[0].text.includes("Built Project Beacon."),
      );
      assert.equal(imported.roles[0].company, "Test Employer");
    } finally {
      await parser.destroy();
    }
  }
});
