"use client";
import type { ResumeMatch } from "@/lib/resume-match";
const groups = [
  { id: "matched", title: "Matched", matched: true },
  { id: "missing", title: "Missing", matched: false },
] as const;
export default function SkillMatchList({
  items,
  onFocus,
  onAdd,
}: {
  items: ResumeMatch["items"];
  onFocus: (skill: ResumeMatch["items"][number]) => void;
  onAdd: (term: string) => void;
}) {
  return (
    <div className="key-skills">
      <div className="key-skills-heading">
        <h2>Key skills</h2>
        <span className="muted">AI assessed</span>
      </div>
      {groups.map((group) => {
        const skills = items
          .filter((item) => item.matched === group.matched)
          .sort(
            (a, b) =>
              Number(b.required) - Number(a.required) ||
              Number(a.matched) - Number(b.matched),
          );
        return (
          <section
            className="skill-group"
            key={group.id}
            aria-label={group.title}
          >
            <h3>{group.title}</h3>
            {skills.length ? (
              <div className="skill-items">
                {skills.map((skill) => (
                  <details
                    className={`skill-row ${skill.matched ? "matched-row" : "missing-row"}`}
                    key={skill.keywordIndex}
                  >
                    <summary
                      onClick={() => {
                        if (skill.matched) onFocus(skill);
                      }}
                    >
                      <span className="skill-term">{skill.term}</span>
                    </summary>
                    <div className="skill-details">
                      <span className="muted">
                        {skill.required ? "Required" : "Preferred"}
                      </span>
                      <p>{skill.reason}</p>
                      {skill.evidence && <q>{skill.evidence}</q>}
                      {!skill.matched && (
                        <button
                          className="text-button"
                          onClick={() => onAdd(skill.term)}
                        >
                          + Skills
                        </button>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="muted empty-skill-group">
                {group.matched
                  ? "No matched skills yet."
                  : "No missing skills."}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
