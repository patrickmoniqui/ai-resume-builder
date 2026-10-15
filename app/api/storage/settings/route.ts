import { localDatabase } from "@/lib/local-database";
import { revisionSchema } from "@/lib/workspace-storage";
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
    return storageResponse(localDatabase().readSettings());
  } catch (error) {
    return storageError(error);
  }
}
export async function PUT(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req);
    return storageResponse(
      await localDatabase().saveSettings(
        data.settings,
        revisionSchema.parse(data.revision),
        revisionSchema.parse(data.generation),
      ),
    );
  } catch (error) {
    return storageError(error);
  }
}
