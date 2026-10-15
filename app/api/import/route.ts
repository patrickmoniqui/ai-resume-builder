import { extractDocumentText } from "@/lib/document-text";
import { parseResume } from "@/lib/parsing";
import { errorResponse } from "@/lib/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new Error("Choose a .docx or .pdf file.");
    const { text, pageCount, resumeText } = await extractDocumentText(
      file,
      false,
      true,
    );
    return Response.json({
      doc: { ...parseResume(resumeText ?? text), pageCount },
      text,
      notice: /\.pdf$/i.test(file.name)
        ? "PDF imported into an editable layout. Use Original PDF to view the exact upload; review extracted sections before exporting."
        : "Imported text. Review the section layout and edit role details before exporting.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
