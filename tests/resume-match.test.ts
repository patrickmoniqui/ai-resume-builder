import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/match/route";
import {
  parseResumeMatch,
  resumeEvidenceSources,
  assessResumeMatch,
  matchPrompt,
  matchJSONSchema,
} from "../lib/resume-match";
import { blankResume } from "../lib/initial";
const doc = {
  ...blankResume(),
  summary: "Built browser interfaces using component-based architecture.",
};
const job = {
  title: "Frontend Engineer",
  company: "Employer",
  location: "",
  rawDescription: "Build React interfaces and deploy services with AWS.",
  keywords: [
    { term: "React", category: "Tools" as const, required: true },
    { term: "AWS", category: "Tools" as const, required: true },
  ],
};
const output = {
  pct: 73,
  summary: "Transferable frontend experience; no cloud evidence.",
  items: [
    {
      keywordIndex: 0,
      matched: true,
      evidence: doc.summary,
      reason:
        "Relevant component-based frontend work, although React itself is not named.",
    },
    {
      keywordIndex: 1,
      matched: false,
      evidence: "",
      reason: "No cloud deployment evidence.",
    },
  ],
};
const request = (connection: unknown) =>
  new Request("http://localhost:3000/api/match", {
    method: "POST",
    body: JSON.stringify({ connection, doc, job }),
  });
test("AI score and semantic matches are preserved independently of word counts", () => {
  assert.ok(!doc.summary.includes("React"));
  const result = parseResumeMatch(output, job, doc);
  assert.equal(result.pct, 73);
  assert.equal(result.matched, 1);
  assert.equal(result.items[0].term, "React");
  assert.equal(result.items[0].evidence, doc.summary);
});
test("AI assessments reject missing, duplicated, invalid requirements and invented evidence", () => {
  for (const items of [
    output.items.slice(0, 1),
    [output.items[0], output.items[0]],
    [output.items[0], { ...output.items[1], keywordIndex: 2 }],
    [{ ...output.items[0], evidence: "Invented work." }, output.items[1]],
  ])
    assert.throws(() => parseResumeMatch({ ...output, items }, job, doc));
  assert.throws(() => parseResumeMatch({ ...output, pct: 101 }, job, doc));
});
test("matching calls both API providers with full resume and job context", async () => {
  const previous = globalThis.fetch;
  try {
    for (const provider of ["openai", "anthropic"]) {
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.equal(
          provider === "openai" ? payload.messages[0].content : payload.system,
          matchPrompt,
        );
        const context = JSON.parse(payload.messages.at(-1).content);
        assert.deepEqual(context.resume, doc);
        assert.deepEqual(context.job, job);
        assert.deepEqual(context.evidenceSources, resumeEvidenceSources(doc));
        assert.deepEqual(
          context.requirementsToAssess.map(
            (k: { keywordIndex: number }) => k.keywordIndex,
          ),
          [0, 1],
        );
        return Response.json(
          provider === "openai"
            ? {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        ...output,
                        items: output.items.map(({ evidence, ...item }) => ({
                          ...item,
                          kind: "technology",
                          evidenceIds: item.matched ? ["summary"] : [],
                        })),
                      }),
                    },
                  },
                ],
              }
            : {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      ...output,
                      items: output.items.map(({ evidence, ...item }) => ({
                        ...item,
                        kind: "technology",
                        evidenceIds: item.matched ? ["summary"] : [],
                      })),
                    }),
                  },
                ],
              },
        );
      };
      const response = await POST(
        request({
          method: "apiKey",
          provider,
          model: "test-model",
          key: "test-key",
        }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).pct, 73);
    }
    globalThis.fetch = async () =>
      Response.json({ error: { message: "Limit reached" } }, { status: 429 });
    const failed = await POST(
      request({
        method: "apiKey",
        provider: "openai",
        model: "test-model",
        key: "test-key",
      }),
    );
    assert.equal(failed.status, 400);
    assert.equal((await failed.json()).pct, undefined);
  } finally {
    globalThis.fetch = previous;
  }
});
test("matching requires AI and protects local subscription execution", async () => {
  assert.equal((await POST(request(undefined))).status, 400);
  const response = await POST(
    new Request("https://remote.example/api/match", {
      method: "POST",
      headers: { origin: "https://remote.example" },
      body: JSON.stringify({
        connection: { method: "subscription", provider: "openai", model: "" },
        doc,
        job,
      }),
    }),
  );
  assert.equal(response.status, 403);
});

test("matching emits a Claude-compatible Draft 7 schema with all evidence checks intact", () => {
  assert.equal(
    matchJSONSchema.$schema,
    "http://json-schema.org/draft-07/schema#",
  );
  assert.deepEqual(matchJSONSchema.required, ["pct", "summary", "items"]);
  const scoreSchema = matchJSONSchema.properties?.pct;
  assert.ok(scoreSchema && typeof scoreSchema === "object");
  assert.equal(scoreSchema.type, "integer");
  assert.equal(scoreSchema.maximum, 100);
  assert.equal(matchJSONSchema.additionalProperties, false);
});

test("large job assessments cover every requirement in bounded batches with AI-provided final scores", async () => {
  const large = {
    ...job,
    keywords: Array.from({ length: 45 }, (_, i) => ({
      ...job.keywords[0],
      term: `Requirement ${i}`,
    })),
  };
  const progress: number[] = [];
  let calls = 0;
  const result = await assessResumeMatch(
    doc,
    large,
    async (_system, context, outputSchema) => {
      const data = JSON.parse(context);
      calls++;
      assert.ok(data.requirementsToAssess.length <= 20);
      assert.equal(
        (outputSchema as typeof matchJSONSchema).properties?.items &&
          typeof (outputSchema as typeof matchJSONSchema).properties?.items,
        "object",
      );
      return {
        pct: 60 + calls,
        summary: "AI overall assessment",
        items: data.requirementsToAssess.map((k: { keywordIndex: number }) => ({
          keywordIndex: k.keywordIndex,
          matched: true,
          kind: "technology",
          evidenceIds: ["summary"],
          reason: "Relevant experience.",
        })),
      };
    },
    (value) => progress.push(value.completed),
  );
  assert.equal(calls, 3);
  assert.equal(result.pct, 63);
  assert.equal(result.items.length, 45);
  assert.equal(new Set(result.items.map((i) => i.keywordIndex)).size, 45);
  assert.ok(result.items.every((i) => i.evidence === doc.summary));
  assert.equal(progress.at(-1), 45);
});
test("invalid AI source references get one repair attempt and cannot introduce invented resume evidence", async () => {
  let calls = 0;
  const result = await assessResumeMatch(doc, job, async () => {
    calls++;
    return {
      ...output,
      items: output.items.map((i) => ({
        keywordIndex: i.keywordIndex,
        matched: i.matched,
        kind: "technology",
        evidenceIds: i.matched
          ? [calls === 1 ? "invented-source" : "summary"]
          : [],
        reason: i.reason,
      })),
    };
  });
  assert.equal(calls, 2);
  assert.equal(result.items[0].evidence, doc.summary);
  await assert.rejects(
    assessResumeMatch(doc, job, async () => ({
      ...output,
      items: output.items.map((i) => ({
        keywordIndex: i.keywordIndex,
        matched: true,
        kind: "technology",
        evidenceIds: ["invented-source"],
        reason: i.reason,
      })),
    })),
    /invalid resume source/,
  );
});
test("evidence IDs preserve long text and company/role context without requiring AI to reproduce quotes", () => {
  const resume = {
    ...doc,
    summary: "Développé des outils fiables. ".repeat(80),
    roles: [
      {
        company: "Employer",
        title: "Engineer",
        dates: "2020 – Present",
        bullets: ["Delivered reliable software."],
      },
    ],
  };
  const sources = resumeEvidenceSources(resume);
  assert.ok(sources.every((s) => s.text.length <= 800));
  assert.equal(
    sources
      .filter((s) => s.id.startsWith("summary.part"))
      .map((s) => s.text)
      .join(""),
    resume.summary,
  );
  assert.equal(
    sources.find((s) => s.id === "roles.0.company")?.text,
    "Employer",
  );
});

test("truncated AI JSON is repaired once, while provider limits are surfaced without another request", async () => {
  let calls = 0;
  const valid = {
    ...output,
    items: output.items.map((i) => ({
      keywordIndex: i.keywordIndex,
      matched: i.matched,
      kind: "technology",
      evidenceIds: i.matched ? ["summary"] : [],
      reason: i.reason,
    })),
  };
  const result = await assessResumeMatch(doc, job, async () => {
    calls++;
    if (calls === 1)
      throw new Error("The AI response was not valid JSON. Try again.");
    return valid;
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 2);
  calls = 0;
  await assert.rejects(
    assessResumeMatch(doc, job, async () => {
      calls++;
      throw new Error("Provider rate limit or credit limit reached.");
    }),
    /Provider rate limit/,
  );
  assert.equal(calls, 1);
});

test("AI-assigned language, technology and behavior groups are preserved alongside match status", async () => {
  const resume = {
    ...doc,
    summary: "Built Python services with Docker and led a development team.",
  };
  const skills = {
    ...job,
    keywords: [
      { term: "Python", category: "Hard skills" as const, required: true },
      { term: "Docker", category: "Tools" as const, required: true },
      { term: "Leadership", category: "Soft skills" as const, required: true },
    ],
  };
  const result = await assessResumeMatch(resume, skills, async () => ({
    pct: 85,
    summary: "Relevant documented skills",
    items: ["language", "technology", "behavior"].map((kind, keywordIndex) => ({
      keywordIndex,
      kind,
      matched: true,
      evidenceIds: ["summary"],
      reason: "Supported by the resume.",
    })),
  }));
  assert.deepEqual(
    result.items.map((i) => i.kind),
    ["language", "technology", "behavior"],
  );
  assert.ok(result.items.every((i) => i.matched));
});
