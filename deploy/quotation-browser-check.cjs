const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),front=createRequire(path.join(root,'frontend/package.json'));
const {build}=createRequire(front.resolve('vite/package.json'))('esbuild');
const {chromium}=require('../backend/node_modules/playwright');
const out=path.join(root,'.cache-tutorial-update/quotation-check');fs.mkdirSync(out,{recursive:true});
async function main(){
  const bundle=await build({stdin:{contents:`import * as q from './src/utils/quotation';import * as l from './src/utils/quotation-language';import * as layout from './src/utils/quotation-layout';import {paginateQuotationForExport} from './src/utils/quotation-pagination';window.q={...q,...l,...layout,paginateForExport:paginateQuotationForExport};`,resolveDir:path.join(root,'frontend')},bundle:true,write:false,format:'iife',plugins:[{name:'fixtures',setup(b){
    b.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));
    b.onLoad({filter:/.*/,namespace:'raw'},args=>({contents:`export default ${JSON.stringify(fs.readFileSync(args.path,'utf8'))}`,loader:'js'}));
    b.onResolve({filter:/^@\/api\/(uploads|news)$/},args=>({path:args.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('news')?`export const NEWS_LANGUAGES=${JSON.stringify(['zh-CN','en','es','fr','ru','ar','pt','id','vi','tr'].map(code=>({code,name:code})))}`:`export const repairTranslatedHtml=s=>s;export const getUploadUrl=s=>'/api/'+s.replace(/^\\//,'');`,loader:'js'}));
  }}]});
  fs.writeFileSync(path.join(out,'quotation-fixture.js'),bundle.outputFiles[0].text);
  const browser=await chromium.launch({headless:true});
  try{
    const driver=await browser.newPage();await driver.route('https://admin.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await driver.goto('https://admin.example.test/');await driver.addScriptTag({content:bundle.outputFiles[0].text});
    const tests=await driver.evaluate(()=>{
      const q=window.q,source={id:5,title:'中文产品',content:'<table><tr><td>钻深</td><td>500 m</td></tr></table>',parameterRows:[{name:'中文公共参数',value:'800',unit:'m'}],largeImage:'',thumbnail:'/static/0.jpg',carouselImages:[],translations:[{lang:'en',title:'CR1000I',content:'<table><tr><td>Depth</td><td>500 m</td></tr></table>'}]};
      const foreign=q.createQuotationLine(q.exactQuotationProduct(source,'en'),'Core rigs','USD','en');if(/中文|技术参数/.test(foreign.specText)||!foreign.specText.includes('Depth'))throw Error('foreign specs fallback');
      if(q.createQuotationLine(q.exactQuotationProduct(source,'vi'),'','USD','vi').title)throw Error('missing title fallback');
      if(foreign.images.length)throw Error('thumbnail auto-imported');
      const old=q.normalizeQuotation({...q.createDefaultQuotation(),language:'fr',items:[{...foreign,images:undefined,image:'/static/old.jpg'}]});if(old.items[0].images[0]!=='/static/old.jpg'||old.language!=='fr')throw Error('old draft');
      const blank=q.normalizeQuotation({...old,items:[{...foreign,images:[],image:'/stale.jpg'}]});if(blank.items[0].images.length)throw Error('deleted image restored');
      const d={...q.createDefaultQuotation(),items:[foreign]};q.validateQuotation(d);for(const val of [-1,NaN,Infinity,null]){try{q.validateQuotation({...d,freight:val});throw Error('invalid accepted');}catch(e){if(e.message==='invalid accepted')throw e;}}
      return true;
    });assert.ok(tests);
    const counts={};
    for(const lang of ['zh-CN','en','es','fr','ru','ar','pt','id','vi','tr']){
      const html=await driver.evaluate(lang=>{
        const q=window.q,d={...q.createDefaultQuotation(),...q.quotationDefaults(lang),language:lang,companyName:'ShanBo Construction Equipment',companySubtitle:'Quotation regression fixture',customerCompany:'Example Customer',customerContact:'Customer',logoUrl:'',freight:333.35,depositPercent:25,notes:'END-OF-QUOTATION'};
        const line={id:'first',productId:5,title:'CR1000I',categoryName:'Core drilling rig',images:[],image:'',quantity:3,unit:q.quotationDefaults(lang).unit,unitPrice:12000.25,remark:'END-OF-PRODUCT',specText:Array.from({length:95},(_,i)=>(i%25===0?`[Group ${Math.floor(i/25)+1}]\n`:'')+`Parameter-${i}: ${i===94?'LAST-SPEC':i+' m'}`).join('\n')};d.items=[line];
        d.layout={...d.layout,pageMode:'paged'};return q.buildQuotationHtml(d,'quote-export');
      },lang);
      const page=await browser.newPage({viewport:{width:1532,height:1100}});await page.setContent(html,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.paginationState==='ready',null,{timeout:30000});
      counts[lang]=await page.locator('.pagedjs_page').count();assert.ok(counts[lang]>=3&&counts[lang]<=12,`${lang}: unreasonable page count ${counts[lang]}`);
      const content=await page.locator('.pages').innerText();assert.match(content,/LAST-SPEC/);assert.match(content,/END-OF-QUOTATION/);assert.match(content,/36,334.10/);assert.match(content,/9,083.53/);
      assert.equal(await page.locator('.q-spec-row').count(),95);assert.ok(await page.locator('.q-specs thead').count()>1);
      const headings=await page.locator('.q-specs').evaluateAll(tables=>tables.map(table=>({heading:table.querySelector('thead th').textContent,group:table.querySelector('tbody tr[data-q-group]').dataset.qGroup})));
      assert.equal(headings[0].heading,'Group 1');
      assert.ok(headings.every(h=>h.heading===h.group),lang+' continued group header mismatch '+JSON.stringify(headings));
      const labels=await page.locator('.q-price-label').evaluateAll(nodes=>nodes.map(n=>({nowrap:getComputedStyle(n).whiteSpace,width:n.getBoundingClientRect().width,parent:n.parentElement.getBoundingClientRect().width})));
      assert.ok(labels.every(l=>l.nowrap==='nowrap'&&l.width<=l.parent+1),lang+' split or overflowing price heading');
      const borders=await page.locator('.q-fragment').evaluateAll(grids=>grids.map(g=>({
        outline:getComputedStyle(g).outlineStyle,bottom:getComputedStyle(g).borderBottomWidth,
        photo:getComputedStyle(g.querySelector('.q-product-photo')).borderRightWidth,
        price:getComputedStyle(g.querySelector('.q-product-price')).borderLeftWidth,
        specs:getComputedStyle(g.querySelector('.q-product-specs')).borderLeftWidth,
      })));
      assert.ok(borders.every(b=>b.outline==='none'&&b.bottom==='0px'&&b.photo==='0px'&&b.price==='0px'&&parseFloat(b.specs)>0&&parseFloat(b.specs)<=1.1),lang+' stacked quotation borders '+JSON.stringify(borders));
      const geometry=await page.locator('.pagedjs_pagebox').evaluateAll(pages=>pages.map(p=>({w:p.offsetWidth,h:p.offsetHeight})));assert.ok(geometry.every(p=>Math.abs(p.w-794)<=1&&Math.abs(p.h-1123)<=1));
      const arrangement=await page.locator('.q-product-grid').first().evaluate(grid=>{
        const photo=grid.querySelector('.q-product-photo')?.getBoundingClientRect();
        const specs=grid.querySelector('.q-product-specs')?.getBoundingClientRect();
        const price=grid.querySelector('.q-product-price')?.getBoundingClientRect();
        return {photo:photo?.toJSON(),specs:specs?.toJSON(),price:price?.toJSON()};
      });
      await page.locator('.pagedjs_page').first().screenshot({path:path.join(out,`quotation-${lang}-layout.png`)});
      assert.ok(arrangement.photo && arrangement.specs && arrangement.price,lang+' missing quotation columns '+JSON.stringify(arrangement));
      assert.ok(arrangement.photo.right<=arrangement.specs.left+2 && arrangement.specs.right<=arrangement.price.left+2,lang+' columns not side by side');
      assert.ok(Math.abs(arrangement.photo.top-arrangement.specs.top)<2 && Math.abs(arrangement.price.top-arrangement.specs.top)<2,lang+' columns not top aligned');
      // Paged.js has an oversized multicolumn wrapper; inspect actual document elements, not that wrapper.
      const overflow=await page.locator('.pagedjs_area').evaluateAll(areas=>areas.flatMap(a=>[...a.querySelectorAll('.quotation-document [data-ref]')].filter(n=>{const r=n.getBoundingClientRect(),bounds=a.getBoundingClientRect();return r.width&& (r.right>bounds.right+3||r.left<bounds.left-3);}).map(n=>n.className)));
      assert.equal(overflow.length,0,lang+' horizontal content overflow '+overflow.join(','));
      assert.equal(await page.locator('.quotation-document').first().getAttribute('dir'),lang==='ar'?'rtl':'ltr');
      const fragments=await page.locator('.q-product-grid').evaluateAll(grids=>grids.map(grid=>{
        const bounds=grid.getBoundingClientRect(),photo=grid.querySelector('.q-product-photo').getBoundingClientRect(),price=grid.querySelector('.q-product-price').getBoundingClientRect();
        return {height:bounds.height,photo:photo.height,price:price.height,top:Math.abs(price.top-bounds.top),continued:grid.dataset.continued};
      }));
      assert.ok(fragments.length>1);
      assert.ok(fragments.every(f=>Math.abs(f.photo-f.height)<2&&Math.abs(f.price-f.height)<2&&f.top<2),lang+' split quotation lost its side columns');
      assert.ok(fragments.slice(1).every(f=>f.continued==='true'));
      if(['en','ar','zh-CN'].includes(lang)){await page.locator('.pagedjs_page').first().screenshot({path:path.join(out,`quotation-${lang}.png`)});await page.locator('.pagedjs_page').last().screenshot({path:path.join(out,`quotation-${lang}-last.png`)});}
      if(lang==='en'){
        const result=await driver.evaluate(html=>window.q.paginateForExport(html,'quote-export'),html);fs.writeFileSync(path.join(out,'quotation-en.html'),result.html);
        const exported=await browser.newPage();await exported.setContent(result.html);
        const frames=await exported.locator('.q-product,.q-subtotal,.q-logistics-grid,.q-notes').evaluateAll(nodes=>nodes.map(n=>({name:n.className,left:parseFloat(getComputedStyle(n).borderLeftWidth),right:parseFloat(getComputedStyle(n).borderRightWidth),bottom:parseFloat(getComputedStyle(n).borderBottomWidth)})));
        assert.ok(frames.length>=4&&frames.every(f=>f.left>0&&f.right>0&&f.bottom>0),'serialized PDF lost table borders '+JSON.stringify(frames));
        await exported.emulateMedia({media:'print'});const pdf=await exported.pdf({preferCSSPageSize:true,printBackground:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(out,'quotation-en.pdf'),pdf);await exported.close();
      }
      await page.close();
    }
    for(const [lang,layout] of [['zh-CN',{}],['en',{}],['fr',{}],['ar',{}],['en',{pageWidth:297,pageHeight:210}],['en',{pageWidth:250,pageHeight:400,tableFontSize:12,lineHeight:1.8,cellPadding:3}]]){
      const html=await driver.evaluate(({lang,layout})=>{
        const q=window.q,d={...q.createDefaultQuotation(),...q.quotationDefaults(lang),language:lang,companyName:'ShanBo Equipment',logoUrl:''};
        const canvas=document.createElement('canvas');canvas.width=400;canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#dae9ee';ctx.fillRect(0,0,400,320);ctx.fillStyle='#1685ad';ctx.fillRect(90,40,160,230);const image=canvas.toDataURL();
        d.layout=layout;d.items=[{id:'short',productId:5,title:'DTH30C',categoryName:'',images:[image],image,quantity:1,unit:q.quotationDefaults(lang).unit,unitPrice:12500,specText:'[Specifications]\nDepth (m): 30\nDiameter (mm): 78-280',remark:''}];
        d.layout={...d.layout,pageMode:'paged'};return q.buildQuotationHtml(d,'quote-compact');
      },{lang,layout});
      const page=await browser.newPage({viewport:{width:1400,height:1000}});await page.setContent(html,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.paginationState==='ready',null,{timeout:30000});
      const bounds=await page.locator('.q-product-compact').evaluate(grid=>{
        const box=selector=>grid.querySelector(selector).getBoundingClientRect().toJSON();
        return {grid:grid.getBoundingClientRect().toJSON(),photo:box('.q-product-photo'),specs:box('.q-product-specs'),table:box('.q-specs'),price:box('.q-product-price'),values:box('.q-price-values'),imageReady:grid.querySelector('img').naturalWidth>0};
      });
      assert.ok(bounds.imageReady,lang+' compact image missing');
      for(const part of ['photo','specs','table','price','values'])assert.ok(Math.abs(bounds[part].bottom-bounds.grid.bottom)<3,lang+' incomplete compact column '+part+' '+JSON.stringify(bounds));
      assert.equal(await page.locator('.q-spec-row').count(),2);assert.ok(bounds.values.height>100,lang+' price cell too short');
      const lastRow=await page.locator('.q-product-compact').evaluate(grid=>{
        const bottom=grid.getBoundingClientRect().bottom;
        const textBottom=[...grid.querySelectorAll('.q-spec-row:last-child > *')].map(cell=>{const range=document.createRange();range.selectNodeContents(cell);return range.getBoundingClientRect().bottom;});
        return {clipped:getComputedStyle(grid).overflow==='hidden',fits:textBottom.every(y=>y<=bottom+0.5)};
      });
      assert.ok(lastRow.clipped&&lastRow.fits,lang+' last row obscures border or clips text');
      const money=await page.locator('.q-money').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,parent:n.parentElement.getBoundingClientRect().width,nowrap:getComputedStyle(n).whiteSpace})));
      assert.ok(money.every(n=>n.nowrap==='nowrap'&&n.width<=n.parent+1),'price should fit on one line');
      const paper={pageWidth:210,pageHeight:297,...layout};
      const boxes=await page.locator('.pagedjs_pagebox').evaluateAll(nodes=>nodes.map(n=>({width:n.offsetWidth,height:n.offsetHeight})));
      assert.ok(boxes.every(b=>Math.abs(b.width-paper.pageWidth*96/25.4)<2&&Math.abs(b.height-paper.pageHeight*96/25.4)<2),'custom geometry');
      if(layout.tableFontSize){
        const css=await page.locator('.q-specs').evaluate(n=>({size:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
        assert.ok(Math.abs(css.size-16)<0.1);assert.ok(Math.abs(css.line-28.8)<0.2);
        const exported=await driver.evaluate(html=>window.q.paginateForExport(html,'quote-compact'),html);
        fs.writeFileSync(path.join(out,'quotation-custom.html'),exported.html);
      }
      await page.locator('.q-product').filter({has:page.locator('.q-product-compact')}).screenshot({path:path.join(out,`quotation-${lang}-${paper.pageWidth}-${paper.pageHeight}-compact.png`)});
      await page.close();
    }
    const web=await browser.newPage({viewport:{width:1600,height:1000}});
    const webHtml=await driver.evaluate(()=>{
      const d=window.q.createDefaultQuotation();d.logoUrl='';d.items=[{id:'web',productId:1,title:'Example equipment',quantity:1,unit:'unit',unitPrice:12000,images:[],image:'',remark:'',specText:Array.from({length:35},(_,i)=>'Parameter '+i+': '+i+' m').join('\n')}];
      return window.q.buildQuotationWebHtml(d);
    });
    await web.setContent(webHtml);assert.equal(await web.locator('.pagedjs_page').count(),0);assert.ok(await web.locator('.quotation-document').evaluate(e=>e.offsetWidth)>1500);
    assert.equal(await web.locator('.q-spec-row').count(),35);
    const webColumns=await web.locator('.q-product-grid').evaluate(g=>Array.from(g.children).map(e=>e.getBoundingClientRect().height));
    assert.ok(Math.max(...webColumns)-Math.min(...webColumns)<2,'web columns must fill the complete table');
    await web.setViewportSize({width:390,height:844});assert.equal(await web.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    await web.close();
    console.log(JSON.stringify({languages:counts,exactTranslations:true,preservedAmounts:true,repeatedHeaders:true,a4:true,compactColumnsFillPhoto:true},null,2));
    const vite=await import(require('node:url').pathToFileURL(front.resolve('vite')).href),createServer=vite.createServer||vite.default.createServer;
    const server=await createServer({root:path.join(root,'frontend'),server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')}});await server.listen();
    try {
      const base=`http://127.0.0.1:${server.httpServer.address().port}`;
      const draft=await driver.evaluate(()=>{const q=window.q,d=q.createDefaultQuotation();d.companyName='ShanBo Equipment';d.companySubtitle='';d.logoUrl='';d.items=[{id:'p',productId:5,title:'CR1000I',categoryName:'岩芯钻机',images:[],image:'',quantity:3,unit:'台',unitPrice:12000.25,specText:'钻深: 500 m',remark:''}];return d;});
      const ui=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
      ui.on('pageerror',e=>errors.push(e.message));
      await ui.addInitScript(d=>{if(window!==window.top)return;localStorage.setItem('localToken','fixture-token');localStorage.setItem('pbootActiveSiteId','1');localStorage.setItem('pboot-quotation-draft-v1:site:1',JSON.stringify(d));},draft);
      const languages=['zh-CN','en','fr','ar','id','vi','tr'];
      const record={id:8,data:draft,quotationNo:draft.quotationNo,currency:'USD',total:36000.75,itemCount:1,quotationDate:draft.quotationDate,customerCompany:'Example',customerContact:'Example',updateTime:'2026-09-13'};
      await ui.route('**/api/**',async route=>{
        const req=route.request(),url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return route.continue();const p=url.pathname.replace(/^\/api/,'');let data;
        if(p==='/sites')data=[{id:1,name:'测试网站',enabled:true,isDefault:true}];
        else if(p==='/sites/current/languages')data=languages.map(code=>({code}));
        else if(p==='/sites/current/profile')data={companyName:'ShanBo Equipment',siteName:'测试网站',logoUrl:''};
        else if(p==='/menus')data=[{id:9,name:'岩芯钻机',model:'3',code:'pboot:cn:9'},...languages.filter(l=>l!=='zh-CN').map((l,i)=>({id:10+i,name:'Core drilling rig',model:'3',sourceMenuId:9,code:`pboot:${l}:9`}))];
        else if(p==='/quotations/next-number')data={quotationNo:'BJ-20260913-02'};
        else if(p==='/quotations'&&req.method()==='GET')data=[record];
        else if(/^\/quotations(?:\/8)?$/.test(p)){writes.push(req.postDataJSON());Object.assign(record,req.postDataJSON());data=record;}
        else if(p==='/products')data=[{id:5,title:url.searchParams.get('lang')==='zh-CN'?'CR1000I 中文':'CR1000I',menuId:9,carouselImages:[]}];
        else if(p==='/products/5')data={id:5,title:'CR1000I 中文',menuId:9,content:'<table><tr><td>钻深</td><td>500 m</td></tr></table>',carouselImages:[],translations:languages.map(lang=>({lang,title:'CR1000I',content:'<table><tr><td>Depth</td><td>500 m</td></tr></table>'}))};
        else if(p==='/quotations/export-pdf'){return route.fulfill({contentType:'application/pdf',body:fs.readFileSync(path.join(out,'quotation-en.pdf'))});}
        else {errors.push('Unexpected API '+p);return route.fulfill({status:404,body:'not found'});}
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      await ui.goto(base+'/#/quotations');try {await ui.getByRole('button',{name:'保存报价单',exact:true}).waitFor({timeout:15000});} catch(e) {console.log(errors,await ui.locator('body').innerText());await ui.screenshot({path:path.join(out,'ui-failure.png')});throw e;}
      await ui.frameLocator('iframe[title="报价单 PDF 预览"]').locator('body[data-pagination-state="ready"]').waitFor({timeout:30000});
      await ui.getByRole('button',{name:'报价单纸张与排版'}).click();
      assert.equal(await ui.getByRole('radio',{name:'连续长页（高度自动）',exact:true}).isChecked(),true);
      await ui.getByText('固定纸张分页',{exact:true}).click();
      await ui.getByRole('spinbutton',{name:'纸张高度（mm）',exact:true}).fill('400');
      await ui.getByRole('spinbutton',{name:'纸张高度（mm）',exact:true}).press('Tab');
      await ui.getByRole('spinbutton',{name:'参数字号（pt）',exact:true}).fill('12');
      await ui.getByRole('spinbutton',{name:'参数字号（pt）',exact:true}).press('Tab');
      await ui.getByText('连续长页（高度自动）',{exact:true}).click();
      assert.equal(await ui.getByRole('spinbutton',{name:'纸张高度（mm）',exact:true}).count(),0);
      await ui.frameLocator('iframe[title="报价单 PDF 预览"]').locator('body[data-pagination-state="ready"]').waitFor({timeout:30000});
      await ui.getByRole('combobox',{name:'报价语言',exact:true}).press('Enter');await ui.getByRole('option',{name:'English',exact:true}).click();await ui.getByRole('button',{name:'保存并新建语言版本',exact:true}).click();
      try {await ui.getByText('已新建独立语言版本，请核对条款后保存',{exact:true}).waitFor({timeout:15000});} catch(e) {console.log(errors,JSON.stringify(writes),await ui.locator('body').innerText());await ui.screenshot({path:path.join(out,'ui-language-failure.png')});throw e;}assert.equal(writes[0].data.language,'zh-CN');
      await ui.getByRole('button',{name:'保存报价单',exact:true}).click();assert.equal(writes[1].data.language,'en');assert.equal(writes[1].data.items[0].unitPrice,12000.25);assert.equal(writes[1].data.layout.pageHeight,400);assert.equal(writes[1].data.layout.tableFontSize,12);
      await ui.frameLocator('iframe[title="报价单 PDF 预览"]').getByRole('heading',{name:'Commercial Quotation',exact:true}).waitFor({timeout:15000});
      await ui.frameLocator('iframe[title="报价单 PDF 预览"]').locator('body[data-pagination-state="ready"]').waitFor({timeout:30000});
      const dl=ui.waitForEvent('download');await ui.getByRole('button',{name:'导出 PDF',exact:true}).click();assert.match((await dl).suggestedFilename(),/-en\.pdf$/);
      await ui.locator('.el-message').last().waitFor({state:'hidden'});
      await ui.screenshot({path:path.join(out,'quotation-editor-desktop.png')});
      assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await ui.setViewportSize({width:390,height:844});await ui.screenshot({path:path.join(out,'quotation-editor-mobile.png')});
      assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'mobile overflow');
      assert.deepEqual(errors,[]);await ui.close();console.log('Full Vue UI: language save/copy, server PDF action, desktop/mobile passed');
    } finally {await server.close();}
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
