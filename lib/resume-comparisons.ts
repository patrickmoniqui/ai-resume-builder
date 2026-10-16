import type { Job, Resume, Workspace } from "./model";
import { assessmentSignature } from "./saved-matches";

export function attachedResumeId(w: Workspace, job: Job) {
  return (
    job.tailoredDocId || w.templates.find((t) => t.id === job.templateId)?.docId
  );
}

export function resumeCandidates(w: Workspace, job: Job) {
  const attached = attachedResumeId(w, job);
  const candidates = [
    ...w.templates.map((t) => ({
      id: t.docId,
      name: t.name,
      source: "Template",
    })),
    ...w.jobs.flatMap((j) =>
      j.tailoredDocId
        ? [
            {
              id: j.tailoredDocId,
              name: `${j.title} · ${j.company}`,
              source: "Tailored resume",
            },
          ]
        : [],
    ),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (
      candidate.id === attached ||
      !w.docs[candidate.id] ||
      seen.has(candidate.id)
    )
      return false;
    seen.add(candidate.id);
    return true;
  });
}

export function selectedComparisonIds(w: Workspace, job: Job) {
  const available = new Set(resumeCandidates(w, job).map((c) => c.id));
  return [...new Set(job.comparisonDocIds || [])]
    .filter((id) => available.has(id))
    .slice(0, 2);
}

export function pendingAssessments(
  w: Workspace,
  job: Job,
): { doc: Resume; comparisonId?: string }[] {
  const attached = attachedResumeId(w, job);
  const candidates = [
    ...(attached && w.docs[attached]
      ? [
          {
            doc: w.docs[attached],
            assessment: job.assessment,
            comparisonId: undefined,
          },
        ]
      : []),
    ...selectedComparisonIds(w, job).map((id) => ({
      doc: w.docs[id],
      assessment: job.comparisonAssessments?.[id],
      comparisonId: id,
    })),
  ];
  return candidates
    .filter(
      ({ doc, assessment }) =>
        !assessment ||
        assessment.inputSignature !== assessmentSignature(job, doc),
    )
    .map(({ doc, comparisonId }) => ({ doc, comparisonId }));
}
