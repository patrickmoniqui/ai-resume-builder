import type { WorkspaceState, StoredSource } from "./workspace-storage";
let generation: number | null = null;
export function setStorageSession(state: WorkspaceState) {
  generation = state.generation;
}
export function storageGeneration() {
  if (generation === null)
    throw new Error("The local database has not loaded yet.");
  return generation;
}
export class DatabaseRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function databaseRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new DatabaseRequestError(
      data.error || "Local database request failed.",
      res.status,
    );
  return data as T;
}
export async function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(reader.error || new Error("Could not read original file."));
    reader.readAsDataURL(blob);
  });
}
export function sourceBlob(source: StoredSource) {
  return new Blob(
    [Uint8Array.from(atob(source.data), (c) => c.charCodeAt(0))],
    { type: source.mime },
  );
}
export function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
