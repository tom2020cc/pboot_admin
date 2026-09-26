const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const front = createRequire(path.join(root, 'frontend/package.json'));
const { build } = createRequire(front.resolve('vite/package.json'))('esbuild');
const { chromium } = require('../backend/node_modules/playwright');
const out = path.join(root, '.cache-tutorial-update/pdf-check');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const result = await build({ stdin: { contents: `import * as brochure from './src/utils/brochure'; import * as language from './src/utils/brochure-language'; import * as detail from './src/utils/brochure-detail'; import {paginateForExport} from './src/utils/brochure-pagination'; window.testBrochure={...brochure,...language,...detail,paginateForExport};`, resolveDir: path.join(root, 'frontend') }, bundle: true, write: false, format: 'iife', plugins: [{ name: 'test-fixtures', setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: `export default ${JSON.stringify(fs.readFileSync(args.path, 'utf8'))}`, loader: 'js' }));
    b.onResolve({ filter: /^@\/api\/uploads$/ }, () => ({ path: 'uploads', namespace: 'fixture' }));
    b.onResolve({ filter: /^@\/api\/news$/ }, () => ({ path: 'news', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'news' ? `export const NEWS_LANGUAGES=${JSON.stringify(['zh-CN','en','es','fr','ru','ar','pt','id','tr','vi'].map(code => ({code,name:code})))}` : `export const getUploadUrl=value=>'/api/'+(value.startsWith('/')?value.slice(1):value)`, loader: 'js' }));
  } }] });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROCHURE_CHECK_CHROMIUM ? { executablePath: process.env.BROCHURE_CHECK_CHROMIUM } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.route('https://admin.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
    await page.goto('https://admin.example.test/');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const checks = await page.evaluate(() => {
      const b = window.testBrochure;
      const content = '<h2>Details</h2><p>Original <b>body</b></p><table><tr><td>1000 m</td></tr></table><img src="/static/01.jpg" onerror="alert(1)"><script>alert(1)</script><iframe src="https://example.com"></iframe><style>body{display:none}</style>';
      const master = { id: 5, title: '中文产品', subtitle: '', summary: '中文简介', content, description: '', thumbnail: '', largeImage: '', carouselImages: [], carouselTitles: ['中文说明'], translations: [{ lang: 'en', title: 'CR1000I', content: '<p>English only</p>' }] };
      const item = b.productToBrochure(master);
      if (item.detailsHtml !== content || item.specs.length) throw Error('Full field import must not extract specs');
      const pictures = {...master, largeImage:'/static/main.jpg', thumbnail:'/static/0.jpg', carouselImages:['/static/1.jpg','/static/2.jpg'], carouselTitles:['First','Second']};
      const imported = b.productToBrochure(pictures);
      if (imported.images.map(i=>i.src).join(',') !== '/static/main.jpg,/static/1.jpg,/static/2.jpg' || imported.images[1].caption !== 'First') throw Error('Default thumbnail exclusion or gallery order');
      if (b.productToBrochure({...pictures,largeImage:''}).images[0].src !== '/static/1.jpg') throw Error('Carousel main fallback');
      if (b.productToBrochure({...pictures,largeImage:'',carouselImages:[]}).images.length) throw Error('Thumbnail-only product should not add a photo');
      if (b.productToBrochure({...pictures,thumbnail:'/static/1.jpg'}).images.length !== 3) throw Error('Explicit carousel photo must be retained');
      const missing = b.exactBrochureProduct(master, 'vi');
      if (missing.title || missing.content || missing.carouselTitles.length) throw Error('Silent Chinese fallback');
      const translated = b.productToBrochure(b.exactBrochureProduct(master, 'en'));
      if (translated.detailsHtml !== '<p>English only</p>') throw Error('Wrong translation');
      const clean = b.cleanBrochureDetail(content);
      if (/<script|<iframe|<style|onerror/i.test(clean) || !clean.includes('<table>')) throw Error('HTML sanitizer');
      const d = b.newBrochure('ar'); d.items.push(item);
      const preview = b.previewBrochure(d, '');
      if (!preview.items[0].detailsHtml.includes('https://admin.example.test/api/static/01.jpg')) throw Error('Detail image mapping');
      item.images = [{ src: '/static/cover.jpg', caption: '' }];
      const imagePreview = b.brochureHtml(b.previewBrochure(d, ''), false);
      if (!imagePreview.includes('src="https://admin.example.test/api/static/cover.jpg"')) throw Error('Production relative image omitted from preview');
      item.detailsEnabled = false;
      if (b.brochureHtml(d).includes('<section class="product-detail">')) throw Error('Detail exclusion');
      delete item.detailsEnabled; delete item.detailsHtml; delete d.imageSize; delete d.newProductPage;
      if (!b.isBrochureDraft(d)) throw Error('Old document compatibility');
      for (const [key,value] of [['bodyFontSize',8],['bodyFontSize','12'],['tableFontSize',NaN],['headingFontSize',25],['lineHeight',Infinity],['paragraphSpacing',-1],['tableStyle','<script>'],['tableDensity','bad']]) {
        if(b.isBrochureDraft({...d,[key]:value})) throw Error('Invalid typography '+key);
      }
      const table = '<table><tr><th>Parameter</th><th>Value</th></tr><tr><th colspan="2">Power head</th></tr><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td>B</td></tr></table>';
      const rendered = b.renderBrochureDetail(table,false);
      if(!rendered.includes('<thead>') || !rendered.includes('class="table-group"') || !rendered.includes('rowspan="2"')) throw Error('Table semantics');
      if(table.includes('<thead>')) throw Error('Source mutated');
      return { languageCount: b.brochureLanguages.length, fullField: true, noAutoTable: true, strictTranslation: true, sanitized: true, oldDraft: true };
    });
    assert.equal(checks.languageCount, 10);
    const regressionHtml = await page.evaluate(() => {
      const b=window.testBrochure,d=b.newBrochure('en'),p=b.newBrochureProduct();d.companyName='Test';p.title='Preview recovery';
      p.detailsHtml='<p>DETAIL-KEPT</p>';d.items=[p];return b.brochureHtml(d,false);
    });
    const stalled = await browser.newPage();
    // Simulate browsers that never deliver animation or idle callbacks to embedded previews.
    await stalled.setContent(regressionHtml.replace('<script>window.PagedConfig', '<script>window.requestAnimationFrame=function(){return 1};window.cancelAnimationFrame=function(){};window.requestIdleCallback=function(){return 1};window.cancelIdleCallback=function(){};</script><script>window.PagedConfig'));
    await stalled.waitForFunction(()=>document.body.dataset.paginationState==='ready',undefined,{timeout:15000});
    assert.match(await stalled.locator('.pages').innerText(),/DETAIL-KEPT/);await stalled.close();
    for(const broken of ['invalid','pending']){
      const failing=await browser.newPage();
      if(broken==='pending')await failing.route('https://images.example.test/hang.jpg',()=>{});
      const img=broken==='invalid'?'data:image/png;base64,invalid':'https://images.example.test/hang.jpg';
      const html=regressionHtml.replace('<p>DETAIL-KEPT</p>',`<p>DETAIL-KEPT</p><img data-brochure-src="${img}" loading="lazy">`).replace('probe.decode(),15000','probe.decode(),250');
      await failing.setContent(html,{waitUntil:'domcontentloaded'});
      await failing.waitForFunction(()=>document.body.dataset.paginationState==='ready',undefined,{timeout:10000});
      assert.equal(await failing.locator('.pages img').count(),0);
      assert.equal(await failing.locator('body').getAttribute('data-skipped-images'),'1');
      assert.match(await failing.locator('.pages').innerText(),/DETAIL-KEPT/);await failing.close();
    }
    const exportResult=await page.evaluate(async html=>{
      const b=window.testBrochure;
      return b.paginateForExport(html.replace('"token":""','"token":"progress-test"'),'progress-test');
    },regressionHtml);
    assert.ok(exportResult.pages>0);assert.match(exportResult.html,/DETAIL-KEPT/);
    const recoveredExport=await page.evaluate(async html=>{
      const original=document.body.appendChild;
      let attempts=0;
      document.body.appendChild=function(node){
        if(node.tagName==='IFRAME'&&++attempts===1)node.srcdoc='<script>parent.postMessage({type:"brochure-pagination",token:"retry-export",state:"error",phase:"layout"},"*")<\/script>';
        return original.call(this,node);
      };
      try {
        const result=await window.testBrochure.paginateForExport(html.replace('"token":""','"token":"retry-export"'),'retry-export');
        return {pages:result.pages,attempts,frames:document.querySelectorAll('iframe').length};
      }finally{document.body.appendChild=original;}
    },regressionHtml);
    assert.ok(recoveredExport.pages>0);assert.equal(recoveredExport.attempts,2);assert.equal(recoveredExport.frames,0);
    const failedExport=await page.evaluate(async()=>{
      const html='<script>parent.postMessage({type:"brochure-pagination",token:"retry-limit",state:"error",phase:"layout"},"*")<\/script>';
      let attempts=0;const original=document.body.appendChild;
      document.body.appendChild=function(node){if(node.tagName==='IFRAME')attempts++;return original.call(this,node);};
      try{await window.testBrochure.paginateForExport(html,'retry-limit');return {unexpected:true};}
      catch(error){return {attempts,frames:document.querySelectorAll('iframe').length,error:!!error.message};}
      finally{document.body.appendChild=original;}
    });
    assert.equal(failedExport.attempts,2);assert.equal(failedExport.frames,0);assert.equal(failedExport.error,true);
    const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=','base64');
    const recovering=await browser.newPage();let active=0,maxActive=0;const requests=new Map();
    await recovering.route('https://images.example.test/**',async route=>{
      const url=route.request().url(),count=(requests.get(url)||0)+1;requests.set(url,count);
      active++;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,40));active--;
      await route.fulfill(url.endsWith('/1.png')&&count===1?{status:503,body:'Unavailable'}:{contentType:'image/png',body:pixel,headers:{'cache-control':'public, max-age=3600'}});
    });
    const retryImages=Array.from({length:8},(_,i)=>`<img data-brochure-src="https://images.example.test/${i%4}.png">`).join('');
    await recovering.setContent(regressionHtml.replace('<p>DETAIL-KEPT</p>',`<p>DETAIL-KEPT</p>${retryImages}`));
    await recovering.waitForFunction(()=>document.body.dataset.paginationState==='ready',undefined,{timeout:15000});
    assert.ok(requests.get('https://images.example.test/1.png')>=2);assert.ok(maxActive<=3);
    assert.equal(await recovering.locator('.pages img').count(),8);
    assert.equal(await recovering.locator('.pages img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
    await recovering.close();
    const galleries=[];
    for(const count of [0,1,2,3,4,5]){
      const html=await page.evaluate(count=>{
        const b=window.testBrochure,d=b.newBrochure('en'),p=b.newBrochureProduct();d.companyName='SHANBO';p.title='Gallery layout';
        p.images=Array.from({length:count+1},(_,i)=>{
          const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
          const c=canvas.getContext('2d');c.fillStyle=i%2?'#dfede8':'#d7e8ee';c.fillRect(0,0,800,600);c.fillStyle='#304747';c.font='48px sans-serif';c.fillText(i?'PHOTO '+i:'MAIN PHOTO',180,320);
          return {src:canvas.toDataURL(),caption:i?'GALLERY-'+i:'MAIN'};
        });d.items=[p];return b.brochureHtml(d,false);
      },count);
      const gallery=await browser.newPage({viewport:{width:1500,height:1000}});
      await gallery.setContent(html);await gallery.waitForFunction(()=>document.body.dataset.paginationState==='ready');
      const geometry=await gallery.evaluate(()=>({
        figures:document.querySelectorAll('.pages .gallery figure').length,main:document.querySelectorAll('.pages .main-photo').length,
        captions:[...document.querySelectorAll('.pages .gallery figcaption')].map(i=>i.textContent.trim()),
        rows:[...document.querySelectorAll('.pages .gallery-row')].map(row=>{
          const box=row.getBoundingClientRect(),figures=[...row.querySelectorAll('figure')].map(i=>i.getBoundingClientRect());
          return {count:figures.length,aligned:figures.length<2||Math.abs(figures[0].top-figures[1].top)<2,
            width:figures.length===1?Math.abs(figures[0].width-box.width)<2:figures[0].right<figures[1].left,
            overflow:box.bottom>row.closest('.pagedjs_page_content').getBoundingClientRect().bottom+3};
        })
      }));
      assert.equal(geometry.main,1);assert.equal(geometry.figures,count);assert.deepEqual(geometry.captions,Array.from({length:count},(_,i)=>'GALLERY-'+(i+1)));
      assert.equal(geometry.rows.length,Math.ceil(count/2));assert.ok(geometry.rows.every(r=>r.aligned&&r.width&&!r.overflow));
      if(count%2)assert.equal(geometry.rows.at(-1).count,1);
      if(count===3){
        await gallery.screenshot({path:path.join(out,'gallery-desktop.png'),fullPage:true});
        await gallery.pdf({path:path.join(out,'gallery.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
        await gallery.setViewportSize({width:390,height:844});await gallery.screenshot({path:path.join(out,'gallery-mobile.png'),fullPage:true});
      }
      galleries.push({count,...geometry});await gallery.close();
    }
    const summaries = [];
    const coverHtml=await page.evaluate(()=>{
      const b=window.testBrochure,d=b.newBrochure('en'),p=b.newBrochureProduct(),canvas=document.createElement('canvas');
      canvas.width=100;canvas.height=60;canvas.getContext('2d').fillRect(0,0,100,60);p.title='Cover recovery';
      p.images=[{src:'data:image/png;base64,invalid',caption:'BAD-COVER'},...['FIRST-GOOD','SECOND-GOOD','THIRD-GOOD'].map(caption=>({src:canvas.toDataURL(),caption}))];d.items=[p];return b.brochureHtml(d,false);
    });
    const cover=await browser.newPage();await cover.setContent(coverHtml);await cover.waitForFunction(()=>document.body.dataset.paginationState==='ready');
    assert.equal(await cover.locator('.pages .main-photo figcaption').innerText(),'FIRST-GOOD');assert.equal(await cover.locator('.pages .gallery figure').count(),2);assert.doesNotMatch(await cover.locator('.pages').innerText(),/BAD-COVER/);await cover.close();
    await page.route('https://images.example.test/**',r=>r.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:'missing'}));
    const customHtml=await page.evaluate(async()=>{
      const b=window.testBrochure,d=b.newBrochure('en'),p=b.newBrochureProduct();p.title='CUSTOM-PDF';p.category='Equipment';
      const canvas=document.createElement('canvas');canvas.width=100;canvas.height=60;const c=canvas.getContext('2d');c.fillStyle='#109c82';c.fillRect(0,0,100,60);
      const valid=canvas.toDataURL(),bad='https://images.example.test/missing.jpg';
      d.logoUrl=bad;p.images=[{src:bad,caption:'BAD-CAPTION'},{src:valid,caption:'GOOD-PHOTO'}];
      p.detailsHtml=`<h2>Details</h2><p>TEXT-KEPT</p><figure><img src="${bad}"><figcaption>BAD-DETAIL-CAPTION</figcaption></figure><p><img src="${bad}"></p><p>END-OF-CUSTOM</p>`;
      d.items=[p];Object.assign(d,{pageWidthMm:250,pageHeightMm:400,pageMarginMm:15,fontFamily:'serif',bodyFontSize:13,lineHeight:1.8});
      if(!b.isBrochureDraft(d)||b.isBrochureDraft({...d,pageWidthMm:99})||b.isBrochureDraft({...d,fontFamily:'constructor'}))throw Error('Layout validation');
      const before=JSON.stringify(d);let missing=0,progress=[];
      const portable=await b.portableBrochure(d,'',(done,total)=>progress.push([done,total]),n=>missing=n);
      if(JSON.stringify(d)!==before||missing!==1||portable.items[0].images.length!==1||portable.logoUrl||portable.items[0].detailsHtml.includes('BAD-DETAIL-CAPTION'))throw Error('Image removal or draft mutation');
      if(progress.at(-1)[0]!==2)throw Error('Image progress');
      return b.brochureHtml(portable,false,'custom');
    });
    const custom=await browser.newPage({viewport:{width:1500,height:1000}});
    await custom.setContent(customHtml);await custom.waitForFunction(()=>document.body.dataset.paginationState==='ready');
    const customGeometry=await custom.evaluate(()=>({width:document.querySelector('.pagedjs_page').offsetWidth,height:document.querySelector('.pagedjs_page').offsetHeight,font:getComputedStyle(document.querySelector('.product-detail p')).fontFamily,text:document.querySelector('.pages').textContent,images:[...document.images].every(i=>i.naturalWidth>0)}));
    assert.ok(Math.abs(customGeometry.width-945)<2&&Math.abs(customGeometry.height-1512)<2);assert.match(customGeometry.font,/Times New Roman/);assert.ok(customGeometry.images);assert.match(customGeometry.text,/END-OF-CUSTOM/);assert.doesNotMatch(customGeometry.text,/BAD-/);
    const serialized=await custom.evaluate(()=>{const copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script').forEach(s=>s.remove());const styles=copy.querySelectorAll('style');document.querySelectorAll('style').forEach((s,i)=>{if(s.sheet)styles[i].textContent=[...s.sheet.cssRules].map(r=>r.cssText).join('\n')});return '<!doctype html>'+copy.outerHTML});
    fs.writeFileSync(path.join(out,'custom-paginated.html'),serialized);
    await custom.screenshot({path:path.join(out,'custom-desktop.png')});await custom.setViewportSize({width:390,height:844});await custom.screenshot({path:path.join(out,'custom-mobile.png')});await custom.close();
    checks.custom=customGeometry;
    for (const language of ['zh-CN', 'en', 'ar', 'vi']) {
      const html = await page.evaluate(language => {
        const b = window.testBrochure, draft = b.newBrochure(language);
        draft.companyName = 'SHANBO'; draft.website = 'https://example.com';
        const text = language === 'ar' ? 'تفاصيل المنتج ومواصفات الحفر' : language === 'zh-CN' ? '产品详情与钻机配置' : language === 'vi' ? 'Chi tiết sản phẩm và thông số khoan' : 'Product details and drilling specifications';
        const item = b.newBrochureProduct(); item.title = 'CR1000I'; item.category = text;
        const canvas = document.createElement('canvas'); canvas.width=500; canvas.height=400;
        const ctx = canvas.getContext('2d'); ctx.fillStyle='#daedf5';ctx.fillRect(0,0,500,400);ctx.fillStyle='#c62330';ctx.fillRect(90,90,320,220);ctx.fillStyle='white';ctx.font='38px sans-serif';ctx.fillText('PDF TEST',150,210);
        item.detailsHtml = `<h2>${text}</h2><p>${text} 1000 m / NQ 600 m</p><img src="${canvas.toDataURL()}">` + Array.from({ length: 10 }, (_, i) => `<h3>${i + 1}. ${text}</h3><p>${(text + ' CR1000I 1200 m. ').repeat(9)}</p>`).join('')
          + '<h2>Technical parameters</h2><table><tr><th>Parameter</th><th>Value</th></tr>' + Array.from({length:60},(_,i)=>(i%10===0?`<tr><th colspan="2">GROUP-${i/10+1}</th></tr>`:'')+`<tr><td>PARAMETER-${i}</td><td>${text} ${1200+i} m</td></tr>`).join('') + '</table><p>END-OF-DETAIL</p>';
        Object.assign(draft,{bodyFontSize:12,headingFontSize:18,lineHeight:1.8,paragraphSpacing:8,tableFontSize:11,tableDensity:language==='vi'?'compact':'standard',tableStyle:language==='en'?'minimal':language==='vi'?'grid':'web'});
        draft.items = [item];
        return b.brochureHtml(draft, false, 'test');
      }, language);
      const preview = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      await preview.setContent(html, { waitUntil: 'load' });
      await preview.waitForFunction(() => document.body.dataset.paginationState === 'ready' || document.body.dataset.paginationState === 'error', undefined, { timeout: 90000 });
      const status = await preview.evaluate(() => ({ state: document.body.dataset.paginationState, pages: document.querySelectorAll('.pagedjs_page').length, tail: document.querySelector('.pages').textContent.includes('END-OF-DETAIL'), rtl: !!document.querySelector('[dir="rtl"]'), images: [...document.images].every(image => image.complete && image.naturalWidth > 0), boxes: [...document.querySelectorAll('.pagedjs_page')].map(p => ({width:p.offsetWidth,height:p.offsetHeight})) }));
      assert.equal(status.state, 'ready'); assert.ok(status.pages > 2); assert.ok(status.tail); assert.ok(status.images);
      assert.equal(status.rtl, language === 'ar');
      assert.ok(status.boxes.every(box => Math.abs(box.width - 794) < 2 && Math.abs(box.height - 1123) < 2));
      const typography = await preview.evaluate(() => {
        const css=s=>getComputedStyle(document.querySelector(s));
        const bodies=[...document.querySelectorAll('.pagedjs_page table')];
        const groups=[...document.querySelectorAll('.pagedjs_page .table-group')];
        const parameters=[...document.querySelectorAll('.pagedjs_page tbody td')].map(c=>c.textContent.trim()).filter(t=>t.startsWith('PARAMETER-'));
        return {font:css('.product-detail p').fontSize,heading:css('.product-detail h2').fontSize,leading:css('.product-detail p').lineHeight,paragraph:css('.product-detail p').marginBottom,tableFont:css('table').fontSize,headerColor:css('thead th').backgroundColor,weight:css('tbody td').fontWeight,
          tables:bodies.length,headers:bodies.every(t=>!!t.tHead),groups:groups.length,orphanGroups:groups.filter(r=>!r.nextElementSibling).map(r=>r.textContent),parameters,
          rowOverflow:[...document.querySelectorAll('.pagedjs_page tbody tr')].filter(r=>r.getBoundingClientRect().bottom > r.closest('.pagedjs_page_content').getBoundingClientRect().bottom+3).length};
      });
      assert.equal(typography.font,'16px'); assert.equal(typography.heading,'24px'); assert.equal(typography.leading,'28.8px'); assert.equal(typography.paragraph,'10.6667px');
      assert.ok(Math.abs(parseFloat(typography.tableFont)-14.6667)<0.01); assert.equal(typography.weight,'400');
      assert.ok(typography.tables>1); assert.ok(typography.headers); assert.equal(typography.groups,6); assert.deepEqual(typography.orphanGroups,[]);
      assert.equal(new Set(typography.parameters).size,60); assert.equal(typography.parameters.length,60); assert.equal(typography.rowOverflow,0);
      await preview.screenshot({ path: path.join(out, `${language}-desktop.png`) });
      await preview.setViewportSize({width:390,height:844});
      await preview.screenshot({ path: path.join(out, `${language}-mobile.png`) });
      const serial = await preview.evaluate(() => {
        const copy = document.documentElement.cloneNode(true); copy.querySelectorAll('script').forEach(s => s.remove());
        const styles = copy.querySelectorAll('style'); document.querySelectorAll('style').forEach((s,i) => { if(s.sheet) styles[i].textContent = [...s.sheet.cssRules].map(r=>r.cssText).join('\n'); });
        return '<!doctype html>'+copy.outerHTML;
      });
      fs.writeFileSync(path.join(out, `${language}-paginated.html`), serial);
      await preview.locator('.pagedjs_page').filter({has:preview.locator('table')}).first().screenshot({path:path.join(out,`${language}-table.png`)});
      await preview.pdf({path:path.join(out,`${language}-typography.pdf`),format:'A4',printBackground:true,preferCSSPageSize:true});
      summaries.push({ language, ...status, typography }); await preview.close();
    }
    checks.timeoutRecovery={blockedAnimation:true,invalidImage:true,pendingImage:true,exportProgress:true,automaticImageRetry:true,maxImageRequests:maxActive};
    checks.galleries=galleries;
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, summaries }, null, 2));
    console.log(JSON.stringify({ checks, summaries }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
