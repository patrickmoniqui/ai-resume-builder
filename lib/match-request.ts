import {
  cleanDiagnostic,
  debugFailureCode,
  type MatchDebugEvent,
} from "./match-debug";
import type { AIConnection, Job, Resume } from "./model";
import { parseResumeMatch, type MatchProgress } from "./resume-match";
export const MATCH_REQUEST_TIMEOUT_MS = 180_000;
export async function fetchResumeMatch(
  input: { connection: AIConnection; job: Job; doc: Resume },
  signal: AbortSignal,
  timeoutMs = MATCH_REQUEST_TIMEOUT_MS,
  onProgress: (value: MatchProgress) => void = () => {},
  onDiagnostic: (entry: MatchDebugEvent, requestId: string) => void = () => {},
) {
  if (signal.aborted)
    throw new DOMException("Assessment canceled", "AbortError");
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let finished = false;
  const trace = (
    stage: string,
    details?: MatchDebugEvent["details"],
    code?: string,
  ) =>
    !finished &&
    onDiagnostic(
      cleanDiagnostic({
        source: "client",
        stage,
        elapsedMs: Date.now() - started,
        details,
        code,
      }),
      requestId,
    );
  const serverTrace = (entry: MatchDebugEvent) =>
    !finished && onDiagnostic(cleanDiagnostic(entry), requestId);
  trace("request_started");
  const controller = new AbortController();
  let rejectInterrupted: (reason: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectInterrupted(new DOMException("Assessment canceled", "AbortError"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    rejectInterrupted(
      new Error(
        "AI assessment timed out. Retry the assessment or check your AI connection.",
      ),
    );
    controller.abort();
  }, timeoutMs);
  try {
    const request = async () => {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          "X-Match-Request-Id": requestId,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      trace("response_headers", {
        status: response.status,
        contentType: response.headers.get("content-type") || "unknown",
      });
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("application/x-ndjson")
      ) {
        if (!response.body)
          throw new Error("Matching returned no response stream. Retry.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          const event = JSON.parse(line);
          if (event.type === "diagnostic") {
            serverTrace(event.entry);
            return;
          }
          if (event.type === "error")
            throw new Error(event.error || "AI assessment failed. Retry.");
          if (event.type === "progress") {
            onProgress(event);
            return;
          }
          if (event.type === "result") {
            trace("validate_client_result");
            return parseResumeMatch(event.data, input.job, input.doc);
          }
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let end: number;
            while ((end = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              if (line.trim()) {
                const result = handle(line);
                if (result) return result;
              }
            }
            if (done) {
              if (buffer.trim()) {
                const result = handle(buffer);
                if (result) return result;
              }
              throw new Error(
                "AI assessment ended without a complete result. Retry the assessment.",
              );
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      const data = await response.json().catch(() => {
        throw new Error(
          "The matching server returned an unreadable response. Retry the assessment.",
        );
      });
      if (Array.isArray(data?.debug?.events))
        for (const entry of data.debug.events) serverTrace(entry);
      if (!response.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "AI assessment failed. Retry the assessment.",
        );
      trace("validate_client_result");
      return parseResumeMatch(data, input.job, input.doc);
    };
    const result = await Promise.race([request(), interrupted]);
    trace("client_complete", { returnedItems: result.items.length });
    return result;
  } catch (error) {
    trace("client_failed", {}, debugFailureCode(error));
    throw error;
  } finally {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
