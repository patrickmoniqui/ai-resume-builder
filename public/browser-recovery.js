// Read-only recovery tool. Runs in the original browser origin; never sends data to a server.
(() => {
  "use strict";
  const rootId = "resume-browser-recovery";
  if (document.querySelector("[data-resume-recovery-overlay]")) return;
  let root = document.getElementById(rootId);
  if (!root) {
    const overlay = document.createElement("div");
    overlay.dataset.resumeRecoveryOverlay = "true";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:#0008;display:grid;place-items:center;padding:20px;";
    root = document.createElement("section");
    root.id = rootId;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Recover browser resumes");
    root.style.cssText =
      "font:16px/1.6 system-ui,sans-serif;background:white;color:#27272a;padding:24px;max-width:680px;max-height:85vh;overflow:auto;border-radius:12px;";
    root.innerHTML =
      '<h1>Recover browser resumes</h1><p>This tool reads old Resume Builder data at <code data-recovery-origin></code>. It never changes or deletes browser data and does not contact the database.</p><p>Download a backup, then import it using <strong>Backup &amp; recovery</strong> in the updated Resume Builder.</p><button data-recovery-export>Download browser backup</button> <button data-recovery-raw>Download raw recovery data</button><p data-recovery-status role="status"></p><button data-recovery-close>Close recovery tool</button>';
    overlay.appendChild(root);
    document.body.appendChild(overlay);
    root.querySelector("[data-recovery-close]").onclick = () =>
      overlay.remove();
  }
  root.querySelector("[data-recovery-origin]").textContent = location.origin;
  const status = root.querySelector("[data-recovery-status]");
  const buttons = [
    ...root.querySelectorAll("[data-recovery-export], [data-recovery-raw]"),
  ];
  function download(value, name) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function files() {
    if (
      !(await indexedDB.databases()).some(
        (db) => db.name === "resume-builder.sources.v1",
      )
    )
      return [];
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("resume-builder.sources.v1");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction("sources", "readonly"),
          store = tx.objectStore("sources");
        const keys = store.getAllKeys(),
          values = store.getAll();
        tx.oncomplete = () =>
          resolve(
            keys.result.map((id, i) => ({
              id: String(id),
              ...values.result[i],
            })),
          );
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return await Promise.all(
        entries.map(async (s) => ({
          id: s.id,
          name: s.name,
          text: s.text,
          mime: s.file.type,
          data: await base64(s.file),
        })),
      );
    } finally {
      db.close();
    }
  }
  async function run(raw) {
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = "Reading saved browser data…";
    try {
      const stored = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key.startsWith("resume-builder.") &&
          key !== "resume-builder.ai-connection.v1"
        )
          stored[key] = localStorage.getItem(key);
      }
      if (!stored["resume-builder.workspace.v1"])
        throw new Error(
          "No old workspace was found at this address. Try the original hostname and port, in the original browser.",
        );
      const sources = await files();
      if (raw) {
        download(
          {
            format: "resume-builder-raw-recovery",
            version: 1,
            origin: location.origin,
            localStorage: stored,
            sources,
          },
          "resume-builder-raw-recovery.json",
        );
        status.textContent =
          "Raw recovery data downloaded. Browser data is unchanged.";
        return;
      }
      const workspace = JSON.parse(stored["resume-builder.workspace.v1"]);
      const ids = new Set([
        ...workspace.templates.map((t) => t.id),
        ...(workspace.references || []).map((r) => "reference:" + r.id),
      ]);
      const attached = sources.filter((s) => ids.has(s.id)),
        pages = stored["resume-builder.page-count.v1"];
      download(
        {
          format: "resume-builder-backup",
          version: 1,
          origin: location.origin,
          exportedAt: new Date().toISOString(),
          workspace,
          preferredPages: pages === "1" || pages === "2" ? Number(pages) : null,
          chats: JSON.parse(stored["resume-builder.chat-history.v1"] || "{}"),
          settings: {
            instructions: stored["resume-builder.chat-instructions.v1"] || "",
          },
          sources: attached,
          missingSources: [...ids].filter(
            (id) => !attached.some((s) => s.id === id),
          ),
        },
        "resume-builder-browser-backup.json",
      );
      status.textContent = `Backup downloaded: ${workspace.templates.length} templates, ${Object.keys(workspace.docs).length} resume documents, ${workspace.jobs.length} jobs, ${attached.length} original files. Browser data is unchanged.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  root.querySelector("[data-recovery-export]").onclick = () => run(false);
  root.querySelector("[data-recovery-raw]").onclick = () => run(true);
})();
