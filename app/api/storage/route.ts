import { z } from "zod";
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
    const db = localDatabase(),
      mode = new URL(req.url).searchParams.get("mode");
    if (mode === "metadata") return storageResponse(db.metadata());
    if (mode === "export")
      return Response.json(db.exportBundle(), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition":
            'attachment; filename="resume-builder-backup.json"',
        },
      });
    if (mode === "backups")
      return storageResponse({
        backups: await db.listBackups(),
        directory: db.directory,
      });
    return storageResponse(db.read());
  } catch (error) {
    return storageError(error);
  }
}
export async function PUT(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req);
    return storageResponse(
      await localDatabase().save(
        data.workspace,
        data.preferredPages,
        revisionSchema.parse(data.revision),
      ),
    );
  } catch (error) {
    return storageError(error);
  }
}
export async function POST(req: Request) {
  try {
    assertStorageRequest(req);
    const data = await storageJSON(req, 512 * 1024 * 1024),
      db = localDatabase();
    const action = z
      .enum(["import", "reset", "backup", "restore"])
      .parse(data.action);
    if (action === "backup")
      return storageResponse({ name: await db.createBackup() });
    const revision = revisionSchema.parse(data.revision);
    if (action === "import")
      return storageResponse(
        await db.importBundle(data.bundle, revision, data.onlyIfEmpty === true),
      );
    if (action === "restore")
      return storageResponse(
        await db.restoreBackup(z.string().max(200).parse(data.name), revision),
      );
    return storageResponse(await db.reset(revision));
  } catch (error) {
    return storageError(error);
  }
}
