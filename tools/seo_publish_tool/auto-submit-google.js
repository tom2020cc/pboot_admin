#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TOOL_ROOT = __dirname;
const CONFIG_PATH = path.join(TOOL_ROOT, "seo.config.json");
const LANGUAGE_SUBDOMAINS = ["cn", "es", "fr", "ru", "ar", "pt"];
const DRY_RUN = process.argv.includes("--dry-run");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_error) {
    return { localPort: 5288 };
  }
}

const initialConfig = readConfig();
const PORT = Number(initialConfig.localPort || 5288);

function request(method, pathname, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "localhost",
        port: PORT,
        path: pathname,
        method,
        timeout: timeoutMs,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (buffer += chunk));
        res.on("end", () => {
          let parsed = buffer;
          try { parsed = JSON.parse(buffer); } catch (_error) { /* keep raw response */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isServerUp() {
  try {
    const response = await request("GET", "/api/config", null, 3000);
    return response.status === 200;
  } catch (_error) {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp()) return;
  console.log(`SEO 工具未运行，正在启动 server.js（端口 ${PORT}）...`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: TOOL_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    if (await isServerUp()) return;
  }
  throw new Error("server.js 启动失败或端口被占用，请先启动 SEO 工具。");
}

function buildHomepages(config) {
  try {
    const base = new URL(String(config.siteBaseUrl || ""));
    base.pathname = "/";
    base.search = "";
    base.hash = "";
    const pages = [base.toString()];
    if (config.useLanguageSubdomains === false) return pages;
    const rootHost = base.hostname.replace(/^(cn|es|fr|ru|ar|pt)\./i, "");
    for (const language of LANGUAGE_SUBDOMAINS) pages.push(`${base.protocol}//${language}.${rootHost}/`);
    return pages;
  } catch (_error) {
    return [];
  }
}

function requireSuccessful(response, label) {
  if (response.status === 200 && response.body && typeof response.body === "object") return response.body;
  const message = response.body && response.body.message ? response.body.message : `HTTP ${response.status}`;
  throw new Error(`${label}失败：${message}`);
}

async function main() {
  await ensureServer();

  const submittedState = requireSuccessful(
    await request("GET", "/api/google-indexing/submitted"),
    "读取 Google 提交状态",
  );
  const quota = submittedState.quota || { dailyLimit: 200, dailyUsed: 0, dailyRemaining: 200 };
  console.log(`今日配额：已请求 ${quota.dailyUsed}/${quota.dailyLimit}，剩余 ${quota.dailyRemaining}`);
  if (Number(quota.dailyRemaining) <= 0) {
    console.log(`今日配额已用完。${quota.resetNote || "配额在太平洋时间零点重置。"}`);
    return;
  }

  if (!DRY_RUN) {
    const pretest = requireSuccessful(
      await request("POST", "/api/google-indexing/test", {}, 30000),
      "Google Indexing API 预检",
    );
    if (pretest.ok !== true) throw new Error(pretest.message || "Google Indexing API 预检未通过。");
    console.log(`预检通过：${pretest.message}`);
  }

  const report = requireSuccessful(await request("GET", "/api/report"), "读取 SEO 报告");
  if (!Array.isArray(report.urls)) throw new Error("SEO 报告中没有 URL 列表。");
  const reportUrls = report.urls
    .filter((item) => item && /^https?:\/\//i.test(item.url || ""))
    .sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0))
    .map((item) => item.url);
  const allUrls = [...new Set([...buildHomepages(report.config || initialConfig), ...reportUrls])];
  const submitted = submittedState.submitted || {};
  const pending = allUrls.filter((url) => !submitted[url]);
  if (!pending.length) {
    console.log(`全部 ${allUrls.length} 个 URL 均已有成功提交记录，无需继续。`);
    return;
  }

  const todayUrls = pending.slice(0, Math.max(0, Number(quota.dailyRemaining)));
  console.log(`总 URL ${allUrls.length}，已提交 ${allUrls.length - pending.length}，待提交 ${pending.length}，本次最多 ${todayUrls.length}。`);
  console.log("提示：Google 官方当前仅支持 JobPosting 或带 BroadcastEvent 的直播页面使用 Indexing API。");
  if (DRY_RUN) {
    console.log("演练模式结束：未测试 Google 连接，也未发出任何提交请求。");
    return;
  }

  const batchSize = 20;
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;
  let remaining = Number(quota.dailyRemaining);
  let stopReason = "";
  const failureSamples = [];

  for (let offset = 0; offset < todayUrls.length; offset += batchSize) {
    const batch = todayUrls.slice(offset, offset + batchSize);
    const response = await request("POST", "/api/google-indexing/submit", { urls: batch }, 120000);
    const result = requireSuccessful(response, `提交第 ${Math.floor(offset / batchSize) + 1} 批`);
    succeeded += Number(result.succeeded || 0);
    failed += Number(result.failed || 0);
    attempted += Number(result.attempted || 0);
    remaining = Number(result.quota?.dailyRemaining ?? remaining);
    stopReason = result.stopReason || "";
    for (const item of result.results || []) {
      if (!item.ok && !item.skipped && failureSamples.length < 5) {
        failureSamples.push(`${item.url}：${item.message || "未知错误"}`);
      }
    }
    console.log(`进度：实际请求 ${attempted}/${todayUrls.length}，成功 ${succeeded}，失败 ${failed}，今日剩余 ${remaining}`);
    if (stopReason || remaining <= 0) break;
  }

  console.log(`完成：实际请求 ${attempted}，成功 ${succeeded}，失败 ${failed}，剩余待提交 ${Math.max(0, pending.length - succeeded)}。`);
  if (stopReason) console.log(`停止原因：${stopReason}`);
  if (failureSamples.length) {
    console.log("失败样例：");
    failureSamples.forEach((item) => console.log(`  ${item}`));
  }
  if (failed > 0 && succeeded === 0 && stopReason !== "daily-quota" && stopReason !== "google-quota") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
