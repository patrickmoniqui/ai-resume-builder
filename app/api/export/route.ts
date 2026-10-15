import { resumeSchema } from "@/lib/model";
import { buildResumePDF } from "@/lib/resume-pdf";
import { errorResponse } from "@/lib/server";
export async function POST(req: Request) {
  try {
    const doc = resumeSchema.parse(await req.json());
    const bytes = await buildResumePDF(doc);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="resume.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
