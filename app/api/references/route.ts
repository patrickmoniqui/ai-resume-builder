import { extractDocumentText } from "@/lib/document-text";
import { errorResponse } from "@/lib/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const form = await req.formData(),
      file = form.get("file");
    if (!(file instanceof File))
      throw new Error("Choose a PDF, DOCX or TXT reference document.");
    const { text, type } = await extractDocumentText(file, true);
    return Response.json({ name: file.name, type, size: file.size, text });
  } catch (error) {
    return errorResponse(error);
  }
}
