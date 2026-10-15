import test from "node:test";
import assert from "node:assert/strict";
import {
  initialWorkspace,
  blankResume,
  migrateWorkspace,
} from "../lib/initial";
import {
  fullText,
  documentId,
  updateDocument,
  jobDocument,
  hasRoleContent,
  isBlankRole,
  pruneBlankRoles,
  removeExperienceRole,
  type Job,
  type Workspace,
} from "../lib/model";
import { extractKeywords, parseResume } from "../lib/parsing";
import { fetchPublicPage } from "../lib/server";
function fixtureWorkspace(): Workspace {
  const doc = {
    ...blankResume(),
    name: "Test Applicant",
    summary: "Roadmapping, research and A/B testing.",
    skills: "React",
    roles: [
      {
        title: "Engineer",
        company: "Test Employer",
        dates: "2020 – Present",
        bullets: ["Built applications."],
      },
    ],
  };
  return {
    templates: [
      {
        id: "base",
        name: "My resume",
        sourceFile: "resume.docx",
        source: "Uploaded file",
        docId: "t:base",
      },
    ],
    docs: { "t:base": doc },
    jobs: [
      {
        id: "job1",
        title: "Engineer",
        company: "Employer",
        location: "Remote",
        source: "Pasted description",
        rawDescription: "Required SQL and React skills.",
        keywords: [
          { term: "SQL", category: "Tools", required: true },
          { term: "React", category: "Tools", required: true },
        ],
        templateId: "base",
      },
      {
        id: "job2",
        title: "Engineer",
        company: "Another Employer",
        location: "Remote",
        source: "Pasted description",
        rawDescription: "Build React applications.",
        keywords: [{ term: "React", category: "Tools", required: true }],
        templateId: "base",
      },
    ],
    notes: [],
    selectedJobId: "job1",
    viewTemplateId: null,
  };
}
test("new workspaces and blank resumes contain no seeded content", () => {
  assert.deepEqual(initialWorkspace(), {
    templates: [],
    docs: {},
    jobs: [],
    notes: [],
    references: [],
    selectedJobId: null,
    viewTemplateId: null,
  });
  assert.ok(
    Object.values(blankResume()).every((value) =>
      typeof value === "string"
        ? value === ""
        : Array.isArray(value) && value.length === 0,
    ),
  );
});
test("migration removes old demo records but retains user records", () => {
  const w = fixtureWorkspace();
  w.templates.push({
    id: "demo",
    name: "Demo",
    sourceFile: "demo.docx",
    source: "Example resume",
    docId: "t:demo",
  });
  w.docs["t:demo"] = blankResume();
  w.docs["j:demo"] = blankResume();
  w.jobs.push({
    ...w.jobs[0],
    id: "demo",
    templateId: "demo",
    tailoredDocId: "j:demo",
    rawDescription: "Example job from the design handoff.",
  });
  w.notes = [
    { id: "n0", text: "Old demo note", createdAt: new Date(0).toISOString() },
    {
      id: "user-note",
      text: "My own experience",
      createdAt: new Date().toISOString(),
    },
  ];
  w.selectedJobId = "demo";
  const migrated = migrateWorkspace(w);
  assert.equal(migrated.templates.length, 1);
  assert.equal(migrated.jobs.length, 2);
  assert.deepEqual(Object.keys(migrated.docs), ["t:base"]);
  assert.equal(migrated.notes.length, 1);
  assert.equal(migrated.notes[0].id, "user-note");
  assert.equal(migrated.selectedJobId, "job1");
  assert.deepEqual(migrateWorkspace(migrated), migrated);
});
test("migration retains real jobs awaiting their first real resume", () => {
  const w = fixtureWorkspace();
  w.templates[0].source = "Example resume";
  w.jobs[0].tailoredDocId = "j:job1";
  w.docs["j:job1"] = blankResume();
  const migrated = migrateWorkspace(w);
  assert.equal(migrated.templates.length, 0);
  assert.equal(migrated.jobs.length, 2);
  assert.equal(migrated.jobs[0].templateId, "");
  assert.equal(migrated.jobs[0].tailoredDocId, undefined);
  assert.deepEqual(migrated.docs, {});
});
test("direct edits affect the template while job actions fork an isolated document", () => {
  const w = fixtureWorkspace();
  assert.equal(documentId(w), "t:base");
  const edited = updateDocument(w, (d) => ({ ...d, name: "Template edit" }));
  assert.equal(jobDocument(edited, edited.jobs[1])?.name, "Template edit");
  const fork = updateDocument(
    w,
    (d) => ({ ...d, skills: d.skills + ", SQL" }),
    true,
  );
  assert.equal(documentId(fork), "j:job1");
  assert.ok(fork.docs["j:job1"].skills.includes("SQL"));
  assert.equal(fork.docs["t:base"].skills, w.docs["t:base"].skills);
  const second = updateDocument(
    fork,
    (d) => ({ ...d, name: "Only this job" }),
    true,
  );
  assert.equal(second.docs["j:job1"].name, "Only this job");
  assert.equal(second.docs["t:base"].name, "Test Applicant");
});
test("template context never forks when applying notes", () => {
  const w = { ...fixtureWorkspace(), viewTemplateId: "base" };
  const changed = updateDocument(w, (d) => ({ ...d, name: "New name" }), true);
  assert.equal(changed.docs["t:base"].name, "New name");
  assert.equal(changed.jobs.filter((j) => j.tailoredDocId).length, 0);
});
test("parser preserves real text and extracts known sections", () => {
  const d = parseResume(
    "Jane Smith\nSoftware Engineer\njane@example.com\nSummary\nI build useful software.\nExperience\nEngineer at Acme\n• Shipped a React app.\nSkills\nReact, SQL\nEducation\nBSc Computer Science",
  );
  assert.equal(d.name, "Jane Smith");
  assert.equal(d.contact, "jane@example.com");
  assert.equal(d.summary, "I build useful software.");
  assert.ok(d.roles[0].bullets.includes("Shipped a React app."));
  assert.ok(d.skills.includes("SQL"));
  assert.throws(() => parseResume("   "));
});
test("job keywords distinguish requirements from preferences", () => {
  const keywords = extractKeywords(
    "Required: experience with SQL and React. Preferred: Figma.",
  );
  assert.equal(keywords.find((k) => k.term === "SQL")?.required, true);
  assert.equal(keywords.find((k) => k.term === "Figma")?.required, false);
});
test("job fetch refuses local addresses and credentials", async () => {
  await assert.rejects(fetchPublicPage("https://127.0.0.1/jobs"));
  await assert.rejects(fetchPublicPage("http://example.com/jobs"));
  await assert.rejects(
    fetchPublicPage("https://user:password@example.com/jobs"),
  );
});

test("resume parser separates dated role headers and joins wrapped PDF bullets", () => {
  const doc = parseResume(
    "Alex Morgan\nProduct Manager\nSummary\nA product manager.\nExperience\nSenior Product Manager · Brightline Software    2021 – Present\n• Own the billing roadmap\nfor thousands of customers.\nProduct Manager · Harbor Analytics    2018 – 2021\n• Shipped dashboards.\nSkills\nSQL, Roadmap\nEducation\nB.S. Economics · University of Michigan · 2012 – 2016",
  );
  assert.equal(doc.roles.length, 2);
  assert.equal(doc.roles[0].company, "Brightline Software");
  assert.equal(doc.roles[0].dates, "2021 – Present");
  assert.equal(
    doc.roles[0].bullets[0],
    "Own the billing roadmap for thousands of customers.",
  );
  assert.equal(doc.roles[1].company, "Harbor Analytics");
  assert.equal(doc.edu[0].school, "University of Michigan");
});

test("deleting a template keeps linked jobs, tailored documents, and notes", async () => {
  const { deleteTemplate } = await import("../lib/model");
  const w = updateDocument(
    fixtureWorkspace(),
    (d) => ({ ...d, skills: "React, SQL" }),
    true,
  );
  w.notes.push({
    id: "note",
    text: "Keep this note",
    createdAt: new Date().toISOString(),
  });
  const result = deleteTemplate(w, "base");
  assert.equal(result.templates.length, 0);
  assert.equal(result.docs["t:base"], undefined);
  assert.equal(result.jobs.length, 2);
  assert.ok(result.jobs.every((j) => j.templateId === ""));
  assert.equal(jobDocument(result, result.jobs[0]).skills, "React, SQL");
  assert.equal(result.notes.length, 1);
  const restored = migrateWorkspace(result);
  assert.equal(restored.jobs[0].tailoredDocId, result.jobs[0].tailoredDocId);
  assert.equal(jobDocument(restored, restored.jobs[0]).skills, "React, SQL");
});

test("deleting a template can reassign linked jobs without overwriting their tailoring", async () => {
  const { deleteTemplate } = await import("../lib/model");
  const w = fixtureWorkspace();
  w.templates.push({
    id: "other",
    name: "Other",
    sourceFile: "other.docx",
    source: "Uploaded file",
    docId: "t:other",
  });
  w.docs["t:other"] = { ...blankResume(), name: "Other Applicant" };
  w.viewTemplateId = "base";
  const result = deleteTemplate(w, "base", "other");
  assert.ok(result.jobs.every((j) => j.templateId === "other"));
  assert.equal(documentId(result), "t:other");
  assert.equal(jobDocument(result, result.jobs[0]).name, "Other Applicant");
  assert.throws(() => deleteTemplate(w, "base", "missing"));
});

test("resume import keeps additional sections and recognizes French headings", () => {
  const doc = parseResume(
    "Alex Dupont\nDéveloppeur\nalex@example.com\nProfil professionnel\nConçoit des applications.\nExpérience professionnelle\nEngineer at Optical Labs\n• Built simulation tools.\nCompétences techniques\nPython, Lumerical\nFormation\nBSc\nProjets\nCreated Waveguide Explorer.\nLangues\nFrançais et anglais\nCertifications\nCloud architecture certificate",
  );
  assert.ok(doc.roles[0].bullets.includes("Built simulation tools."));
  assert.equal(doc.skills, "Python, Lumerical");
  assert.equal(doc.extraSections?.length, 3);
  assert.equal(doc.extraSections?.[0].text, "Created Waveguide Explorer.");
  assert.equal(doc.extraSections?.[1].text, "Français et anglais");
  assert.ok(fullText(doc).includes("Cloud architecture certificate"));
});

test("company text on a date line is not discarded while detecting a role", () => {
  const doc = parseResume(
    "Alex\nEngineer\nExperience\nSoftware Engineer\nReal Employer · 2020 – Present\n• Shipped tools.",
  );
  assert.equal(doc.roles[0].company, "Real Employer");
  assert.equal(doc.roles[0].dates, "2020 – Present");
});
test("blank experience roles are pruned without losing companies that have no roles", () => {
  const w = fixtureWorkspace();
  const doc = w.docs["t:base"];
  const engineer = doc.roles[0];
  const blank = { ...engineer, title: "", dates: "", bullets: [" "] };
  const newCompany = { ...blank, company: "New Co" };
  doc.roles = [blank, engineer, blank, newCompany, newCompany];
  assert.ok(isBlankRole(doc.roles, 0));
  assert.ok(!isBlankRole([{ ...blank, dates: "2024" }, engineer], 0));
  // The only entry naming a company keeps it as a company without roles.
  assert.ok(!isBlankRole([engineer, newCompany], 1));
  assert.ok(!hasRoleContent(newCompany));
  assert.deepEqual(
    migrateWorkspace(w).docs["t:base"].roles.map((r) => r.company + r.title),
    ["Test EmployerEngineer", "New Co"],
  );
  const kept = pruneBlankRoles(doc, 2);
  assert.deepEqual(kept.doc.roles, [engineer, blank, newCompany]);
  assert.equal(kept.index, 1);
  assert.deepEqual(removeExperienceRole(doc, 1).roles[1], blank);
  const clean = { ...doc, roles: [engineer] };
  assert.equal(pruneBlankRoles(clean).doc, clean);
});
