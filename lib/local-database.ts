// Server-only: never import this module from client components.
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { readdir, stat, unlink, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initialWorkspace } from "./initial";
import {
  parseWorkspace,
  parseBundle,
  sourceIds,
  historySchema,
  chatScopeSchema,
  settingsSchema,
  pagePreferenceSchema,
  type RecoveryBundle,
  type StoredSource,
  type WorkspaceState,
} from "./workspace-storage";

export class StorageError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function dataDirectory(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.RESUME_BUILDER_DATA_DIR) {
    if (!path.isAbsolute(env.RESUME_BUILDER_DATA_DIR))
      throw new StorageError(
        "RESUME_BUILDER_DATA_DIR must be an absolute path.",
      );
    return env.RESUME_BUILDER_DATA_DIR;
  }
  return process.platform === "darwin"
    ? path.join(homedir(), "Library", "Application Support", "ResumeBuilder")
    : path.join(
        env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"),
        "ResumeBuilder",
      );
}

type StateRow = {
  json: string;
  revision: number;
  generation: number;
  initialized: number;
};
export class LocalDatabase {
  readonly db: DatabaseSync;
  readonly filename: string;
  readonly backupDirectory: string;
  private dailyBackup: Promise<void> | undefined;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.filename = path.join(directory, "resume-builder.sqlite");
    this.backupDirectory = path.join(directory, "backups");
    this.db = new DatabaseSync(this.filename, { timeout: 5000 });
    chmodSync(this.filename, 0o600);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 1) {
      this.db.close();
      throw new StorageError(
        "This database requires a newer version of Resume Builder.",
        503,
      );
    }
    if (version === 0) {
      this.transaction(() => {
        if (
          (
            this.db.prepare("PRAGMA user_version").get() as {
              user_version: number;
            }
          ).user_version === 1
        )
          return;
        this.db.exec(`
          CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL,
            revision INTEGER NOT NULL, generation INTEGER NOT NULL, initialized INTEGER NOT NULL);
          CREATE TABLE chats (scope TEXT PRIMARY KEY, json TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL);
          PRAGMA user_version = 1;
        `);
        this.db.prepare("INSERT INTO workspace VALUES (1, ?, 0, 0, 0)").run(
          JSON.stringify({
            workspace: initialWorkspace(),
            preferredPages: null,
          }),
        );
        this.db
          .prepare("INSERT INTO settings VALUES (1, ?, 0)")
          .run(JSON.stringify({ instructions: "" }));
      });
    }
  }
  close() {
    this.db.close();
  }
  metadata() {
    const row = this.db
      .prepare(
        "SELECT revision, generation, initialized FROM workspace WHERE id = 1",
      )
      .get() as
      { revision: number; generation: number; initialized: number } | undefined;
    if (!row) throw new StorageError("Database metadata is unavailable.", 503);
    return { ...row, initialized: !!row.initialized };
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  read(): WorkspaceState {
    const row = this.db
      .prepare("SELECT * FROM workspace WHERE id = 1")
      .get() as StateRow | undefined;
    if (!row)
      throw new StorageError(
        "Saved workspace is unavailable. Restore a backup; no changes have been written.",
        503,
      );
    const value = JSON.parse(row.json);
    return {
      workspace: parseWorkspace(value.workspace),
      preferredPages: pagePreferenceSchema.parse(value.preferredPages),
      revision: row.revision,
      generation: row.generation,
      initialized: !!row.initialized,
    };
  }
  private checkRevision(revision: number) {
    if (this.metadata().revision !== revision)
      throw new StorageError(
        "Another tab changed this workspace. Download your unsaved work before reloading.",
        409,
      );
  }
  checkGeneration(generation: number) {
    if (this.metadata().generation !== generation)
      throw new StorageError(
        "This workspace was restored or cleared in another tab. Reload before making changes.",
        409,
      );
  }
  async save(
    value: unknown,
    preferredPages: unknown,
    revision: number,
  ): Promise<WorkspaceState> {
    const workspace = parseWorkspace(value),
      pages = pagePreferenceSchema.parse(preferredPages);
    this.checkRevision(revision);
    await this.ensureDailyBackup();
    const state = this.transaction(() => {
      this.checkRevision(revision);
      const previous = this.read();
      const keep = new Set(sourceIds(workspace));
      for (const id of sourceIds(previous.workspace)) {
        if (!keep.has(id))
          this.db.prepare("DELETE FROM sources WHERE id = ?").run(id);
      }
      const jobScopes = new Set(workspace.jobs.map((j) => `job:${j.id}`));
      for (const row of this.db.prepare("SELECT scope FROM chats").all() as {
        scope: string;
      }[]) {
        if (row.scope !== "workspace" && !jobScopes.has(row.scope))
          this.db.prepare("DELETE FROM chats WHERE scope = ?").run(row.scope);
      }
      this.db
        .prepare(
          "UPDATE workspace SET json = ?, revision = revision + 1, initialized = 1 WHERE id = 1",
        )
        .run(JSON.stringify({ workspace, preferredPages: pages }));
      return this.read();
    });
    // The first populated workspace also gets a recovery snapshot.
    let backupWarning: string | undefined;
    try {
      await this.ensureDailyBackup();
    } catch {
      backupWarning =
        "Workspace saved, but the automatic backup failed. Download a backup and check available disk space.";
    }
    return { ...state, ...(backupWarning ? { backupWarning } : {}) };
  }
  readChat(scope: string) {
    chatScopeSchema.parse(scope);
    const row = this.db
      .prepare("SELECT json, revision FROM chats WHERE scope = ?")
      .get(scope) as { json: string; revision: number } | undefined;
    return {
      messages: row ? historySchema.parse(JSON.parse(row.json)) : [],
      revision: row?.revision || 0,
    };
  }
  async saveChat(
    scope: string,
    value: unknown,
    revision: number,
    generation: number,
  ) {
    chatScopeSchema.parse(scope);
    const messages = historySchema.parse(value);
    this.checkGeneration(generation);
    await this.ensureDailyBackup();
    return this.transaction(() => {
      this.checkGeneration(generation);
      if (
        scope !== "workspace" &&
        !this.read().workspace.jobs.some((j) => `job:${j.id}` === scope)
      )
        throw new StorageError("Save this job before starting its chat.", 409);
      if (this.readChat(scope).revision !== revision)
        throw new StorageError(
          "This chat changed in another tab. Reload to continue.",
          409,
        );
      this.db
        .prepare(
          "INSERT INTO chats VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET json = excluded.json, revision = excluded.revision",
        )
        .run(scope, JSON.stringify(messages), revision + 1);
      return { revision: revision + 1 };
    });
  }
  readSettings() {
    const row = this.db
      .prepare("SELECT json, revision FROM settings WHERE id = 1")
      .get() as { json: string; revision: number };
    return {
      ...settingsSchema.parse(JSON.parse(row.json)),
      revision: row.revision,
    };
  }
  async saveSettings(value: unknown, revision: number, generation: number) {
    const settings = settingsSchema.parse(value);
    this.checkGeneration(generation);
    await this.ensureDailyBackup();
    return this.transaction(() => {
      this.checkGeneration(generation);
      if (this.readSettings().revision !== revision)
        throw new StorageError(
          "Instructions changed in another tab. Reload to continue.",
          409,
        );
      this.db
        .prepare(
          "UPDATE settings SET json = ?, revision = revision + 1 WHERE id = 1",
        )
        .run(JSON.stringify(settings));
      return { revision: revision + 1 };
    });
  }
  readSource(id: string): StoredSource | undefined {
    const row = this.db
      .prepare("SELECT * FROM sources WHERE id = ?")
      .get(id) as
      | {
          id: string;
          name: string;
          text: string;
          mime: string;
          data: Uint8Array;
        }
      | undefined;
    return row
      ? { ...row, data: Buffer.from(row.data).toString("base64") }
      : undefined;
  }
  private writeSource(source: StoredSource) {
    const bytes = Buffer.from(source.data, "base64");
    if (bytes.length > 10 * 1024 * 1024)
      throw new StorageError("Original files must be at most 10 MB.");
    this.db
      .prepare(
        "INSERT INTO sources VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, text=excluded.text, mime=excluded.mime, data=excluded.data",
      )
      .run(source.id, source.name, source.text, source.mime, bytes);
  }
  async saveSource(source: StoredSource, generation: number) {
    this.checkGeneration(generation);
    await this.ensureDailyBackup();
    this.transaction(() => {
      this.checkGeneration(generation);
      const existing = this.readSource(source.id);
      if (
        existing &&
        (existing.name !== source.name ||
          existing.text !== source.text ||
          existing.mime !== source.mime ||
          existing.data !== source.data)
      )
        throw new StorageError(
          "This original file is already saved. Import it as a new document instead of overwriting it.",
          409,
        );
      this.writeSource(source);
    });
  }
  deleteUnreferencedSource(id: string, generation: number) {
    this.transaction(() => {
      this.checkGeneration(generation);
      // Referenced files are removed atomically with the workspace update.
      if (!sourceIds(this.read().workspace).includes(id))
        this.db.prepare("DELETE FROM sources WHERE id = ?").run(id);
    });
  }
  exportBundle(): RecoveryBundle {
    return this.transaction(() => {
      const state = this.read();
      const ids = sourceIds(state.workspace);
      const sources = ids.flatMap((id) => {
        const source = this.readSource(id);
        return source ? [source] : [];
      });
      const chats = Object.fromEntries(
        (
          this.db.prepare("SELECT scope FROM chats").all() as {
            scope: string;
          }[]
        ).map(({ scope }) => [scope, this.readChat(scope).messages]),
      );
      return {
        format: "resume-builder-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        workspace: state.workspace,
        preferredPages: state.preferredPages,
        chats,
        settings: { instructions: this.readSettings().instructions },
        sources,
        missingSources: ids.filter((id) => !sources.some((s) => s.id === id)),
      };
    });
  }
  async importBundle(value: unknown, revision: number, onlyIfEmpty = false) {
    const bundle = parseBundle(value);
    // Decode and validate all files before touching existing records.
    if (
      bundle.sources.some(
        (s) => Buffer.from(s.data, "base64").length > 10 * 1024 * 1024,
      )
    )
      throw new StorageError("A backup file exceeds 10 MB.");
    this.checkRevision(revision);
    if (onlyIfEmpty && this.metadata().initialized)
      throw new StorageError(
        "A saved database already exists. Use Backup & recovery to import browser data.",
        409,
      );
    if (this.metadata().initialized) await this.createBackup("before-import");
    const state = this.transaction(() => {
      this.checkRevision(revision);
      if (onlyIfEmpty && this.metadata().initialized)
        throw new StorageError("A saved database already exists.", 409);
      this.db.exec("DELETE FROM sources; DELETE FROM chats;");
      for (const source of bundle.sources) this.writeSource(source);
      const scopes = new Set([
        "workspace",
        ...bundle.workspace.jobs.map((j) => `job:${j.id}`),
      ]);
      for (const [scope, messages] of Object.entries(bundle.chats)) {
        if (!scopes.has(scope))
          throw new StorageError("Backup contains a chat for an unknown job.");
        this.db
          .prepare("INSERT INTO chats VALUES (?, ?, 1)")
          .run(scope, JSON.stringify(messages));
      }
      this.db
        .prepare(
          "UPDATE settings SET json = ?, revision = revision + 1 WHERE id = 1",
        )
        .run(JSON.stringify(bundle.settings));
      this.db
        .prepare(
          "UPDATE workspace SET json = ?, revision = revision + 1, generation = generation + 1, initialized = 1 WHERE id = 1",
        )
        .run(
          JSON.stringify({
            workspace: bundle.workspace,
            preferredPages: bundle.preferredPages,
          }),
        );
      return this.read();
    });
    try {
      await this.ensureDailyBackup();
    } catch {
      /* Original bundle is still available for recovery. */
    }
    return state;
  }
  async reset(revision: number) {
    this.checkRevision(revision);
    if (this.read().initialized) await this.createBackup("before-clear");
    return this.transaction(() => {
      this.checkRevision(revision);
      this.db.exec("DELETE FROM sources; DELETE FROM chats;");
      this.db
        .prepare(
          "UPDATE workspace SET json = ?, revision = revision + 1, generation = generation + 1, initialized = 1 WHERE id = 1",
        )
        .run(
          JSON.stringify({
            workspace: initialWorkspace(),
            preferredPages: this.read().preferredPages,
          }),
        );
      return this.read();
    });
  }
  async createBackup(
    reason: "daily" | "manual" | "before-import" | "before-clear" = "manual",
  ) {
    mkdirSync(this.backupDirectory, { recursive: true, mode: 0o700 });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}_${reason}_${randomUUID()}.sqlite`;
    const destination = path.join(this.backupDirectory, name);
    await backup(this.db, destination);
    await chmod(destination, 0o600);
    return name;
  }
  private async ensureDailyBackup() {
    if (!this.read().initialized) return;
    if (this.dailyBackup) return this.dailyBackup;
    this.dailyBackup = (async () => {
      const day = new Date().toISOString().slice(0, 10);
      const backups = await this.listBackups();
      if (
        !backups.some(
          (b) => b.name.startsWith(day) && b.name.includes("_daily_"),
        )
      )
        await this.createBackup("daily");
      const daily = (await this.listBackups()).filter((b) =>
        b.name.includes("_daily_"),
      );
      for (const item of daily.slice(14))
        await unlink(path.join(this.backupDirectory, item.name));
    })();
    try {
      await this.dailyBackup;
    } finally {
      this.dailyBackup = undefined;
    }
  }
  async listBackups() {
    if (!existsSync(this.backupDirectory)) return [];
    const names = (await readdir(this.backupDirectory)).filter((name) =>
      /^[0-9TZ_-]+_(daily|manual|before-import|before-clear)_[a-f0-9-]+\.sqlite$/.test(
        name,
      ),
    );
    const records = await Promise.all(
      names.map(async (name) => ({
        name,
        createdAt: (
          await stat(path.join(this.backupDirectory, name))
        ).mtime.toISOString(),
      })),
    );
    return records.sort((a, b) => b.name.localeCompare(a.name));
  }
  async restoreBackup(name: string, revision: number) {
    if (!(await this.listBackups()).some((b) => b.name === name))
      throw new StorageError("Backup not found.", 404);
    const db = new DatabaseSync(path.join(this.backupDirectory, name), {
      readOnly: true,
    });
    let bundle: RecoveryBundle;
    try {
      if (
        (
          db.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
          }
        ).integrity_check !== "ok"
      )
        throw new StorageError("This backup failed its integrity check.");
      const state = JSON.parse(
        (
          db.prepare("SELECT json FROM workspace WHERE id = 1").get() as {
            json: string;
          }
        ).json,
      );
      const allowed = new Set(sourceIds(parseWorkspace(state.workspace)));
      const sources = (
        db.prepare("SELECT * FROM sources").all() as {
          id: string;
          name: string;
          text: string;
          mime: string;
          data: Uint8Array;
        }[]
      )
        .filter((source) => allowed.has(source.id))
        .map((source) => ({
          ...source,
          data: Buffer.from(source.data).toString("base64"),
        }));
      bundle = parseBundle({
        format: "resume-builder-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        ...state,
        sources,
        settings: JSON.parse(
          (
            db.prepare("SELECT json FROM settings WHERE id = 1").get() as {
              json: string;
            }
          ).json,
        ),
        chats: Object.fromEntries(
          (
            db.prepare("SELECT scope, json FROM chats").all() as {
              scope: string;
              json: string;
            }[]
          ).map((r) => [r.scope, JSON.parse(r.json)]),
        ),
      });
    } finally {
      db.close();
    }
    return this.importBundle(bundle!, revision);
  }
}

const globals = globalThis as typeof globalThis & {
  resumeDatabase?: LocalDatabase;
};
export function localDatabase() {
  const directory = dataDirectory();
  if (
    !globals.resumeDatabase ||
    globals.resumeDatabase.directory !== directory
  ) {
    globals.resumeDatabase?.close();
    globals.resumeDatabase = new LocalDatabase(directory);
  }
  return globals.resumeDatabase;
}
