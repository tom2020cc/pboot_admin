const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const LANGUAGE_NAMES = {
  cn: "Simplified Chinese",
  en: "English",
  es: "Spanish",
  fr: "French",
  ru: "Russian",
  ar: "Arabic",
  pt: "Portuguese",
};

const TARGET_LANGUAGES = ["en", "es", "fr", "ru", "ar", "pt"];
const BATCH_SIZE = 2;
const FAST_MODEL_BATCH_SIZE = 4;
const AI_REQUIRED_PROBLEMS = new Set([
  "title",
  "subtitle",
  "slug",
  "keywords",
  "description",
  "content-too-short",
  "image-alt",
]);
const AI_TIMEOUT_MS = 300000;
const AI_MAX_ATTEMPTS = 3;
const AI_RETRY_DELAYS_MS = [15000, 45000];

const QWEN_QUOTA_URL =
  "https://bailian.console.aliyun.com/cn-beijing/?tab=costing-balance#/costing-balance/free-quota";

// 与 backend/src/common/translation-model-catalog.ts 保持一致：
// priority 排序、recommended 推荐、purpose 用途、quotaText/quotaUrl 额度查看。
// 不含 google-free / mymemory-free（纯翻译接口，callAiOnce 无对应 provider 分支）。
const MODEL_DEFINITIONS = [
  {
    value: "qwen3.6-flash-2026-04-16",
    label: "Qwen 3.6 Flash",
    provider: "qwen",
    priority: 1,
    recommended: true,
    purpose: "Best default for batch translation, speed, quality, and stable HTML output.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen-mt-lite",
    label: "Qwen MT Lite",
    provider: "qwen",
    priority: 2,
    recommended: true,
    purpose: "Translation model for titles, descriptions, and shorter content.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen3.6-27b",
    label: "Qwen 3.6 27B",
    provider: "qwen",
    priority: 3,
    recommended: true,
    purpose: "High-quality fallback when the preferred model is busy or exhausted.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen3-30b-a3b",
    label: "Qwen3 30B A3B",
    provider: "qwen",
    priority: 4,
    recommended: true,
    purpose: "Fallback for long articles and technical machinery content.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen-plus-2025-01-25",
    label: "Qwen Plus 2025-01-25",
    provider: "qwen",
    priority: 5,
    recommended: false,
    purpose: "Stable-version fallback for article content and SEO fields.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen3.7-max-2026-05-17",
    label: "Qwen 3.7 Max",
    provider: "qwen",
    priority: 6,
    recommended: false,
    purpose: "Quality-first fallback; usually slower and more expensive.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen3-235b-a22b",
    label: "Qwen3 235B A22B",
    provider: "qwen",
    priority: 7,
    recommended: false,
    purpose: "Large-model fallback; not recommended as the daily batch default.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen-turbo",
    label: "Qwen Turbo",
    provider: "qwen",
    priority: 8,
    recommended: false,
    purpose: "General fast fallback model.",
    quotaText: "Open Bailian to view quota and billing status.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen-plus",
    label: "Qwen Plus",
    provider: "qwen",
    priority: 9,
    recommended: false,
    purpose: "General quality fallback model.",
    quotaText: "Open Bailian to view quota and billing status.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen-coder-plus",
    label: "Qwen Coder Plus",
    provider: "qwen",
    priority: 10,
    recommended: false,
    purpose: "Code-oriented fallback only when other Qwen models are unavailable.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "qwen3-vl-plus",
    label: "Qwen3 VL Plus",
    provider: "qwen",
    priority: 11,
    recommended: false,
    purpose: "Vision model; not recommended for normal batch text translation.",
    quotaText: "Independent free quota; open Bailian to view the live balance.",
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: "glm-4.7-flash",
    label: "Zhipu GLM-4.7-Flash",
    provider: "zhipu",
    priority: 20,
    recommended: true,
    purpose: "Domestic fallback for retrying failed items.",
    quotaText: "Open the Zhipu console to view the live free quota.",
  },
  {
    value: "glm-4-flash-250414",
    label: "Zhipu GLM-4-Flash",
    provider: "zhipu",
    priority: 21,
    recommended: false,
    purpose: "Alternate GLM model for retrying failed items.",
    quotaText: "Open the Zhipu console to view the live free quota.",
  },
  {
    value: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "deepseek",
    priority: 30,
    recommended: true,
    purpose: "Fallback for Chinese understanding and SEO work; requires its own key.",
    quotaText: "Billed against the DeepSeek account balance.",
  },
  {
    value: "gpt-4o-mini",
    label: "OpenAI gpt-4o-mini",
    provider: "openai",
    priority: 40,
    recommended: false,
    purpose: "Stable paid fallback model.",
    quotaText: "Billed against the OpenAI project balance and usage.",
  },
  {
    value: "gpt-4.1-mini",
    label: "OpenAI gpt-4.1-mini",
    provider: "openai",
    priority: 41,
    recommended: false,
    purpose: "High-quality paid fallback model.",
    quotaText: "Billed against the OpenAI project balance and usage.",
  },
];

let SQL_PROMISE;
let currentJob = createIdleJob();
let stopRequested = false;
let skippedBatches = 0;
let pendingUpdates = null;

function createIdleJob() {
  return {
    state: "idle",
    mode: "",
    current: 0,
    total: 0,
    percent: 0,
    message: "尚未开始",
    logs: [],
    result: null,
    error: "",
    startedAt: "",
    finishedAt: "",
  };
}

function throwIfStopped() {
  if (stopRequested) {
    throw new Error("任务已被用户停止");
  }
}

function requestStop() {
  if (currentJob.state === "running") {
    stopRequested = true;
  }
  return currentJob;
}

function loadSql(toolRoot) {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs({
      locateFile: (file) => path.join(toolRoot, "node_modules", "sql.js", "dist", file),
    });
  }
  return SQL_PROMISE;
}

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function getAiSettings(toolRoot) {
  const envPath = path.resolve(toolRoot, "..", "..", "backend", ".env");
  const localConfigPath = path.join(toolRoot, "ai.config.json");
  const env = { ...parseEnv(envPath), ...process.env };
  let localConfig = {};
  if (fs.existsSync(localConfigPath)) {
    try {
      localConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
    } catch (_error) {
      localConfig = {};
    }
  }
  if (localConfig.openaiApiKey) env.OPENAI_API_KEY = localConfig.openaiApiKey;
  if (localConfig.zhipuApiKey) env.ZHIPU_API_KEY = localConfig.zhipuApiKey;
  if (localConfig.deepseekApiKey) env.DEEPSEEK_API_KEY = localConfig.deepseekApiKey;
  if (localConfig.dashscopeApiKey) env.DASHSCOPE_API_KEY = localConfig.dashscopeApiKey;
  const providerEnvKey = {
    qwen: "DASHSCOPE_API_KEY",
    zhipu: "ZHIPU_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openai: "OPENAI_API_KEY",
  };
  const models = MODEL_DEFINITIONS.map((definition) => {
    const available = Boolean(env[providerEnvKey[definition.provider]]);
    const quotaStatus = available ? "check-console" : "unconfigured";
    const quotaText = available ? definition.quotaText : "API Key 未配置。";
    const quotaLabel = available ? "实时查看" : "未配置";
    return {
      ...definition,
      available,
      quotaStatus,
      quotaText,
      remainingQuota: null,
      displayLabel: `#${definition.priority}${definition.recommended ? " 推荐" : ""} | ${definition.label} | 额度: ${quotaLabel}`,
    };
  }).sort((left, right) => left.priority - right.priority);
  return { envPath, localConfigPath, env, models };
}

function saveAiKey(toolRoot, modelName, apiKey) {
  const settings = getAiSettings(toolRoot);
  const model = settings.models.find((item) => item.value === modelName);
  if (!model) throw new Error("不支持的 AI 模型。");
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("请输入 API Key。");
  let config = {};
  if (fs.existsSync(settings.localConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(settings.localConfigPath, "utf8"));
    } catch (_error) {
      config = {};
    }
  }
  if (model.provider === "zhipu") config.zhipuApiKey = key;
  else if (model.provider === "deepseek") config.deepseekApiKey = key;
  else if (model.provider === "qwen") config.dashscopeApiKey = key;
  else config.openaiApiKey = key;
  fs.writeFileSync(
    settings.localConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  return {
    provider: model.provider,
    models: getAiSettings(toolRoot).models,
  };
}

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimText(value, maxLength) {
  const text = stripHtml(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function findMissingImageAlt(html) {
  const source = String(html || "");
  const matches = source.match(/<img\b[^>]*>/gi) || [];
  return matches.filter((tag) => !/\balt\s*=/i.test(tag) || /\balt\s*=\s*["']\s*["']/i.test(tag)).length;
}

function missingImagesWithContext(html) {
  const source = String(html || "");
  const result = [];
  const regex = /<img\b[^>]*>/gi;
  let match;
  while ((match = regex.exec(source))) {
    const tag = match[0];
    if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const before = stripHtml(source.slice(Math.max(0, match.index - 280), match.index));
    const after = stripHtml(source.slice(regex.lastIndex, regex.lastIndex + 280));
    result.push({
      src,
      context: trimText(`${before} ${after}`, 320),
    });
  }
  return result;
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fillMissingImageAlt(html, imageAlts, fallbackText = "内容图片") {
  if (typeof imageAlts === "string") fallbackText = imageAlts;
  const suggestions = Array.isArray(imageAlts) ? imageAlts : [];
  const bySrc = new Map(
    suggestions
      .map((item) =>
        typeof item === "string"
          ? { src: "", alt: item }
          : { src: String(item?.src || ""), alt: String(item?.alt || "") },
      )
      .filter((item) => item.alt.trim())
      .map((item) => [item.src, item.alt.trim()]),
  );
  const sequential = suggestions
    .map((item) => (typeof item === "string" ? item : item?.alt))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  let missingIndex = 0;
  return String(html || "").replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) return tag;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const altText = bySrc.get(src) || sequential[missingIndex] || fallbackText;
    const safeAlt = escapeAttribute(String(altText || fallbackText).slice(0, 120));
    missingIndex += 1;
    if (/\balt\s*=/i.test(tag)) {
      return tag.replace(/\balt\s*=\s*(["'])[\s\S]*?\1/i, `alt="${safeAlt}"`);
    }
    return tag.replace(/\/?>$/, (ending) => ` alt="${safeAlt}"${ending}`);
  });
}

function contentType(mcode) {
  return { "1": "单页", "2": "新闻", "3": "产品", "4": "视频" }[String(mcode)] || "内容";
}

function getContentRows(db, acodes = []) {
  const where = acodes.length ? `where c.acode in (${acodes.map(() => "?").join(",")})` : "";
  return queryRows(
    db,
    `select c.id,c.acode,c.scode,c.title,c.subtitle,c.filename,c.ico,c.content,c.keywords,c.description,
            c.date,c.create_time,c.update_time,c.sorting,c.status,c.pics,c.picstitle,
            s.name as sort_name,s.filename as sort_filename,s.mcode
     from ay_content c
     left join ay_content_sort s on s.acode=c.acode and s.scode=c.scode
     ${where}
     order by c.id asc`,
    acodes,
  );
}

function getMenuRows(db, acodes = []) {
  const where = acodes.length ? `where acode in (${acodes.map(() => "?").join(",")})` : "";
  return queryRows(
    db,
    `select id,acode,scode,pcode,name,filename,mcode,title,keywords,description,status,sorting
     from ay_content_sort ${where} order by id asc`,
    acodes,
  );
}

function contentProblems(row) {
  const mcode = String(row.mcode || "");
  if (mcode === "4") return [];
  const problems = [];
  const description = stripHtml(row.description);
  const bodyText = stripHtml(row.content);
  if (!String(row.title || "").trim()) problems.push("title");
  if (!String(row.subtitle || "").trim()) problems.push("subtitle");
  if (mcode !== "2" && !String(row.filename || "").trim()) problems.push("slug");
  if (!String(row.keywords || "").trim()) problems.push("keywords");
  if (!description) problems.push("description");
  else if (description.length > 180) problems.push("description-too-long");
  if (bodyText.length < 120) problems.push("content-too-short");
  if (findMissingImageAlt(row.content)) problems.push("image-alt");
  return problems;
}

function menuProblems(row) {
  const problems = [];
  if (!String(row.name || "").trim()) problems.push("name");
  if (!String(row.filename || "").trim()) problems.push("slug");
  if (!String(row.title || "").trim()) problems.push("title");
  if (!String(row.keywords || "").trim()) problems.push("keywords");
  if (!stripHtml(row.description)) problems.push("description");
  return problems;
}

function getAreaLanguages(db) {
  const rows = queryRows(
    db,
    "select id,acode,name,is_default from ay_area order by id asc",
  )
    .map((row) => ({
      id: Number(row.id),
      acode: String(row.acode || "").trim(),
      name: String(row.name || row.acode || "").trim(),
      isDefault: String(row.is_default || "") === "1",
    }))
    .filter((row) => row.acode);
  if (!rows.some((row) => row.acode === "cn")) {
    throw new Error("区域表中没有中文区域（acode=cn），不能执行以中文为源的同步翻译。");
  }
  return rows;
}

function normalizePbootSlug(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const generated = raw.match(/^(vue-(?:news|product)-\d+)-(?:cn|en|es|fr|ru|ar|pt)$/i);
  if (generated) return generated[1].toLowerCase();
  return raw
    .replace(/^(?:cn|en|es|fr|ru|ar|pt)[-_/]+/i, "")
    .toLowerCase();
}

function normalizeDateKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d]/g, "")
    .slice(0, 14);
}

function getMenuScodeOffsets(menus, languageCodes) {
  const roots = new Map();
  for (const row of menus) {
    if (String(row.pcode || "0") !== "0") continue;
    const scode = Number(row.scode);
    if (!Number.isFinite(scode)) continue;
    const current = roots.get(row.acode);
    if (current === undefined || scode < current) roots.set(row.acode, scode);
  }
  const sourceRoot = roots.get("cn");
  if (!Number.isFinite(sourceRoot)) {
    throw new Error("无法识别中文顶级栏目编号，已停止同步。");
  }
  return Object.fromEntries(
    languageCodes.map((acode) => [
      acode,
      Number.isFinite(roots.get(acode)) ? roots.get(acode) - sourceRoot : null,
    ]),
  );
}

function mapSourceScode(sourceScode, targetAcode, offsets) {
  const offset = offsets[targetAcode];
  const numeric = Number(sourceScode);
  if (!Number.isFinite(numeric) || !Number.isFinite(offset)) return "";
  return String(numeric + offset);
}

function modelTokens(value) {
  return new Set(
    String(value || "")
      .toUpperCase()
      .match(/[A-Z]{1,5}\d{1,5}(?:-\d+)?/g) || [],
  );
}

function productMatchScore(source, target) {
  let score = 0;
  const sourceSlug = normalizePbootSlug(source.filename);
  const targetSlug = normalizePbootSlug(target.filename);
  if (sourceSlug && sourceSlug === targetSlug) score += 120;
  if (source.ico && source.ico === target.ico) score += 80;
  if (source.pics && source.pics === target.pics) score += 45;
  const sourceTokens = modelTokens(source.title);
  const targetTokens = modelTokens(target.title);
  const sharedTokens = [...sourceTokens].filter((token) => targetTokens.has(token));
  score += sharedTokens.length * 35;
  if (Number(source.sorting) === Number(target.sorting)) score += 5;
  return score;
}

function buildTranslationPlan(db) {
  const areas = getAreaLanguages(db);
  const targetAreas = areas.filter((row) => row.acode !== "cn");
  const languageCodes = areas.map((row) => row.acode);
  const menus = getMenuRows(db, languageCodes);
  const contents = getContentRows(db, languageCodes).filter(
    (row) => ["1", "2", "3"].includes(String(row.mcode || "")),
  );
  const offsets = getMenuScodeOffsets(menus, languageCodes);
  const menuByKey = new Map(
    menus.map((row) => [`${row.acode}:${row.scode}`, row]),
  );
  const contentByAcodeScode = new Map();
  for (const row of contents) {
    const key = `${row.acode}:${row.scode}`;
    if (!contentByAcodeScode.has(key)) contentByAcodeScode.set(key, []);
    contentByAcodeScode.get(key).push(row);
  }

  const sourceMenus = menus.filter((row) => row.acode === "cn");
  const sourceContents = contents.filter((row) => row.acode === "cn");
  const languages = [];
  const allContentPairs = [];
  const allMenuPairs = [];

  for (const area of targetAreas) {
    const contentPairs = [];
    const menuPairs = [];
    const skipped = [];
    const usedTargetIds = new Set();

    for (const source of sourceMenus) {
      const targetScode = mapSourceScode(source.scode, area.acode, offsets);
      const target = menuByKey.get(`${area.acode}:${targetScode}`);
      if (target) menuPairs.push({ source, target, targetAcode: area.acode });
    }

    for (const source of sourceContents) {
      const targetScode = mapSourceScode(source.scode, area.acode, offsets);
      const candidates = (contentByAcodeScode.get(`${area.acode}:${targetScode}`) || [])
        .filter((row) => String(row.mcode) === String(source.mcode))
        .filter((row) => !usedTargetIds.has(Number(row.id)));
      let target = null;

      if (String(source.mcode) === "1") {
        if (candidates.length === 1) target = candidates[0];
      } else if (String(source.mcode) === "2") {
        const sourceDate = normalizeDateKey(
          source.date || source.create_time || source.update_time,
        );
        const dated = candidates.filter(
          (row) =>
            normalizeDateKey(row.date || row.create_time || row.update_time) ===
            sourceDate,
        );
        if (dated.length === 1) target = dated[0];
        if (!target) {
          const sourceSlug = normalizePbootSlug(source.filename);
          const slugged = candidates.filter(
            (row) => sourceSlug && normalizePbootSlug(row.filename) === sourceSlug,
          );
          if (slugged.length === 1) target = slugged[0];
        }
      } else {
        const ranked = candidates
          .map((row) => ({ row, score: productMatchScore(source, row) }))
          .sort((left, right) => right.score - left.score);
        if (
          ranked[0] &&
          ranked[0].score >= 60 &&
          (!ranked[1] || ranked[0].score - ranked[1].score >= 15)
        ) {
          target = ranked[0].row;
        }
      }

      if (!target) {
        skipped.push({
          sourceId: Number(source.id),
          type: contentType(source.mcode),
          title: source.title || `#${source.id}`,
        });
        continue;
      }
      usedTargetIds.add(Number(target.id));
      const pair = {
        source,
        target,
        targetAcode: area.acode,
        translateContent: !stripHtml(target.content),
      };
      contentPairs.push(pair);
      allContentPairs.push(pair);
    }

    allMenuPairs.push(...menuPairs);
    languages.push({
      id: area.id,
      acode: area.acode,
      name: area.name,
      contentCount: contentPairs.length,
      menuCount: menuPairs.length,
      skippedCount: skipped.length,
      samples: skipped.slice(0, 5),
    });
  }

  return {
    areas,
    sourceContentCount: sourceContents.length,
    sourceMenuCount: sourceMenus.length,
    languages,
    contentPairs: allContentPairs,
    menuPairs: allMenuPairs,
  };
}

function filterTranslationPlan(plan, targetAcode) {
  const acode = String(targetAcode || "").trim().toLowerCase();
  if (!acode) return plan;
  const languages = plan.languages.filter((row) => row.acode === acode);
  if (!languages.length) {
    throw new Error(`数据库中不存在目标语言 ${acode}，请刷新页面后重试。`);
  }
  return {
    ...plan,
    languages,
    contentPairs: plan.contentPairs.filter((pair) => pair.targetAcode === acode),
    menuPairs: plan.menuPairs.filter((pair) => pair.targetAcode === acode),
  };
}

function buildPreview(db, mode, targetAcode = "", problems = []) {
  if (mode === "fix-cn" || mode === "fix-language") {
    const languageCodes =
      mode === "fix-language"
        ? targetAcode
          ? [targetAcode]
          : getAreaLanguages(db).map((area) => area.acode)
        : ["cn"];
    const contents = getContentRows(db, languageCodes)
      .map((row) => ({ row, problems: filterProblems(contentProblems(row), problems) }))
      .filter((item) => item.problems.length);
    const menus = getMenuRows(db, languageCodes)
      .map((row) => ({ row, problems: filterProblems(menuProblems(row), problems) }))
      .filter((item) => item.problems.length);
    return summarizePreview(mode, contents, menus);
  }

  const plan = filterTranslationPlan(buildTranslationPlan(db), targetAcode);
  return {
    mode,
    sourceLanguage: "cn",
    sourceContentCount: plan.sourceContentCount,
    sourceMenuCount: plan.sourceMenuCount,
    contentCount: plan.contentPairs.length,
    menuCount: plan.menuPairs.length,
    totalRecords: plan.contentPairs.length + plan.menuPairs.length,
    fieldCounts: {
      "translated-content-seo": plan.contentPairs.length,
      "translated-menu-seo": plan.menuPairs.length,
      skipped: plan.languages.reduce((sum, row) => sum + row.skippedCount, 0),
    },
    languages: plan.languages,
    samples: plan.contentPairs.slice(0, 8).map((pair) => ({
      id: Number(pair.target.id),
      sourceId: Number(pair.source.id),
      lang: pair.targetAcode,
      type: contentType(pair.source.mcode),
      title: pair.source.title || `#${pair.source.id}`,
      problems: ["translate-from-cn"],
    })),
  };
}

function summarizePreview(mode, contents, menus) {
  const fieldCounts = {};
  for (const item of [...contents, ...menus]) {
    for (const problem of item.problems) {
      fieldCounts[problem] = (fieldCounts[problem] || 0) + 1;
    }
  }
  return {
    mode,
    contentCount: contents.length,
    menuCount: menus.length,
    totalRecords: contents.length + menus.length,
    fieldCounts,
    samples: contents.slice(0, 8).map((item) => ({
      id: Number(item.row.id),
      lang: item.row.acode,
      type: contentType(item.row.mcode),
      title: item.row.title || `#${item.row.id}`,
      problems: item.problems,
    })),
  };
}

function parseJsonText(rawText) {
  let text = String(rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const firstArray = text.indexOf("[");
  const firstObject = text.indexOf("{");
  const start =
    firstArray >= 0 && (firstObject < 0 || firstArray < firstObject) ? firstArray : firstObject;
  if (start > 0) text = text.slice(start);
  const last = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (last >= 0) text = text.slice(0, last + 1);
  return JSON.parse(text);
}

function pickOpenAiText(data) {
  if (data?.output_text) return data.output_text;
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.text) return content.text;
    }
  }
  return "";
}

async function fetchWithTimeout(url, options, timeoutMs = AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callAiOnce(toolRoot, modelName, systemPrompt, userPrompt) {
  const settings = getAiSettings(toolRoot);
  const model = settings.models.find((item) => item.value === modelName && item.available);
  if (!model) throw new Error("所选 AI 模型没有可用的 API Key，请先在 backend/.env 中配置。");

  let response;
  if (model.provider === "zhipu") {
    response = await fetchWithTimeout("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.env.ZHIPU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.value,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
  } else if (model.provider === "deepseek") {
    response = await fetchWithTimeout("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.value,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
  } else if (model.provider === "qwen") {
    response = await fetchWithTimeout("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.env.DASHSCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.value,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
  } else {
    response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.value,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 8192,
      }),
    });
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${model.label} 请求失败 (${response.status})：${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText);
  const rawText =
    model.provider === "zhipu" || model.provider === "deepseek" || model.provider === "qwen"
      ? data?.choices?.[0]?.message?.content || ""
      : pickOpenAiText(data);
  return parseJsonText(rawText);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAiError(error) {
  const message = String(error?.message || error || "");
  return (
    error?.name === "AbortError" ||
    /\((408|429|500|502|503|504)\)/.test(message) ||
    error?.code === "ECONNRESET" ||
    error?.code === "ETIMEDOUT" ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  );
}

function logAiRetry(message) {
  if (currentJob.state === "running") {
    updateJob(currentJob.current, currentJob.total, message);
  }
}

async function callAi(toolRoot, modelName, systemPrompt, userPrompt) {
  const settings = getAiSettings(toolRoot);
  const model = settings.models.find((item) => item.value === modelName);
  const modelLabel = model?.label || modelName;

  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callAiOnce(
        toolRoot,
        modelName,
        systemPrompt,
        userPrompt,
      );
    } catch (error) {
      if (!isRetryableAiError(error) || attempt >= AI_MAX_ATTEMPTS) {
        if (error?.name === "AbortError") {
          throw new Error(
            `${modelLabel} 连续 ${AI_MAX_ATTEMPTS} 次请求超时（每次最多 300 秒）。数据库尚未写入，请稍后再试或切换模型。`,
          );
        }
        throw error;
      }

      const delayMs = AI_RETRY_DELAYS_MS[attempt - 1] || 60000;
      const message = String(error?.message || "");
      const reason =
        error?.name === "AbortError"
          ? "请求超时"
          : error instanceof SyntaxError
            ? "返回内容不完整"
          : /\(429\)/.test(message)
            ? "接口限流"
            : "网络或服务暂时不可用";
      logAiRetry(
        `${modelLabel} ${reason}，${Math.ceil(delayMs / 1000)} 秒后自动重试（${attempt + 1}/${AI_MAX_ATTEMPTS}）`,
      );
      await sleep(delayMs);
    }
  }
  throw new Error(`${modelLabel} 请求失败。`);
}

async function testAiConnection(toolRoot, modelName) {
  const startedAt = Date.now();
  const result = await callAi(
    toolRoot,
    modelName,
    "Return strict JSON only.",
    'Return exactly this JSON object: {"ok":true,"message":"connection-ready"}',
  );
  if (!result || result.ok !== true) {
    throw new Error("模型已经响应，但返回格式不符合要求，请切换模型后重试。");
  }
  return {
    ok: true,
    model: modelName,
    elapsedMs: Date.now() - startedAt,
    message: "模型连接和 JSON 返回格式正常。",
  };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function normalizeSlug(value, fallback) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (raw || fallback).slice(0, 48);
}

function safeDescription(value, fallback) {
  const text = stripHtml(value || fallback);
  return text.slice(0, 180);
}

function safeKeywords(value, fallbackTitle) {
  const text = String(value || "")
    .replace(/[，、;；]+/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  return text || String(fallbackTitle || "").trim();
}

function aiProblems(problems) {
  // "description-too-long" is repaired through the same "description" field;
  // the prompt asks the model to shorten it to under 180 characters.
  return problems
    .map((problem) => (problem === "description-too-long" ? "description" : problem))
    .filter((problem) => AI_REQUIRED_PROBLEMS.has(problem));
}

function filterProblems(problems, selected) {
  if (!Array.isArray(selected) || !selected.length) return problems;
  return problems.filter((problem) => selected.includes(problem));
}

function makeAiInput(item) {
  const row = item.row;
  return {
    id: Number(row.id),
    type: contentType(row.mcode),
    problems: aiProblems(item.problems),
    title: String(row.title || ""),
    subtitle: String(row.subtitle || ""),
    keywords: String(row.keywords || ""),
    description: stripHtml(row.description),
    bodyText: trimText(row.content, 1200),
    missingImages: missingImagesWithContext(row.content),
  };
}

async function generateContentRepairs(
  toolRoot,
  model,
  languageCode,
  items,
  progressOffset,
  progressTotal,
) {
  const output = [];
  const aiItems = items.filter((item) => aiProblems(item.problems).length);
  const batchSize =
    model === "glm-4-flash-250414" ? FAST_MODEL_BATCH_SIZE : BATCH_SIZE;
  const batches = chunks(aiItems, batchSize);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    throwIfStopped();
    updateJob(
      progressOffset + Math.min(index * batchSize, items.length),
      progressTotal,
      `AI 正在处理 ${LANGUAGE_NAMES[languageCode]} 第 ${index + 1}/${batches.length} 批`,
    );
    const prompt = [
      `Repair the requested SEO fields in ${LANGUAGE_NAMES[languageCode]}.`,
      "Only repair fields listed in problems. Preserve product model names, facts, numbers and meaning.",
      "If subtitle is requested, return a concise, informative subtitle that complements the title.",
      "For keywords return 3-8 concise comma-separated phrases.",
      "Descriptions must be natural search snippets between 80 and 160 characters when practical, never over 180; if the given description is already longer than 180 characters, rewrite it shorter while preserving meaning.",
      "If content-too-short is requested, return contentAppendHtml containing useful new HTML paragraphs/headings only; do not repeat existing text and keep it under 500 words.",
      "If slug is requested, return a concise lowercase ASCII slug without a language prefix.",
      "If image-alt is requested, return imageAlts as [{src,alt}] for every missing image. Use the record keywords, title and nearby context. Keep ALT concise and factual; do not keyword-stuff or invent visible details.",
      "Return a strict JSON array. Each object must contain: id, title, subtitle, keywords, description, slug, contentAppendHtml, imageAlts.",
      JSON.stringify(batch.map(makeAiInput)),
    ].join("\n");
    try {
      const result = await callAi(
        toolRoot,
        model,
        "You are a careful industrial-equipment SEO editor. Return strict JSON only and never invent specifications.",
        prompt,
      );
      if (!Array.isArray(result)) throw new Error("AI 返回格式不是数组。");
      output.push(...result);
    } catch (error) {
      if (stopRequested) throw error;
      skippedBatches += 1;
      logAiRetry(`第 ${index + 1}/${batches.length} 批失败已跳过（${batch.length} 条）：${error.message || error}`);
    }
  }
  return output;
}

async function generateMenuRepairs(toolRoot, model, languageCode, items) {
  if (!items.length) return [];
  const batches = chunks(items, 12);
  const output = [];
  for (const batch of batches) {
    throwIfStopped();
    const prompt = [
      `Repair these PbootCMS menu SEO fields in ${LANGUAGE_NAMES[languageCode]}.`,
      "Only repair fields listed in problems. Preserve product model names and numbers.",
      "Slug must be concise lowercase ASCII without language prefix.",
      "Title must be a concise SEO title for the column; keywords 3-8 comma-separated phrases; description a natural snippet under 180 characters.",
      "Return a strict JSON array with: id, name, slug, title, keywords, description.",
      JSON.stringify(
        batch.map((item) => ({
          id: Number(item.row.id),
          problems: item.problems,
          name: item.row.name || "",
          title: item.row.title || "",
          keywords: item.row.keywords || "",
          description: stripHtml(item.row.description),
          parentCode: item.row.pcode || "",
        })),
      ),
    ].join("\n");
    try {
      const result = await callAi(
        toolRoot,
        model,
        "You are a careful multilingual website information architect. Return strict JSON only.",
        prompt,
      );
      if (!Array.isArray(result)) throw new Error("AI 返回的栏目格式不是数组。");
      output.push(...result);
    } catch (error) {
      if (stopRequested) throw error;
      skippedBatches += 1;
      logAiRetry(`一批栏目处理失败已跳过（${batch.length} 条）：${error.message || error}`);
    }
  }
  return output;
}

async function generateContentTranslations(
  toolRoot,
  model,
  targetArea,
  pairs,
  progressOffset,
  progressTotal,
) {
  const output = [];
  const batchSize = model === "glm-4-flash-250414" ? 6 : 3;
  const normalPairs = pairs.filter((pair) => !pair.translateContent);
  const contentPairs = pairs.filter((pair) => pair.translateContent);
  const batches = [
    ...chunks(normalPairs, batchSize),
    ...contentPairs.map((pair) => [pair]),
  ];

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    updateJob(
      progressOffset + Math.min(index * batchSize, pairs.length),
      progressTotal,
      `正在从中文同步 ${targetArea.name || targetArea.acode} 第 ${index + 1}/${batches.length} 批`,
    );
    const prompt = [
      `Translate the following Simplified Chinese website records into ${LANGUAGE_NAMES[targetArea.acode] || targetArea.name || targetArea.acode}.`,
      "The Chinese record is the only source of truth. Translate naturally for industrial-equipment SEO.",
      "Preserve product model names, specifications, numbers, image URLs, video URLs and all factual meaning. Never invent facts.",
      "Translate title, subtitle, keywords and description. Keywords must contain 3-8 concise comma-separated phrases. Description should be a natural search snippet and never exceed 180 characters.",
      "Only when translateContent is true, also return contentHtml. Preserve HTML structure and all src/href/style/class attributes; translate visible text and image alt/title text only.",
      "Only when needSlug is true, return a concise lowercase ASCII slug without a language prefix. Existing URL names are preserved by the application.",
      "Return imageAlts as [{src,alt}] for each listed missing image, using translated keywords, title and nearby context. Keep ALT factual and concise.",
      "Return a strict JSON array with exactly one object per input row and keys: targetId,title,subtitle,keywords,description,slug,contentHtml,imageAlts.",
      JSON.stringify(
        batch.map((pair) => ({
          targetId: Number(pair.target.id),
           type: contentType(pair.source.mcode),
           translateContent: pair.translateContent,
           needSlug:
             String(pair.source.mcode || "") !== "2" &&
             !String(pair.target.filename || "").trim(),
           title: String(pair.source.title || ""),
          subtitle: String(pair.source.subtitle || ""),
          keywords: String(pair.source.keywords || ""),
           description: stripHtml(pair.source.description),
           contentHtml: pair.translateContent ? String(pair.source.content || "") : "",
           missingImages: missingImagesWithContext(
             pair.translateContent ? pair.source.content : pair.target.content,
           ),
        })),
      ),
    ].join("\n");
    const result = await callAi(
      toolRoot,
      model,
      "You are a careful multilingual industrial-equipment translator and SEO editor. Return strict JSON only.",
      prompt,
    );
    if (!Array.isArray(result)) {
      throw new Error("AI 返回的同步翻译格式不是数组，已停止写入数据库。");
    }
    const expectedIds = new Set(batch.map((pair) => Number(pair.target.id)));
    const returnedIds = new Set(result.map((row) => Number(row.targetId)));
    if (
      returnedIds.size !== expectedIds.size ||
      [...expectedIds].some((id) => !returnedIds.has(id))
    ) {
      throw new Error("AI 返回的同步翻译记录不完整，已停止写入数据库。");
    }
    output.push(...result);
  }
  return output;
}

async function generateMenuTranslations(toolRoot, model, targetArea, pairs) {
  if (!pairs.length) return [];
  const output = [];
  const batches = chunks(pairs, model === "glm-4-flash-250414" ? 12 : 8);
  for (const batch of batches) {
    const prompt = [
      `Translate these Simplified Chinese PbootCMS menu SEO fields into ${LANGUAGE_NAMES[targetArea.acode] || targetArea.name || targetArea.acode}.`,
      "Translate name, title, keywords and description naturally. Preserve model names and numbers.",
      "Only when needSlug is true, return a concise lowercase ASCII slug without a language prefix. Existing URL names are preserved by the application.",
      "Return a strict JSON array with exactly one object per input row and keys: targetId,name,title,keywords,description,slug.",
      JSON.stringify(
        batch.map((pair) => ({
           targetId: Number(pair.target.id),
           needSlug: !String(pair.target.filename || "").trim(),
           name: String(pair.source.name || ""),
          title: String(pair.source.title || pair.source.name || ""),
          keywords: String(pair.source.keywords || ""),
          description: stripHtml(pair.source.description),
        })),
      ),
    ].join("\n");
    const result = await callAi(
      toolRoot,
      model,
      "You are a careful multilingual website information architect. Return strict JSON only.",
      prompt,
    );
    if (!Array.isArray(result)) {
      throw new Error("AI 返回的栏目同步翻译格式不是数组，已停止写入数据库。");
    }
    const expectedIds = new Set(batch.map((pair) => Number(pair.target.id)));
    const returnedIds = new Set(result.map((row) => Number(row.targetId)));
    if (
      returnedIds.size !== expectedIds.size ||
      [...expectedIds].some((id) => !returnedIds.has(id))
    ) {
      throw new Error("AI 返回的栏目同步翻译记录不完整，已停止写入数据库。");
    }
    output.push(...result);
  }
  return output;
}

function prepareTranslationUpdates(contentPairs, menuPairs, aiContents, aiMenus) {
  const contentMap = new Map(
    aiContents.map((row) => [Number(row.targetId), row]),
  );
  const menuMap = new Map(aiMenus.map((row) => [Number(row.targetId), row]));
  const contentUpdates = contentPairs.map((pair) => {
    const ai = contentMap.get(Number(pair.target.id));
    if (!ai || !String(ai.title || "").trim()) {
      throw new Error(`目标内容 #${pair.target.id} 缺少 AI 翻译结果，已停止写入数据库。`);
    }
    let content = String(pair.target.content || "");
    if (pair.translateContent && ai.contentHtml) content = String(ai.contentHtml).trim();
    content = fillMissingImageAlt(content, ai.imageAlts, ai.title);
    return {
      id: Number(pair.target.id),
      title: String(ai.title || "").trim(),
      subtitle: String(ai.subtitle || "").trim(),
      filename:
        String(pair.target.filename || "").trim() ||
        (String(pair.source.mcode || "") !== "2" && ai.slug
          ? `${pair.target.acode}-${normalizeSlug(ai.slug, pair.target.id)}`
          : ""),
      keywords: safeKeywords(ai.keywords, ai.title),
      description: safeDescription(ai.description, ai.title),
      content,
    };
  });
  const menuUpdates = menuPairs.map((pair) => {
    const ai = menuMap.get(Number(pair.target.id));
    if (!ai || !String(ai.name || "").trim()) {
      throw new Error(`目标栏目 #${pair.target.id} 缺少 AI 翻译结果，已停止写入数据库。`);
    }
    return {
      id: Number(pair.target.id),
      name: String(ai.name || "").trim(),
      filename:
        String(pair.target.filename || "").trim() ||
        `${pair.target.acode}-${normalizeSlug(ai.slug || ai.name, pair.target.scode || pair.target.id)}`,
      title: String(ai.title || ai.name || "").trim(),
      keywords: safeKeywords(ai.keywords, ai.name),
      description: safeDescription(ai.description, ai.name),
    };
  });
  return { contentUpdates, menuUpdates };
}

function prepareUpdates(contents, menus, aiContents, aiMenus, languageCode) {
  const contentMap = new Map(
    aiContents.map((item) => [Number(item.id), item]),
  );
  const menuMap = new Map(aiMenus.map((item) => [Number(item.id), item]));
  const contentUpdates = [];
  const menuUpdates = [];

  for (const item of contents) {
    const row = item.row;
    const ai = contentMap.get(Number(row.id)) || {};
    const next = {
      id: Number(row.id),
      title: String(row.title || ""),
      subtitle: String(row.subtitle || ""),
      filename: String(row.filename || ""),
      keywords: String(row.keywords || ""),
      description: String(row.description || ""),
      content: String(row.content || ""),
    };
    if (item.problems.includes("title") && ai.title) next.title = String(ai.title).trim();
    if (item.problems.includes("subtitle") && ai.subtitle) next.subtitle = String(ai.subtitle).trim();
    if (item.problems.includes("slug") && ai.slug) {
      next.filename = `${languageCode}-${normalizeSlug(ai.slug, row.id)}`;
    }
    if (item.problems.includes("keywords")) {
      next.keywords = safeKeywords(ai.keywords, next.title);
    }
    if (item.problems.includes("description")) {
      next.description = safeDescription(ai.description, trimText(row.content, 160));
    }
    if (item.problems.includes("description-too-long")) {
      next.description = safeDescription(ai.description || row.description, row.description);
    }
    if (item.problems.includes("content-too-short") && ai.contentAppendHtml) {
      next.content = `${next.content}\n${String(ai.contentAppendHtml).trim()}`;
    }
    if (item.problems.includes("image-alt")) {
      next.content = fillMissingImageAlt(next.content, ai.imageAlts, next.title);
    }
    contentUpdates.push(next);
  }

  for (const item of menus) {
    const row = item.row;
    const ai = menuMap.get(Number(row.id)) || {};
    const next = {
      id: Number(row.id),
      name: String(row.name || ""),
      filename: String(row.filename || ""),
      title: String(row.title || ""),
      keywords: String(row.keywords || ""),
      description: String(row.description || ""),
    };
    if (item.problems.includes("name") && ai.name) next.name = String(ai.name).trim();
    if (item.problems.includes("slug")) {
      next.filename = `${languageCode}-${normalizeSlug(ai.slug || next.name, row.scode || row.id)}`;
    }
    if (item.problems.includes("title") && ai.title) next.title = String(ai.title).trim();
    if (item.problems.includes("keywords")) {
      next.keywords = safeKeywords(ai.keywords, next.title || next.name);
    }
    if (item.problems.includes("description")) {
      next.description = safeDescription(ai.description, next.title || next.name);
    }
    menuUpdates.push(next);
  }

  return { contentUpdates, menuUpdates };
}

function truncatePreviewText(value, max = 200) {
  const text = stripHtml(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildPreviewDiff(work, contentUpdates, menuUpdates) {
  const contentRows = new Map();
  const menuRows = new Map();
  for (const { contents, menus } of work) {
    for (const item of contents) contentRows.set(Number(item.row.id), item.row);
    for (const item of menus) menuRows.set(Number(item.row.id), item.row);
  }

  const contentFields = [
    ["title", "标题"],
    ["subtitle", "副标题"],
    ["filename", "URL名称"],
    ["keywords", "关键词"],
    ["description", "描述"],
    ["content", "正文"],
  ];
  const menuFields = [
    ["name", "栏目名"],
    ["filename", "URL名称"],
    ["title", "标题"],
    ["keywords", "关键词"],
    ["description", "描述"],
  ];

  const diffFields = (row, next, fields) => {
    const changes = [];
    for (const [key, label] of fields) {
      const before = String(row[key] || "");
      const after = String(next[key] || "");
      if (before !== after) {
        changes.push({
          field: label,
          old: truncatePreviewText(before),
          new: truncatePreviewText(after),
        });
      }
    }
    return changes;
  };

  const items = [];
  for (const next of contentUpdates) {
    const row = contentRows.get(Number(next.id));
    if (!row) continue;
    const changes = diffFields(row, next, contentFields);
    if (changes.length) {
      items.push({
        kind: "content",
        id: Number(next.id),
        lang: String(row.acode || ""),
        type: contentType(row.mcode),
        title: String(row.title || ""),
        changes,
      });
    }
  }
  for (const next of menuUpdates) {
    const row = menuRows.get(Number(next.id));
    if (!row) continue;
    const changes = diffFields(row, next, menuFields);
    if (changes.length) {
      items.push({
        kind: "menu",
        id: Number(next.id),
        lang: String(row.acode || ""),
        type: "栏目",
        title: String(row.name || ""),
        changes,
      });
    }
  }
  return items;
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function backupDatabase(toolRoot, dbPath, label) {
  const backupRoot = path.resolve(toolRoot, "..", "..", "backups", "seo_ai_database");
  fs.mkdirSync(backupRoot, { recursive: true });
  const extension = path.extname(dbPath) || ".db";
  const backupPath = path.join(
    backupRoot,
    `${path.basename(dbPath, extension)}.before_${label}_${timestamp()}${extension}`,
  );
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function applyUpdates(db, updates) {
  db.run("begin immediate transaction");
  try {
    const contentStmt = db.prepare(
      `update ay_content
       set title=?,subtitle=?,filename=?,keywords=?,description=?,content=?,update_time=?
       where id=?`,
    );
    const menuStmt = db.prepare(
      `update ay_content_sort
       set name=?,filename=?,title=?,keywords=?,description=?,update_time=?
       where id=?`,
    );
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    try {
      for (const row of updates.contentUpdates) {
        contentStmt.run([
          row.title,
          row.subtitle,
          row.filename,
          row.keywords,
          row.description,
          row.content,
          now,
          row.id,
        ]);
      }
      for (const row of updates.menuUpdates) {
        menuStmt.run([
          row.name,
          row.filename,
          row.title || "",
          row.keywords || "",
          row.description || "",
          now,
          row.id,
        ]);
      }
    } finally {
      contentStmt.free();
      menuStmt.free();
    }
    db.run("commit");
  } catch (error) {
    db.run("rollback");
    throw error;
  }
}

function persistDatabase(db, dbPath) {
  const tempPath = `${dbPath}.seo-ai-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(db.export()));
  const exportedSize = fs.statSync(tempPath).size;
  if (exportedSize < 1024) {
    fs.unlinkSync(tempPath);
    throw new Error("导出的数据库异常过小，已停止覆盖原数据库。");
  }
  fs.copyFileSync(tempPath, dbPath);
  fs.unlinkSync(tempPath);
}

function updateJob(current, total, message) {
  currentJob.current = Math.min(current, total);
  currentJob.total = total;
  currentJob.percent = total ? Math.round((currentJob.current / total) * 100) : 0;
  currentJob.message = message;
  currentJob.logs.push(`[${new Date().toLocaleTimeString("zh-CN")}] ${message}`);
  currentJob.logs = currentJob.logs.slice(-80);
}

async function runJob(toolRoot, dbPath, mode, model, targetAcode = "", problems = [], dryRun = false) {
  const SQL = await loadSql(toolRoot);
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    if (mode === "generate-languages" || mode === "translate-language") {
      const plan = filterTranslationPlan(
        buildTranslationPlan(db),
        mode === "translate-language" ? targetAcode : "",
      );
      const totalRecords = plan.contentPairs.length + plan.menuPairs.length;
      const allContentUpdates = [];
      const allMenuUpdates = [];
      let progressOffset = 0;

      for (const language of plan.languages) {
        const contentPairs = plan.contentPairs.filter(
          (pair) => pair.targetAcode === language.acode,
        );
        const menuPairs = plan.menuPairs.filter(
          (pair) => pair.targetAcode === language.acode,
        );
        updateJob(
          progressOffset,
          totalRecords,
          `正在准备 ${language.name || language.acode}：内容 ${contentPairs.length} 条，栏目 ${menuPairs.length} 条`,
        );
        const aiContents = await generateContentTranslations(
          toolRoot,
          model,
          language,
          contentPairs,
          progressOffset,
          totalRecords,
        );
        progressOffset += contentPairs.length;
        const aiMenus = await generateMenuTranslations(
          toolRoot,
          model,
          language,
          menuPairs,
        );
        const updates = prepareTranslationUpdates(
          contentPairs,
          menuPairs,
          aiContents,
          aiMenus,
        );
        allContentUpdates.push(...updates.contentUpdates);
        allMenuUpdates.push(...updates.menuUpdates);
        progressOffset += menuPairs.length;
      }

      if (!allContentUpdates.length && !allMenuUpdates.length) {
        currentJob.result = {
          changed: 0,
          backupPath: "",
          message: "没有找到可以安全对应的目标语言记录。",
        };
        return;
      }

      updateJob(totalRecords, totalRecords, "翻译结果已生成，正在自动备份数据库");
      const backupPath = backupDatabase(toolRoot, dbPath, "translations_from_cn");
      applyUpdates(db, {
        contentUpdates: allContentUpdates,
        menuUpdates: allMenuUpdates,
      });
      persistDatabase(db, dbPath);
      currentJob.result = {
        changed: allContentUpdates.length + allMenuUpdates.length,
        contentChanged: allContentUpdates.length,
        menuChanged: allMenuUpdates.length,
        backupPath,
        languages: plan.languages,
      };
      updateJob(
        totalRecords,
        totalRecords,
        `${mode === "translate-language" ? "当前语言翻译" : "同步翻译"}完成，共更新 ${currentJob.result.changed} 条；中文和视频未修改`,
      );
      return;
    }

    const languageCodes =
      mode === "fix-language"
        ? targetAcode
          ? [targetAcode]
          : getAreaLanguages(db).map((area) => area.acode)
        : ["cn"];
    const work = languageCodes.map((languageCode) => {
      const contents = getContentRows(db, [languageCode])
        .map((row) => ({ row, problems: filterProblems(contentProblems(row), problems) }))
        .filter((item) => item.problems.length);
      const menus = getMenuRows(db, [languageCode])
        .map((row) => ({ row, problems: filterProblems(menuProblems(row), problems) }))
        .filter((item) => item.problems.length);
      return { languageCode, contents, menus };
    });
    const slugChanged = work.some(
      (item) =>
        item.contents.some((c) => c.problems.includes("slug")) ||
        item.menus.some((m) => m.problems.includes("slug")),
    );
    const totalRecords = work.reduce(
      (sum, item) => sum + item.contents.length + item.menus.length,
      0,
    );
    const allContentUpdates = [];
    const allMenuUpdates = [];
    let progressOffset = 0;

    for (const { languageCode, contents, menus } of work) {
      updateJob(
        progressOffset,
        totalRecords,
        `正在准备 ${LANGUAGE_NAMES[languageCode]}：${contents.length + menus.length} 条`,
      );
      const aiContents = await generateContentRepairs(
        toolRoot,
        model,
        languageCode,
        contents,
        progressOffset,
        totalRecords,
      );
      const aiMenus = await generateMenuRepairs(toolRoot, model, languageCode, menus);
      const aiContentIds = new Set(aiContents.map((row) => Number(row.id)));
      const aiMenuIds = new Set(aiMenus.map((row) => Number(row.id)));
      const fixedContents = contents.filter((item) => aiContentIds.has(Number(item.row.id)));
      const fixedMenus = menus.filter((item) => aiMenuIds.has(Number(item.row.id)));
      const updates = prepareUpdates(
        fixedContents,
        fixedMenus,
        aiContents,
        aiMenus,
        languageCode,
      );
      allContentUpdates.push(...updates.contentUpdates);
      allMenuUpdates.push(...updates.menuUpdates);
      progressOffset += contents.length + menus.length;
    }

    if (!allContentUpdates.length && !allMenuUpdates.length) {
      currentJob.result = {
        changed: 0,
        backupPath: "",
        skippedBatches,
        message: skippedBatches
          ? `全部 ${skippedBatches} 批 AI 调用失败，未写入任何数据。`
          : "没有需要修改的问题。",
      };
      return;
    }

    if (dryRun) {
      const preview = buildPreviewDiff(work, allContentUpdates, allMenuUpdates);
      pendingUpdates = {
        contentUpdates: allContentUpdates,
        menuUpdates: allMenuUpdates,
        slugChanged,
      };
      currentJob.result = {
        changed: allContentUpdates.length + allMenuUpdates.length,
        contentChanged: allContentUpdates.length,
        menuChanged: allMenuUpdates.length,
        slugChanged,
        skippedBatches,
        preview,
        dryRun: true,
        message: "预览完成，尚未写入数据库。",
      };
      return;
    }

    updateJob(totalRecords, totalRecords, "AI 结果已生成，正在自动备份数据库");
    const backupPath = backupDatabase(
      toolRoot,
      dbPath,
      mode === "fix-cn" ? "seo_cn" : "seo_languages",
    );
    applyUpdates(db, {
      contentUpdates: allContentUpdates,
      menuUpdates: allMenuUpdates,
    });
    persistDatabase(db, dbPath);
    currentJob.result = {
      changed: allContentUpdates.length + allMenuUpdates.length,
      contentChanged: allContentUpdates.length,
      menuChanged: allMenuUpdates.length,
      slugChanged,
      skippedBatches,
      backupPath,
    };
    const skippedNote = skippedBatches ? `；跳过 ${skippedBatches} 批（AI 调用失败，对应记录本次未修改）` : "";
    updateJob(totalRecords, totalRecords, `写入完成，共修改 ${currentJob.result.changed} 条${skippedNote}`);
  } finally {
    db.close();
  }
}

function startJob(toolRoot, dbPath, body) {
  if (currentJob.state === "running") {
    throw new Error("已有 SEO AI 任务正在运行，请等待当前任务完成。");
  }
  const requestedMode = String(body.mode || "");
  const mode = ["generate-languages", "translate-language", "fix-language"].includes(requestedMode)
    ? requestedMode
    : "fix-cn";
  const targetAcode = String(body.targetAcode || "").trim().toLowerCase();
  if (mode === "translate-language" && !targetAcode) {
    throw new Error("请选择一个需要翻译的目标语言。");
  }
  const problems = Array.isArray(body.problems) ? body.problems.map(String) : [];
  const dryRun = body.dryRun === true;
  const model = String(body.model || "").trim();
  const settings = getAiSettings(toolRoot);
  if (!settings.models.some((item) => item.value === model && item.available)) {
    throw new Error("请选择一个已配置 API Key 的 AI 模型。");
  }
  stopRequested = false;
  skippedBatches = 0;
  pendingUpdates = null;
  currentJob = {
    ...createIdleJob(),
    state: "running",
    mode,
    targetAcode,
    message: "任务已启动",
    startedAt: new Date().toISOString(),
    logs: [`[${new Date().toLocaleTimeString("zh-CN")}] 任务已启动`],
  };
  setImmediate(async () => {
    try {
      await runJob(toolRoot, dbPath, mode, model, targetAcode, problems, dryRun);
      currentJob.state = "completed";
      currentJob.percent = 100;
      currentJob.finishedAt = new Date().toISOString();
    } catch (error) {
      if (stopRequested) {
        currentJob.state = "stopped";
        currentJob.error = "";
        currentJob.message = "任务已被用户停止，数据库未写入";
        currentJob.logs.push(`[${new Date().toLocaleTimeString("zh-CN")}] 已停止`);
      } else {
        currentJob.state = "failed";
        currentJob.error = error.message || String(error);
        currentJob.message = "任务失败，数据库未写入或已保留自动备份";
        currentJob.logs.push(
          `[${new Date().toLocaleTimeString("zh-CN")}] ERROR: ${currentJob.error}`,
        );
      }
      currentJob.finishedAt = new Date().toISOString();
    }
  });
  return currentJob;
}

async function applyPendingUpdates(toolRoot, dbPath) {
  if (!pendingUpdates) {
    throw new Error("没有待写入的预览结果，请先点「预览修复」。");
  }
  const { contentUpdates, menuUpdates, slugChanged = false } = pendingUpdates;
  const SQL = await loadSql(toolRoot);
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const backupPath = backupDatabase(toolRoot, dbPath, "seo_preview_apply");
    applyUpdates(db, { contentUpdates, menuUpdates });
    persistDatabase(db, dbPath);
    pendingUpdates = null;
    return {
      changed: contentUpdates.length + menuUpdates.length,
      contentChanged: contentUpdates.length,
      menuChanged: menuUpdates.length,
      slugChanged,
      backupPath,
      message: `已写入 ${contentUpdates.length + menuUpdates.length} 条。`,
    };
  } finally {
    db.close();
  }
}

async function getPreview(toolRoot, dbPath, input) {
  const SQL = await loadSql(toolRoot);
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const body = typeof input === "object" && input ? input : { mode: input };
    const requestedMode = String(body.mode || "");
    const mode = ["generate-languages", "translate-language", "fix-language"].includes(requestedMode)
      ? requestedMode
      : "fix-cn";
    return buildPreview(
      db,
      mode,
      String(body.targetAcode || "").trim().toLowerCase(),
      Array.isArray(body.problems) ? body.problems.map(String) : [],
    );
  } finally {
    db.close();
  }
}

module.exports = {
  applyPendingUpdates,
  getAiSettings,
  getJob: () => currentJob,
  getPreview,
  requestStop,
  saveAiKey,
  startJob,
  testAiConnection,
  _test: {
    applyUpdates,
    backupDatabase,
    contentProblems,
    fillMissingImageAlt,
    persistDatabase,
  },
};
