import pagedPolyfill from '../../node_modules/pagedjs/dist/paged.polyfill.min.js?raw';
import pageCss from './brochure-page.css?raw';
import { brochureLabels, type BrochureLanguage } from './brochure-language';
import { removeBrochureImage } from './brochure-detail';

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
  var removeImage=${removeBrochureImage.toString()},skippedSources=new Set();
  var images=Array.from(document.querySelectorAll('#brochure-source img[data-brochure-src]')),groups=new Map(),cursor=0,done=0;
  images.forEach(function(img,index){var src=img.getAttribute('data-brochure-src');if(!groups.has(src))groups.set(src,{src:src,index:index+1,images:[]});groups.get(src).images.push(img)});
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
        catch(error){probe.src='';if(stopped)return;progress(1)}
        finally{activeProbes.delete(probe)}
      }
      if(stopped)return;
      if(!decoded){skippedSources.add(entry.src);entry.images.forEach(removeImage);done++;progress();continue}
      entry.images.forEach(function(img){img.loading='eager';img.src=entry.src;img.removeAttribute('data-brochure-src');if(!img.hasAttribute('width'))img.width=decoded.naturalWidth;if(!img.hasAttribute('height'))img.height=decoded.naturalHeight});
      done++;progress();
    }
  })),60000)}catch(error){/* Omit unfinished images when the overall image budget expires. */}finally{stopped=true;activeProbes.forEach(function(probe){probe.src=''});activeProbes.clear()}
  await Promise.all(images.filter(function(img){return img.isConnected}).map(async function(img){
    var src=img.getAttribute('data-brochure-src')||img.src;
    try{if(img.hasAttribute('data-brochure-src'))throw new Error('not loaded');await bounded(img.decode(),5000)}
    catch(error){skippedSources.add(src);removeImage(img)}
  }));
  document.querySelectorAll('#brochure-source .gallery').forEach(function(gallery){
    var figures=Array.from(gallery.querySelectorAll('figure')).filter(function(figure){return figure.querySelector('img')});gallery.replaceChildren();
    var article=gallery.closest('.product');
    if(figures.length&&article&&!article.querySelector('.main-photo')){var main=figures.shift();main.classList.add('main-photo');article.querySelector('.product-heading').after(main)}
    for(var i=0;i<figures.length;i+=2){var row=document.createElement('div');row.className='gallery-row'+(i+1===figures.length?' gallery-row-single':'');row.append.apply(row,figures.slice(i,i+2));gallery.append(row)}
    if(!figures.length)gallery.remove();
  });
  document.body.dataset.skippedImages=String(skippedSources.size);
`;
// Rebuild table headers before measuring continued rows, so headers consume page space.
const repeatTableHeaders = `Paged.registerHandlers(class extends Paged.Handler{
  beforePageLayout(page){if(page.position>=150)throw new Error('Too many brochure pages')}
  afterPageLayout(element,page,token){
    if(!token||!token.node)return;
    var node=token.node.nodeType===1?token.node:token.node.parentElement;
    var row=node&&node.closest('tr'),group=row&&row.previousElementSibling;
    if(!group||!group.classList.contains('table-group'))return;
    var rendered=element.querySelector('tr[data-ref="'+CSS.escape(group.dataset.ref)+'"]');
    if(!rendered||rendered.nextElementSibling)return;
    if(!this.movedGroups)this.movedGroups=new Set();
    if(this.movedGroups.has(group))return;
    this.movedGroups.add(group);
    // Rewind the source token as well as the rendered row, so the heading is not lost or duplicated.
    token.node=group;token.offset=0;
    var table=rendered.closest('table');rendered.remove();
    if(table&&!table.querySelector('tbody tr'))table.remove();
  }
  renderNode(node,source){
    var element=node.nodeType===1?node:node.parentElement;
    var table=element&&element.closest('table[data-split-from]');
    if(!table||table.querySelector('thead'))return;
    var original=(source.nodeType===1?source:source.parentElement).closest('table');
    if(!original)return;
    var head=original.querySelector('thead');if(!head)return;
    table.insertBefore(head.cloneNode(true),table.firstChild);
    var columns=original.querySelector('colgroup');if(columns&&!table.querySelector('colgroup'))table.insertBefore(columns.cloneNode(true),table.firstChild);
  }
});`;
const shellCss = `html{scroll-behavior:smooth}body{margin:0;background:#e9edf1;color:#263646;font:15px/1.6 Arial,"Microsoft YaHei",sans-serif;letter-spacing:0}.document,.actions{width:1500px;max-width:calc(100% - 32px);margin:24px auto}.actions{display:flex;gap:22px;flex-wrap:wrap}.actions a{color:#384958;text-decoration:none}.pages{width:max-content}.pagedjs_page{background:#fff;margin-bottom:24px;box-shadow:0 2px 12px #26364614}.load-state{padding:40px;text-align:center;color:#667585}.document-source{position:absolute;left:-10000px;top:0;width:184mm;visibility:hidden}.document-source img{max-width:100%}@media print{@page{size:A4;margin:0}body{background:#fff}.actions,.load-state{display:none!important}.document{width:auto;max-width:none;margin:0}.pages{zoom:1!important}.pagedjs_page{box-shadow:none!important;margin:0!important;break-after:page}.pagedjs_page:last-child{break-after:auto}}@media(max-width:600px){.document,.actions{max-width:calc(100% - 16px);margin:12px auto}.actions{gap:12px;font-size:13px}}`;

export type DocumentPaginationOptions = { css?: string; companySelector?: string; titleSelector?: string; orientation?: 'portrait' | 'landscape'; pageWidthMm?: number; pageHeightMm?: number; marginMm?: number };

export function paginatedBrochureHtml(content: string, title: string, language: BrochureLanguage, navigation: string, reportToken = '', previewId = 0, options: DocumentPaginationOptions = {}) {
  const labels = brochureLabels(language);
  let documentShellCss = options.orientation === 'landscape'
    ? shellCss.replace('width:184mm', 'width:271mm').replace('size:A4;margin:0', 'size:A4 landscape;margin:0')
    : shellCss;
  if (options.pageWidthMm && options.pageHeightMm) documentShellCss = shellCss
    .replace('width:184mm', `width:${options.pageWidthMm - 2 * (options.marginMm ?? 13)}mm`)
    .replace('size:A4;margin:0', `size:${options.pageWidthMm}mm ${options.pageHeightMm}mm;margin:0`);
  const config = { token: reportToken, previewId, error: labels.error, companySelector: options.companySelector || '.brand strong', titleSelector: options.titleSelector || '.doc-heading h1' };
  // Keep source images inert until a bounded loader can schedule and retry them.
  const source = new DOMParser().parseFromString(content, 'text/html');
  source.querySelectorAll('img[src]').forEach(img => { img.setAttribute('data-brochure-src', img.getAttribute('src')!); img.removeAttribute('src'); });
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${documentShellCss}</style></head><body>
    ${navigation}<div class="load-state" role="status">${labels.preparing}</div><main class="document"><div class="pages"></div></main><div class="document-source" id="brochure-source">${source.body.innerHTML}</div>
    <script>window.PagedConfig={auto:false};${paginationScheduler}</script><script>${pagedPolyfill.replace(/<\/script/gi, '<\\/script')}</script>
    <script>(async function(){var config=${jsString(config)},phase='images',imageIndex=0,previewer;
      function report(data){if(parent!==window)parent.postMessage(Object.assign({type:'brochure-pagination',token:config.token,previewId:config.previewId},data),'*')}
      function bounded(task,ms){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('timeout'))},ms);Promise.resolve(task).then(function(value){clearTimeout(timer);resolve(value)},function(error){clearTimeout(timer);reject(error)})})}
      try{
        report({state:'progress',phase:phase});
        ${loadImages}
        phase='fonts';report({state:'progress',phase:phase});await bounded(document.fonts.ready,15000);
        phase='layout';report({state:'progress',phase:phase});${repeatTableHeaders}
        var source=document.getElementById('brochure-source');var fragment=document.createRange().createContextualFragment(source.innerHTML);
        previewer=new Paged.Previewer();var flow=await bounded(previewer.preview(fragment,[{'document.css':${jsString(options.css || pageCss)}}],document.querySelector('.pages')),60000);
        var company=source.querySelector(config.companySelector),heading=source.querySelector(config.titleSelector);
        var running={company:company?company.textContent:'',documentTitle:heading?heading.textContent:''};
        document.querySelectorAll('.pagedjs_page').forEach(function(page){Array.from(page.style).filter(function(name){return name.indexOf('--pagedjs-string-')===0}).forEach(function(name){page.style.removeProperty(name)});Object.keys(running).forEach(function(name){page.style.setProperty('--pagedjs-string-first-'+name,JSON.stringify(running[name].replace(/\\s+/g,' ')))})});
        source.remove();document.querySelector('.load-state').remove();${fitPages}
        document.body.dataset.paginationState='ready';document.body.dataset.pageCount=String(flow.total);
        var html='';if(config.token){var copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script').forEach(function(s){s.remove()});var styles=copy.querySelectorAll('style');document.querySelectorAll('style').forEach(function(s,i){if(s.sheet)styles[i].textContent=Array.from(s.sheet.cssRules).map(function(rule){return rule.cssText}).join('\\n').replace(/<\\/style/gi,'<\\\\/style')});html='<!doctype html>'+copy.outerHTML}
        report({state:'ready',pages:flow.total,html:html,skippedImages:skippedSources.size});
      }catch(error){if(previewer)previewer.chunker.stop();document.querySelector('.pages').replaceChildren();document.body.dataset.paginationState='error';var status=document.querySelector('.load-state');if(status)status.textContent=config.error;console.error('Brochure pagination failed',phase,error);report({state:'error',phase:phase,imageIndex:imageIndex,message:config.error})}
    })();</script></body></html>`;
}

class RecoverablePaginationError extends Error {}

export async function paginateForExport(html: string, token: string): Promise<{ html: string; pages: number; skippedImages: number }> {
  try { return await paginateExportAttempt(html, token); }
  catch (error) {
    if (!(error instanceof RecoverablePaginationError)) throw error;
    // Retry transient layout/font failures in a fresh frame without refetching images or changing the draft.
    return paginateExportAttempt(html, token);
  }
}

function paginateExportAttempt(html: string, token: string): Promise<{ html: string; pages: number; skippedImages: number }> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Paged.js needs animation frames: an offscreen/hidden iframe can be throttled indefinitely.
    frame.style.cssText = 'position:fixed;left:0;top:0;width:1532px;height:2200px;border:0;opacity:0;pointer-events:none;z-index:-1';
    const clean = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'brochure-pagination' || event.data.token !== token) return;
      if (event.data.state !== 'ready' && event.data.state !== 'error') return;
      clean();
      if (event.data.state !== 'ready' || !event.data.html || !event.data.pages) {
        const ErrorType = ['layout', 'fonts'].includes(event.data.phase) ? RecoverablePaginationError : Error;
        reject(new ErrorType('文档分页失败，请检查图片和内容后重试'));
      }
      else resolve({ html: event.data.html.replace('</body>', `<script>${fitPages}</script></body>`), pages: event.data.pages, skippedImages: Number(event.data.skippedImages) || 0 });
    };
    const timer = setTimeout(() => { clean(); reject(new Error('分页超时，请减少本次导出的图片或产品数量')); }, 150000);
    window.addEventListener('message', receive);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
