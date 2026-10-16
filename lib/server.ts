import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { DiagnosticSink } from "./match-debug";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { AIConnection } from "./model";
export function errorResponse(error: unknown, status = 400) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    },
    { status },
  );
}
function publicIP(ip: string) {
  if (isIP(ip) === 6)
    return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip) && !ip.includes(".");
  const parts = ip.split(".").map(Number);
  return (
    isIP(ip) === 4 &&
    ![0, 10, 127].includes(parts[0]) &&
    !(parts[0] === 169 && parts[1] === 254) &&
    !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) &&
    !(parts[0] === 192 && parts[1] === 168) &&
    !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) &&
    parts[0] < 224
  );
}
export async function fetchPublicPage(
  address: string,
  redirects = 0,
): Promise<string> {
  const url = new URL(address);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS job link.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
    throw new Error("This address is not a public website.");
  const addressRecord = addresses[0];
  const result = await new Promise<{
    status: number;
    location?: string;
    text: string;
  }>((resolve, reject) => {
    const req = https.get(
      url,
      {
        family: addressRecord.family,
        lookup: (_host, _opts, cb) =>
          cb(null, addressRecord.address, addressRecord.family),
        headers: {
          "User-Agent": "ResumeBuilder/1.0",
          // Workday negotiates a JSON SPA redirect when application/json is
          // accepted, even though the same URL serves full JobPosting HTML.
          Accept: "text/html,application/xhtml+xml",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            res.destroy(
              new Error("Posting is too large. Paste the description instead."),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode || 500,
            location: res.headers.location,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(
        new Error("The website took too long. Paste the description instead."),
      ),
    );
    req.on("error", reject);
  });
  if (result.status >= 300 && result.status < 400 && result.location) {
    if (redirects >= 3)
      throw new Error("Too many redirects. Paste the description instead.");
    return fetchPublicPage(new URL(result.location, url).href, redirects + 1);
  }
  if (result.status >= 400)
    throw new Error(
      "This website blocks job imports. Use Paste description instead.",
    );
  return result.text;
}
function providerError(
  error: unknown,
  signal?: AbortSignal,
  diagnostic?: DiagnosticSink,
): Error {
  if (
    signal?.aborted ||
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof OpenAI.APIUserAbortError
  )
    return new DOMException("AI request canceled", "AbortError");
  if (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIConnectionTimeoutError
  )
    return new Error("The AI provider timed out. Try again.");
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof OpenAI.APIConnectionError
  )
    return new Error("Network error reaching the AI provider. Try again.");
  if (!(
    error instanceof Anthropic.APIError || error instanceof OpenAI.APIError
  ))
    return error instanceof Error ? error : new Error(String(error));
  const status = error.status ?? 0;
  const safeCode = (value: unknown) =>
    typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value)
      ? value
      : "unknown";
  // Anthropic exposes the raw body ({ error: { type } }); OpenAI unwraps code/type.
  const body = (error.error ?? {}) as {
    error?: { code?: unknown; type?: unknown };
  };
  diagnostic?.("provider_response", { status });
  diagnostic?.(
    "provider_rejected",
    {
      status,
      providerErrorCode: safeCode(
        error instanceof OpenAI.APIError ? error.code : body.error?.code,
      ),
      providerErrorType: safeCode(
        error instanceof OpenAI.APIError ? error.type : body.error?.type,
      ),
    },
    "PROVIDER_HTTP_ERROR",
  );
  return new Error(
    status === 401
      ? "The provider rejected this API key."
      : status === 429
        ? "Provider rate limit or credit limit reached."
        : `AI request failed (${status}). Check the model ID and your provider account.`,
  );
}
export async function askAI(
  connection: Extract<AIConnection, { method: "apiKey" }>,
  system: string,
  user: string,
  signal?: AbortSignal,
  diagnostic?: DiagnosticSink,
): Promise<unknown> {
  if (!connection.key || connection.key.length > 1000)
    throw new Error("Enter a valid API key.");
  if (!connection.model || connection.model.length > 100)
    throw new Error("Enter a model ID.");
  diagnostic?.("provider_request");
  // Clients are created per request: each call carries the user's own key.
  const clientOptions = { apiKey: connection.key, maxRetries: 0 };
  const requestOptions = { signal, timeout: 60000 };
  let text: string | null | undefined;
  try {
    if (connection.provider === "openai") {
      const { data, response } = await new OpenAI(
        clientOptions,
      ).chat.completions
        .create(
          {
            model: connection.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 3000,
          },
          requestOptions,
        )
        .withResponse();
      diagnostic?.("provider_response", { status: response.status });
      text = data.choices?.[0]?.message?.content;
    } else {
      const { data, response } = await new Anthropic(clientOptions).messages
        .create(
          {
            model: connection.model,
            system,
            messages: [{ role: "user", content: user }],
            max_tokens: 3000,
          },
          requestOptions,
        )
        .withResponse();
      diagnostic?.("provider_response", { status: response.status });
      text = data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
  } catch (error) {
    throw providerError(error, signal, diagnostic);
  }
  if (!text) throw new Error("The provider returned no suggestions.");
  try {
    const parsed = JSON.parse(
      text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
    );
    diagnostic?.("provider_json_parsed", {
      outputType: typeof parsed,
      outputItems: Array.isArray(parsed?.items) ? parsed.items.length : 0,
    });
    return parsed;
  } catch {
    diagnostic?.("provider_json_parse_failed", {}, "INVALID_JSON");
    throw new Error("The AI response was not valid JSON. Try again.");
  }
}
