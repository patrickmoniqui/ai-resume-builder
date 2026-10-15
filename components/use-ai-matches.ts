"use client";
import { useEffect, useRef, useState } from "react";
import {
  createMatchDebug,
  cleanDiagnostic,
  type MatchDebugReport,
} from "@/lib/match-debug";
import type { AIConnection, Job, Resume } from "@/lib/model";
import { fetchResumeMatch } from "@/lib/match-request";
import type { MatchProgress } from "@/lib/resume-match";
import {
  saveAssessment,
  assessmentSignature,
  type SavedAssessment,
} from "@/lib/saved-matches";
type RequestState = {
  startedAt: number;
  running: boolean;
  progress: MatchProgress | null;
  error?: string;
};
export function useAIMatches(
  connection: AIConnection | null,
  onSave: (jobId: string, assessment: SavedAssessment) => void,
) {
  const [reports, setReports] = useState<Record<string, MatchDebugReport>>({});
  const [requests, setRequests] = useState<Record<string, RequestState>>({});
  const [now, setNow] = useState(Date.now());
  const controllers = useRef(new Map<string, AbortController>());
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const running = Object.values(requests).some((r) => r.running);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );
  const identity = JSON.stringify(connection);
  useEffect(() => {
    for (const controller of controllers.current.values()) controller.abort();
  }, [identity]);
  async function reassess(job: Job, doc: Resume) {
    if (!connection || controllers.current.has(job.id)) return;
    const controller = new AbortController();
    controllers.current.set(job.id, controller);
    const snapshot = structuredClone(doc),
      jobSnapshot = structuredClone(job);
    const startedAt = Date.now();
    setNow(startedAt);
    setRequests((old) => ({
      ...old,
      [job.id]: { startedAt, running: true, progress: null },
    }));
    setReports((old) => ({
      ...old,
      [job.id]: createMatchDebug(connection, jobSnapshot, snapshot),
    }));
    try {
      const result = await fetchResumeMatch(
        { connection, job: jobSnapshot, doc: snapshot },
        controller.signal,
        undefined,
        (progress) =>
          setRequests((old) =>
            old[job.id]
              ? { ...old, [job.id]: { ...old[job.id], progress } }
              : old,
          ),
        (entry, requestId) =>
          setReports((old) => {
            const report = old[job.id];
            if (!report || (report.requestId && report.requestId !== requestId))
              return old;
            const status =
              entry.stage === "client_complete"
                ? "success"
                : entry.stage === "client_failed"
                  ? entry.code === "CANCELED"
                    ? "canceled"
                    : "error"
                  : report.status;
            return {
              ...old,
              [job.id]: {
                ...report,
                requestId,
                status,
                events: [...report.events, cleanDiagnostic(entry)].slice(-160),
              },
            };
          }),
      );
      if (!controller.signal.aborted)
        saveRef.current(
          job.id,
          saveAssessment(connection, jobSnapshot, snapshot, result),
        );
    } catch (error) {
      setRequests((old) =>
        old[job.id]
          ? {
              ...old,
              [job.id]: {
                ...old[job.id],
                error:
                  (error as Error).name === "AbortError"
                    ? "Assessment canceled."
                    : (error as Error).message,
              },
            }
          : old,
      );
    } finally {
      if (controllers.current.get(job.id) === controller)
        controllers.current.delete(job.id);
      setRequests((old) =>
        old[job.id]
          ? { ...old, [job.id]: { ...old[job.id], running: false } }
          : old,
      );
    }
  }
  return {
    get: (job: Job, _doc?: Resume) => job.assessment?.result,
    stale: (job: Job, doc?: Resume) =>
      !!job.assessment &&
      (!doc || job.assessment.inputSignature !== assessmentSignature(job, doc)),
    error: (job: Job, _doc?: Resume) => requests[job.id]?.error,
    busy: (job: Job, _doc?: Resume) => !!requests[job.id]?.running,
    elapsed: (job: Job) =>
      Math.max(
        0,
        Math.floor((now - (requests[job.id]?.startedAt || now)) / 1000),
      ),
    progress: (job: Job) => requests[job.id]?.progress,
    debug: (job: Job, _doc?: Resume) => reports[job.id],
    cancel: (job: Job, _doc?: Resume) =>
      controllers.current.get(job.id)?.abort(),
    cancelAll: () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    reassess,
  };
}
