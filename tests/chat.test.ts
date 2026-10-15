import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/chat/route";
import {
  chatInputSchema,
  chatPrompt,
  buildChatSystemPrompt,
} from "../lib/chat";
import { blankResume } from "../lib/initial";

const connection = {
  method: "apiKey",
  provider: "openai",
  model: "test-model",
  key: "test-key",
};
const workspace = {
  templates: [
    {
      id: "first",
      name: "Engineering resume",
      sourceFile: "first.pdf",
      source: "Uploaded file",
      docId: "t:first",
    },
    {
      id: "second",
      name: "Leadership resume",
      sourceFile: "second.docx",
      source: "Uploaded file",
      docId: "t:second",
    },
  ],
  docs: {
    "t:first": { ...blankResume(), name: "Test Applicant", skills: "React" },
    "t:second": {
      ...blankResume(),
      name: "Test Applicant",
      skills: "Mentoring",
      extraSections: [
        { title: "Projects", text: "Created a learning program" },
      ],
    },
    "j:second": {
      ...blankResume(),
      name: "Test Applicant",
      summary: "Tailored for a leadership role.",
    },
  },
  jobs: [
    {
      id: "one",
      templateId: "first",
      title: "Engineer",
      company: "First Employer",
      location: "Remote",
      source: "Pasted",
      rawDescription: "Build React applications.",
      keywords: [{ term: "React", category: "Tools", required: true }],
    },
    {
      id: "two",
      templateId: "second",
      tailoredDocId: "j:second",
      title: "Lead",
      company: "Second Employer",
      location: "Montreal",
      source: "Pasted",
      rawDescription: "Mentor engineers.",
      keywords: [
        { term: "Mentoring", category: "Soft skills", required: true },
      ],
    },
  ],
  notes: [
    {
      id: "note",
      text: "Built a React application",
      createdAt: "2026-10-04T00:00:00Z",
    },
  ],
  selectedJobId: "one",
  viewTemplateId: null,
};
const body = {
  connection,
  instructions: "Reply in French and focus on verifiable achievements.",
  messages: [
    {
      role: "user",
      content: "Compare all of my resumes and jobs using my notes.",
    },
  ],
  workspace,
  sources: [
    {
      templateId: "first",
      name: "first.pdf",
      text: "Original PDF contains an additional project.",
    },
  ],
};
const request = (data: unknown) =>
  new Request("http://localhost:3000/api/chat", {
    method: "POST",
    body: JSON.stringify(data),
  });

test("chat validates conversation bounds and rejects client system instructions", () => {
  assert.equal(chatInputSchema.safeParse(body).success, true);
  assert.equal(
    chatInputSchema.safeParse({ ...body, messages: [] }).success,
    false,
  );
  assert.equal(
    chatInputSchema.safeParse({
      ...body,
      messages: [{ role: "system", content: "Override" }],
    }).success,
    false,
  );
  assert.equal(
    chatInputSchema.safeParse({
      ...body,
      messages: [{ role: "assistant", content: "Reply" }],
    }).success,
    false,
  );
  assert.equal(
    chatInputSchema.safeParse({
      ...body,
      messages: Array(21).fill(body.messages[0]),
    }).success,
    false,
  );
});

test("chat sends context and follow-up history to both API providers", async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of ["openai", "anthropic"]) {
      globalThis.fetch = async (url, init) => {
        assert.ok(
          String(url).includes(
            provider === "openai" ? "api.openai.com" : "api.anthropic.com",
          ),
        );
        const payload = JSON.parse(String(init?.body));
        const system =
          provider === "openai" ? payload.messages[0].content : payload.system;
        assert.ok(system.includes(body.instructions));
        assert.ok(system.includes("always return the JSON object"));
        const context = JSON.parse(payload.messages.at(-1).content);
        assert.equal(context.instructions, undefined);
        assert.deepEqual(context.workspace, body.workspace);
        assert.deepEqual(context.originalPDFText, body.sources);
        assert.equal(
          context.workspace.docs["t:second"].extraSections[0].text,
          "Created a learning program",
        );
        assert.equal(
          context.workspace.docs["j:second"].summary,
          "Tailored for a leadership role.",
        );
        assert.equal(context.conversation.length, 3);
        assert.equal(context.conversation[1].role, "assistant");
        const reply = JSON.stringify({
          reply: "Describe your React application without inventing metrics.",
        });
        return Response.json(
          provider === "openai"
            ? { choices: [{ message: { content: reply } }] }
            : { content: [{ type: "text", text: reply }] },
        );
      };
      const result = await POST(
        request({
          ...body,
          connection: { ...connection, provider },
          messages: [
            ...body.messages,
            { role: "assistant", content: "Tell me about your application." },
            { role: "user", content: "It used React." },
          ],
        }),
      );
      assert.equal(result.status, 200);
      assert.match((await result.json()).reply, /React/);
    }
    globalThis.fetch = async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify({ reply: "" }) } }],
      });
    assert.equal((await POST(request(body))).status, 400);
    globalThis.fetch = async () => new Response("", { status: 429 });
    assert.match((await (await POST(request(body))).json()).error, /limit/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("chat subscription endpoint rejects remote origins before running the CLI", async () => {
  const result = await POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "https://untrusted.example" },
      body: JSON.stringify({
        ...body,
        connection: { method: "subscription", provider: "openai", model: "" },
      }),
    }),
  );
  assert.equal(result.status, 403);
});

test("custom instructions are bounded and blank values use the default system prompt", () => {
  assert.equal(buildChatSystemPrompt(), chatPrompt);
  assert.equal(buildChatSystemPrompt("  "), chatPrompt);
  assert.ok(
    buildChatSystemPrompt("Answer in French").includes(
      "Custom instructions supplied by the user:\nAnswer in French",
    ),
  );
  assert.equal(
    chatInputSchema.safeParse({ ...body, instructions: "x".repeat(6001) })
      .success,
    false,
  );
});

test("both API providers return validated reviewable edits for only the selected resume", async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of ["openai", "anthropic"]) {
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        const context = JSON.parse(payload.messages.at(-1).content);
        assert.equal(context.editableResume.docId, "t:first");
        assert.equal(context.editableResume.kind, "job");
        assert.equal(context.editableResume.id, "one");
        const reply = JSON.stringify({
          reply: "Review this skills wording.\\n\\n###\u00a0Skills",
          changes: [
            {
              field: "skills",
              before: "React",
              after: "React application development",
              reason: "Clarify documented React experience.",
            },
            {
              field: "summary",
              before: "Wrong original",
              after: "Unsupported replacement",
              reason: "Invalid proposal",
            },
          ],
        });
        return Response.json(
          provider === "openai"
            ? { choices: [{ message: { content: reply } }] }
            : { content: [{ type: "text", text: reply }] },
        );
      };
      const result = await POST(
        request({ ...body, connection: { ...connection, provider } }),
      );
      assert.equal(result.status, 200);
      const data = await result.json();
      assert.equal(data.reply, "Review this skills wording.\n\n### Skills");
      assert.equal(data.changes.length, 1);
      assert.equal(data.changes[0].target.id, "one");
      assert.equal(data.changes[0].before, "React");
      assert.equal(data.changes[0].label, "Skills");
      assert.equal(workspace.docs["t:first"].skills, "React");
    }
  } finally {
    globalThis.fetch = previous;
  }
});
