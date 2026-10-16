"use client";
import { useId, useState } from "react";
import type { Job, Workspace } from "@/lib/model";
import { assessmentSignature } from "@/lib/saved-matches";
import {
  resumeCandidates,
  selectedComparisonIds,
} from "@/lib/resume-comparisons";
import type { useAIMatches } from "./use-ai-matches";
import Dialog from "./dialog";

export default function ResumeComparisons({
  workspace,
  job,
  matches,
  onSelect,
}: {
  workspace: Workspace;
  job: Job;
  matches: ReturnType<typeof useAIMatches>;
  onSelect: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const tooltipId = useId();
  const candidates = resumeCandidates(workspace, job);
  const selected = selectedComparisonIds(workspace, job);
  const busy = matches.busy(job);
  return (
    <div className="resume-comparisons">
      <div className="comparison-scores">
        {selected.map((id, index) => {
          const candidate = candidates.find((c) => c.id === id)!;
          const saved = job.comparisonAssessments?.[id];
          const result = saved?.result;
          const request = matches.comparisonState(job, id);
          const stale =
            saved &&
            saved.inputSignature !==
              assessmentSignature(job, workspace.docs[id]);
          const descriptionId = `${tooltipId}-${index}`;
          return (
            <div className="comparison-score" key={id}>
              <div
                className="score-ring comparison-ring"
                tabIndex={0}
                aria-label={`${candidate.name}: ${request?.running ? "assessing" : result ? `${result.pct}% resume match` : "not assessed"}${stale ? ", changed since assessment" : ""}`}
                aria-describedby={descriptionId}
                onClick={(event) => event.currentTarget.focus()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.currentTarget.blur();
                }}
              >
                <svg viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="40" className="ring-track" />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    className="ring-progress"
                    strokeDasharray={`${((result?.pct || 0) / 100) * 251.327} 251.327`}
                  />
                </svg>
                <strong>
                  {request?.running ? (
                    "…"
                  ) : result ? (
                    <>
                      {result.pct}
                      <span>%</span>
                    </>
                  ) : (
                    "—"
                  )}
                </strong>
                <div
                  id={descriptionId}
                  className="score-tooltip"
                  role="tooltip"
                >
                  <b>
                    {candidate.name}
                    {result ? ` · ${result.pct}%` : ""}
                  </b>
                  <p>{candidate.source}</p>
                  <p>
                    {result?.summary ||
                      "Use Reassess with AI to assess this resume."}
                  </p>
                  {result && (
                    <p>
                      {result.matched} of {result.items.length} skills matched ·{" "}
                      {result.requiredMatched} of {result.required} required
                      skills matched.
                    </p>
                  )}
                  {saved && (
                    <p>
                      Assessed {new Date(saved.assessedAt).toLocaleString()}
                    </p>
                  )}
                  {stale && (
                    <p>
                      Resume or job changed. Reassess with AI to update this
                      score.
                    </p>
                  )}
                  {request?.error && <p role="alert">{request.error}</p>}
                </div>
              </div>
              <span className="comparison-name">{candidate.name}</span>
              {stale && <span className="comparison-state">Changed</span>}
              {request?.error && (
                <span className="comparison-state">Assessment failed</span>
              )}
            </div>
          );
        })}
      </div>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => {
          setDraft(selected);
          setPicking(true);
        }}
      >
        Compare resumes
      </button>
      {selected.length > 0 && (
        <p className="muted comparison-hint">
          Additional resumes · hover or focus a score for details.
        </p>
      )}
      {picking && (
        <Dialog
          title="Compare resumes"
          busy={busy}
          onClose={() => setPicking(false)}
        >
          <h2>Compare resumes</h2>
          <p>
            The attached resume is included. Choose up to two additional
            resumes.
          </p>
          <p className="muted">
            {draft.length} of 2 selected. Save your selection, then use Reassess
            with AI.
          </p>
          <div className="comparison-options">
            {candidates.map((candidate) => (
              <label className="comparison-option" key={candidate.id}>
                <input
                  type="checkbox"
                  checked={draft.includes(candidate.id)}
                  disabled={!draft.includes(candidate.id) && draft.length >= 2}
                  onChange={(event) =>
                    setDraft((old) =>
                      event.target.checked
                        ? [...old, candidate.id]
                        : old.filter((id) => id !== candidate.id),
                    )
                  }
                />
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.source}</small>
                </span>
              </label>
            ))}
            {!candidates.length && (
              <p className="muted">
                Add another template or tailor a resume for another job to
                compare it here.
              </p>
            )}
          </div>
          <button
            className="primary"
            onClick={() => {
              onSelect(
                draft
                  .filter((id) => candidates.some((c) => c.id === id))
                  .slice(0, 2),
              );
              setPicking(false);
            }}
          >
            Save comparison
          </button>
        </Dialog>
      )}
    </div>
  );
}
