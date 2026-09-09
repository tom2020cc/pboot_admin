import pagedPolyfill from '../../node_modules/pagedjs/dist/paged.polyfill.min.js?raw';
import pageCss from './brochure-page.css?raw';

const jsString = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const fitPages = `function fitPages(){var pages=document.querySelector('.pages');var shell=document.querySelector('.document');var page=document.querySelector('.pagedjs_page');if(pages&&shell&&page){pages.style.zoom=String(shell.clientWidth/page.offsetWidth)}}window.addEventListener('resize',fitPages);fitPages();`;
// Rebuild table headers before measuring continued rows, so headers consume page space.
const repeatTableHeaders = `Paged.registerHandlers(class extends Paged.Handler{
  beforePageLayout(page){if(page.position>=150)throw new Error('Too many brochure pages')}
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

export function paginatedBrochureHtml(content: string, title: string, language: string, navigation: string, reportToken = '') {
  const config = { token: reportToken, error: language === 'en' ? 'Pagination failed. Check the images and try again.' : '分页失败，请检查图片后重试。' };
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>${shellCss}</style></head><body>
    ${navigation}<div class="load-state" role="status">${language === 'en' ? 'Preparing pages...' : '正在排版...'}</div><main class="document"><div class="pages"></div></main><div class="document-source" id="brochure-source">${content}</div>
    <script>window.PagedConfig={auto:false};</script><script>${pagedPolyfill.replace(/<\/script/gi, '<\\/script')}</script>
    <script>${repeatTableHeaders}(async function(){var config=${jsString(config)};function report(data){if(parent!==window)parent.postMessage(Object.assign({type:'brochure-pagination',token:config.token},data),'*')}
      try{await Promise.all(Array.from(document.images).map(function(img){return img.decode()}));await document.fonts.ready;
        var source=document.getElementById('brochure-source');var fragment=document.createRange().createContextualFragment(source.innerHTML);
        var flow=await new Paged.Previewer().preview(fragment,[{'brochure.css':${jsString(pageCss)}}],document.querySelector('.pages'));
        var running={company:source.querySelector('.brand strong').textContent,documentTitle:source.querySelector('.doc-heading h1').textContent};
        document.querySelectorAll('.pagedjs_page').forEach(function(page){Array.from(page.style).filter(function(name){return name.indexOf('--pagedjs-string-')===0}).forEach(function(name){page.style.removeProperty(name)});Object.keys(running).forEach(function(name){page.style.setProperty('--pagedjs-string-first-'+name,JSON.stringify(running[name].replace(/\\s+/g,' ')))})});
        source.remove();document.querySelector('.load-state').remove();${fitPages}
        document.body.dataset.paginationState='ready';document.body.dataset.pageCount=String(flow.total);
        var html='';if(config.token){var copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script').forEach(function(s){s.remove()});var styles=copy.querySelectorAll('style');document.querySelectorAll('style').forEach(function(s,i){if(s.sheet)styles[i].textContent=Array.from(s.sheet.cssRules).map(function(rule){return rule.cssText}).join('\\n').replace(/<\\/style/gi,'<\\\\/style')});html='<!doctype html>'+copy.outerHTML}
        report({state:'ready',pages:flow.total,html:html});
      }catch(error){document.body.dataset.paginationState='error';var status=document.querySelector('.load-state');if(status)status.textContent=config.error;console.error('Brochure pagination failed',error);report({state:'error',message:config.error})}
    })();</script></body></html>`;
}

export function paginateForExport(html: string, token: string): Promise<{ html: string; pages: number }> {
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
      clean();
      if (event.data.state !== 'ready' || !event.data.html || !event.data.pages) reject(new Error('产品介绍分页失败，请检查图片和内容后重试'));
      else resolve({ html: event.data.html.replace('</body>', `<script>${fitPages}</script></body>`), pages: event.data.pages });
    };
    const timer = setTimeout(() => { clean(); reject(new Error('分页超时，请减少本次导出的图片或产品数量')); }, 90000);
    window.addEventListener('message', receive);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
