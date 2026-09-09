// Read-only validation: each image must qualify for a direct reference before resolving it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { existingSiteAssetUrl, createFolderAssetResolver } = require('../backend/dist/common/folder-import-assets');
const { scanProductFolders } = require('../backend/dist/product/product-folder-import');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [siteRoot, directory, siteId, publicBase] = process.argv.slice(2);
if (!siteRoot || !directory || !siteId || !publicBase) throw new Error('Usage: node verify-folder-asset-references.cjs siteRoot directory siteId publicBase');

(async () => {
  const candidates = scanProductFolders(directory);
  assert.ok(candidates.length > 0);
  const urls = [];
  for (const item of candidates) {
    const resolve = createFolderAssetResolver(siteRoot, item.directory, 'static/codex/folder-import/reference-validation');
    const images = [...new Set([item.thumbnailImageFile, item.largeImageFile, ...item.carouselImageFiles, ...item.detailImageFiles].filter(Boolean))];
    for (const filename of images) {
      const source = path.join(item.directory, filename);
      const expected = existingSiteAssetUrl(siteRoot, source);
      assert.ok(expected, `Not a current-site static asset: ${source}`);
      const before = fs.statSync(source);
      const actual = resolve(filename);
      assert.equal(actual, expected);
      assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
      urls.push(actual);
    }
  }
  assert.ok(urls.length > 0);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto('http://localhost:5278/#/login');
    const result = await page.evaluate(async ({ urls, siteId }) => {
      localStorage.setItem('pbootActiveSiteId', siteId);
      const { getUploadUrl, normalizeHtmlImageUrls } = await import('/src/api/uploads.ts');
      return {
        proxies: urls.map(getUploadUrl),
        rawProxy: getUploadUrl(decodeURIComponent(urls[0])),
        reserved: getUploadUrl('/static/Drilling%20Rigs/%E5%B2%A9%E8%8A%AF%20%23100%25/01.JPG'),
        preview: normalizeHtmlImageUrls(`<p><img src="${urls[0]}" alt="Reference"></p>`),
      };
    }, { urls, siteId });
    assert.equal(result.rawProxy, result.proxies[0]);
    assert.equal(new URL(result.reserved).searchParams.get('path'), 'Drilling Rigs/岩芯 #100%/01.JPG');
    assert.ok(!result.preview.includes('%2520'));
    for (let index = 0; index < urls.length; index++) {
      const proxy = new URL(result.proxies[index]);
      assert.equal(proxy.searchParams.get('siteId'), siteId);
      assert.equal(proxy.searchParams.get('path'), decodeURIComponent(urls[index]).slice('/static/'.length));
      for (const target of [result.proxies[index], new URL(urls[index], publicBase).href]) {
        const response = await fetch(target, { method: 'HEAD' });
        assert.equal(response.status, 200, target);
        assert.match(response.headers.get('content-type'), /^image\//, target);
      }
    }
    await page.setContent('<main></main>');
    const dimensions = await page.evaluate(async proxies => {
      const output = [];
      for (const src of proxies) {
        const image = new Image();
        image.src = src;
        image.style.maxWidth = '250px';
        document.querySelector('main').append(image);
        await image.decode();
        output.push([image.naturalWidth, image.naturalHeight]);
      }
      return output;
    }, result.proxies);
    assert.ok(dimensions.every(([width, height]) => width > 0 && height > 0));
    console.log(JSON.stringify({ passed: true, models: candidates.map(item => item.modelName), images: urls.length, example: urls[0], checks: ['no image copies or source changes', 'preview paths', 'current-site image endpoint', 'PB original static URLs', 'browser image decoding'] }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
