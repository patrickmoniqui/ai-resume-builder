import { chatChangeState, type ChatChange } from "@/lib/chat-changes";
import type { Workspace } from "@/lib/model";

export default function ChatChanges({
  changes,
  workspace,
  busy,
  onApply,
  onDismiss,
}: {
  changes: ChatChange[];
  workspace: Workspace;
  busy: boolean;
  onApply: (index: number, change: ChatChange) => void;
  onDismiss: (index: number) => void;
}) {
  return (
    <div className="chat-changes">
      {changes.map((change, index) => {
        if (change.status === "dismissed") return null;
        const result = chatChangeState(workspace, change);
        return (
          <section
            className="chat-change"
            aria-label={`Suggested change: ${result.label}`}
            key={index}
          >
            <strong>{result.label}</strong>
            <p className="chat-change-target">
              {change.target.label}
              {change.target.kind === "job"
                ? " · Job resume"
                : " · Base template"}
            </p>
            <p>{change.reason}</p>
            <div className="chat-change-diff" aria-label="Change preview">
              <div className="chat-change-before">
                <span>Before</span>
                {change.before ? (
                  <del>{change.before}</del>
                ) : (
                  <em>Empty / new bullet</em>
                )}
              </div>
              <div className="chat-change-after">
                <span>After</span>
                {change.after ? <ins>{change.after}</ins> : <em>Empty</em>}
              </div>
            </div>
            {result.message && (
              <p className="chat-change-status" role="status">
                {result.message}
              </p>
            )}
            <div className="chat-change-actions">
              <button
                className="primary small"
                disabled={busy || result.state !== "ready"}
                onClick={() => onApply(index, change)}
              >
                {result.state === "applied" ? "Applied" : "Apply change"}
              </button>
              {result.state !== "applied" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => onDismiss(index)}
                >
                  Dismiss
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
