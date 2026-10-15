"use client";
import { useEffect, useRef, useState } from "react";
import { aiProviderName, type AIConnection, type Workspace } from "@/lib/model";
import { referenceStorageKey } from "@/lib/reference-documents";
import { getResumeSource } from "@/lib/resume-sources";
import { chatReplySchema, chatPrompt, type ChatMessage } from "@/lib/chat";
import ChatReply from "./chat-reply";
import ChatChanges from "./chat-changes";
import type { ChatChange } from "@/lib/chat-changes";
import { chatScope } from "@/lib/chat-history";
import {
  databaseRequest,
  storageGeneration,
  DatabaseRequestError,
} from "@/lib/database-client";

type ChatProps = {
  connection: AIConnection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  resetKey: number;
  onConnect: () => void;
  onApplyChange: (change: ChatChange) => boolean;
  beforeSave: () => Promise<void>;
};

export default function AIChat(props: ChatProps) {
  const scope = chatScope(props.workspace);
  return (
    <ChatSession key={`${props.resetKey}:${scope}`} {...props} scope={scope} />
  );
}

function ChatSession({
  connection,
  open,
  onOpenChange,
  workspace,
  onConnect,
  onApplyChange,
  beforeSave,
  scope,
}: ChatProps & {
  scope: string;
}) {
  const [instructions, setInstructions] = useState("");
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsStatus, setInstructionsStatus] = useState("");
  const generation = useRef(storageGeneration());
  const settingsRevision = useRef(0);
  const [settingsReady, setSettingsReady] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  useEffect(() => {
    let canceled = false;
    void databaseRequest<{ instructions: string; revision: number }>(
      "/api/storage/settings",
    )
      .then((saved) => {
        if (!canceled) {
          setInstructions(saved.instructions);
          settingsRevision.current = saved.revision;
          setSettingsReady(true);
        }
      })
      .catch((e) => {
        if (!canceled) setInstructionsStatus(e.message);
      });
    return () => {
      canceled = true;
    };
  }, []);
  function editInstructions() {
    setInstructionsDraft(instructions);
    setInstructionsStatus("");
    setInstructionsOpen(true);
  }
  async function saveInstructions() {
    const value = instructionsDraft.trim();
    setSavingInstructions(true);
    try {
      const saved = await databaseRequest<{ revision: number }>(
        "/api/storage/settings",
        "PUT",
        {
          settings: { instructions: value },
          revision: settingsRevision.current,
          generation: generation.current,
        },
      );
      settingsRevision.current = saved.revision;
      setInstructions(value);
      setInstructionsDraft(value);
      setInstructionsStatus(
        value
          ? "Instructions saved on this computer. Applied to new replies."
          : "Default instructions restored.",
      );
    } catch (e) {
      setInstructionsStatus((e as Error).message);
    } finally {
      setSavingInstructions(false);
    }
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [storageWarning, setStorageWarning] = useState("");
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chatRevision = useRef(0);
  const chatQueue = useRef<Promise<void>>(Promise.resolve());
  const chatConflict = useRef(false);
  const [historyReady, setHistoryReady] = useState(false);
  function persist(history: ChatMessage[]) {
    const pending = chatQueue.current
      .then(async () => {
        if (chatConflict.current)
          throw new Error(
            "This chat changed in another tab. Reload to continue.",
          );
        await beforeSave();
        const saved = await databaseRequest<{ revision: number }>(
          "/api/storage/chats",
          "PUT",
          {
            scope,
            messages: history,
            revision: chatRevision.current,
            generation: generation.current,
          },
        );
        chatRevision.current = saved.revision;
        setStorageWarning("");
      })
      .catch((error) => {
        chatConflict.current =
          error instanceof DatabaseRequestError && error.status === 409;
        setStorageWarning("Chat changes could not be saved. " + error.message);
      });
    chatQueue.current = pending;
  }
  function clear() {
    version.current++;
    controller.current?.abort();
    controller.current = null;
    setMessages([]);
    setDraft("");
    setError("");
    setBusy(false);
    setCopied(null);
    persist([]);
  }
  useEffect(() => {
    let canceled = false;
    void databaseRequest<{ messages: ChatMessage[]; revision: number }>(
      `/api/storage/chats?scope=${encodeURIComponent(scope)}`,
    )
      .then((saved) => {
        if (!canceled) {
          setMessages(saved.messages);
          chatRevision.current = saved.revision;
          setHistoryReady(true);
        }
      })
      .catch((e) => {
        if (!canceled)
          setStorageWarning("Chat could not be loaded. " + e.message);
      });
    return () => {
      canceled = true;
      version.current++;
      controller.current?.abort();
    };
  }, [scope]);
  useEffect(() => {
    version.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, [connection]);
  useEffect(() => {
    if (open && document.activeElement?.getAttribute("role") !== "tab")
      input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy, open]);
  const provider = connection
    ? aiProviderName(connection.provider, connection.method)
    : "AI";
  const job = workspace.viewTemplateId
    ? undefined
    : workspace.jobs.find((j) => j.id === workspace.selectedJobId);
  const template = workspace.templates.find(
    (t) => t.id === (workspace.viewTemplateId || job?.templateId),
  );
  async function send() {
    const content = draft.trim();
    if (!connection || !content || controller.current || !historyReady) return;
    const previous = messages;
    const conversation: ChatMessage[] = [
      ...messages,
      { role: "user", content },
    ];
    const current = version.current;
    const abort = new AbortController();
    controller.current = abort;
    setMessages(conversation);
    setDraft("");
    setError("");
    setBusy(true);
    setCopied(null);
    try {
      const records = await Promise.all(
        workspace.templates.map(async (template) => {
          const source = await getResumeSource(template.id).catch(
            () => undefined,
          );
          return source
            ? { templateId: template.id, name: source.name, text: source.text }
            : null;
        }),
      );
      if (current !== version.current || abort.signal.aborted) return;
      const sources = records.filter((record) => record !== null);
      const references = await Promise.all(
        (workspace.references || []).map(async (document) => {
          const source = await getResumeSource(
            referenceStorageKey(document.id),
          );
          if (!source)
            throw new Error(
              `Reimport ${document.name}: its reference text is unavailable.`,
            );
          return { ...document, text: source.text };
        }),
      );
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          connection,
          messages: conversation
            .slice(-19)
            .map(({ role, content }) => ({ role, content })),
          workspace,
          sources,
          references,
          instructions,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Chat request failed. Try again.");
      const { reply, changes } = chatReplySchema.parse(data);
      if (current === version.current) {
        const completed: ChatMessage[] = [
          ...conversation,
          {
            role: "assistant",
            content: reply,
            ...(changes?.length ? { changes } : {}),
          },
        ];
        setMessages(completed);
        persist(completed);
      }
    } catch (e) {
      if (current === version.current && !abort.signal.aborted) {
        setMessages(previous);
        setDraft(content);
        setError((e as Error).message);
      }
    } finally {
      if (current === version.current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  function close() {
    onOpenChange(false);
  }
  function setChangeStatus(
    messageIndex: number,
    changeIndex: number,
    status: "applied" | "dismissed",
  ) {
    const next = messages.map((message, index) =>
      index === messageIndex
        ? {
            ...message,
            changes: message.changes?.map((change, i) =>
              i === changeIndex ? { ...change, status } : change,
            ),
          }
        : message,
    );
    setMessages(next);
    persist(next);
  }
  return (
    <>
      {open && (
        <section
          id="ai-chat-panel"
          className="chat-panel"
          aria-label="AI chatbot"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header className="chat-header">
            <div>
              <strong>Application assistant</strong>
              <span>
                {connection
                  ? `${provider} · ${connection.method === "subscription" ? "Subscription" : "API"}`
                  : "Connect Claude or Codex"}
              </span>
            </div>
            <button
              className="text-button"
              disabled={busy || !historyReady}
              aria-expanded={instructionsOpen}
              onClick={() =>
                instructionsOpen
                  ? setInstructionsOpen(false)
                  : editInstructions()
              }
            >
              Instructions
            </button>
            <button
              className="text-button"
              disabled={!historyReady}
              onClick={clear}
            >
              New chat
            </button>
            <button
              className="icon-button"
              aria-label="Close AI chatbot"
              onClick={close}
            >
              ×
            </button>
          </header>
          <div className="chat-context">
            {Object.keys(workspace.docs).length} resumes ·{" "}
            {workspace.jobs.length} jobs · {workspace.notes.length}{" "}
            {workspace.notes.length === 1 ? "note" : "notes"} ·{" "}
            {workspace.references?.length || 0} references
            {instructions && <p>Custom instructions active</p>}
            {(template || job) && (
              <p>
                Viewing:{" "}
                {job ? `${job.company} · ${job.title}` : template?.name}
              </p>
            )}
            <p>
              All saved resume data, job descriptions, notes, and available
              original PDF text are sent with your messages.{" "}
              {job ? "This job’s chat" : "Workspace chat"} is saved on this
              device. Each job has its own conversation.
            </p>
            {storageWarning && (
              <p role="status">
                {storageWarning}{" "}
                {historyReady && !chatConflict.current && (
                  <button
                    className="text-button"
                    onClick={() => persist(messages)}
                  >
                    Retry saving chat
                  </button>
                )}
              </p>
            )}
          </div>
          {instructionsOpen ? (
            <form
              className="chat-instructions"
              onSubmit={(e) => {
                e.preventDefault();
                void saveInstructions();
              }}
            >
              <label className="form-field">
                Custom instructions / system prompt
                <textarea
                  aria-label="Chat instructions / system prompt"
                  rows={8}
                  maxLength={6000}
                  value={instructionsDraft}
                  placeholder="For example: Reply in French. Keep answers concise. Focus on senior Python and AI roles."
                  onChange={(e) => {
                    setInstructionsDraft(e.target.value);
                    setInstructionsStatus("");
                  }}
                />
              </label>
              <p className="muted">
                Set the assistant’s task, language, tone, and preferences. Saved
                instructions apply to new replies across chats and connections.
                Leave empty to use the defaults.
              </p>
              <details>
                <summary>View default system prompt</summary>
                <pre>{chatPrompt}</pre>
              </details>
              {instructionsStatus && <p role="status">{instructionsStatus}</p>}
              <div className="chat-instructions-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setInstructionsDraft("");
                    setInstructionsStatus(
                      "Save to restore the default instructions.",
                    );
                  }}
                >
                  Reset to default
                </button>
                <div className="spacer" />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setInstructionsOpen(false)}
                >
                  Back to chat
                </button>
                <button
                  className="primary"
                  disabled={!settingsReady || savingInstructions}
                >
                  {savingInstructions ? "Saving…" : "Save instructions"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div
                className="chat-messages"
                role="log"
                aria-label="Chat conversation"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {!messages.length && (
                  <div className="chat-empty">
                    <strong>How can I help?</strong>
                    <p>
                      Ask about any resume or job, compare applications, or use
                      your notes to prepare for an interview.
                    </p>
                    {connection && (
                      <div className="chat-prompts">
                        {[
                          "How can I improve this resume?",
                          "Help me prepare for an interview",
                          ...(job
                            ? ["Which job requirements should I focus on?"]
                            : []),
                        ].map((prompt) => (
                          <button
                            className="ghost"
                            key={prompt}
                            onClick={() => {
                              setDraft(prompt);
                              input.current?.focus();
                            }}
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {messages.map((message, i) => (
                  <div className={`chat-message ${message.role}`} key={i}>
                    <span className="chat-speaker">
                      {message.role === "user" ? "You" : provider}
                    </span>
                    {message.role === "assistant" ? (
                      <>
                        <ChatReply content={message.content} />
                        {!!message.changes?.length && (
                          <ChatChanges
                            changes={message.changes}
                            workspace={workspace}
                            busy={busy}
                            onApply={(index, change) => {
                              if (onApplyChange(change))
                                setChangeStatus(i, index, "applied");
                              else
                                setError(
                                  "This resume changed. Ask for an updated suggestion.",
                                );
                            }}
                            onDismiss={(index) =>
                              setChangeStatus(i, index, "dismissed")
                            }
                          />
                        )}
                      </>
                    ) : (
                      <p>{message.content}</p>
                    )}
                    {message.role === "assistant" && (
                      <button
                        className="text-button"
                        aria-label={`Copy reply ${i + 1}`}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              message.content,
                            );
                            setCopied(i);
                          } catch {
                            setError(
                              "Copy is unavailable. Select and copy the reply text.",
                            );
                          }
                        }}
                      >
                        {copied === i ? "Copied" : "Copy reply"}
                      </button>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="loading-row" role="status">
                    <span className="spinner" />
                    {provider} is thinking…
                  </div>
                )}
                <div ref={end} />
              </div>
              {error && (
                <p className="chat-error" role="alert">
                  {error}
                </p>
              )}
              {!connection ? (
                <div className="chat-connect">
                  <p>Use your existing API key or subscription connection.</p>
                  <button className="primary full-width" onClick={onConnect}>
                    Connect AI for chat
                  </button>
                </div>
              ) : (
                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label className="sr-only" htmlFor="chat-message">
                    Message AI
                  </label>
                  <textarea
                    id="chat-message"
                    ref={input}
                    value={draft}
                    maxLength={2000}
                    rows={3}
                    disabled={busy || !historyReady}
                    placeholder="Ask about your application…"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div>
                    <small>Enter to send · Shift+Enter for a new line</small>
                    <button
                      className="primary"
                      disabled={busy || !draft.trim() || !historyReady}
                    >
                      Send message
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
