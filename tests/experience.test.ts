import test from "node:test";
import assert from "node:assert/strict";
import {
  groupExperience,
  insertExperienceRole,
  resumeSchema,
} from "../lib/model";
import { blankResume } from "../lib/initial";
import { parseResume } from "../lib/parsing";
import { buildResumePDF } from "../lib/resume-pdf";
import { PDFParse } from "pdf-parse";
import { taggedResumeText } from "../lib/resume-pdf-text";
const role = (company: string, title: string) => ({
  company,
  title,
  dates: "2020 – Present",
  bullets: [`Delivered ${title} projects.`],
});
const roles = [
  role("Company A", "Web developer"),
  role("Company A", "Senior developer"),
  role("Company A", "Tools programmer"),
  role("Company B", "Engineer"),
  role("Company A", "Consultant"),
];
test("experience grouping preserves chronology and original AI indices", () => {
  const groups = groupExperience(roles);
  assert.deepEqual(
    groups.map((g) => g.company),
    ["Company A", "Company B", "Company A"],
  );
  assert.deepEqual(
    groups[0].roles.map((r) => r.index),
    [0, 1, 2],
  );
  assert.equal(groups[2].roles[0].index, 4);
  assert.equal(groupExperience([role("", "One"), role("", "Two")]).length, 2);
});
test("shared company headings remain grouped while cleared during editing", () => {
  const cleared = roles.map((r, i) => (i < 3 ? { ...r, company: "" } : r));
  assert.equal(
    groupExperience(cleared, { company: [0, 1, 2] })[0].roles.length,
    3,
  );
});
test("new roles are inserted beside their company and saved teams are dropped", () => {
  const doc = { ...blankResume(), roles };
  const updated = insertExperienceRole(doc, 1, "Company A");
  assert.equal(updated.roles[2].company, "Company A");
  assert.equal(updated.roles[3].title, "Tools programmer");
  assert.equal(doc.roles.length, 5);
  const legacy = resumeSchema.parse({
    ...doc,
    roles: [{ ...roles[0], team: "Team A" }],
  });
  assert.equal("team" in legacy.roles[0], false);
});
test("PDF round trips retain companies, empty companies, role dates and bullets in both page layouts", async () => {
  const withEmpty = [
    ...roles,
    { company: "Company C", title: "", dates: "", bullets: [] },
  ];
  for (const pageCount of [1, 2] as const) {
    const bytes = await buildResumePDF({
      ...blankResume(),
      name: "Test Applicant",
      roles: withEmpty,
      pageCount,
    });
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const text = (await parser.getText({ pageJoiner: "" })).text;
      assert.doesNotMatch(text, /Company:|Team:/);
      const imported = parseResume((await taggedResumeText(bytes)) ?? text);
      assert.equal(imported.roles.length, withEmpty.length);
      for (let i = 0; i < roles.length; i++) {
        assert.equal(imported.roles[i].company, roles[i].company);
        assert.equal(imported.roles[i].title, roles[i].title);
        assert.deepEqual(imported.roles[i].bullets, roles[i].bullets);
        assert.ok(imported.roles[i].dates.includes("2020"));
      }
      assert.deepEqual(imported.roles.at(-1), withEmpty.at(-1));
    } finally {
      await parser.destroy();
    }
  }
});
test("team headings, including French ones from older exports, are ignored on import", () => {
  const doc = parseResume(
    "Test Applicant\nExpérience\nEntreprise: Company A\nÉquipe: Team A\nWeb developer\n• Built websites.\nTeam: Team B\nTools programmer\n• Built tools.",
  );
  assert.deepEqual(
    doc.roles.map((r) => [r.company, r.title]),
    [
      ["Company A", "Web developer"],
      ["Company A", "Tools programmer"],
    ],
  );
  assert.ok(!JSON.stringify(doc).includes("Team"));
});
test("PDF import preserves multiple undated roles in the same company", async () => {
  const undated = roles.slice(0, 3).map((r) => ({ ...r, dates: "" }));
  const bytes = await buildResumePDF({
    ...blankResume(),
    name: "Test Applicant",
    roles: undated,
  });
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const text = (await parser.getText()).text;
    const imported = parseResume((await taggedResumeText(bytes)) ?? text);
    assert.deepEqual(
      imported.roles.map((r) => r.title),
      undated.map((r) => r.title),
    );
  } finally {
    await parser.destroy();
  }
});
