const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MANAGED_SITES_ROOT = path.join(PROJECT_ROOT, "managed-sites");
const storage = new AsyncLocalStorage();

function readManagedSites() {
  if (!fs.existsSync(MANAGED_SITES_ROOT)) return [];
  const sites = [];
  for (const entry of fs.readdirSync(MANAGED_SITES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const configPath = path.join(MANAGED_SITES_ROOT, entry.name, "site.json");
    try {
      const payload = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (!payload.site?.id || payload.site.enabled === false) continue;
      sites.push({
        ...payload.site,
        code: payload.site.code || entry.name,
        directory: path.dirname(configPath),
      });
    } catch (_error) {
      // A partially written site file must not stop the other managed sites.
    }
  }
  return sites.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.id) - Number(b.id));
}

function readCookies(req) {
  return String(req?.headers?.cookie || "").split(";").reduce((result, row) => {
    const index = row.indexOf("=");
    if (index < 0) return result;
    result[row.slice(0, index).trim()] = decodeURIComponent(row.slice(index + 1).trim());
    return result;
  }, {});
}

function resolveRequestSite(req) {
  const sites = readManagedSites();
  if (!sites.length) return null;
  const requestUrl = new URL(req?.url || "/", `http://${req?.headers?.host || "localhost"}`);
  const cookies = readCookies(req);
  const requestedId = Number(
    requestUrl.searchParams.get("siteId")
      || req?.headers?.["x-pboot-site-id"]
      || cookies.pboot_site_id
      || 0,
  );
  const requestedCode = String(requestUrl.searchParams.get("site") || cookies.pboot_site_code || "").trim();
  return sites.find((site) => Number(site.id) === requestedId)
    || sites.find((site) => site.code === requestedCode)
    || sites[0];
}

function runForRequest(req, res, callback) {
  const site = resolveRequestSite(req);
  if (site && res && !res.headersSent) {
    res.setHeader("Set-Cookie", [
      `pboot_site_id=${encodeURIComponent(site.id)}; Path=/; SameSite=Lax`,
      `pboot_site_code=${encodeURIComponent(site.code)}; Path=/; SameSite=Lax`,
    ]);
  }
  return storage.run({ site }, callback);
}

function runForSite(site, callback) {
  return storage.run({ site }, callback);
}

function currentSite() {
  return storage.getStore()?.site || readManagedSites()[0] || null;
}

function siteFile(section, fileName, legacyPath = "") {
  const site = currentSite();
  if (!site) return legacyPath;
  const directory = path.join(site.directory, section);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, fileName);
  if (!fs.existsSync(target) && legacyPath && fs.existsSync(legacyPath)) {
    fs.copyFileSync(legacyPath, target);
  }
  return target;
}

function withSiteQuery(url) {
  const site = currentSite();
  if (!site || !url) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("siteId", String(site.id));
  return parsed.toString();
}

function publicSiteContext() {
  const site = currentSite();
  if (!site) return null;
  return {
    id: Number(site.id),
    code: site.code,
    name: site.name,
    publicBaseUrl: site.publicBaseUrl || "",
    directory: site.directory,
  };
}

module.exports = {
  currentSite,
  publicSiteContext,
  readManagedSites,
  resolveRequestSite,
  runForRequest,
  runForSite,
  siteFile,
  withSiteQuery,
};
