// 本地 → 宝塔同步引擎（仅本地环境可用）
// 三个预设：
//   project-code   管理项目源码（可发布文件过滤器 + sha256 清单增量）
//   managed-sites  每站配置树 / 上传图片 / 模型密钥（portable 路径改写）
//   database       管理数据库（仅暂存上传到 data/sync-staging/，绝不覆盖线上库）
//   site-data      PB 网站数据（复用 upload-to-ftp 的 collectFiles/uploadFiles 引擎）
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const siteRuntime = require("../site-runtime");
const {
  collectFiles,
  formatBytes,
  uploadFiles,
} = require("./upload-to-ftp");

const TOOL_ROOT = __dirname;
const PACKAGE_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const AI_CONFIG_KEYS = ["zhipuApiKey", "deepseekApiKey", "dashscopeApiKey", "openaiApiKey"];

// 与 tmp/prepare-baota-release.py 的发布审计规则保持一致（多出 .claude/runtime/cache/sync-state 等本地目录）
const SYNC_SKIP_DIR_PARTS = new Set([
  ".git", "node_modules", "dist", "uploads", "backups", "logs", "tmp",
  "artifacts", "coverage", "data", ".home", ".pm2", ".pnpm-store",
  ".claude", "runtime", "cache", "sync-state", "__pycache__",
]);
const SYNC_PRIVATE_NAMES = new Set([
  "ai.config.json", "ai.model-health.json", "seo.config.json",
  "ftp.config.json", "sync.config.json", ".runtime.json", "git.token",
  "security-baseline.json", "security-baseline-candidate.json",
  "security-scan-history.json", "security-scan-checkpoint.json",
  "google-submitted.json", "google-inspections.json", "search-index-coverage.json",
]);
const SYNC_BLOCKED_DIR_PARTS = new Set(["tutorial-assets", "security-evidence"]);
const SYNC_BLOCKED_EXT = /\.(?:sqlite|db|log|token|pem|key|p12|pfx|tsbuildinfo)(?:\.|$)/i;

// managed-sites 同步时节内需要排除的本机巡检状态（两环境各自独立）
const MANAGED_SECTION_SKIP_NAMES = new Set([
  'domain-check.json',
  'system-license.json',
  "security-baseline.json", "security-baseline-candidate.json",
  "security-scan-history.json", "security-scan-checkpoint.json",
]);
const MANAGED_SECTION_SKIP_DIRS = new Set(["security-evidence"]);

const MANAGED_SITE_SECTIONS = [
  { id: "siteFile", label: "site.json（站点档案，路径自动改写）", dir: "", file: "site.json" },
  { id: "seo", label: "SEO 配置（路径自动改写）", dir: "seo" },
  { id: "ftp", label: "FTP 配置（含密码，建议 FTPS）", dir: "ftp" },
  { id: "google", label: "Google 凭据（建议 FTPS）", dir: "google" },
  { id: "state", label: "任务状态", dir: "state" },
  { id: "api", label: "上传图片", dir: "api" },
];

const PROJECT_CHECKLIST = (serverRoot) => ({
  title: "代码已上传，等待上线",
  steps: ["在宝塔终端执行下方这一条命令，自动构建并重启。", "看到 PBOOT_BUILD_DONE 才表示上线成功。也可配置自动上线后再次点击同步。"],
  code: require('./bt-panel').buildRemoteApplyScript({ serverRoot: serverRoot || "/www/wwwroot/pboot_admin_center" }),
});

const DATABASE_CHECKLIST = (remoteName, serverRoot) => ({
  title: "管理数据库接管步骤（手动执行，默认不做）",
  steps: [
    "暂存文件已上传，线上库未做任何改动；以下步骤请在确认需要时手动执行",
    "宝塔 PM2 面板停止 pboot-admin-api（sql.js 是整文件写回，运行中替换会损坏数据库）",
    `备份线上库：cp ${serverRoot || "/www/wwwroot/pboot_admin_center"}/data/pboot-admin.sqlite /www/backup/pboot-admin.before-sync.sqlite`,
    `替换：cp ${serverRoot || "/www/wwwroot/pboot_admin_center"}/data/sync-staging/${remoteName} ${serverRoot || "/www/wwwroot/pboot_admin_center"}/data/pboot-admin.sqlite`,
    "修正 managed_sites 表的环境行（environment='baota'、rootPath/dbPath/publicBaseUrl 改为服务器值）——本地库带来的是 phpstudy 行",
    "启动 pboot-admin-api，浏览器打开管理后台确认环境横幅为「宝塔线上」且站点可访问",
  ],
  code: [
    "sqlite3 data/pboot-admin.sqlite \"UPDATE managed_sites SET environment='baota',",
    "  rootPath='/www/wwwroot/你的域名', dbPath='/www/wwwroot/你的域名/data/xxx.db',",
    "  publicBaseUrl='https://你的域名';\"",
  ].join("\n"),
});

// ---------------- 环境守卫 ----------------

function localSyncEnvironment(env = process.env) {
  return String(env.APP_ENVIRONMENT || "").trim().toLowerCase() === "local";
}

function statusError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function assertLocalSyncEnvironment(env = process.env) {
  if (!localSyncEnvironment(env)) {
    const current = String(env.APP_ENVIRONMENT || "").trim() || "未设置";
    throw statusError(403, `同步功能仅在本地环境可用（当前 APP_ENVIRONMENT=${current}）。`);
  }
}

function assertSyncNotBusy({ uploadRunning = false, securityRunning = false, serverSecurityRunning = false } = {}) {
  if (serverSecurityRunning) throw statusError(409, "宝塔服务器巡检正在运行，请先停止巡检。");
  if (securityRunning) throw statusError(409, "安全巡检正在运行，请等待扫描完成。");
  if (uploadRunning) throw statusError(409, "FTP 发布正在运行，请等待发布完成。");
}

// ---------------- 纯工具（供测试） ----------------

function isPublishable(relativePosix, isDir = false) {
  const parts = toPosixPath(relativePosix).split("/").filter(Boolean);
  if (!parts.length) return false;
  const name = parts[parts.length - 1];
  if (parts.some((part) => SYNC_SKIP_DIR_PARTS.has(part) || part.startsWith(".cache") || part.startsWith("dist-"))) return false;
  if (parts.some((part) => SYNC_BLOCKED_DIR_PARTS.has(part))) return false;
  if (parts[0] === "managed-sites" && relativePosix !== "managed-sites/README.md" && parts.length > 1) return false;
  if (isDir) return true;
  if (SYNC_PRIVATE_NAMES.has(name)) return false;
  if (name.startsWith(".env") && name !== ".env.example") return false;
  if (SYNC_BLOCKED_EXT.test(name)) return false;
  if (parts[0] === "frontend" && parts[1] === "public" && parts[2] === "tutorial"
    && /\.(?:png|jpe?g|pdf)$/i.test(name)) return false;
  return true;
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

// 路径前缀改写（带边界）：E:/x/y → /www/wwwroot/y，同时兼容反斜杠写法
function mapPathsValue(value, mappings) {
  if (Array.isArray(value)) return value.map((item) => mapPathsValue(item, mappings));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapPathsValue(child, mappings)]));
  }
  if (typeof value !== "string") return value;
  let out = value;
  for (const mapping of mappings) {
    const from = toPosixPath(mapping.from).replace(/\/+$/, "");
    if (!from) continue;
    const fromBack = from.replace(/\//g, "\\");
    for (const source of from === fromBack ? [from] : [from, fromBack]) {
      if (out === source || out.startsWith(`${source}/`) || out.startsWith(`${source}\\`)) {
        out = `${mapping.to}${out.slice(source.length)}`.replace(/\\/g, "/");
      }
    }
  }
  return out;
}

function portableAiConfig(raw) {
  const result = {};
  let any = false;
  for (const key of AI_CONFIG_KEYS) {
    if (typeof raw?.[key] === "string" && raw[key].trim()) {
      result[key] = raw[key];
      any = true;
    }
  }
  return { config: result, hasKeys: any };
}

function databasePathFromEnvText(envText, backendDir, fallback = "dev.sqlite") {
  const match = String(envText || "").split(/\r?\n/).find((line) => /^\s*DB_SQLJS_LOCATION\s*=/.test(line));
  const value = match ? match.replace(/^\s*DB_SQLJS_LOCATION\s*=/, "").trim() : "";
  return path.resolve(backendDir, value || fallback);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function formatStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ---------------- 引擎工厂 ----------------

function createSyncEngine({
  packageRoot = PACKAGE_ROOT,
  toolRoot = TOOL_ROOT,
  readSites = siteRuntime.readManagedSites,
  currentSite = siteRuntime.currentSite,
  readBaseFtpConfig = null,
} = {}) {
  const syncConfigPath = path.join(toolRoot, "sync.config.json");
  const syncStateRoot = path.join(toolRoot, "sync-state");
  const backendEnvPath = path.join(packageRoot, "backend", ".env");
  const aiConfigPath = path.join(packageRoot, "tools", "seo_publish_tool", "ai.config.json");

  function defaultProjectTarget() {
    return {
      name: "宝塔管理项目",
      host: "",
      port: 21,
      secure: true,
      user: "",
      password: "",
      remoteRoot: "/",
      serverProjectRoot: "/www/wwwroot/pboot_admin_center",
      enabled: true,
      btPanel: {
        url: "",
        user: "",
        password: "",
        autoBuild: false,
      },
    };
  }

  function defaultSiteTarget() {
    return { host: "", port: 21, secure: true, user: "", password: "", remoteRoot: "/", serverSiteRoot: "", enabled: true };
  }

  function readSyncConfig() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(syncConfigPath, "utf8").replace(/^\uFEFF/, ""));
    } catch (_error) {
      raw = {};
    }
    const sites = {};
    for (const site of readSites()) {
      const stored = raw.sites && raw.sites[site.code] ? raw.sites[site.code] : {};
      sites[site.code] = { ...defaultSiteTarget(), ...stored };
    }
    return { project: { ...defaultProjectTarget(), ...(raw.project || {}) }, sites };
  }

  function writeSyncConfig(config) {
    fs.writeFileSync(syncConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  function redactTarget(target) {
    const { password, btPanel, ...rest } = target || {};
    const redactedBtPanel = btPanel ? {
      ...btPanel,
      password: "",
      passwordSet: Boolean(btPanel.password),
    } : undefined;
    return { ...rest, password: "", passwordSet: Boolean(password), btPanel: redactedBtPanel };
  }

  function publicSyncConfig(config) {
    const sites = {};
    for (const [code, target] of Object.entries(config.sites || {})) sites[code] = redactTarget(target);
    return { project: redactTarget(config.project), sites };
  }

  function normalizeTargetInput(body, current) {
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const next = { ...current };
    for (const key of ["name", "host", "user", "remoteRoot", "serverProjectRoot", "serverSiteRoot", "networkInterface"]) {
      if (typeof body[key] === "string") next[key] = body[key].trim();
    }
    if (has("port")) next.port = Number(body.port || 21);
    if (has("secure")) next.secure = Boolean(body.secure);
    if (has("enabled")) next.enabled = Boolean(body.enabled);
    if (typeof body.password === "string" && body.password.trim()) next.password = body.password;
    if (body.btPanel && typeof body.btPanel === "object") {
      next.btPanel = { ...current.btPanel };
      if (typeof body.btPanel.url === "string") next.btPanel.url = body.btPanel.url.trim();
      if (typeof body.btPanel.user === "string") next.btPanel.user = body.btPanel.user.trim();
      if (typeof body.btPanel.password === "string" && body.btPanel.password.trim()) {
        next.btPanel.password = body.btPanel.password;
      }
      if (has.call(body.btPanel, "autoBuild")) next.btPanel.autoBuild = Boolean(body.btPanel.autoBuild);
    }
    return next;
  }

  function targetReady(target) {
    return Boolean(target && target.host && target.user && target.password && target.enabled !== false);
  }

  // ---- 清单 ----

  function manifestPath(targetKey, preset) {
    return path.join(syncStateRoot, targetKey.replace(/[:*?"<>|]/g, "_"), `${preset}.manifest.json`);
  }

  function readManifest(targetKey, preset) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath(targetKey, preset), "utf8"));
      if (Number(manifest.version) !== 1 || !manifest.files) return null;
      return manifest;
    } catch (_error) {
      return null;
    }
  }

  function writeManifestAtomic(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function writeManifest(targetKey, preset, files, syncedAt) {
    const entries = {};
    for (const file of files) entries[file.relativePath] = { sha256: file.sha256, size: file.size, uploadedAt: syncedAt };
    writeManifestAtomic(manifestPath(targetKey, preset), { version: 1, preset, targetKey, syncedAt, files: entries });
  }

  function diffAgainstManifest(files, manifest, { forceFull = false } = {}) {
    const counts = { total: files.length, fresh: 0, changed: 0, unchanged: 0, removedSinceLastSync: 0 };
    const toUpload = [];
    for (const file of files) {
      const prev = !forceFull && manifest ? manifest.files[file.relativePath] : undefined;
      if (!prev) {
        counts.fresh += 1;
        toUpload.push({ ...file, action: "new" });
      } else if (prev.size !== file.size || prev.sha256 !== file.sha256) {
        counts.changed += 1;
        toUpload.push({ ...file, action: "changed" });
      } else {
        counts.unchanged += 1;
      }
    }
    const removedSinceLastSync = [];
    if (manifest && !forceFull) {
      const present = new Set(files.map((file) => file.relativePath));
      for (const entry of Object.keys(manifest.files)) {
        if (!present.has(entry)) removedSinceLastSync.push(entry);
      }
    }
    counts.removedSinceLastSync = removedSinceLastSync.length;
    return { counts, toUpload, removedSinceLastSync };
  }

  // ---- 预设一：项目代码 ----

  function collectProjectFiles(root = packageRoot, relativeDir = "", output = []) {
    const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
    if (!fs.existsSync(absoluteDir)) return output;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (!isPublishable(childRelative, entry.isDirectory())) continue;
      const childAbsolute = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        collectProjectFiles(root, childRelative, output);
      } else if (entry.isFile()) {
        const stat = fs.statSync(childAbsolute);
        output.push({ localPath: childAbsolute, relativePath: childRelative, size: stat.size, sha256: sha256File(childAbsolute) });
      }
    }
    return output;
  }

  function buildProjectPlan(target, options = {}) {
    const files = collectProjectFiles();
    const manifest = readManifest("project", "project-code");
    const diff = diffAgainstManifest(files, manifest, { forceFull: options.forceFull === true });
    const toUploadSize = diff.toUpload.reduce((sum, file) => sum + file.size, 0);
    return {
      preset: "project-code",
      targetKey: "project",
      target: redactTarget(target),
      ready: targetReady(target),
      files,
      counts: diff.counts,
      toUpload: diff.toUpload,
      toUploadSize,
      toUploadSizeText: formatBytes(toUploadSize),
      removedSinceLastSync: diff.removedSinceLastSync,
      lastSyncAt: manifest?.syncedAt || "",
      warnings: [],
      notes: [
        "过滤规则与发布审计一致：.env、密钥配置、数据库、node_modules、dist、managed-sites（除 README）等一律不上传。",
        "清单增量：只上传新增与内容变化的文件；「本地已删」仅列出报告，不会删除远端文件。",
      ],
    };
  }

  // ---- 预设二：managed-sites 配置 ----

  function buildPathMappings(config, sites) {
    const mappings = [];
    const projectRoot = config.project?.serverProjectRoot;
    // 目标是服务器绝对路径，保留前导斜杠，仅统一分隔符
    if (projectRoot) mappings.push({ from: packageRoot, to: String(projectRoot).replace(/\\/g, "/") });
    for (const site of sites) {
      const target = config.sites?.[site.code];
      if (site.rootPath && target?.serverSiteRoot) {
        mappings.push({ from: site.rootPath, to: String(target.serverSiteRoot).replace(/\\/g, "/") });
      }
    }
    return mappings;
  }

  function collectManagedSection(site, section, mappings, output, stagingPlan) {
    const sectionDir = path.join(site.directory, section.dir);
    if (section.file) {
      const filePath = path.join(site.directory, section.file);
      if (!fs.existsSync(filePath)) return;
      const content = managedSiteJsonContent(filePath, mappings, section.id === "siteFile");
      const relativePath = `managed-sites/${site.code}/${section.file}`;
      output.push({
        relativePath,
        localPath: filePath,
        size: Buffer.byteLength(content, "utf8"),
        sha256: sha256Text(content),
        transform: section.id === "siteFile" ? "site-json" : "json-paths",
      });
      stagingPlan.set(relativePath, content);
      return;
    }
    if (!fs.existsSync(sectionDir)) return;
    walkManagedDir(sectionDir, `managed-sites/${site.code}/${section.dir}`, mappings, output, stagingPlan);
  }

  function managedSiteJsonContent(filePath, mappings, isSiteFile) {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    const transformed = mapPathsValue(payload, mappings);
    if (path.basename(filePath) === 'ftp.config.json') delete transformed.networkInterface;
    if (isSiteFile && transformed.site) transformed.site.environment = "baota";
    return `${JSON.stringify(transformed, null, 2)}\n`;
  }

  function walkManagedDir(absoluteDir, relativeDir, mappings, output, stagingPlan) {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (MANAGED_SECTION_SKIP_DIRS.has(entry.name)) continue;
        walkManagedDir(path.join(absoluteDir, entry.name), `${relativeDir}/${entry.name}`, mappings, output, stagingPlan);
        continue;
      }
      if (!entry.isFile() || MANAGED_SECTION_SKIP_NAMES.has(entry.name)) continue;
      const childAbsolute = path.join(absoluteDir, entry.name);
      const relativePath = `${relativeDir}/${entry.name}`;
      if (entry.name.toLowerCase().endsWith(".json")) {
        const content = managedSiteJsonContent(childAbsolute, mappings, false);
        output.push({
          relativePath,
          localPath: childAbsolute,
          size: Buffer.byteLength(content, "utf8"),
          sha256: sha256Text(content),
          transform: "json-paths",
        });
        stagingPlan.set(relativePath, content);
      } else {
        const stat = fs.statSync(childAbsolute);
        output.push({ relativePath, localPath: childAbsolute, size: stat.size, sha256: sha256File(childAbsolute) });
      }
    }
  }

  function collectPlainTree(absoluteDir, relativePrefix, output) {
    if (!fs.existsSync(absoluteDir)) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const childAbsolute = path.join(absoluteDir, entry.name);
      const relativePath = `${relativePrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        collectPlainTree(childAbsolute, relativePath, output);
      } else if (entry.isFile()) {
        const stat = fs.statSync(childAbsolute);
        output.push({ relativePath, localPath: childAbsolute, size: stat.size, sha256: sha256File(childAbsolute) });
      }
    }
  }

  function buildManagedSitesPlan(options = {}, preset = "managed-sites") {
    const config = readSyncConfig();
    const sites = readSites();
    const selectedCodes = (options.sites || []).filter((code) => sites.some((site) => site.code === code));
    const selectedSections = (options.sections || []).filter((id) => MANAGED_SITE_SECTIONS.some((section) => section.id === id));
    const mappings = buildPathMappings(config, sites);
    const stagingPlan = new Map();
    const files = [];
    const notes = [];
    const warnings = [];
    const sharedAccountPaths = [];

    // Shared credentials belong to project configuration, not any one website.
    // Use an exact allowlist; never sweep the whole _shared directory.
    if (preset === 'project-config' && options.searchAccounts === true) {
      for (const [name, relativePath, valid] of [
        ['Google', 'managed-sites/_shared/google/service-account.json', value => Boolean(value.serviceAccount?.client_email && value.serviceAccount?.private_key)],
        ['Bing', 'managed-sites/_shared/bing/account.json', value => typeof value.apiKey === 'string' && Boolean(value.apiKey.trim())],
        ['Yandex', 'managed-sites/_shared/yandex/account.json', value => typeof value.oauthToken === 'string' && Boolean(value.oauthToken.trim())],
      ]) {
        const localPath = path.join(packageRoot, relativePath);
        if (!fs.existsSync(localPath)) {
          notes.push(`本地未配置共享 ${name} 账号，保留线上已有配置。`);
          continue;
        }
        let content;
        try {
          if (fs.lstatSync(localPath).isSymbolicLink()) throw new Error();
          content = fs.readFileSync(localPath, 'utf8');
          if (!valid(JSON.parse(content.replace(/^\uFEFF/, '')))) throw new Error();
        } catch {
          throw statusError(400, `本地共享 ${name} 账号文件无效，请在 SEO 页面重新保存后同步。`);
        }
        files.push({ relativePath, localPath, size: Buffer.byteLength(content), sha256: sha256Text(content), transform: 'shared-account' });
        stagingPlan.set(relativePath, content);
        sharedAccountPaths.push(relativePath);
      }
      notes.push('共享 Google / Bing / Yandex 账号会覆盖线上同名共享账号，并供线上使用共享账号的站点复用；不会改变站点域名、权限或专用账号设置。');
    }

    for (const code of selectedCodes) {
      const site = sites.find((item) => item.code === code);
      for (const sectionId of selectedSections) {
        const section = MANAGED_SITE_SECTIONS.find((item) => item.id === sectionId);
        collectManagedSection(site, section, mappings, files, stagingPlan);
      }
    }

    if (options.backendUploads === true) {
      collectPlainTree(path.join(packageRoot, "backend", "uploads"), "backend/uploads", files);
    }

    let aiPortable = null;
    if (options.aiKeys === true) {
      let raw = {};
      try {
        raw = JSON.parse(fs.readFileSync(aiConfigPath, "utf8").replace(/^\uFEFF/, ""));
      } catch (_error) {
        raw = {};
      }
      aiPortable = portableAiConfig(raw);
      if (aiPortable.hasKeys) {
        const content = `${JSON.stringify(aiPortable.config, null, 2)}\n`;
        const relativePath = "tools/seo_publish_tool/ai.config.json";
        files.push({
          relativePath,
          localPath: aiConfigPath,
          size: Buffer.byteLength(content, "utf8"),
          sha256: sha256Text(content),
          transform: "ai-portable",
        });
        stagingPlan.set(relativePath, content);
      } else {
        notes.push("ai.config.json 中没有已配置的模型密钥，未加入计划。");
      }
    }

    const manifest = readManifest("project", preset);
    const diff = diffAgainstManifest(files, manifest, { forceFull: options.forceFull === true });
    // removedSinceLastSync 只统计当前勾选范围内的节，未勾选的节不算“已删除”
    const scopePrefixes = [];
    for (const code of selectedCodes) {
      for (const sectionId of selectedSections) {
        const section = MANAGED_SITE_SECTIONS.find((item) => item.id === sectionId);
        scopePrefixes.push(`managed-sites/${code}/${section.file || section.dir}`.replace(/\/$/, ""));
      }
    }
    if (options.backendUploads === true) scopePrefixes.push("backend/uploads/");
    if (aiPortable?.hasKeys) scopePrefixes.push("tools/seo_publish_tool/ai.config.json");
    scopePrefixes.push(...sharedAccountPaths);
    const removedSinceLastSync = diff.removedSinceLastSync.filter(
      (entry) => scopePrefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`)),
    );
    diff.counts.removedSinceLastSync = removedSinceLastSync.length;

    const carriesSecrets = selectedSections.some((id) => ["ftp", "google", "seo"].includes(id)) || Boolean(aiPortable?.hasKeys) || sharedAccountPaths.length > 0;
    if (carriesSecrets && config.project.secure === false) {
      warnings.push("当前目标未启用 FTPS：FTP 密码、Google 凭据、模型密钥等将以明文传输，强烈建议在目标配置中选择 FTPS 加密。");
    }
    if (selectedSections.includes("siteFile")) {
      notes.push("服务器后端每次启动会用数据库内容重新生成 site.json，上传的 site.json 仅作参考/引导；要让站点档案生效需在服务器站点管理中修改。");
    }
    notes.push("JSON 配置会按目标配置中的服务器路径自动改写（本地站点根 → 服务器站点根、本地项目根 → 服务器项目根），密码与密钥原样保留。");

    const toUploadSize = diff.toUpload.reduce((sum, file) => sum + file.size, 0);
    return {
      preset,
      targetKey: "project",
      target: redactTarget(config.project),
      ready: targetReady(config.project),
      files,
      stagingPlan,
      counts: diff.counts,
      toUpload: diff.toUpload,
      toUploadSize,
      toUploadSizeText: formatBytes(toUploadSize),
      removedSinceLastSync,
      pathMappings: mappings.map((mapping) => ({ from: mapping.from, to: mapping.to })),
      lastSyncAt: manifest?.syncedAt || "",
      warnings,
      notes,
    };
  }

  // ---- 预设三：管理数据库（仅暂存） ----

  function localBackendDatabasePath() {
    let envText = "";
    try {
      envText = fs.readFileSync(backendEnvPath, "utf8");
    } catch (_error) {
      envText = "";
    }
    return databasePathFromEnvText(envText, path.join(packageRoot, "backend"));
  }

  function buildDatabasePlan(target) {
    const localPath = localBackendDatabasePath();
    if (!fs.existsSync(localPath)) {
      throw statusError(400, `找不到本地管理数据库：${localPath}（检查 backend/.env 的 DB_SQLJS_LOCATION）。`);
    }
    const stat = fs.statSync(localPath);
    const stamp = formatStamp();
    const remoteName = `pboot-admin-${stamp}.sqlite`;
    const plan = {
      preset: "database",
      targetKey: "project",
      target: redactTarget(target),
      ready: targetReady(target),
      localPath,
      remoteName,
      stamp,
      files: [],
      counts: { total: 1, fresh: 1, changed: 0, unchanged: 0, removedSinceLastSync: 0 },
      toUpload: [],
      toUploadSize: stat.size,
      toUploadSizeText: formatBytes(stat.size),
      removedSinceLastSync: [],
      lastSyncAt: "",
      warnings: [
        "只上传到服务器 data/sync-staging/ 目录，不会覆盖线上管理库；接管需按完成后的清单手动执行。",
        "本地后端运行时 sql.js 会整文件写回，建议先停止本地后端（stop.cmd）再执行，确保复制到的是完整库。",
      ],
      notes: [`上传后请在服务器端核对暂存文件：${remoteName} 与同名 .json 校验单。`],
    };
    return plan;
  }

  // ---- 预设四：PB 网站数据 ----

  const SITE_DATA_DEFAULT_EXCLUDE = [
    "pboot_admin*",
    "pboot_admin*/**",
    "**/node_modules/**",
    ".git/**",
    ".claude/**",
    "runtime/**",
    "cache/**",
    "backups/**",
    "logs/**",
    "data/*.before_*.db",
    "data/*.bad_*.db",
    "data/*.old*.db",
    "data/*.bak*.db",
    "data/*.backup*.db",
    "**/*.bak",
    "*.zip",
    "*.rar",
    "*.7z",
  ];

  function buildSiteDataPlan(siteCode, scope, target) {
    const sites = readSites();
    const site = sites.find((item) => item.code === (siteCode || currentSite()?.code));
    if (!site) throw statusError(400, "未找到指定的站点，请先在管理后台添加。");
    const config = {
      ...(readBaseFtpConfig ? readBaseFtpConfig() : {}),
      localRoot: site.rootPath,
      uploadScope: scope === "full" ? "full" : "site",
      uploadMode: "full",
      exclude: SITE_DATA_DEFAULT_EXCLUDE,
    };
    const files = collectFiles(config);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    return {
      preset: "site-data",
      targetKey: `site:${site.code}`,
      scope: config.uploadScope,
      site: { code: site.code, name: site.name, rootPath: site.rootPath },
      target: redactTarget(target),
      ready: targetReady(target),
      files,
      counts: { total: files.length, fresh: files.length, changed: 0, unchanged: 0, removedSinceLastSync: 0 },
      toUpload: files.map((file) => ({ ...file, action: "new" })),
      toUploadSize: totalSize,
      toUploadSizeText: formatBytes(totalSize),
      removedSinceLastSync: [],
      lastSyncAt: "",
      warnings: [],
      notes: [
        scope === "full"
          ? "整站镜像：包含 template/、config/ 等代码目录；runtime/、cache/、备份库仍会排除。代码与文本始终覆盖，同大小二进制跳过。"
          : "数据+图片：data/*.db、static/、uploads/；同大小图片自动跳过，远端同名文件会先下载备份。",
      ],
    };
  }

  function buildSyncPlan({ preset, siteCode, options = {} }) {
    const config = readSyncConfig();
    if (preset === "project-code") return buildProjectPlan(config.project, options);
    if (preset === "managed-sites") return buildManagedSitesPlan(options);
    if (preset === "project-config") return buildManagedSitesPlan({ ...options, sites: [], sections: [] }, preset);
    if (preset === "database") return buildDatabasePlan(config.project);
    if (preset === "site-data") {
      const code = siteCode || currentSite()?.code;
      const target = config.sites[code];
      if (!target) throw statusError(400, `站点 ${code || "(未选择)"} 还没有同步目标，请先在上方目标配置中填写。`);
      return buildSiteDataPlan(code, options.scope, target);
    }
    throw statusError(400, `未知的同步预设：${preset}`);
  }

  // ---- 执行 ----

  function readHistory() {
    try {
      const history = JSON.parse(fs.readFileSync(path.join(syncStateRoot, "history.json"), "utf8"));
      return Array.isArray(history) ? history : [];
    } catch (_error) {
      return [];
    }
  }

  function appendHistory(entry) {
    const history = readHistory();
    history.unshift(entry);
    writeManifestAtomic(path.join(syncStateRoot, "history.json"), history.slice(0, 30));
  }

  function ftpConfigFor(target, { backupBeforeOverwrite }) {
    return {
      host: target.host,
      networkInterface: target.networkInterface || '',
      port: Number(target.port || 21),
      user: target.user,
      password: target.password,
      secure: Boolean(target.secure),
      remoteRoot: target.remoteRoot || "/",
      skipSameSizeAssets: true,
      backupBeforeOverwrite,
      backupMaxFileSizeMb: 20,
      reconnectEvery: 80,
      maxRetries: 4,
      timeoutMs: 45000,
    };
  }

  // 异步执行一个同步任务；通过 hooks 回报进度。返回 Promise<{result, checklist}>。
  async function runSyncPlan(plan, options = {}, hooks = {}) {
    const config = readSyncConfig();
    let target;
    let ftpConfig;
    let uploadEntries = [];
    const stagingDir = path.join(syncStateRoot, "staging", plan.stamp || formatStamp());

    if (plan.preset === "site-data") {
      target = config.sites[plan.targetKey.slice("site:".length)];
      if (!target) throw statusError(400, "站点同步目标不存在，请重新保存目标配置。");
      ftpConfig = {
        ...(readBaseFtpConfig ? readBaseFtpConfig() : {}),
        ...ftpConfigFor(target, { backupBeforeOverwrite: options.backupBeforeOverwrite !== false }),
        localRoot: plan.site.rootPath,
        uploadScope: plan.scope === "full" ? "full" : "site",
      };
      uploadEntries = plan.files;
    } else {
      target = config.project;
      ftpConfig = ftpConfigFor(target, {
        backupBeforeOverwrite: plan.preset === "managed-sites"
          ? options.backupBeforeOverwrite !== false
          : options.backupBeforeOverwrite === true,
      });
      if (plan.preset === "database") {
        fs.mkdirSync(stagingDir, { recursive: true });
        const stagedDb = path.join(stagingDir, plan.remoteName);
        fs.copyFileSync(plan.localPath, stagedDb);
        const stagedSha = sha256File(stagedDb);
        const sidecar = {
          type: "pboot-admin-sync-staging",
          version: 1,
          sourceSha256: stagedSha,
          size: fs.statSync(stagedDb).size,
          exportedAt: new Date().toISOString(),
          sourceEnvironment: "local",
          note: "暂存文件：不会自动覆盖线上库。接管步骤见 FTP 工具「宝塔同步」页面完成清单。",
        };
        const sidecarPath = path.join(stagingDir, `${plan.remoteName}.json`);
        fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
        uploadEntries = [
          { localPath: stagedDb, relativePath: `data/sync-staging/${plan.remoteName}`, size: sidecar.size },
          { localPath: sidecarPath, relativePath: `data/sync-staging/${plan.remoteName}.json`, size: fs.statSync(sidecarPath).size },
        ];
      } else {
        // project-code / managed-sites：变换类文件先落到本地暂存目录再上传
        const stagingPlan = plan.stagingPlan;
        if (stagingPlan && stagingPlan.size) {
          fs.mkdirSync(stagingDir, { recursive: true });
        }
        uploadEntries = plan.toUpload.map((file) => {
          const content = stagingPlan?.get(file.relativePath);
          if (content === undefined) return file;
          const stagedPath = path.join(stagingDir, file.relativePath.replace(/\.\./g, "__"));
          fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
          fs.writeFileSync(stagedPath, content, "utf8");
          return { ...file, localPath: stagedPath };
        });
      }
    }

    if (!targetReady(target)) {
      throw statusError(400, "同步目标缺少 FTP 地址、用户名或密码，请先在目标配置中填写并保存。");
    }
    if (!uploadEntries.length && plan.preset !== "project-code") {
      throw statusError(400, "没有需要上传的文件（内容与上次同步一致）。");
    }

    let checklist = null;
    try {
      const result = uploadEntries.length ? await uploadFiles(ftpConfig, uploadEntries, {
        clientFactory: hooks.clientFactory,
        onConnect: (event) => hooks.onLog?.(event?.reason === "retry" ? "FTP 重新连接成功。" : "FTP 已连接。"),
        onReconnect: (event) => hooks.onLog?.(`连接保持：即将处理 ${event.file.relativePath}`),
        onRetry: (event) => hooks.onLog?.(`重试 ${event.attempt}/${event.maxRetries}：${event.file.relativePath}`),
        onBackup: (event) => {
          hooks.onBackup?.(event);
          hooks.onLog?.(`覆盖前已备份远端文件：${event.file.relativePath}`);
        },
        onBackupSkipped: (event) => hooks.onLog?.(`远端文件过大，跳过备份：${event.file.relativePath}`),
        onProgress: (event) => hooks.onProgress?.(event),
      }) : { uploaded: 0, skipped: 0, backedUp: 0, backupRoot: "" };

      if (["project-code", "managed-sites", "project-config"].includes(plan.preset)) {
        writeManifest(plan.targetKey, plan.preset, plan.files, new Date().toISOString());
      }

      let phase = 'complete';
      if (plan.preset === 'project-code' && target.btPanel?.autoBuild) {
        if (!target.btPanel.url || !target.btPanel.user || !target.btPanel.password) throw new Error('代码已上传，但自动上线缺少宝塔连接信息，请展开连接设置补齐后重试。');
        hooks.onPhase?.('building');
        hooks.onLog?.('代码已上传，开始线上构建和重启。');
        const buildResult = await (hooks.remoteBuild || executeRemoteBuild)(target, hooks);
        checklist = { title: '已上线', steps: ['前后端构建完成，服务重启和健康检查通过。'], code: buildResult.log };
      } else if (plan.preset === 'project-code') {
        phase = 'awaiting-build';
        checklist = PROJECT_CHECKLIST(config.project.serverProjectRoot);
      } else if (plan.preset === "database") {
        checklist = DATABASE_CHECKLIST(plan.remoteName, config.project.serverProjectRoot);
      } else if (["managed-sites", "project-config"].includes(plan.preset)) {
        checklist = {
          title: "配置同步完成",
          steps: plan.files.every(file => file.transform === 'shared-account') ? [
            'Google / Bing 共享账号已同步，刷新线上 SEO 页面即可读取，无需重启或更新数据库。',
            '使用专用账号或已停用账号的站点保持原设置；各网站仍需在搜索引擎账号内获得权限。',
          ] : [
            "如修改了 seo/ftp/google 配置，在宝塔 PM2 面板重启 pboot-seo-tool / pboot-ftp-tool 使配置生效。",
            "服务器后端启动时会按数据库重新生成 site.json；站点路径请在服务器「站点管理」中核对。",
          ],
          code: plan.files.every(file => file.transform === 'shared-account') ? '' : "pm2 restart pboot-seo-tool pboot-ftp-tool",
        };
      } else {
        checklist = {
          title: "网站数据同步完成",
          steps: ["打开线上网站核对页面与图片是否正常。", "如有发布缓存，清空 PB 后台缓存后复核。"],
          code: "",
        };
      }
      return { result, checklist, phase };
    } finally {
      try {
        if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch (_error) {
        // 暂存目录清理失败不影响同步结果
      }
    }
  }

  async function executeRemoteBuild(target, hooks = {}) {
    const { createBtPanel, runRemoteBuild } = require('./bt-panel');
    const panel = createBtPanel({ ...target.btPanel, networkInterface: target.networkInterface });
    return runRemoteBuild(panel, target.serverProjectRoot, hooks);
  }

  return {
    MANAGED_SITE_SECTIONS,
    readSyncConfig,
    writeSyncConfig,
    publicSyncConfig,
    normalizeTargetInput,
    targetReady,
    buildSyncPlan,
    runSyncPlan,
    readHistory,
    appendHistory,
    localBackendDatabasePath,
    collectProjectFiles,
    executeRemoteBuild,
  };
}

module.exports = {
  createSyncEngine,
  localSyncEnvironment,
  assertLocalSyncEnvironment,
  assertSyncNotBusy,
  isPublishable,
  mapPathsValue,
  portableAiConfig,
  databasePathFromEnvText,
  MANAGED_SITE_SECTIONS,
};
