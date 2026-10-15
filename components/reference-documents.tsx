"use client";
import { useEffect, useRef, useState } from "react";
import Dialog from "./dialog";
import {
  getResumeSource,
  saveResumeSource,
  deleteResumeSource,
  type ResumeSource,
} from "@/lib/resume-sources";
import {
  referenceStorageKey,
  type ReferenceDocument,
} from "@/lib/reference-documents";
export default function ReferenceDocuments({
  documents,
  onAdd,
  onRemove,
  isCurrent,
}: {
  documents: ReferenceDocument[];
  onAdd: (document: ReferenceDocument) => void;
  onRemove: (id: string) => void;
  isCurrent: () => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useState<{
    document: ReferenceDocument;
    source?: ResumeSource;
  } | null>(null);
  const [url, setUrl] = useState(""),
    [showText, setShowText] = useState(false);
  useEffect(() => {
    if (!view?.source) return;
    const value = URL.createObjectURL(view.source.file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [view]);
  async function upload(files: File[]) {
    if (files.length + documents.length > 30) {
      setError("You can save up to 30 reference documents.");
      return;
    }
    setBusy(true);
    setError("");
    const failures: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/references", {
          method: "POST",
          body: form,
        });
        const data = await response.json();
        if (!isCurrent()) break;
        if (!response.ok) throw new Error(data.error || "Import failed.");
        const document: ReferenceDocument = {
          id: crypto.randomUUID(),
          name: data.name,
          type: data.type,
          size: data.size,
          createdAt: new Date().toISOString(),
        };
        const mime =
          data.type === "pdf"
            ? "application/pdf"
            : data.type === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain";
        await saveResumeSource(referenceStorageKey(document.id), {
          name: document.name,
          text: data.text,
          file: new Blob([file], { type: mime }),
        });
        if (!isCurrent()) {
          await deleteResumeSource(referenceStorageKey(document.id));
          break;
        }
        onAdd(document);
      } catch (error) {
        if (isCurrent())
          failures.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    setError(failures.join("\n"));
    setBusy(false);
    if (input.current) input.current.value = "";
  }
  return (
    <section className="reference-documents" aria-label="Reference documents">
      <div className="reference-header">
        <strong>Reference documents</strong>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Importing…" : "Import reference"}
        </button>
      </div>
      <input
        ref={input}
        data-upload="reference"
        type="file"
        hidden
        multiple
        accept=".pdf,.docx,.txt"
        onChange={(event) => void upload(Array.from(event.target.files || []))}
      />
      <p className="muted reference-help">
        PDF, DOCX or TXT · up to 10 MB each · available to AI chat and resume
        suggestions
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="reference-list">
        {documents.map((document) => (
          <div className="reference-row" key={document.id}>
            <button
              className="text-button reference-name"
              onClick={async () => {
                setError("");
                try {
                  const source = await getResumeSource(
                    referenceStorageKey(document.id),
                  );
                  setShowText(document.type !== "pdf");
                  setView({ document, source });
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              {document.name}
            </button>
            <span className="muted">
              {document.type.toUpperCase()} ·{" "}
              {Math.max(1, Math.round(document.size / 1024))} KB
            </span>
            <button
              className="text-button danger"
              aria-label={`Remove reference ${document.name}`}
              onClick={async () => {
                try {
                  await deleteResumeSource(referenceStorageKey(document.id));
                  onRemove(document.id);
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {view && (
        <Dialog
          title="Reference document"
          busy={false}
          onClose={() => setView(null)}
        >
          <h2>{view.document.name}</h2>
          {view.source ? (
            <>
              {view.document.type === "pdf" && (
                <div className="segmented">
                  <button
                    className={!showText ? "active" : ""}
                    onClick={() => setShowText(false)}
                  >
                    View PDF
                  </button>
                  <button
                    className={showText ? "active" : ""}
                    onClick={() => setShowText(true)}
                  >
                    Extracted text
                  </button>
                </div>
              )}
              {showText ? (
                <textarea
                  className="reference-text"
                  aria-label="Reference document text"
                  readOnly
                  value={view.source.text}
                />
              ) : (
                <iframe
                  className="pdf-preview"
                  title={`Reference PDF: ${view.document.name}`}
                  src={url}
                />
              )}
              <div className="dialog-footer">
                <button className="ghost" onClick={() => setView(null)}>
                  Close
                </button>
                <a className="primary" href={url} download={view.document.name}>
                  Download original reference
                </a>
              </div>
            </>
          ) : (
            <p className="muted">
              The saved original file is unavailable. Remove and reimport this
              reference.
            </p>
          )}
        </Dialog>
      )}
    </section>
  );
}
