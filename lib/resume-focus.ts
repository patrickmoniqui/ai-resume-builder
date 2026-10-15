import {
  escapeRegex,
  groupExperience,
  resumeSections,
  type Resume,
} from "./model";
export type ResumeFocusTarget = {
  fieldId: string;
  value: string;
  start: number;
  end: number;
  request: number;
};
type Field = { id: string; value: string };
export function resumeFields(doc: Resume): Field[] {
  const fields: Field[] = [
    { id: "name", value: doc.name },
    { id: "headline", value: doc.headline },
    { id: "contact", value: doc.contact },
  ];
  for (const section of resumeSections(doc)) {
    if (section.id === "summary")
      fields.push({ id: "summary", value: doc.summary });
    else if (section.id === "skills")
      fields.push({ id: "skills", value: doc.skills });
    else if (section.id === "experience")
      for (const company of groupExperience(doc.roles)) {
        fields.push({
          id: `role-company-${company.roles[0].index}`,
          value: company.company,
        });
        for (const { role, index } of company.roles) {
          fields.push(
            { id: `role-title-${index}`, value: role.title },
            { id: `role-dates-${index}`, value: role.dates },
          );
          role.bullets.forEach((value, i) =>
            fields.push({ id: `bullet-${index}-${i}`, value }),
          );
        }
      }
    else if (section.id === "education")
      doc.edu.forEach((edu, i) => {
        for (const key of ["degree", "school", "dates"] as const)
          fields.push({ id: `education-${key}-${i}`, value: edu[key] });
      });
    else {
      const i = Number(section.id.slice(6)),
        extra = doc.extraSections?.[i];
      if (extra)
        fields.push(
          { id: `extra-title-${i}`, value: extra.title },
          { id: `extra-text-${i}`, value: extra.text },
        );
    }
  }
  return fields;
}
export function findTermRange(
  value: string,
  term: string,
): { start: number; end: number } | undefined {
  const trimmed = term.trim();
  if (!trimmed) return;
  const pattern = new RegExp(
    trimmed.split(/\s+/).map(escapeRegex).join("\\s+"),
    "giu",
  );
  const word = /[\p{L}\p{N}_]/u;
  for (const match of value.matchAll(pattern)) {
    const start = match.index!,
      end = start + match[0].length;
    if (word.test(trimmed[0]) && start && word.test(value[start - 1])) continue;
    if (
      word.test(trimmed.at(-1)!) &&
      end < value.length &&
      word.test(value[end])
    )
      continue;
    return { start, end };
  }
}
function evidenceRange(value: string, evidence: string) {
  const pattern = evidence.trim().split(/\s+/).map(escapeRegex).join("\\s+");
  if (!pattern) return;
  const match = new RegExp(pattern, "iu").exec(value);
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : undefined;
}
export function locateMatchedSkill(
  doc: Resume,
  skill: { term: string; aliases?: string[]; evidence: string },
): Omit<ResumeFocusTarget, "request"> | undefined {
  const fields = resumeFields(doc),
    terms = [skill.term, ...(skill.aliases || [])];
  if (skill.evidence.trim()) {
    const ordered = [...fields].sort(
      (a, b) =>
        Number(b.value.trim() === skill.evidence.trim()) -
        Number(a.value.trim() === skill.evidence.trim()),
    );
    for (const field of ordered) {
      const evidence = evidenceRange(field.value, skill.evidence);
      if (!evidence) continue;
      for (const term of terms) {
        const literal = findTermRange(
          field.value.slice(evidence.start, evidence.end),
          term,
        );
        if (literal)
          return {
            fieldId: field.id,
            value: field.value,
            start: evidence.start + literal.start,
            end: evidence.start + literal.end,
          };
      }
      return { fieldId: field.id, value: field.value, ...evidence };
    }
  }
  for (const field of fields)
    for (const term of terms) {
      const range = findTermRange(field.value, term);
      if (range) return { fieldId: field.id, value: field.value, ...range };
    }
}
