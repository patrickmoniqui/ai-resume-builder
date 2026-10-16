"use client";
import { useId, useState } from "react";
import { jobLinkSchema } from "@/lib/job-links";

export default function JobLinks({
  links,
  onChange,
}: {
  links: string[];
  onChange: (links: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const inputId = useId();
  const add = () => {
    const parsed = jobLinkSchema.safeParse(draft);
    if (!parsed.success) {
      setError("Enter a valid HTTP or HTTPS job URL.");
      return;
    }
    const url = new URL(parsed.data).href;
    if (links.some((link) => new URL(link).href === url)) {
      setError("This link is already saved.");
      return;
    }
    if (links.length >= 20) {
      setError("You can save up to 20 links per job.");
      return;
    }
    onChange([...links, url]);
    setDraft("");
    setError("");
  };
  return (
    <section className="job-links" aria-label="Job links">
      <strong>Job links</strong>
      <p className="muted small-copy">
        Save the company posting, LinkedIn role, or other related links.
      </p>
      {links.length > 0 && (
        <ul className="job-links-list">
          {links.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove link ${url}`}
                onClick={() => onChange(links.filter((link) => link !== url))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="form-field" htmlFor={inputId}>
        Additional job URL
      </label>
      <div className="job-link-input">
        <input
          id={inputId}
          type="url"
          maxLength={2000}
          placeholder="https://…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-describedby={`${inputId}-hint`}
        />
        <button
          type="button"
          className="ghost"
          disabled={!draft.trim()}
          onClick={add}
        >
          Add link
        </button>
      </div>
      <p id={`${inputId}-hint`} className="muted small-copy">
        Links are saved for reference. Adding a link does not scan it.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
