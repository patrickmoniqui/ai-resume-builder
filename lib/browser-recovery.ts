import { migrateWorkspace, initialWorkspace } from "./initial";
import { CHAT_HISTORY_STORAGE } from "./chat-history";
import {
  WORKSPACE_STORAGE,
  PAGE_STORAGE,
  INSTRUCTIONS_STORAGE,
  parseWorkspace,
  parseBundle,
  sourceIds,
  type RecoveryBundle,
} from "./workspace-storage";
import { blobToBase64 } from "./database-client";

export function hasBrowserWorkspace() {
  try {
    return !!localStorage.getItem(WORKSPACE_STORAGE);
  } catch {
    return false;
  }
}
// Only this recovery module accesses the old IndexedDB. It never modifies it.
async function browserSources() {
  if (
    !(await indexedDB.databases()).some(
      (db) => db.name === "resume-builder.sources.v1",
    )
  )
    return new Map<string, { name: string; text: string; file: Blob }>();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("resume-builder.sources.v1");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains("sources"))
      throw new Error(
        "Original browser file storage is unreadable. Browser data has been preserved.",
      );
    return await new Promise<
      Map<string, { name: string; text: string; file: Blob }>
    >((resolve, reject) => {
      const transaction = db.transaction("sources", "readonly"),
        store = transaction.objectStore("sources");
      const keys = store.getAllKeys(),
        values = store.getAll();
      transaction.oncomplete = () =>
        resolve(
          new Map(keys.result.map((key, i) => [String(key), values.result[i]])),
        );
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function collectBrowserRecovery(): Promise<RecoveryBundle> {
  const raw = localStorage.getItem(WORKSPACE_STORAGE);
  const workspace = raw
    ? migrateWorkspace(parseWorkspace(JSON.parse(raw)))
    : initialWorkspace();
  const oldFiles = await browserSources();
  const sources = [],
    missingSources = [];
  for (const id of sourceIds(workspace)) {
    const source = oldFiles.get(id);
    if (source)
      sources.push({
        id,
        name: source.name,
        text: source.text,
        mime: source.file.type,
        data: await blobToBase64(source.file),
      });
    else missingSources.push(id);
  }
  const pages = localStorage.getItem(PAGE_STORAGE);
  return parseBundle({
    format: "resume-builder-backup",
    version: 1,
    origin: location.origin,
    exportedAt: new Date().toISOString(),
    workspace,
    preferredPages: pages === "1" || pages === "2" ? Number(pages) : null,
    chats: JSON.parse(localStorage.getItem(CHAT_HISTORY_STORAGE) || "{}"),
    settings: {
      instructions: localStorage.getItem(INSTRUCTIONS_STORAGE) || "",
    },
    sources,
    missingSources,
  });
}
