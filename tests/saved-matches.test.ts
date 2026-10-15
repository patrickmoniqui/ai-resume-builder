import test from "node:test";
import assert from "node:assert/strict";
import {
  blankResume,
  initialWorkspace,
  migrateWorkspace,
} from "../lib/initial";
import { parseResumeMatch } from "../lib/resume-match";
import {
  assessmentSignature,
  saveAssessment,
  savedAssessmentSchema,
} from "../lib/saved-matches";
import type { Job } from "../lib/model";
const doc = { ...blankResume(), skills: "Python" };
const job: Job = {
  id: "job",
  templateId: "base",
  title: "Engineer",
  company: "Employer",
  location: "",
  source: "",
  rawDescription: "Python required.",
  keywords: [{ term: "Python", category: "Tools", required: true }],
};
const result = parseResumeMatch(
  {
    pct: 82,
    summary: "Relevant skills",
    items: [
      {
        keywordIndex: 0,
        kind: "language",
        matched: true,
        evidence: "Python",
        reason: "Listed in skills.",
      },
    ],
  },
  job,
  doc,
);
test("saved AI assessments retain scores, skills and metadata through storage without credentials", () => {
  const saved = saveAssessment(
    {
      method: "apiKey",
      provider: "openai",
      model: "test-model",
      key: "private-test-key",
    },
    job,
    doc,
    result,
  );
  const restored = savedAssessmentSchema.parse(
    JSON.parse(JSON.stringify(saved)),
  );
  assert.deepEqual(restored.result, result);
  assert.equal(restored.provider, "openai");
  assert.ok(!JSON.stringify(saved).includes("private-test-key"));
  assert.equal(restored.inputSignature, assessmentSignature(job, doc));
});
test("change detection ignores serialization/selection/cache metadata and flags real resume/job edits", () => {
  const signature = assessmentSignature(job, doc);
  const reordered = Object.fromEntries(
    Object.entries(doc).reverse(),
  ) as typeof doc;
  assert.equal(
    assessmentSignature(
      { ...job, source: "New source", tailoredDocId: "copy" },
      reordered,
    ),
    signature,
  );
  assert.notEqual(
    assessmentSignature(job, { ...doc, skills: "Python, SQL" }),
    signature,
  );
  assert.notEqual(
    assessmentSignature({ ...job, rawDescription: "SQL required." }, doc),
    signature,
  );
  const assessment = saveAssessment(
    { method: "subscription", provider: "anthropic", model: "" },
    job,
    doc,
    result,
  );
  assert.equal(assessmentSignature({ ...job, assessment }, doc), signature);
});
test("workspace migration preserves a job's saved assessment, including when its resume changes", () => {
  const workspace = initialWorkspace();
  workspace.templates = [
    {
      id: "base",
      docId: "t:base",
      name: "Resume",
      source: "Uploaded",
      sourceFile: "resume.pdf",
    },
  ];
  workspace.docs["t:base"] = { ...doc, skills: "Changed skills" };
  workspace.jobs = [
    {
      ...job,
      assessment: saveAssessment(
        { method: "subscription", provider: "anthropic", model: "" },
        job,
        doc,
        result,
      ),
    },
  ];
  assert.equal(
    migrateWorkspace(JSON.parse(JSON.stringify(workspace))).jobs[0].assessment
      ?.result.pct,
    82,
  );
});
