import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import dns from "node:dns/promises";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { POST } from "../app/api/jobs/route";

const url =
  "https://unitytech.wd1.myworkdayjobs.com/Unity/job/Montreal-Canada/Dveloppeur-euse--de-logiciels---Software-Developer--Unity-Editor_JOBREQ-2616397?source=LinkedIn";

test("Workday URL imports request HTML and send full qualifications to the AI", async (t) => {
  const html = await readFile(
    new URL("./fixtures/unity-workday.html", import.meta.url),
    "utf8",
  );
  t.mock.method(dns, "lookup", async () => [
    { address: "203.0.113.10", family: 4 },
  ]);
  // Reproduce Workday's content negotiation, including its misleading 200 JSON
  // response when the importer advertises support for application/json.
  t.mock.method(
    https,
    "get",
    (
      _url: URL,
      options: { headers: { Accept: string } },
      callback: (response: EventEmitter) => void,
    ) => {
      const request = new EventEmitter();
      Object.assign(request, { setTimeout() {}, destroy() {} });
      queueMicrotask(() => {
        const response = new EventEmitter();
        Object.assign(response, { statusCode: 200, headers: {} });
        callback(response);
        const body = options.headers.Accept.includes("application/json")
          ? JSON.stringify({ widget: "redirect", url, externalSpa: true })
          : html;
        response.emit("data", Buffer.from(body));
        response.emit("end");
      });
      return request;
    },
  );
  let aiCalls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options?: RequestInit) => {
      aiCalls++;
      const input = JSON.parse(String(options?.body));
      const data = JSON.parse(input.messages[1].content);
      for (const term of [
        "C#",
        "C++",
        "automated testing",
        "Claude Code",
        "Copilot",
      ])
        assert.ok(data.posting.includes(term), `Missing ${term} in AI input`);
      assert.ok(!data.posting.includes('"widget":"redirect"'));
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: data.metadata.title,
                company: "Unity",
                location: "Montreal",
                keywords: [
                  {
                    term: "C#",
                    category: "Hard skills",
                    required: true,
                    aliases: [],
                  },
                  {
                    term: "Automated testing",
                    category: "Hard skills",
                    required: true,
                    aliases: [],
                  },
                  {
                    term: "C++",
                    category: "Hard skills",
                    required: false,
                    aliases: [],
                  },
                ],
              }),
            },
          },
        ],
      });
    },
  );
  const result = await POST(
    new Request("http://localhost:3000/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        url,
        connection: {
          method: "apiKey",
          provider: "openai",
          model: "test-model",
          key: "test-key",
        },
      }),
    }),
  );
  assert.equal(result.status, 200);
  const job = await result.json();
  assert.match(job.rawDescription, /Strong C# programming skills/);
  assert.equal(job.keywords.length, 3);
  assert.equal(aiCalls, 1);
});
