import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  writeFile,
  access,
  mkdtemp,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { aiConnectionSchema } from "../lib/model";
import {
  assertLocalSubscriptionRequest,
  parseSubscriptionStatus,
  subscriptionEnvironment,
  subscriptionArguments,
  claudeQueryOptions,
  askSubscriptionAI,
  runCLI,
  type ClaudeQuery,
  type CLIRunner,
} from "../lib/local-ai";

test("API and subscription connections have distinct credential requirements", () => {
  assert.equal(
    aiConnectionSchema.safeParse({
      provider: "openai",
      method: "apiKey",
      model: "model",
    }).success,
    false,
  );
  assert.equal(
    aiConnectionSchema.safeParse({
      provider: "openai",
      method: "subscription",
      model: "",
    }).success,
    true,
  );
  assert.equal(
    aiConnectionSchema.safeParse({
      provider: "anthropic",
      method: "apiKey",
      model: "model",
      key: "key",
    }).success,
    true,
  );
});
test("subscription status refuses API-authenticated CLI accounts", () => {
  assert.equal(
    parseSubscriptionStatus("openai", {
      code: 0,
      stdout: "Logged in using an API key",
      stderr: "",
    }).authenticated,
    false,
  );
  assert.equal(
    parseSubscriptionStatus("openai", {
      code: 0,
      stdout: "",
      stderr: "Logged in using ChatGPT",
    }).authenticated,
    true,
  );
  assert.equal(
    parseSubscriptionStatus("anthropic", {
      code: 0,
      stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
      stderr: "",
    }).authenticated,
    false,
  );
  assert.equal(
    parseSubscriptionStatus("anthropic", {
      code: 0,
      stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
      stderr: "",
    }).authenticated,
    true,
  );
});
test("subscription processes do not inherit API keys or token overrides", () => {
  const env = subscriptionEnvironment({
    NODE_ENV: "test",
    PATH: "/bin",
    HOME: "/test",
    OPENAI_API_KEY: "secret",
    ANTHROPIC_API_KEY: "secret",
    CODEX_API_KEY: "secret",
    CLAUDE_CODE_OAUTH_TOKEN: "secret",
    ANTHROPIC_AUTH_TOKEN: "secret",
    CLAUDECODE: "nested",
  });
  assert.equal(env.PATH?.split(path.delimiter)[0], "/bin");
  assert.equal(env.HOME, "/test");
  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CODEX_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDECODE",
  ])
    assert.equal(env[key], undefined);
});
test(
  "subscription processes find native CLIs when a launcher omits their directory",
  { skip: process.platform === "win32" },
  async () => {
    const home = await mkdtemp(path.join(tmpdir(), "resume-cli-path-"));
    try {
      const bin = path.join(home, ".local", "bin");
      await mkdir(bin, { recursive: true });
      await symlink(process.execPath, path.join(bin, "claude"));
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `const { runCLI } = require(${JSON.stringify(path.resolve("lib/local-ai.ts"))});
        runCLI("claude", ["-e", "process.stdout.write('native-cli-found')"], {})
          .then(result => { process.stdout.write(result.stdout); process.exitCode = result.code; })
          .catch(error => { console.error(error.message); process.exitCode = 1; });`,
        ],
        {
          env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin" },
          timeout: 15000,
        },
      );
      assert.equal(stdout, "native-cli-found");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
test(
  "CLI search preserves configured PATH precedence and avoids duplicate directories",
  { skip: process.platform === "win32" },
  () => {
    const configured = ["/custom/bin", "/test/.local/bin", "/usr/bin"].join(
      path.delimiter,
    );
    const env = subscriptionEnvironment({
      NODE_ENV: "test",
      HOME: "/test",
      PATH: configured,
    });
    const directories = env.PATH!.split(path.delimiter);
    assert.deepEqual(directories.slice(0, 3), configured.split(path.delimiter));
    assert.ok(directories.includes("/opt/homebrew/bin"));
    assert.ok(directories.includes("/usr/local/bin"));
    assert.equal(
      directories.filter((directory) => directory === "/test/.local/bin")
        .length,
      1,
    );
  },
);
test("local subscription requests enforce origin and deployment boundary", () => {
  const local = new Request("http://localhost:3000/api/ai", {
    headers: { host: "localhost:3000", origin: "http://localhost:3000" },
  });
  assert.doesNotThrow(() =>
    assertLocalSubscriptionRequest(local, { NODE_ENV: "development" }),
  );
  assert.throws(() =>
    assertLocalSubscriptionRequest(local, { NODE_ENV: "production" }),
  );
  assert.doesNotThrow(() =>
    assertLocalSubscriptionRequest(local, {
      NODE_ENV: "production",
      ENABLE_LOCAL_AI_SUBSCRIPTIONS: "true",
    }),
  );
  assert.throws(() =>
    assertLocalSubscriptionRequest(
      new Request("http://localhost:3000/api/ai", {
        headers: { host: "localhost:3000", origin: "https://attacker.example" },
      }),
      { NODE_ENV: "development" },
    ),
  );
  assert.throws(() =>
    assertLocalSubscriptionRequest(
      new Request("https://public.example/api/ai", {
        headers: { host: "public.example", origin: "https://public.example" },
      }),
      { NODE_ENV: "development" },
    ),
  );
});
test("subscription requests accept Next.js-normalized loopback URLs on custom ports", () => {
  for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001"]) {
    const origin = `http://${host}`;
    const req = new NextRequest(`${origin}/api/ai/subscription`, {
      method: "POST",
      headers: { host, origin },
    });
    assert.equal(new URL(req.url).hostname, "localhost");
    assert.doesNotThrow(() =>
      assertLocalSubscriptionRequest(req, { NODE_ENV: "development" }),
    );
  }
});
test("normalized subscription requests still reject invalid hosts and cross-origin requests", () => {
  const url = "http://localhost:3001/api/ai/subscription";
  const invalidHeaders: Record<string, string>[] = [
    { host: "127.0.0.1:3001", origin: "https://attacker.example" },
    { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3002" },
    { host: "127.0.0.1:3001", origin: "http://localhost:3001" },
    { host: "127.0.0.1:3001", origin: "https://127.0.0.1:3001" },
    { host: "127.0.0.1:3001" },
    { origin: "http://localhost:3001" },
    { host: "attacker.example:3001", origin: "http://attacker.example:3001" },
    { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002" },
    {
      host: "localhost:3001@attacker.example",
      origin: "http://attacker.example",
    },
    {
      host: "attacker.example@localhost:3001",
      origin: "http://localhost:3001",
    },
    { host: "localhost:3001/path", origin: "http://localhost:3001" },
    { host: "[::1", origin: "http://localhost:3001" },
  ];
  for (const headers of invalidHeaders) {
    assert.throws(() =>
      assertLocalSubscriptionRequest(
        new Request(url, { method: "POST", headers }),
        { NODE_ENV: "development" },
      ),
    );
  }
  assert.throws(() =>
    assertLocalSubscriptionRequest(
      new Request("https://public.example/api/ai/subscription", {
        method: "POST",
        headers: { host: "localhost:3001", origin: "https://localhost:3001" },
      }),
      { NODE_ENV: "development" },
    ),
  );
});
test("subscription options restrict tools and preserve a model as a literal argument", () => {
  const claude = claudeQueryOptions(
    { provider: "anthropic", method: "subscription", model: "sonnet" },
    "/tmp/test",
    "System",
  );
  assert.deepEqual(claude.tools, []);
  assert.deepEqual(claude.mcpServers, {});
  assert.deepEqual(claude.settingSources, []);
  assert.equal(claude.strictMcpConfig, true);
  assert.equal(claude.persistSession, false);
  assert.equal(claude.permissionMode, "dontAsk");
  assert.equal(claude.systemPrompt, "System");
  assert.equal(claude.model, "sonnet");
  assert.equal(claude.env?.ANTHROPIC_API_KEY, undefined);
  const codex = subscriptionArguments(
    { provider: "openai", method: "subscription", model: "literal;echo test" },
    "/tmp/test",
  );
  assert.equal(codex.args[codex.args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(codex.args.includes('forced_login_method="chatgpt"'));
  assert.ok(codex.args.includes("literal;echo test"));
  assert.ok(codex.args.includes("--ignore-user-config"));
});
test("Codex reads structured final output and removes temporary files", async () => {
  let dir = "";
  const runner: CLIRunner = async (_command, args, options) => {
    if (args[0] === "login")
      return { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };
    dir = options.cwd!;
    assert.ok(options.input?.includes("User data:"));
    const file = args[args.indexOf("--output-last-message") + 1];
    await writeFile(file, JSON.stringify({ suggestions: [] }));
    return { code: 0, stdout: "diagnostic events", stderr: "" };
  };
  assert.deepEqual(
    await askSubscriptionAI(
      { provider: "openai", method: "subscription", model: "" },
      "System",
      "User",
      runner,
    ),
    { suggestions: [] },
  );
  await assert.rejects(access(dir));
});
test("Claude Agent SDK returns structured output and propagates failures without diagnostics", async () => {
  const signedIn: CLIRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
    stderr: "",
  });
  let dir = "";
  const success = async function* ({
    prompt,
    options,
  }: Parameters<ClaudeQuery>[0]) {
    assert.equal(prompt, "User");
    dir = options!.cwd!;
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: { suggestions: [] },
    };
  } as unknown as ClaudeQuery;
  assert.deepEqual(
    await askSubscriptionAI(
      { provider: "anthropic", method: "subscription", model: "" },
      "System",
      "User",
      signedIn,
      undefined,
      { claudeQuery: success },
    ),
    { suggestions: [] },
  );
  await assert.rejects(access(dir));
  const failure = async function* ({ options }: Parameters<ClaudeQuery>[0]) {
    options!.stderr?.("secret diagnostics");
    throw new Error("Claude Code process exited with code 1");
  } as unknown as ClaudeQuery;
  await assert.rejects(
    askSubscriptionAI(
      { provider: "anthropic", method: "subscription", model: "" },
      "System",
      "User",
      signedIn,
      undefined,
      { claudeQuery: failure },
    ),
    /local AI request failed/,
  );
  const refused = async function* () {
    yield { type: "result", subtype: "error_during_execution", is_error: true };
  } as unknown as ClaudeQuery;
  await assert.rejects(
    askSubscriptionAI(
      { provider: "anthropic", method: "subscription", model: "" },
      "System",
      "User",
      signedIn,
      undefined,
      { claudeQuery: refused },
    ),
    /could not complete/,
  );
});

test("canceling a local AI request terminates its process promptly", async () => {
  const controller = new AbortController();
  const running = runCLI(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal, timeout: 5000 },
  );
  const rejection = assert.rejects(running, { name: "AbortError" });
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await rejection;
  } finally {
    clearTimeout(timer);
  }
});
