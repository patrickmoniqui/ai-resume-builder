export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
};
type TokenClient = {
  requestAccessToken: (options: { prompt: string }) => void;
};
type GoogleWindow = Window & {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (options: {
          client_id: string;
          scope: string;
          callback: (response: {
            access_token?: string;
            error?: string;
          }) => void;
          error_callback: () => void;
        }) => TokenClient;
      };
    };
  };
};
let loader: Promise<void> | undefined;
function loadGoogle() {
  if ((window as GoogleWindow).google) return Promise.resolve();
  if (!loader)
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loader = undefined;
        reject(
          new Error("Google sign-in could not load. Check your connection."),
        );
      };
      document.head.appendChild(s);
    });
  return loader;
}
export async function connectDrive() {
  await loadGoogle();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId)
    throw new Error(
      "Google Drive is not configured. Upload a downloaded file instead.",
    );
  const token = await new Promise<string>((resolve, reject) => {
    const client = (
      window as GoogleWindow
    ).google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (r) =>
        r.access_token
          ? resolve(r.access_token)
          : reject(new Error(r.error || "Google access was not granted.")),
      error_callback: () =>
        reject(new Error("Google sign-in was closed. Try again.")),
    });
    client.requestAccessToken({ prompt: "consent" });
  });
  const query =
    "trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType = 'application/vnd.google-apps.document')";
  let files: DriveFile[] = [];
  let next = "";
  do {
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      pageSize: "100",
      orderBy: "modifiedTime desc",
      ...(next ? { pageToken: next } : {}),
    });
    const res = await fetch(
      "https://www.googleapis.com/drive/v3/files?" + params,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!res.ok)
      throw new Error(
        "Could not read Drive files. Check your Google Drive API configuration.",
      );
    const data = await res.json();
    files = [...files, ...data.files];
    next = data.nextPageToken || "";
  } while (next && files.length < 500);
  return { token, files };
}
export async function downloadDriveFile(file: DriveFile, token: string) {
  if (Number(file.size) > 10 * 1024 * 1024)
    throw new Error("Choose a file under 10 MB.");
  const googleDoc = file.mimeType === "application/vnd.google-apps.document";
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}` +
    (googleDoc
      ? "/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document"
      : "?alt=media");
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok)
    throw new Error(
      "Could not download this file. Reconnect Google Drive and try again.",
    );
  return new File(
    [await res.blob()],
    googleDoc ? file.name + ".docx" : file.name,
    {
      type: googleDoc
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : file.mimeType,
    },
  );
}
