import { z } from "zod";
import {
  assertLocalSubscriptionRequest,
  subscriptionStatus,
} from "@/lib/local-ai";
import { errorResponse } from "@/lib/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    assertLocalSubscriptionRequest(req);
  } catch (e) {
    return errorResponse(e, 403);
  }
  try {
    const { provider } = z
      .object({ provider: z.enum(["openai", "anthropic"]) })
      .parse(await req.json());
    return Response.json(await subscriptionStatus(provider), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
