// SessionStart hook 辅助：输出 Google Indexing 每日提交提醒（additionalContext JSON）。
// 用法: node google-submit-reminder.js   → stdout 输出 JSON 给 Claude Code 的 SessionStart hook。
const fs = require("fs");
const path = require("path");

const TOOL_ROOT = __dirname;
const SUBMITTED_PATH = path.join(TOOL_ROOT, "google-submitted.json");
const CONFIG_PATH = path.join(TOOL_ROOT, "seo.config.json");

function pacificDateKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (_error) {
    return date.toISOString().slice(0, 10);
  }
}

function loadStore() {
  let submitted = {};
  let daily = {};
  try {
    const d = JSON.parse(fs.readFileSync(SUBMITTED_PATH, "utf8"));
    if (d && typeof d.submitted === "object" && d.submitted) submitted = d.submitted;
    if (d && typeof d.daily === "object" && d.daily) daily = d.daily;
  } catch (_error) {
    /* 文件不存在或损坏则视为空 */
  }
  return { submitted, daily };
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_error) {
    return {};
  }
}

const { submitted, daily } = loadStore();
const cfg = readConfig();
const today = pacificDateKey();
const dailyLimit =
  Number(cfg.googleIndexing && cfg.googleIndexing.dailyQuota) > 0
    ? Number(cfg.googleIndexing.dailyQuota)
    : 200;
const usedToday = Number(daily[today] || 0);
const remainingToday = Math.max(0, dailyLimit - usedToday);
const totalSubmitted = Object.keys(submitted).length;

const context =
  `[自动提醒·Google Indexing 每日提交] 累计已提交 ${totalSubmitted} 条；` +
  `今日(太平洋 ${today})已提交 ${usedToday}/${dailyLimit}，剩余配额 ${remainingToday}。` +
  `请在本会话回复用户第一条消息时：若剩余配额 > 0 且仍有未提交 URL，用 AskUserQuestion 询问` +
  `「是否现在提交 Google Indexing？」(选项：立即提交 / 1小时后提醒)。` +
  `选「立即提交」→ 运行 node tools/seo_publish_tool/auto-submit-google.js；` +
  `选「1小时后提醒」→ 用 CronCreate 排一个约 1 小时后的提醒。` +
  `若剩余配额为 0 或没有未提交 URL，则静默跳过、不要打扰用户。`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  }),
);
