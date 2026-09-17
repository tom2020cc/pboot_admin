const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname,'..'), deps = createRequire(path.join(root,'frontend/package.json'));
const {parse,compileScript} = deps('vue/compiler-sfc'), ts = deps('typescript');
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => ({version:1,language:'zh-CN',quotationNo:'BJ-20260913-01',quotationDate:'2026-09-13',title:'工程机械商业报价单',companyName:'ACME',companySubtitle:'',logoUrl:'',website:'',assetBaseUrl:'',customerCompany:'Client',customerContact:'Sam',salesName:'Jane',salesDepartment:'custom dept',salesPosition:'Engineer',phone:'',whatsapp:'',wechat:'',email:'',productCategory:'工程机械设备',customized:'否',originCountry:'中国',validityDays:8,currency:'USD',incoterm:'FOB',warranty:'12个月',paymentTerms:'Custom terms 25% + 75%',depositPercent:25,loadingPort:'Qingdao',destinationPort:'Lima',transportMode:'海运',freight:333.35,notes:'Custom guarantee',items:[]});
const line = () => ({id:'line1',productId:5,title:'原文',categoryName:'岩芯',quantity:3,unit:'台',unitPrice:12000.25,specText:'自定义参数: 500',remark:'Custom remark',image:'/custom.jpg',images:['/custom.jpg']});
const languages = ['zh-CN','en','es','fr','ru','ar','pt','id','vi','tr'];
function evaluate(source,mocks,globals={}) { const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>{if(!(name in mocks))throw Error(name);return mocks[name];},...globals});return module.exports; }
const language = evaluate(fs.readFileSync(path.join(root,'frontend/src/utils/quotation-language.ts'),'utf8'),{'@/api/news':{NEWS_LANGUAGES:languages.map(code=>({code,name:code}))}});
function setup({saveFails=false,readFails=false,numberFails=false,cached=null,profileFails=false}={}) {
  const calls=[],saved=[],hooks=[],storage=[],messages=[],vue={defineComponent:v=>v,reactive:v=>v,ref:value=>({value}),computed:fn=>({get value(){return fn();}}),watch(){},onMounted:fn=>hooks.push(fn),onBeforeUnmount(){}};
  const sum=d=>d.items.reduce((n,i)=>n+i.quantity*i.unitPrice,0)+d.freight;
  let selectedSite=1;
  const mocks={vue,'vue-router':{onBeforeRouteLeave(){}},'element-plus':{ElMessage:{success(){},warning:msg=>messages.push(msg)},ElMessageBox:{confirm:async()=>{}}},'@element-plus/icons-vue':{},'@/api/uploads':{},'@/utils/request':{getErrorMessage:(e,f)=>e.message||f},'@/utils/siteSelection':{getActiveSiteId:()=>selectedSite},'@/components/QuotationDocumentPreview.vue':{},'@/components/QuotationLayoutSettings.vue':{},'@/utils/quotation-layout':{quotationPaperLabel:()=>''},'@/utils/quotation-pagination':{},'@/utils/quotation-language':{...language,exactQuotationProduct:p=>p},'@/utils/menuLanguage':{findEquivalentMenuForLang:(_m,_id,lang)=>({name:'Category '+lang})},'@/composables/useAvailableLanguages':{useAvailableLanguages:()=>vue.ref(languages.map(code=>({code,name:code})))},'@/api/menus':{getAll:async()=>({data:[]})},'@/api/sites':{getCurrentSiteProfile:async()=>{if(profileFails)throw Error('profile failed');return {data:{companyName:'Site One'}};}},
    '@/api/products':{getProductList:async(_id,lang)=>{calls.push(['list',lang]);return {data:[]};},getProductById:async(id,lang)=>{calls.push(['product',id,lang]);if(readFails)throw Error('translation missing');return {data:{id,title:'Product '+lang,content:lang,menuId:9}};}},
    '@/api/quotations':{getQuotationList:async()=>({data:[]}),getNextQuotationNumber:async()=>{if(numberFails)throw Error('number failed');return {data:{quotationNo:'BJ-20260913-02'}};},createQuotation:async payload=>{if(saveFails)throw Error('save failed');saved.push(clone(payload));return {data:{id:12}};},updateQuotation:async(id,payload)=>{if(saveFails)throw Error('save failed');saved.push(clone(payload));return {data:{id}};},getQuotationById:async id=>({data:{id,data:{...fresh(),language:'fr',items:[line()]}}})},
    '@/utils/quotation':{createDefaultQuotation:fresh,normalizeQuotation:d=>({...fresh(),...clone(d),language:language.quotationLanguage(d.language)}),validateQuotation:()=>{},quotationTotal:sum,quotationSubtotal:d=>sum(d)-d.freight,createQuotationLine:(p,categoryName,_currency,lang)=>({...line(),productId:p.id,title:p.title,categoryName,specText:'Specs '+lang}),buildQuotationHtml:()=>'',formatMoney:()=>'',parseSpecificationText:()=>[]},
  };
  const {descriptor}=parse(fs.readFileSync(path.join(root,'frontend/src/views/quotations/QuotationBuilder.vue'),'utf8'));
  const module=evaluate(compileScript(descriptor,{id:'quote-test'}).content,mocks,{localStorage:{getItem:key=>key.includes('current-id')?'8':cached,setItem:(...args)=>storage.push(args),removeItem:key=>storage.push([key,null])}});
  const state=module.default.setup({}, {expose(){}});state.initializing.value=false;
  return {state,calls,saved,storage,messages,mount:()=>hooks[0](),switchSite:()=>selectedSite=2};
}
test('all ten languages preserve financial and customer fields while replacing product text',()=>{
  const original={...fresh(),items:[line()]};
  for(const lang of languages){
    const result=language.quotationLanguageDraft(original,lang,[{...line(),title:'New '+lang,specText:'New specs',categoryName:'Category'}]);
    for(const key of ['currency','freight','depositPercent','customerCompany','customerContact','incoterm','paymentTerms','loadingPort','destinationPort','notes','companyName'])assert.equal(result[key],original[key]);
    for(const key of ['id','quantity','unitPrice','images','remark'])assert.deepEqual(clone(result.items[0][key]),original.items[0][key]);
    assert.equal(result.language,lang);assert.equal(result.items[0].title,'New '+lang);
    assert.equal(result.title,language.quotationDefaults(lang).title);
  }
  assert.equal(original.items[0].title,'原文');
});
test('switch saves original and creates independent language draft with a fresh number',async()=>{
  const {state,saved,calls}=setup();state.quote.items=[line()];state.currentQuotationId.value=8;
  await state.changeLanguage('en');assert.equal(saved[0].data.language,'zh-CN');assert.equal(saved[0].data.items[0].specText,'自定义参数: 500');
  assert.equal(state.currentQuotationId.value,null);assert.equal(state.quote.language,'en');assert.equal(state.quote.quotationNo,'BJ-20260913-02');assert.equal(state.quote.items[0].unitPrice,12000.25);assert.deepEqual(calls,[['product',5,'en'],['list','en']]);
  await state.saveQuotation();assert.equal(saved[1].data.language,'en');
});
test('failed save, missing translation or number failure cannot replace the original draft',async()=>{
  for(const config of [{saveFails:true},{readFails:true},{numberFails:true}]){const {state}=setup(config);state.quote.items=[line()];state.currentQuotationId.value=8;const before=JSON.stringify(state.quote);await state.changeLanguage('vi');assert.equal(JSON.stringify(state.quote),before);assert.equal(state.currentQuotationId.value,8);assert.ok(state.errorMessage.value);}
});
test('restoring or editing saved foreign quotes does not force Chinese',async()=>{
  const cached=JSON.stringify({...fresh(),language:'tr',items:[line()]});const {state,mount}=setup({cached,profileFails:true});await mount();assert.equal(state.quote.language,'tr');assert.equal(state.quote.companyName,'ACME');
  await state.editSavedQuotation({id:15});assert.equal(state.quote.language,'fr');assert.equal(state.currentQuotationId.value,15);
});
test('corrupt cache is retained, and drafts stay site scoped',async()=>{
  const {state,mount,storage}=setup({cached:'invalid json'});await mount();state.persistDraft();assert.equal(storage.length,0);assert.equal(state.cacheBlocked.value,true);
  const next=setup();next.state.quote.items=[line()];next.state.persistDraft();assert.match(next.storage[0][0],/:site:1$/);
});
test('import is atomic and reads the current product language',async()=>{
  const {state,calls}=setup();state.quote.language='ar';await state.applyProductSelection([5]);assert.equal(state.quote.items[0].specText,'Specs ar');assert.deepEqual(calls,[['product',5,'ar']]);
  const failed=setup({readFails:true});failed.state.quote.items=[line()];await failed.state.applyProductSelection([5,6]);assert.equal(failed.state.quote.items.length,1);assert.equal(failed.state.selectedProductIds.value.length,1);
});
test('disabled/busy language changes and cross-site writes are rejected',async()=>{
  const {state,saved,switchSite}=setup();await state.changeLanguage('de');assert.equal(state.quote.language,'zh-CN');state.exporting.value=true;await state.changeLanguage('en');assert.equal(state.quote.language,'zh-CN');state.exporting.value=false;switchSite();await state.saveQuotation();assert.equal(saved.length,0);assert.match(state.errorMessage.value,/网站已切换/);
});
test('PDF action uses the server renderer and the preview is sandboxed',()=>{
  const source=fs.readFileSync(path.join(root,'frontend/src/views/quotations/QuotationBuilder.vue'),'utf8');assert.match(source,/exportQuotationPdf\(result.html, draft.layout\)/);assert.doesNotMatch(source,/\.print\(|v-html|translateProductDraft/);
  const preview=fs.readFileSync(path.join(root,'frontend/src/components/QuotationDocumentPreview.vue'),'utf8');assert.match(preview,/sandbox="allow-scripts"/);assert.match(preview,/event.source !== frame.value\?\.contentWindow/);assert.match(preview,/150000/);
});

test('quotation layout defaults, limits and styles are independent of product PDF',()=>{
  const source=fs.readFileSync(path.join(root,'frontend/src/utils/quotation-layout.ts'),'utf8');
  const layout=evaluate(source,{});
  assert.deepEqual(clone(layout.quotationLayout()),clone(layout.quotationLayoutDefaults));
  assert.equal(layout.quotationLayout().pageHeight,297);
  assert.equal(layout.quotationLayout().pageMode,'continuous');
  assert.equal(layout.quotationLayout({pageHeight:400}).pageMode,'continuous');
  assert.equal(layout.quotationLayout({pageMode:'paged'}).pageMode,'paged');
  assert.match(layout.quotationPaperLabel({pageHeight:400}),/高度自动/);
  assert.equal(layout.quotationClassicLayout.pageWidth,297);
  assert.equal(layout.quotationClassicLayout.pageHeight,210);
  assert.ok(layout.quotationClassicLayout.cellPadding<2);
  assert.equal(layout.quotationLayout({pageWidth:250,pageHeight:400,tableFontSize:13}).tableFontSize,13);
  assert.equal(layout.quotationLayout({pageHeight:400,tableFontSize:13,lineHeight:1.8}).pageHeight,400);
  for(const pageHeight of [0,179,601,Infinity,NaN,'400',null]) assert.equal(layout.quotationLayout({pageHeight}).pageHeight,297);
  assert.match(layout.quotationLayoutCss({pageWidth:250,pageHeight:420,tableFontSize:13,lineHeight:1.8}),/size: 250mm 420mm/);
  for(const file of ['frontend/src/utils/quotation.ts','frontend/src/utils/quotation-pagination.ts','frontend/src/utils/quotation-assets.ts','frontend/src/utils/quotation-language.ts','frontend/src/api/quotations.ts','frontend/src/views/quotations/QuotationBuilder.vue','backend/src/quotation/quotation-pdf.service.ts']){
    assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/from ['"][^'"]*brochure|exportBrochurePdf/);
  }
});
