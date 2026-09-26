const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), deps = createRequire(path.join(root, 'frontend/package.json'));
const { parse, compileScript } = deps('vue/compiler-sfc');
const ts = deps('typescript');
const fresh = (language = 'zh-CN') => ({ version: 1, language, title: `Catalogue ${language}`, items: [], subtitle: '', notes: '' });
const typographyDefaults = { bodyFontSize:11, headingFontSize:16, lineHeight:1.6, paragraphSpacing:6, tableFontSize:10.5, tableDensity:'standard', tableStyle:'web' };
function setup({ saveFails = false, readFails = false, profileFails = false, cached = null, refreshFails = false } = {}) {
  const calls = [], errors = [], saved = [], hooks = [], timers = new Map(), storage = [];
  let timerId = 0;
  const vue = { defineComponent: value => value, ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }), watch() {}, onMounted(fn) {hooks.push(fn);}, onBeforeUnmount() {}, nextTick: async () => {} };
  const mocks = {
    vue, 'vue-router': { onBeforeRouteLeave() {} },
    'element-plus': { ElMessage: { error: e => errors.push(e), success() {}, warning: e => errors.push(e) }, ElMessageBox: { confirm: async () => {} } },
    '@element-plus/icons-vue': {}, '@/components/layout/ToolNav.vue': {}, '@/components/ThumbnailUpload.vue': {}, './BrochureDetailEditor.vue': {},
    '@/composables/useAvailableLanguages': { useAvailableLanguages: () => vue.ref([{code:'zh-CN'}, {code:'en'}]) },
    '@/utils/menuLanguage': { findEquivalentMenuForLang: (menus, id, language, model) => { assert.equal(model,'3'); return {name:`Column ${language}`}; } },
    '@/utils/brochure-language': { brochureLanguages: [], brochureLanguageName: value => value, brochureTranslationState: () => ({}), isBrochureLanguage: value => ['zh-CN','en'].includes(value), exactBrochureProduct: (p,lang) => ({...p,lang}) },
    '@/api/products': { getProductList: async (_id, language) => { calls.push(['list',language]); return {data:[]}; }, getProductById: async (id,language) => { calls.push(['product',id,language]); if(readFails) throw Error('read failed'); return {data:{id,menuId:3,title:`Product ${language}`,content:`<p>${language} content</p>`,images:[]}}; } },
    '@/api/menus': { getAll: async () => ({data:[]}) }, '@/api/sites': {getCurrentSiteProfile: async()=>{if(profileFails)throw Error('timeout');return {data:{companyName:'Company'}};}}, '@/api/uploads': {},
    '@/api/brochures': { saveBrochure: async (data,id) => { if(saveFails) throw Error('save failed'); saved.push(JSON.parse(JSON.stringify(data))); return {data:{id:id||12}}; }, getBrochures: async (...args) => {calls.push(['library',...args]);return{data:[]};} },
    '@/utils/brochure-pagination': {},
    '@/utils/brochure-layout': { brochureLayout: d=>({pageWidthMm:210,pageHeightMm:297,pageMarginMm:13,fontFamily:'sans',...d}), brochureLayoutDefaults:{pageWidthMm:210,pageHeightMm:297,pageMarginMm:13,fontFamily:'sans'}, brochureLayoutRanges:{pageWidthMm:[100,420],pageHeightMm:[100,600],pageMarginMm:[8,30]}, brochureFonts:{} },
    '@/utils/brochure': { brochureTypography:d=>({...typographyDefaults,...d}), brochureTypographyDefaults:typographyDefaults, brochureTypographyRanges:{bodyFontSize:[9,16],headingFontSize:[12,24],lineHeight:[1.2,2.2],paragraphSpacing:[0,16],tableFontSize:[8,14]}, newBrochure:fresh, newBrochureProduct:()=>({id:'custom',images:[],productId:0}), brochureWarnings:()=>[], cloneBrochure:v=>JSON.parse(JSON.stringify(v)), validateBrochure() {}, productToBrochure:(p,category)=>({...p,productId:p.id,detailsHtml:p.content,category}) },
    '@/utils/request': { getErrorMessage: e=>e.message }, '@/utils/siteSelection': { getActiveSiteId:()=>1 },
    '@/stores/sites': { useSitesStore:()=>({activeSite:{id:1},refresh:async()=>{if(refreshFails)throw Error('refresh failed');}}) },
  };
  Object.assign(mocks['@/utils/brochure'], {isBrochureDraft: d=>!!d?.items,previewBrochure:d=>d,brochureHtml:()=>'<html>preview</html>'});
  const {descriptor}=parse(fs.readFileSync(path.join(root,'frontend/src/views/brochures/BrochureTool.vue'),'utf8'));
  const source=compileScript(descriptor,{id:'brochure-test'}).content;
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in mocks))throw Error(name);return mocks[name];},window:{innerWidth:1500,addEventListener(){}},localStorage:{getItem:()=>cached,setItem:(key,value)=>storage.push([key,value])},setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);}});
  const state=module.exports.default.setup({}, {expose(){}}); state.initializing.value=false;
  return {state,calls,saved,errors,storage,mount:()=>hooks[0](),tick:ms=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
test('import reads selected language, imports full field and does not write a product',async()=>{
  const {state,calls}=setup(); state.draft.value.language='en'; state.importSelection.value=[{id:5}];
  await state.importProducts();
  assert.deepEqual(calls,[['product',5,'en']]); assert.equal(state.draft.value.items[0].detailsHtml,'<p>en content</p>');
  assert.equal(state.draft.value.items[0].category,'Column en');
});
test('changing language saves original then creates an independent draft',async()=>{
  const {state,saved}=setup(); const image={src:'/custom.jpg',caption:'中文'};
  state.draft.value.items=[{id:'source',productId:5,title:'中文',detailsHtml:'<p>原文</p>',images:[image]}]; state.currentId.value=8;
  state.draft.value.bodyFontSize=14; state.draft.value.tableStyle='minimal';
  await state.changeLanguage('en');
  assert.equal(saved[0].language,'zh-CN'); assert.equal(saved[0].items[0].detailsHtml,'<p>原文</p>');
  assert.equal(state.currentId.value,undefined); assert.equal(state.draft.value.language,'en');
  assert.equal(state.draft.value.items[0].detailsHtml,'<p>en content</p>'); assert.equal(state.draft.value.items[0].images[0].src,image.src);
  assert.equal(state.draft.value.items[0].images[0].caption,'');
  assert.equal(saved[0].bodyFontSize,14); assert.equal(state.draft.value.bodyFontSize,14); assert.equal(state.draft.value.tableStyle,'minimal');
});

test('typography controls recover cleared input, clamp limits and reset only layout',()=>{
  const {state}=setup(); state.draft.value.items=[{title:'Keep',detailsHtml:'<p>Original</p>'}];
  state.setTypographyNumber('bodyFontSize',13.5); assert.equal(state.draft.value.bodyFontSize,13.5);
  state.setTypographyNumber('lineHeight',99); assert.equal(state.draft.value.lineHeight,2.2);
  state.setTypographyNumber('bodyFontSize',undefined); assert.equal(state.draft.value.bodyFontSize,11);
  state.setTypographyNumber('tableFontSize',NaN); assert.equal(state.draft.value.tableFontSize,10.5);
  state.resetTypography();
  for(const [key,value] of Object.entries(typographyDefaults)) assert.equal(state.draft.value[key],value);
  assert.equal(state.draft.value.items[0].detailsHtml,'<p>Original</p>');
  state.exporting.value=true; state.setTypographyNumber('bodyFontSize',15); assert.equal(state.draft.value.bodyFontSize,11);
});
test('failed save or translation read keeps the current draft intact',async()=>{
  for (const options of [{saveFails:true},{readFails:true}]) {
    const {state}=setup(options); state.currentId.value=8; state.draft.value.items=[{productId:5,title:'Original',images:[]}];
    const before=JSON.stringify(state.draft.value); await state.changeLanguage('en');
    assert.equal(JSON.stringify(state.draft.value),before); assert.equal(state.currentId.value,8);
  }
});

test('page settings persist across language changes and handle bounds and presets',async()=>{
  const {state,saved}=setup();state.draft.value.items=[{productId:5,title:'Keep',images:[]}];
  state.setPageNumber('pageWidthMm',250);state.setPageNumber('pageHeightMm',400);state.draft.value.fontFamily='serif';
  await state.changeLanguage('en');
  assert.equal(state.draft.value.pageWidthMm,250);assert.equal(saved[0].pageHeightMm,400);assert.equal(state.draft.value.fontFamily,'serif');
  state.setPageNumber('pageWidthMm',Infinity);assert.equal(state.draft.value.pageWidthMm,210);
  state.setPageNumber('pageMarginMm',99);assert.equal(state.draft.value.pageMarginMm,30);
  state.setPagePreset('landscape');assert.equal(state.draft.value.pageWidthMm,297);assert.equal(state.draft.value.pageHeightMm,210);
  assert.equal(state.draft.value.items[0].title,'Product en');
});
test('disabled languages cannot be selected and library uses language filter',async()=>{
  const {state,calls}=setup(); await state.changeLanguage('ar'); assert.equal(state.draft.value.language,'zh-CN');
  state.libraryLanguage.value='en'; await state.loadLibrary(); assert.deepEqual(calls,[['library','','en']]);
});

test('profile timeout restores draft first and never replaces it with defaults',async()=>{
  const draft={...fresh('en'),title:'My unsaved draft',items:[{id:'p',title:'Keep original'}]};
  const {state,mount,storage}=setup({profileFails:true,cached:JSON.stringify({draft,id:3,baseline:'saved'})});
  await mount(); state.persist();
  assert.equal(state.draft.value.title,draft.title);assert.equal(state.currentId.value,3);
  assert.equal(JSON.parse(storage[0][1]).draft.title,draft.title);
});

test('failed initialization or corrupt cache cannot overwrite the stored draft',async()=>{
  for(const options of [{refreshFails:true},{cached:'invalid json'},{cached:'{"draft":null}'}]){
    const {mount,state,storage}=setup(options);await mount();state.persist();assert.equal(storage.length,0);
  }
});

test('preview progress, generation isolation, timeout and retry preserve draft',()=>{
  const {state,tick}=setup();const before=JSON.stringify(state.draft.value),source={};
  state.previewFrame.value={contentWindow:source};state.refreshPreview();tick(600);
  const generation=state.previewGeneration.value;
  const message=(data)=>state.previewMessage({source,data:{type:'brochure-pagination',previewId:generation,...data}});
  message({state:'progress',phase:'images',done:1,total:4,retry:1});assert.equal(state.previewStatus.value,'加载图片 1/4 · 重试中');
  message({state:'ready',pages:99,previewId:generation-1});assert.equal(state.previewPages.value,0);
  tick(150000);assert.equal(state.previewFailed.value,true);
  message({state:'ready',pages:99});assert.equal(state.previewPages.value,0);
  state.refreshPreview();tick(600);assert.equal(state.previewFailed.value,false);
  message({state:'ready',pages:4,previewId:state.previewGeneration.value});tick(150000);
  assert.equal(state.previewPages.value,4);assert.equal(state.previewFailed.value,false);
  state.view.value='edit';state.refreshPreview();tick(600);assert.equal(state.previewHtml.value,'');
  assert.equal(JSON.stringify(state.draft.value),before);
});

test('generic request timeout never claims translation or server cancellation',()=>{
  const source=fs.readFileSync(path.join(root,'frontend/src/utils/request.ts'),'utf8');
  const fn=source.slice(source.indexOf('export const getErrorMessage'),source.indexOf('request.interceptors.request'));
  const code=ts.transpileModule(fn,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,axios:{isAxiosError:e=>e.axios},Error});
  for(const code of ['ECONNABORTED','ETIMEDOUT']){
    const text=exports.getErrorMessage({axios:true,code,message:'timeout'});
    assert.match(text,/请求超时/);assert.doesNotMatch(text,/翻译|已停止|断点/);
  }
  assert.equal(exports.getErrorMessage(new Error('Specific PDF error')),'Specific PDF error');
});
