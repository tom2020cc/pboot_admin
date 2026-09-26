const http = require("http");
const fs = require("fs");
const path = require("path");
const ftp = require("basic-ftp");
const { createFtpClient, networkInterfaces } = require('./ftp-client');
const siteRuntime = require("../site-runtime");
const { buildPublicNavigation } = require("../public-navigation");
const { deploymentEnvironment } = require('../deployment-environment');
const { readConfig, writeConfig, collectFiles, formatBytes, uploadFiles } = require("./upload-to-ftp");
const { createSyncEngine, assertSyncNotBusy } = require("./sync-engine");
const { createFileBrowser, listLocal, listRemote } = require('./file-browser');
const fileBrowser = createFileBrowser();
const {
  appendHistory,
  baselineInfo,
  buildBaseline,
  createLocalHardeningFiles,
  downloadEvidence,
  publicScanResult,
  readBaseline,
  readHistory,
  scanRemoteSite,
  siteFingerprint,
  writeBaseline,
} = require("./security-monitor");

const TOOL_ROOT = __dirname;
const PACKAGE_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const PUBLIC_ROOT = path.join(TOOL_ROOT, "public");
const PORT = Number(process.env.FTP_TOOL_PORT || 5189);
const BACKEND_ENV_PATH = path.join(PACKAGE_ROOT, "backend", ".env");
const SEO_CONFIG_PATH = path.join(PACKAGE_ROOT, "tools", "seo_publish_tool", "seo.config.json");
const BASELINE_CANDIDATE_PATH = path.join(TOOL_ROOT, "security-baseline-candidate.json");
const SECURITY_CHECKPOINT_PATH = path.join(TOOL_ROOT, "security-scan-checkpoint.json");

function currentBaselineCandidatePath() {
  return siteRuntime.siteFile("ftp", "security-baseline-candidate.json", BASELINE_CANDIDATE_PATH);
}

function currentSecurityCheckpointPath() {
  return siteRuntime.siteFile("ftp", "security-scan-checkpoint.json", SECURITY_CHECKPOINT_PATH);
}

function currentSeoConfigPath() {
  return siteRuntime.siteFile("seo", "seo.config.json", SEO_CONFIG_PATH);
}

const uploadState = {
  running: false,
  total: 0,
  uploaded: 0,
  skipped: 0,
  backedUp: 0,
  backupRoot: "",
  failed: 0,
  current: "",
  startedAt: "",
  finishedAt: "",
  error: "",
  cancelRequested: false,
  scope: "site",
  logs: [],
};

const securityState = {
  running: false,
  mode: "scan",
  scanType: "incremental",
  reason: "manual",
  stage: "idle",
  current: 0,
  total: 0,
  currentPath: "",
  contentScanned: 0,
  mediaMetadataOnly: 0,
  resumedFiles: 0,
  checkpointedFiles: 0,
  startedAt: "",
  finishedAt: "",
  error: "",
  baselineBlocked: false,
  baselineUpdated: false,
  result: null,
  logs: [],
};

const monitorTimers = new Map();
const serverSecurity = require('./server-security').createServerSecurity({ busy: () => uploadState.running || securityState.running || syncState.running || databaseActions.isRunning() || domainCheck.isRunning() });

// 本地 → 宝塔同步（仅本地环境；路由层有 APP_ENVIRONMENT=local 守卫）
const syncEngine = createSyncEngine({ readBaseFtpConfig: () => readConfig() });
const syncState = {
  running: false,
  preset: "",
  targetKey: "",
  phase: "idle",
  total: 0,
  uploaded: 0,
  skipped: 0,
  backedUp: 0,
  backupRoot: "",
  current: "",
  startedAt: "",
  finishedAt: "",
  error: "",
  checklist: null,
  logs: [],
};
const databaseActions = require('./database-actions').createDatabaseActions({
  engine: syncEngine,
  busy: () => syncState.running || uploadState.running || securityState.running || serverSecurity.isRunning() || domainCheck.isRunning(),
});
const domainCheck = require('./domain-check').createDomainCheck({
  engine: syncEngine,
  busy: () => syncState.running || uploadState.running || securityState.running || serverSecurity.isRunning() || databaseActions.isRunning(),
});

function pushSyncLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  syncState.logs.push(line);
  if (syncState.logs.length > 300) syncState.logs.shift();
}

function readSecurityCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(currentSecurityCheckpointPath(), "utf8"));
  } catch (_error) {
    return null;
  }
}

function saveSecurityCheckpoint(checkpoint) {
  const checkpointPath = currentSecurityCheckpointPath();
  const tempPath = `${checkpointPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(checkpoint)}\n`, "utf8");
  try {
    fs.renameSync(tempPath, checkpointPath);
  } catch (_error) {
    fs.rmSync(checkpointPath, { force: true });
    fs.renameSync(tempPath, checkpointPath);
  }
}

function clearSecurityCheckpoint() {
  const checkpointPath = currentSecurityCheckpointPath();
  fs.rmSync(checkpointPath, { force: true });
  fs.rmSync(`${checkpointPath}.tmp`, { force: true });
}

function securityCheckpointInfo(config = readConfig(), baseline = readBaseline()) {
  const checkpoint = readSecurityCheckpoint();
  if (!checkpoint) return { exists: false, valid: false, processedFiles: 0 };
  const fingerprint = siteFingerprint(config);
  const baselineIdentity = baseline && baseline.fingerprint === fingerprint
    ? `${baseline.fingerprint}|${baseline.createdAt || ""}`
    : "";
  const processedFiles = Object.keys(checkpoint.processed || {}).length;
  const valid = Boolean(
    Number(checkpoint.version || 0) === 1
    && checkpoint.fingerprint === fingerprint
    && String(checkpoint.baselineIdentity || "") === baselineIdentity,
  );
  return {
    exists: true,
    valid,
    processedFiles,
    scanType: checkpoint.scanType || "full",
    mode: checkpoint.mode || "scan",
    startedAt: checkpoint.startedAt || "",
    updatedAt: checkpoint.updatedAt || "",
  };
}

function readBaselineCandidate() {
  try {
    return JSON.parse(fs.readFileSync(currentBaselineCandidatePath(), "utf8"));
  } catch (_error) {
    return null;
  }
}

function saveBaselineCandidate(result) {
  fs.writeFileSync(currentBaselineCandidatePath(), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function clearBaselineCandidate() {
  fs.rmSync(currentBaselineCandidatePath(), { force: true });
}

const latestCompletedScans = new Map();

function latestCompletedScan() {
  const key = siteRuntime.currentSite()?.code || "default";
  if (!latestCompletedScans.has(key)) latestCompletedScans.set(key, readBaselineCandidate());
  return latestCompletedScans.get(key);
}

function setLatestCompletedScan(value) {
  latestCompletedScans.set(siteRuntime.currentSite()?.code || "default", value);
}

function pushLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  uploadState.logs.push(line);
  if (uploadState.logs.length > 400) uploadState.logs.shift();
}

function pushSecurityLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  securityState.logs.push(line);
  if (securityState.logs.length > 300) securityState.logs.shift();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function publicConfig(config) {
  return {
    ...config,
    password: "",
    passwordSet: Boolean(config.password),
  };
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return fs.readFileSync(file, "utf8").split(/\r?\n/).reduce((result, line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function buildNavigation() {
  const env = parseEnvFile(BACKEND_ENV_PATH);
  let seo = {};
  try {
    seo = JSON.parse(fs.readFileSync(currentSeoConfigPath(), "utf8"));
  } catch (_error) {
    seo = {};
  }
  const backendPort = Number(env.BACKEND_PORT || 5000);
  const frontendPort = Number(env.FRONTEND_PORT || 5178);
  const seoPort = Number(process.env.SEO_TOOL_PORT || env.SEO_TOOL_PORT || seo.localPort || 5188);
  return buildPublicNavigation({ ...env, ...process.env },
    { backendPort, frontendPort, seoPort, ftpPort: PORT }, "ftp", siteRuntime.withSiteQuery);
}

function normalizeConfigInput(body, current) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const next = {
    ...current,
    host: typeof body.host === "string" ? body.host.trim() : current.host,
    networkInterface: typeof body.networkInterface === 'string' ? body.networkInterface.trim() : current.networkInterface || '',
    port: Number(body.port || current.port || 21),
    user: typeof body.user === "string" ? body.user.trim() : current.user,
    secure: has("secure") ? Boolean(body.secure) : Boolean(current.secure),
    remoteRoot: typeof body.remoteRoot === "string" ? body.remoteRoot.trim() || "/" : current.remoteRoot,
    uploadScope: body.uploadScope === "seo" || body.uploadScope === "full" ? body.uploadScope : "site",
    uploadMode: body.uploadMode === "full" ? "full" : "quick",
    recentImageDays: Math.max(1, Number(body.recentImageDays || current.recentImageDays || 14)),
    skipSameSizeAssets: has("skipSameSizeAssets") ? body.skipSameSizeAssets !== false : current.skipSameSizeAssets !== false,
    uploadDatabase: has("uploadDatabase") ? body.uploadDatabase !== false : current.uploadDatabase !== false,
    uploadImages: has("uploadImages") ? body.uploadImages !== false : current.uploadImages !== false,
    backupBeforeOverwrite: has("backupBeforeOverwrite") ? body.backupBeforeOverwrite !== false : current.backupBeforeOverwrite !== false,
    backupMaxFileSizeMb: Math.max(1, Number(body.backupMaxFileSizeMb || current.backupMaxFileSizeMb || 20)),
    securityMonitorEnabled: has("securityMonitorEnabled") ? Boolean(body.securityMonitorEnabled) : Boolean(current.securityMonitorEnabled),
    securityIntervalMinutes: Math.max(5, Number(body.securityIntervalMinutes || current.securityIntervalMinutes || 360)),
    securityFullScanIntervalDays: Math.max(1, Number(body.securityFullScanIntervalDays || current.securityFullScanIntervalDays || 7)),
    securityMaxFileSizeKb: Math.max(64, Number(body.securityMaxFileSizeKb || current.securityMaxFileSizeKb || 2048)),
    securityMaxFiles: Math.max(100, Number(body.securityMaxFiles || current.securityMaxFiles || 30000)),
  };
  if (typeof body.password === "string" && body.password.trim()) {
    next.password = body.password;
  }
  return next;
}

function normalizeRemoteRootForCd(remoteRoot) {
  const value = String(remoteRoot || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return value && value !== "." ? value : "";
}

function buildPlan() {
  const config = readConfig();
  const files = collectFiles(config);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const groups = files.reduce((acc, file) => {
    const head = file.relativePath.split("/")[0] || "root";
    if (!acc[head]) acc[head] = { count: 0, size: 0 };
    acc[head].count += 1;
    acc[head].size += file.size;
    return acc;
  }, {});
  return {
    config: publicConfig(config),
    localRoot: path.resolve(TOOL_ROOT, config.localRoot),
    remoteRoot: config.remoteRoot,
    uploadScope: config.uploadScope || "site",
    uploadMode: config.uploadMode || "quick",
    recentImageDays: Number(config.recentImageDays || 14),
    total: files.length,
    totalSize,
    totalSizeText: formatBytes(totalSize),
    groups: Object.entries(groups).map(([name, value]) => ({ name, count: value.count, size: value.size, sizeText: formatBytes(value.size) })),
    files: files.slice(0, 300).map((file) => ({ relativePath: file.relativePath, size: file.size, sizeText: formatBytes(file.size) })),
    truncated: files.length > 300,
  };
}

async function testFtpConnection(config) {
  const client = createFtpClient(config, 15000);
  try {
    await client.access({
      host: config.host,
      port: Number(config.port || 21),
      user: config.user,
      password: config.password,
      secure: Boolean(config.secure),
      // 宝塔 pure-ftpd 自签证书：保留加密，不校验证书链
      ...(config.secure ? { secureOptions: { rejectUnauthorized: false } } : {}),
    });
    const loginDir = await client.pwd().catch(() => "");
    const remoteRoot = normalizeRemoteRootForCd(config.remoteRoot);
    if (remoteRoot) {
      await client.cd(remoteRoot);
    }
    const currentDir = await client.pwd().catch(() => "");
    const list = await client.list();
    return {
      ok: true,
      message: "FTP connection ok.",
      loginDir,
      currentDir,
      items: list.slice(0, 20).map((item) => ({ name: item.name, type: item.type, size: item.size })),
    };
  } finally {
    client.close();
  }
}

function startUpload(scopeOverride = "", selected = null) {
  if (domainCheck.isRunning()) throw new Error('域名上线检测正在运行');
  if (databaseActions.isRunning()) throw new Error("数据库维护正在执行");
  if (databaseActions.isRunning()) throw new Error("数据库维护正在执行");
  if (serverSecurity.isRunning()) throw new Error('宝塔服务器巡检正在运行，请先停止巡检。');
  if (uploadState.running) throw new Error("Upload is already running.");
  if (securityState.running) throw new Error("安全巡检正在运行，请等待扫描完成后再发布。");
  if (syncState.running) throw new Error("宝塔同步正在运行，请等待同步完成。");
  const savedConfig = readConfig();
  const config = selected?.config || {
    ...savedConfig,
    uploadScope: scopeOverride === "seo" ? "seo" : savedConfig.uploadScope || "site",
  };
  if (!config.host || !config.user || !config.password) {
    throw new Error("Please fill FTP host, user and password first.");
  }
  const files = selected?.files || collectFiles(config);
  if (!files.length) throw new Error("No files to upload.");

  uploadState.running = true;
  uploadState.total = files.length;
  uploadState.uploaded = 0;
  uploadState.skipped = 0;
  uploadState.backedUp = 0;
  uploadState.backupRoot = "";
  uploadState.failed = 0;
  uploadState.current = "";
  uploadState.startedAt = new Date().toISOString();
  uploadState.finishedAt = "";
  uploadState.error = "";
  uploadState.scope = config.uploadScope;
  uploadState.siteId = Number(siteRuntime.currentSite()?.id || 0);
  uploadState.logs = [];
  pushLog(`Upload started. ${files.length} files, ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}.`);
  pushLog(`Remote root: ${config.remoteRoot || "/"}; relative upload mode enabled.`);
  pushLog(
    config.uploadScope === "seo"
      ? "Upload scope: SEO files only."
      : config.uploadScope === "full"
        ? "Upload scope: 整站上传（代码/文本始终覆盖，图片等同大小跳过）。"
        : `Upload mode: ${config.uploadMode === "full" ? "full check" : `quick, recent ${config.recentImageDays || 14} days`}.`,
  );

  uploadFiles(config, files, {
    beforeFile: selected?.beforeFile,
    onConnect: (event) => {
      if (event?.reason === "retry") pushLog("FTP reconnected after server closed the connection.");
      else if (event?.reason === "scheduled") pushLog("FTP reconnected automatically to keep the session fresh.");
      else pushLog("FTP connected.");
    },
    onReconnect: (event) => {
      pushLog(`Refreshing FTP connection before ${event.file.relativePath}.`);
    },
    onRetry: (event) => {
      pushLog(`Retry ${event.attempt}/${event.maxRetries} after FTP disconnect: ${event.file.relativePath}`);
    },
    onBackup: (event) => {
      uploadState.backedUp = event.backedUp;
      uploadState.backupRoot = event.backupRoot;
      pushLog(`Backed up remote file before overwrite: ${event.file.relativePath}`);
    },
    onBackupSkipped: (event) => {
      pushLog(`Backup skipped because remote file is too large: ${event.file.relativePath}`);
    },
    onProgress: (event) => {
      uploadState.uploaded = event.uploaded;
      uploadState.skipped = event.skipped;
      uploadState.backedUp = event.backedUp;
      uploadState.current = event.file.relativePath;
      pushLog(`${event.action === "skipped" ? "Skipped" : "Uploaded"} ${event.file.relativePath}`);
    },
  })
    .then((result) => {
      uploadState.running = false;
      uploadState.uploaded = result.uploaded;
      uploadState.skipped = result.skipped;
      uploadState.backedUp = result.backedUp;
      uploadState.backupRoot = result.backupRoot;
      uploadState.finishedAt = new Date().toISOString();
      pushLog(`Upload completed. Uploaded: ${result.uploaded}, skipped: ${result.skipped}, backed up: ${result.backedUp}.`);
    })
    .catch((error) => {
      uploadState.running = false;
      uploadState.failed = 1;
      uploadState.error = error.message || String(error);
      uploadState.finishedAt = new Date().toISOString();
      pushLog(`Upload failed: ${uploadState.error}`);
    });
}

function publicSyncPlan(plan) {
  const toUpload = (plan.toUpload || []).slice(0, 300).map((file) => ({
    relativePath: file.relativePath,
    action: file.action,
    size: file.size,
    sizeText: formatBytes(file.size),
  }));
  return {
    preset: plan.preset,
    targetKey: plan.targetKey,
    target: plan.target,
    ready: plan.ready,
    site: plan.site || null,
    localPath: plan.localPath || "",
    remoteName: plan.remoteName || "",
    counts: plan.counts,
    toUploadCount: (plan.toUpload || []).length,
    toUploadSize: plan.toUploadSize,
    toUploadSizeText: plan.toUploadSizeText,
    files: toUpload,
    truncated: (plan.toUpload || []).length > 300,
    removedSinceLastSync: (plan.removedSinceLastSync || []).slice(0, 100),
    pathMappings: plan.pathMappings || [],
    lastSyncAt: plan.lastSyncAt || "",
    warnings: plan.warnings || [],
    notes: plan.notes || [],
  };
}

function startSync({ preset, siteCode, options = {} }) {
  if (syncState.running) {
    throw Object.assign(new Error("同步任务正在运行，请等待完成。"), { statusCode: 409 });
  }
  assertSyncNotBusy({
    uploadRunning: uploadState.running,
    securityRunning: securityState.running,
    serverSecurityRunning: serverSecurity.isRunning(),
  });
  const plan = syncEngine.buildSyncPlan({ preset, siteCode, options });

  const totalEstimate = plan.preset === "database" ? 2 : (plan.toUpload || []).length;
  Object.assign(syncState, {
    running: true,
    preset,
    targetKey: plan.targetKey,
    phase: "uploading",
    total: totalEstimate,
    uploaded: 0,
    skipped: 0,
    backedUp: 0,
    backupRoot: "",
    current: "",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    error: "",
    checklist: null,
    logs: [],
  });
  pushSyncLog(`同步开始：${preset}（${plan.targetKey}），待上传 ${totalEstimate} 项，${plan.toUploadSizeText || ""}。`);
  for (const warning of plan.warnings || []) pushSyncLog(`注意：${warning}`);

  syncEngine.runSyncPlan(plan, options, {
    onLog: (message) => pushSyncLog(message),
    onPhase: (phase) => { syncState.phase = phase; syncState.current = ""; },
    onBackup: (event) => {
      syncState.backedUp = event.backedUp;
      syncState.backupRoot = event.backupRoot;
    },
    onProgress: (event) => {
      syncState.uploaded = event.uploaded;
      syncState.skipped = event.skipped;
      syncState.backedUp = event.backedUp;
      syncState.total = Number(event.total || syncState.total || 0);
      syncState.current = event.file?.relativePath || "";
      pushSyncLog(`${event.action === "skipped" ? "跳过" : "上传"} ${syncState.current}`);
    },
  })
    .then(({ result, checklist, phase }) => {
      syncState.running = false;
      syncState.phase = phase || "complete";
      syncState.uploaded = result.uploaded;
      syncState.skipped = result.skipped;
      syncState.backedUp = result.backedUp;
      syncState.backupRoot = result.backupRoot;
      syncState.finishedAt = new Date().toISOString();
      syncState.checklist = checklist;
      pushSyncLog(`同步完成：上传 ${result.uploaded}，跳过 ${result.skipped}，覆盖前备份 ${result.backedUp}。`);
      syncEngine.appendHistory({
        preset,
        targetKey: plan.targetKey,
        startedAt: syncState.startedAt,
        finishedAt: syncState.finishedAt,
        uploaded: result.uploaded,
        skipped: result.skipped,
        backedUp: result.backedUp,
        error: "",
      });
    })
    .catch((error) => {
      syncState.running = false;
      syncState.phase = "error";
      syncState.error = error.message || String(error);
      syncState.finishedAt = new Date().toISOString();
      pushSyncLog(`同步失败：${syncState.error}`);
      syncEngine.appendHistory({
        preset,
        targetKey: plan.targetKey,
        startedAt: syncState.startedAt,
        finishedAt: syncState.finishedAt,
        uploaded: syncState.uploaded,
        skipped: syncState.skipped,
        backedUp: syncState.backedUp,
        error: syncState.error,
      });
    });
}

function securityStatus() {
  const config = readConfig();
  const baseline = readBaseline();
  const currentFingerprint = siteFingerprint(config);
  return {
    ...securityState,
    baseline: baselineInfo(baseline),
    checkpoint: securityCheckpointInfo(config, baseline),
    canAdoptBaseline: Boolean(
      latestCompletedScan()
      && latestCompletedScan().scanType === "full"
      && latestCompletedScan().summary?.high === 0
      && latestCompletedScan().fingerprint === currentFingerprint
    ),
    history: readHistory().slice(0, 12),
    monitor: {
      enabled: Boolean(config.securityMonitorEnabled),
      intervalMinutes: Number(config.securityIntervalMinutes || 360),
      fullScanIntervalDays: Number(config.securityFullScanIntervalDays || 7),
      secureFtp: Boolean(config.secure),
      backupBeforeOverwrite: config.backupBeforeOverwrite !== false,
    },
  };
}

function startSecurityScan({ mode = "scan", scanType = "incremental", allowFindings = false, reason = "manual", resume = false } = {}) {
  if (domainCheck.isRunning()) throw new Error('域名上线检测正在运行');
  if (databaseActions.isRunning()) throw new Error("数据库维护正在执行");
  if (serverSecurity.isRunning()) throw new Error('宝塔服务器巡检正在运行，请先停止巡检。');
  if (securityState.running) throw new Error("安全巡检已经在运行。");
  if (uploadState.running) throw new Error("FTP 发布正在运行，请等待发布完成后再扫描。");
  if (syncState.running) throw new Error("宝塔同步正在运行，请等待同步完成。");
  const config = readConfig();
  const baseline = readBaseline();
  const savedCheckpoint = resume ? readSecurityCheckpoint() : null;
  const savedCheckpointInfo = resume ? securityCheckpointInfo(config, baseline) : null;
  if (resume && (!savedCheckpoint || !savedCheckpointInfo.valid)) {
    throw new Error("上次巡检断点不存在或已失效，请清除断点后重新巡检。");
  }
  if (resume) {
    mode = savedCheckpoint.mode === "baseline" ? "baseline" : "scan";
    scanType = savedCheckpoint.scanType === "incremental" ? "incremental" : "full";
    allowFindings = savedCheckpoint.allowFindings === true;
    reason = "resume";
  }
  const actualScanType = mode === "baseline" || scanType === "full" || !baseline ? "full" : "incremental";
  if (!config.host || !config.user || !config.password) {
    throw new Error("请先完整配置 FTP 地址、用户名和密码。");
  }
  if (!resume) clearSecurityCheckpoint();

  Object.assign(securityState, {
    running: true,
    mode,
    scanType: actualScanType,
    reason,
    stage: "connecting",
    current: 0,
    total: 0,
    currentPath: "",
    contentScanned: 0,
    mediaMetadataOnly: 0,
    resumedFiles: 0,
    checkpointedFiles: resume ? savedCheckpointInfo.processedFiles : 0,
    startedAt: resume ? savedCheckpoint.startedAt : new Date().toISOString(),
    finishedAt: "",
    error: "",
    cancelRequested: false,
    baselineBlocked: false,
    baselineUpdated: false,
    result: null,
    logs: [],
  });
  pushSecurityLog(
    resume
      ? `继续上次${actualScanType === "full" ? "完整巡检" : "增量快检"}，已有 ${savedCheckpointInfo.processedFiles} 个文件断点。`
      : mode === "baseline"
      ? "可信基线完整扫描开始。"
      : reason === "scheduled"
        ? `${actualScanType === "full" ? "定时完整复核" : "定时增量快检"}开始。`
        : `${actualScanType === "full" ? "手动完整复核" : "手动增量快检"}开始。`,
  );

  scanRemoteSite(config, {
    baseline,
    scanType: actualScanType,
    resumeState: savedCheckpoint,
    shouldCancel: () => securityState.cancelRequested,
    onConnection: (event) => {
      if (event.reason === "retry") pushSecurityLog("FTP 已重新连接，继续当前巡检。");
      else if (event.reason === "scheduled") pushSecurityLog("FTP 已主动刷新连接，继续巡检。");
      else if (securityState.stage === "listing") pushSecurityLog("FTP 已连接，继续读取远端目录。");
      else pushSecurityLog("FTP 已连接，继续当前巡检。");
    },
    onRetry: (event) => {
      const target = event.path ? `：${event.path}` : "";
      pushSecurityLog(`FTP ${event.stage === "listing" ? "目录读取" : "文件读取"}超时，正在自动重连 ${event.attempt}/${event.maxRetries}${target}`);
    },
    onProgress: (event) => {
      securityState.stage = event.stage || securityState.stage;
      securityState.current = Number(event.current || event.files || securityState.current || 0);
      securityState.total = Number(event.total || securityState.total || 0);
      securityState.currentPath = event.path || securityState.currentPath;
      securityState.contentScanned = Number(event.contentScanned || securityState.contentScanned || 0);
      securityState.mediaMetadataOnly = Number(event.mediaMetadataOnly || securityState.mediaMetadataOnly || 0);
      securityState.resumedFiles = Number(event.resumedFiles || securityState.resumedFiles || 0);
    },
    onCheckpoint: (checkpoint) => {
      const saved = { ...checkpoint, mode, allowFindings, reason };
      saveSecurityCheckpoint(saved);
      securityState.checkpointedFiles = Object.keys(saved.processed || {}).length;
    },
  })
    .then((result) => {
      clearSecurityCheckpoint();
      appendHistory(result);
      if (result.scanType === "full") {
        setLatestCompletedScan(result);
        if (result.summary.high === 0) saveBaselineCandidate(result);
        else clearBaselineCandidate();
      } else {
        setLatestCompletedScan(null);
        clearBaselineCandidate();
      }
      let baselineBlocked = false;
      let baselineUpdated = false;
      if (mode === "baseline") {
        if (result.summary.high > 0 && !allowFindings) {
          baselineBlocked = true;
          pushSecurityLog(`发现 ${result.summary.high} 项高风险问题，可信基线未更新。`);
        } else {
          writeBaseline(buildBaseline(result));
          setLatestCompletedScan(null);
          clearBaselineCandidate();
          baselineUpdated = true;
          pushSecurityLog(`可信基线已更新，共记录 ${result.summary.files} 个远端文件。`);
        }
      }

      securityState.running = false;
      securityState.stage = "complete";
      securityState.current = result.summary.files;
      securityState.total = result.summary.files;
      securityState.currentPath = "";
      securityState.finishedAt = result.finishedAt;
      securityState.baselineBlocked = baselineBlocked;
      securityState.baselineUpdated = baselineUpdated;
      securityState.result = { ...publicScanResult(result), baselineBlocked, baselineUpdated };
      pushSecurityLog(`巡检完成：深查 ${result.summary.contentScanned}，普通图片元数据核对 ${result.summary.mediaMetadataOnly}，断点复用 ${result.summary.resumedFiles}，高风险 ${result.summary.high}，需关注 ${result.summary.medium}。`);
    })
    .catch((error) => {
      securityState.running = false;
      securityState.stage = error.code === "SCAN_CANCELLED" ? "cancelled" : "error";
      securityState.error = error.code === "SCAN_CANCELLED" ? "" : error.message || String(error);
      securityState.finishedAt = new Date().toISOString();
      const checkpoint = securityCheckpointInfo();
      pushSecurityLog(error.code === "SCAN_CANCELLED"
        ? `巡检已暂停，远端文件未做任何修改。已保存 ${checkpoint.processedFiles || 0} 个文件断点。`
        : `巡检失败：${securityState.error}。${checkpoint.valid ? `已保存 ${checkpoint.processedFiles} 个文件断点，可继续巡检。` : ""}`);
    });

  return securityStatus();
}

function scheduleSecurityMonitor() {
  const siteKey = siteRuntime.currentSite()?.code || "default";
  const existingTimer = monitorTimers.get(siteKey);
  if (existingTimer) clearInterval(existingTimer);
  monitorTimers.delete(siteKey);
  const config = readConfig();
  if (!config.securityMonitorEnabled) return;
  const intervalMs = Math.max(5, Number(config.securityIntervalMinutes || 360)) * 60 * 1000;
  const monitorTimer = setInterval(() => {
    const baseline = readBaseline();
    if (securityState.running || uploadState.running || !baseline) return;
    try {
      const fullDays = Math.max(1, Number(config.securityFullScanIntervalDays || 7));
      const lastFull = readHistory().find((item) => item.scanType === "full");
      const lastFullAt = Date.parse(lastFull?.finishedAt || baseline.createdAt || "");
      const fullDue = !Number.isFinite(lastFullAt) || Date.now() - lastFullAt >= fullDays * 24 * 60 * 60 * 1000;
      startSecurityScan({ mode: "scan", scanType: fullDue ? "full" : "incremental", reason: "scheduled" });
    } catch (error) {
      pushSecurityLog(`定时巡检未启动：${error.message || String(error)}`);
    }
  }, intervalMs);
  monitorTimer.unref?.();
  monitorTimers.set(siteKey, monitorTimer);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data, null, 2));
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'POST' && domainCheck.isRunning()) throw new Error('域名上线检测正在运行，请等待完成');
    if (req.method === 'POST' && databaseActions.isRunning()) throw new Error('数据库维护正在执行，请等待完成');
    if (!siteRuntime.currentSite() && !(req.method === 'GET' && pathname === '/api/config')) {
      sendJson(res, { message: "请先在管理后台添加网站。", setupRequired: true }, 400);
      return;
    }
    if (pathname.startsWith('/api/files/')) {
      const site = siteRuntime.currentSite();
      const config = readConfig();
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && pathname === '/api/files/local') {
        sendJson(res, listLocal(site, url.searchParams.get('path') || '', url.searchParams.get('includeEnvironment') === 'true')); return;
      }
      if (req.method === 'GET' && pathname === '/api/files/remote') {
        sendJson(res, await listRemote(config, url.searchParams.get('path') || '')); return;
      }
      if (req.method === 'POST' && pathname === '/api/files/plan') {
        sendJson(res, fileBrowser.prepare(site, config, await readBody(req))); return;
      }
      if (req.method === 'POST' && pathname === '/api/files/upload') {
        if (uploadState.running || securityState.running || syncState.running || serverSecurity.isRunning()) throw new Error('其他发布或巡检任务正在运行，请稍后重试');
        const selected = fileBrowser.consume(site, config, await readBody(req));
        startUpload('', selected);
        sendJson(res, { started: true, state: uploadState }); return;
      }
    }
    if (req.method === 'GET' && pathname === '/api/ftp/network') {
      sendJson(res, { interfaces: networkInterfaces() }); return;
    }
    if (pathname.startsWith('/api/server-security/')) {
      const site = siteRuntime.currentSite();
      if (req.method === 'POST' && ['/api/server-security/read', '/api/server-security/trust', '/api/server-security/untrust',
        '/api/server-security/quarantine', '/api/server-security/restore'].includes(pathname)) {
        const body = await readBody(req);
        const actor = require('node:crypto').createHash('sha256').update(req.headers.cookie || req.headers.authorization || '').digest('hex');
        res.setHeader('Cache-Control', 'no-store');
        const kind = pathname.split('/').pop();
        sendJson(res, kind === 'read' ? serverSecurity.inspect(site, body, actor) : serverSecurity.fileAction(site, kind, body, actor)); return;
      }
      if (req.method === 'GET' && pathname === '/api/server-security/status') {
        sendJson(res, { ...serverSecurity.status(site), navigation: buildNavigation() }); return;
      }
      if (req.method === 'POST' && pathname === '/api/server-security/scan') {
        serverSecurity.start(site); sendJson(res, { ok: true }, 202); return;
      }
      if (req.method === 'POST' && pathname === '/api/server-security/stop') {
        serverSecurity.stop(site); sendJson(res, { ok: true }); return;
      }
      if (req.method === 'POST' && pathname === '/api/server-security/settings') {
        const settings = serverSecurity.configure(site, await readBody(req)); sendJson(res, { ok: true, settings }); return;
      }
      if (req.method === 'POST' && pathname === '/api/server-security/baseline') {
        const body = await readBody(req);
        if (body.confirm !== true) throw new Error('请确认当前扫描结果可信后再采用基线。');
        serverSecurity.adopt(site, body.reportId); sendJson(res, { ok: true }); return;
      }
    }
    if (req.method === "GET" && pathname === "/api/config") {
      if (!siteRuntime.currentSite()) {
        sendJson(res, { config: {}, navigation: buildNavigation(), site: null, setupRequired: true,
          message: "请先在管理后台添加网站。" });
        return;
      }
      sendJson(res, {
        config: publicConfig(readConfig()),
        navigation: buildNavigation(),
        site: siteRuntime.publicSiteContext(),
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/config") {
      const current = readConfig();
      const body = await readBody(req);
      const next = normalizeConfigInput(body, current);
      writeConfig(next);
      scheduleSecurityMonitor();
      sendJson(res, { config: publicConfig(next) });
      return;
    }
    if (req.method === "POST" && pathname === "/api/publish/use-sync-target") {
      // 本地网站同步：把宝塔同步配置里当前站点的 FTP 目标一键写入本页配置
      if (deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }).environment !== "local") {
        sendJson(res, { message: "仅本地环境可用。" }, 403);
        return;
      }
      const site = siteRuntime.currentSite();
      if (!site) throw new Error("请先在管理后台添加网站。");
      const syncConfig = syncEngine.readSyncConfig();
      const target = syncConfig.sites[site.code];
      if (!target || !target.host) {
        throw new Error(`站点 ${site.code} 还没有宝塔同步目标，请先在「宝塔同步」页填写并保存。`);
      }
      const next = {
        ...readConfig(),
        host: target.host,
        port: Number(target.port || 21),
        user: target.user,
        password: target.password,
        secure: target.secure !== false,
        remoteRoot: target.remoteRoot || "/",
        networkInterface: target.networkInterface || '',
      };
      writeConfig(next);
      scheduleSecurityMonitor();
      sendJson(res, { ok: true, config: publicConfig(next), site: { code: site.code, name: site.name } });
      return;
    }
    if (req.method === "GET" && pathname === "/api/plan") {
      sendJson(res, buildPlan());
      return;
    }
    if (req.method === "POST" && pathname === "/api/test") {
      const result = await testFtpConnection(readConfig());
      sendJson(res, result);
      return;
    }
    if (req.method === "POST" && pathname === "/api/upload") {
      const body = await readBody(req);
      startUpload(body.scope);
      sendJson(res, { started: true, state: uploadState });
      return;
    }
    if (req.method === "GET" && pathname === "/api/upload/status") {
      sendJson(res, uploadState);
      return;
    }
    if (req.method === "GET" && pathname === "/api/security/status") {
      sendJson(res, securityStatus());
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/scan") {
      const body = await readBody(req);
      startSecurityScan({ mode: "scan", scanType: body.scanType === "full" ? "full" : "incremental", reason: "manual" });
      sendJson(res, { started: true, state: securityStatus() }, 202);
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/resume") {
      startSecurityScan({ resume: true });
      sendJson(res, { started: true, state: securityStatus() }, 202);
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/cancel") {
      if (!securityState.running) {
        sendJson(res, { ok: true, running: false });
        return;
      }
      securityState.cancelRequested = true;
      pushSecurityLog("正在取消巡检，当前 FTP 读取结束后停止。 ");
      sendJson(res, { ok: true, running: true, cancelRequested: true }, 202);
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/checkpoint/clear") {
      if (securityState.running) throw new Error("请先暂停当前巡检，再清除断点。");
      clearSecurityCheckpoint();
      securityState.checkpointedFiles = 0;
      sendJson(res, { ok: true, checkpoint: securityCheckpointInfo() });
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/baseline") {
      const body = await readBody(req);
      startSecurityScan({ mode: "baseline", allowFindings: body.allowFindings === true, reason: "manual" });
      sendJson(res, { started: true, state: securityStatus() }, 202);
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/baseline/adopt") {
      if (securityState.running || uploadState.running) throw new Error("请等待当前 FTP 操作完成后再建立基线。");
      if (!latestCompletedScan() || latestCompletedScan().scanType !== "full") {
        throw new Error("没有可采用的完整巡检结果，请先执行一次完整复核。");
      }
      if (latestCompletedScan().fingerprint !== siteFingerprint(readConfig())) {
        throw new Error("最近巡检结果不属于当前 FTP 站点，请重新完整复核。");
      }
      const body = await readBody(req);
      if (latestCompletedScan().summary.high > 0 && body.allowFindings !== true) {
        throw new Error("完整巡检仍有高风险项，不能设为可信基线。");
      }
      writeBaseline(buildBaseline(latestCompletedScan()));
      setLatestCompletedScan(null);
      clearBaselineCandidate();
      securityState.baselineUpdated = true;
      if (securityState.result) securityState.result.baselineUpdated = true;
      pushSecurityLog("已把最近一次完整巡检结果设为可信基线。");
      sendJson(res, { ok: true, baseline: baselineInfo(readBaseline()), state: securityStatus() });
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/evidence") {
      if (securityState.running || uploadState.running) throw new Error("请等待当前 FTP 操作完成后再下载留证。");
      const body = await readBody(req);
      const evidence = await downloadEvidence(readConfig(), body.path);
      sendJson(res, { ok: true, evidence });
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/monitor") {
      const body = await readBody(req);
      const current = readConfig();
      const next = {
        ...current,
        securityMonitorEnabled: Boolean(body.enabled),
        securityIntervalMinutes: Math.max(5, Number(body.intervalMinutes || current.securityIntervalMinutes || 360)),
        securityFullScanIntervalDays: Math.max(1, Number(body.fullScanIntervalDays || current.securityFullScanIntervalDays || 7)),
      };
      writeConfig(next);
      scheduleSecurityMonitor();
      sendJson(res, { ok: true, monitor: securityStatus().monitor });
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/hardening") {
      const body = await readBody(req);
      if (body.confirm !== true) {
        sendJson(res, { message: "需要确认后才能生成防执行规则。" }, 400);
        return;
      }
      const result = createLocalHardeningFiles(readConfig());
      sendJson(res, { ok: true, ...result });
      return;
    }
    if (pathname.startsWith('/api/domain-check/')) {
      if (deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }).environment !== 'local') {
        sendJson(res, { message: '请从本地项目发起域名上线检测' }, 403); return;
      }
      if (req.method === 'POST' && pathname === '/api/domain-check/start') {
        sendJson(res, domainCheck.start(await readBody(req)), 202); return;
      }
      if (req.method === 'GET' && pathname === '/api/domain-check/status') {
        sendJson(res, domainCheck.status()); return;
      }
    }
    if (pathname.startsWith('/api/databases/')) {
      if (deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }).environment !== 'local') {
        sendJson(res, { message: '数据库同步仅在本地项目开放' }, 403); return;
      }
      if (req.method === 'POST' && pathname === '/api/databases/inspect') {
        sendJson(res, await databaseActions.inspect(await readBody(req))); return;
      }
      if (req.method === 'POST' && pathname === '/api/databases/run') {
        sendJson(res, databaseActions.start(await readBody(req)), 202); return;
      }
      if (req.method === 'GET' && pathname === '/api/databases/status') {
        sendJson(res, databaseActions.status()); return;
      }
    }
    if (pathname.startsWith("/api/sync/")) {
      if (deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }).environment !== "local") {
        sendJson(res, { message: "同步功能仅在本地环境可用（backend/.env 需要 APP_ENVIRONMENT=local）。" }, 403);
        return;
      }
      if (req.method === "GET" && pathname === "/api/sync/config") {
        sendJson(res, {
          config: syncEngine.publicSyncConfig(syncEngine.readSyncConfig()),
          sections: syncEngine.MANAGED_SITE_SECTIONS,
          sites: siteRuntime.readManagedSites().map((site) => ({
            code: site.code,
            name: site.name,
            rootPath: site.rootPath,
            isDefault: Boolean(site.isDefault),
          })),
          currentSite: siteRuntime.publicSiteContext(),
          navigation: buildNavigation(),
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/sync/config") {
        const body = await readBody(req);
        const current = syncEngine.readSyncConfig();
        const next = { project: current.project, sites: { ...current.sites } };
        if (body.project) next.project = syncEngine.normalizeTargetInput(body.project, current.project);
        for (const [code, targetInput] of Object.entries(body.sites || {})) {
          if (!next.sites[code]) continue;
          next.sites[code] = syncEngine.normalizeTargetInput(targetInput, next.sites[code]);
        }
        syncEngine.writeSyncConfig(next);
        sendJson(res, { ok: true, config: syncEngine.publicSyncConfig(next) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/sync/test") {
        const body = await readBody(req);
        const config = syncEngine.readSyncConfig();
        const target = body.targetType === "site" ? config.sites[body.siteCode] : config.project;
        if (!target) throw new Error("同步目标不存在，请先保存目标配置。");
        const result = await testFtpConnection(target);
        const names = (result.items || []).map((item) => String(item.name || "").toLowerCase());
        if (body.targetType === "site") {
          result.looksLikePbootRoot = names.includes("data") && (names.includes("static") || names.includes("template") || names.includes("apps"));
        } else {
          result.looksLikeProjectRoot = names.includes("package.json") || (names.includes("backend") && names.includes("frontend"));
        }
        sendJson(res, result);
        return;
      }
      if (req.method === "POST" && pathname === "/api/sync/plan") {
        const body = await readBody(req);
        const plan = syncEngine.buildSyncPlan({ preset: body.preset, siteCode: body.siteCode, options: body.options || {} });
        sendJson(res, { plan: publicSyncPlan(plan) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/sync/run") {
        const body = await readBody(req);
        if (body.confirm !== true) {
          sendJson(res, { message: "需要确认后才能开始同步。" }, 400);
          return;
        }
        startSync({ preset: body.preset, siteCode: body.siteCode, options: body.options || {} });
        sendJson(res, { started: true, state: syncState }, 202);
        return;
      }
      if (req.method === "GET" && pathname === "/api/sync/status") {
        sendJson(res, syncState);
        return;
      }
      if (req.method === "GET" && pathname === "/api/sync/history") {
        sendJson(res, { history: syncEngine.readHistory() });
        return;
      }
    }
    sendJson(res, { message: "API not found" }, 404);
  } catch (error) {
    sendJson(res, { message: error.message || String(error) }, error.statusCode || 500);
  }
}

const authenticateTool = require('../tool-auth').createToolAuth({ tool: 'ftp', env: { ...parseEnvFile(BACKEND_ENV_PATH), ...process.env } });
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/deployment-environment') {
    sendJson(res, deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }));
    return;
  }
  if (await authenticateTool(req, res)) return;
  siteRuntime.runForRequest(req, res, () => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url.pathname);
      return;
    }
    if (url.pathname === "/site-context.js") {
      sendFile(res, path.join(PACKAGE_ROOT, "tools", "site-context-client.js"));
      return;
    }
    // 宝塔线上环境：本地网站同步页不可用，默认跳到安全巡检
    if (url.pathname === "/" && deploymentEnvironment({ ...parseEnvFile(BACKEND_ENV_PATH), ...process.env }).environment === "baota") {
      res.writeHead(302, { Location: "/security.html" });
      res.end();
      return;
    }
    const filePath = url.pathname === "/" ? path.join(PUBLIC_ROOT, "index.html") : path.join(PUBLIC_ROOT, url.pathname.replace(/^\/+/, ""));
    const resolvedFilePath = path.resolve(filePath);
    if (resolvedFilePath !== PUBLIC_ROOT && !resolvedFilePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    sendFile(res, filePath);
  });
});

function startServer() {
  const serverMonitorTimer = setInterval(() => serverSecurity.tick(), 60000);
  serverMonitorTimer.unref();
  server.once('close', () => clearInterval(serverMonitorTimer));
  serverSecurity.tick();
  return server.listen(PORT, "127.0.0.1", () => {
  const sites = siteRuntime.readManagedSites();
  if (sites.length) {
    for (const site of sites) siteRuntime.runForSite(site, scheduleSecurityMonitor);
  } else {
    console.log('No managed site configured; scheduled monitoring is inactive.');
  }
  console.log(`FTP publish tool is running: http://localhost:${PORT}`);
  });
}

if (require.main === module) startServer();
module.exports = { startServer };
