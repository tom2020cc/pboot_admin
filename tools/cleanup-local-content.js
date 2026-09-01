const fs = require("fs");
const path = require("path");
const initSqlJs = require(path.resolve(__dirname, "..", "backend", "node_modules", "sql.js"));

const projectRoot = path.resolve(__dirname, "..");
const databasePath = path.join(projectRoot, "backend", "dev.sqlite");
const backupDir = path.join(projectRoot, "backups", "backend_database");

function timestamp() {
  const pad = (value) => String(value).padStart(2, "0");
  const now = new Date();
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function queryRows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function run(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.run(params);
  } finally {
    statement.free();
  }
}

function count(db, table) {
  return Number(queryRows(db, `select count(*) as count from ${table}`)[0]?.count || 0);
}

function buildUrlName(lang, sourceUrlName, fallbackTitle) {
  const prefix = lang === "zh-CN" ? "cn" : String(lang || "cn").toLowerCase();
  const normalized = String(sourceUrlName || fallbackTitle || "content")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^(?:cn|en|es|fr|ru|ar|pt)-/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${prefix}-${normalized || "content"}`;
}

async function main() {
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `dev.before_orphan_news_cleanup_${timestamp()}.sqlite`);
  fs.copyFileSync(databasePath, backupPath);

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(databasePath));
  const before = {
    news: count(db, "news"),
    newsTranslations: count(db, "news_translations"),
    pageTranslations: count(db, "page_translations"),
  };
  const orphanNews = queryRows(
    db,
    "select id from news n where not exists (select 1 from news_translations t where t.newsId=n.id)",
  );

  const pageRows = queryRows(
    db,
    'select id, pageId, lang, title, urlName, keywords from page_translations order by pageId, id',
  );
  const sourceUrls = new Map(
    pageRows.filter((row) => row.lang === "zh-CN").map((row) => [Number(row.pageId), String(row.urlName || "")]),
  );
  let pageSeoUpdated = 0;

  run(db, "begin transaction");
  try {
    for (const row of pageRows) {
      const urlName = String(row.urlName || "").trim() || buildUrlName(row.lang, sourceUrls.get(Number(row.pageId)), row.title);
      const keywords = String(row.keywords || "").trim() || String(row.title || "").trim();
      if (urlName === String(row.urlName || "") && keywords === String(row.keywords || "")) continue;
      run(db, 'update page_translations set urlName=?, keywords=? where id=?', [urlName, keywords, row.id]);
      pageSeoUpdated += 1;
    }
    run(db, "delete from news where not exists (select 1 from news_translations t where t.newsId=news.id)");
    run(db, "commit");
  } catch (error) {
    run(db, "rollback");
    throw error;
  }

  const after = {
    news: count(db, "news"),
    newsTranslations: count(db, "news_translations"),
    pageTranslations: count(db, "page_translations"),
  };
  fs.writeFileSync(databasePath, Buffer.from(db.export()));
  db.close();

  console.log(JSON.stringify({ backupPath, orphanNewsRemoved: orphanNews.length, pageSeoUpdated, before, after }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
