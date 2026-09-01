const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { uploadFiles } = require("./upload-to-ftp");

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function createUploadClient(remoteFiles) {
  return {
    ftp: {},
    async access() {},
    async pwd() { return "/"; },
    async cd() {},
    async size(remotePath) {
      const value = remoteFiles[normalize(remotePath)];
      if (value === undefined) throw new Error("550 File unavailable");
      return Buffer.byteLength(value);
    },
    async downloadTo(localPath, remotePath) {
      const value = remoteFiles[normalize(remotePath)];
      if (value === undefined) throw new Error("550 File unavailable");
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, value);
    },
    async uploadFrom(localPath, remoteName) {
      remoteFiles[normalize(remoteName)] = fs.readFileSync(localPath);
    },
    close() {},
  };
}

function makeConfig(overrides = {}) {
  return {
    host: "mock.invalid",
    port: 21,
    user: "tester",
    password: "test-only",
    remoteRoot: "/",
    secure: false,
    reconnectEvery: 0,
    maxRetries: 1,
    backupBeforeOverwrite: true,
    backupMaxFileSizeMb: 20,
    skipSameSizeAssets: true,
    ...overrides,
  };
}

test("backs up an existing remote file before overwriting it", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-upload-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const localPath = path.join(localRoot, "index.php");
  fs.writeFileSync(localPath, "new-version");
  const remoteFiles = { "index.php": Buffer.from("old-version") };

  const result = await uploadFiles(makeConfig(), [{ localPath, relativePath: "index.php", size: 11 }], {
    clientFactory: () => createUploadClient(remoteFiles),
  });
  t.after(() => result.backupRoot && fs.rmSync(result.backupRoot, { recursive: true, force: true }));

  assert.equal(result.uploaded, 1);
  assert.equal(result.backedUp, 1);
  assert.equal(fs.readFileSync(path.join(result.backupRoot, "index.php"), "utf8"), "old-version");
  assert.equal(Buffer.from(remoteFiles["index.php"]).toString("utf8"), "new-version");
});

test("does not back up or upload a same-size binary asset", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-upload-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const localPath = path.join(localRoot, "photo.jpg");
  fs.writeFileSync(localPath, "new-image");
  const remoteFiles = { "photo.jpg": Buffer.from("old-image") };

  const result = await uploadFiles(makeConfig(), [{ localPath, relativePath: "photo.jpg", size: 9 }], {
    clientFactory: () => createUploadClient(remoteFiles),
  });

  assert.equal(result.uploaded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.backedUp, 0);
  assert.equal(result.backupRoot, "");
  assert.equal(Buffer.from(remoteFiles["photo.jpg"]).toString("utf8"), "old-image");
});
