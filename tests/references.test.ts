import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { POST as importReference } from "../app/api/references/route";
import { POST as suggest } from "../app/api/ai/route";
import { POST as chat } from "../app/api/chat/route";
import {
  blankResume,
  initialWorkspace,
  migrateWorkspace,
} from "../lib/initial";
import { buildResumePDF } from "../lib/resume-pdf";
async function upload(file: File) {
  const body = new FormData();
  body.append("file", file);
  return importReference(
    new Request("http://localhost:3000/api/references", {
      method: "POST",
      body,
    }),
  );
}
test("reference import extracts PDF, DOCX and text without treating them as resumes", async () => {
  const pdf = await buildResumePDF({
    ...blankResume(),
    name: "Project reference",
    extraSections: [
      { title: "Projects", text: "The applicant built Project Beacon." },
    ],
  });
  const files = [
    new File([Buffer.from(pdf)], "project.pdf"),
    new File([await readFile("tests/fixtures/resume.docx")], "reference.docx"),
    new File(
      ["Reference context.\nUnusual section: retained."],
      "reference.txt",
    ),
  ];
  for (const file of files) {
    const response = await upload(file);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.text.length > 0);
    assert.equal(body.doc, undefined);
    assert.equal(body.name, file.name);
  }
  assert.equal((await upload(new File([""], "empty.txt"))).status, 400);
  assert.equal(
    (await upload(new File(["binary"], "unsupported.exe"))).status,
    400,
  );
});
const reference = {
  id: "reference",
  name: "project.txt",
  type: "txt" as const,
  size: 50,
  createdAt: "2026-10-05T00:00:00Z",
  text: "The applicant built Project Beacon.",
};
const connection = {
  method: "apiKey",
  provider: "openai",
  model: "test-model",
  key: "test-key",
};
test("chat and resume suggestions receive named references as untrusted source data", async () => {
  const previous = globalThis.fetch;
  try {
    const doc = {
      ...blankResume(),
      roles: [
        {
          company: "Employer",
          title: "Engineer",
          dates: "",
          bullets: ["Built tools."],
        },
      ],
    };
    let context: any;
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.match(payload.messages[0].content, /untrusted/);
      context = JSON.parse(payload.messages.at(-1).content);
      return Response.json({
        choices: [
          { message: { content: JSON.stringify({ suggestions: [] }) } },
        ],
      });
    };
    assert.equal(
      (
        await suggest(
          new Request("http://localhost:3000/api/ai", {
            method: "POST",
            body: JSON.stringify({
              connection,
              doc,
              notes: [],
              references: [reference],
              mode: "notes",
            }),
          }),
        )
      ).status,
      200,
    );
    assert.deepEqual(context.references, [reference]);
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.match(payload.messages[0].content, /reference filename/);
      context = JSON.parse(payload.messages.at(-1).content);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "The reference describes Project Beacon.",
              }),
            },
          },
        ],
      });
    };
    const workspace = { ...initialWorkspace(), references: [reference] };
    assert.equal(
      (
        await chat(
          new Request("http://localhost:3000/api/chat", {
            method: "POST",
            body: JSON.stringify({
              connection,
              workspace,
              references: [reference],
              messages: [{ role: "user", content: "Summarize my reference." }],
            }),
          }),
        )
      ).status,
      200,
    );
    assert.deepEqual(context.referenceDocuments, [reference]);
    assert.equal(
      migrateWorkspace(workspace).references?.[0].name,
      "project.txt",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
