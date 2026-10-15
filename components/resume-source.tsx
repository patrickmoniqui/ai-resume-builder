"use client";
import { useEffect, useState } from "react";
import Dialog from "./dialog";
import { getResumeSource, type ResumeSource } from "@/lib/resume-sources";
export default function ResumeSourceViewer({
  templateId,
  sourceFile,
}: {
  templateId: string;
  sourceFile: string;
}) {
  const [source, setSource] = useState<ResumeSource>();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [showText, setShowText] = useState(false);
  const [url, setUrl] = useState<string>();
  const isPDF =
    source?.file.type === "application/pdf" || /\.pdf$/i.test(sourceFile);
  useEffect(() => {
    let active = true;
    getResumeSource(templateId)
      .then((record) => {
        if (active) setSource(record);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [templateId]);
  useEffect(() => {
    if (!open || !source) return;
    const blobUrl = URL.createObjectURL(source.file);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [open, source]);
  if (!/\.pdf$/i.test(sourceFile) && !source) return null;
  return (
    <>
      <button className="ghost" disabled={!ready} onClick={() => setOpen(true)}>
        {isPDF ? "Original PDF" : "Original file"}
      </button>
      {open && (
        <Dialog
          title={isPDF ? "Original PDF" : "Original file"}
          busy={false}
          onClose={() => setOpen(false)}
        >
          <h2>{isPDF ? "Original PDF" : "Original file"}</h2>
          {source ? (
            <>
              <p className="dialog-description">
                {source.name}. This is the exact uploaded file. Your edits are
                in the editable resume and its PDF export.
              </p>
              {isPDF && (
                <div className="segmented">
                  <button
                    className={!showText ? "active" : ""}
                    onClick={() => setShowText(false)}
                  >
                    Original layout
                  </button>
                  <button
                    className={showText ? "active" : ""}
                    onClick={() => setShowText(true)}
                  >
                    Extracted text
                  </button>
                </div>
              )}
              {showText || !isPDF ? (
                <label className="form-field">
                  Extracted document text
                  <textarea
                    className="source-text"
                    aria-label={
                      isPDF ? "Extracted PDF text" : "Extracted document text"
                    }
                    readOnly
                    value={source.text}
                  />
                </label>
              ) : (
                <iframe
                  className="pdf-preview"
                  title="Original resume PDF"
                  src={url}
                />
              )}
              <div className="dialog-footer">
                <button className="ghost" onClick={() => setOpen(false)}>
                  Close
                </button>
                <a className="primary" href={url} download={source.name}>
                  {isPDF ? "Download original PDF" : "Download original file"}
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="dialog-description">
                The original file was not saved for this older import, or file
                storage is unavailable. Reimport the PDF to keep its exact
                layout alongside the editable version.
              </p>
              <button className="ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
