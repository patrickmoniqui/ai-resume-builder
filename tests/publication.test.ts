import test from "node:test";
import assert from "node:assert/strict";
import { publicationIssues } from "../scripts/check-publication";

test("publication guard rejects sensitive paths even without file content", () => {
  for (const file of [
    ".env.local",
    "resume.pdf",
    "resume.docx",
    "resume-builder-backup.json",
    ".env",
    "tmp/resume.pdf",
    "test-results/desktop.png",
    "data/export.json",
    "saved.sqlite-wal",
    "private.pem",
    ".codex/auth.json",
  ]) {
    assert.ok(publicationIssues(file, "").length, file);
  }
  assert.deepEqual(
    publicationIssues(".env.example", "NEXT_PUBLIC_GOOGLE_CLIENT_ID=\n"),
    [],
  );
  assert.deepEqual(publicationIssues("tests/fixtures/resume.docx", ""), []);
});

test("publication guard identifies credentials without returning secret values", () => {
  const samples = [
    ["sk", "proj", "x".repeat(48)].join("-"),
    ["ghp", "x".repeat(36)].join("_"),
    ["AKIA", "X".repeat(16)].join(""),
    ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
  ];
  for (const secret of samples) {
    const issues = publicationIssues("lib/example.ts", secret);
    assert.ok(issues.length);
    assert.ok(issues.every((issue) => !issue.includes(secret)));
  }
  assert.deepEqual(
    publicationIssues(
      "tests/example.ts",
      'key: "test-key", email: "jane@example.com"',
    ),
    [],
  );
});
