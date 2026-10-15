import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/import/route";
import { buildResumePDF } from "../lib/resume-pdf";
import { blankResume } from "../lib/initial";
import { resumeSchema } from "../lib/model";

test("PDF import retains projects, languages, and certificates in the editable version", async () => {
  const doc = {
    ...blankResume(),
    name: "Test Applicant",
    summary: "Software developer",
    skills: "React",
    extraSections: [
      { title: "Projects", text: "Built Project Beacon." },
      { title: "Languages", text: "French and English" },
      { title: "Certifications", text: "Cloud architecture certificate" },
    ],
  };
  const pdf = await buildResumePDF(doc);
  const form = new FormData();
  form.append(
    "file",
    new File([Buffer.from(pdf)], "with-sections.pdf", {
      type: "application/pdf",
    }),
  );
  const result = await POST(
    new Request("http://localhost:3000/api/import", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(result.status, 200);
  const imported = await result.json();
  resumeSchema.parse(imported.doc);
  assert.deepEqual(
    imported.doc.extraSections,
    doc.extraSections.map((s) => ({ ...s, title: s.title.toUpperCase() })),
  );
  assert.ok(imported.text.includes("Built Project Beacon."));
  assert.match(imported.notice, /Original PDF/);
});

test("PDF import retains unlabeled company headings and right-aligned role dates", async () => {
  const roles = [
    {
      company: "Employer",
      title: "Engineer",
      dates: "2020 – Present",
      bullets: ["Built reliable tools."],
    },
    {
      company: "Employer",
      title: "Analyst",
      dates: "",
      bullets: ["Reviewed findings."],
    },
    {
      company: "Another Employer",
      title: "Advisor",
      dates: "2018 – 2020",
      bullets: ["Guided projects."],
    },
  ];
  const pdf = await buildResumePDF({
    ...blankResume(),
    name: "Test Applicant",
    roles,
  });
  const form = new FormData();
  form.append(
    "file",
    new File([Buffer.from(pdf)], "resume.pdf", { type: "application/pdf" }),
  );
  const response = await POST(
    new Request("http://localhost:3000/api/import", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 200);
  const imported = await response.json();
  assert.deepEqual(imported.doc.roles, roles);
  assert.doesNotMatch(imported.text, /Company:|Team:/);
});
