import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { POST } from "../app/api/jobs/route";
import {
  parseJobScan,
  jobScanOutputSchema,
  scanJobPosting,
} from "../lib/job-scan";
import { extractJobPosting } from "../lib/job-posting";
import {
  askSubscriptionAI,
  type ClaudeQuery,
  type CLIRunner,
} from "../lib/local-ai";

const posting =
  "Photonics Engineer at Optical Labs. Required: waveguide simulation using Lumerical. Preferred: Python. Location: Montreal.";
const scanned = {
  title: "Photonics Engineer",
  company: "Optical Labs",
  location: "Montreal",
  keywords: [
    { term: "Lumerical", category: "Tools", required: true, aliases: [] },
    { term: "Python", category: "Hard skills", required: false, aliases: [] },
  ],
};

test("a sparse scan of the Unity posting gets one full-source review", async () => {
  const html = await readFile(
    new URL("./fixtures/unity-workday.html", import.meta.url),
    "utf8",
  );
  const extracted = extractJobPosting(
    html,
    "https://unitytech.wd1.myworkdayjobs.com/Unity/job/example",
  );
  const sparse = {
    ...extracted,
    keywords: [
      {
        term: "Software development",
        category: "Hard skills",
        required: true,
        aliases: [],
      },
      { term: "Unity Editor", category: "Tools", required: true, aliases: [] },
    ],
  };
  const complete = {
    ...sparse,
    keywords: [
      ...sparse.keywords,
      { term: "C#", category: "Hard skills", required: true, aliases: [] },
      {
        term: "Automated testing",
        category: "Hard skills",
        required: true,
        aliases: [],
      },
      { term: "C++", category: "Hard skills", required: false, aliases: [] },
      { term: "Claude Code", category: "Tools", required: false, aliases: [] },
      { term: "Copilot", category: "Tools", required: false, aliases: [] },
    ],
  };
  let calls = 0;
  const result = await scanJobPosting(
    extracted.text,
    extracted,
    async (_system, input) => {
      const data = JSON.parse(input);
      assert.equal(data.posting, extracted.text);
      assert.equal(data.metadata.title, extracted.title);
      if (++calls === 1) return sparse;
      assert.equal(data.previousScan.keywords.length, 2);
      return complete;
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.rawDescription, extracted.text);
  assert.equal(
    result.keywords.find(({ term }) => term === "C#")?.required,
    true,
  );
  assert.equal(
    result.keywords.find(({ term }) => term === "C++")?.required,
    false,
  );
});

test("a review can confirm a short result without looping or adding invented terms", async () => {
  let calls = 0;
  const result = await scanJobPosting(posting.repeat(12), scanned, async () => {
    calls++;
    return scanned;
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.keywords, scanned.keywords);
});

test("short descriptions and scans with more than two distinct terms need no review", async () => {
  for (const [text, output] of [
    [posting, scanned],
    [
      posting.repeat(12),
      {
        ...scanned,
        keywords: [
          ...scanned.keywords,
          {
            term: "Waveguide simulation",
            category: "Hard skills",
            required: true,
            aliases: [],
          },
        ],
      },
    ],
  ] as const) {
    let calls = 0;
    await scanJobPosting(text, scanned, async () => {
      calls++;
      return output;
    });
    assert.equal(calls, 1);
  }
});

test("job scan retains source, specialized skills, and required/preferred distinctions", () => {
  const result = parseJobScan(
    {
      ...scanned,
      keywords: [
        ...scanned.keywords,
        { ...scanned.keywords[0], term: "LUMERICAL" },
      ],
    },
    posting,
  );
  assert.equal(result.rawDescription, posting);
  assert.equal(result.keywords.length, 2);
  assert.equal(result.keywords[0].required, true);
  assert.equal(result.keywords[1].required, false);
  assert.throws(() => parseJobScan({ ...scanned, keywords: [] }, posting));
  assert.throws(() =>
    parseJobScan(
      { ...scanned, keywords: [{ ...scanned.keywords[0], term: "   " }] },
      posting,
    ),
  );
  assert.throws(() =>
    parseJobScan(
      {
        ...scanned,
        keywords: [{ term: "x", category: "Unknown", required: true }],
      },
      posting,
    ),
  );
});

test("job endpoint requires a connection and calls the selected API provider", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const missing = await POST(
      new Request("http://localhost:3000/api/jobs", {
        method: "POST",
        body: JSON.stringify({ description: posting }),
      }),
    );
    assert.equal(missing.status, 400);
    for (const provider of ["openai", "anthropic"] as const) {
      globalThis.fetch = async (url, init) => {
        assert.ok(
          String(url).includes(
            provider === "openai" ? "api.openai.com" : "api.anthropic.com",
          ),
        );
        const payload = JSON.parse(String(init?.body));
        assert.ok(JSON.stringify(payload).includes(posting));
        return Response.json(
          provider === "openai"
            ? { choices: [{ message: { content: JSON.stringify(scanned) } }] }
            : { content: [{ type: "text", text: JSON.stringify(scanned) }] },
        );
      };
      const result = await POST(
        new Request("http://localhost:3000/api/jobs", {
          method: "POST",
          body: JSON.stringify({
            description: posting,
            connection: {
              method: "apiKey",
              provider,
              model: "test-model",
              key: "test-key",
            },
          }),
        }),
      );
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), {
        ...scanned,
        rawDescription: posting,
      });
    }
    globalThis.fetch = async () => new Response("", { status: 429 });
    const failure = await POST(
      new Request("http://localhost:3000/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          description: posting,
          connection: {
            method: "apiKey",
            provider: "openai",
            model: "test-model",
            key: "test-key",
          },
        }),
      }),
    );
    assert.equal(failure.status, 400);
    assert.match((await failure.json()).error, /limit/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("job subscription scans pass their own output schema to both CLIs", async () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const runner: CLIRunner = async (_command, args, options) => {
      if (args[0] === "login")
        return { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };
      if (args[0] === "auth")
        return {
          code: 0,
          stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
          stderr: "",
        };
      assert.ok(options.input?.includes(posting));
      if (provider === "openai") {
        assert.deepEqual(
          JSON.parse(
            await readFile(args[args.indexOf("--output-schema") + 1], "utf8"),
          ),
          jobScanOutputSchema,
        );
        await writeFile(
          args[args.indexOf("--output-last-message") + 1],
          JSON.stringify(scanned),
        );
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error("Claude runs through the Agent SDK, not the CLI");
    };
    const claudeQuery = async function* ({
      prompt,
      options,
    }: Parameters<ClaudeQuery>[0]) {
      assert.ok(String(prompt).includes(posting));
      assert.deepEqual(options?.outputFormat?.schema, jobScanOutputSchema);
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: scanned,
      };
    } as unknown as ClaudeQuery;
    const result = await askSubscriptionAI(
      { method: "subscription", provider, model: "" },
      "Scan job",
      posting,
      runner,
      jobScanOutputSchema,
      { claudeQuery },
    );
    assert.deepEqual(result, scanned);
  }
});
