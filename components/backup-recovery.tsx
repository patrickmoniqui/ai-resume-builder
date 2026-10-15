"use client";
import { useEffect, useRef, useState } from "react";
import Dialog from "./dialog";
import {
  collectBrowserRecovery,
  hasBrowserWorkspace,
} from "@/lib/browser-recovery";
import { databaseRequest, downloadJSON } from "@/lib/database-client";
import {
  parseBundle,
  parseWorkspace,
  sourceIds,
  type RecoveryBundle,
} from "@/lib/workspace-storage";

type Props = {
  ready: boolean;
  flush: () => Promise<void>;
  replace: (action: Record<string, unknown>) => Promise<void>;
};
export default function BackupRecovery({ ready, flush, replace }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [browserData, setBrowserData] = useState(false);
  const [directory, setDirectory] = useState("");
  const [backups, setBackups] = useState<{ name: string; createdAt: string }[]>(
    [],
  );
  const [pending, setPending] = useState<RecoveryBundle | null>(null);
  const [restore, setRestore] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function refresh() {
    const data = await databaseRequest<{
      directory: string;
      backups: typeof backups;
    }>("/api/storage?mode=backups");
    setDirectory(data.directory);
    setBackups(data.backups);
  }
  useEffect(() => {
    if (open) {
      setBrowserData(hasBrowserWorkspace());
      void refresh().catch((e) => setError(e.message));
    }
  }, [open]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readImport(file: File) {
    if (file.size > 512 * 1024 * 1024)
      throw new Error("Choose a backup under 512 MB.");
    let value = JSON.parse(await file.text());
    if (value.format === "resume-builder-unsaved-draft") {
      const workspace = parseWorkspace(value.workspace);
      const saved = await databaseRequest<RecoveryBundle>(
        "/api/storage?mode=export",
      );
      const ids = new Set(sourceIds(workspace));
      const scopes = new Set([
        "workspace",
        ...workspace.jobs.map((j) => `job:${j.id}`),
      ]);
      value = {
        ...saved,
        workspace,
        preferredPages: value.preferredPages,
        sources: saved.sources.filter((s) => ids.has(s.id)),
        chats: Object.fromEntries(
          Object.entries(saved.chats).filter(([scope]) => scopes.has(scope)),
        ),
      };
    }
    setPending(parseBundle(value));
    setRestore("");
  }
  return (
    <>
      <button className="ghost backup-button" onClick={() => setOpen(true)}>
        Backup & recovery
      </button>
      {open && (
        <Dialog
          title="Backup & recovery"
          busy={busy}
          onClose={() => {
            setOpen(false);
            setPending(null);
            setRestore("");
          }}
        >
          <h2>Backup & recovery</h2>
          <p className="dialog-description">
            Your workspace is saved on this computer and shared across ports and
            browsers. Backups include resumes, jobs, notes, chats and original
            files. API keys are excluded.
          </p>
          {directory && (
            <p className="muted backup-location">Saved in: {directory}</p>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <div className="backup-actions">
            <button
              className="primary"
              disabled={busy || !ready}
              onClick={() =>
                void run(async () => {
                  await flush();
                  downloadJSON(
                    await databaseRequest("/api/storage?mode=export"),
                    "resume-builder-backup.json",
                  );
                })
              }
            >
              Download backup
            </button>
            <button
              className="ghost"
              disabled={busy || !ready}
              onClick={() =>
                void run(async () => {
                  await flush();
                  await databaseRequest("/api/storage", "POST", {
                    action: "backup",
                  });
                  await refresh();
                  setNotice("A recovery snapshot was saved on this computer.");
                })
              }
            >
              Save snapshot
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Import backup
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept=".json"
              data-upload="backup"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void run(() => readImport(file));
                e.target.value = "";
              }}
            />
          </div>
          <section className="backup-section">
            <h3>Recover old browser data</h3>
            <p className="muted">
              Open this app at the exact address where you built your resumes,
              using the same browser. Port 3001 cannot read browser data from
              port 3000. You can also use the{" "}
              <a href="/recovery.html" target="_blank" rel="noreferrer">
                browser recovery page
              </a>{" "}
              at the original address.
            </p>
            {browserData ? (
              <div className="backup-actions">
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      downloadJSON(
                        await collectBrowserRecovery(),
                        "resume-builder-browser-backup.json",
                      );
                    })
                  }
                >
                  Download browser backup
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setPending(await collectBrowserRecovery());
                      setRestore("");
                    })
                  }
                >
                  Import browser workspace
                </button>
              </div>
            ) : (
              <p className="muted">
                No old workspace was found at this browser address.
              </p>
            )}
          </section>
          <section className="backup-section">
            <h3>Saved snapshots</h3>
            <p className="muted">
              A daily snapshot is made when you use the app. The latest 14 daily
              snapshots are kept. Extra snapshots are saved before imports and
              workspace clearing.
            </p>
            <select
              aria-label="Saved snapshot"
              value={restore}
              disabled={busy}
              onChange={(e) => {
                setRestore(e.target.value);
                setPending(null);
              }}
            >
              <option value="">Choose a snapshot</option>
              {backups.map((b) => (
                <option key={b.name} value={b.name}>
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {b.name.includes("_daily_")
                    ? "Daily"
                    : b.name.includes("_before-")
                      ? "Before workspace change"
                      : "Manual"}
                </option>
              ))}
            </select>
          </section>
          {(pending || restore) && (
            <div className="backup-confirm">
              {pending && (
                <p>
                  {pending.workspace.templates.length} templates ·{" "}
                  {Object.keys(pending.workspace.docs).length} resume documents
                  · {pending.workspace.jobs.length} jobs ·{" "}
                  {pending.sources.length} original files
                </p>
              )}
              {!!pending?.missingSources?.length && (
                <p className="muted">
                  Some original files were unavailable in this backup. Editable
                  resumes are still included.
                </p>
              )}
              <p>
                This replaces the current workspace. A recovery snapshot of the
                current saved data will be created first. The browser copy is
                kept.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await replace(
                      pending
                        ? { action: "import", bundle: pending }
                        : { action: "restore", name: restore },
                    );
                    setPending(null);
                    setRestore("");
                    await refresh();
                    setNotice("Workspace restored.");
                  })
                }
              >
                {pending ? "Import workspace" : "Restore snapshot"}
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setRestore("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
