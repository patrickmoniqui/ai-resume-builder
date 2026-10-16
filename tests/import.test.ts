import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/import/route";
import { buildResumePDF } from "../lib/resume-pdf";
import { blankResume } from "../lib/initial";
import { resumeSchema } from "../lib/model";
import { PDFDocument, StandardFonts } from "pdf-lib";

test("untagged PDF imports keep company-first roles, team suffixes, side projects and graduation years", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  const lines = [
    "Test Applicant",
    "Tools Programmer",
    "applicant@example.com",
    "SUMMARY",
    "Build editor tools.",
    "EXPERIENCE",
    "Example Studio",
    "Tools Programmer | Editor AI Team    Jan 2026–Present",
    "• Built an AI assistant for the editor.",
    "Tools Programmer | Editor Team    May 2024–Jan 2026",
    "• Shipped authoring tools.",
    "Full-Stack Developer | Pipeline Team    Nov 2021–May 2024",
    "• Built a developer portal with multiple services.",
    "SIDE PROJECT",
    "Connected Lighting    2023–Present",
    "• Built embedded firmware and a mobile app.",
    "SKILLS",
    "C#, C++, TypeScript",
    "EDUCATION",
    "B.Eng., Software Engineering | Example University, Montreal    2021",
  ];
  lines.forEach((line, index) =>
    page.drawText(line, { x: 40, y: 750 - index * 20, size: 10, font }),
  );

  const importPDF = async (bytes: Uint8Array) => {
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from(bytes)], "resume.pdf", { type: "application/pdf" }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/import", {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 200);
    return (await response.json()).doc;
  };
  const imported = await importPDF(await source.save());
  assert.deepEqual(imported.roles, [
    {
      company: "Example Studio",
      title: "Tools Programmer | Editor AI Team",
      dates: "Jan 2026–Present",
      bullets: ["Built an AI assistant for the editor."],
    },
    {
      company: "Example Studio",
      title: "Tools Programmer | Editor Team",
      dates: "May 2024–Jan 2026",
      bullets: ["Shipped authoring tools."],
    },
    {
      company: "Example Studio",
      title: "Full-Stack Developer | Pipeline Team",
      dates: "Nov 2021–May 2024",
      bullets: ["Built a developer portal with multiple services."],
    },
  ]);
  assert.deepEqual(imported.edu, [
    {
      degree: "B.Eng., Software Engineering",
      school: "Example University, Montreal",
      dates: "2021",
    },
  ]);
  assert.equal(imported.extraSections.length, 1);
  assert.equal(imported.extraSections[0].title, "SIDE PROJECT");
  assert.match(
    imported.extraSections[0].text,
    /Connected Lighting.*2023–Present/,
  );
  assert.match(
    imported.extraSections[0].text,
    /Built embedded firmware and a mobile app/,
  );
  assert.deepEqual(imported.sectionOrder, [
    "summary",
    "experience",
    "extra-0",
    "skills",
    "education",
  ]);

  const roundTrip = await importPDF(await buildResumePDF(imported));
  assert.deepEqual(roundTrip.roles, imported.roles);
  assert.deepEqual(roundTrip.edu, imported.edu);
  assert.deepEqual(roundTrip.extraSections, imported.extraSections);
});

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
