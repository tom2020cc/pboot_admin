const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const siteRuntime = require("../site-runtime");

test("keeps concurrent managed-site contexts isolated", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pboot-site-runtime-"));
  const siteA = { id: 11, code: "site-a", directory: path.join(root, "site-a") };
  const siteB = { id: 22, code: "site-b", directory: path.join(root, "site-b") };

  try {
    const [resultA, resultB] = await Promise.all([
      siteRuntime.runForSite(siteA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        const file = siteRuntime.siteFile("seo", "seo.config.json");
        fs.writeFileSync(file, "A", "utf8");
        return { code: siteRuntime.currentSite().code, file };
      }),
      siteRuntime.runForSite(siteB, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const file = siteRuntime.siteFile("seo", "seo.config.json");
        fs.writeFileSync(file, "B", "utf8");
        return { code: siteRuntime.currentSite().code, file };
      }),
    ]);

    assert.equal(resultA.code, "site-a");
    assert.equal(resultB.code, "site-b");
    assert.notEqual(resultA.file, resultB.file);
    assert.equal(fs.readFileSync(resultA.file, "utf8"), "A");
    assert.equal(fs.readFileSync(resultB.file, "utf8"), "B");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("adds the current site id to cross-tool navigation", () => {
  const site = { id: 37, code: "site-37", directory: os.tmpdir() };
  const url = siteRuntime.runForSite(site, () => siteRuntime.withSiteQuery("http://localhost:5388/google.html#guide"));
  assert.equal(new URL(url).searchParams.get("siteId"), "37");
  assert.equal(new URL(url).hash, "#guide");
});
