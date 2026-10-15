import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { buildResumePDF } from "../lib/resume-pdf";
import { blankResume } from "../lib/initial";
import { resumeSchema, type Resume } from "../lib/model";
import { parseResume } from "../lib/parsing";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { taggedResumeText } from "../lib/resume-pdf-text";
const doc: Resume = {
  ...blankResume(),
  name: "Test Applicant",
  summary: "Builds reliable software.",
  roles: [
    {
      title: "Engineer",
      company: "Test Company",
      dates: "2020 – Present",
      bullets: ["Implemented customer workflows."],
    },
  ],
  skills: "React, SQL",
  edu: [{ degree: "BSc", school: "Test University", dates: "2016 – 2020" }],
};
async function extracted(bytes: Uint8Array) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText({ pageJoiner: "" })).text;
  } finally {
    await parser.destroy();
  }
}
test("legacy resumes default to single page and invalid page counts are rejected", async () => {
  assert.equal(
    (await PDFDocument.load(await buildResumePDF(doc))).getPageCount(),
    1,
  );
  assert.equal(resumeSchema.safeParse({ ...doc, pageCount: 3 }).success, false);
});
test("both page layouts preserve resume sections and produce the requested count", async () => {
  for (const pageCount of [1, 2] as const) {
    const bytes = await buildResumePDF({ ...doc, pageCount });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), pageCount);
    const text = await extracted(bytes);
    for (const value of [
      "Test Applicant",
      "Builds reliable software.",
      "Implemented customer workflows.",
      "React, SQL",
      "Test University",
    ])
      assert.ok(text.includes(value));
    assert.equal(parseResume(text).edu.length, 1);
  }
});
test("content exceeding single page fits dual page without losing bullets", async () => {
  const long = {
    ...doc,
    roles: [
      {
        ...doc.roles[0],
        bullets: Array.from(
          { length: 90 },
          (_, i) =>
            `Completed project ${i} and delivered reliable customer workflows.`,
        ),
      },
    ],
  };
  await assert.rejects(
    buildResumePDF({ ...long, pageCount: 1 }),
    /Choose Dual page/,
  );
  const bytes = await buildResumePDF({ ...long, pageCount: 2 });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  const text = await extracted(bytes);
  for (let i = 0; i < 90; i++)
    assert.ok(text.includes(`Completed project ${i} and`));
});
test("oversized dual page content returns an error rather than truncating", async () => {
  await assert.rejects(
    buildResumePDF({
      ...doc,
      pageCount: 2,
      summary: "Substantial experience with customer workflows. ".repeat(1000),
    }),
    /Shorten the content/,
  );
});

test("role titles align with companies and dates align at the right margin in both layouts", async () => {
  for (const pageCount of [1, 2] as const) {
    const bytes = await buildResumePDF({
      ...doc,
      pageCount,
      roles: doc.roles,
      edu: [{ ...doc.edu[0], dates: "2021" }],
      extraSections: [
        {
          title: "Projects",
          text: "Project Beacon 2023 – Present\n• Built useful tools.",
        },
      ],
    });
    const text = await extracted(bytes);
    assert.doesNotMatch(text, /Company:|Team:/);
    assert.ok(text.includes("Test Company"));
    const task = getDocument({ data: new Uint8Array(bytes) });
    try {
      const pdf = await task.promise;
      let dateCount = 0;
      let alignedHeadings = 0;
      for (let number = 1; number <= pdf.numPages; number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        const items = content.items.filter((item) => "str" in item);
        const company = items.find((item) => item.str === "Test Company");
        const role = items.find((item) => item.str === "Engineer");
        if (company) {
          assert.ok(role);
          alignedHeadings++;
          assert.ok(Math.abs(company.transform[4] - role.transform[4]) < 0.1);
          const bullet = items.find((item) =>
            item.str.includes("Implemented customer workflows."),
          );
          assert.ok(bullet && bullet.transform[4] > company.transform[4]);
        }
        for (const dates of ["2020 – Present", "2021", "2023 – Present"]) {
          const date = items.find((item) => item.str === dates);
          if (!date) continue;
          dateCount++;
          assert.ok(Math.abs(date.transform[4] + date.width - 564) < 0.5);
          const left = items.filter(
            (item) =>
              item !== date &&
              item.str.trim() &&
              Math.abs(item.transform[5] - date.transform[5]) < 0.1,
          );
          assert.ok(left.length > 0);
          for (const item of left)
            assert.ok(item.transform[4] + item.width < date.transform[4] - 10);
        }
      }
      assert.equal(dateCount, 3);
      assert.equal(alignedHeadings, 1);
    } finally {
      await task.destroy();
    }
  }
});

test("long role headings wrap beside dates and reimport as one role", async () => {
  const title =
    "Senior Software Engineer for Platform Architecture, Developer Experience, Infrastructure Automation and Engineering Productivity";
  const bytes = await buildResumePDF({
    ...doc,
    roles: [{ ...doc.roles[0], title }],
  });
  const imported = parseResume((await taggedResumeText(bytes))!);
  assert.equal(imported.roles.length, 1);
  assert.equal(imported.roles[0].title, title);
  assert.equal(imported.roles[0].dates, doc.roles[0].dates);
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    const content = await (
      await (await task.promise).getPage(1)
    ).getTextContent();
    const items = content.items.filter((item) => "str" in item);
    const date = items.find((item) => item.str === doc.roles[0].dates)!;
    assert.ok(date);
    assert.ok(Math.abs(date.transform[4] + date.width - 564) < 0.5);
    const headingLines = items.filter((item) =>
      /Senior Software|Engineering Productivity/.test(item.str),
    );
    assert.ok(new Set(headingLines.map((item) => item.transform[5])).size > 1);
    const company = items.find((item) => item.str === doc.roles[0].company);
    assert.ok(company);
    for (const line of headingLines)
      assert.ok(Math.abs(line.transform[4] - company.transform[4]) < 0.1);
    for (const item of items.filter(
      (item) =>
        item !== date &&
        item.str.trim() &&
        Math.abs(item.transform[5] - date.transform[5]) < 0.1,
    ))
      assert.ok(item.transform[4] + item.width < date.transform[4] - 10);
  } finally {
    await task.destroy();
  }
});
