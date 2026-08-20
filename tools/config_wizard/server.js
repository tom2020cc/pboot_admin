const http = require("http");
const fs = require("fs");
const path = require("path");

const TOOL_ROOT = __dirname;
const PACKAGE_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const PUBLIC_ROOT = path.join(TOOL_ROOT, "public");
const PORT = Number(process.env.CONFIG_WIZARD_PORT || 5190);

const BACKEND_ENV = path.join(PACKAGE_ROOT, "backend", ".env");
const FRONTEND_ENV = path.join(PACKAGE_ROOT, "frontend", ".env.local");
const FTP_CONFIG = path.join(PACKAGE_ROOT, "tools", "ftp_publish_tool", "ftp.config.json");
const SEO_CONFIG = path.join(PACKAGE_ROOT, "tools", "seo_publish_tool", "seo.config.json");
const DEFAULT_BACKUP_DIR = path.join(PACKAGE_ROOT, "backups", "backend_database");
const DEFAULT_SITE_ROOT = path.resolve(PACKAGE_ROOT, "..");

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "") : "";
}

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(readText(file)) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseEnv(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function secretValue(input, current) {
  const next = String(input || "").trim();
  return next || String(current || "");
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateProjectIsolation(values) {
  const siteRoot = path.resolve(String(values.pbootSiteRoot || ""));
  const databasePath = path.resolve(String(values.pbootDbPath || ""));
  const backupDir = path.resolve(String(values.backupDir || DEFAULT_BACKUP_DIR));
  const siteDataDir = path.join(siteRoot, "data");
  const backendDir = path.join(PACKAGE_ROOT, "backend");
  const backendDb = path.resolve(backendDir, String(values.backendDb || "dev.sqlite"));
  const backendPort = Number(values.backendPort || 5000);
  const frontendPort = Number(values.frontendPort || 5173);
  const requestBodyLimit = String(values.requestBodyLimit || "10mb").trim().toLowerCase();

  if (!values.pbootSiteRoot || !fs.existsSync(siteRoot) || !fs.statSync(siteRoot).isDirectory()) {
    throw new Error("目标网站根目录不存在，请选择当前 PbootCMS 网站的真实根目录。");
  }
  if (!isPathInside(siteRoot, PACKAGE_ROOT)) {
    throw new Error("当前 pboot_admin 必须放在所配置网站的根目录内，禁止跨网站共用管理项目。");
  }
  if (!values.pbootDbPath || !fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
    throw new Error("目标 PbootCMS 数据库文件不存在，请从当前网站 data 目录中选择 .db 文件。");
  }
  if (!isPathInside(siteDataDir, databasePath)) {
    throw new Error("数据库必须位于当前网站自己的 data 目录中，禁止连接其他网站数据库。");
  }
  if (!isPathInside(backendDir, backendDb)) {
    throw new Error("后端 SQLite 必须保存在当前 pboot_admin/backend 目录中。");
  }
  if (!isPathInside(PACKAGE_ROOT, backupDir)) {
    throw new Error("备份目录必须保存在当前 pboot_admin 目录中，避免不同网站共用备份。");
  }
  if (!Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535) {
    throw new Error("后端端口必须是 1024 至 65535 之间的整数。");
  }
  if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535) {
    throw new Error("前端端口必须是 1024 至 65535 之间的整数。");
  }
  if (backendPort === frontendPort) {
    throw new Error("前端端口与后端端口不能相同。");
  }
  if (!/^\d+(?:kb|mb)$/.test(requestBodyLimit)) {
    throw new Error("请求大小上限格式不正确，请使用 10mb、20mb 或 512kb 这类格式。");
  }
}

function writeBackendEnv(values, seoPort = 5188, ftpPort = 5189) {
  validateProjectIsolation(values);
  const current = parseEnv(readText(BACKEND_ENV));
  const lines = [
    "DB_TYPE=sqljs",
    `DB_SQLJS_LOCATION=${values.backendDb || "dev.sqlite"}`,
    `BACKEND_PORT=${Number(values.backendPort || 5000)}`,
    `FRONTEND_PORT=${Number(values.frontendPort || 5173)}`,
    `REQUEST_BODY_LIMIT=${String(values.requestBodyLimit || current.REQUEST_BODY_LIMIT || "10mb").trim().toLowerCase()}`,
    `CONFIG_WIZARD_PORT=${PORT}`,
    `SEO_TOOL_PORT=${Number(seoPort || 5188)}`,
    `FTP_TOOL_PORT=${Number(ftpPort || 5189)}`,
    "",
    "# Target PbootCMS website",
    `PBOOT_DB_PATH=${normalizeSlash(values.pbootDbPath)}`,
    `PBOOT_SITE_ROOT=${normalizeSlash(values.pbootSiteRoot)}`,
    `PBOOT_PUBLIC_BASE_URL=${String(values.publicBaseUrl || "").replace(/\/+$/, "")}`,
    "",
    "# Local backend database backup directory",
    `BACKEND_DB_BACKUP_DIR=${normalizeSlash(values.backupDir || DEFAULT_BACKUP_DIR)}`,
    "",
    "# Translation API keys, optional",
    `OPENAI_API_KEY=${secretValue(values.openaiKey, current.OPENAI_API_KEY)}`,
    `ZHIPU_API_KEY=${secretValue(values.zhipuKey, current.ZHIPU_API_KEY)}`,
    `DEEPSEEK_API_KEY=${secretValue(values.deepseekKey, current.DEEPSEEK_API_KEY)}`,
    `DASHSCOPE_API_KEY=${secretValue(values.dashscopeKey, current.DASHSCOPE_API_KEY)}`,
    "",
    "# YouTube video import",
    `YOUTUBE_API_KEY=${secretValue(values.youtubeKey, current.YOUTUBE_API_KEY)}`,
    `YOUTUBE_CHANNEL_ID=${String(values.youtubeChannelId || current.YOUTUBE_CHANNEL_ID || "").trim()}`,
    "",
  ];
  fs.writeFileSync(BACKEND_ENV, lines.join("\n"), "utf8");
  fs.writeFileSync(
    FRONTEND_ENV,
    [
      `VITE_API_BASE_URL=http://localhost:${Number(values.backendPort || 5000)}`,
      `VITE_FRONTEND_PORT=${Number(values.frontendPort || 5173)}`,
      `VITE_BACKEND_PORT=${Number(values.backendPort || 5000)}`,
      `VITE_CONFIG_WIZARD_PORT=${PORT}`,
      `VITE_SEO_TOOL_PORT=${Number(seoPort || 5188)}`,
      `VITE_FTP_TOOL_PORT=${Number(ftpPort || 5189)}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function loadBackendEnv() {
  const env = parseEnv(readText(BACKEND_ENV) || readText(path.join(PACKAGE_ROOT, "backend", ".env.example")));
  return {
    backendDb: env.DB_SQLJS_LOCATION || "dev.sqlite",
    backendPort: Number(env.BACKEND_PORT || 5000),
    frontendPort: Number(env.FRONTEND_PORT || 5173),
    requestBodyLimit: env.REQUEST_BODY_LIMIT || "10mb",
    pbootDbPath: env.PBOOT_DB_PATH || "",
    pbootSiteRoot: env.PBOOT_SITE_ROOT || normalizeSlash(DEFAULT_SITE_ROOT),
    publicBaseUrl: env.PBOOT_PUBLIC_BASE_URL || "",
    backupDir: env.BACKEND_DB_BACKUP_DIR || normalizeSlash(DEFAULT_BACKUP_DIR),
    youtubeApiKeySet: Boolean(env.YOUTUBE_API_KEY),
    youtubeChannelId: env.YOUTUBE_CHANNEL_ID || "",
  };
}

function listDatabases(siteRoot) {
  const root = path.resolve(String(siteRoot || ""));
  const dataDir = path.join(root, "data");
  if (!siteRoot || !fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((name) => name.toLowerCase().endsWith(".db"))
    .filter((name) => {
      const lower = name.toLowerCase();
      return !lower.includes(".before_") && !lower.includes(".bad_") && !lower.includes(".old") && !lower.includes(".bak") && !lower.includes(".backup");
    })
    .map((name) => {
      const fullPath = path.join(dataDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: normalizeSlash(fullPath), size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function publicFtpConfig(config) {
  return {
    localPort: Number(config.localPort || 5189),
    host: config.host || "",
    port: Number(config.port || 21),
    user: config.user || "",
    passwordSet: Boolean(config.password),
    remoteRoot: config.remoteRoot || "wwwroot",
    secure: Boolean(config.secure),
    uploadMode: config.uploadMode || "quick",
    recentImageDays: Number(config.recentImageDays || 14),
  };
}

function collectDiagnostics(config = loadConfig(false)) {
  const backend = config.backend || {};
  const ftp = config.ftp || {};
  const seo = config.seo || {};
  const siteRoot = path.resolve(String(backend.pbootSiteRoot || DEFAULT_SITE_ROOT));
  const databasePath = path.resolve(String(backend.pbootDbPath || ""));
  const ports = [
    ["后端", Number(backend.backendPort || 5000)],
    ["前端", Number(backend.frontendPort || 5173)],
    ["SEO", Number(seo.localPort || 5188)],
    ["FTP", Number(ftp.localPort || 5189)],
  ];
  const items = [];
  const add = (id, label, ok, detail) => items.push({ id, label, ok: Boolean(ok), detail });

  add("site-root", "网站根目录", fs.existsSync(siteRoot) && fs.statSync(siteRoot).isDirectory(), normalizeSlash(siteRoot));
  add("package-isolation", "项目归属当前网站", isPathInside(siteRoot, PACKAGE_ROOT), normalizeSlash(PACKAGE_ROOT));
  add(
    "database",
    "PbootCMS 数据库",
    Boolean(backend.pbootDbPath) && fs.existsSync(databasePath) && isPathInside(path.join(siteRoot, "data"), databasePath),
    fs.existsSync(databasePath) ? `${normalizeSlash(databasePath)} (${formatBytes(fs.statSync(databasePath).size)})` : normalizeSlash(databasePath),
  );
  add("backend-package", "后端程序", fs.existsSync(path.join(PACKAGE_ROOT, "backend", "package.json")), "backend/package.json");
  add("frontend-package", "前端程序", fs.existsSync(path.join(PACKAGE_ROOT, "frontend", "package.json")), "frontend/package.json");
  add("backend-deps", "后端依赖", fs.existsSync(path.join(PACKAGE_ROOT, "backend", "node_modules")), "未安装时运行 00-install.cmd");
  add("frontend-deps", "前端依赖", fs.existsSync(path.join(PACKAGE_ROOT, "frontend", "node_modules")), "未安装时运行 00-install.cmd");
  const portValues = ports.map((item) => item[1]);
  add(
    "ports",
    "本项目端口",
    ports.every((item) => Number.isInteger(item[1]) && item[1] >= 1024 && item[1] <= 65535) && new Set(portValues).size === portValues.length,
    ports.map((item) => `${item[0]} ${item[1]}`).join(" / "),
  );
  return {
    ok: items.every((item) => item.ok),
    items,
    summary: items.every((item) => item.ok) ? "配置完整，可以启动。" : "还有项目需要处理，请按提示修正。",
  };
}

function loadConfig(withDiagnostics = true) {
  const backend = loadBackendEnv();
  const ftp = readJson(FTP_CONFIG, {});
  const seo = readJson(SEO_CONFIG, {});
  const dbs = listDatabases(backend.pbootSiteRoot);
  if (!backend.pbootDbPath && dbs.length > 0) {
    backend.pbootDbPath = dbs[0].path;
  }
  const seoPort = Number(seo.localPort || 5188);
  const navigation = [
    { id: "admin", label: "🖥️ 管理后台", url: `http://localhost:${backend.frontendPort}/#/` },
    { id: "backend", label: "🔌 后端接口", url: `http://localhost:${backend.backendPort}/api-docs` },
    { id: "config", label: "⚙️ 项目配置", url: `http://localhost:${PORT}`, active: true },
    { id: "seo", label: "📊 SEO 检查", url: `http://localhost:${seoPort}` },
    { id: "models", label: "🧠 模型总览", url: `http://localhost:${seoPort}/models.html` },
    { id: "models-config", label: "🔑 模型配置", url: `http://localhost:${seoPort}/models-config.html` },
    { id: "ftp", label: "📤 FTP 发布", url: `http://localhost:${Number(ftp.localPort || 5189)}` },
  ];
  const result = {
    packageRoot: normalizeSlash(PACKAGE_ROOT),
    backend,
    navigation,
    detectedDatabases: dbs,
    ftp: publicFtpConfig(ftp),
    seo: {
      localPort: Number(seo.localPort || 5188),
      siteName: seo.siteName || "Your Site",
      siteBaseUrl: seo.siteBaseUrl || backend.publicBaseUrl || "https://www.example.com",
      localTestBaseUrl: seo.localTestBaseUrl || "",
      indexNowEnabled: Boolean(seo.indexNow?.enabled),
      indexNowKeySet: Boolean(seo.indexNow?.key),
    },
  };
  if (withDiagnostics) result.diagnostics = collectDiagnostics(result);
  return result;
}

function saveConfig(body) {
  const backend = body.backend || {};
  const ftpInput = body.ftp || {};
  const seoInput = body.seo || {};
  const pbootSiteRoot = normalizeSlash(backend.pbootSiteRoot);
  const seoLocalPort = Number(seoInput.localPort || 5188);
  const ftpLocalPort = Number(ftpInput.localPort || 5189);
  const reservedPorts = [
    ["后端", Number(backend.backendPort || 5000)],
    ["前端", Number(backend.frontendPort || 5173)],
    ["SEO 工具", seoLocalPort],
    ["FTP 网页工具", ftpLocalPort],
  ];
  for (const [name, port] of reservedPorts) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`${name}端口必须是 1024 至 65535 之间的整数。`);
    }
  }
  const duplicatePort = reservedPorts.find((item, index) =>
    reservedPorts.some((other, otherIndex) => otherIndex !== index && other[1] === item[1]));
  if (duplicatePort) {
    throw new Error(`本项目的四个本地服务端口不能重复，端口 ${duplicatePort[1]} 被重复使用。`);
  }

  writeBackendEnv(backend, seoLocalPort, ftpLocalPort);

  const currentFtp = readJson(FTP_CONFIG, {});
  writeJson(FTP_CONFIG, {
    ...currentFtp,
    localPort: ftpLocalPort,
    host: String(ftpInput.host || "").trim(),
    port: Number(ftpInput.port || 21),
    user: String(ftpInput.user || "").trim(),
    password: ftpInput.password ? String(ftpInput.password) : currentFtp.password || "",
    secure: Boolean(ftpInput.secure),
    remoteRoot: String(ftpInput.remoteRoot || "wwwroot").trim(),
    localRoot: pbootSiteRoot || currentFtp.localRoot || "..",
    uploadMode: ftpInput.uploadMode === "full" ? "full" : "quick",
    recentImageDays: Math.max(1, Number(ftpInput.recentImageDays || 14)),
  });

  const currentSeo = readJson(SEO_CONFIG, {});
  writeJson(SEO_CONFIG, {
    ...currentSeo,
    localPort: seoLocalPort,
    siteName: String(seoInput.siteName || "Your Site").trim(),
    siteBaseUrl: String(seoInput.siteBaseUrl || backend.publicBaseUrl || "https://www.example.com").trim().replace(/\/+$/, ""),
    localTestBaseUrl: String(seoInput.localTestBaseUrl || currentSeo.localTestBaseUrl || "").trim().replace(/\/+$/, ""),
    localRoot: pbootSiteRoot || currentSeo.localRoot || "..",
    databasePath: normalizeSlash(backend.pbootDbPath) || currentSeo.databasePath || "",
    indexNow: {
      ...(currentSeo.indexNow || {}),
      enabled: Boolean(seoInput.indexNowEnabled),
      key: secretValue(seoInput.indexNowKey, currentSeo.indexNow?.key),
      endpoint: currentSeo.indexNow?.endpoint || "https://api.indexnow.org/indexnow",
    },
  });

  return loadConfig();
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
  const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/config") {
      sendJson(res, loadConfig());
      return;
    }
    if (req.method === "GET" && pathname === "/api/databases") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      sendJson(res, { databases: listDatabases(url.searchParams.get("siteRoot")) });
      return;
    }
    if (req.method === "GET" && pathname === "/api/diagnose") {
      sendJson(res, collectDiagnostics());
      return;
    }
    if (req.method === "POST" && pathname === "/api/save") {
      const body = await readBody(req);
      sendJson(res, { ok: true, config: saveConfig(body) });
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
  console.log(`Pboot config wizard is running: http://localhost:${PORT}`);
});
