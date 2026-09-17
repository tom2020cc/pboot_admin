import { quotationLayout } from './quotation-layout';
import { quotationImageLoader, type QuotationPaginationOptions } from './quotation-pagination';
import type { QuotationLanguageCode } from './quotation';

const js = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const continuousCss = `
  html,body{margin:0;background:#e9edf1}
  *{box-sizing:border-box}
  .continuous-viewport{margin:12px;min-width:0}
  .q-continuous-sheet{background:#fff;box-shadow:0 2px 12px #26364614;overflow:hidden}
  .load-state{padding:40px;text-align:center;color:#667585;font:14px Arial,sans-serif}
  .q-continuous-sheet .quotation-document{width:100%;margin:0;padding:0;border:0;box-shadow:none}
  .q-continuous-sheet .q-product-grid{align-items:stretch;min-height:55mm;break-inside:auto}
  .q-continuous-sheet .q-product-photo{display:grid;align-content:center}
  .q-continuous-sheet .q-product-specs{display:flex}
  .q-continuous-sheet .q-specs{height:100%}
  .q-continuous-sheet .q-specs thead,.q-continuous-sheet .q-spec-group{height:8mm}
  .q-continuous-sheet .q-product-price{display:grid;grid-template-rows:auto minmax(0,1fr)}
  .q-continuous-sheet .q-price-values{min-height:0}
  .q-continuous-sheet .q-price-values strong{border-color:var(--q-line)}
  .q-continuous-sheet .q-photo-gallery img{max-height:none}
  .q-continuous-sheet .q-photo-count-3 img:first-child{max-height:none}
  @media print{
    html,body{margin:0!important;background:#fff}
    .continuous-viewport{margin:0!important}
    .q-continuous-sheet{zoom:1!important;box-shadow:none}
    .q-continuous-sheet,.q-continuous-sheet *{break-before:auto!important;break-after:auto!important;break-inside:auto!important}
    .q-specs thead{display:table-row-group}
    .load-state{display:none}
  }`;

// The quotation is one continuous sheet. Only its width is fixed; content determines height.
export function continuousQuotationHtml(content: string, title: string, language: QuotationLanguageCode, token: string, options: QuotationPaginationOptions) {
  const paper = quotationLayout(options.layout);
  const source = new DOMParser().parseFromString(content, 'text/html');
  source.querySelectorAll('img[src]').forEach(img => {
    img.setAttribute('data-quotation-src', img.getAttribute('src')!); img.removeAttribute('src');
  });
  const error = language === 'zh-CN' ? '报价单排版失败，请检查图片后重试。' : 'Quotation layout failed. Check images and retry.';
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title>
    <style>${options.css}${continuousCss}
      .q-continuous-sheet{width:${paper.pageWidth}mm;padding:${paper.margin}mm}
      @page{size:auto;margin:0;@top-left{content:none}@bottom-left{content:none}@bottom-right{content:none}}
    </style></head><body>
    <div class="load-state" role="status">${language === 'zh-CN' ? '正在生成连续报价单...' : 'Preparing quotation...'}</div>
    <div class="continuous-viewport" style="position:absolute;left:-10000px;visibility:hidden"><div class="q-continuous-sheet" id="quotation-source">${source.body.innerHTML}</div></div>
    <script>(async function(){
      var config={token:${js(token)}},phase='images',imageIndex=0;
      function report(data){if(parent!==window)parent.postMessage(Object.assign({type:'quotation-pagination',token:config.token},data),'*')}
      function bounded(task,ms){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('timeout'))},ms);Promise.resolve(task).then(function(value){clearTimeout(timer);resolve(value)},function(error){clearTimeout(timer);reject(error)})})}
      try{
        ${quotationImageLoader}
        phase='fonts';report({state:'progress',phase:phase});await bounded(document.fonts.ready,15000);
        phase='layout';report({state:'progress',phase:phase});
        var viewport=document.querySelector('.continuous-viewport'),sheet=document.querySelector('.q-continuous-sheet');
        viewport.removeAttribute('style');
        var heightMm=Math.ceil((sheet.scrollHeight*25.4/96+1)*10)/10;
        var printStyle=document.createElement('style');printStyle.textContent='@page{size:${paper.pageWidth}mm '+heightMm+'mm;margin:0}';document.head.appendChild(printStyle);
        document.querySelector('.load-state').remove();sheet.removeAttribute('id');
        document.body.dataset.paginationState='ready';document.body.dataset.pageCount='1';
        document.body.dataset.quotationHeight=String(heightMm);
        var copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script').forEach(function(node){node.remove()});
        var html='<!doctype html>'+copy.outerHTML;
        function fit(){sheet.style.zoom=String(Math.min(1,viewport.clientWidth/sheet.offsetWidth))}
        window.addEventListener('resize',fit);fit();
        report({state:'ready',pages:1,continuous:true,heightMm:heightMm,html:html});
      }catch(error){document.body.dataset.paginationState='error';var status=document.querySelector('.load-state');if(status)status.textContent=${js(error)};report({state:'error',phase:phase,imageIndex:imageIndex,message:${js(error)}})}
    })();</script></body></html>`;
}
