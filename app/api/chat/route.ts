import {
  chatInputSchema,
  chatReplySchema,
  chatModelReplySchema,
  chatOutputSchema,
  buildChatSystemPrompt,
} from "@/lib/chat";
import { askAI, errorResponse } from "@/lib/server";
import {
  askSubscriptionAI,
  assertLocalSubscriptionRequest,
} from "@/lib/local-ai";
import { editableChatResume, prepareChatChanges } from "@/lib/chat-changes";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = chatInputSchema.parse(await req.json());
    if (body.connection.method === "subscription") {
      try {
        assertLocalSubscriptionRequest(req);
      } catch (e) {
        return errorResponse(e, 403);
      }
    }
    const editable = editableChatResume(body.workspace);
    const user = JSON.stringify({
      conversation: body.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      workspace: body.workspace,
      originalPDFText: body.sources || [],
      referenceDocuments: body.references || [],
      editableResume: editable?.target || null,
    });
    const system = buildChatSystemPrompt(body.instructions);
    const output =
      body.connection.method === "subscription"
        ? await askSubscriptionAI(
            body.connection,
            system,
            user,
            undefined,
            chatOutputSchema,
          )
        : await askAI(body.connection, system, user);
    const result = chatModelReplySchema.parse(output);
    return Response.json(
      chatReplySchema.parse({
        reply: result.reply,
        changes: prepareChatChanges(body.workspace, result.changes),
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
