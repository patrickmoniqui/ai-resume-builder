import test from "node:test";
import assert from "node:assert/strict";
import { blankResume, initialWorkspace } from "../lib/initial";
import type { Job } from "../lib/model";
import { parseWorkspace } from "../lib/workspace-storage";
import { saveAssessment } from "../lib/saved-matches";
import {
  pendingAssessments,
  resumeCandidates,
  selectedComparisonIds,
} from "../lib/resume-comparisons";

function fixture() {
  const w = initialWorkspace();
  w.templates = ["a", "b", "c"].map((id) => ({
    id,
    docId: id,
    name: `Resume ${id}`,
    source: "Uploaded",
    sourceFile: "",
  }));
  w.docs = Object.fromEntries(
    ["a", "b", "c", "tailored"].map((id) => [
      id,
      { ...blankResume(), skills: id },
    ]),
  );
  const job: Job = {
    id: "job",
    templateId: "a",
    title: "Engineer",
    company: "Company",
    location: "",
    source: "",
    rawDescription: "React",
    keywords: [{ term: "React", category: "Tools", required: true }],
    comparisonDocIds: ["b", "tailored"],
  };
  w.jobs = [
    job,
    { ...job, id: "other", tailoredDocId: "tailored", comparisonDocIds: [] },
  ];
  const assessment = (id: string) =>
    saveAssessment(
      { method: "subscription", provider: "openai", model: "test" },
      job,
      w.docs[id],
      {
        pct: 75,
        summary: "Fit",
        matched: 0,
        required: 1,
        requiredMatched: 0,
        items: [
          {
            ...job.keywords[0],
            keywordIndex: 0,
            kind: "technology",
            matched: false,
            evidence: "",
            reason: "Missing",
          },
        ],
      },
    );
  return { w, job, assessment };
}

test("picker offers templates and tailored resumes, excluding attached or deleted documents", () => {
  const { w, job } = fixture();
  assert.deepEqual(
    resumeCandidates(w, job).map((c) => c.id),
    ["b", "c", "tailored"],
  );
  job.comparisonDocIds = ["a", "b", "b", "deleted", "tailored", "c"];
  assert.deepEqual(selectedComparisonIds(w, job), ["b", "tailored"]);
  delete w.docs.tailored;
  assert.deepEqual(selectedComparisonIds(w, job), ["b", "c"]);
});

test("reassessment runs only new or changed pairs; job changes invalidate all selected resumes", () => {
  const { w, job, assessment } = fixture();
  assert.equal(pendingAssessments(w, job).length, 3);
  job.assessment = assessment("a");
  job.comparisonAssessments = {
    b: assessment("b"),
    tailored: assessment("tailored"),
  };
  assert.deepEqual(pendingAssessments(w, job), []);
  w.docs.b.skills = "Updated";
  assert.deepEqual(
    pendingAssessments(w, job).map((p) => p.comparisonId),
    ["b"],
  );
  w.docs.a.summary = "Updated attached";
  assert.deepEqual(
    pendingAssessments(w, job).map((p) => p.comparisonId),
    [undefined, "b"],
  );
  job.rawDescription = "Changed requirements";
  assert.equal(pendingAssessments(w, job).length, 3);
});

test("comparison selections and independent scores survive workspace storage; legacy jobs still work", () => {
  const { w, job, assessment } = fixture();
  job.assessment = assessment("a");
  job.comparisonAssessments = {
    b: assessment("b"),
    tailored: assessment("tailored"),
  };
  const restored = parseWorkspace(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(restored.jobs[0], job);
  assert.deepEqual(pendingAssessments(restored, restored.jobs[0]), []);
  delete job.comparisonAssessments;
  delete job.comparisonDocIds;
  assert.equal(parseWorkspace(w).jobs[0].comparisonDocIds, undefined);
  assert.deepEqual(pendingAssessments(w, job), []);
});
