const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildBaseline,
  createLocalHardeningFiles,
  scanRemoteSite,
} = require("./security-monitor");

const FIXED_DATE = new Date("2026-08-26T00:00:00.000Z");

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/$/, "");
}

function createFakeClient(remoteFiles, hooks = {}) {
  return {
    ftp: {},
    async access() {},
    async pwd() { return "/"; },
    async cd() {},
    async list(relativeDir) {
      const dir = normalize(relativeDir === "." ? "" : relativeDir);
      const prefix = dir ? `${dir}/` : "";
      const children = new Map();

      for (const [filePath, value] of Object.entries(remoteFiles)) {
        const normalizedPath = normalize(filePath);
        if (!normalizedPath.startsWith(prefix)) continue;
        const remainder = normalizedPath.slice(prefix.length);
        if (!remainder) continue;
        const slashIndex = remainder.indexOf("/");
        if (slashIndex >= 0) {
          const name = remainder.slice(0, slashIndex);
          children.set(name, { name, type: 2, size: 0, modifiedAt: FIXED_DATE });
        } else {
          const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
          children.set(remainder, { name: remainder, type: 1, size: buffer.length, modifiedAt: FIXED_DATE });
        }
      }

      return [...children.values()];
    },
    async downloadTo(localPath, remotePath) {
      const value = remoteFiles[normalize(remotePath)];
      if (value === undefined) throw new Error(`Missing fake FTP file: ${remotePath}`);
      hooks.onDownload?.(normalize(remotePath));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    },
    close() {},
  };
}

function makeConfig(localRoot) {
  return {
    host: "mock.invalid",
    port: 21,
    user: "tester",
    password: "test-only",
    remoteRoot: "/",
    localRoot,
    securityMaxFileSizeKb: 256,
    securityMaxFiles: 1000,
  };
}

test("detects a disguised executable in an upload directory", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = {
    "uploads/banner.jpg.php": "<?php eval(base64_decode($_POST['payload']));",
  };

  const result = await scanRemoteSite(makeConfig(localRoot), {
    baseline: null,
    clientFactory: () => createFakeClient(remoteFiles),
  });

  assert.ok(result.summary.high >= 1);
  assert.ok(result.findings.some((item) => item.category === "dangerous-path"));
  assert.ok(result.findings.some((item) => item.category === "executable-in-upload"));
  assert.ok(result.findings.some((item) => item.category === "content-signature"));
});

test("detects files added or modified after a trusted baseline", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(localRoot, "index.php"), "<?php echo 'clean';");
  const config = makeConfig(localRoot);
  const originalFiles = { "index.php": "<?php echo 'clean';" };
  const original = await scanRemoteSite(config, {
    baseline: null,
    clientFactory: () => createFakeClient(originalFiles),
  });
  const baseline = buildBaseline(original);
  const changedFiles = {
    "index.php": "<?php echo 'changed';",
    "uploads/cache.php": "<?php system($_REQUEST['cmd']);",
  };

  const changed = await scanRemoteSite(config, {
    baseline,
    clientFactory: () => createFakeClient(changedFiles),
  });

  assert.equal(changed.summary.newFiles, 1);
  assert.equal(changed.summary.modifiedFiles, 1);
  assert.ok(changed.findings.some((item) => item.category === "new-file" && item.path === "uploads/cache.php"));
  assert.ok(changed.findings.some((item) => item.category === "modified-file" && item.path === "index.php"));
});

test("incremental scan skips unchanged files while full review detects timestamp-spoofed content", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const config = makeConfig(localRoot);
  const originalFiles = { "index.php": "<?php echo 'clean';" };
  fs.writeFileSync(path.join(localRoot, "index.php"), originalFiles["index.php"]);
  const original = await scanRemoteSite(config, {
    baseline: null,
    scanType: "full",
    clientFactory: () => createFakeClient(originalFiles),
  });
  const baseline = buildBaseline(original);
  let incrementalDownloads = 0;
  const unchanged = await scanRemoteSite(config, {
    baseline,
    scanType: "incremental",
    clientFactory: () => createFakeClient(originalFiles, { onDownload: () => { incrementalDownloads += 1; } }),
  });

  assert.equal(incrementalDownloads, 0);
  assert.equal(unchanged.summary.contentScanned, 0);
  assert.equal(unchanged.summary.skippedUnchanged, 1);

  const spoofedFiles = { "index.php": "<?php echo 'pwned';" };
  const incremental = await scanRemoteSite(config, {
    baseline,
    scanType: "incremental",
    clientFactory: () => createFakeClient(spoofedFiles),
  });
  assert.equal(incremental.summary.modifiedFiles, 0);

  const fullReview = await scanRemoteSite(config, {
    baseline,
    scanType: "full",
    clientFactory: () => createFakeClient(spoofedFiles),
  });
  assert.equal(fullReview.summary.modifiedFiles, 1);
  assert.ok(fullReview.findings.some((item) => item.category === "modified-file" && item.path === "index.php"));
});

test("detects PHP code embedded in a static image file", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = {
    "static/gallery/photo.jpg": Buffer.from("JFIF....<?php echo $_GET['x']; ?>"),
  };

  const result = await scanRemoteSite(makeConfig(localRoot), {
    baseline: null,
    clientFactory: () => createFakeClient(remoteFiles),
  });

  assert.ok(result.findings.some((item) => item.category === "content-signature" && item.path.endsWith("photo.jpg")));
});

test("does not treat normal application cache and runtime PHP as upload-directory scripts", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = {
    "core/cache/Builder.php": "<?php class Builder {}",
    "runtime/complile/0123456789abcdef.php": "<?php echo 'compiled template';",
  };
  for (const [relativePath, content] of Object.entries(remoteFiles)) {
    const target = path.join(localRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  const result = await scanRemoteSite(makeConfig(localRoot), {
    baseline: null,
    clientFactory: () => createFakeClient(remoteFiles),
  });

  assert.equal(result.findings.filter((item) => item.category === "executable-in-upload").length, 0);
});

test("creates upload-directory guards without overwriting existing rules", (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(localRoot, "static"), { recursive: true });
  fs.mkdirSync(path.join(localRoot, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(localRoot, "uploads", ".htaccess"), "custom-rule");

  const result = createLocalHardeningFiles({ localRoot, imageDirs: ["static", "uploads"] });

  assert.ok(result.created.includes("static/.htaccess"));
  assert.ok(result.created.includes("static/web.config"));
  assert.ok(result.created.includes("uploads/web.config"));
  assert.ok(result.skipped.some((item) => item.path === "uploads/.htaccess"));
  assert.equal(fs.readFileSync(path.join(localRoot, "uploads", ".htaccess"), "utf8"), "custom-rule");
});

test("stops a read-only scan when cancellation is requested", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = { "index.php": "<?php echo 'clean';" };

  await assert.rejects(
    scanRemoteSite(makeConfig(localRoot), {
      baseline: null,
      clientFactory: () => createFakeClient(remoteFiles),
      shouldCancel: () => true,
    }),
    (error) => error.code === "SCAN_CANCELLED",
  );
});

test("reconnects and resumes when a directory listing times out once", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = { "index.php": "<?php echo 'clean';" };
  const config = {
    ...makeConfig(localRoot),
    securityMaxRetries: 2,
    securityReconnectEvery: 0,
    securityRetryDelayMs: 0,
  };
  let clients = 0;
  const retries = [];

  const result = await scanRemoteSite(config, {
    baseline: null,
    clientFactory: () => {
      clients += 1;
      const client = createFakeClient(remoteFiles);
      if (clients === 1) client.list = async () => { throw new Error("Timeout (control socket)"); };
      return client;
    },
    onRetry: (event) => retries.push(event),
  });

  assert.equal(result.summary.files, 1);
  assert.equal(clients, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].stage, "listing");
});

test("reconnects and retries a file download after a data timeout", async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ftp-security-local-"));
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }));
  const remoteFiles = { "uploads/banner.jpg.php": "<?php eval(base64_decode($_POST['payload']));" };
  const config = {
    ...makeConfig(localRoot),
    securityMaxRetries: 2,
    securityReconnectEvery: 0,
    securityRetryDelayMs: 0,
  };
  let clients = 0;
  const retries = [];

  const result = await scanRemoteSite(config, {
    baseline: null,
    clientFactory: () => {
      clients += 1;
      const client = createFakeClient(remoteFiles);
      if (clients === 1) client.downloadTo = async () => { throw new Error("Timeout (data socket)"); };
      return client;
    },
    onRetry: (event) => retries.push(event),
  });

  assert.equal(result.summary.contentScanned, 1);
  assert.equal(clients, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].stage, "content");
  assert.ok(result.findings.some((item) => item.category === "content-signature"));
});
