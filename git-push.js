#!/usr/bin/env node
// 免交互直接推送：从环境变量 GITHUB_TOKEN 或本地 git.token 文件读取 PAT，直接 git push。
// 用法：node git-push.js [分支名]   （默认 main）
// token 生成：https://github.com/settings/tokens （勾选 repo 权限）
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = __dirname;
const AUTH_USER = "tom2020cc"; // GitHub 账号，token 的认证用户名

function readToken() {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return process.env.GITHUB_TOKEN.trim();
  }
  const file = path.join(REPO_ROOT, "git.token");
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value) return value;
  }
  return "";
}

const branch = (process.argv[2] || "main").trim();

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const token = readToken();
if (!token) {
  console.error("未找到 GitHub Token，无法推送。请二选一：");
  console.error(`  1) 把 Personal Access Token 写入文件：${path.join(REPO_ROOT, "git.token")}`);
  console.error("     （该文件已加入 .gitignore，不会被提交）");
  console.error("  2) 设置环境变量 GITHUB_TOKEN");
  console.error("Token 生成地址：https://github.com/settings/tokens （勾选 repo 权限）");
  process.exit(1);
}

let origin;
try {
  origin = execSync("git remote get-url origin", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
} catch (_error) {
  origin = "";
}
if (!/^https:\/\//i.test(origin)) {
  fail(`当前 origin 不是 https 地址（${origin || "未配置"}），本脚本只支持 https 推送。请先 git remote set-url origin https://github.com/tom2020cc/pboot_admin.git`);
}

// 只把含 token 的地址用于本次推送，不写回 git config，避免 token 落盘到仓库配置
const authedUrl = origin.replace(/^https:\/\//i, `https://${AUTH_USER}:${token}@`);
console.log(`→ 推送到 ${origin} 分支 ${branch} ...`);

try {
  execSync(`git push "${authedUrl}" ${branch}`, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  console.log("✓ 推送完成。");
} catch (error) {
  fail(`推送失败：${(error.stderr || error.message || String(error)).toString().split("\n").slice(0, 6).join("\n")}`);
}
