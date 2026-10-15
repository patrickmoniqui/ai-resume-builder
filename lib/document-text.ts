import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { taggedResumeText } from "./resume-pdf-text";
export async function extractDocumentText(
  file: File,
  allowText = false,
  forResume = false,
) {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Files must be under 10 MB.");
  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "",
    resumeText: string | undefined,
    pageCount: 1 | 2 = 1,
    type: "pdf" | "docx" | "txt";
  if (/\.docx$/i.test(file.name)) {
    type = "docx";
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (/\.pdf$/i.test(file.name)) {
    type = "pdf";
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText({ pageJoiner: "" });
      text = parsed.text;
      pageCount = parsed.total > 1 ? 2 : 1;
      if (forResume) resumeText = await taggedResumeText(buffer);
    } finally {
      await parser.destroy();
    }
  } else if (allowText && /\.txt$/i.test(file.name)) {
    type = "txt";
    text = buffer.toString("utf8");
    if (text.includes("\0"))
      throw new Error("This is not a readable text file.");
  } else
    throw new Error(
      allowText
        ? "Only PDF, DOCX and TXT files are supported."
        : "Only .docx and .pdf files are supported.",
    );
  if (text.length > 150000)
    throw new Error(
      "This document is too long (maximum 150,000 extracted characters).",
    );
  if (!text.trim())
    throw new Error(
      "No readable text found. Scanned PDFs need OCR before import.",
    );
  return { text, pageCount, type, resumeText };
}
