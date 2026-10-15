import test from "node:test";
import assert from "node:assert/strict";
import { blankResume } from "../lib/initial";
import {
  findTermRange,
  locateMatchedSkill,
  resumeFields,
} from "../lib/resume-focus";
const doc = {
  ...blankResume(),
  skills: "React, PostgreSQL, C++",
  roles: [
    {
      company: "Employer",
      title: "Engineer",
      dates: "",
      bullets: [
        "Shipped a React application.",
        "Built PostgreSQL-backed services.",
      ],
    },
  ],
};
test("matched navigation prioritizes cited evidence and highlights an exact skill within it", () => {
  const target = locateMatchedSkill(doc, {
    term: "React",
    evidence: "Shipped a React application.",
  });
  assert.equal(target?.fieldId, "bullet-0-0");
  assert.equal(target?.value.slice(target.start, target.end), "React");
});
test("semantic matches focus their actual evidence even without a literal skill mention", () => {
  const target = locateMatchedSkill(doc, {
    term: "SQL",
    evidence: "PostgreSQL-backed services.",
  });
  assert.equal(target?.fieldId, "bullet-0-1");
  assert.equal(
    target?.value.slice(target.start, target.end),
    "PostgreSQL-backed services.",
  );
});
test("navigation supports aliases, punctuation, accents and real field IDs", () => {
  assert.equal(
    findTermRange("JavaScript, Java, C++17, Français", "Java")?.start,
    12,
  );
  assert.equal(findTermRange("C++17", "C++")?.end, 3);
  assert.equal(findTermRange("Français", "français")?.start, 0);
  const alias = locateMatchedSkill(doc, {
    term: "ReactJS",
    aliases: ["React"],
    evidence: "",
  });
  assert.ok(alias);
  const company = locateMatchedSkill(doc, {
    term: "Employer",
    evidence: "Employer",
  });
  assert.equal(company?.fieldId, "role-company-0");
  assert.ok(resumeFields(doc).some((f) => f.id === "role-company-0"));
});
test("missing cached evidence falls back to a current mention or returns no destination", () => {
  assert.equal(
    locateMatchedSkill(doc, {
      term: "React",
      evidence: "Old removed evidence.",
    })?.fieldId,
    "bullet-0-0",
  );
  assert.equal(
    locateMatchedSkill(doc, { term: "AWS", evidence: "Old removed evidence." }),
    undefined,
  );
});
