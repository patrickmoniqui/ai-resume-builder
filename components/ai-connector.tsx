"use client";
import { useState } from "react";
import { type AIConnection, type Resume } from "@/lib/model";
import type { SubscriptionStatus } from "@/lib/local-ai";
const apiDefault = (provider: AIConnection["provider"]) =>
  provider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-5";
export default function AIConnector({
  connection,
  doc,
  busy,
  onBusy,
  onError,
  onConnected,
  onDisconnect,
  onClose,
}: {
  connection: AIConnection | null;
  doc: Resume;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
  onConnected: (connection: AIConnection) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<AIConnection["provider"]>(
    connection?.provider || "anthropic",
  );
  const [method, setMethod] = useState<AIConnection["method"]>(
    connection?.method || "apiKey",
  );
  const [key, setKey] = useState(
    connection?.method === "apiKey" ? connection.key : "",
  );
  const [model, setModel] = useState(connection?.model ?? apiDefault(provider));
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const switchMethod = (next: AIConnection["method"]) => {
    setMethod(next);
    setModel(next === "subscription" ? "" : apiDefault(provider));
    setKey("");
    setStatus(null);
    onError("");
  };
  async function connect() {
    onBusy(true);
    onError("");
    try {
      const next: AIConnection =
        method === "subscription"
          ? { method, provider, model: model.trim() }
          : { method, provider, model: model.trim(), key: key.trim() };
      const res = await fetch(
        method === "subscription" ? "/api/ai/subscription" : "/api/ai",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            method === "subscription"
              ? { provider }
              : { connection: next, doc, notes: [], mode: "verify" },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed.");
      if (method === "subscription") {
        setStatus(data);
        if (!data.authenticated) return;
      }
      onConnected(next);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <h2>Connect an AI assistant</h2>
      <p className="dialog-description">
        Use Claude or Codex with an API key or your subscription.
      </p>
      <div className="provider-options">
        {(["openai", "anthropic"] as const).map((p) => (
          <button
            key={p}
            className={"provider-option " + (provider === p ? "selected" : "")}
            disabled={busy}
            aria-pressed={provider === p}
            onClick={() => {
              setProvider(p);
              setModel(method === "subscription" ? "" : apiDefault(p));
              setKey("");
              setStatus(null);
              onError("");
            }}
          >
            <span className="provider-symbol">
              {p === "openai" ? "◎" : "✳"}
            </span>
            <strong>{p === "openai" ? "Codex" : "Claude"}</strong>
            <small>{p === "openai" ? "OpenAI" : "Anthropic"}</small>
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Connection method">
        <button
          disabled={busy}
          className={method === "apiKey" ? "active" : ""}
          aria-pressed={method === "apiKey"}
          onClick={() => switchMethod("apiKey")}
        >
          API key
        </button>
        <button
          disabled={busy}
          className={method === "subscription" ? "active" : ""}
          aria-pressed={method === "subscription"}
          onClick={() => switchMethod("subscription")}
        >
          Subscription
        </button>
      </div>
      {method === "apiKey" ? (
        <>
          <label className="form-field">
            API key
            <input
              type="password"
              disabled={busy}
              autoComplete="off"
              placeholder={provider === "openai" ? "sk-…" : "sk-ant-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p className="integration-note">
            Usage is billed to your{" "}
            {provider === "openai" ? "OpenAI" : "Anthropic"} API account. Keys
            are saved in this browser on this device and sent only to this app’s
            server and the provider. All AI features reuse these settings after
            reload. Disconnect removes the saved connection.
          </p>
        </>
      ) : (
        <>
          <div className="integration-note">
            <strong>
              {provider === "openai"
                ? "ChatGPT subscription via Codex"
                : "Claude subscription via Claude Code"}
            </strong>
            <p>
              Sign in to the official CLI on the computer running this app. This
              connection uses that account’s plan and usage limits.
            </p>
            <code>
              {provider === "openai" ? "codex login" : "claude auth login"}
            </code>
            <p>
              Connect once to save these settings. Matching, chat, job scans and
              tailoring reuse them after reload. Your sign-in tokens stay with
              the CLI. This option works when the app runs locally on your
              computer.
            </p>
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={
                provider === "openai"
                  ? "https://developers.openai.com/codex/cli"
                  : "https://code.claude.com/docs/en/quickstart"
              }
            >
              CLI setup instructions ↗
            </a>
          </div>
          {status && (
            <div
              className={
                status.authenticated ? "connection-status" : "error-message"
              }
              role="status"
            >
              {status.message}
            </div>
          )}
        </>
      )}
      <label className="form-field">
        Model{method === "subscription" ? " (optional)" : ""}
        <input
          disabled={busy}
          value={model}
          list="ai-models"
          placeholder={
            method === "subscription"
              ? "Use CLI default model"
              : "Provider model ID"
          }
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="ai-models">
          {(method === "subscription"
            ? provider === "anthropic"
              ? ["sonnet", "opus", "haiku"]
              : []
            : provider === "openai"
              ? ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"]
              : ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"]
          ).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="dialog-footer">
        {connection && (
          <button
            disabled={busy}
            className="text-button danger"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        )}
        <div className="spacer" />
        <button disabled={busy} className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={
            busy || (method === "apiKey" && (!key.trim() || !model.trim()))
          }
          onClick={connect}
        >
          {busy
            ? "Connecting…"
            : method === "subscription"
              ? "Connect subscription"
              : connection
                ? "Save"
                : "Connect"}
        </button>
      </div>
    </>
  );
}
