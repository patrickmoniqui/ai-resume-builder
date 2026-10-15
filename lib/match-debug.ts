import type { AIConnection, Job, Resume } from "./model";
export type DiagnosticDetails = Record<
  string,
  string | number | boolean | string[]
>;
export type DiagnosticSink = (
  stage: string,
  details?: DiagnosticDetails,
  code?: string,
) => void;
export type MatchDebugEvent = {
  source: "client" | "server";
  stage: string;
  elapsedMs: number;
  code?: string;
  details?: DiagnosticDetails;
};
export type MatchDebugReport = {
  version: 1;
  requestId: string;
  startedAt: string;
  provider: string;
  method: string;
  model: string;
  status: "running" | "success" | "error" | "canceled";
  input: {
    requirements: number;
    roles: number;
    bullets: number;
    extraSections: number;
    resumeChars: number;
    postingChars: number;
  };
  events: MatchDebugEvent[];
};
const allowed = new Set([
  "status",
  "contentType",
  "batch",
  "batches",
  "attempt",
  "completed",
  "total",
  "repairing",
  "requirementCount",
  "evidenceSourceCount",
  "durationMs",
  "exitCode",
  "stdoutBytes",
  "stderrBytes",
  "providerErrorCode",
  "providerErrorType",
  "validationPaths",
  "returnedItems",
  "expectedItems",
  "uniqueItems",
  "invalidSourceCount",
  "missingEvidenceCount",
  "hasStructuredOutput",
  "outputItems",
  "outputType",
  "streaming",
  "authenticated",
  "installed",
]);
const token = (s: string) =>
  s
    .replace(/sk[-_][a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .slice(0, 120);
const stages = new Set(
  "request_started response_headers validate_client_result client_complete client_failed request_received validate_request validate_subscription_origin prepare_assessment assess_batch subscription_auth_check subscription_auth_result cli_request_started cli_process_finished cli_response_envelope provider_request provider_response provider_rejected provider_json_parsed provider_json_parse_failed validate_response_format validate_requirement_coverage validate_evidence repair_assessment validate_final_result assessment_complete request_failed".split(
    " ",
  ),
);
const codes = new Set(
  "CANCELED TIMEOUT INVALID_JSON EVIDENCE_VALIDATION_FAILED REQUIREMENT_VALIDATION_FAILED PROVIDER_LIMIT CONNECTION_REJECTED NETWORK_ERROR MATCH_FAILED INVALID_REQUEST SUBSCRIPTION_ORIGIN_REJECTED INVALID_RESPONSE_SHAPE INCOMPLETE_REQUIREMENTS INVALID_SOURCE_REFERENCE REPAIR_REQUESTED PROVIDER_HTTP_ERROR CLI_AUTH_REQUIRED CLI_AUTH_REJECTED MODEL_ACCESS_REJECTED CLI_SCHEMA_REJECTED CLI_EXIT_ERROR CLI_REQUEST_FAILED".split(
    " ",
  ),
);
export function cleanDiagnostic(event: MatchDebugEvent): MatchDebugEvent {
  const details: DiagnosticDetails = {};
  for (const [key, value] of Object.entries(event.details || {})) {
    if (!allowed.has(key)) continue;
    if (
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    )
      details[key] = value;
    else if (typeof value === "string") details[key] = token(value);
    else if (Array.isArray(value))
      details[key] = value
        .filter((v) => typeof v === "string")
        .slice(0, 12)
        .map(token);
  }
  return {
    source: event.source === "server" ? "server" : "client",
    stage: stages.has(event.stage) ? event.stage : "unknown_stage",
    elapsedMs: Math.max(0, Math.round(event.elapsedMs) || 0),
    ...(event.code
      ? { code: codes.has(event.code) ? event.code : "UNKNOWN_ERROR" }
      : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
}
export function createMatchDebug(
  connection: AIConnection,
  job: Job,
  doc: Resume,
): MatchDebugReport {
  return {
    version: 1,
    requestId: "",
    startedAt: new Date().toISOString(),
    provider: connection.provider,
    method: connection.method,
    model: token(
      connection.method === "apiKey" &&
        connection.model.includes(connection.key)
        ? connection.model.replaceAll(connection.key, "[redacted]")
        : connection.model || "CLI default",
    ),
    status: "running",
    input: {
      requirements: job.keywords.length,
      roles: doc.roles.length,
      bullets: doc.roles.reduce((n, r) => n + r.bullets.length, 0),
      extraSections: doc.extraSections?.length || 0,
      resumeChars: JSON.stringify(doc).length,
      postingChars: job.rawDescription.length,
    },
    events: [],
  };
}
export function debugFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "AbortError") return "CANCELED";
  if (/timed out|timeout/i.test(message)) return "TIMEOUT";
  if (/not valid JSON|Unexpected token|JSON/i.test(message))
    return "INVALID_JSON";
  if (/evidence|source/i.test(message)) return "EVIDENCE_VALIDATION_FAILED";
  if (/every.*requirement|incomplete assessment/i.test(message))
    return "REQUIREMENT_VALIDATION_FAILED";
  if (/limit|credit|quota/i.test(message)) return "PROVIDER_LIMIT";
  if (/^The local AI request failed/i.test(message))
    return "CLI_REQUEST_FAILED";
  if (/key|sign.in|auth|login/i.test(message)) return "CONNECTION_REJECTED";
  if (/fetch|network/i.test(message)) return "NETWORK_ERROR";
  return "MATCH_FAILED";
}
export function classifyCLIError(text: string): string {
  if (/json.schema|schema.*invalid|invalid.*schema/i.test(text))
    return "CLI_SCHEMA_REJECTED";
  if (/credit|usage.limit|rate.limit|quota|hit.*limit/i.test(text))
    return "PROVIDER_LIMIT";
  if (/auth|login|sign.in|unauthorized/i.test(text)) return "CLI_AUTH_REJECTED";
  if (/unknown.model|model.*not.*found|model.*access/i.test(text))
    return "MODEL_ACCESS_REJECTED";
  return "CLI_EXIT_ERROR";
}
