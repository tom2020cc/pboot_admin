#!/usr/bin/env node
// Google Indexing 每日自动提交（配额 200/天，太平洋零点=北京时间 15:00 重置）
// 用法: node auto-submit-google.js
// 流程: 确保 server.js 在跑 → 预检 Google 连通(/test) → 取 report 全部 URL(7 语首页置顶+按 priority 降序)
//       → 分批 POST /api/google-indexing/submit(server 端去重+当日配额截断) → 打印汇总。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TOOL_ROOT = __dirname;
const CONFIG_PATH = path.join(TOOL_ROOT, "seo.config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_error) {
    return { localPort: 5288 };
  }
}

const PORT = Number(readConfig().localPort || 5288);

// 各语言首页不在 report 里，手工放到最前面
const HOMEPAGES = [
  "https://shanbo.cc/", // 主域 = 英文站
  "https://cn.shanbo.cc/",
  "https://es.shanbo.cc/",
  "https://fr.shanbo.cc/",
  "https://ru.shanbo.cc/",
  "https://ar.shanbo.cc/",
  "https://pt.shanbo.cc/",
];

function request(method, pathname, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: pathname,
        method,
        timeout: timeoutMs,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed = buf;
          try {
            parsed = JSON.parse(buf);
          } catch (_error) {
            /* keep raw string */
          }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isServerUp() {
  try {
    await request("GET", "/api/config", null, 3000);
    return true;
  } catch (_error) {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp()) return;
  console.log(`SEO 工具未运行，启动 server.js（端口 ${PORT}）...`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: TOOL_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    if (await isServerUp()) {
      console.log("server 已就绪。");
      return;
    }
  }
  throw new Error("server.js 启动失败或端口被占用，请手动运行 05-start-seo-tool.cmd 后重试。");
}

async function main() {
  await ensureServer();

  // 预检：Google 连通性（代理是否开、SA 是否有效）
  console.log("预检 Google 连通性（/api/google-indexing/test）...");
  let pretest;
  try {
    pretest = await request("POST", "/api/google-indexing/test", {}, 30000);
  } catch (e) {
    throw new Error(`无法访问 SEO 工具: ${e.message}`);
  }
  if (!pretest.body || pretest.body.ok !== true) {
    const msg = (pretest.body && pretest.body.message) || `HTTP ${pretest.status}`;
    throw new Error(
      `Google 预检失败：${msg}\n  → 请确认 Clash 代理已开启、服务账号 JSON 正确、且已在 Search Console 添加该邮箱为所有者。`,
    );
  }
  console.log(`  预检通过：${pretest.body.message}`);

  // 取 report 全部 URL
  const reportResp = await request("GET", "/api/report", null, 120000);
  if (reportResp.status !== 200 || !reportResp.body || !Array.isArray(reportResp.body.urls)) {
    throw new Error(`取 report 失败: HTTP ${reportResp.status}`);
  }
  const reportUrls = reportResp.body.urls
    .filter((u) => u && /^https?:\/\//i.test(u.url))
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
    .map((u) => u.url);
  const urls = [...new Set([...HOMEPAGES, ...reportUrls])];
  console.log(`候选 URL 总数: ${urls.length}`);

  // 分批提交（server 端自动去重 + 当日配额截断）
  const batchSize = 20;
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let quotaHit = false;
  const samples = [];
  for (let i = 0; i < urls.length && !quotaHit; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    let r;
    try {
      r = await request("POST", "/api/google-indexing/submit", { urls: batch }, 120000);
    } catch (e) {
      console.error(`批次请求失败: ${e.message}`);
      break;
    }
    if (r.status !== 200 || !r.body || !Array.isArray(r.body.results)) {
      console.error(`批次响应异常: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      break;
    }
    for (const item of r.body.results) {
      if (item.ok && item.skipped) skipped += 1;
      else if (item.ok) ok += 1;
      else {
        failed += 1;
        if (samples.length < 3) samples.push(`${item.url} => ${item.message}`);
      }
    }
    const remaining = r.body.quota ? r.body.quota.dailyRemaining : null;
    console.log(
      `进度: ${Math.min(i + batchSize, urls.length)}/${urls.length}  成功 ${ok}  跳过 ${skipped}  失败 ${failed}  剩余配额 ${remaining ?? "?"}`,
    );
    if (r.body.results.some((x) => x.status === 429)) {
      console.log(">>> 遇到 429（配额耗尽），停止。");
      quotaHit = true;
    } else if (remaining !== null && remaining <= 0) {
      console.log(">>> 当日配额已用完，停止。");
      quotaHit = true;
    }
  }

  console.log("");
  console.log(`===== 完成: 成功 ${ok}, 跳过(已提交过) ${skipped}, 失败 ${failed} =====`);
  if (samples.length) {
    console.log("失败样例:");
    samples.forEach((s) => console.log(`  ${s}`));
  }
  process.exitCode = failed > 0 && ok === 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(`✗ ${e.message || e}`);
  process.exit(1);
});
