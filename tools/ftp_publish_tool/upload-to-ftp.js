const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CONFIG_FILE = path.join(__dirname, "ftp.config.json");

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Missing config file: ${CONFIG_FILE}`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8").replace(/^\uFEFF/, ""));
  return {
    port: 21,
    secure: false,
    remoteRoot: "/",
    localRoot: "..",
    uploadDatabase: true,
    databaseFiles: ["data/*.db"],
    uploadImages: true,
    imageDirs: ["static", "uploads"],
    extraPaths: [],
    seoPaths: ["sitemap.xml", "robots.txt", "*.txt", "*.html", "*.xml"],
    uploadScope: "site",
    exclude: [
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
    ],
    uploadMode: "quick",
    recentImageDays: 14,
    skipSameSizeAssets: true,
    confirmBeforeUpload: true,
    dryRun: false,
    ...config,
  };
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function isDatabaseFile(relativePath) {
  const normalized = toPosix(relativePath).toLowerCase();
  return normalized.startsWith("data/") && normalized.endsWith(".db");
}

function isAlwaysUploadFile(relativePath) {
  const normalized = toPosix(relativePath).toLowerCase();
  return isDatabaseFile(normalized) || normalized === "sitemap.xml" || normalized === "robots.txt" || (!normalized.includes("/") && normalized.endsWith(".txt"));
}

function isImageAssetFile(relativePath, config) {
  const normalized = toPosix(relativePath).toLowerCase();
  return (config.imageDirs || []).some((dir) => {
    const cleanDir = toPosix(String(dir || "")).toLowerCase().replace(/\/+$/, "");
    return cleanDir && (normalized === cleanDir || normalized.startsWith(`${cleanDir}/`));
  });
}

// 二进制/静态资源扩展名：这些文件「同大小即视为未变」，可跳过；其余（php/html/js/css/json/txt 等代码与文本）始终覆盖上传
const BINARY_ASSET_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tif", ".tiff", ".avif",
  ".pdf", ".mp4", ".mp3", ".avi", ".mov", ".mkv", ".flv", ".rmvb", ".wmv", ".webm", ".m4v", ".wav", ".ogg",
  ".zip", ".rar", ".7z", ".gz", ".tar", ".bz2", ".tgz",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".psd", ".ai", ".eps", ".apk",
]);

function isBinaryAssetFile(relativePath) {
  const normalized = toPosix(relativePath).toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex >= 0) {
    const ext = normalized.slice(dotIndex);
    if (BINARY_ASSET_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

function toPosix(value) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function joinRemote(root, relativePath) {
  const cleanRoot = toPosix(String(root || "")).replace(/\/+$/, "");
  const cleanRelative = toPosix(relativePath);
  if (!cleanRoot || cleanRoot === ".") return cleanRelative;
  return `${cleanRoot}/${cleanRelative}`;
}

async function ensureRelativeDir(client, remoteDir, baseDir) {
  if (baseDir) {
    await client.cd(baseDir);
  }
  const cleanDir = toPosix(remoteDir || "");
  if (!cleanDir || cleanDir === ".") return;
  for (const part of cleanDir.split("/").filter(Boolean)) {
    try {
      await client.cd(part);
    } catch (_error) {
      await client.send(`MKD ${part}`, true);
      await client.cd(part);
    }
  }
}

function globToRegExp(glob) {
  const normalized = toPosix(glob);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*\*/g, "__DOUBLE_STAR__").replace(/\*/g, "[^/]*").replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${pattern}$`, "i");
}

function isExcluded(relativePath, excludeRules) {
  const normalized = toPosix(relativePath);
  return excludeRules.some((rule) => globToRegExp(rule).test(normalized));
}

function collectDirectory(localRoot, relativeDir, excludeRules, output) {
  const absoluteDir = path.resolve(localRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return;
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const childRelative = toPosix(path.join(relativeDir, entry.name));
    if (isExcluded(childRelative, excludeRules)) continue;
    const childAbsolute = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      collectDirectory(localRoot, childRelative, excludeRules, output);
    } else if (entry.isFile()) {
      const stat = fs.statSync(childAbsolute);
      output.push({
        localPath: childAbsolute,
        relativePath: childRelative,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
}

function collectSimpleGlob(localRoot, pattern, excludeRules, output) {
  const normalized = toPosix(pattern);
  const slashIndex = normalized.lastIndexOf("/");
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
  const fileGlob = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const absoluteDir = path.resolve(localRoot, dir);
  if (!fs.existsSync(absoluteDir)) return;
  const matcher = globToRegExp(fileGlob);
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isFile() || !matcher.test(entry.name)) continue;
    const relativePath = toPosix(path.join(dir, entry.name));
    if (isExcluded(relativePath, excludeRules)) continue;
    const localPath = path.join(absoluteDir, entry.name);
    const stat = fs.statSync(localPath);
    output.push({ localPath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
}

function collectPath(localRoot, entryPath, excludeRules, output) {
  const normalized = toPosix(entryPath);
  if (normalized.includes("*")) {
    collectSimpleGlob(localRoot, normalized, excludeRules, output);
    return;
  }
  const absolutePath = path.resolve(localRoot, normalized);
  if (!fs.existsSync(absolutePath)) return;
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    collectDirectory(localRoot, normalized, excludeRules, output);
  } else if (stat.isFile() && !isExcluded(normalized, excludeRules)) {
    output.push({ localPath: absolutePath, relativePath: normalized, size: stat.size, mtimeMs: stat.mtimeMs });
  }
}

function collectFiles(config) {
  const localRoot = path.resolve(__dirname, config.localRoot);
  const files = [];
  if (config.uploadScope === "full") {
    // 整站上传：递归收集本地根目录全部文件，依赖 exclude 排除 admin 工具/缓存/备份等
    collectDirectory(localRoot, ".", config.exclude, files);
  } else if (config.uploadScope === "seo") {
    for (const seoPath of config.seoPaths || ["sitemap.xml", "robots.txt", "*.txt"]) {
      collectPath(localRoot, seoPath, config.exclude, files);
    }
  } else {
  if (config.uploadDatabase) {
    for (const pattern of config.databaseFiles) collectPath(localRoot, pattern, config.exclude, files);
  }
  if (config.uploadImages) {
    for (const dir of config.imageDirs) collectPath(localRoot, dir, config.exclude, files);
  }
  for (const extraPath of config.extraPaths) collectPath(localRoot, extraPath, config.exclude, files);
  }

  const seen = new Set();
  const deduped = files.filter((file) => {
    const key = file.relativePath.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (config.uploadScope === "seo" || config.uploadScope === "full" || config.uploadMode !== "quick") return deduped;

  const days = Math.max(1, Number(config.recentImageDays || 14));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return deduped.filter((file) => {
    if (isAlwaysUploadFile(file.relativePath)) return true;
    if (!isImageAssetFile(file.relativePath, config)) return true;
    return Number(file.mtimeMs || 0) >= cutoff;
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function askConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFtpError(error) {
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return (
    message.includes("server sent fin") ||
    message.includes("client is closed") ||
    message.includes("connection closed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("421") ||
    message.includes("425") ||
    message.includes("426")
  );
}

async function uploadFiles(config, files, hooks = {}) {
  let client = null;
  let baseDir = "";
  let uploaded = 0;
  let skipped = 0;
  let operations = 0;
  const reconnectEvery = Number(config.reconnectEvery || 80);
  const maxRetries = Number(config.maxRetries || 4);

  async function closeClient() {
    if (!client) return;
    try {
      client.close();
    } catch (_error) {
      // Ignore close errors; a new connection will be opened when needed.
    }
    client = null;
  }

  async function connect(reason) {
    await closeClient();
    client = new ftp.Client(Number(config.timeoutMs || 45000));
    client.ftp.verbose = Boolean(config.verbose);
    await client.access({
      host: config.host,
      port: Number(config.port || 21),
      user: config.user,
      password: config.password,
      secure: Boolean(config.secure),
    });
    baseDir = await client.pwd().catch(() => "");
    hooks.onConnect?.({ reason, baseDir });
  }

  async function connectWithRetry(reason, context = {}) {
    const fallbackFile = { relativePath: "FTP connection" };
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await connect(attempt === 1 ? reason : "retry");
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries || !isRetryableFtpError(error)) {
          throw error;
        }
        hooks.onRetry?.({
          index: context.index || 0,
          total: context.total || files.length,
          file: context.file || fallbackFile,
          attempt,
          maxRetries,
          error,
        });
        await sleep(1200 * attempt);
      }
    }

    throw lastError;
  }

  try {
    await connectWithRetry("initial");

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt += 1;
        try {
          if (operations > 0 && reconnectEvery > 0 && operations % reconnectEvery === 0) {
            hooks.onReconnect?.({ index: index + 1, total: files.length, file, operations });
            await connectWithRetry("scheduled", { index: index + 1, total: files.length, file });
          }
          const remotePath = joinRemote(config.remoteRoot, file.relativePath);
          if (config.skipSameSizeAssets && isBinaryAssetFile(file.relativePath)) {
            try {
              if (baseDir) await client.cd(baseDir);
              const remoteSize = await client.size(remotePath);
              if (remoteSize === file.size) {
                skipped += 1;
                operations += 1;
                hooks.onProgress?.({ index: index + 1, total: files.length, action: "skipped", file, uploaded, skipped });
                console.log(`[${index + 1}/${files.length}] Skipped ${file.relativePath} (same size)`);
                break;
              }
            } catch (error) {
              if (isRetryableFtpError(error)) throw error;
              // Remote file does not exist or size cannot be read; upload it.
            }
          }
          const slashIndex = remotePath.lastIndexOf("/");
          const remoteDir = slashIndex >= 0 ? remotePath.slice(0, slashIndex) : ".";
          const remoteName = slashIndex >= 0 ? remotePath.slice(slashIndex + 1) : remotePath;
          await ensureRelativeDir(client, remoteDir, baseDir);
          await client.uploadFrom(file.localPath, remoteName);
          uploaded += 1;
          operations += 1;
          hooks.onProgress?.({ index: index + 1, total: files.length, action: "uploaded", file, uploaded, skipped });
          console.log(`[${index + 1}/${files.length}] Uploaded ${file.relativePath}`);
          break;
        } catch (error) {
          if (attempt >= maxRetries || !isRetryableFtpError(error)) {
            throw error;
          }
          hooks.onRetry?.({ index: index + 1, total: files.length, file, attempt, maxRetries, error });
          await sleep(1200 * attempt);
          await connectWithRetry("retry", { index: index + 1, total: files.length, file });
        }
      }
    }
  } finally {
    await closeClient();
  }
  return { uploaded, skipped };
}

async function main() {
  const config = readConfig();
  const dryRun = config.dryRun || process.argv.includes("--dry-run");

  const files = collectFiles(config);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  console.log("");
  console.log("PbootCMS FTP publish plan");
  console.log(`Local root : ${path.resolve(__dirname, config.localRoot)}`);
  console.log(`Remote root: ${config.remoteRoot}`);
  console.log(`Files      : ${files.length}`);
  console.log(`Total size : ${formatBytes(totalSize)}`);
  console.log("");

  for (const file of files.slice(0, 30)) {
    console.log(`- ${file.relativePath} (${formatBytes(file.size)})`);
  }
  if (files.length > 30) {
    console.log(`... and ${files.length - 30} more files`);
  }
  console.log("");

  if (files.length === 0) {
    console.log("No files to upload.");
    return;
  }

  if (dryRun) {
    console.log("Dry run only. Nothing uploaded.");
    return;
  }

  if (!config.host || !config.user || !config.password) {
    throw new Error("Please fill host, user and password in ftp.config.json first.");
  }

  if (config.confirmBeforeUpload) {
    const ok = await askConfirm("Upload these files to FTP now? Type y to continue: ");
    if (!ok) {
      console.log("Canceled.");
      return;
    }
  }

  const result = await uploadFiles(config, files);
  console.log("");
  console.log(`FTP upload completed. Uploaded: ${result.uploaded}, skipped: ${result.skipped}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("");
    console.error("FTP upload failed:");
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
} else {
  module.exports = {
    readConfig,
    writeConfig,
    collectFiles,
    formatBytes,
    joinRemote,
    uploadFiles,
  };
}
