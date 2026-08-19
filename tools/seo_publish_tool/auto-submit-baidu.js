#!/usr/bin/env node
// 百度主动推送（每日自动提交中文站 URL）
// 用法: node auto-submit-baidu.js
// 流程: 确保 server.js 在跑 → 取 report 中 cn.shanbo.cc 的 URL（首页置顶 + 按 priority 降序）
//       → POST /api/baidu/push（服务端直接调用 data.zz.baidu.com）→ 打印汇总。
// 说明: 百度主动推送支持重复推送（重复推表示内容更新），故不做本地去重；配额以百度返回的 remain 为准。

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
const BAIDU_SITE = String((readConfig().baidu && readConfig().baidu.site) || "https://cn.shanbo.cc")
  .trim()
  .replace(/\/+$/, "");

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
  throw new Error("server.js 启动失败或端口被占用，请手动启动 SEO 工具后重试。");
}

async function main() {
  await ensureServer();

  // 检查 token
  const cfgResp = await request("GET", "/api/baidu/status", null, 5000);
  const cfg = cfgResp.body || {};
  if (!cfg.tokenConfigured) {
    throw new Error(
      "百度推送 token 未配置。请到百度搜索资源平台(ziyuan.baidu.com) → 普通收录 → 主动推送 生成 token，\n  然后填到 SEO 工具页面或 seo.config.json 的 baidu.token。",
    );
  }
  console.log(`百度推送站点: ${BAIDU_SITE}`);

  // 取 report，只保留中文站域名下的 URL
  const reportResp = await request("GET", "/api/report", null, 120000);
  if (reportResp.status !== 200 || !reportResp.body || !Array.isArray(reportResp.body.urls)) {
    throw new Error(`取 report 失败: HTTP ${reportResp.status}`);
  }
  let cnHost = "";
  try {
    cnHost = new URL(BAIDU_SITE).hostname;
  } catch (_error) {
    throw new Error(`百度站点地址格式不正确：${BAIDU_SITE}`);
  }
  const cnUrls = reportResp.body.urls
    .filter((u) => {
      if (!u || !/^https?:\/\//i.test(u.url)) return false;
      try {
        return new URL(u.url).hostname === cnHost;
      } catch (_error) {
        return false;
      }
    })
    .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))
    .map((u) => u.url);
  const urls = [...new Set([`${BAIDU_SITE}/`, ...cnUrls])];
  console.log(`中文站候选 URL 总数: ${urls.length}`);

  // 分批提交（百度单次最多 2000）
  const batchSize = 2000;
  let totalSuccess = 0;
  let remain = null;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const r = await request("POST", "/api/baidu/push", { urls: batch, site: BAIDU_SITE }, 120000);
    if (r.status !== 200 || !r.body) {
      console.error(`批次请求异常: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      break;
    }
    if (!r.body.ok) {
      console.error(`百度推送失败: ${r.body.message}`);
      break;
    }
    totalSuccess += Number(r.body.success) || 0;
    remain = r.body.remain;
    console.log(
      `进度: ${Math.min(i + batchSize, urls.length)}/${urls.length}  本批成功 ${r.body.success}/${batch.length}  剩余配额 ${remain ?? "?"}`,
    );
    if (r.body.notSameSite && r.body.notSameSite.length) {
      console.log(`  注意: ${r.body.notSameSite.length} 个 URL 不在当前站点下，已忽略。`);
    }
    if (r.body.notValid && r.body.notValid.length) {
      console.log(`  注意: ${r.body.notValid.length} 个 URL 格式无效，已忽略。`);
    }
    if (remain !== null && remain <= 0) {
      console.log(">>> 百度当日配额已用完，停止。");
      break;
    }
  }

  console.log("");
  console.log(`===== 完成: 成功推送 ${totalSuccess} 条，剩余配额 ${remain ?? "?"} =====`);
  console.log("提示: 百度主动推送可重复提交以提示内容更新，建议每日运行一次。");
  process.exitCode = totalSuccess > 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`✗ ${e.message || e}`);
  process.exit(1);
});
