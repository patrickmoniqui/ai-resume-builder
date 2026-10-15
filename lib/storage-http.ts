import { StorageError } from "./local-database";
import { ZodError } from "zod";

export function assertStorageRequest(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  const hostURL = host ? new URL(`${url.protocol}//${host}`) : null;
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  // NextRequest normalizes loopback URLs to localhost. Use the validated Host
  // header for the browser origin while still rejecting non-loopback requests.
  if (
    !loopback.includes(url.hostname) ||
    !hostURL ||
    !loopback.includes(hostURL.hostname) ||
    hostURL.host !== host
  )
    throw new StorageError(
      "Local database access is available only on localhost.",
      403,
    );
  const site = req.headers.get("sec-fetch-site");
  if (
    (site && site !== "same-origin" && site !== "none") ||
    (req.method !== "GET" && req.headers.get("origin") !== hostURL.origin)
  )
    throw new StorageError(
      "Open this app directly to access its local database.",
      403,
    );
}
export async function storageJSON(req: Request, maxBytes = 30 * 1024 * 1024) {
  if (Number(req.headers.get("content-length")) > maxBytes)
    throw new StorageError("Storage request is too large.", 413);
  // Bound streamed bodies too, even when Content-Length is absent.
  const reader = req.body?.getReader();
  if (!reader) throw new StorageError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new StorageError("Storage request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function storageResponse(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
export function storageError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ZodError
          ? "Saved data failed validation. Existing data has been preserved."
          : error instanceof Error
            ? error.message
            : "Local storage is unavailable.",
    },
    {
      status:
        error instanceof StorageError
          ? error.status
          : error instanceof ZodError || error instanceof SyntaxError
            ? 400
            : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
