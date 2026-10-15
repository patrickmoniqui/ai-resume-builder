import { extractJobPosting, jobLinkFallbackMessage } from "@/lib/job-posting";
import { z } from "zod";
import { aiConnectionSchema } from "@/lib/model";
import { askAI } from "@/lib/server";
import {
  askSubscriptionAI,
  assertLocalSubscriptionRequest,
} from "@/lib/local-ai";
import {
  jobScanPrompt,
  jobScanOutputSchema,
  parseJobScan,
} from "@/lib/job-scan";
export const runtime = "nodejs";
const inputSchema = z.object({
  connection: aiConnectionSchema,
  description: z.string().max(60000).optional(),
  url: z.string().url().max(2000).optional(),
});
import { fetchPublicPage, errorResponse } from "@/lib/server";
export async function POST(req: Request) {
  try {
    const body = inputSchema.parse(await req.json());
    if (body.connection.method === "subscription") {
      try {
        assertLocalSubscriptionRequest(req);
      } catch (e) {
        return errorResponse(e, 403);
      }
    }
    let text = String(body.description || "").slice(0, 60000),
      title = "",
      company = "",
      location = "";
    if (body.url) {
      const url = new URL(body.url);
      if (
        url.hostname === "linkedin.com" ||
        url.hostname.endsWith(".linkedin.com")
      )
        return Response.json(
          {
            error:
              "LinkedIn restricts automated imports. Open the posting and paste its full description below to scan with AI.",
            code: "JOB_TEXT_UNAVAILABLE",
          },
          { status: 400 },
        );
      let html: string;
      try {
        html = await fetchPublicPage(url.href);
      } catch (e) {
        return Response.json(
          { error: (e as Error).message, code: "JOB_TEXT_UNAVAILABLE" },
          { status: 400 },
        );
      }
      ({ text, title, company, location } = extractJobPosting(html, url.href));
    }
    if (text.trim().length < 50) {
      if (body.url)
        return Response.json(
          { error: jobLinkFallbackMessage, code: "JOB_TEXT_UNAVAILABLE" },
          { status: 400 },
        );
      throw new Error(
        "Add the job responsibilities and requirements to your pasted description (at least 50 characters).",
      );
    }
    const data = JSON.stringify({
      posting: text,
      metadata: { title, company, location },
    });
    const output =
      body.connection.method === "subscription"
        ? await askSubscriptionAI(
            body.connection,
            jobScanPrompt,
            data,
            undefined,
            jobScanOutputSchema,
          )
        : await askAI(body.connection, jobScanPrompt, data);
    return Response.json(parseJobScan(output, text));
  } catch (e) {
    return errorResponse(e);
  }
}
