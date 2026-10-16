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
  onSave: (
    jobId: string,
    assessment: SavedAssessment,
    comparisonId?: string,
  ) => void,
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
  const requestKey = (job: Job, comparisonId?: string) =>
    JSON.stringify([job.id, comparisonId || null]);
  const jobRequests = (job: Job) =>
    Object.entries(requests)
      .filter(([key]) => {
        const [jobId, comparisonId] = JSON.parse(key);
        return (
          jobId === job.id &&
          (!comparisonId || job.comparisonDocIds?.includes(comparisonId))
        );
      })
      .map(([, value]) => value);
  async function reassess(job: Job, doc: Resume, comparisonId?: string) {
    const key = requestKey(job, comparisonId);
    if (!connection || controllers.current.has(key)) return;
    const controller = new AbortController();
    controllers.current.set(key, controller);
    const snapshot = structuredClone(doc),
      jobSnapshot = structuredClone(job);
    const startedAt = Date.now();
    setNow(startedAt);
    setRequests((old) => ({
      ...old,
      [key]: { startedAt, running: true, progress: null },
    }));
    setReports((old) => ({
      ...old,
      [key]: createMatchDebug(connection, jobSnapshot, snapshot),
    }));
    try {
      const result = await fetchResumeMatch(
        { connection, job: jobSnapshot, doc: snapshot },
        controller.signal,
        undefined,
        (progress) =>
          setRequests((old) =>
            old[key] ? { ...old, [key]: { ...old[key], progress } } : old,
          ),
        (entry, requestId) =>
          setReports((old) => {
            const report = old[key];
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
              [key]: {
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
          comparisonId,
        );
    } catch (error) {
      setRequests((old) =>
        old[key]
          ? {
              ...old,
              [key]: {
                ...old[key],
                error:
                  (error as Error).name === "AbortError"
                    ? "Assessment canceled."
                    : (error as Error).message,
              },
            }
          : old,
      );
    } finally {
      if (controllers.current.get(key) === controller)
        controllers.current.delete(key);
      setRequests((old) =>
        old[key] ? { ...old, [key]: { ...old[key], running: false } } : old,
      );
    }
  }
  return {
    get: (job: Job, _doc?: Resume) => job.assessment?.result,
    stale: (job: Job, doc?: Resume) =>
      !!job.assessment &&
      (!doc || job.assessment.inputSignature !== assessmentSignature(job, doc)),
    error: (job: Job, _doc?: Resume) =>
      jobRequests(job).find((r) => r.error)?.error,
    busy: (job: Job, _doc?: Resume) => jobRequests(job).some((r) => r.running),
    comparisonState: (job: Job, id: string) => requests[requestKey(job, id)],
    elapsed: (job: Job) =>
      Math.max(
        0,
        Math.floor(
          (now - (jobRequests(job).find((r) => r.running)?.startedAt || now)) /
            1000,
        ),
      ),
    progress: (job: Job) => jobRequests(job).find((r) => r.running)?.progress,
    debug: (job: Job, _doc?: Resume) => reports[requestKey(job)],
    cancel: (job: Job, _doc?: Resume) => {
      for (const [key, controller] of controllers.current) {
        if (JSON.parse(key)[0] === job.id) controller.abort();
      }
    },
    cancelAll: () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    reassess,
  };
}
