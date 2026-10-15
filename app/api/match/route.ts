import { z } from "zod";
import { aiConnectionSchema, resumeSchema, jobInputSchema } from "@/lib/model";
import { askAI } from "@/lib/server";
import {
  askSubscriptionAI,
  assertLocalSubscriptionRequest,
} from "@/lib/local-ai";
import { assessResumeMatch, type MatchProgress } from "@/lib/resume-match";
import {
  cleanDiagnostic,
  debugFailureCode,
  type MatchDebugEvent,
  type DiagnosticSink,
} from "@/lib/match-debug";
export const runtime = "nodejs";
const schema = z.object({
  connection: aiConnectionSchema,
  doc: resumeSchema,
  job: jobInputSchema,
});
export async function POST(req: Request) {
  const started = Date.now();
  const suppliedId = req.headers.get("x-match-request-id") || "";
  const requestId = /^[a-f0-9-]{36}$/i.test(suppliedId)
    ? suppliedId
    : crypto.randomUUID();
  const events: MatchDebugEvent[] = [];
  let observer: ((entry: MatchDebugEvent) => void) | undefined;
  const diagnostic: DiagnosticSink = (stage, details, code) => {
    const entry = cleanDiagnostic({
      source: "server",
      stage,
      elapsedMs: Date.now() - started,
      details,
      code,
    });
    events.push(entry);
    if (events.length > 160) events.shift();
    observer?.(entry);
  };
  const headers = {
    "Cache-Control": "no-store",
    "X-Match-Request-Id": requestId,
  };
  const failed = (error: unknown, status = 400) => {
    diagnostic("request_failed", {}, debugFailureCode(error));
    return Response.json(
      {
        error: error instanceof Error ? error.message : "AI assessment failed.",
        debug: { requestId, events },
      },
      { status, headers },
    );
  };
  try {
    diagnostic("request_received");
    const input = await req.json();
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      diagnostic(
        "validate_request",
        {
          validationPaths: parsed.error.issues
            .slice(0, 12)
            .map((i) => i.path.join(".")),
        },
        "INVALID_REQUEST",
      );
      return failed(
        new Error(
          "The matching request contains invalid fields. Open Debug matching for details.",
        ),
      );
    }
    const body = parsed.data;
    diagnostic("validate_request", {
      requirementCount: body.job.keywords.length,
    });
    if (body.connection.method === "subscription") {
      try {
        assertLocalSubscriptionRequest(req);
      } catch (error) {
        diagnostic(
          "validate_subscription_origin",
          {},
          "SUBSCRIPTION_ORIGIN_REJECTED",
        );
        return failed(error, 403);
      }
    }
    const canceled = new AbortController();
    const signal = AbortSignal.any([
      req.signal,
      canceled.signal,
      AbortSignal.timeout(170000),
    ]);
    const run = (progress?: (value: MatchProgress) => void) =>
      assessResumeMatch(
        body.doc,
        body.job,
        async (system, context, outputSchema) => {
          if (signal.aborted)
            throw new Error(
              "AI assessment canceled or timed out. Retry the assessment.",
            );
          return body.connection.method === "subscription"
            ? askSubscriptionAI(
                body.connection,
                system,
                context,
                undefined,
                outputSchema,
                { signal, timeout: 120000, diagnostic },
              )
            : askAI(body.connection, system, context, signal, diagnostic);
        },
        progress,
        diagnostic,
      );
    if (!req.headers.get("accept")?.includes("application/x-ndjson")) {
      const data = await run();
      diagnostic("assessment_complete", { returnedItems: data.items.length });
      return Response.json(
        { ...data, debug: { requestId, events } },
        { headers },
      );
    }
    let closed = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: unknown) => {
          if (!closed)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        for (const entry of events)
          send({ type: "diagnostic", requestId, entry });
        observer = (entry) => send({ type: "diagnostic", requestId, entry });
        void (async () => {
          try {
            const data = await run((progress) =>
              send({ type: "progress", ...progress }),
            );
            diagnostic("assessment_complete", {
              returnedItems: data.items.length,
            });
            send({ type: "result", data });
          } catch (error) {
            diagnostic("request_failed", {}, debugFailureCode(error));
            send({
              type: "error",
              error: signal.aborted
                ? "AI assessment canceled or timed out. Retry the assessment."
                : error instanceof Error
                  ? error.message
                  : "AI assessment failed. Retry.",
              requestId,
            });
          } finally {
            observer = undefined;
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        closed = true;
        observer = undefined;
        canceled.abort();
      },
    });
    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch (error) {
    return failed(error);
  }
}
