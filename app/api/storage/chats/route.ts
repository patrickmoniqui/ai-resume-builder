import { localDatabase } from "@/lib/local-database";
import { chatScopeSchema, revisionSchema } from "@/lib/workspace-storage";
import {
  assertStorageRequest,
  storageJSON,
  storageResponse,
  storageError,
} from "@/lib/storage-http";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    assertStorageRequest(req);
    return storageResponse(
      localDatabase().readChat(
        chatScopeSchema.parse(new URL(req.url).searchParams.get("scope")),
      ),
    );
  } catch (error) {
    return storageError(error);
  }
}
export async function PUT(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req);
    return storageResponse(
      await localDatabase().saveChat(
        chatScopeSchema.parse(data.scope),
        data.messages,
        revisionSchema.parse(data.revision),
        revisionSchema.parse(data.generation),
      ),
    );
  } catch (error) {
    return storageError(error);
  }
}
