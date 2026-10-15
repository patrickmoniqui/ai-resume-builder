import {
  query,
  type Options,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { classifyCLIError, type DiagnosticSink } from "./match-debug";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { AIConnection } from "./model";

export type Provider = AIConnection["provider"];
export type CLIResult = { code: number; stdout: string; stderr: string };
export type CLIRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    timeout?: number;
    signal?: AbortSignal;
  },
) => Promise<CLIResult>;
export function subscriptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "APPDATA",
    "LOCALAPPDATA",
    "CODEX_HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: source.NODE_ENV,
    ...Object.fromEntries(
      keys
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, source[key]]),
    ),
  };
  if (process.platform !== "win32") {
    // Desktop launchers may omit CLI install directories from their PATH.
    // Append fallbacks so explicitly configured executables still take priority.
    env.PATH = [
      ...new Set([
        ...(source.PATH || "").split(path.delimiter).filter(Boolean),
        path.join(source.HOME || homedir(), ".local", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ]),
    ].join(path.delimiter);
  }
  return env;
}
export function assertLocalSubscriptionRequest(
  req: Request,
  env = process.env,
) {
  if (
    env.NODE_ENV === "production" &&
    env.ENABLE_LOCAL_AI_SUBSCRIPTIONS !== "true"
  )
    throw new Error(
      "Local subscription connections are disabled on this server.",
    );
  const url = new URL(req.url),
    host = req.headers.get("host");
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  let hostURL: URL | null = null;
  try {
    if (host) hostURL = new URL(`${url.protocol}//${host}`);
  } catch {
    // Invalid Host headers are rejected by the same local-origin check below.
  }
  // NextRequest normalizes loopback URLs to localhost. Match the browser origin
  // against the validated Host header, keeping the request's protocol and port.
  if (
    !loopback.includes(url.hostname) ||
    !hostURL ||
    !loopback.includes(hostURL.hostname) ||
    hostURL.host !== host ||
    hostURL.port !== url.port ||
    req.headers.get("origin") !== hostURL.origin
  )
    throw new Error(
      "Subscription connections are available only from this app on localhost.",
    );
}
export const runCLI: CLIRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("AI request canceled", "AbortError"));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: subscriptionEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (error?: Error, result?: CLIResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(new DOMException("AI request canceled", "AbortError"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("The local AI request timed out. Try again."));
    }, options.timeout || 15000);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > 1_000_000) {
        child.kill("SIGKILL");
        finish(new Error("The local AI returned too much output."));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > 1_000_000) {
        child.kill("SIGKILL");
        finish(new Error("The local AI returned too much diagnostic output."));
      }
    });
    child.on("error", (error) => {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      finish(
        new Error(
          missing
            ? `${command} is not installed or is not on the app server’s PATH.`
            : "The local AI process could not start.",
        ),
      );
    });
    child.on("close", (code) =>
      finish(undefined, { code: code ?? 1, stdout, stderr }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(options.input || "");
  });
export type SubscriptionStatus = {
  installed: boolean;
  authenticated: boolean;
  message: string;
};
export function parseSubscriptionStatus(
  provider: Provider,
  result: CLIResult,
): SubscriptionStatus {
  if (provider === "openai") {
    const authenticated =
      result.code === 0 &&
      /logged in using chatgpt/i.test(result.stdout + "\n" + result.stderr);
    return {
      installed: true,
      authenticated,
      message: authenticated
        ? "Codex is signed in with ChatGPT."
        : "Run codex login on this computer and sign in with ChatGPT, then check again.",
    };
  }
  let data: { loggedIn?: boolean; authMethod?: string };
  try {
    data = JSON.parse(result.stdout);
  } catch {
    data = {};
  }
  const authenticated =
    result.code === 0 &&
    data.loggedIn === true &&
    data.authMethod === "claude.ai";
  return {
    installed: true,
    authenticated,
    message: authenticated
      ? "Claude Code is signed in with a Claude account."
      : "Run claude auth login on this computer and choose your Claude subscription, then check again.",
  };
}
export async function subscriptionStatus(
  provider: Provider,
  runner: CLIRunner = runCLI,
  signal?: AbortSignal,
): Promise<SubscriptionStatus> {
  try {
    const result = await runner(
      provider === "openai" ? "codex" : "claude",
      provider === "openai"
        ? ["login", "status"]
        : ["auth", "status", "--json"],
      signal ? { signal } : {},
    );
    return parseSubscriptionStatus(provider, result);
  } catch (e) {
    return {
      installed: false,
      authenticated: false,
      message: (e as Error).message,
    };
  }
}
const outputSchema = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          roleIndex: { type: "integer", minimum: 0 },
          bullet: { type: "string" },
        },
        required: ["keyword", "roleIndex", "bullet"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};
export type ClaudeQuery = typeof query;
// Single structured completion: no tools, MCP, settings, hooks, slash commands
// or saved sessions, so the Agent SDK behaves like a plain model call.
export function claudeQueryOptions(
  connection: Extract<AIConnection, { method: "subscription" }>,
  dir: string,
  system: string,
  responseSchema: object = outputSchema,
): Options {
  return {
    cwd: dir,
    env: subscriptionEnvironment(),
    systemPrompt: system,
    outputFormat: {
      type: "json_schema",
      schema: responseSchema as Record<string, unknown>,
    },
    tools: [],
    permissionMode: "dontAsk",
    strictMcpConfig: true,
    mcpServers: {},
    settingSources: [],
    settings: { disableAllHooks: true },
    persistSession: false,
    extraArgs: { "disable-slash-commands": null, "no-chrome": null },
    ...(connection.model ? { model: connection.model } : {}),
  };
}
async function askClaudeAgent(
  claudeQuery: ClaudeQuery,
  queryOptions: Options,
  user: string,
  options: {
    signal?: AbortSignal;
    timeout?: number;
    diagnostic?: DiagnosticSink;
  },
): Promise<unknown> {
  const abortController = new AbortController();
  let timedOut = false;
  const onAbort = () => abortController.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, options.timeout ?? 120000);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let stderr = "";
  let result: SDKResultMessage | undefined;
  try {
    for await (const message of claudeQuery({
      prompt: user,
      options: {
        ...queryOptions,
        abortController,
        stderr: (data) => {
          if (stderr.length < 1_000_000) stderr += data;
        },
      },
    }))
      if (message.type === "result") result = message;
  } catch (error) {
    if (options.signal?.aborted)
      throw new DOMException("AI request canceled", "AbortError");
    if (timedOut) throw new Error("The local AI request timed out. Try again.");
    options.diagnostic?.(
      "cli_process_finished",
      { exitCode: 1, stdoutBytes: 0, stderrBytes: Buffer.byteLength(stderr) },
      classifyCLIError(
        stderr || (error instanceof Error ? error.message : String(error)),
      ),
    );
    throw new Error(
      "The local AI request failed. Check your CLI sign-in, model access and subscription usage limits.",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
  options.diagnostic?.(
    "cli_response_envelope",
    {
      hasStructuredOutput:
        result?.subtype === "success" && !!result.structured_output,
    },
    !result || result.is_error
      ? classifyCLIError(
          result?.subtype === "success" ? result.result : stderr || "",
        )
      : undefined,
  );
  if (!result || result.subtype !== "success" || result.is_error)
    throw new Error(
      "Claude could not complete this request. Check your subscription usage limits.",
    );
  return (
    result.structured_output ||
    JSON.parse(
      result.result.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
    )
  );
}
export function subscriptionArguments(
  connection: Extract<AIConnection, { method: "subscription" }>,
  dir: string,
): { command: string; args: string[] } {
  return {
    command: "codex",
    args: [
      "exec",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--config",
      'approval_policy="never"',
      "--config",
      'forced_login_method="chatgpt"',
      "--config",
      'model_provider="openai"',
      "--config",
      'web_search="disabled"',
      ...[
        "shell_tool",
        "unified_exec",
        "apps",
        "plugins",
        "browser_use",
        "computer_use",
        "in_app_browser",
        "image_generation",
        "code_mode",
        "multi_agent",
        "hooks",
      ].flatMap((feature) => ["--disable", feature]),
      "--output-schema",
      path.join(dir, "schema.json"),
      "--output-last-message",
      path.join(dir, "result.json"),
      ...(connection.model ? ["--model", connection.model] : []),
      "-",
    ],
  };
}
export async function askSubscriptionAI(
  connection: Extract<AIConnection, { method: "subscription" }>,
  system: string,
  user: string,
  runner: CLIRunner = runCLI,
  responseSchema: object = outputSchema,
  options: {
    signal?: AbortSignal;
    timeout?: number;
    diagnostic?: DiagnosticSink;
    claudeQuery?: ClaudeQuery;
  } = {},
): Promise<unknown> {
  options.diagnostic?.("subscription_auth_check");
  const status = await subscriptionStatus(
    connection.provider,
    runner,
    options.signal,
  );
  if (options.signal?.aborted)
    throw new DOMException("AI request canceled", "AbortError");
  options.diagnostic?.(
    "subscription_auth_result",
    { installed: status.installed, authenticated: status.authenticated },
    status.authenticated ? undefined : "CLI_AUTH_REQUIRED",
  );
  if (!status.authenticated) throw new Error(status.message);
  const dir = await mkdtemp(path.join(tmpdir(), "resume-ai-"));
  try {
    let output: unknown;
    if (connection.provider === "anthropic") {
      options.diagnostic?.("cli_request_started");
      output = await askClaudeAgent(
        options.claudeQuery ?? query,
        claudeQueryOptions(connection, dir, system, responseSchema),
        user,
        options,
      );
      options.diagnostic?.("provider_json_parsed", {
        outputType: typeof output,
        outputItems: outputItemCount(output),
      });
      return output;
    }
    await writeFile(
      path.join(dir, "schema.json"),
      JSON.stringify(responseSchema),
      { mode: 0o600 },
    );
    const { command, args } = subscriptionArguments(connection, dir);
    options.diagnostic?.("cli_request_started");
    const result = await runner(command, args, {
      cwd: dir,
      input: system + "\n\nUser data:\n" + user,
      timeout: options.timeout ?? 120000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    options.diagnostic?.(
      "cli_process_finished",
      {
        exitCode: result.code,
        stdoutBytes: Buffer.byteLength(result.stdout),
        stderrBytes: Buffer.byteLength(result.stderr),
      },
      result.code
        ? classifyCLIError(result.stderr || result.stdout)
        : undefined,
    );
    if (result.code !== 0)
      throw new Error(
        "The local AI request failed. Check your CLI sign-in, model access and subscription usage limits.",
      );
    output = JSON.parse(await readFile(path.join(dir, "result.json"), "utf8"));
    options.diagnostic?.("provider_json_parsed", {
      outputType: typeof output,
      outputItems: outputItemCount(output),
    });
    return output;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function outputItemCount(output: unknown) {
  return typeof output === "object" &&
    output !== null &&
    "items" in output &&
    Array.isArray(output.items)
    ? output.items.length
    : 0;
}
