import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/match/route";
import { blankResume } from "../lib/initial";
import {
  createMatchDebug,
  cleanDiagnostic,
  classifyCLIError,
} from "../lib/match-debug";
const connection = {
  method: "apiKey" as const,
  provider: "openai" as const,
  model: "test-model",
  key: "sk-private-test-key",
};
const doc = {
  ...blankResume(),
  name: "Private Applicant",
  contact: "private@example.com",
  summary: "Private resume text",
};
const job = {
  id: "job",
  templateId: "base",
  source: "",
  title: "Private Job",
  company: "Private Employer",
  location: "",
  rawDescription: "Private posting text",
  keywords: [{ term: "Python", category: "Tools" as const, required: true }],
};
const request = (accept?: string) =>
  new Request("http://localhost:3000/api/match", {
    method: "POST",
    headers: {
      ...(accept ? { accept } : {}),
      "x-match-request-id": "12345678-1234-1234-1234-123456789abc",
    },
    body: JSON.stringify({ connection, doc, job }),
  });
test("debug reports include only safe metadata and diagnostics, never credentials or resume text", () => {
  const report = createMatchDebug(connection, job, doc);
  report.events.push(
    cleanDiagnostic({
      source: "server",
      stage: "provider_rejected",
      elapsedMs: 1,
      details: {
        status: 400,
        providerErrorCode: "unsupported_parameter",
        apiKey: connection.key,
        resume: doc.summary,
        message: doc.contact,
      },
    }),
  );
  const json = JSON.stringify(report);
  for (const secret of [
    connection.key,
    doc.name,
    doc.contact,
    doc.summary,
    job.title,
    job.company,
    job.rawDescription,
  ])
    assert.ok(!json.includes(secret));
  assert.ok(json.includes("unsupported_parameter"));
  assert.equal(
    cleanDiagnostic({
      source: "server",
      stage: doc.name,
      elapsedMs: 0,
      code: connection.key,
    }).stage,
    "unknown_stage",
  );
  assert.equal(
    classifyCLIError("Error: --json-schema is not a valid JSON Schema"),
    "CLI_SCHEMA_REJECTED",
  );
  assert.equal(classifyCLIError("Usage limit reached"), "PROVIDER_LIMIT");
});
test("provider HTTP failures expose status and safe provider codes with a correlated request ID", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            type: "invalid_request_error",
            code: "unsupported_parameter",
            message: `Private failure ${connection.key} ${doc.summary}`,
          },
        },
        { status: 400 },
      );
    const response = await POST(request());
    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.debug.requestId, "12345678-1234-1234-1234-123456789abc");
    assert.ok(
      data.debug.events.some(
        (e: {
          stage: string;
          details?: { status: number; providerErrorCode: string };
        }) =>
          e.stage === "provider_rejected" &&
          e.details?.status === 400 &&
          e.details.providerErrorCode === "unsupported_parameter",
      ),
    );
    assert.ok(!JSON.stringify(data.debug).includes(connection.key));
    assert.ok(!JSON.stringify(data.debug).includes(doc.summary));
  } finally {
    globalThis.fetch = previous;
  }
});
test("streamed diagnostics show the exact evidence validation failure while redacting AI output", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pct: 60,
                summary: "Private AI output",
                items: [
                  {
                    keywordIndex: 0,
                    matched: true,
                    kind: "technology",
                    evidenceIds: ["Private invalid source"],
                    reason: doc.summary,
                  },
                ],
              }),
            },
          },
        ],
      });
    const response = await POST(request("application/x-ndjson"));
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (e) =>
          e.type === "diagnostic" &&
          e.entry.code === "INVALID_SOURCE_REFERENCE",
      ),
    );
    assert.ok(
      events.some(
        (e) => e.type === "diagnostic" && e.entry.stage === "repair_assessment",
      ),
    );
    assert.equal(events.at(-1).type, "error");
    const diagnostics = JSON.stringify(
      events.filter((e) => e.type === "diagnostic"),
    );
    for (const secret of [
      connection.key,
      doc.summary,
      "Private AI output",
      "Private invalid source",
    ])
      assert.ok(!diagnostics.includes(secret));
  } finally {
    globalThis.fetch = previous;
  }
});
