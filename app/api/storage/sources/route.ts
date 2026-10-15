import { z } from "zod";
import { localDatabase } from "@/lib/local-database";
import { sourceSchema, revisionSchema } from "@/lib/workspace-storage";
import {
  assertStorageRequest,
  storageJSON,
  storageResponse,
  storageError,
} from "@/lib/storage-http";
export const runtime = "nodejs";
const sourceId = z.string().min(1).max(500);
export async function GET(req: Request) {
  try {
    assertStorageRequest(req);
    const source = localDatabase().readSource(
      sourceId.parse(new URL(req.url).searchParams.get("id")),
    );
    return storageResponse({ source: source || null });
  } catch (error) {
    return storageError(error);
  }
}
export async function PUT(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req);
    await localDatabase().saveSource(
      sourceSchema.parse(data.source),
      revisionSchema.parse(data.generation),
    );
    return storageResponse({ saved: true });
  } catch (error) {
    return storageError(error);
  }
}
export async function DELETE(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req);
    localDatabase().deleteUnreferencedSource(
      sourceId.parse(data.id),
      revisionSchema.parse(data.generation),
    );
    return storageResponse({ deleted: true });
  } catch (error) {
    return storageError(error);
  }
}
