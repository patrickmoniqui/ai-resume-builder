import {
  blobToBase64,
  databaseRequest,
  sourceBlob,
  storageGeneration,
} from "./database-client";
import type { StoredSource } from "./workspace-storage";
export type ResumeSource = { file: Blob; name: string; text: string };
export async function saveResumeSource(id: string, source: ResumeSource) {
  await databaseRequest("/api/storage/sources", "PUT", {
    generation: storageGeneration(),
    source: {
      id,
      name: source.name,
      text: source.text,
      mime: source.file.type,
      data: await blobToBase64(source.file),
    },
  });
}
export async function getResumeSource(
  id: string,
): Promise<ResumeSource | undefined> {
  const { source } = await databaseRequest<{ source: StoredSource | null }>(
    `/api/storage/sources?id=${encodeURIComponent(id)}`,
  );
  return source
    ? { name: source.name, text: source.text, file: sourceBlob(source) }
    : undefined;
}
export async function deleteResumeSource(id: string) {
  await databaseRequest("/api/storage/sources", "DELETE", {
    id,
    generation: storageGeneration(),
  });
}
