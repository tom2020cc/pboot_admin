import pagedPolyfill from '../../node_modules/pagedjs/dist/paged.polyfill.min.js?raw';
import type { QuotationLanguageCode } from './quotation';
import { quotationLayout, type QuotationLayout } from './quotation-layout';

const jsString = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
// Only the isolated document uses this scheduler. Offscreen iframe animation/idle callbacks can stop indefinitely.
const paginationScheduler = `(function(){
  function bounded(requestName,cancelName,idle){
    var nativeRequest=window[requestName]&&window[requestName].bind(window),nativeCancel=window[cancelName]&&window[cancelName].bind(window);
    var pending=new Map(),sequence=0;
    window[requestName]=function(callback){
      var id=++sequence,entry={};pending.set(id,entry);
      function finish(value){if(!pending.has(id))return;pending.delete(id);clearTimeout(entry.timer);if(nativeCancel&&entry.native!==undefined)nativeCancel(entry.native);callback(value)}
      entry.timer=setTimeout(function(){finish(idle?{didTimeout:true,timeRemaining:function(){return 0}}:performance.now())},100);
      if(nativeRequest)entry.native=nativeRequest(finish);
      return id;
    };
    window[cancelName]=function(id){var entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);if(nativeCancel&&entry.native!==undefined)nativeCancel(entry.native)};
  }
  bounded('requestAnimationFrame','cancelAnimationFrame',false);bounded('requestIdleCallback','cancelIdleCallback',true);
})();`;
const fitPages = `function fitPages(){var pages=document.querySelector('.pages');var shell=document.querySelector('.document');var page=document.querySelector('.pagedjs_page');if(pages&&shell&&page){pages.style.zoom=String(shell.clientWidth/page.offsetWidth)}}window.addEventListener('resize',fitPages);fitPages();`;
const loadImages = `
  var images=Array.from(document.querySelectorAll('#quotation-source img[data-quotation-src]')),groups=new Map(),cursor=0,done=0;
  images.forEach(function(img,index){var src=img.getAttribute('data-quotation-src');if(!groups.has(src))groups.set(src,{src:src,index:index+1,images:[]});groups.get(src).images.push(img)});
  var entries=Array.from(groups.values()),stopped=false,activeProbes=new Set();
  function progress(retry){if(!stopped)report({state:'progress',phase:'images',done:done,total:entries.length,retry:retry||0})}
  progress();
  try{await bounded(Promise.all(Array.from({length:Math.min(3,entries.length)},async function(){
    while(!stopped&&cursor<entries.length){
      var entry=entries[cursor++],decoded;
      for(var attempt=0;attempt<2;attempt++){
        if(stopped)return;
        var probe=new Image();activeProbes.add(probe);probe.decoding='async';probe.referrerPolicy='no-referrer';probe.src=entry.src;
        try{await bounded(probe.decode(),15000);decoded=probe;break}
        catch(error){probe.src='';if(stopped)return;if(attempt===1){imageIndex=entry.index;throw error}progress(1)}
        finally{activeProbes.delete(probe)}
      }
      if(stopped)return;
      entry.images.forEach(function(img){img.loading='eager';img.src=entry.src;img.removeAttribute('data-quotation-src');if(!img.hasAttribute('width'))img.width=decoded.naturalWidth;if(!img.hasAttribute('height'))img.height=decoded.naturalHeight});
      done++;progress();
    }
  })),60000)}finally{stopped=true;activeProbes.forEach(function(probe){probe.src=''});activeProbes.clear()}
  await bounded(Promise.all(images.map(function(img){return img.decode()})),10000);
`;
export { loadImages as quotationImageLoader };
// Rebuild table headers before measuring continued rows, so headers consume page space.
const repeatTableHeaders = `Paged.registerHandlers(class extends Paged.Handler{
  async beforeParsed(content){
    await bounded(document.fonts.ready,15000);
    var source=document.getElementById('quotation-source'),documentTop=source.querySelector('.quotation-document').getBoundingClientRect().top;
    content.querySelectorAll('.q-product[data-q-line]').forEach(function(product,index){
      var original=source.querySelector('.q-product[data-q-line="'+product.dataset.qLine+'"]');
      var bounds=original.getBoundingClientRect(),grid=product.querySelector('.q-product-grid');
      var available=config.contentHeight-(index===0?bounds.top-documentTop:0)-4;
      product.classList.toggle('q-keep-product',bounds.height<=available);
      if(bounds.height>config.contentHeight-4){
        product.classList.remove('q-product-short');grid.classList.remove('q-product-compact');
      }
      if(!grid.classList.contains('q-product-compact')){
        grid.querySelector('.q-product-photo').remove();grid.querySelector('.q-product-price').remove();
      }
    });
  }
  beforePageLayout(page){if(page.position>=150)throw new Error('Too many quotation pages')}
  renderNode(node,source){
    var element=node.nodeType===1?node:node.parentElement;
    var table=element&&element.closest('table[data-split-from]');
    if(!table)return;
    var sourceElement=source.nodeType===1?source:source.parentElement;
    var original=sourceElement.closest('table');
    if(!original)return;
    if(!table.querySelector('thead')){
      var head=original.querySelector('thead');if(!head)return;
      table.insertBefore(head.cloneNode(true),table.firstChild);
    }
    var firstRow=table.querySelector('tbody tr[data-q-group]');
    var row=firstRow||sourceElement.closest('tr[data-q-group]');
    var heading=table.querySelector('thead th');
    if(row&&heading)heading.textContent=row.dataset.qGroup;
    var columns=original.querySelector('colgroup');if(columns&&!table.querySelector('colgroup'))table.insertBefore(columns.cloneNode(true),table.firstChild);
  }
});`;
// Paged.js fragments the specification table but omits its grid siblings on later pages.
// Restore only the side columns inside the already measured fragment; never reflow table rows.
// Fill a page only when its next product has moved to the following page.
const fillProductPage = `
  var pages=Array.from(document.querySelectorAll('.pages .pagedjs_page'));
  pages.forEach(function(page){
    var first=page.querySelector('.q-product'),area=page.querySelector('.pagedjs_area');
    if(first&&area&&first.querySelector('.q-product-title')&&Math.abs(first.getBoundingClientRect().top-area.getBoundingClientRect().top)<2)first.style.borderTopWidth='1px';
  });
  pages.slice(0,-1).forEach(function(page,index){
    var products=page.querySelectorAll('.q-product[data-q-line]'),product=products[products.length-1];
    var next=pages[index+1].querySelector('.q-product[data-q-line]');
    if(!product||!next||product.dataset.qLine===next.dataset.qLine)return;
    if(page.querySelector('.q-subtotal,.q-logistics,.q-summary,.q-notes,.q-footer'))return;
    var grid=product.querySelector('.q-product-grid'),area=page.querySelector('.pagedjs_area');
    if(!grid||!area)return;
    var gap=area.getBoundingClientRect().bottom-product.getBoundingClientRect().bottom-2;
    if(gap<12)return;
    grid.style.height=(grid.getBoundingClientRect().height+gap)+'px';
    grid.classList.add('q-page-filled');
  });
`;
const restoreProductColumns = `
  var originals=new Map(),seen=new Set();
  source.querySelectorAll('.q-product[data-q-line]').forEach(function(product){originals.set(product.dataset.qLine,product)});
  document.querySelectorAll('.pages .q-product-grid').forEach(function(grid){
    var product=grid.closest('.q-product'),key=product&&product.dataset.qLine,original=originals.get(key);
    if(!original)return;
    var area=grid.closest('.pagedjs_area'),bounds=grid.getBoundingClientRect();
    var height=Math.min(bounds.height,area.getBoundingClientRect().bottom-bounds.top);
    if(height<1)return;
    var continued=seen.has(key);seen.add(key);
    grid.style.height=height+'px';grid.style.minHeight='0';grid.style.position='relative';grid.classList.add('q-fragment');
    ['photo','price'].forEach(function(kind){
      var old=grid.querySelector('.q-product-'+kind);if(old)old.remove();
      var column=original.querySelector('.q-product-'+kind).cloneNode(true);
      column.style.gridArea='auto';
      [column].concat(Array.from(column.querySelectorAll('*'))).forEach(function(node){Array.from(node.attributes).filter(function(a){return a.name==='id'||a.name==='data-ref'||a.name.indexOf('data-split')===0}).forEach(function(a){node.removeAttribute(a.name)})});
      column.style.width=(kind==='photo'?config.imageWidth:config.priceWidth)+'%';
      if(kind==='photo'){
        if(continued){var caption=document.createElement('div');caption.className='q-continuation';caption.textContent=original.querySelector('.q-product-title').textContent.trim()+' · '+config.continued;column.prepend(caption)}
        var gallery=column.querySelector('.q-photo-gallery');
        if(gallery){
          var count=gallery.querySelectorAll('img').length,available=Math.max(16,height-32-(continued?48:0));
          var imageWidth=Math.max(1,bounds.width*config.imageWidth/100-24);
          var stackedHeight=Array.from(gallery.querySelectorAll('img')).reduce(function(total,img){return total+imageWidth*img.naturalHeight/Math.max(1,img.naturalWidth)},(count-1)*8);
          var stacked=count===3&&available>=Math.max(240,stackedHeight);
          if(stacked){gallery.style.gridTemplateColumns='1fr';gallery.classList.add('q-photo-stacked')}
          if(continued&&count>1&&available<170){Array.from(gallery.querySelectorAll('img')).slice(1).forEach(function(img){img.remove()});count=1;gallery.style.gridTemplateColumns='1fr'}
          gallery.style.maxHeight=available+'px';
          gallery.querySelectorAll('img').forEach(function(img,index){img.style.maxHeight=(stacked?(available-16)/3:count===1?available:available*0.46)+'px';img.style.width='100%';img.style.height='auto'});
        }
      }
      grid.appendChild(column);
    });
    grid.dataset.continued=String(continued);
  });
`;
const shellCss = `html{scroll-behavior:smooth}body{margin:0;background:#e9edf1;color:#263646;font:15px/1.6 Arial,"Microsoft YaHei",sans-serif;letter-spacing:0}.document,.actions{width:1500px;max-width:calc(100% - 32px);margin:24px auto}.actions{display:flex;gap:22px;flex-wrap:wrap}.actions a{color:#384958;text-decoration:none}.pages{width:max-content}.pagedjs_page{background:#fff;margin-bottom:24px;box-shadow:0 2px 12px #26364614}.load-state{padding:40px;text-align:center;color:#667585}.document-source{position:absolute;left:-10000px;top:0;width:184mm;visibility:hidden}.document-source img{max-width:100%}@media print{@page{size:A4;margin:0}body{background:#fff}.actions,.load-state{display:none!important}.document{width:auto;max-width:none;margin:0}.pages{zoom:1!important}.pagedjs_page{box-shadow:none!important;margin:0!important;break-after:page}.pagedjs_page:last-child{break-after:auto}}@media(max-width:600px){.document,.actions{max-width:calc(100% - 16px);margin:12px auto}.actions{gap:12px;font-size:13px}}`;

export type QuotationPaginationOptions = { css: string; layout?: Partial<QuotationLayout> };

export function paginatedQuotationHtml(content: string, title: string, language: QuotationLanguageCode, reportToken: string, options: QuotationPaginationOptions) {
  const labels = language === 'zh-CN' ? { preparing: '正在排版报价单...', error: '报价单分页失败，请检查图片后重试。' } : { preparing: 'Preparing quotation...', error: 'Quotation pagination failed. Check images and try again.' };
  const paper = quotationLayout(options.layout);
  const documentShellCss = shellCss.replace('width:184mm', `width:${paper.pageWidth - 2 * paper.margin}mm`).replace('size:A4;margin:0', `size:${paper.pageWidth}mm ${paper.pageHeight}mm;margin:0`);
  const continued = { 'zh-CN': '续页 · 同一产品', en: 'Continued · same item', es: 'Continuación · mismo producto', fr: 'Suite · même produit', ru: 'Продолжение · тот же товар', ar: 'تابع · نفس المنتج', pt: 'Continuação · mesmo produto', id: 'Lanjutan · produk yang sama', vi: 'Tiếp theo · cùng sản phẩm', tr: 'Devam · aynı ürün' };
  const config = { token: reportToken, previewId: 0, error: labels.error, companySelector: '.q-company h1', titleSelector: '.q-document-title h2', imageWidth: paper.imageColumnWidth, priceWidth: paper.priceColumnWidth, contentHeight: (paper.pageHeight - 2 * paper.margin) * 96 / 25.4, continued: continued[language] };
  // Keep source images inert until a bounded loader can schedule and retry them.
  const source = new DOMParser().parseFromString(content, 'text/html');
  source.querySelectorAll('img[src]').forEach(img => { img.setAttribute('data-quotation-src', img.getAttribute('src')!); img.removeAttribute('src'); });
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${documentShellCss}</style></head><body>
    <div class="load-state" role="status">${labels.preparing}</div><main class="document"><div class="pages"></div></main><div class="document-source" id="quotation-source">${source.body.innerHTML}</div>
    <script>window.PagedConfig={auto:false};${paginationScheduler}</script><script>${pagedPolyfill.replace(/<\/script/gi, '<\\/script')}</script>
    <script>(async function(){var config=${jsString(config)},phase='images',imageIndex=0,previewer;
      function report(data){if(parent!==window)parent.postMessage(Object.assign({type:'quotation-pagination',token:config.token,previewId:config.previewId},data),'*')}
      function bounded(task,ms){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('timeout'))},ms);Promise.resolve(task).then(function(value){clearTimeout(timer);resolve(value)},function(error){clearTimeout(timer);reject(error)})})}
      try{
        report({state:'progress',phase:phase});
        ${loadImages}
        phase='fonts';report({state:'progress',phase:phase});await bounded(document.fonts.ready,15000);
        phase='layout';report({state:'progress',phase:phase});${repeatTableHeaders}
        var source=document.getElementById('quotation-source');var fragment=document.createRange().createContextualFragment(source.innerHTML);
        previewer=new Paged.Previewer();var flow=await bounded(previewer.preview(fragment,[{'document.css':${jsString(options.css)}}],document.querySelector('.pages')),60000);
        ${fillProductPage}
        ${restoreProductColumns}
        var company=source.querySelector(config.companySelector),heading=source.querySelector(config.titleSelector);
        var running={company:company?company.textContent:'',documentTitle:heading?heading.textContent:''};
        document.querySelectorAll('.pagedjs_page').forEach(function(page){Array.from(page.style).filter(function(name){return name.indexOf('--pagedjs-string-')===0}).forEach(function(name){page.style.removeProperty(name)});Object.keys(running).forEach(function(name){page.style.setProperty('--pagedjs-string-first-'+name,JSON.stringify(running[name].replace(/\\s+/g,' ')))})});
        source.remove();document.querySelector('.load-state').remove();${fitPages}
        document.body.dataset.paginationState='ready';document.body.dataset.pageCount=String(flow.total);
        var html='';if(config.token){var copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script').forEach(function(s){s.remove()});var styles=copy.querySelectorAll('style');document.querySelectorAll('style').forEach(function(s,i){if(s.sheet)styles[i].textContent=Array.from(s.sheet.cssRules).map(function(rule){return rule.cssText}).join('\\n').replace(/<\\/style/gi,'<\\\\/style')});html='<!doctype html>'+copy.outerHTML}
        report({state:'ready',pages:flow.total,html:html});
      }catch(error){if(previewer)previewer.chunker.stop();document.querySelector('.pages').replaceChildren();document.body.dataset.paginationState='error';var status=document.querySelector('.load-state');if(status)status.textContent=config.error;console.error('Quotation pagination failed',phase,error);report({state:'error',phase:phase,imageIndex:imageIndex,message:config.error})}
    })();</script></body></html>`;
}

export function paginateQuotationForExport(html: string, token: string): Promise<{ html: string; pages: number }> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Paged.js needs animation frames: an offscreen/hidden iframe can be throttled indefinitely.
    frame.style.cssText = 'position:fixed;left:0;top:0;width:1532px;height:2200px;border:0;opacity:0;pointer-events:none;z-index:-1';
    const clean = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'quotation-pagination' || event.data.token !== token) return;
      if (event.data.state !== 'ready' && event.data.state !== 'error') return;
      clean();
      if (event.data.state !== 'ready' || !event.data.html || !event.data.pages) reject(new Error('文档分页失败，请检查图片和内容后重试'));
      else resolve({ html: event.data.html.replace('</body>', `<script>${fitPages}</script></body>`), pages: event.data.pages });
    };
    const timer = setTimeout(() => { clean(); reject(new Error('分页超时，请减少本次导出的图片或产品数量')); }, 150000);
    window.addEventListener('message', receive);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
