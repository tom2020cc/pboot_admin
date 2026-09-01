const http = require("http");
const fs = require("fs");
const path = require("path");
const ftp = require("basic-ftp");
const { readConfig, writeConfig, collectFiles, formatBytes, uploadFiles } = require("./upload-to-ftp");
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
  startedAt: "",
  finishedAt: "",
  error: "",
  baselineBlocked: false,
  baselineUpdated: false,
  result: null,
  logs: [],
};

let monitorTimer = null;

function readBaselineCandidate() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_CANDIDATE_PATH, "utf8"));
  } catch (_error) {
    return null;
  }
}

function saveBaselineCandidate(result) {
  fs.writeFileSync(BASELINE_CANDIDATE_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function clearBaselineCandidate() {
  fs.rmSync(BASELINE_CANDIDATE_PATH, { force: true });
}

let latestCompletedScan = readBaselineCandidate();

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
    seo = JSON.parse(fs.readFileSync(SEO_CONFIG_PATH, "utf8"));
  } catch (_error) {
    seo = {};
  }
  const backendPort = Number(env.BACKEND_PORT || 5000);
  const frontendPort = Number(env.FRONTEND_PORT || 5178);
  const seoPort = Number(seo.localPort || 5188);
  return [
    { id: "admin", label: "管理后台", url: `http://localhost:${frontendPort}/#/` },
    { id: "backend", label: "后端接口", url: `http://localhost:${backendPort}/api-docs` },
    { id: "config", label: "项目配置", url: `http://localhost:${Number(env.CONFIG_WIZARD_PORT || 5190)}` },
    { id: "quotation", label: "报价单生成", url: `http://localhost:${frontendPort}/#/quotations` },
    { id: "seo", label: "SEO 检查", url: `http://localhost:${seoPort}` },
    { id: "models", label: "模型总览", url: `http://localhost:${seoPort}/models.html` },
    { id: "models-config", label: "模型配置", url: `http://localhost:${seoPort}/models-config.html` },
    { id: "ftp", label: "FTP 发布", url: `http://localhost:${PORT}/` },
    { id: "ftp-security", label: "FTP 安全巡检", url: `http://localhost:${PORT}/security.html` },
  ];
}

function normalizeConfigInput(body, current) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const next = {
    ...current,
    host: typeof body.host === "string" ? body.host.trim() : current.host,
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
  const client = new ftp.Client(15000);
  try {
    await client.access({
      host: config.host,
      port: Number(config.port || 21),
      user: config.user,
      password: config.password,
      secure: Boolean(config.secure),
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

function startUpload(scopeOverride = "") {
  if (uploadState.running) throw new Error("Upload is already running.");
  if (securityState.running) throw new Error("安全巡检正在运行，请等待扫描完成后再发布。");
  const savedConfig = readConfig();
  const config = {
    ...savedConfig,
    uploadScope: scopeOverride === "seo" ? "seo" : savedConfig.uploadScope || "site",
  };
  if (!config.host || !config.user || !config.password) {
    throw new Error("Please fill FTP host, user and password first.");
  }
  const files = collectFiles(config);
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

function securityStatus() {
  const config = readConfig();
  const baseline = readBaseline();
  const currentFingerprint = siteFingerprint(config);
  return {
    ...securityState,
    baseline: baselineInfo(baseline),
    canAdoptBaseline: Boolean(
      latestCompletedScan
      && latestCompletedScan.scanType === "full"
      && latestCompletedScan.summary?.high === 0
      && latestCompletedScan.fingerprint === currentFingerprint
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

function startSecurityScan({ mode = "scan", scanType = "incremental", allowFindings = false, reason = "manual" } = {}) {
  if (securityState.running) throw new Error("安全巡检已经在运行。");
  if (uploadState.running) throw new Error("FTP 发布正在运行，请等待发布完成后再扫描。");
  const config = readConfig();
  const baseline = readBaseline();
  const actualScanType = mode === "baseline" || scanType === "full" || !baseline ? "full" : "incremental";
  if (!config.host || !config.user || !config.password) {
    throw new Error("请先完整配置 FTP 地址、用户名和密码。");
  }

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
    startedAt: new Date().toISOString(),
    finishedAt: "",
    error: "",
    cancelRequested: false,
    baselineBlocked: false,
    baselineUpdated: false,
    result: null,
    logs: [],
  });
  pushSecurityLog(
    mode === "baseline"
      ? "可信基线完整扫描开始。"
      : reason === "scheduled"
        ? `${actualScanType === "full" ? "定时完整复核" : "定时增量快检"}开始。`
        : `${actualScanType === "full" ? "手动完整复核" : "手动增量快检"}开始。`,
  );

  scanRemoteSite(config, {
    baseline,
    scanType: actualScanType,
    shouldCancel: () => securityState.cancelRequested,
    onConnection: (event) => {
      if (event.reason === "retry") pushSecurityLog("FTP 已重新连接，继续当前巡检。");
      else if (event.reason === "scheduled") pushSecurityLog("FTP 已主动刷新连接，继续巡检。");
      else pushSecurityLog("FTP 已连接，开始读取远端目录。");
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
    },
  })
    .then((result) => {
      appendHistory(result);
      if (result.scanType === "full") {
        latestCompletedScan = result;
        if (result.summary.high === 0) saveBaselineCandidate(result);
        else clearBaselineCandidate();
      } else {
        latestCompletedScan = null;
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
          latestCompletedScan = null;
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
      pushSecurityLog(`巡检完成：深查 ${result.summary.contentScanned}，跳过未变化 ${result.summary.skippedUnchanged}，高风险 ${result.summary.high}，需关注 ${result.summary.medium}。`);
    })
    .catch((error) => {
      securityState.running = false;
      securityState.stage = error.code === "SCAN_CANCELLED" ? "cancelled" : "error";
      securityState.error = error.code === "SCAN_CANCELLED" ? "" : error.message || String(error);
      securityState.finishedAt = new Date().toISOString();
      pushSecurityLog(error.code === "SCAN_CANCELLED" ? "巡检已取消，远端文件未做任何修改。" : `巡检失败：${securityState.error}`);
    });

  return securityStatus();
}

function scheduleSecurityMonitor() {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
  const config = readConfig();
  if (!config.securityMonitorEnabled) return;
  const intervalMs = Math.max(5, Number(config.securityIntervalMinutes || 360)) * 60 * 1000;
  monitorTimer = setInterval(() => {
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
    if (req.method === "GET" && pathname === "/api/config") {
      sendJson(res, { config: publicConfig(readConfig()), navigation: buildNavigation() });
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
    if (req.method === "POST" && pathname === "/api/security/baseline") {
      const body = await readBody(req);
      startSecurityScan({ mode: "baseline", allowFindings: body.allowFindings === true, reason: "manual" });
      sendJson(res, { started: true, state: securityStatus() }, 202);
      return;
    }
    if (req.method === "POST" && pathname === "/api/security/baseline/adopt") {
      if (securityState.running || uploadState.running) throw new Error("请等待当前 FTP 操作完成后再建立基线。");
      if (!latestCompletedScan || latestCompletedScan.scanType !== "full") {
        throw new Error("没有可采用的完整巡检结果，请先执行一次完整复核。");
      }
      if (latestCompletedScan.fingerprint !== siteFingerprint(readConfig())) {
        throw new Error("最近巡检结果不属于当前 FTP 站点，请重新完整复核。");
      }
      const body = await readBody(req);
      if (latestCompletedScan.summary.high > 0 && body.allowFindings !== true) {
        throw new Error("完整巡检仍有高风险项，不能设为可信基线。");
      }
      writeBaseline(buildBaseline(latestCompletedScan));
      latestCompletedScan = null;
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
    sendJson(res, { message: "API not found" }, 404);
  } catch (error) {
    sendJson(res, { message: error.message || String(error) }, 500);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
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

server.listen(PORT, "127.0.0.1", () => {
  scheduleSecurityMonitor();
  console.log(`FTP publish tool is running: http://localhost:${PORT}`);
});
