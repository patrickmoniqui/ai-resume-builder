import test from "node:test";
import assert from "node:assert/strict";
import { fetchResumeMatch } from "../lib/match-request";
import { blankResume } from "../lib/initial";
const input = {
  connection: {
    method: "apiKey" as const,
    provider: "openai" as const,
    model: "test",
    key: "test",
  },
  doc: { ...blankResume(), skills: "React" },
  job: {
    id: "job",
    templateId: "base",
    source: "",
    title: "Engineer",
    company: "Employer",
    location: "",
    rawDescription: "Build React apps",
    keywords: [{ term: "React", category: "Tools" as const, required: true }],
  },
};
test("stalled fetch and stalled response bodies time out even if they ignore abort", async () => {
  const previous = globalThis.fetch;
  try {
    for (const bodyStalls of [false, true]) {
      let signal: AbortSignal | undefined;
      globalThis.fetch = async (_url, init) => {
        signal = init?.signal as AbortSignal;
        return bodyStalls
          ? ({
              ok: true,
              headers: new Headers(),
              json: () => new Promise(() => {}),
            } as Response)
          : new Promise(() => {});
      };
      await assert.rejects(
        fetchResumeMatch(input, new AbortController().signal, 20),
        /assessment timed out/,
      );
      assert.ok(signal?.aborted);
    }
  } finally {
    globalThis.fetch = previous;
  }
});
test("canceling a stalled request settles promptly and does not return an assessment", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Promise(() => {});
    const controller = new AbortController();
    const pending = fetchResumeMatch(input, controller.signal, 1000);
    const rejection = assert.rejects(pending, { name: "AbortError" });
    controller.abort();
    await rejection;
    await assert.rejects(fetchResumeMatch(input, controller.signal), {
      name: "AbortError",
    });
  } finally {
    globalThis.fetch = previous;
  }
});
test("matching preserves valid AI output and surfaces provider/server errors", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        pct: 76,
        summary: "Relevant experience",
        items: [
          {
            keywordIndex: 0,
            matched: true,
            evidence: "React",
            reason: "Listed in skills.",
          },
        ],
      });
    assert.equal(
      (await fetchResumeMatch(input, new AbortController().signal)).pct,
      76,
    );
    globalThis.fetch = async () =>
      Response.json({ error: "Provider limit reached" }, { status: 429 });
    await assert.rejects(
      fetchResumeMatch(input, new AbortController().signal),
      /Provider limit/,
    );
    globalThis.fetch = async () =>
      new Response("Server error", { status: 500 });
    await assert.rejects(
      fetchResumeMatch(input, new AbortController().signal),
      /unreadable response/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("streamed matching delivers progress and verifies the final assessment across split network chunks", async () => {
  const previous = globalThis.fetch;
  const values: number[] = [];
  try {
    const events =
      JSON.stringify({
        type: "progress",
        completed: 0,
        total: 1,
        batch: 1,
        batches: 1,
        repairing: false,
      }) +
      "\n" +
      JSON.stringify({
        type: "result",
        data: {
          pct: 81,
          summary: "AI match",
          items: [
            {
              keywordIndex: 0,
              matched: true,
              evidence: "React",
              reason: "Listed in skills.",
            },
          ],
        },
      }) +
      "\n";
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new TextEncoder().encode(events);
            controller.enqueue(bytes.slice(0, 30));
            controller.enqueue(bytes.slice(30));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    const result = await fetchResumeMatch(
      input,
      new AbortController().signal,
      1000,
      (value) => values.push(value.completed),
    );
    assert.deepEqual(values, [0]);
    assert.equal(result.pct, 81);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ type: "error", error: "AI evidence check failed" }) +
          "\n",
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    await assert.rejects(
      fetchResumeMatch(input, new AbortController().signal),
      /evidence check failed/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
