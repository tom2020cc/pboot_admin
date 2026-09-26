const test = require('node:test');
const assert = require('node:assert/strict');
const { chinesePages, createBaiduApi, siteOrigin } = require('./baidu-api');
const site = 'https://cn.example.com';
const urls = [site + '/', site + '/product.html'];
const response = (data, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(data) });

test('CN scope excludes all other languages and refuses a shared language host', () => {
  assert.deepEqual(chinesePages({urls:[{lang:'cn',url:urls[0]},{lang:'en',url:'https://example.com/'}]}), {site,urls:[urls[0]]});
  assert.throws(() => chinesePages({urls:[{lang:'cn',url:urls[0]},{lang:'en',url:urls[1]}]}), /共用域名/);
  assert.throws(() => chinesePages({urls:[]}), /唯一/);
  assert.deepEqual(chinesePages({urls:[{lang:'cn',url:urls[1]}]}).urls,urls);
});

test('submission service persists confirmed success, skips repeats and blocks batch after failure', async () => {
  const vm = require('vm');
  const source = require('fs').readFileSync(require.resolve('./server.js'),'utf8');
  const code = source.slice(source.indexOf('async function getBaiduContext()'),source.indexOf('// 国内搜索引擎站长平台入口'));
  const files = new Map();
  let calls = 0;
  let succeed = true;
  const cfg = {baidu:{site,token:'secret',enabled:true}};
  const serviceUrls = [...urls,site+'/second.html'];
  const context = vm.createContext({
    baiduApi:{...require('./baidu-api'),readHistory:file=>files.has(file)?JSON.parse(files.get(file)):{accepted:{},lastResult:null}},
    inspectSite:async()=>({urls:serviceUrls.map(url=>({lang:'cn',url}))}),readConfig:()=>cfg,
    siteRuntime:{siteFile:()=>'/test/history.json'}, path:require('path'),TOOL_ROOT:'/test',
    baiduLocks:new Set(),Date,
    pushBaidu:async()=>{calls++;return {ok:succeed,success:succeed?1:0,message:succeed?'accepted':'site init fail'};},
    writeJson:(file,data)=>files.set(file,JSON.stringify(data)),fs:{renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);}},
  });
  vm.runInContext(code,context);
  await assert.rejects(context.submitBaiduUrls(['https://en.example.com/']),/清单以外/);
  assert.equal(calls,0);
  await context.submitBaiduUrls([urls[0]]);
  await context.submitBaiduUrls([urls[0]]);
  assert.equal(calls,1);
  const status=await context.getBaiduStatus();
  assert.equal('token' in status,false); assert.equal(status.accepted,1);
  succeed=false;
  await context.submitBaiduUrls([urls[1]]);
  assert.equal((await context.getBaiduStatus()).accepted,1);
  await assert.rejects(context.submitBaiduUrls(serviceUrls.slice(1)),/上次提交未成功/);
  assert.equal(calls,2);
  // A failed batch may be retried with only the homepage, even if it was accepted earlier.
  succeed=true;
  await context.submitBaiduUrls([urls[0]],{test:true});
  assert.equal(calls,3);
  await assert.rejects(context.submitBaiduUrls([urls[1]],{test:true}),/首页/);
});
test('reject cross-site, credentials, fragments and oversized requests before network', async () => {
  let calls=0;
  const push=createBaiduApi(async()=>{ calls++; });
  for(const list of [[...urls,'https://example.com/'],[site+'/#x'],['https://u:p@cn.example.com/'],Array.from({length:101},(_,i)=>site+'/'+i)]) {
    await assert.rejects(push({site,token:'secret',urls:list}));
  }
  assert.equal(calls,0);
  assert.throws(()=>siteOrigin(site+'/page'), /协议和域名/);
});
test('deduplicates input and returns real success and remaining quota', async () => {
  const push=createBaiduApi(async (endpoint,options)=>{
    assert.equal(new URL(endpoint).searchParams.get('site'),site);
    assert.equal(options.body,urls.join('\n'));
    assert.equal(options.redirect,'error');
    return response({success:2,remain:98});
  });
  const result=await push({site,token:'secret',urls:[...urls,urls[0]]});
  assert.equal(result.ok,true); assert.equal(result.remain,98); assert.equal(result.submitted,2);
});
test('platform error never says success and redacts token',async()=>{
  const result=await createBaiduApi(async()=>response({error:401,message:'token=secret invalid'},401))({site,token:'secret',urls});
  assert.equal(result.ok,false); assert.doesNotMatch(result.message,/secret|NaN/); assert.match(result.message,/401/);
});
test('partial, malformed and network responses cannot become complete success',async()=>{
  for(const data of [{success:1,remain:0},{success:'2'},{success:2,error:400},{success:2,not_valid:[urls[0]]},{}]) {
    const result=await createBaiduApi(async()=>response(data))({site,token:'secret',urls});
    assert.equal(result.ok,false);
    assert.doesNotMatch(result.message,/NaN/);
  }
  await assert.rejects(createBaiduApi(async()=>{throw new Error('secret');})({site,token:'secret',urls}),error=> !error.message.includes('secret'));
});
