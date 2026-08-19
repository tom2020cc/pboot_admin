const http = require("http");
const fs = require("fs");
const path = require("path");
const ftp = require("basic-ftp");
const { readConfig, writeConfig, collectFiles, formatBytes, uploadFiles } = require("./upload-to-ftp");

const TOOL_ROOT = __dirname;
const PACKAGE_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const PUBLIC_ROOT = path.join(TOOL_ROOT, "public");
const PORT = Number(process.env.FTP_TOOL_PORT || 5189);
const BACKEND_ENV_PATH = path.join(PACKAGE_ROOT, "backend", ".env");
const SEO_CONFIG_PATH = path.join(PACKAGE_ROOT, "tools", "seo_publish_tool", "seo.config.json");

const uploadState = {
  running: false,
  total: 0,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  current: "",
  startedAt: "",
  finishedAt: "",
  error: "",
  scope: "site",
  logs: [],
};

function pushLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  uploadState.logs.push(line);
  if (uploadState.logs.length > 400) uploadState.logs.shift();
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
  const frontendPort = Number(env.FRONTEND_PORT || 5173);
  return [
    { id: "admin", label: "管理后台", url: `http://localhost:${frontendPort}/#/` },
    { id: "backend", label: "后端接口", url: `http://localhost:${backendPort}/api-docs` },
    { id: "config", label: "项目配置", url: `http://localhost:${Number(env.CONFIG_WIZARD_PORT || 5190)}` },
    { id: "seo", label: "SEO 检查", url: `http://localhost:${Number(seo.localPort || 5188)}` },
    { id: "ftp", label: "FTP 发布", url: `http://localhost:${PORT}`, active: true },
  ];
}

function normalizeConfigInput(body, current) {
  const next = {
    ...current,
    host: typeof body.host === "string" ? body.host.trim() : current.host,
    port: Number(body.port || current.port || 21),
    user: typeof body.user === "string" ? body.user.trim() : current.user,
    secure: Boolean(body.secure),
    remoteRoot: typeof body.remoteRoot === "string" ? body.remoteRoot.trim() || "/" : current.remoteRoot,
    uploadScope: body.uploadScope === "seo" || body.uploadScope === "full" ? body.uploadScope : "site",
    uploadMode: body.uploadMode === "full" ? "full" : "quick",
    recentImageDays: Math.max(1, Number(body.recentImageDays || current.recentImageDays || 14)),
    skipSameSizeAssets: body.skipSameSizeAssets !== false,
    uploadDatabase: body.uploadDatabase !== false,
    uploadImages: body.uploadImages !== false,
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
    onProgress: (event) => {
      uploadState.uploaded = event.uploaded;
      uploadState.skipped = event.skipped;
      uploadState.current = event.file.relativePath;
      pushLog(`${event.action === "skipped" ? "Skipped" : "Uploaded"} ${event.file.relativePath}`);
    },
  })
    .then((result) => {
      uploadState.running = false;
      uploadState.uploaded = result.uploaded;
      uploadState.skipped = result.skipped;
      uploadState.finishedAt = new Date().toISOString();
      pushLog(`Upload completed. Uploaded: ${result.uploaded}, skipped: ${result.skipped}.`);
    })
    .catch((error) => {
      uploadState.running = false;
      uploadState.failed = 1;
      uploadState.error = error.message || String(error);
      uploadState.finishedAt = new Date().toISOString();
      pushLog(`Upload failed: ${uploadState.error}`);
    });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
    sendJson(res, { message: "API not found" }, 404);
  } catch (error) {
    sendJson(res, { message: error.message || String(error), stack: error.stack }, 500);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
    return;
  }
  const filePath = url.pathname === "/" ? path.join(PUBLIC_ROOT, "index.html") : path.join(PUBLIC_ROOT, url.pathname.replace(/^\/+/, ""));
  if (!path.resolve(filePath).startsWith(PUBLIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  sendFile(res, filePath);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`FTP publish tool is running: http://localhost:${PORT}`);
});
