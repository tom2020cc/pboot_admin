const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../backend/node_modules/playwright');
const out=path.resolve(__dirname,'../.cache-tutorial-update/quotation-check');
async function main(){
  const browser=await chromium.launch();
  try{
    const driver=await browser.newPage();
    await driver.addScriptTag({content:fs.readFileSync(path.join(out,'quotation-fixture.js'),'utf8')});
    for(const lang of ['zh-CN','en','es','fr','ru','ar','pt','id','vi','tr']){
      const html=await driver.evaluate(lang=>{
        const q=window.q,d={...q.createDefaultQuotation(),...q.quotationDefaults(lang),language:lang,companyName:'Equipment Quotation',logoUrl:'',layout:{pageWidth:297,pageHeight:180,margin:9},freight:5555,notes:'FINAL-NOTE'};
        if(q.quotationLayout(d.layout).pageMode!=='continuous')throw Error('old layout must default to continuous');
        const c=document.createElement('canvas');c.width=400;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='#edf3f6';ctx.fillRect(0,0,400,300);ctx.fillStyle='#1680a3';ctx.fillRect(90,30,210,235);const image=c.toDataURL();
        const images=[image];for(let i=0;i<2;i++){ctx.fillRect(i,0,1,1);images.push(c.toDataURL())}
        d.items=[95,14,2].map((count,i)=>({id:'long-'+i,productId:i+1,title:['CR800UG','CR1200I','DTH30C'][i],categoryName:'Drilling Rig',images,image,quantity:i?1:2,unit:q.quotationDefaults(lang).unit,unitPrice:i?0:265740,remark:'',specText:'[Technical Specifications]\nParameter Item: Parameter Value\n[Drilling Capability]\n'+Array.from({length:count},(_,j)=>'Drilling depth '+j+': '+(j===count-1?'LAST-PARAMETER-'+i:'1600 m')).join('\n')}));
        return q.buildQuotationHtml(d,'continuous-check');
      },lang);
      const page=await browser.newPage({viewport:{width:1400,height:1000}});
      await page.setContent(html,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.body.dataset.paginationState==='ready',null,{timeout:30000});
      assert.equal(await page.locator('.pagedjs_page').count(),0);
      assert.equal(await page.locator('.q-continuous-sheet').count(),1);
      assert.equal(await page.locator('.q-product').count(),3);
      assert.equal(await page.locator('.q-spec-row').count(),111);
      const text=await page.locator('.q-continuous-sheet').innerText();
      assert.doesNotMatch(text,/Parameter Item|Parameter Value/);
      assert.match(text,/537,035.00/);assert.match(text,/FINAL-NOTE/);assert.match(text,/LAST-PARAMETER-2/);
      const boxes=await page.locator('.q-product-grid').evaluateAll(grids=>grids.map(g=>{
        const box=g.getBoundingClientRect();
        return ['.q-product-photo','.q-product-specs','.q-product-price','.q-specs'].map(s=>{const r=g.querySelector(s).getBoundingClientRect();return {bottom:r.bottom,expected:box.bottom}});
      }));
      assert.ok(boxes.flat().every(b=>Math.abs(b.bottom-b.expected)<2),lang+' open column border '+JSON.stringify(boxes));
      assert.equal(await page.locator('.q-specs thead').count(),3);
      assert.equal(await page.locator('.q-photo-gallery img').count(),9);
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.querySelector('.q-continuous-sheet').getBoundingClientRect().width<=document.querySelector('.continuous-viewport').clientWidth+2);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,lang+' mobile overflow');
      if(['en','zh-CN','ar'].includes(lang)){
        const result=await driver.evaluate(html=>window.q.paginateForExport(html,'continuous-check'),html);assert.equal(result.pages,1);
        fs.writeFileSync(path.join(out,'quotation-continuous-'+lang+'.html'),result.html);
        const exported=await browser.newPage({viewport:{width:1200,height:1000}});await exported.setContent(result.html);
        await exported.emulateMedia({media:'print'});
        await exported.pdf({path:path.join(out,'quotation-continuous-'+lang+'.pdf'),preferCSSPageSize:true,printBackground:true});
        await exported.locator('.q-product').nth(1).screenshot({path:path.join(out,'quotation-continuous-'+lang+'-product.png')});
        await exported.close();
      }
      console.log(lang,'continuous sheet: 3 products / 111 parameters / totals and columns verified');
      await page.close();
    }
  }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
