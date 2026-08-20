const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const seoAi = require("./ai-seo");

const TOOL_ROOT = __dirname;
const PACKAGE_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const PUBLIC_ROOT = path.join(TOOL_ROOT, "public");
const CONFIG_PATH = path.join(TOOL_ROOT, "seo.config.json");
const BACKEND_ENV_PATH = path.join(PACKAGE_ROOT, "backend", ".env");
const FTP_CONFIG_PATH = path.join(PACKAGE_ROOT, "tools", "ftp_publish_tool", "ftp.config.json");
const CONFIGURED_PORT = (() => {
  try {
    return Number(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).localPort || 5188);
  } catch (_error) {
    return 5188;
  }
})();
const PORT = Number(process.env.SEO_TOOL_PORT || CONFIGURED_PORT);

let SQL_PROMISE;

function loadSql() {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs({
      locateFile: (file) => path.join(TOOL_ROOT, "node_modules", "sql.js", "dist", file),
    });
  }
  return SQL_PROMISE;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return fs.readFileSync(file, "utf8").split(/\r?\n/).reduce((result, line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2];
    return result;
  }, {});
}

function getProjectSettings() {
  const env = parseEnvFile(BACKEND_ENV_PATH);
  let ftp = {};
  try {
    ftp = readJson(FTP_CONFIG_PATH);
  } catch (_error) {
    ftp = {};
  }
  return {
    backendPort: Number(env.BACKEND_PORT || 5000),
    frontendPort: Number(env.FRONTEND_PORT || 5173),
    configPort: Number(env.CONFIG_WIZARD_PORT || 5190),
    seoPort: PORT,
    ftpPort: Number(ftp.localPort || 5189),
    localDatabasePath: path.resolve(PACKAGE_ROOT, "backend", env.DB_SQLJS_LOCATION || "dev.sqlite"),
  };
}

function buildNavigation(active = "seo") {
  const ports = getProjectSettings();
  return [
    { id: "admin", label: "🖥️ 管理后台", url: `http://localhost:${ports.frontendPort}/#/` },
    { id: "backend", label: "🔌 后端接口", url: `http://localhost:${ports.backendPort}/api-docs` },
    { id: "config", label: "⚙️ 项目配置", url: `http://localhost:${ports.configPort}` },
    { id: "seo", label: "📊 SEO 检查", url: `http://localhost:${ports.seoPort}` },
    { id: "models", label: "🧠 模型总览", url: `http://localhost:${ports.seoPort}/models.html` },
    { id: "models-config", label: "🔑 模型配置", url: `http://localhost:${ports.seoPort}/models-config.html` },
    { id: "ftp", label: "📤 FTP 发布", url: `http://localhost:${ports.ftpPort}` },
  ].map((item) => ({ ...item, active: item.id === active }));
}

function readConfig() {
  const config = readJson(CONFIG_PATH);
  return {
    siteName: "PbootCMS",
    siteBaseUrl: "http://localhost",
    localTestBaseUrl: "http://localhost",
    useLanguageSubdomains: true,
    localRoot: "..",
    databasePath: "",
    outputSitemap: "sitemap.xml",
    outputRobots: "robots.txt",
    trailingSlash: true,
    includeHiddenContent: false,
    includeHiddenMenus: false,
    indexNow: { enabled: true, key: "", endpoint: "https://api.indexnow.org/indexnow" },
    googleSearchConsole: { sitemapUrl: "" },
    googleIndexing: { serviceAccount: null, clientEmail: "" },
    baidu: { enabled: true, token: "", site: "" },
    robots: { disallow: [] },
    ...config,
  };
}

function readRequestBody(req) {
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
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function isSuspiciousPublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".test") ||
      host.endsWith(".ccc") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch (_error) {
    return true;
  }
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function toRelative(root, file) {
  return normalizeSlash(path.relative(root, file));
}

function isBackupDb(name) {
  const lower = name.toLowerCase();
  return lower.includes(".before_") || lower.includes(".bad_") || lower.includes(".old") || lower.includes(".bak") || lower.includes(".backup");
}

function resolveSiteRoot(config) {
  return path.resolve(TOOL_ROOT, config.localRoot || "..");
}

function findDatabase(config) {
  const siteRoot = resolveSiteRoot(config);
  if (config.databasePath) {
    const candidate = path.isAbsolute(config.databasePath) ? config.databasePath : path.resolve(siteRoot, config.databasePath);
    if (!fs.existsSync(candidate)) throw new Error(`Configured database not found: ${candidate}`);
    return candidate;
  }
  const dataDir = path.join(siteRoot, "data");
  if (!fs.existsSync(dataDir)) throw new Error(`PbootCMS data directory not found: ${dataDir}`);
  const dbFiles = fs
    .readdirSync(dataDir)
    .filter((name) => name.toLowerCase().endsWith(".db") && !isBackupDb(name))
    .map((name) => path.join(dataDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!dbFiles.length) throw new Error(`No active .db file found in ${dataDir}`);
  return dbFiles[0];
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

function tableExists(db, tableName) {
  const rows = queryRows(db, "select name from sqlite_master where type='table' and name=? limit 1", [tableName]);
  return rows.length > 0;
}

function parseDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    const date = new Date(number > 9999999999 ? number : number * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  const normalized = text.includes(" ") ? text.replace(" ", "T") : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function sanitizePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname;
  return raw.replace(/^\/+/, "");
}

function getDefaultAcode(areas) {
  return String(areas.find((area) => String(area.is_default) === "1")?.acode || "en");
}

function languageBaseUrl(config, acode, areas, usePublicUrl) {
  const baseUrl = cleanBaseUrl(
    usePublicUrl ? config.siteBaseUrl : config.localTestBaseUrl || config.siteBaseUrl,
  );
  if (!usePublicUrl || !config.useLanguageSubdomains) return baseUrl;
  const languageCode = String(acode || getDefaultAcode(areas));
  if (languageCode === getDefaultAcode(areas)) return baseUrl;
  const parsed = new URL(baseUrl);
  const rootHost = parsed.hostname.replace(/^www\./i, "");
  parsed.hostname = `${languageCode}.${rootHost}`;
  return cleanBaseUrl(parsed.toString());
}

function buildUrl(baseUrl, config, candidate, fallback) {
  let slug = sanitizePath(candidate) || sanitizePath(fallback);
  if (!slug) slug = "";
  let urlPath = slug ? `/${slug.replace(/^\/+/, "")}` : "/";
  if (config.trailingSlash && urlPath !== "/" && !urlPath.endsWith("/") && !path.extname(urlPath)) {
    urlPath += "/";
  }
  return `${cleanBaseUrl(baseUrl)}${urlPath}`;
}

function getPbootRouting(db) {
  const names = ["url_break_char", "url_rule_content_path", "url_rule_suffix"];
  const placeholders = names.map(() => "?").join(",");
  const rows = queryRows(db, `select name,value from ay_config where name in (${placeholders})`, names);
  const values = Object.fromEntries(rows.map((row) => [String(row.name), String(row.value || "")]));
  return {
    breakChar: values.url_break_char || "_",
    contentPath: values.url_rule_content_path === "1",
    suffix: values.url_rule_suffix || ".html",
  };
}

function buildPbootUrl(baseUrl, routePath, suffix) {
  let slug = sanitizePath(routePath);
  if (!slug) return `${cleanBaseUrl(baseUrl)}/`;
  if (suffix === "/") {
    if (!slug.endsWith("/")) slug += "/";
  } else if (suffix && !slug.toLowerCase().endsWith(suffix.toLowerCase())) {
    slug += suffix;
  }
  return `${cleanBaseUrl(baseUrl)}/${slug}`;
}

function buildPbootSortPath(sort, routing) {
  const customPath = sanitizePath(sort.filename);
  if (customPath) return customPath;
  const modelType = String(sort.model_type || "");
  const modelUrlName = String(sort.model_urlname || (modelType === "1" ? "about" : "list"));
  return `${modelUrlName}${routing.breakChar}${sort.scode}`;
}

function buildPbootContentPath(row, routing) {
  const sortPath = sanitizePath(row.sort_filename);
  const contentPath = sanitizePath(row.filename);
  const modelUrlName = String(row.model_urlname || "list");

  if (routing.contentPath) return contentPath || String(row.id || "");
  if (sortPath && contentPath) return `${sortPath}/${contentPath}`;
  if (sortPath) return `${sortPath}/${row.id}`;
  if (contentPath) return `${modelUrlName}${routing.breakChar}${row.scode}/${contentPath}`;
  return `${modelUrlName}${routing.breakChar}${row.scode}/${row.id}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractImages(html) {
  const images = [];
  const regex = /<img\b[^>]*>/gi;
  const srcRegex = /\bsrc\s*=\s*["']([^"']+)["']/i;
  const altRegex = /\balt\s*=\s*["']([^"']*)["']/i;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const tag = match[0];
    const src = tag.match(srcRegex)?.[1] || "";
    const alt = tag.match(altRegex)?.[1] || "";
    images.push({ src, alt });
  }
  return images;
}

function contentTypeName(mcode) {
  const map = { "1": "单页", "2": "新闻", "3": "产品", "4": "视频" };
  return map[String(mcode || "")] || `模型${mcode || "未知"}`;
}

function isNewsType(mcode, typeName) {
  return String(mcode || "") === "2" || String(typeName || "").includes("新闻");
}

function isVideoType(mcode, typeName) {
  return String(mcode || "") === "4" || String(typeName || "").includes("视频");
}

function severityWeight(severity) {
  return { high: 3, medium: 2, low: 1 }[severity] || 0;
}

const PBOOT_LANG_TO_LOCAL = {
  cn: "zh-CN",
  en: "en",
  es: "es",
  fr: "fr",
  ru: "ru",
  ar: "ar",
  pt: "pt",
};

function openLocalAdminDatabase(SQL) {
  const databasePath = getProjectSettings().localDatabasePath;
  if (!fs.existsSync(databasePath)) return null;
  return new SQL.Database(fs.readFileSync(databasePath));
}

function findLocalEditorRecord(localDb, kind, record) {
  if (!localDb) return null;
  const acode = String(record.acode || "");
  const lang = PBOOT_LANG_TO_LOCAL[acode] || acode;

  if (kind === "menu") {
    const match = queryRows(localDb, "select id from menu where code=? limit 1", [
      `pboot:${acode}:${record.scode}`,
    ])[0];
    return match ? { route: "menus", id: match.id } : null;
  }

  const modelMap = {
    "1": { route: "pages", table: "page", translation: "page_translations", foreignKey: "pageId" },
    "2": { route: "news", table: "news", translation: "news_translations", foreignKey: "newsId" },
    "3": { route: "products", table: "product", translation: "product_translations", foreignKey: "productId" },
  };
  if (String(record.mcode) === "4") {
    const match = queryRows(localDb, "select id from video where pbootId=? limit 1", [record.id])[0];
    return match ? { route: "videos", id: match.id } : null;
  }

  const model = modelMap[String(record.mcode || "")];
  if (!model || !tableExists(localDb, model.table)) return null;
  const filename = String(record.filename || "").trim();
  const title = String(record.title || "").trim();
  let match;

  if (tableExists(localDb, model.translation)) {
    match = queryRows(
      localDb,
      `select "${model.foreignKey}" as localId
       from "${model.translation}"
       where lang=? and (
         (? <> '' and lower(urlName)=lower(?)) or
         (? <> '' and title=?)
       )
       order by case when ? <> '' and lower(urlName)=lower(?) then 0 else 1 end
       limit 1`,
      [lang, filename, filename, title, title, filename, filename],
    )[0];
  }
  if (!match) {
    match = queryRows(
      localDb,
      `select id as localId from "${model.table}"
       where ((? <> '' and lower(urlName)=lower(?)) or (? <> '' and title=?))
       order by case when ? <> '' and lower(urlName)=lower(?) then 0 else 1 end
       limit 1`,
      [filename, filename, title, title, filename, filename],
    )[0];
  }
  return match ? { route: model.route, id: match.localId } : null;
}

function buildVueEditorUrl(localDb, kind, record) {
  const localRecord = findLocalEditorRecord(localDb, kind, record);
  if (!localRecord) return "";
  const frontendPort = getProjectSettings().frontendPort;
  return `http://localhost:${frontendPort}/#/${localRecord.route}/edit/${localRecord.id}`;
}

function addIssue(issues, severity, type, title, detail, url, meta = {}) {
  issues.push({ severity, type, title, detail, url, ...meta });
}

async function inspectSite() {
  const config = readConfig();
  const siteRoot = resolveSiteRoot(config);
  const dbPath = findDatabase(config);
  const SQL = await loadSql();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const localAdminDb = openLocalAdminDatabase(SQL);

  try {
    const hasSort = tableExists(db, "ay_content_sort");
    const hasContent = tableExists(db, "ay_content");
    if (!hasSort || !hasContent) throw new Error("This database does not look like a PbootCMS database.");

    const areas = tableExists(db, "ay_area") ? queryRows(db, "select * from ay_area order by acode asc") : [];
    const routing = getPbootRouting(db);
    const sorts = queryRows(
      db,
      `select s.id,s.acode,s.scode,s.pcode,s.name,s.filename,s.mcode,s.status,s.sorting,s.outlink,
              m.type as model_type,m.urlname as model_urlname
       from ay_content_sort s
       left join ay_model m on m.mcode=s.mcode
       ${config.includeHiddenMenus ? "" : "where s.status='1' or s.status=1 or s.status is null"}
       order by s.acode asc, cast(s.sorting as integer) asc, cast(s.scode as integer) asc`,
    );
    const contents = queryRows(
      db,
      `select c.id,c.acode,c.scode,c.title,c.subtitle,c.filename,c.ico,c.content,c.keywords,c.description,c.date,c.create_time,c.update_time,c.sorting,c.status,c.outlink,
              s.name as sort_name,s.filename as sort_filename,s.mcode,
              m.type as model_type,m.urlname as model_urlname
       from ay_content c
       left join ay_content_sort s on s.acode=c.acode and s.scode=c.scode
       left join ay_model m on m.mcode=s.mcode
       ${config.includeHiddenContent ? "" : "where c.status='1' or c.status=1 or c.status is null"}
       order by c.acode asc, cast(c.sorting as integer) asc, c.id asc`,
    );

    const urls = [];
    const issues = [];
    const byLang = new Map();
    const byType = new Map();

    for (const sort of sorts) {
      if (String(sort.outlink || "").trim()) continue;
      const acode = String(sort.acode || "unknown");
      byLang.set(acode, (byLang.get(acode) || 0) + 1);
      const type = contentTypeName(sort.mcode);
      byType.set(type, (byType.get(type) || 0) + 1);

      const sortEditUrl = buildVueEditorUrl(localAdminDb, "menu", sort);
      const sortMeta = {
        editUrl: sortEditUrl,
        recordKind: "menu",
        recordId: String(sort.id || ""),
        acode,
      };
      if (!sort.name) addIssue(issues, "high", "栏目", `栏目缺少名称 #${sort.scode}`, `语言 ${acode}`, "", sortMeta);
      if (!sort.filename) addIssue(issues, "medium", "栏目", `${sort.name || sort.scode} 缺少 URL 名称`, "建议给栏目设置简短英文 URL。", "", sortMeta);

      const sortPath = buildPbootSortPath(sort, routing);
      const url = buildPbootUrl(languageBaseUrl(config, acode, areas, true), sortPath, "/");
      const localUrl = buildPbootUrl(languageBaseUrl(config, acode, areas, false), sortPath, "/");
      urls.push({
        kind: "栏目",
        lang: acode,
        type,
        id: String(sort.scode || ""),
        title: String(sort.name || ""),
        url,
        localUrl,
        lastmod: "",
        priority: sort.pcode && String(sort.pcode) !== "0" ? "0.70" : "0.80",
        changefreq: "weekly",
        editUrl: sortEditUrl,
      });
    }

    for (const row of contents) {
      if (String(row.outlink || "").trim()) continue;
      const acode = String(row.acode || "unknown");
      byLang.set(acode, (byLang.get(acode) || 0) + 1);
      const type = contentTypeName(row.mcode);
      const mcode = String(row.mcode || "");
      const isNews = isNewsType(mcode, type);
      const isVideo = isVideoType(mcode, type);
      byType.set(type, (byType.get(type) || 0) + 1);
      const title = String(row.title || "").trim();
      const description = stripHtml(row.description || "");
      const keywords = String(row.keywords || "").trim();
      const bodyText = stripHtml(row.content || "");
      const contentPath = buildPbootContentPath(row, routing);
      const url = buildPbootUrl(languageBaseUrl(config, acode, areas, true), contentPath, routing.suffix);
      const localUrl = buildPbootUrl(languageBaseUrl(config, acode, areas, false), contentPath, routing.suffix);
      const images = extractImages(row.content);
      const contentEditUrl = buildVueEditorUrl(localAdminDb, "content", row);
      const contentMeta = {
        editUrl: contentEditUrl,
        recordKind: "content",
        recordId: String(row.id || ""),
        mcode,
        acode,
      };

      if (!title) addIssue(issues, "high", type, `${type} #${row.id} 缺少标题`, `语言 ${acode}`, url, contentMeta);
      if (!isVideo && !isNews && !row.filename) {
        addIssue(issues, "high", type, `${title || `#${row.id}`} 缺少 URL 名称`, "建议使用当前语言前缀 + 中文主 ID，例如 en-1096。", url, contentMeta);
      }
      if (!isVideo) {
        if (!keywords) addIssue(issues, "medium", type, `${title || `#${row.id}`} 缺少关键词`, "SEO 三要素之一，建议 3-8 个核心关键词。", url, contentMeta);
        if (!description) addIssue(issues, "medium", type, `${title || `#${row.id}`} 缺少描述`, "SEO 三要素之一，建议 80-160 字符。", url, contentMeta);
        if (description.length > 180) addIssue(issues, "low", type, `${title || `#${row.id}`} 描述偏长`, `当前 ${description.length} 字符，建议 80-160。`, url, contentMeta);
        if (bodyText.length < 120) addIssue(issues, "low", type, `${title || `#${row.id}`} 正文偏短`, `当前约 ${bodyText.length} 字符。`, url, contentMeta);
        for (const image of images) {
          if (!image.alt) addIssue(issues, "low", type, `${title || `#${row.id}`} 正文图片缺少 alt`, image.src, url, contentMeta);
        }
      }

      urls.push({
        kind: "内容",
        lang: acode,
        type,
        id: String(row.id || ""),
        title,
        url,
        localUrl,
        lastmod: parseDate(row.update_time || row.date || row.create_time),
        priority: String(row.mcode) === "3" ? "0.85" : "0.75",
        changefreq: String(row.mcode) === "2" ? "weekly" : "monthly",
        editUrl: contentEditUrl,
      });
    }

    const duplicateUrlMap = new Map();
    for (const item of urls) {
      const matches = duplicateUrlMap.get(item.url) || [];
      matches.push(item);
      duplicateUrlMap.set(item.url, matches);
    }
    for (const [url, matches] of duplicateUrlMap.entries()) {
      const sameKindCounts = matches.reduce((counts, item) => {
        counts[item.kind] = (counts[item.kind] || 0) + 1;
        return counts;
      }, {});
      const duplicateCount = Math.max(...Object.values(sameKindCounts));
      if (duplicateCount > 1) {
        addIssue(
          issues,
          "high",
          "URL",
          "发现重复 URL",
          `${url} 在同类记录中出现 ${duplicateCount} 次。`,
          url,
          {
            editUrl: matches.find((item) => item.editUrl)?.editUrl || "",
            recordKind: matches[0]?.kind || "",
            recordId: matches[0]?.id || "",
            acode: matches[0]?.lang || "",
          },
        );
      }
    }
    const uniqueUrls = [...new Map(urls.map((item) => [item.url, item])).values()];

    issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
    const stats = {
      areas: areas.length,
      menus: sorts.length,
      contents: contents.length,
      urls: uniqueUrls.length,
      issues: issues.length,
      highIssues: issues.filter((item) => item.severity === "high").length,
      mediumIssues: issues.filter((item) => item.severity === "medium").length,
      lowIssues: issues.filter((item) => item.severity === "low").length,
    };

    return {
      config,
      siteRoot,
      dbPath,
      dbRelativePath: toRelative(siteRoot, dbPath),
      stats,
      languages: [...byLang.entries()].map(([acode, count]) => ({
        acode,
        name: String(areas.find((area) => String(area.acode) === acode)?.name || acode),
        count,
      })),
      types: [...byType.entries()].map(([name, count]) => ({ name, count })),
      urls: uniqueUrls,
      issues,
    };
  } finally {
    if (localAdminDb) localAdminDb.close();
    db.close();
  }
}

const HREFLANG_LANGS = ["en", "cn", "es", "fr", "ru", "ar", "pt"];

function hreflangCode(lang) {
  const map = { en: "en", cn: "zh-CN", es: "es", fr: "fr", ru: "ru", ar: "ar", pt: "pt" };
  return map[lang] || lang || "x-default";
}

// 计算跨语言等价页面的分组键：同一内容的各语言版本会得到相同 key
function sitemapGroupKey(item) {
  let pathname = "/";
  try {
    pathname = new URL(item.url).pathname || "/";
  } catch (_error) {
    /* keep "/" */
  }
  pathname = pathname.replace(/\/+$/, "");
  if (!pathname) return "@home";
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length >= 2 && HREFLANG_LANGS.includes(segs[0])) {
    // 内容页 /{lang}/{id}/...：按语言段之后的部分分组
    return `c:${segs.slice(1).join("/")}`;
  }
  // 栏目/单页：去掉开头的 {lang}- 前缀
  let first = segs[0];
  const match = first.match(/^([a-z]{2})-(.+)$/);
  if (match && HREFLANG_LANGS.includes(match[1])) first = match[2];
  return `s:${[first].concat(segs.slice(1)).join("/")}`;
}

function generateSitemapXml(urls) {
  const groups = new Map();
  for (const item of urls) {
    const key = sitemapGroupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const item of urls) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(item.url)}</loc>`);
    if (item.lastmod) lines.push(`    <lastmod>${escapeXml(item.lastmod)}</lastmod>`);
    lines.push(`    <changefreq>${escapeXml(item.changefreq || "weekly")}</changefreq>`);
    lines.push(`    <priority>${escapeXml(item.priority || "0.70")}</priority>`);
    const group = groups.get(sitemapGroupKey(item)) || [item];
    const seen = new Set();
    for (const alt of group) {
      if (!alt.url || seen.has(alt.lang)) continue;
      seen.add(alt.lang);
      lines.push(`    <xhtml:link rel="alternate" hreflang="${hreflangCode(alt.lang)}" href="${escapeXml(alt.url)}"/>`);
    }
    const xDefault = group.find((entry) => entry.lang === "en") || group[0];
    if (xDefault && xDefault.url) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xDefault.url)}"/>`);
    }
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function generateRobotsTxt(config) {
  const lines = ["User-agent: *", "Allow: /"];
  for (const item of config.robots?.disallow || []) {
    lines.push(`Disallow: ${item}`);
  }
  lines.push("");
  lines.push(`Sitemap: ${cleanBaseUrl(config.siteBaseUrl)}/${config.outputSitemap || "sitemap.xml"}`);
  return `${lines.join("\n")}\n`;
}

async function generateFiles() {
  const report = await inspectSite();
  const siteRoot = report.siteRoot;
  const sitemapPath = path.resolve(siteRoot, report.config.outputSitemap || "sitemap.xml");
  const robotsPath = path.resolve(siteRoot, report.config.outputRobots || "robots.txt");
  fs.writeFileSync(sitemapPath, generateSitemapXml(report.urls), "utf8");
  fs.writeFileSync(robotsPath, generateRobotsTxt(report.config), "utf8");
  return {
    sitemapPath,
    robotsPath,
    urlCount: report.urls.length,
    issueCount: report.issues.length,
  };
}

function getFtpToolInfo() {
  const toolRoot = path.resolve(TOOL_ROOT, "..", "ftp_publish_tool");
  const configPath = path.join(toolRoot, "ftp.config.json");
  let config = {};
  try {
    config = readJson(configPath);
  } catch (_error) {
    // The SEO tool remains usable even if the optional FTP tool is absent.
  }
  const port = Number(config.localPort || 5189);
  return {
    toolRoot,
    configPath,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    browserUrl: `http://localhost:${port}`,
    configured: Boolean(config.host && config.user),
  };
}

async function requestFtpTool(pathname, options = {}) {
  const info = getFtpToolInfo();
  const { timeout = 6000, ...fetchOptions } = options;
  try {
    const response = await fetch(`${info.baseUrl}${pathname}`, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeout),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `FTP 工具返回 HTTP ${response.status}`);
    return { info, data };
  } catch (error) {
    throw new Error(`无法连接 FTP 工具（${info.browserUrl}）。请先启动并配置 FTP 工具：${error.message || String(error)}`);
  }
}

async function publishLocalSite() {
  const generated = await generateFiles();
  const config = readConfig();
  const localUrl = cleanBaseUrl(config.localTestBaseUrl || config.siteBaseUrl);
  let localStatus = 0;
  let localMessage = "PB 数据库和 SEO 文件已更新";
  try {
    const response = await fetch(localUrl, {
      headers: { "User-Agent": "PbootCMS-SEO-Tool/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    localStatus = response.status;
    localMessage = response.ok
      ? `PB 本地站更新完成，并已验证可访问（HTTP ${response.status}）`
      : `PB 数据已更新，但本地站返回 HTTP ${response.status}`;
  } catch (error) {
    localMessage = `PB 数据已更新，但无法访问本地站 ${localUrl}：${error.message || String(error)}`;
  }
  return { ok: localStatus >= 200 && localStatus < 400, localUrl, localStatus, message: localMessage, generated };
}

function ensureIndexNowKeys(config, siteRoot, hosts) {
  const next = {
    ...config,
    indexNow: {
      ...config.indexNow,
      keys: { ...(config.indexNow?.keys || {}) },
    },
  };
  const mainHost = new URL(cleanBaseUrl(next.siteBaseUrl)).host;
  let changed = false;
  const keyFiles = [...new Set(hosts)].sort().map((host) => {
    let key = next.indexNow.keys[host];
    if (!key && host === mainHost && next.indexNow.key) {
      key = next.indexNow.key;
    }
    if (!key) {
      key = crypto.randomBytes(16).toString("hex");
      changed = true;
    }
    if (next.indexNow.keys[host] !== key) {
      next.indexNow.keys[host] = key;
      changed = true;
    }
    const keyFile = path.join(siteRoot, `${key}.txt`);
    fs.writeFileSync(keyFile, key, "utf8");
    return { host, key, keyFile };
  });
  if (next.indexNow.key !== next.indexNow.keys[mainHost]) {
    next.indexNow.key = next.indexNow.keys[mainHost] || "";
    changed = true;
  }
  if (changed) writeJson(CONFIG_PATH, next);
  return { config: next, keyFiles };
}

async function verifyIndexNowKey(keyLocation, expectedKey) {
  try {
    const response = await fetch(keyLocation, {
      headers: { "User-Agent": "PbootCMS-SEO-Tool/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const body = (await response.text()).trim();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: `Key 文件返回 HTTP ${response.status}`,
      };
    }
    if (body !== expectedKey) {
      const looksLikeHtml = contentType.includes("text/html") || /^<!doctype html|^<html[\s>]/i.test(body);
      return {
        ok: false,
        status: response.status,
        reason: looksLikeHtml
          ? "线上 Key 文件不存在，该地址被网站重写成了首页。请先用 FTP 工具上传网站根目录中的 IndexNow .txt 文件"
          : "线上 Key 文件内容与当前域名的 IndexNow Key 不一致，请重新上传最新 .txt 文件",
      };
    }
    return { ok: true, status: response.status, reason: "" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: `无法访问 Key 文件：${error.message || String(error)}`,
    };
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIndexNowVerificationPending(body) {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed?.errorCode === "SiteVerificationNotCompleted";
  } catch (_error) {
    return String(body).includes("SiteVerificationNotCompleted");
  }
}

async function submitIndexNowPayload(endpoint, payload) {
  let lastResult = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });
      const body = await response.text();
      const pending = response.status === 202 || isIndexNowVerificationPending(body);
      lastResult = {
        ok: response.ok,
        pending,
        skipped: false,
        status: response.status,
        statusText: response.statusText,
        body,
        pushed: response.ok ? payload.urlList.length : 0,
        requested: payload.urlList.length,
        attempts: attempt,
      };

      if (response.ok) return lastResult;

      const retryableStatus =
        pending ||
        response.status === 408 ||
        response.status === 425 ||
        response.status >= 500;
      if (!retryableStatus || attempt === maxAttempts) return lastResult;
    } catch (error) {
      lastResult = {
        ok: false,
        pending: false,
        skipped: false,
        status: 0,
        statusText: "Request failed",
        body: error.message || String(error),
        pushed: 0,
        requested: payload.urlList.length,
        attempts: attempt,
      };
      if (attempt === maxAttempts) return lastResult;
    }

    await wait(attempt * 2500);
  }

  return lastResult;
}

async function pushIndexNow(options = {}) {
  const report = await inspectSite();
  const siteRoot = report.siteRoot;
  const groups = new Map();
  for (const item of report.urls) {
    const parsed = new URL(item.url);
    const group = groups.get(parsed.host) || { baseUrl: parsed.origin, urlList: [] };
    group.urlList.push(item.url);
    groups.set(parsed.host, group);
  }
  const { config, keyFiles } = ensureIndexNowKeys(report.config, siteRoot, [...groups.keys()]);
  const keyByHost = new Map(keyFiles.map((item) => [item.host, item]));
  const onlyHosts = new Set(
    (Array.isArray(options.onlyHosts) ? options.onlyHosts : [])
      .map((host) => String(host || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const selectedGroups = [...groups.entries()].filter(
    ([host]) => onlyHosts.size === 0 || onlyHosts.has(host.toLowerCase()),
  );
  if (!selectedGroups.length) {
    throw new Error("没有找到需要重试的 IndexNow 域名。");
  }

  const results = [];
  for (const [host, group] of selectedGroups) {
    const hostKey = keyByHost.get(host);
    const keyLocation = `${group.baseUrl}/${path.basename(hostKey.keyFile)}`;
    const verification = await verifyIndexNowKey(keyLocation, hostKey.key);
    if (!verification.ok) {
      results.push({
        host,
        ok: false,
        pending: false,
        skipped: true,
        status: verification.status,
        statusText: "Key verification failed",
        body: verification.reason,
        pushed: 0,
        requested: group.urlList.length,
        keyLocation,
        attempts: 0,
      });
      continue;
    }
    const payload = {
      host,
      key: hostKey.key,
      keyLocation,
      urlList: group.urlList,
    };
    const configuredEndpoints = Array.isArray(config.indexNow.endpoints)
      ? config.indexNow.endpoints
      : [];
    const endpoints = configuredEndpoints.length
      ? configuredEndpoints
      : [config.indexNow.endpoint, "https://yandex.com/indexnow"];
    const endpointResults = [];
    for (const endpoint of endpoints) {
      const endpointResult = await submitIndexNowPayload(endpoint, payload);
      endpointResults.push({ endpoint, ...endpointResult });
    }
    const best = endpointResults.find((item) => item.ok) || endpointResults[0];
    results.push({ host, keyLocation, endpoints: endpointResults, ...best });
  }

  const accepted = results.filter((item) => item.ok);
  const pending = results.filter((item) => item.pending);
  const failed = results.filter((item) => !item.ok && !item.pending);
  const retryable = results.filter((item) => !item.ok);
  const pushed = results.reduce((total, item) => total + item.pushed, 0);
  const failedText = failed
    .map((item) => `${item.host}：${item.body || `HTTP ${item.status}`}`)
    .join("；");
  const pendingText = pending
    .map((item) => item.host)
    .join("、");
  const parts = [`已接收 ${accepted.length} 个域名、${pushed} 个 URL`];
  if (pending.length) parts.push(`平台验证中 ${pending.length} 个域名（${pendingText}）`);
  if (failed.length) parts.push(`失败 ${failed.length} 个域名（${failedText}）`);
  return {
    ok: retryable.length === 0,
    status: results.map((item) => `${item.host}: ${item.status}`).join(", "),
    pushed,
    successfulHosts: accepted.length,
    pendingHosts: pending.length,
    failedHosts: failed.length,
    retryHosts: retryable.map((item) => item.host),
    message: `IndexNow 处理完成：${parts.join("；")}。`,
    groups: results,
    keyFiles,
  };
}

// ===== Bing Webmaster（验证文件 + sitemap 提交 + 收录查询，需在 Bing Webmaster 生成 API Key） =====

function getBingSettings(config = readConfig()) {
  const bing = config.bingWebmaster || {};
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch (_error) {
    host = "";
  }
  return {
    host,
    baseUrl,
    siteUrl: String(bing.siteUrl || (baseUrl ? `${baseUrl}/` : "")).trim(),
    sitemapUrl: `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`,
    apiKeyConfigured: Boolean(bing.apiKey),
    verification: bing.verification?.code ? { code: bing.verification.code } : null,
    links: {
      addSite: "https://www.bing.com/webmasters/home/addsite",
      dashboard: "https://www.bing.com/webmasters/home",
      apiAccess: "https://www.bing.com/webmasters/settings/apikey",
    },
  };
}

function buildBingSiteAuthXml(code) {
  return `<?xml version="1.0"?>\n<users>\n  <user>${String(code).trim()}</user>\n</users>\n`;
}

function getBingApiKey(config = readConfig()) {
  return String((config.bingWebmaster && config.bingWebmaster.apiKey) || "").trim();
}

async function checkBingPublicState() {
  const report = await inspectSite();
  if (isSuspiciousPublicUrl(report.config.siteBaseUrl)) {
    throw new Error("当前站点网址看起来不是线上真实域名，无法检查线上文件。请先修改真实线上域名。");
  }
  const settings = getBingSettings(report.config);
  const result = {
    ok: true,
    verification: null,
    sitemapUrl: settings.sitemapUrl,
    apiKeyConfigured: settings.apiKeyConfigured,
    parts: [],
  };
  if (settings.verification?.code) {
    const filename = "BingSiteAuth.xml";
    const localFile = path.join(report.siteRoot, filename);
    const expected = fs.existsSync(localFile) ? fs.readFileSync(localFile, "utf8").trim() : "";
    const url = `${settings.baseUrl}/${filename}`;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "PbootCMS-SEO-Tool/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.text()).trim();
      const contentOk = !expected || body === expected;
      result.verification = {
        url,
        filename,
        status: response.status,
        ok: response.ok && contentOk,
        reason: !response.ok
          ? `验证文件返回 HTTP ${response.status}（若被重写成首页说明还没上传）`
          : contentOk
            ? ""
            : "线上验证文件内容与本地保存的不一致，请重新上传",
      };
      result.parts.push(result.verification.ok ? "Bing 验证文件线上正常" : "Bing 验证文件线上不可用");
    } catch (error) {
      result.verification = {
        url,
        filename,
        status: 0,
        ok: false,
        reason: `无法访问验证文件：${error.message || String(error)}`,
      };
      result.parts.push("Bing 验证文件线上不可用");
    }
    result.ok = result.ok && Boolean(result.verification.ok);
  } else {
    result.parts.push("尚未配置 Bing 验证码");
  }
  result.parts.push(settings.apiKeyConfigured ? "Bing Webmaster API Key 已配置" : "Bing Webmaster API Key 未配置（sitemap 提交和收录查询需要）");
  return result;
}

async function submitBingSitemap(siteUrl, sitemapUrl, apiKey) {
  const key = String(apiKey || getBingApiKey()).trim();
  if (!key) throw new Error("请先配置 Bing Webmaster API Key。");
  const url = `https://ssl.bing.com/webmaster/api.svc/json/SubmitSitemap?apikey=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteUrl, sitemapUrl }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    /* non-JSON */
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      siteUrl,
      sitemapUrl,
      message: (parsed && (parsed.Message || parsed.message)) || `HTTP ${response.status}`,
    };
  }
  return { ok: true, status: response.status, siteUrl, sitemapUrl, message: `已把 sitemap 提交给 Bing：${sitemapUrl}` };
}

async function inspectBingUrl(siteUrl, targetUrl, apiKey) {
  const key = String(apiKey || getBingApiKey()).trim();
  if (!key) throw new Error("请先配置 Bing Webmaster API Key。");
  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetUrlDetail?apikey=${encodeURIComponent(key)}&siteUrl=${encodeURIComponent(siteUrl)}&url=${encodeURIComponent(targetUrl)}`;
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    /* non-JSON */
  }
  if (!response.ok) {
    return { ok: false, status: response.status, message: (parsed && (parsed.Message || parsed.message)) || `HTTP ${response.status}` };
  }
  const d = (parsed && parsed.d) || {};
  const indexed = Boolean(d.IsIndexed === true || d.isIndexed === true || d.Indexed === true);
  return {
    ok: true,
    inspectionUrl: targetUrl,
    siteUrl,
    indexed,
    lastCrawled: d.DateLastCrawled || d.LastCrawled || d.lastCrawled || "",
    httpCode: d.HttpStatusCode || d.HttpCode || d.httpCode || "",
    message: `Bing 收录状态：${indexed ? "已收录" : "未收录或未知"}`,
    raw: d,
  };
}

// ===== 百度搜索资源平台（主动推送 API，token 在 ziyuan.baidu.com 生成） =====

function getBaiduSettings(config = readConfig()) {
  const baidu = config.baidu || {};
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  return {
    enabled: baidu.enabled !== false,
    token: String(baidu.token || "").trim(),
    site: String(baidu.site || baseUrl).trim(),
    tokenConfigured: Boolean(baidu.token),
    sitemapUrl: `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`,
    links: {
      platform: "https://ziyuan.baidu.com/",
      addSite: "https://ziyuan.baidu.com/linksubmit/index",
      sitemapSubmit: "https://ziyuan.baidu.com/linksubmit/index",
    },
  };
}

async function submitBaiduUrls(urls, options = {}) {
  const cfg = getBaiduSettings();
  if (!cfg.token) throw new Error("请先配置百度推送 token（百度搜索资源平台 → 普通收录 → 主动推送）。");
  const site = String(options.site || cfg.site || "").trim();
  if (!site) throw new Error("缺少百度推送站点（site），请在配置中填写，例如 https://cn.shanbo.cc。");
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((value) => String(value || "").trim())
    .filter((value) => /^https?:\/\//i.test(value));
  if (!list.length) return { ok: true, submitted: 0, success: 0, message: "没有可提交的 URL。" };

  const endpoint = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(site)}&token=${encodeURIComponent(cfg.token)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: list.join("\n"),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new Error(`百度接口请求失败：${error.message || String(error)}。请确认服务器能访问 data.zz.baidu.com。`);
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    parsed = null;
  }
  const success = parsed ? Number(parsed.success) : 0;
  const remain = parsed ? Number(parsed.remain) : null;
  return {
    ok: response.ok && parsed && typeof parsed.success !== "undefined",
    status: response.status,
    submitted: list.length,
    success: Number.isFinite(success) ? success : 0,
    remain: Number.isFinite(remain) ? remain : null,
    notValid: parsed?.not_valid || [],
    notSameSite: parsed?.not_same_site || [],
    message: parsed
      ? `百度推送：成功 ${success}/${list.length}${remain != null ? `，剩余配额 ${remain}` : ""}`
      : `百度接口返回异常：HTTP ${response.status} ${text.slice(0, 160)}`,
  };
}

// 国内搜索引擎站长平台入口（360/搜狗/神马/头条没有标准主动推送 API，需在各自平台提交 sitemap）
function getChineseEnginesInfo(config = readConfig()) {
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  const sitemapUrl = `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`;
  return {
    sitemapUrl,
    engines: [
      {
        id: "baidu",
        name: "百度",
        submitApi: true,
        platform: "https://ziyuan.baidu.com/",
        note: "主动推送 API 已内置，填 token 即可；另建议在平台提交一次 sitemap。",
      },
      {
        id: "360",
        name: "360 搜索",
        platform: "https://zhanzhang.so.com/",
        sitemapSubmit: "https://zhanzhang.so.com/sitetool/sitemap",
        note: "在 360 站长平台验证站点后提交 sitemap（无稳定公开的实时推送 API）。",
      },
      {
        id: "sogou",
        name: "搜狗搜索",
        platform: "https://zhanzhang.sogou.com/",
        sitemapSubmit: "https://zhanzhang.sogou.com/",
        note: "搜狗站长平台验证后提交 sitemap。",
      },
      {
        id: "shenma",
        name: "神马搜索",
        platform: "https://zhanzhang.sm.cn/",
        sitemapSubmit: "https://zhanzhang.sm.cn/",
        note: "阿里旗下移动端搜索，移动流量才有价值，可选。",
      },
      {
        id: "toutiao",
        name: "头条搜索",
        platform: "https://zhanzhang.toutiao.com/",
        sitemapSubmit: "https://zhanzhang.toutiao.com/",
        note: "字节跳动旗下，可选。",
      },
    ],
  };
}

// 收录状态总览：聚合各搜索引擎的配置/提交/验证状态，供顶部总览卡片展示
async function getIndexingOverview() {
  const config = readConfig();
  const report = await inspectSite();
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  const sitemapUrl = `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`;

  const google = getGoogleIndexingConfig(config);
  const gstore = loadGoogleSubmitted();
  const gquota = googleQuotaInfo(gstore, config);
  const sc = getSearchConsoleConfig(config);
  const bing = getBingSettings(config);
  const yandex = getYandexSettings(config);
  const baidu = getBaiduSettings(config);
  const indexNow = config.indexNow || {};
  const indexNowKeyCount = Object.keys(indexNow.keys || {}).length;

  const engines = [
    {
      id: "google",
      name: "Google",
      flag: "🔍",
      channel: "Indexing API + Search Console",
      configured: google.enabled,
      tone: google.enabled ? "success" : "error",
      stats: [
        { label: "服务账号", value: google.enabled ? "已配置" : "未配置" },
        { label: "已提交", value: `${Object.keys(gstore.submitted).length} 条` },
        { label: "今日配额", value: `${gquota.dailyUsed} / ${gquota.dailyLimit}` },
      ],
      nextAction: google.enabled ? "可查单页收录 / 继续每日提交" : "粘贴服务账号 JSON",
      queryable: google.enabled,
      link: "https://search.google.com/search-console",
    },
    {
      id: "bing",
      name: "Bing",
      flag: "🔎",
      channel: "IndexNow + Bing Webmaster",
      configured: bing.apiKeyConfigured || Boolean(bing.verification),
      tone: bing.apiKeyConfigured ? "success" : "warning",
      stats: [
        { label: "API Key", value: bing.apiKeyConfigured ? "已配置" : "未配置" },
        { label: "站点验证", value: bing.verification ? "已配置" : "未配置" },
        { label: "URL 提交", value: "IndexNow 覆盖" },
      ],
      nextAction: bing.apiKeyConfigured ? "可查单页收录状态" : "生成 API Key 后可查收录",
      queryable: bing.apiKeyConfigured,
      link: "https://www.bing.com/webmasters/home",
    },
    {
      id: "yandex",
      name: "Yandex",
      flag: "🇷🇺",
      channel: "IndexNow + Yandex Webmaster",
      configured: Boolean(yandex.verification) || yandex.webmasterTokenConfigured,
      tone: yandex.webmasterTokenConfigured ? "success" : "warning",
      stats: [
        { label: "验证文件", value: yandex.verification?.filename ? "已配置" : "未配置" },
        { label: "OAuth token", value: yandex.webmasterTokenConfigured ? "已配置" : "未配置" },
        { label: "URL 提交", value: "IndexNow 覆盖" },
      ],
      nextAction: yandex.webmasterTokenConfigured ? "可提交 sitemap" : "配置 OAuth 后可提交 sitemap",
      queryable: false,
      link: "https://webmaster.yandex.com/sites/",
    },
    {
      id: "baidu",
      name: "百度",
      flag: "🇨🇳",
      channel: "主动推送 API（中文站）",
      configured: baidu.tokenConfigured,
      tone: baidu.tokenConfigured ? "success" : "error",
      stats: [
        { label: "推送 token", value: baidu.tokenConfigured ? "已配置" : "未配置" },
        { label: "站点", value: baidu.site || "未填" },
      ],
      nextAction: baidu.tokenConfigured ? "可推送中文站全部 URL" : "去 ziyuan.baidu.com 拿 token",
      queryable: false,
      link: "https://ziyuan.baidu.com/",
    },
    {
      id: "indexnow",
      name: "IndexNow",
      flag: "⚡",
      channel: "Bing / DDG / Naver / Seznam / Yep / Yandex",
      configured: Boolean(indexNow.enabled),
      tone: indexNow.enabled ? "success" : "warning",
      stats: [
        { label: "状态", value: indexNow.enabled ? "已启用" : "未启用" },
        { label: "Key 域名", value: `${indexNowKeyCount} 个` },
      ],
      nextAction: "点「推送 IndexNow」一次通吃多家",
      queryable: false,
      link: "https://www.indexnow.org/",
    },
    {
      id: "cn",
      name: "360 / 搜狗 / 神马 / 头条",
      flag: "🏮",
      channel: "站长平台 sitemap（手动）",
      configured: true,
      tone: "info",
      stats: [
        { label: "方式", value: "各平台提交 sitemap" },
        { label: "sitemap", value: sitemapUrl },
      ],
      nextAction: "在各站长平台提交一次 sitemap",
      queryable: false,
      link: "https://zhanzhang.so.com/",
    },
  ];

  return {
    siteBaseUrl: baseUrl,
    sitemapUrl,
    urlCount: report.urls.length,
    readyCount: engines.filter((item) => item.tone === "success").length,
    pendingCount: engines.filter((item) => item.tone === "warning" || item.tone === "error").length,
    engines,
  };
}

function getYandexSettings(config = readConfig()) {
  const yandex = config.yandexWebmaster || {};
  const baseUrl = cleanBaseUrl(config.siteBaseUrl);
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch (_error) {
    host = "";
  }
  return {
    host,
    baseUrl,
    sitemapUrl: `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`,
    verification: yandex.verification?.filename ? { filename: yandex.verification.filename } : null,
    indexNowEnabled: Boolean(config.indexNow?.enabled),
    webmasterTokenConfigured: Boolean(yandex.oauthToken),
    webmasterUserId: String(yandex.userId || ""),
    webmasterHostId: String(yandex.hostId || ""),
    links: {
      addSite: "https://webmaster.yandex.com/sites/add/",
      dashboard: "https://webmaster.yandex.com/sites/",
      sitemapHelp: "https://yandex.com/support/webmaster/working-with-sitemaps.html",
      indexNowHelp: "https://yandex.com/support/webmaster/indexnow.html",
      indexingStatus: "https://yandex.com/support/webmaster/indexing-check/indexing-status.html",
    },
  };
}

async function checkYandexPublicState() {
  const report = await inspectSite();
  if (isSuspiciousPublicUrl(report.config.siteBaseUrl)) {
    throw new Error("当前站点网址看起来不是线上真实域名，无法检查线上文件。请先修改真实线上域名。");
  }
  const hosts = [...new Set(report.urls.map((item) => new URL(item.url).host))];
  const { keyFiles } = ensureIndexNowKeys(report.config, report.siteRoot, hosts);
  const keyChecks = [];
  for (const item of keyFiles) {
    const keyLocation = `https://${item.host}/${path.basename(item.keyFile)}`;
    const result = await verifyIndexNowKey(keyLocation, item.key);
    keyChecks.push({ host: item.host, keyLocation, ...result });
  }

  const settings = getYandexSettings(report.config);
  let verificationCheck = null;
  if (settings.verification?.filename) {
    const localFile = path.join(report.siteRoot, settings.verification.filename);
    const expected = fs.existsSync(localFile) ? fs.readFileSync(localFile, "utf8").trim() : "";
    const url = `${settings.baseUrl}/${settings.verification.filename}`;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "PbootCMS-SEO-Tool/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.text()).trim();
      const contentOk = !expected || body === expected;
      verificationCheck = {
        url,
        filename: settings.verification.filename,
        status: response.status,
        ok: response.ok && contentOk,
        reason: !response.ok
          ? `验证文件返回 HTTP ${response.status}（若被重写成首页说明还没上传）`
          : contentOk
            ? ""
            : "线上验证文件内容与本地保存的不一致，请重新上传",
      };
    } catch (error) {
      verificationCheck = {
        url,
        filename: settings.verification.filename,
        status: 0,
        ok: false,
        reason: `无法访问验证文件：${error.message || String(error)}`,
      };
    }
  }

  const failedKeys = keyChecks.filter((item) => !item.ok);
  const parts = [];
  if (keyChecks.length) parts.push(`IndexNow Key 文件 ${keyChecks.length - failedKeys.length}/${keyChecks.length} 个域名正常`);
  if (settings.verification?.filename) {
    parts.push(verificationCheck?.ok ? "Yandex 验证文件线上正常" : "Yandex 验证文件线上不可用");
  } else {
    parts.push("尚未配置 Yandex 验证文件");
  }
  return {
    ok: failedKeys.length === 0 && (!verificationCheck || verificationCheck.ok),
    keyChecks,
    verificationCheck,
    message: `${parts.join("；")}。`,
  };
}

// ===== Yandex Webmaster API（OAuth token；sitemap 提交，自动解析 user_id/host_id） =====

function getYandexWebmasterConfig(config = readConfig()) {
  const yw = config.yandexWebmaster || {};
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch (_error) {
    host = "";
  }
  return {
    oauthToken: String(yw.oauthToken || "").trim(),
    userId: String(yw.userId || "").trim(),
    hostId: String(yw.hostId || "").trim(),
    host,
    baseUrl,
    sitemapUrl: `${baseUrl}/${config.outputSitemap || "sitemap.xml"}`,
  };
}

async function yandexApi(pathname, token, options = {}) {
  const response = await fetch(`https://api.webmaster.yandex.net/v4${pathname}`, {
    ...options,
    headers: {
      Authorization: `OAuth ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_error) {
    data = null;
  }
  return { ok: response.ok, status: response.status, data, text };
}

function yandexApiError(result) {
  if (result.data && (result.data.error_message || result.data.error_code)) {
    return result.data.error_message || result.data.error_code;
  }
  return `HTTP ${result.status}`;
}

async function resolveYandexHost() {
  const cfg = getYandexWebmasterConfig();
  if (!cfg.oauthToken) throw new Error("请先配置 Yandex OAuth token。");

  let userId = cfg.userId;
  if (!userId) {
    const u = await yandexApi("/user/", cfg.oauthToken);
    if (!u.ok || !(u.data && u.data.user_id)) {
      throw new Error(`获取 Yandex user_id 失败：${yandexApiError(u)}`);
    }
    userId = String(u.data.user_id);
  }

  const h = await yandexApi(`/user/${userId}/hosts/`, cfg.oauthToken);
  if (!h.ok || !(h.data && Array.isArray(h.data.hosts))) {
    throw new Error(`获取 Yandex 站点列表失败：${yandexApiError(h)}`);
  }
  const hosts = h.data.hosts || [];
  const normalize = (v) => String(v || "").toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
  const match = hosts.find((item) => normalize(item.ascii_host || item.unicode_host) === normalize(cfg.host));
  if (!match) {
    throw new Error(
      `在 Yandex Webmaster 里没找到站点 ${cfg.host}。请先在 Yandex Webmaster 添加并验证该站点。已添加的主机：${hosts.map((x) => x.ascii_host || x.unicode_host).join("、") || "（空）"}。`,
    );
  }
  const hostId = String(match.host_id);

  const config = readConfig();
  config.yandexWebmaster = { ...(config.yandexWebmaster || {}), userId, hostId };
  writeJson(CONFIG_PATH, config);
  return { userId, hostId, host: cfg.host, hosts };
}

async function submitYandexSitemap(sitemapUrl) {
  const cfg = getYandexWebmasterConfig();
  if (!cfg.oauthToken) throw new Error("请先配置 Yandex OAuth token。");
  const { userId, hostId } = await resolveYandexHost();
  const target = sitemapUrl || cfg.sitemapUrl;
  const r = await yandexApi(`/user/${userId}/hosts/${hostId}/sitemaps/`, cfg.oauthToken, {
    method: "POST",
    body: JSON.stringify({ url: target }),
  });
  if (!r.ok) {
    return { ok: false, status: r.status, message: `提交失败：${yandexApiError(r)}` };
  }
  return { ok: true, status: r.status, sitemapUrl: target, message: `已把 sitemap 提交给 Yandex：${target}` };
}

function defaultGoogleProperty(config) {
  try {
    return `sc-domain:${new URL(cleanBaseUrl(config.siteBaseUrl)).hostname}`;
  } catch (_error) {
    return "";
  }
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) && !isSuspiciousPublicUrl(url.toString());
  } catch (_error) {
    return false;
  }
}

function getGoogleSearchConsoleSettings(config = readConfig()) {
  const settings = config.googleSearchConsole || {};
  const property = defaultGoogleProperty(config);
  const sitemapUrl = String(
    settings.sitemapUrl ||
      `${cleanBaseUrl(config.siteBaseUrl)}/${config.outputSitemap || "sitemap.xml"}`,
  );
  const sitemapUrlValid = isPublicHttpUrl(sitemapUrl);
  const robotsUrl = `${cleanBaseUrl(config.siteBaseUrl)}/${config.outputRobots || "robots.txt"}`;
  const resourceId = encodeURIComponent(property);
  let publicHost = "";
  let databasePath = "";
  try {
    publicHost = new URL(cleanBaseUrl(config.siteBaseUrl)).hostname;
  } catch (_) {}
  try {
    databasePath = findDatabase(config);
  } catch (_) {}
  const siteRoot = resolveSiteRoot(config);
  const checklist = [
    { id: "site", label: "真实线上域名格式正确", ok: !isSuspiciousPublicUrl(config.siteBaseUrl) },
    { id: "sitemap", label: "Sitemap 使用真实线上地址", ok: sitemapUrlValid },
    { id: "database", label: "当前网站数据库可识别", ok: Boolean(databasePath) },
    { id: "port", label: "配置端口与当前运行端口一致", ok: Number(config.localPort || PORT) === PORT },
  ];
  const issues = checklist.filter((item) => !item.ok).map((item) => item.label);
  return {
    property,
    sitemapUrl,
    sitemapUrlValid,
    robotsUrl,
    consoleUrl: `https://search.google.com/search-console?resource_id=${resourceId}`,
    sitemapsUrl: `https://search.google.com/search-console/sitemaps?resource_id=${resourceId}`,
    pageIndexUrl: `https://search.google.com/search-console/index?resource_id=${resourceId}`,
    helpUrls: {
      sitemap: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
      urlInspection: "https://support.google.com/webmasters/answer/9012289",
      indexingApi: "https://developers.google.com/search/apis/indexing-api/v3/using-api",
    },
    projectIdentity: {
      siteName: String(config.siteName || ""),
      siteBaseUrl: cleanBaseUrl(config.siteBaseUrl),
      publicHost,
      localTestBaseUrl: String(config.localTestBaseUrl || ""),
      siteRoot,
      databasePath,
      configuredPort: Number(config.localPort || PORT),
      runningPort: PORT,
      configPath: CONFIG_PATH,
      isolatedConfig: path.dirname(CONFIG_PATH) === TOOL_ROOT,
    },
    checklist,
    issues,
    ready: issues.length === 0,
    mode: "manual",
  };
}

async function fetchPublicSeoFile(url, label) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "PbootCMS-SEO-Tool/1.0" },
    });
  } catch (error) {
    throw new Error(`${label} 无法访问：${error?.message || String(error)}`);
  }
  if (!response.ok) throw new Error(`${label} 返回 HTTP ${response.status}`);
  const text = await response.text();
  return {
    url: response.url || url,
    status: response.status,
    contentType: String(response.headers.get("content-type") || ""),
    bytes: Buffer.byteLength(text, "utf8"),
    text,
  };
}

async function checkGooglePublicFiles() {
  const config = readConfig();
  if (isSuspiciousPublicUrl(config.siteBaseUrl)) {
    throw new Error("真实线上地址仍是本地或测试域名，不能检查 Google 公开文件。");
  }
  const settings = getGoogleSearchConsoleSettings(config);
  if (!settings.sitemapUrlValid) throw new Error("Sitemap 线上地址格式不正确。");
  const robotsUrl = `${cleanBaseUrl(config.siteBaseUrl)}/${config.outputRobots || "robots.txt"}`;
  const [sitemap, robots] = await Promise.all([
    fetchPublicSeoFile(settings.sitemapUrl, "sitemap.xml"),
    fetchPublicSeoFile(robotsUrl, "robots.txt"),
  ]);
  const sitemapType = /<sitemapindex(\s|>)/i.test(sitemap.text) ? "sitemapindex" : "urlset";
  const urlCount = (sitemap.text.match(/<url(?:\s|>)/gi) || []).length;
  const sitemapCount = (sitemap.text.match(/<sitemap(?:\s|>)/gi) || []).length;
  const sitemapValid = /<(urlset|sitemapindex)(\s|>)/i.test(sitemap.text)
    && (sitemapType === "sitemapindex" ? sitemapCount > 0 : urlCount > 0);
  if (!sitemapValid) throw new Error("线上 sitemap 可以访问，但没有有效 URL，或不是有效的 urlset / sitemapindex XML。");
  const robotsReferencesSitemap = robots.text.toLowerCase().includes(settings.sitemapUrl.toLowerCase());
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    sitemap: {
      ...sitemap,
      text: undefined,
      valid: sitemapValid,
      type: sitemapType,
      urlCount,
      sitemapCount,
    },
    robots: { ...robots, text: undefined, referencesSitemap: robotsReferencesSitemap },
    message: robotsReferencesSitemap
      ? `线上 sitemap.xml 可访问，共 ${sitemapType === "sitemapindex" ? sitemapCount : urlCount} 条记录；robots.txt 已声明当前 sitemap。`
      : `线上 sitemap.xml 可访问，共 ${sitemapType === "sitemapindex" ? sitemapCount : urlCount} 条记录；但 robots.txt 尚未声明当前 sitemap。`,
  };
}

// ===== Google Indexing API（服务账号 JWT，零额外依赖） =====

function base64UrlFromBuffer(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlFromString(value) {
  return base64UrlFromBuffer(Buffer.from(value, "utf8"));
}

function getGoogleIndexingConfig(config = readConfig()) {
  const raw = config.googleIndexing || {};
  let serviceAccount = raw.serviceAccount || null;
  if (!serviceAccount && raw.clientEmail && raw.privateKey) {
    serviceAccount = { client_email: raw.clientEmail, private_key: raw.privateKey };
  }
  const enabled = Boolean(serviceAccount && serviceAccount.client_email && serviceAccount.private_key);
  return {
    enabled,
    serviceAccount,
    clientEmail: serviceAccount ? serviceAccount.client_email : "",
    property: defaultGoogleProperty(config),
  };
}

function parseServiceAccount(input) {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input.trim());
    } catch (_error) {
      throw new Error("服务账号不是有效 JSON。请粘贴从 Google Cloud 下载的完整 JSON。");
    }
  }
  if (!data || !data.client_email || !data.private_key) {
    throw new Error("服务账号 JSON 缺少 client_email 或 private_key。");
  }
  return { client_email: String(data.client_email), private_key: String(data.private_key) };
}

const GOOGLE_INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const GOOGLE_SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function buildGoogleServiceAccountJwt(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(payload))}`;
  const privateKey = String(serviceAccount.private_key).replace(/\\n/g, "\n");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${unsigned}.${signature}`;
}

const googleTokenCache = new Map();

async function getGoogleAccessToken(serviceAccount, scope) {
  const cached = googleTokenCache.get(scope);
  if (cached && cached.expire > Date.now() + 60000) {
    return cached.token;
  }
  const assertion = buildGoogleServiceAccountJwt(serviceAccount, scope);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    googleTokenCache.delete(scope);
    throw new Error(
      `Google 取 access_token 失败：${data.error_description || data.error || `HTTP ${response.status}`}`,
    );
  }
  const entry = {
    token: data.access_token,
    expire: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  googleTokenCache.set(scope, entry);
  return data.access_token;
}

async function getGoogleIndexingAccessToken(serviceAccount) {
  return getGoogleAccessToken(serviceAccount, GOOGLE_INDEXING_SCOPE);
}

async function submitGoogleIndexingUrl(serviceAccount, url, type = "URL_UPDATED") {
  const token = await getGoogleIndexingAccessToken(serviceAccount);
  const response = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, type }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_error) {
    /* non-JSON response */
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      url,
      message: (parsed && parsed.error && parsed.error.message) || `HTTP ${response.status}`,
    };
  }
  const metadata = (parsed && parsed.urlNotificationMetadata) || {};
  const latest = metadata.latestUpdate || metadata.latestRemove || {};
  return {
    ok: true,
    status: response.status,
    url,
    type: latest.type || type,
    notifyTime: latest.notifyTime || "",
    message: `已通知 Google ${type === "URL_DELETED" ? "移除" : "抓取更新"}：${url}`,
  };
}

async function getGoogleIndexingMetadata(serviceAccount, url) {
  const token = await getGoogleIndexingAccessToken(serviceAccount);
  const response = await fetch(
    `https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodeURIComponent(url)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_error) {
    /* non-JSON response */
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      url,
      message: (parsed && parsed.error && parsed.error.message) || `HTTP ${response.status}`,
    };
  }
  const metadata = (parsed && parsed.urlNotificationMetadata) || {};
  const update = metadata.latestUpdate;
  const remove = metadata.latestRemove;
  return {
    ok: true,
    status: response.status,
    url,
    notified: Boolean(update || remove),
    latestType: (update && update.type) || (remove && remove.type) || "",
    latestTime: (update && update.notifyTime) || (remove && remove.notifyTime) || "",
    message: update || remove
      ? `Google 已记录最近一次通知：${(update || remove).type} @ ${(update || remove).notifyTime}`
      : "Google 尚未通过本 API 收到该 URL 的通知（不代表未被自然抓取）。",
  };
}


// ===== Google Search Console API（sitemap 提交 + URL 收录状态查询，复用同一份服务账号） =====

function getSearchConsoleConfig(config = readConfig()) {
  const gi = getGoogleIndexingConfig(config);
  const gsc = config.googleSearchConsole || {};
  const baseUrl = cleanBaseUrl(config.siteBaseUrl || "");
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch (_error) {
    /* 无有效 baseUrl 时保持空 */
  }
  const siteUrl = String(gsc.siteUrl || (host ? `sc-domain:${host}` : "")).trim();
  const sitemapUrl = String(
    gsc.sitemapUrl || (baseUrl ? `${baseUrl}/${config.outputSitemap || "sitemap.xml"}` : ""),
  ).trim();
  return {
    enabled: gi.enabled,
    serviceAccount: gi.serviceAccount,
    clientEmail: gi.clientEmail,
    siteUrl,
    sitemapUrl,
    siteBaseUrl: baseUrl,
  };
}

async function submitSearchConsoleSitemap(siteUrl, sitemapUrl) {
  const cfg = getSearchConsoleConfig();
  if (!cfg.enabled) throw new Error("请先配置 Google 服务账号（与 Google Indexing 用的是同一份 JSON）。");
  const token = await getGoogleAccessToken(cfg.serviceAccount, GOOGLE_SEARCH_CONSOLE_SCOPE);
  const url = `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_error) {
    /* non-JSON */
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      siteUrl,
      sitemapUrl,
      message: (parsed && parsed.error && parsed.error.message) || `HTTP ${response.status}`,
    };
  }
  return {
    ok: true,
    status: response.status,
    siteUrl,
    sitemapUrl,
    message: `已把 sitemap 提交给 Google Search Console：${sitemapUrl}`,
  };
}

async function inspectSearchConsoleUrl(inspectionUrl, siteUrl) {
  const cfg = getSearchConsoleConfig();
  if (!cfg.enabled) throw new Error("请先配置 Google 服务账号（与 Google Indexing 用的是同一份 JSON）。");
  const token = await getGoogleAccessToken(cfg.serviceAccount, GOOGLE_SEARCH_CONSOLE_READONLY_SCOPE);
  const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "zh-CN" }),
    signal: AbortSignal.timeout(30000),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      inspectionUrl,
      siteUrl,
      message: (parsed && parsed.error && parsed.error.message) || `HTTP ${response.status}`,
    };
  }
  const result = (parsed && parsed.inspectionResult) || {};
  const idx = result.indexStatusResult || {};
  return {
    ok: true,
    inspectionUrl,
    siteUrl,
    verdict: result.verdict || "",
    coverageState: idx.coverageState || "",
    indexingState: idx.indexingState || "",
    pageFetchState: idx.pageFetchState || "",
    robotsTxtState: idx.robotsTxtState || "",
    googleCanonical: idx.googleCanonical || "",
    lastCrawlTime: idx.lastCrawlTime || "",
    message: `收录状态：${idx.coverageState || result.verdict || "未知"}`,
  };
}

// ===== Google 提交记录与每日配额（本地持久化，避免重复提交） =====

const GOOGLE_SUBMITTED_PATH = path.join(TOOL_ROOT, "google-submitted.json");

function loadGoogleSubmitted() {
  try {
    const data = JSON.parse(fs.readFileSync(GOOGLE_SUBMITTED_PATH, "utf8"));
    return {
      submitted: data && typeof data.submitted === "object" && data.submitted ? data.submitted : {},
      daily: data && typeof data.daily === "object" && data.daily ? data.daily : {},
    };
  } catch (_error) {
    return { submitted: {}, daily: {} };
  }
}

function saveGoogleSubmitted(store) {
  fs.writeFileSync(GOOGLE_SUBMITTED_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function pacificDateKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type) => (parts.find((part) => part.type === type) || {}).value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (_error) {
    return date.toISOString().slice(0, 10);
  }
}

function googleDailyLimit(config = readConfig()) {
  const value = Number(config.googleIndexing?.dailyQuota);
  return Number.isFinite(value) && value > 0 ? value : 200;
}

function googleQuotaInfo(store, config = readConfig()) {
  const today = pacificDateKey();
  const dailyLimit = googleDailyLimit(config);
  const dailyUsed = Number(store.daily[today] || 0);
  return {
    dailyLimit,
    dailyUsed,
    dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
    pacificDate: today,
    resetNote: "配额每天太平洋时间零点重置（约北京时间 15:00）",
  };
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
    if (req.method === "GET" && pathname === "/api/ai/status") {
      const settings = seoAi.getAiSettings(TOOL_ROOT);
      sendJson(res, {
        models: settings.models,
        envPath: settings.envPath,
        job: seoAi.getJob(),
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/config") {
      const body = await readRequestBody(req);
      const result = seoAi.saveAiKey(
        TOOL_ROOT,
        body.model,
        body.apiKey,
      );
      sendJson(res, result);
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/test") {
      const body = await readRequestBody(req);
      const result = await seoAi.testAiConnection(
        TOOL_ROOT,
        String(body.model || "").trim(),
      );
      sendJson(res, result);
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/preview") {
      const body = await readRequestBody(req);
      const config = readConfig();
      const result = await seoAi.getPreview(
        TOOL_ROOT,
        findDatabase(config),
        body,
      );
      sendJson(res, result);
      return;
    }
    if (req.method === "GET" && pathname === "/api/publish/status") {
      const ftp = getFtpToolInfo();
      let ftpRunning = false;
      let upload = null;
      try {
        const response = await requestFtpTool("/api/upload/status", { timeout: 2500 });
        ftpRunning = true;
        upload = response.data;
      } catch (_error) {
        ftpRunning = false;
      }
      sendJson(res, {
        local: {
          siteRoot: resolveSiteRoot(readConfig()),
          databasePath: findDatabase(readConfig()),
          url: readConfig().localTestBaseUrl,
        },
        ftp: { ...ftp, running: ftpRunning, upload },
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/publish/local") {
      sendJson(res, await publishLocalSite());
      return;
    }
    if (req.method === "POST" && pathname === "/api/publish/online") {
      await publishLocalSite();
      const result = await requestFtpTool("/api/upload", {
        method: "POST",
        timeout: 10000,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "seo" }),
      });
      sendJson(res, {
        started: true,
        ftpUrl: result.info.browserUrl,
        state: result.data.state,
        message: "SEO 文件已在本地重新生成，FTP 正在上传 sitemap、robots 和验证文件。",
      }, 202);
      return;
    }
    if (req.method === "GET" && pathname === "/api/publish/online/status") {
      const result = await requestFtpTool("/api/upload/status", { timeout: 4000 });
      sendJson(res, { ftpUrl: result.info.browserUrl, state: result.data });
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/stop") {
      sendJson(res, seoAi.requestStop());
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/apply") {
      const config = readConfig();
      const result = await seoAi.applyPendingUpdates(
        TOOL_ROOT,
        findDatabase(config),
      );
      sendJson(res, result);
      return;
    }
    if (req.method === "POST" && pathname === "/api/ai/start") {
      const body = await readRequestBody(req);
      const config = readConfig();
      const result = seoAi.startJob(
        TOOL_ROOT,
        findDatabase(config),
        body,
      );
      sendJson(res, result, 202);
      return;
    }
    if (req.method === "GET" && pathname === "/api/report") {
      const report = await inspectSite();
      report.publicUrlWarning = isSuspiciousPublicUrl(report.config.siteBaseUrl)
        ? "当前站点网址看起来是本地/测试域名，请先改成真实线上域名再生成 sitemap 或推送 IndexNow。"
        : "";
      sendJson(res, report);
      return;
    }
    if (req.method === "GET" && pathname === "/api/config") {
      const config = readConfig();
      sendJson(res, {
        config,
        navigation: buildNavigation(),
        instance: {
          port: PORT,
          toolRoot: TOOL_ROOT,
          projectRoot: path.resolve(TOOL_ROOT, "..", ".."),
          configPath: CONFIG_PATH,
          configuredPort: Number(config.localPort || 5188),
          siteRoot: resolveSiteRoot(config),
          databasePath: findDatabase(config),
        },
        publicUrlWarning: isSuspiciousPublicUrl(config.siteBaseUrl),
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/config") {
      const body = await readRequestBody(req);
      const current = readConfig();
      const next = {
        ...current,
        siteName: typeof body.siteName === "string" ? body.siteName.trim() || current.siteName : current.siteName,
        siteBaseUrl: typeof body.siteBaseUrl === "string" ? body.siteBaseUrl.trim().replace(/\/+$/, "") : current.siteBaseUrl,
        localTestBaseUrl:
          typeof body.localTestBaseUrl === "string"
            ? body.localTestBaseUrl.trim().replace(/\/+$/, "")
            : current.localTestBaseUrl,
        useLanguageSubdomains:
          typeof body.useLanguageSubdomains === "boolean"
            ? body.useLanguageSubdomains
            : current.useLanguageSubdomains,
        trailingSlash: typeof body.trailingSlash === "boolean" ? body.trailingSlash : current.trailingSlash,
        googleSearchConsole: {
          ...(current.googleSearchConsole || {}),
          ...(typeof body.gscSiteUrl === "string" && body.gscSiteUrl.trim()
            ? { siteUrl: body.gscSiteUrl.trim() }
            : {}),
          ...(typeof body.gscSitemapUrl === "string" && body.gscSitemapUrl.trim()
            ? { sitemapUrl: body.gscSitemapUrl.trim() }
            : {}),
        },
      };
      if (!/^https?:\/\//i.test(next.siteBaseUrl)) {
        throw new Error("真实线上域名必须以 http:// 或 https:// 开头。");
      }
      if (!/^https?:\/\//i.test(next.localTestBaseUrl)) {
        throw new Error("本地测试地址必须以 http:// 或 https:// 开头。");
      }
      writeJson(CONFIG_PATH, next);
      sendJson(res, { config: next, publicUrlWarning: isSuspiciousPublicUrl(next.siteBaseUrl) });
      return;
    }
    if (req.method === "POST" && pathname === "/api/generate") {
      const result = await generateFiles();
      sendJson(res, result);
      return;
    }
    if (req.method === "POST" && pathname === "/api/indexnow-key") {
      const report = await inspectSite();
      const hosts = report.urls.map((item) => new URL(item.url).host);
      const result = ensureIndexNowKeys(report.config, report.siteRoot, hosts);
      sendJson(res, {
        key: result.config.indexNow.key,
        keyFiles: result.keyFiles,
        message: `已为 ${result.keyFiles.length} 个域名生成独立 IndexNow Key 文件。请先通过 FTP 上传这些根目录 .txt 文件，再执行推送。`,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/indexnow-push") {
      const config = readConfig();
      if (isSuspiciousPublicUrl(config.siteBaseUrl)) {
        throw new Error("当前站点网址看起来不是线上真实域名，已阻止 IndexNow 推送。请先修改真实线上域名。");
      }
      const body = await readRequestBody(req);
      const result = await pushIndexNow(body);
      sendJson(res, result);
      return;
    }
    if (req.method === "GET" && pathname === "/api/google/status") {
      sendJson(res, getGoogleSearchConsoleSettings());
      return;
    }
    if (req.method === "POST" && pathname === "/api/google/check-public") {
      sendJson(res, await checkGooglePublicFiles());
      return;
    }
    if (req.method === "GET" && pathname === "/api/google-indexing/status") {
      const cfg = getGoogleIndexingConfig();
      sendJson(res, {
        enabled: cfg.enabled,
        clientEmail: cfg.clientEmail,
        property: cfg.property,
        helpUrl: "https://developers.google.com/search/apis/indexing-api/v3/using-api",
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/google-indexing/config") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.googleIndexing = { serviceAccount: null, clientEmail: "" };
        cachedGoogleToken = null;
        writeJson(CONFIG_PATH, config);
        sendJson(res, { enabled: false, message: "已清除 Google 服务账号配置。" });
        return;
      }
      const serviceAccount = parseServiceAccount(body.serviceAccount);
      config.googleIndexing = { serviceAccount, clientEmail: serviceAccount.client_email };
      cachedGoogleToken = null;
      writeJson(CONFIG_PATH, config);
      sendJson(res, {
        enabled: true,
        clientEmail: serviceAccount.client_email,
        message: "Google 服务账号已保存。",
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/google-indexing/submit") {
      const cfg = getGoogleIndexingConfig();
      if (!cfg.enabled) throw new Error("请先在上方配置 Google 服务账号。");
      const body = await readRequestBody(req);
      const urls = Array.isArray(body.urls)
        ? body.urls.map((value) => String(value || "").trim()).filter(Boolean)
        : body.url
          ? [String(body.url).trim()]
          : [];
      if (!urls.length) throw new Error("没有可提交的 URL。");
      if (urls.length > 100) throw new Error("单次最多提交 100 个 URL，请分批提交。");
      const force = Boolean(body.force);
      const store = loadGoogleSubmitted();
      const quota = googleQuotaInfo(store, readConfig());
      const results = [];
      for (const item of urls) {
        if (!force && store.submitted[item]) {
          results.push({ ok: true, skipped: true, url: item, message: "此前已提交过，已自动跳过（如需重新提交请点该行“重新提交”）。" });
          continue;
        }
        if (!isPublicHttpUrl(item)) {
          results.push({ ok: false, skipped: false, url: item, message: "不是有效的公开 http(s) URL（不能用本地/测试地址）。" });
          continue;
        }
        if (quota.dailyRemaining <= 0) {
          results.push({ ok: false, skipped: true, url: item, message: "Google 今日配额已用完，请明天再提交。" });
          continue;
        }
        const result = await submitGoogleIndexingUrl(cfg.serviceAccount, item, "URL_UPDATED");
        if (result.ok) {
          store.submitted[item] = {
            url: item,
            submittedAt: new Date().toISOString(),
            type: result.type || "URL_UPDATED",
            notifyTime: result.notifyTime || "",
          };
          store.daily[quota.pacificDate] = Number(store.daily[quota.pacificDate] || 0) + 1;
          quota.dailyUsed += 1;
          quota.dailyRemaining = Math.max(0, quota.dailyRemaining - 1);
        }
        results.push({ ...result, skipped: false });
        await wait(200);
      }
      saveGoogleSubmitted(store);
      const succeeded = results.filter((item) => item.ok && !item.skipped).length;
      const skipped = results.filter((item) => item.skipped).length;
      const failed = results.filter((item) => !item.ok && !item.skipped).length;
      sendJson(res, {
        total: results.length,
        succeeded,
        failed,
        skipped,
        results,
        quota,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/google-indexing/metadata") {
      const cfg = getGoogleIndexingConfig();
      if (!cfg.enabled) throw new Error("请先在上方配置 Google 服务账号。");
      const body = await readRequestBody(req);
      const target = String(body.url || "").trim();
      if (!target) throw new Error("缺少 url。");
      if (!isPublicHttpUrl(target)) throw new Error("url 不是有效的公开 http(s) URL。");
      sendJson(res, await getGoogleIndexingMetadata(cfg.serviceAccount, target));
      return;
    }
    if (req.method === "GET" && pathname === "/api/google-indexing/submitted") {
      const store = loadGoogleSubmitted();
      const quota = googleQuotaInfo(store, readConfig());
      sendJson(res, {
        submitted: store.submitted,
        count: Object.keys(store.submitted).length,
        quota,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/google-indexing/submitted/clear") {
      const body = await readRequestBody(req);
      if (!body.clear) {
        sendJson(res, { ok: false, message: "缺少 clear 参数。" }, 400);
        return;
      }
      saveGoogleSubmitted({ submitted: {}, daily: {} });
      sendJson(res, { ok: true, message: "已清空 Google 提交记录与配额计数。" });
      return;
    }
    if (req.method === "POST" && pathname === "/api/google-indexing/test") {
      const cfg = getGoogleIndexingConfig();
      if (!cfg.enabled) {
        sendJson(res, { ok: false, message: "请先配置 Google 服务账号。" });
        return;
      }
      try {
        await getGoogleIndexingAccessToken(cfg.serviceAccount);
        sendJson(res, {
          ok: true,
          clientEmail: cfg.clientEmail,
          message: `服务账号验证成功：已用 ${cfg.clientEmail} 取得 Google 访问令牌，可以提交了。`,
        });
      } catch (error) {
        sendJson(res, {
          ok: false,
          clientEmail: cfg.clientEmail,
          message: `验证失败：${error.message || String(error)}。请确认 JSON 正确、已在 Search Console 添加该邮箱为所有者/用户、且已在 Google Cloud 启用 Indexing API。`,
        });
      }
      return;
    }
    if (req.method === "GET" && pathname === "/api/search-console/status") {
      const cfg = getSearchConsoleConfig();
      sendJson(res, {
        enabled: cfg.enabled,
        clientEmail: cfg.clientEmail,
        siteUrl: cfg.siteUrl,
        sitemapUrl: cfg.sitemapUrl,
        note: "siteUrl 为 Search Console 属性：域名属性填 sc-domain:example.com，网址前缀属性填 https://example.com/。URL 收录查询只支持网址前缀属性。",
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/search-console/sitemap") {
      const cfg = getSearchConsoleConfig();
      const body = await readRequestBody(req);
      const siteUrl = String(body.siteUrl || cfg.siteUrl).trim();
      const sitemapUrl = String(body.sitemapUrl || cfg.sitemapUrl).trim();
      if (!siteUrl) throw new Error("缺少 siteUrl（Search Console 属性）。");
      if (!sitemapUrl) throw new Error("缺少 sitemapUrl。");
      sendJson(res, await submitSearchConsoleSitemap(siteUrl, sitemapUrl));
      return;
    }
    if (req.method === "POST" && pathname === "/api/search-console/inspect") {
      const cfg = getSearchConsoleConfig();
      const body = await readRequestBody(req);
      const inspectionUrl = String(body.inspectionUrl || "").trim();
      const siteUrl = String(body.siteUrl || cfg.siteUrl).trim();
      if (!inspectionUrl) throw new Error("缺少 inspectionUrl（要查询的完整 URL）。");
      if (!siteUrl) throw new Error("缺少 siteUrl（Search Console 属性，URL 收录查询需网址前缀属性，如 https://example.com/）。");
      sendJson(res, await inspectSearchConsoleUrl(inspectionUrl, siteUrl));
      return;
    }
    if (req.method === "GET" && pathname === "/api/yandex/status") {
      sendJson(res, getYandexSettings());
      return;
    }
    if (req.method === "POST" && pathname === "/api/yandex/verification") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.yandexWebmaster = { verification: null };
        writeJson(CONFIG_PATH, config);
        sendJson(res, { ok: true, message: "已清除 Yandex 验证文件配置（网站根目录里已保存的文件不会自动删除）。" });
        return;
      }
      const filename = String(body.filename || "").trim();
      const content = String(body.content || "").trim();
      if (!/^yandex_[0-9a-zA-Z._-]+\.html$/i.test(filename)) {
        throw new Error("文件名应为 Yandex 提供的 yandex_xxxxxxxx.html 形式。");
      }
      if (/\.\.[\\/]/.test(filename)) {
        throw new Error("文件名不合法。");
      }
      if (!content) {
        throw new Error("请粘贴 Yandex 验证文件的完整内容。");
      }
      const siteRoot = resolveSiteRoot(config);
      const target = path.join(siteRoot, filename);
      fs.writeFileSync(target, `${content}\n`, "utf8");
      config.yandexWebmaster = { verification: { filename, savedAt: new Date().toISOString() } };
      writeJson(CONFIG_PATH, config);
      sendJson(res, {
        ok: true,
        filename,
        filePath: target,
        message: `已把 ${filename} 写入网站根目录。请点击「上传 SEO 文件到 FTP」把它传到线上，然后回到 Yandex Webmaster 点「检查」完成验证。`,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/yandex/check") {
      sendJson(res, await checkYandexPublicState());
      return;
    }
    if (req.method === "POST" && pathname === "/api/yandex/token") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.yandexWebmaster = { ...(config.yandexWebmaster || {}), oauthToken: "" };
        writeJson(CONFIG_PATH, config);
        sendJson(res, { ok: true, message: "已清除 Yandex OAuth token。" });
        return;
      }
      const token = String(body.token || "").trim();
      if (!token) throw new Error("请粘贴 Yandex OAuth token。");
      config.yandexWebmaster = { ...(config.yandexWebmaster || {}), oauthToken: token };
      writeJson(CONFIG_PATH, config);
      sendJson(res, { ok: true, message: "已保存 Yandex OAuth token。" });
      return;
    }
    if (req.method === "POST" && pathname === "/api/yandex/hosts") {
      const result = await resolveYandexHost();
      sendJson(res, {
        ok: true,
        userId: result.userId,
        hostId: result.hostId,
        host: result.host,
        message: `已解析 Yandex 站点：${result.host}（host_id=${result.hostId}）。`,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/yandex/sitemap") {
      const body = await readRequestBody(req);
      const cfg = getYandexWebmasterConfig();
      const sitemapUrl = String(body.sitemapUrl || cfg.sitemapUrl).trim();
      if (!sitemapUrl) throw new Error("缺少 sitemapUrl。");
      sendJson(res, await submitYandexSitemap(sitemapUrl));
      return;
    }
    if (req.method === "GET" && pathname === "/api/bing/status") {
      sendJson(res, getBingSettings());
      return;
    }
    if (req.method === "POST" && pathname === "/api/bing/verification") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.bingWebmaster = { ...(config.bingWebmaster || {}), verification: null };
        writeJson(CONFIG_PATH, config);
        sendJson(res, { ok: true, message: "已清除 Bing 验证码配置（网站根目录里的 BingSiteAuth.xml 不会自动删除）。" });
        return;
      }
      const code = String(body.code || "").trim();
      if (!/^[0-9a-zA-Z._-]{8,}$/.test(code)) {
        throw new Error("Bing 验证码格式不对，应是 Bing Webmaster 给出的 8 位以上字母数字串。");
      }
      const filename = "BingSiteAuth.xml";
      const siteRoot = resolveSiteRoot(config);
      const target = path.join(siteRoot, filename);
      fs.writeFileSync(target, buildBingSiteAuthXml(code), "utf8");
      config.bingWebmaster = { ...(config.bingWebmaster || {}), verification: { code, savedAt: new Date().toISOString() } };
      writeJson(CONFIG_PATH, config);
      sendJson(res, {
        ok: true,
        filename,
        filePath: target,
        message: `已把 ${filename} 写入网站根目录。请点击「上传 SEO 文件到 FTP」把它传到线上，然后回到 Bing Webmaster 点「验证」。`,
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/bing/check") {
      sendJson(res, await checkBingPublicState());
      return;
    }
    if (req.method === "POST" && pathname === "/api/bing/apikey") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.bingWebmaster = { ...(config.bingWebmaster || {}), apiKey: "" };
        writeJson(CONFIG_PATH, config);
        sendJson(res, { ok: true, message: "已清除 Bing Webmaster API Key。" });
        return;
      }
      const apiKey = String(body.apiKey || "").trim();
      if (!apiKey) throw new Error("请粘贴 Bing Webmaster API Key。");
      config.bingWebmaster = { ...(config.bingWebmaster || {}), apiKey };
      writeJson(CONFIG_PATH, config);
      sendJson(res, { ok: true, message: "已保存 Bing Webmaster API Key。" });
      return;
    }
    if (req.method === "POST" && pathname === "/api/bing/sitemap") {
      const body = await readRequestBody(req);
      const cfg = getBingSettings();
      const siteUrl = String(body.siteUrl || cfg.siteUrl).trim();
      const sitemapUrl = String(body.sitemapUrl || cfg.sitemapUrl).trim();
      if (!siteUrl) throw new Error("缺少 siteUrl。");
      if (!sitemapUrl) throw new Error("缺少 sitemapUrl。");
      sendJson(res, await submitBingSitemap(siteUrl, sitemapUrl, body.apiKey));
      return;
    }
    if (req.method === "POST" && pathname === "/api/bing/inspect") {
      const body = await readRequestBody(req);
      const cfg = getBingSettings();
      const targetUrl = String(body.inspectionUrl || "").trim();
      const siteUrl = String(body.siteUrl || cfg.siteUrl).trim();
      if (!targetUrl) throw new Error("缺少 inspectionUrl（要查询的 URL）。");
      if (!siteUrl) throw new Error("缺少 siteUrl。");
      sendJson(res, await inspectBingUrl(siteUrl, targetUrl, body.apiKey));
      return;
    }
    if (req.method === "GET" && pathname === "/api/baidu/status") {
      sendJson(res, getBaiduSettings());
      return;
    }
    if (req.method === "POST" && pathname === "/api/baidu/config") {
      const body = await readRequestBody(req);
      const config = readConfig();
      if (body.clear) {
        config.baidu = { enabled: true, token: "", site: "" };
        writeJson(CONFIG_PATH, config);
        sendJson(res, { ok: true, message: "已清除百度推送配置。" });
        return;
      }
      const token = String(body.token || "").trim();
      if (!token) throw new Error("请粘贴百度推送 token。");
      config.baidu = {
        enabled: body.enabled !== false,
        token,
        site: String(body.site || "").trim(),
      };
      writeJson(CONFIG_PATH, config);
      sendJson(res, { ok: true, message: "已保存百度推送配置。" });
      return;
    }
    if (req.method === "POST" && pathname === "/api/baidu/push") {
      const body = await readRequestBody(req);
      const urls = Array.isArray(body.urls)
        ? body.urls.map((value) => String(value || "").trim()).filter(Boolean)
        : body.url
          ? [String(body.url).trim()]
          : [];
      if (!urls.length) throw new Error("没有可提交的 URL。");
      if (urls.length > 2000) throw new Error("百度单次最多提交 2000 个 URL，请分批提交。");
      const result = await submitBaiduUrls(urls, { site: body.site });
      result.urlCount = urls.length;
      sendJson(res, result);
      return;
    }
    if (req.method === "GET" && pathname === "/api/chinese-engines") {
      sendJson(res, getChineseEnginesInfo());
      return;
    }
    if (req.method === "GET" && pathname === "/api/indexing-overview") {
      sendJson(res, await getIndexingOverview());
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

server.listen(PORT, () => {
  const config = readConfig();
  console.log(`SEO publish tool is running: http://localhost:${PORT}`);
  console.log(`Project root: ${path.resolve(TOOL_ROOT, "..", "..")}`);
  console.log(`Site root   : ${resolveSiteRoot(config)}`);
  console.log(`Database    : ${findDatabase(config)}`);
  console.log(`Public site : ${config.siteBaseUrl}`);
});
