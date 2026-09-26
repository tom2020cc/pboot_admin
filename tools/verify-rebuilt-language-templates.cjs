const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const root = 'E:/phpstudy_pro/WWW/shanbo-rig.c';
const langs = ['en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'vi', 'tr'];
const db = new DatabaseSync(path.join(root, 'data/1412def6361bfd54fd4f519f81ba2d22.db'), { readOnly: true });
const sorts = db.prepare('select acode,scode,filename,mcode from ay_content_sort').all();
const products = db.prepare('select acode,scode,title,filename from ay_content where status=1').all();
db.close();
const files = dir => fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.html')).sort();
const cnFiles = files(path.join(root, 'template/cn/html'));
const failures = [];
let pages = 0, scripts = 0, cards = 0;
async function verifyPage(lang, route, kind, cookie = lang) {
  const response = await fetch('http://shanbo-rig.c' + route, { headers: cookie ? { Cookie: 'lg=' + cookie } : {}, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert(html.includes('<html lang="' + lang + '"'), 'Wrong language: ' + route);
  assert(!/\{(?:include file|pboot:|content:)|Fatal error|Parse error/.test(html), 'Unparsed page: ' + route);
  if (lang === 'ar') assert(html.includes('dir="ltr"'));
  const cats = [...html.matchAll(/class="cat-item" data-index="(\d+)" href="([^"]+)"/g)];
  assert.equal(cats.length, 7, 'Menu categories: ' + route);
  assert(cats[1][2].toLowerCase().includes(lang + '-reverse-circulation'), 'RC menu position: ' + route);
  for (const c of cats) assert(c[2].startsWith('/' + lang + '-'), 'Cross-language link: ' + c[2]);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!m[2].trim() || /src\s*=|ld\+json/i.test(m[1])) continue;
    new vm.Script(m[2]); scripts++;
  }
  for (const block of html.matchAll(/<dl class="home-product-specs">([\s\S]*?)<\/dl>/g)) {
    const entries = [...block[1].matchAll(/<div\b[^>]*>[\s\S]*?<\/div>/g)].slice(0, 3);
    assert.equal(entries.length, 3, 'Three list properties: ' + route);
    assert(entries.every(e => /<dd>[^<]+<\/dd>/.test(e[0])), 'Empty property: ' + route);
    cards++;
  }
  if (kind === 'detail') {
    const block = html.match(/<div class="cpcan"><ul>([\s\S]*?)<\/ul>/)?.[1];
    assert(block && block.includes('data-spec="ext_drill_depth"'), 'Detail parameters: ' + route);
    assert(!block.includes('data-spec-placeholder'));
  }
  if (kind === 'home' || kind === 'detail') {
    const code = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m => m[1].includes('function submitmsg'))?.[1];
    assert(code && code.includes('submitBtn.disabled=true;'), 'Form handler: ' + route);
    const timers = [], button = {innerHTML: 'Submit', disabled: false, classList: {add() {}, remove() {}}};
    let request, reset = false, message;
    const context = { FormData: class {get() {return 'test';}}, window: {location: {href: route}}, setTimeout(fn) {timers.push(fn);}, $: {ajax(options) {request = options;}} };
    vm.createContext(context); vm.runInContext(code, context);
    context.showMessage = type => {message = type;};
    assert.equal(context.submitmsg({querySelector: () => button, reset() {reset = true;}}), false);
    assert(button.disabled); request.success({code: 1}); assert(reset); assert.equal(message, 'success');
    timers.forEach(fn => fn()); assert(!button.disabled);
  }
  pages++;
}
(async () => {
  for (const lang of langs) {
    const base = path.join(root, 'template', lang, 'html');
    assert.deepEqual(files(base), cnFiles, lang + ' template inventory');
    for (const file of cnFiles) {
      const text = fs.readFileSync(path.join(base, file), 'utf8');
      assert(!/[\u3400-\u9fff]/.test(text), lang + '/' + file + ' untranslated template');
      for (const m of text.matchAll(/\b(?:scode|parent)=(\d+)/g)) {
        if (m[1] !== '0') assert(sorts.some(s => s.acode === lang && s.scode === m[1]), 'Wrong language category: ' + lang + ':' + m[1]);
      }
      for (const m of text.matchAll(/\{include file=([^}]+)\}/g)) assert(fs.existsSync(m[1].startsWith('/') ? path.join(root, m[1]) : path.join(base, m[1])), 'Missing include: ' + m[1]);
    }
    const ownSorts = sorts.filter(s => s.acode === lang);
    const routes = [['/', 'home']];
    for (const suffix of ['Drilling-Rigs', 'Water-well-drilling-rig', 'reverse-circulation-drilling-rig', 'article', 'videos', 'aboutus', 'ContactUs']) {
      const category = ownSorts.find(s => s.filename.toLowerCase() === (lang + '-' + suffix).toLowerCase());
      assert(category, lang + ' category ' + suffix); routes.push(['/' + category.filename + '/', 'category']);
    }
    for (const title of ['DTH30C', 'WR500RC-CS3', 'WR1500S']) {
      const p = products.find(p => p.acode === lang && p.title === title);
      assert(p, lang + ' product ' + title);
      routes.push(['/' + ownSorts.find(s => s.scode === p.scode).filename + '/' + p.filename + '.html', 'detail']);
    }
    const news = products.find(p => p.acode === lang && ownSorts.some(s => s.scode === p.scode && s.mcode === '2'));
    if (news) routes.push(['/' + ownSorts.find(s => s.scode === news.scode).filename + '/' + news.filename + '.html', 'news']);
    for (const [route, kind] of routes) {
      try { await verifyPage(lang, route, kind); }
      catch (e) { failures.push({lang, route, error: e.message}); }
    }
    for (const [route, kind] of [routes[1], routes.find(r => r[1] === 'detail'), routes.find(r => r[0].includes('aboutus'))]) {
      try { await verifyPage(lang, route, kind, lang === 'en' ? '' : 'cn'); }
      catch (e) { failures.push({lang, route, error: 'First language switch: ' + e.message}); }
    }
    console.log(lang + ': checked ' + routes.length + ' pages');
  }
  console.log(JSON.stringify({pages, scripts, cards, failures}, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(e => {console.error(e); process.exitCode = 1;});
