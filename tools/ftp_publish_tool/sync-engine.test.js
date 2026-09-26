const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertLocalSyncEnvironment,
  assertSyncNotBusy,
  createSyncEngine,
  databasePathFromEnvText,
  isPublishable,
  mapPathsValue,
  portableAiConfig,
} = require("./sync-engine");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, typeof content === "string" ? "utf8" : undefined);
}

// 模拟 basic-ftp 客户端：跟踪当前目录，内存保存远端文件
function createTrackingClient(remoteFiles) {
  const joinKey = (...parts) => parts.join("/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const client = {
    ftp: {},
    cwd: "/",
    async access() {},
    async pwd() { return "/"; },
    async cd(part) {
      client.cwd = part.startsWith("/") ? part : joinKey(client.cwd, part) || "/";
    },
    async send() {},
    async size(remotePath) {
      const value = remoteFiles[joinKey(remotePath.startsWith("/") ? remotePath : client.cwd, remotePath)];
      if (value === undefined) throw new Error("550 File unavailable");
      return Buffer.byteLength(value);
    },
    async downloadTo(localPath, remotePath) {
      const value = remoteFiles[joinKey(remotePath.startsWith("/") ? remotePath : client.cwd, remotePath)];
      if (value === undefined) throw new Error("550 File unavailable");
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, value);
    },
    async uploadFrom(localPath, remoteName) {
      remoteFiles[joinKey(client.cwd, remoteName)] = fs.readFileSync(localPath);
    },
    close() {},
  };
  return client;
}

// ---------------- 纯函数 ----------------

test("isPublishable keeps code and docs but excludes secrets, data and local dirs", () => {
  const included = ["backend/src/main.ts", "frontend/src/main.ts", "deploy/a.cjs", "docs/x.md", "package.json",
    "pnpm-lock.yaml", "managed-sites/README.md", "frontend/public/favicon.ico", "backend/.env.example", "tools/ftp_publish_tool/server.js"];
  const excluded = ["backend/.env", "backend/dev.sqlite", "tools/seo_publish_tool/ai.config.json",
    "managed-sites/demo/ftp/ftp.config.json", "managed-sites/demo/site.json", "node_modules/a.js", "logs/x.log",
    "tmp/snapshot/a.txt", "uploads/a.png", "data/x.db", "tools/ftp_publish_tool/sync.config.json",
    "frontend/public/tutorial/shot.png", "docs/tutorial-assets/s.png", "backend/uploads/logo.jpg",
    "certs/server.key", "backend/backup.token", "tools/ftp_publish_tool/sync-state/x/manifest.json"];
  for (const entry of included) assert.equal(isPublishable(entry), true, `${entry} should be publishable`);
  for (const entry of excluded) assert.equal(isPublishable(entry), false, `${entry} should be excluded`);
});

test("isPublishable treats directories by path parts only", () => {
  assert.equal(isPublishable("node_modules", true), false);
  assert.equal(isPublishable("managed-sites", true), true);
  assert.equal(isPublishable("managed-sites/demo", true), false);
  assert.equal(isPublishable("src", true), true);
});

test("mapPathsValue rewrites path prefixes with boundary and handles backslashes", () => {
  const mappings = [{ from: "E:/phpstudy_pro/WWW/demo.c", to: "/www/wwwroot/demo.com" }];
  assert.equal(mapPathsValue("E:/phpstudy_pro/WWW/demo.c/static/a.png", mappings), "/www/wwwroot/demo.com/static/a.png");
  assert.equal(mapPathsValue("E:\\phpstudy_pro\\WWW\\demo.c\\static\\a.png", mappings), "/www/wwwroot/demo.com/static/a.png");
  assert.equal(mapPathsValue("E:/phpstudy_pro/WWW/demo.c", mappings), "/www/wwwroot/demo.com");
  assert.equal(mapPathsValue("E:/phpstudy_pro/WWW/demo.c2/static/a.png", mappings), "E:/phpstudy_pro/WWW/demo.c2/static/a.png");
  assert.equal(mapPathsValue(42, mappings), 42);
  const nested = mapPathsValue({ a: ["E:/phpstudy_pro/WWW/demo.c/x"], b: "keep" }, mappings);
  assert.deepEqual(nested, { a: ["/www/wwwroot/demo.com/x"], b: "keep" });
});

test("portableAiConfig keeps only configured api keys", () => {
  const { config, hasKeys } = portableAiConfig({ deepseekApiKey: "sk-x", localRoot: "junk", zhipuApiKey: "" });
  assert.equal(hasKeys, true);
  assert.deepEqual(config, { deepseekApiKey: "sk-x" });
  assert.equal(portableAiConfig({ localRoot: "junk" }).hasKeys, false);
});

test("databasePathFromEnvText resolves DB_SQLJS_LOCATION against backend dir", () => {
  const resolved = databasePathFromEnvText("# c\nDB_SQLJS_LOCATION=data/db.sqlite\n", "/srv/backend");
  assert.equal(resolved, path.resolve("/srv/backend", "data/db.sqlite"));
  assert.equal(databasePathFromEnvText("", "/srv/backend"), path.resolve("/srv/backend", "dev.sqlite"));
});

test("assertLocalSyncEnvironment and assertSyncNotBusy throw with status codes", () => {
  assert.doesNotThrow(() => assertLocalSyncEnvironment({ APP_ENVIRONMENT: "local" }));
  assert.throws(() => assertLocalSyncEnvironment({ APP_ENVIRONMENT: "baota" }), /仅在本地环境可用/);
  assert.throws(() => assertLocalSyncEnvironment({}), /APP_ENVIRONMENT=未设置/);
  assert.throws(() => assertSyncNotBusy({ uploadRunning: true }), (error) => error.statusCode === 409);
  assert.throws(() => assertSyncNotBusy({ securityRunning: true }), (error) => error.statusCode === 409);
  assert.throws(() => assertSyncNotBusy({ serverSecurityRunning: true }), (error) => error.statusCode === 409);
  assert.doesNotThrow(() => assertSyncNotBusy({}));
});

// ---------------- 引擎集成（managed-sites 预设） ----------------

async function createManagedSitesFixture() {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-pkg-"));
  const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-tool-"));
  const siteDirectory = path.join(packageRoot, "managed-sites", "demo");
  const siteRoot = "E:/phpstudy_pro/WWW/demo.c";

  write(path.join(siteDirectory, "site.json"), JSON.stringify({
    version: 1,
    site: { id: 1, code: "demo", environment: "phpstudy", rootPath: siteRoot, dbPath: `${siteRoot}/data/abc.db`, publicBaseUrl: "http://demo.c" },
  }));
  write(path.join(siteDirectory, "seo", "seo.config.json"), JSON.stringify({ localRoot: siteRoot, databasePath: `${siteRoot}/data/abc.db`, apiKey: "keep" }));
  write(path.join(siteDirectory, "ftp", "ftp.config.json"), JSON.stringify({ host: "old", user: "u", password: "secret", localRoot: siteRoot, networkInterface: 'Local Ethernet' }));
  write(path.join(siteDirectory, "ftp", "security-baseline.json"), JSON.stringify({ machine: "local-only" }));
  write(path.join(siteDirectory, 'state', 'system-license.json'), JSON.stringify({ codes: 'LOCAL-ONLY' }));
  write(path.join(siteDirectory, "google", "key.json"), JSON.stringify({ client_email: "svc@example.com" }));
  write(path.join(siteDirectory, "api", "uploads", "img.png"), "png-data");
  write(path.join(packageRoot, "backend", "uploads", "logo.jpg"), "jpg-data");
  write(path.join(packageRoot, "tools", "seo_publish_tool", "ai.config.json"), JSON.stringify({ deepseekApiKey: "sk-demo", localRoot: "junk" }));

  write(path.join(toolRoot, "sync.config.json"), JSON.stringify({
    project: { host: "bt.example.com", port: 21, secure: true, user: "proj", password: "pw", remoteRoot: "/", serverProjectRoot: "/www/wwwroot/pboot_admin_center" },
    sites: { demo: { host: "bt.example.com", port: 21, secure: true, user: "site", password: "pw", remoteRoot: "/", serverSiteRoot: "/www/wwwroot/demo.com" } },
  }));

  const sites = [{
    id: 1, code: "demo", name: "Demo", rootPath: siteRoot, directory: siteDirectory, isDefault: true,
  }];
  const engine = createSyncEngine({
    packageRoot,
    toolRoot,
    readSites: () => sites,
    currentSite: () => sites[0],
  });
  return { engine, packageRoot, toolRoot };
}

const MANAGED_OPTIONS = {
  sites: ["demo"],
  sections: ["siteFile", "seo", "ftp", "google", "api", "state"],
  backendUploads: true,
  aiKeys: true,
};

test('project configuration is isolated from site configuration even if site options are submitted', async () => {
  const { engine } = await createManagedSitesFixture();
  const plan = engine.buildSyncPlan({ preset: 'project-config', options: MANAGED_OPTIONS });
  assert.ok(plan.files.length);
  assert.ok(plan.files.every(file => !file.relativePath.startsWith('managed-sites/')));
});

test('shared search accounts are explicit project configuration and preserve credential bytes', async () => {
  const { engine, packageRoot } = await createManagedSitesFixture();
  const googlePath = 'managed-sites/_shared/google/service-account.json';
  const bingPath = 'managed-sites/_shared/bing/account.json';
  const yandexPath = 'managed-sites/_shared/yandex/account.json';
  const google = JSON.stringify({ version: 1, serviceAccount: { client_email: 'test@example.com', private_key: 'test-key\nE:/phpstudy_pro/WWW/demo.c' } });
  const bing = JSON.stringify({ version: 1, apiKey: 'test-only-key' });
  const yandex = JSON.stringify({ version: 1, oauthToken: 'test-only-yandex-token' });
  write(path.join(packageRoot, googlePath), google);
  write(path.join(packageRoot, bingPath), bing);
  write(path.join(packageRoot, yandexPath), yandex);
  write(path.join(packageRoot, 'managed-sites/_shared/unrelated.json'), '{"secret":"exclude"}');
  assert.equal(engine.buildSyncPlan({ preset: 'project-config' }).files.length, 0);
  assert.equal(engine.buildSyncPlan({ preset: 'managed-sites', options: { searchAccounts: true } }).files.length, 0);
  assert.equal(isPublishable(googlePath), false);
  assert.equal(isPublishable(bingPath), false);
  assert.equal(isPublishable(yandexPath), false);
  const options = { searchAccounts: true };
  const plan = engine.buildSyncPlan({ preset: 'project-config', options });
  assert.deepEqual(plan.files.map(file => file.relativePath), [googlePath, bingPath, yandexPath]);
  const remoteFiles = {};
  const result = await engine.runSyncPlan(plan, options, { clientFactory: () => createTrackingClient(remoteFiles) });
  assert.equal(remoteFiles[googlePath].toString(), google);
  assert.equal(remoteFiles[bingPath].toString(), bing);
  assert.equal(remoteFiles[yandexPath].toString(), yandex);
  assert.equal(result.checklist.code, '');
  assert.match(result.checklist.steps[0], /无需重启/);
  assert.equal(engine.buildSyncPlan({ preset: 'project-config', options }).toUpload.length, 0);
  write(path.join(packageRoot, bingPath), JSON.stringify({ apiKey: 'updated-test-key' }));
  assert.deepEqual(engine.buildSyncPlan({ preset: 'project-config', options }).toUpload.map(file => file.relativePath), [bingPath]);
});

test('missing shared accounts preserve online files, invalid accounts fail without exposing secrets', async () => {
  const { engine, packageRoot } = await createManagedSitesFixture();
  const options = { searchAccounts: true };
  const plan = engine.buildSyncPlan({ preset: 'project-config', options });
  assert.equal(plan.files.length, 0);
  assert.equal(plan.notes.filter(note => note.includes('保留线上')).length, 3);
  write(path.join(packageRoot, 'managed-sites/_shared/google/service-account.json'), '{ secret-dont-print');
  assert.throws(() => engine.buildSyncPlan({ preset: 'project-config', options }), error => /Google.*无效/.test(error.message) && !error.message.includes('secret-dont-print'));
});

test('shared account selection participates in secret transport warnings', async () => {
  const { engine, packageRoot } = await createManagedSitesFixture();
  write(path.join(packageRoot, 'managed-sites/_shared/bing/account.json'), JSON.stringify({ apiKey: 'test-only-key' }));
  const config = engine.readSyncConfig();
  config.project.secure = false;
  engine.writeSyncConfig(config);
  const plan = engine.buildSyncPlan({ preset: 'project-config', options: { searchAccounts: true } });
  assert.ok(plan.warnings.some(warning => warning.includes('FTPS')));
});

test('uploaded code remains pending until build succeeds, and failed builds can retry without reupload', async () => {
  const { engine, packageRoot } = await createManagedSitesFixture();
  write(path.join(packageRoot, 'backend/src/area/area.module.ts'), 'export class AreaModule {}');
  const remoteFiles = {};
  let plan = engine.buildSyncPlan({ preset: 'project-code' });
  const first = await engine.runSyncPlan(plan, {}, { clientFactory: () => createTrackingClient(remoteFiles) });
  assert.equal(first.phase, 'awaiting-build');
  const config = engine.readSyncConfig();
  config.project.btPanel = { autoBuild: true, url: 'http://panel', user: 'test', password: 'test' };
  engine.writeSyncConfig(config);
  plan = engine.buildSyncPlan({ preset: 'project-code' });
  assert.equal(plan.toUpload.length, 0);
  await assert.rejects(engine.runSyncPlan(plan, {}, { remoteBuild: async () => { throw new Error('build failed'); } }), /build failed/);
  const final = await engine.runSyncPlan(plan, {}, { remoteBuild: async () => ({ log: 'PBOOT_BUILD_DONE' }) });
  assert.equal(final.phase, 'complete');
  assert.equal(final.result.uploaded, 0);
});

test("managed-sites plan excludes machine-local state and stages portable transforms", async () => {
  const { engine } = await createManagedSitesFixture();
  const plan = engine.buildSyncPlan({ preset: "managed-sites", options: MANAGED_OPTIONS });
  const paths = plan.files.map((file) => file.relativePath);
  assert.ok(paths.includes("managed-sites/demo/site.json"));
  assert.ok(paths.includes("managed-sites/demo/seo/seo.config.json"));
  assert.ok(paths.includes("managed-sites/demo/ftp/ftp.config.json"));
  assert.ok(paths.includes("managed-sites/demo/google/key.json"));
  assert.ok(paths.includes("managed-sites/demo/api/uploads/img.png"));
  assert.ok(paths.includes("backend/uploads/logo.jpg"));
  assert.ok(paths.includes("tools/seo_publish_tool/ai.config.json"));
  assert.ok(!paths.some((entry) => entry.includes("security-baseline")), "巡检基线不应进入同步计划");
  assert.ok(!paths.some(entry => entry.includes('system-license.json')), '授权码必须按环境保留');
  const siteJson = JSON.parse(plan.stagingPlan.get("managed-sites/demo/site.json"));
  assert.equal(siteJson.site.rootPath, "/www/wwwroot/demo.com");
  assert.equal(siteJson.site.dbPath, "/www/wwwroot/demo.com/data/abc.db");
  assert.equal(siteJson.site.environment, "baota");
  const seo = JSON.parse(plan.stagingPlan.get("managed-sites/demo/seo/seo.config.json"));
  assert.equal(JSON.parse(plan.stagingPlan.get('managed-sites/demo/ftp/ftp.config.json')).networkInterface, undefined);
  assert.equal(seo.localRoot, "/www/wwwroot/demo.com");
  assert.equal(seo.apiKey, "keep");
  const ai = JSON.parse(plan.stagingPlan.get("tools/seo_publish_tool/ai.config.json"));
  assert.deepEqual(Object.keys(ai), ["deepseekApiKey"]);
  assert.ok(plan.pathMappings.some((mapping) => mapping.from === "E:/phpstudy_pro/WWW/demo.c" && mapping.to === "/www/wwwroot/demo.com"),
    "路径改写映射应包含站点根映射");
});

test("managed-sites run uploads transformed files and manifest makes second run empty", async (t) => {
  const { engine, toolRoot } = await createManagedSitesFixture();
  t.after(() => { fs.rmSync(toolRoot, { recursive: true, force: true }); });
  const remoteFiles = {};
  const plan = engine.buildSyncPlan({ preset: "managed-sites", options: MANAGED_OPTIONS });
  assert.ok(plan.toUpload.length > 0);

  const { result, checklist } = await engine.runSyncPlan(plan, MANAGED_OPTIONS, {
    clientFactory: () => createTrackingClient(remoteFiles),
  });
  assert.equal(result.uploaded, plan.toUpload.length);

  const uploadedSiteJson = JSON.parse(remoteFiles["managed-sites/demo/site.json"].toString("utf8"));
  assert.equal(uploadedSiteJson.site.rootPath, "/www/wwwroot/demo.com");
  assert.equal(uploadedSiteJson.site.environment, "baota");
  const uploadedFtp = JSON.parse(remoteFiles["managed-sites/demo/ftp/ftp.config.json"].toString("utf8"));
  assert.equal(uploadedFtp.password, "secret", "FTP 密码应原样保留");
  assert.equal(uploadedFtp.localRoot, "/www/wwwroot/demo.com");
  assert.ok(!remoteFiles["managed-sites/demo/ftp/security-baseline.json"], "巡检基线不应上传");
  assert.ok(remoteFiles["backend/uploads/logo.jpg"]);
  assert.ok(checklist && checklist.steps.length > 0);

  const manifestPath = path.join(toolRoot, "sync-state", "project", "managed-sites.manifest.json");
  assert.ok(fs.existsSync(manifestPath), "同步成功后应写入清单");
  const secondPlan = engine.buildSyncPlan({ preset: "managed-sites", options: MANAGED_OPTIONS });
  assert.equal(secondPlan.toUpload.length, 0, "第二次构建应全部未变化");
  assert.equal(secondPlan.counts.unchanged, secondPlan.counts.total);
});

test("managed-sites plan warns about plaintext FTP when carrying secrets", async () => {
  const { engine, toolRoot } = await createManagedSitesFixture();
  const config = engine.readSyncConfig();
  config.project.secure = false;
  engine.writeSyncConfig(config);
  const plan = engine.buildSyncPlan({ preset: "managed-sites", options: { sites: ["demo"], sections: ["ftp"], aiKeys: false } });
  assert.ok(plan.warnings.some((warning) => warning.includes("FTPS")));
  fs.rmSync(toolRoot, { recursive: true, force: true });
});

// ---------------- 引擎集成（project-code / database 预设） ----------------

test("project plan filters secrets through the publishable rules and diffs against manifest", async (t) => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-proj-"));
  const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-proj-tool-"));
  t.after(() => {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.rmSync(toolRoot, { recursive: true, force: true });
  });
  write(path.join(packageRoot, "backend", "src", "main.ts"), "code");
  write(path.join(packageRoot, "backend", ".env"), "SECRET=1");
  write(path.join(packageRoot, "backend", "dev.sqlite"), "db");
  write(path.join(packageRoot, "docs", "guide.md"), "doc");
  write(path.join(packageRoot, "node_modules", "x.js"), "dep");
  write(path.join(packageRoot, "package.json"), "{}");
  write(path.join(toolRoot, "sync.config.json"), JSON.stringify({
    project: { host: "h", user: "u", password: "p", secure: true, remoteRoot: "/", serverProjectRoot: "/www/wwwroot/pboot_admin_center" },
  }));
  const engine = createSyncEngine({ packageRoot, toolRoot, readSites: () => [], currentSite: () => null });

  const plan = engine.buildSyncPlan({ preset: "project-code", options: {} });
  const paths = plan.files.map((file) => file.relativePath);
  assert.ok(paths.includes("backend/src/main.ts"));
  assert.ok(paths.includes("docs/guide.md"));
  assert.ok(paths.includes("package.json"));
  assert.ok(!paths.some((entry) => entry.endsWith(".env")));
  assert.ok(!paths.some((entry) => entry.endsWith("dev.sqlite")));
  assert.ok(!paths.some((entry) => entry.includes("node_modules")));
  assert.equal(plan.counts.fresh, plan.counts.total);

  const remoteFiles = {};
  await engine.runSyncPlan(plan, {}, { clientFactory: () => createTrackingClient(remoteFiles) });
  assert.ok(remoteFiles["backend/src/main.ts"]);
  assert.ok(!remoteFiles["backend/.env"]);

  write(path.join(packageRoot, "backend", "src", "main.ts"), "code v2");
  const second = engine.buildSyncPlan({ preset: "project-code", options: {} });
  assert.equal(second.counts.changed, 1);
  assert.equal(second.counts.unchanged, second.counts.total - 1);
});

test("database plan stages to data/sync-staging with checksum sidecar and never the live db", async (t) => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-db-"));
  const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sync-db-tool-"));
  t.after(() => {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.rmSync(toolRoot, { recursive: true, force: true });
  });
  write(path.join(packageRoot, "backend", ".env"), "DB_SQLJS_LOCATION=dev.sqlite\n");
  write(path.join(packageRoot, "backend", "dev.sqlite"), "sqlite-bytes");
  write(path.join(toolRoot, "sync.config.json"), JSON.stringify({
    project: { host: "h", user: "u", password: "p", secure: true, remoteRoot: "/", serverProjectRoot: "/srv/app" },
  }));
  const engine = createSyncEngine({ packageRoot, toolRoot, readSites: () => [], currentSite: () => null });

  const plan = engine.buildSyncPlan({ preset: "database" });
  assert.ok(/^pboot-admin-\d{8}_\d{6}\.sqlite$/.test(plan.remoteName), `暂存名不符合约定：${plan.remoteName}`);
  assert.ok(plan.warnings.some((warning) => warning.includes("sync-staging")));

  const remoteFiles = {};
  const { checklist } = await engine.runSyncPlan(plan, {}, { clientFactory: () => createTrackingClient(remoteFiles) });
  const dbKey = `data/sync-staging/${plan.remoteName}`;
  assert.ok(remoteFiles[dbKey], "暂存库应上传");
  assert.ok(remoteFiles[`${dbKey}.json`], "校验单应上传");
  assert.ok(!remoteFiles["data/pboot-admin.sqlite"], "绝不能直接写线上库路径");
  assert.equal(remoteFiles[dbKey].toString("utf8"), "sqlite-bytes");
  const sidecar = JSON.parse(remoteFiles[`${dbKey}.json`].toString("utf8"));
  assert.match(sidecar.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(sidecar.type, "pboot-admin-sync-staging");
  assert.ok(checklist.steps.some((step) => step.includes("pm2") || step.includes("PM2")));
});
