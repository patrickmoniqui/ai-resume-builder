import test from "node:test";
import assert from "node:assert/strict";
import { filterJobs, reorderVisibleJobs } from "../lib/job-list";
import type { Job } from "../lib/model";

const jobs: Job[] = [
  {
    id: "a",
    company: "Unity",
    title: "Backend Engineer",
    location: "Montréal",
    status: "applied",
    templateId: "base",
  },
  {
    id: "b",
    company: "Artelia",
    title: "Frontend Engineer",
    location: "Québec",
    status: "to-apply",
    templateId: "other",
  },
  {
    id: "c",
    company: "Unity",
    title: "Frontend Engineer",
    location: "Montréal",
    templateId: "base",
  },
  {
    id: "d",
    company: "Acme",
    title: "Designer",
    location: "Remote",
    templateId: "",
  },
].map((job) => ({
  ...job,
  source: "Manual",
  rawDescription: "",
  keywords: [{ term: "TypeScript", category: "Tools", required: true }],
})) as Job[];
const ids = (list: Job[]) => list.map((job) => job.id);
const filters = { query: "", status: "", templateId: "" };

test("job search combines words across fields and ignores case, accents and extra spaces", () => {
  assert.deepEqual(
    ids(
      filterJobs(jobs, { ...filters, query: "  UNITY  montreal TYPESCRIPT " }),
    ),
    ["a", "c"],
  );
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, query: "quebec frontend" })),
    ["b"],
  );
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, query: "unity designer" })),
    [],
  );
  assert.deepEqual(filterJobs(jobs, filters), jobs);
});

test("job filters intersect search, application status and assigned resume", () => {
  assert.deepEqual(
    ids(
      filterJobs(jobs, {
        query: "engineer",
        status: "applied",
        templateId: "base",
      }),
    ),
    ["a"],
  );
  assert.deepEqual(ids(filterJobs(jobs, { ...filters, status: "none" })), [
    "c",
    "d",
  ]);
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, templateId: "__none__" })),
    ["d"],
  );
  assert.deepEqual(
    ids(
      filterJobs(jobs, { ...filters, status: "applied", templateId: "other" }),
    ),
    [],
  );
});

test("company multiselect matches any selected company and intersects other filters", () => {
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, companies: ["Unity"] })),
    ["a", "c"],
  );
  assert.deepEqual(
    ids(
      filterJobs(jobs, {
        ...filters,
        companies: ["Unity"],
        query: "frontend",
        templateId: "base",
        status: "none",
      }),
    ),
    ["c"],
  );
  assert.deepEqual(
    ids(
      filterJobs(jobs, {
        ...filters,
        companies: ["Unity"],
        status: "to-apply",
      }),
    ),
    [],
  );
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, companies: ["Uni"] })),
    [],
  );
  assert.deepEqual(
    ids(filterJobs(jobs, { ...filters, companies: ["Unity", "Artelia"] })),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    ids(
      filterJobs(jobs, {
        ...filters,
        companies: ["Unity", "Artelia"],
        status: "to-apply",
      }),
    ),
    ["b"],
  );
  assert.deepEqual(filterJobs(jobs, { ...filters, companies: [] }), jobs);
});

test("filtered reordering preserves hidden slots, records and the original array", () => {
  const result = reorderVisibleJobs(jobs, ["a", "c"], "c", 0);
  assert.deepEqual(ids(result), ["c", "b", "a", "d"]);
  assert.equal(result[1], jobs[1]);
  assert.equal(result[3], jobs[3]);
  assert.equal(result[0], jobs[2]);
  assert.deepEqual(ids(jobs), ["a", "b", "c", "d"]);
  assert.equal(reorderVisibleJobs(jobs, ["a", "c"], "b", 0), jobs);
  assert.equal(reorderVisibleJobs(jobs, ["a", "c"], "a", -1), jobs);
  assert.deepEqual(ids(reorderVisibleJobs(jobs, ["a", "c"], "a", 99)), [
    "c",
    "b",
    "a",
    "d",
  ]);
});
