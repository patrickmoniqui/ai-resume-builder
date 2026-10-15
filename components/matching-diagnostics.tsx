"use client";
import { useState } from "react";
import type { MatchDebugReport } from "@/lib/match-debug";
export default function MatchingDiagnostics({
  report,
  target,
}: {
  report?: MatchDebugReport;
  target: string;
}) {
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState("");
  const text = report ? JSON.stringify(report, null, 2) : "";
  return (
    <details className="matching-diagnostics">
      <summary>Debug matching</summary>
      <p className="muted">{target}</p>
      <p>
        Inspect the last matching request. Use Reassess with AI to capture a new
        request.
      </p>
      <div className="matching-debug-actions">
        <button
          className="ghost"
          disabled={!report}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setCopyError("");
            } catch {
              setCopyError(
                "Clipboard unavailable. Download the report instead.",
              );
            }
          }}
        >
          {copied ? "Report copied" : "Copy debug report"}
        </button>
        <button
          className="text-button"
          disabled={!report}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "application/json" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `matching-debug-${report?.requestId || "pending"}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download report
        </button>
      </div>
      {copyError && <p role="status">{copyError}</p>}
      {report ? (
        <>
          <dl className="matching-debug-meta">
            <dt>Status</dt>
            <dd>{report.status}</dd>
            <dt>Connection</dt>
            <dd>
              {report.provider} · {report.method} · {report.model}
            </dd>
            <dt>Request ID</dt>
            <dd className="mono">
              {report.requestId ||
                (report.status === "running" ? "Queued…" : "Not sent")}
            </dd>
            <dt>Requirements / roles</dt>
            <dd>
              {report.input.requirements} / {report.input.roles}
            </dd>
          </dl>
          <ol
            className="matching-debug-timeline"
            aria-label="Matching diagnostic timeline"
          >
            {report.events.map((event, i) => (
              <li key={i} className={event.code ? "debug-event-error" : ""}>
                <span className="mono">
                  {(event.elapsedMs / 1000).toFixed(1)}s
                </span>{" "}
                <strong>
                  {event.source}: {event.stage.replaceAll("_", " ")}
                </strong>
                {event.code && <div className="mono">{event.code}</div>}
                {event.details && <pre>{JSON.stringify(event.details)}</pre>}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="muted">
          No request has been recorded yet. Click Reassess with AI to capture
          one.
        </p>
      )}
      <p className="muted">
        Reports include timing, counts and error codes. They exclude keys,
        resume/job text and raw AI output.
      </p>
    </details>
  );
}
