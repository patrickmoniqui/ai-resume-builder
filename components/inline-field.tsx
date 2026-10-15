"use client";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { ResumeFocusTarget } from "@/lib/resume-focus";
import { escapeRegex, skillLabel, type Job } from "@/lib/model";
export default function InlineField({
  id,
  value,
  editing,
  onEdit,
  onChange,
  onCommit,
  job,
  focus,
  className = "",
  multiline = false,
  highlightStyle = "marker",
  navigation,
  labels = false,
}: {
  id: string;
  value: string;
  editing: string | null;
  onEdit: (id: string) => void;
  onChange: (value: string) => void;
  onCommit: (byKey?: boolean) => void;
  job?: Job;
  focus: string | null;
  className?: string;
  multiline?: boolean;
  highlightStyle?: string;
  navigation?: ResumeFocusTarget;
  // Bold a leading "Label:" on each line (skill groups).
  labels?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const activeRange = navigation?.value === value ? navigation : undefined;
  const label = id.replace(/-\d+/g, "").replaceAll("-", " ");
  useLayoutEffect(() => {
    if (editing === id && ref.current) {
      ref.current.style.height = "0px";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value, editing, id]);
  useLayoutEffect(() => {
    if (editing === id && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(
        activeRange?.start ?? value.length,
        activeRange?.end ?? value.length,
      );
    }
    if (activeRange) {
      const element = editing === id ? ref.current : displayRef.current;
      const scrollTarget =
        editing === id
          ? element
          : displayRef.current?.querySelector("mark.focused") || element;
      scrollTarget?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
      element?.focus({ preventScroll: true });
    }
  }, [editing, id, navigation?.request]); // eslint-disable-line
  if (editing === id)
    return (
      <textarea
        data-resume-field={id}
        ref={ref}
        className={"inline-editor " + className}
        aria-label={"Edit " + label}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={(e) => {
          if (
            e.key === "Escape" ||
            (e.key === "Enter" && !e.shiftKey && !multiline)
          ) {
            e.preventDefault();
            onCommit(true);
          }
        }}
      />
    );
  const terms = job?.keywords
    .flatMap((k) => [k.term, ...(k.aliases || [])])
    .sort((a, b) => b.length - a.length);
  const pattern = terms?.length
    ? new RegExp("\\b(" + terms.map(escapeRegex).join("|") + ")", "gi")
    : null;
  const highlight = (text: string) =>
    (pattern ? text.split(pattern) : [text]).map((s, i) =>
      i % 2 ? (
        <mark
          key={i}
          className={
            focus?.toLowerCase() === s.toLowerCase()
              ? "focused"
              : highlightStyle
          }
        >
          {s}
        </mark>
      ) : (
        s
      ),
    );
  return (
    <div
      ref={displayRef}
      data-resume-field={id}
      role="button"
      tabIndex={0}
      title="Click to edit"
      aria-label={"Edit " + label}
      className={"editable " + className}
      onClick={() => onEdit(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(id);
        }
      }}
    >
      {value ? (
        activeRange ? (
          <>
            {value.slice(0, activeRange.start)}
            <mark className="focused">
              {value.slice(activeRange.start, activeRange.end)}
            </mark>
            {value.slice(activeRange.end)}
          </>
        ) : labels ? (
          value.split("\n").map((line, i) => {
            const { lead, text } = skillLabel(line);
            return (
              <Fragment key={i}>
                {i > 0 && "\n"}
                {lead && <strong className="skill-label">{lead}</strong>}
                {highlight(text)}
              </Fragment>
            );
          })
        ) : (
          highlight(value)
        )
      ) : (
        <span className="field-placeholder">Click to add {label}</span>
      )}
    </div>
  );
}
