import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  LocalDatabase,
  StorageError,
  dataDirectory,
} from "../lib/local-database";
import { blankResume, initialWorkspace } from "../lib/initial";
import { parseBundle, type RecoveryBundle } from "../lib/workspace-storage";
import { assertStorageRequest, storageJSON } from "../lib/storage-http";

function fixture(): RecoveryBundle {
  return {
    format: "resume-builder-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: {
      ...initialWorkspace(),
      templates: [
        {
          id: "resume",
          name: "My resume",
          sourceFile: "original.pdf",
          source: "Uploaded file",
          docId: "t:resume",
        },
      ],
      docs: {
        "t:resume": {
          ...blankResume(),
          name: "Recovery test",
          summary: "Original content",
          pageCount: 2,
        },
      },
      jobs: [
        {
          id: "job",
          templateId: "resume",
          title: "Engineer",
          company: "Example",
          location: "Remote",
          source: "Pasted",
          rawDescription: "Build software",
          keywords: [],
        },
      ],
      notes: [{ id: "note", text: "Private note", createdAt: "2026-10-07" }],
      viewTemplateId: "resume",
      selectedJobId: "job",
      references: [
        {
          id: "reference",
          name: "notes.txt",
          type: "txt",
          size: 9,
          createdAt: "2026-10-07",
        },
      ],
    },
    preferredPages: 2,
    chats: {
      workspace: [{ role: "user", content: "Saved question" }],
      "job:job": [{ role: "assistant", content: "Saved answer" }],
    },
    settings: { instructions: "Reply in French" },
    sources: [
      {
        id: "resume",
        name: "original.pdf",
        text: "Original resume text",
        mime: "application/pdf",
        data: Buffer.from("%PDF-test").toString("base64"),
      },
      {
        id: "reference:reference",
        name: "notes.txt",
        text: "Reference",
        mime: "text/plain",
        data: Buffer.from("Reference").toString("base64"),
      },
    ],
  };
}
async function isolated(
  work: (db: LocalDatabase, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-database-test-"));
  const db = new LocalDatabase(directory);
  try {
    await work(db, directory);
  } finally {
    try {
      db.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
}

test("one-time browser migration preserves workspace, chats, preferences and original bytes across restart", async () => {
  await isolated(async (db, directory) => {
    assert.equal(db.read().initialized, false);
    const bundle = fixture();
    const state = await db.importBundle(bundle, 0, true);
    assert.equal(state.revision, 1);
    assert.equal(state.generation, 1);
    assert.deepEqual(state.workspace, bundle.workspace);
    assert.equal(state.preferredPages, 2);
    assert.deepEqual(db.readChat("job:job").messages, bundle.chats["job:job"]);
    assert.equal(db.readSettings().instructions, "Reply in French");
    assert.equal(db.readSource("resume")?.data, bundle.sources[0].data);
    await assert.rejects(
      db.importBundle(bundle, 1, true),
      (e: unknown) => e instanceof StorageError && e.status === 409,
    );
    db.close();
    const reopened = new LocalDatabase(directory);
    try {
      assert.deepEqual(reopened.read().workspace, bundle.workspace);
      assert.equal(
        reopened.readSource("reference:reference")?.data,
        bundle.sources[1].data,
      );
      assert.equal((await stat(reopened.filename)).mode & 0o777, 0o600);
    } finally {
      reopened.close();
    }
  });
});

test("two server connections reject stale workspace, chat and settings writes", async () => {
  await isolated(async (db, directory) => {
    const state = await db.importBundle(fixture(), 0);
    const other = new LocalDatabase(directory);
    try {
      const old = other.read();
      const changed = structuredClone(state.workspace);
      changed.docs["t:resume"].summary = "New content";
      await db.save(changed, 1, state.revision);
      await assert.rejects(
        other.save(old.workspace, 2, old.revision),
        (e: unknown) => e instanceof StorageError && e.status === 409,
      );
      assert.equal(
        other.read().workspace.docs["t:resume"].summary,
        "New content",
      );
      await db.saveChat(
        "workspace",
        [{ role: "user", content: "New question" }],
        1,
        state.generation,
      );
      await assert.rejects(
        other.saveChat("workspace", [], 1, state.generation),
      );
      const settings = db.readSettings();
      await db.saveSettings(
        { instructions: "English" },
        settings.revision,
        state.generation,
      );
      await assert.rejects(
        other.saveSettings(
          { instructions: "Stale" },
          settings.revision,
          state.generation,
        ),
      );
    } finally {
      other.close();
    }
  });
});

test("invalid imports roll back every record; failed loads never write an empty workspace", async () => {
  await isolated(async (db) => {
    await db.importBundle(fixture(), 0);
    const before = db.exportBundle();
    const invalid = fixture();
    invalid.chats["job:missing"] = [{ role: "user", content: "Invalid scope" }];
    await assert.rejects(db.importBundle(invalid, 1));
    assert.deepEqual(db.read().workspace, before.workspace);
    assert.equal(db.read().revision, 1);
    assert.equal(db.readSource("resume")?.data, before.sources[0].data);
    const broken = fixture();
    broken.workspace.templates[0].docId = "missing";
    await assert.rejects(db.save(broken.workspace, null, 1));
    assert.deepEqual(db.read().workspace, before.workspace);
    db.db
      .prepare("UPDATE workspace SET json = ? WHERE id = 1")
      .run("invalid json");
    assert.throws(() => db.read());
    await assert.rejects(db.save(initialWorkspace(), null, 1));
    assert.equal(
      (db.db.prepare("SELECT json FROM workspace").get() as { json: string })
        .json,
      "invalid json",
    );
    await db.importBundle(before, db.metadata().revision);
    assert.deepEqual(db.read().workspace, before.workspace);
  });
});

test("reset has a restorable snapshot and invalidates late requests from older sessions", async () => {
  await isolated(async (db) => {
    const state = await db.importBundle(fixture(), 0);
    const cleared = await db.reset(state.revision);
    assert.equal(cleared.generation, state.generation + 1);
    assert.deepEqual(cleared.workspace, initialWorkspace());
    assert.equal(db.readSource("resume"), undefined);
    assert.deepEqual(db.readChat("workspace").messages, []);
    await assert.rejects(
      db.saveChat(
        "workspace",
        [{ role: "user", content: "Late message" }],
        0,
        state.generation,
      ),
    );
    await assert.rejects(db.saveSource(fixture().sources[0], state.generation));
    const snapshots = await db.listBackups();
    const before = snapshots.find((b) => b.name.includes("_before-clear_"));
    assert.ok(before);
    await db.restoreBackup(before.name, cleared.revision);
    assert.deepEqual(db.read().workspace, fixture().workspace);
    assert.equal(db.readSource("resume")?.data, fixture().sources[0].data);
    assert.equal(
      db.readSettings().instructions,
      fixture().settings.instructions,
    );
    assert.equal(
      db.readChat("workspace").messages[0].content,
      "Saved question",
    );
    await assert.rejects(
      db.restoreBackup("../../other.sqlite", db.read().revision),
    );
  });
});

test("deleting a template removes its original atomically; pending uploads do not break snapshot restore", async () => {
  await isolated(async (db) => {
    const state = await db.importBundle(fixture(), 0);
    db.deleteUnreferencedSource("resume", state.generation);
    assert.ok(
      db.readSource("resume"),
      "file is kept until the referencing workspace is saved",
    );
    await db.saveSource(
      { ...fixture().sources[0], id: "pending-upload" },
      state.generation,
    );
    const snapshot = await db.createBackup();
    const workspace = structuredClone(state.workspace);
    workspace.templates = [];
    workspace.docs = {};
    workspace.jobs = [];
    workspace.selectedJobId = null;
    workspace.viewTemplateId = null;
    await db.save(workspace, 2, state.revision);
    assert.equal(db.readSource("resume"), undefined);
    assert.ok(db.readSource("reference:reference"));
    await db.restoreBackup(snapshot, db.read().revision);
    assert.ok(db.readSource("resume"));
    assert.equal(db.readSource("pending-upload"), undefined);
    assert.equal(
      (await db.listBackups()).filter((b) => b.name.includes("_daily_")).length,
      1,
    );
  });
});

test("exports exclude credential-like extra properties and blank templates don't report missing originals", () => {
  const bundle = fixture() as RecoveryBundle & { apiKey?: string };
  bundle.apiKey = "do-not-export";
  bundle.sources = [];
  bundle.workspace.templates[0].sourceFile = "Untitled_Resume";
  assert.equal((parseBundle(bundle) as typeof bundle).apiKey, undefined);
  assert.deepEqual(parseBundle(bundle).missingSources, ["reference:reference"]);
});

test("storage routes accept only loopback and same-origin writes; streamed requests are bounded", async () => {
  const make = (url: string, origin: string) =>
    new Request(url, {
      method: "POST",
      headers: { host: new URL(url).host, origin },
      body: "{}",
    });
  assert.doesNotThrow(() =>
    assertStorageRequest(
      make("http://127.0.0.1:3001/api/storage", "http://127.0.0.1:3001"),
    ),
  );
  // NextRequest canonicalizes loopback URLs, but Host retains the browser address.
  assert.doesNotThrow(() =>
    assertStorageRequest(
      new Request("http://localhost:3001/api/storage", {
        method: "PUT",
        headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" },
        body: "{}",
      }),
    ),
  );
  assert.throws(() =>
    assertStorageRequest(
      make("http://127.0.0.1:3001/api/storage", "https://attacker.example"),
    ),
  );
  assert.throws(() =>
    assertStorageRequest(
      make("http://example.com/api/storage", "http://example.com"),
    ),
  );
  await assert.rejects(
    storageJSON(
      make("http://localhost:3001/api/storage", "http://localhost:3001"),
      1,
    ),
  );
  assert.throws(() => dataDirectory({ RESUME_BUILDER_DATA_DIR: "relative" }));
});
