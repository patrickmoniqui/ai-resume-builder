import test from "node:test";
import assert from "node:assert/strict";
import { jobLinkSchema, jobLinks, withJobLinks } from "../lib/job-links";
import { storedWorkspaceSchema } from "../lib/workspace-storage";
import { initialWorkspace } from "../lib/initial";

test("job links accept web URLs and reject executable or credential-bearing links", () => {
  for (const value of [
    "https://example.com/jobs/123",
    "http://example.com/jobs/123",
  ]) {
    assert.ok(jobLinkSchema.safeParse(value).success);
  }
  for (const value of [
    "javascript:alert(1)",
    "file:///resume.pdf",
    "https://user:password@example.com/job",
    "not a URL",
  ]) {
    assert.equal(jobLinkSchema.safeParse(value).success, false);
  }
});

test("job link edits retain job fields and promote the next link when the first is removed", () => {
  const original = {
    id: "job",
    url: "https://example.com/company",
    additionalUrls: [
      "https://example.com/other",
      "https://example.com/company",
      "javascript:alert(1)",
    ],
  };
  const links = jobLinks(original);
  assert.deepEqual(links, [
    "https://example.com/company",
    "https://example.com/other",
  ]);
  const edited = withJobLinks(original, links.slice(1));
  assert.equal(edited.id, "job");
  assert.equal(edited.url, "https://example.com/other");
  assert.deepEqual(edited.additionalUrls, []);
  assert.equal(withJobLinks(edited, []).url, undefined);
  assert.equal(original.url, "https://example.com/company");
});

test("additional links survive workspace validation and invalid saved links are rejected", () => {
  const job = {
    id: "job",
    templateId: "",
    title: "Engineer",
    company: "Example",
    location: "Remote",
    source: "Pasted",
    rawDescription: "Build useful tools.",
    keywords: [],
    url: "https://example.com/company",
    additionalUrls: ["https://example.com/other"],
  };
  const workspace = { ...initialWorkspace(), jobs: [job] };
  assert.deepEqual(
    storedWorkspaceSchema.parse(workspace).jobs[0].additionalUrls,
    job.additionalUrls,
  );
  assert.equal(
    storedWorkspaceSchema.safeParse({
      ...workspace,
      jobs: [{ ...job, additionalUrls: ["javascript:alert(1)"] }],
    }).success,
    false,
  );
});
