// Isolated UI fixtures: no credentials or production requests.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('../backend/node_modules/playwright');
const root = path.join(__dirname, 'ftp_publish_tool/public');
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.end(''); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage(); const errors=[]; let environment='local', started=false, polls=0;
    page.on('pageerror', e=>errors.push(e.message));
    const row={language:'ar',domain:'ar.example.com',checks:Object.fromEntries(['dns','binding','tls','license','template','home'].map(k=>[k,{status:'pass',detail:'正常'}]))};
    row.checks.license={status:'fail',detail:'PB 授权失败',advice:'<img src=x onerror=alert(1)>补正确授权码'};
    row.checks.home={status:'unknown',detail:'尚未确认'};
    await page.route('**/deployment-environment', r=>r.fulfill({json:{environment}}));
    await page.route('**/api/**', async route=>{
      const p=new URL(route.request().url()).pathname; let data={};
      if(p==='/api/sync/config')data={currentSite:{id:1,name:'测试站点'}};
      if(p==='/api/domain-check/start'){assert.deepEqual(route.request().postDataJSON(),{siteId:1});started=true;data={started:true};}
      if(p==='/api/domain-check/status'){
        const running=started&&++polls===1;
        data={siteId:1,busy:running,running,result:started&&!running?{rows:[row],checkedAt:'2026-09-22T15:00:00Z'}:null};
      }
      await route.fulfill({json:data});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/domain-check.html`);
    await page.getByRole('button',{name:'检测全部语言'}).click();
    await page.getByRole('button',{name:'检测中…'}).waitFor();
    await page.getByText('PB 授权失败',{exact:false}).waitFor();
    assert.equal(await page.locator('#checkRows img').count(),0);
    assert.match(await page.locator('#summary').innerText(),/全部通过 0 个/);
    assert.equal(await page.getByRole('button',{name:'检测全部语言'}).isEnabled(),true);
    environment='baota';await page.reload();
    await page.getByText('请从本地管理项目发起检测。').waitFor();
    assert.equal(await page.locator('#startCheck').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS progress, independent failures, escaped advice, ready count and online visibility');
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
