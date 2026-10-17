"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "@/lib/model";
import type { WorkspaceState } from "@/lib/workspace-storage";
import {
  collectBrowserRecovery,
  hasBrowserWorkspace,
} from "@/lib/browser-recovery";
import {
  databaseRequest,
  DatabaseRequestError,
  setStorageSession,
  downloadJSON,
} from "@/lib/database-client";

type Content = { workspace: Workspace; preferredPages: 1 | 2 | null };
// Selections and completed AI work must not wait for the text-edit debounce.
const assessmentState = (workspace: Workspace) =>
  JSON.stringify(
    workspace.jobs.map((job) => ({
      id: job.id,
      assessment: job.assessment,
      comparisonDocIds: job.comparisonDocIds,
      comparisonAssessments: job.comparisonAssessments,
    })),
  );

export function useWorkspaceStorage(
  workspace: Workspace,
  preferredPages: 1 | 2 | null,
  setWorkspace: (w: Workspace) => void,
  setPreferredPages: (pages: 1 | 2 | null) => void,
) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<
    "loading" | "saving" | "saved" | "error" | "conflict"
  >("loading");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const current = useRef<Content>({ workspace, preferredPages });
  current.current = { workspace, preferredPages };
  const saved = useRef("");
  const savedAssessments = useRef("");
  const revision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const conflict = useRef(false);
  const loaded = useRef(false);

  const adopt = useCallback(
    (state: WorkspaceState) => {
      revision.current = state.revision;
      setStorageSession(state);
      saved.current = JSON.stringify({
        workspace: state.workspace,
        preferredPages: state.preferredPages,
      });
      savedAssessments.current = assessmentState(state.workspace);
      current.current = {
        workspace: state.workspace,
        preferredPages: state.preferredPages,
      };
      conflict.current = false;
      loaded.current = true;
      setWorkspace(state.workspace);
      setPreferredPages(state.preferredPages);
      setReady(true);
      setLoadError("");
      setStatus("saved");
      setMessage("");
    },
    [setWorkspace, setPreferredPages],
  );

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        let state = await databaseRequest<WorkspaceState>("/api/storage");
        if (canceled) return;
        if (!state.initialized && hasBrowserWorkspace()) {
          const bundle = await collectBrowserRecovery();
          if (canceled) return;
          try {
            state = await databaseRequest<WorkspaceState>(
              "/api/storage",
              "POST",
              {
                action: "import",
                bundle,
                revision: state.revision,
                onlyIfEmpty: true,
              },
            );
            if (!canceled)
              setNotice(
                "Browser workspace recovered into the local database. Your browser copy has been preserved.",
              );
          } catch (error) {
            if (
              !(error instanceof DatabaseRequestError) ||
              error.status !== 409
            )
              throw error;
            state = await databaseRequest<WorkspaceState>("/api/storage");
          }
        }
        if (!canceled) adopt(state);
      } catch (error) {
        if (!canceled) {
          setLoadError((error as Error).message);
          setStatus("error");
        }
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [adopt]);

  const flush = useCallback(async () => {
    if (!loaded.current)
      throw new Error(
        "The workspace has not loaded. No changes have been saved.",
      );
    if (conflict.current)
      throw new Error(
        "Another tab changed this workspace. Download your unsaved work before reloading.",
      );
    if (inFlight.current) return inFlight.current;
    const pending = (async () => {
      try {
        while (saved.current !== JSON.stringify(current.current)) {
          setStatus("saving");
          const content = current.current;
          const serialized = JSON.stringify(content);
          const result = await databaseRequest<WorkspaceState>(
            "/api/storage",
            "PUT",
            { ...content, revision: revision.current },
          );
          revision.current = result.revision;
          setStorageSession(result);
          saved.current = serialized;
          savedAssessments.current = assessmentState(content.workspace);
          if (result.backupWarning) setNotice(result.backupWarning);
        }
        setStatus("saved");
        setMessage("");
      } catch (error) {
        conflict.current =
          error instanceof DatabaseRequestError && error.status === 409;
        setStatus(conflict.current ? "conflict" : "error");
        setMessage((error as Error).message);
        throw error;
      }
    })();
    inFlight.current = pending;
    try {
      await pending;
    } finally {
      inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (
      !ready ||
      saved.current === JSON.stringify(current.current) ||
      conflict.current
    )
      return;
    setStatus("saving");
    if (assessmentState(workspace) !== savedAssessments.current) {
      void flush().catch(() => {});
      return;
    }
    const timer = setTimeout(() => void flush().catch(() => {}), 450);
    return () => clearTimeout(timer);
  }, [workspace, preferredPages, ready, flush]);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (loaded.current && saved.current !== JSON.stringify(current.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden" && loaded.current)
        void flush().catch(() => {});
    };
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  const replace = useCallback(
    async (action: Record<string, unknown>) => {
      if (loaded.current) await flush();
      else {
        // Explicit recovery can repair an unreadable payload without autosaving it.
        const metadata = await databaseRequest<{ revision: number }>(
          "/api/storage?mode=metadata",
        );
        revision.current = metadata.revision;
      }
      const state = await databaseRequest<WorkspaceState>(
        "/api/storage",
        "POST",
        { ...action, revision: revision.current },
      );
      adopt(state);
    },
    [flush, adopt],
  );
  const exportUnsaved = useCallback(() => {
    downloadJSON(
      {
        format: "resume-builder-unsaved-draft",
        version: 1,
        exportedAt: new Date().toISOString(),
        ...current.current,
      },
      "resume-builder-unsaved-draft.json",
    );
  }, []);
  return {
    ready,
    loadError,
    status,
    message,
    notice,
    flush,
    replace,
    exportUnsaved,
  };
}
