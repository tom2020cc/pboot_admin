const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const deps = createRequire(path.join(root, 'frontend/package.json'));
const ts = deps('typescript');
const { parse, compileScript } = deps('vue/compiler-sfc');
const vue = { defineComponent: options => options, ref: value => ({ value }), computed: read => ({ get value() { return read(); } }), onMounted() {} };

function evaluate(source, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  } });
  return module.exports;
}

function dashboard({ activeSite, failNews = false }) {
  const calls = [], errors = [];
  const request = (name, data) => async () => { calls.push(name); return { data }; };
  const { descriptor } = parse(fs.readFileSync(path.join(root, 'frontend/src/views/IndexView.vue'), 'utf8'));
  const script = compileScript(descriptor, { id: 'fresh-install-dashboard' });
  const component = evaluate(script.content, {
    vue,
    'element-plus': { ElMessage: { error: message => errors.push(message) } },
    '@/stores/sites': { useSitesStore: () => ({ activeSite, refresh: async () => {} }) },
    '@/api/users': { getUsers: request('users', [{ id: 1 }]), getInfo: request('profile', { email: 'admin@example.com' }) },
    '@/api/menus': { getAll: request('menus', [{ id: 2 }]) },
    '@/api/news': { getNewsList: failNews ? async () => { throw new Error('news unavailable'); } : request('news', []) },
    '@/api/products': { getProductList: request('products', [{ id: 3 }]) },
    '@/api/databaseBackups': {
      getCurrentDatabaseInfo: request('database', { healthy: true, counts: {} }),
      getDatabaseBackups: request('backups', []), createDatabaseBackup: request('create-backup', {}),
    },
    '@/utils/request': { getErrorMessage: error => error.message },
  }).default;
  return { state: component.setup({}, { expose() {} }), calls, errors };
}

test('fresh dashboard loads accounts without requesting site content', async () => {
  const { state, calls, errors } = dashboard({ activeSite: undefined });
  await state.loadDashboard();
  assert.equal(state.users.value.length, 1);
  assert.equal(state.profileEmail.value, 'admin@example.com');
  assert.equal(state.sitesReady.value, true);
  assert.equal(state.currentDbInfo.value.healthy, true);
  assert.equal(calls.includes('menus'), false);
  assert.equal(calls.includes('news'), false);
  assert.equal(calls.includes('products'), false);
  assert.equal(errors.length, 0);
});

test('one failed content request does not discard successful dashboard results', async () => {
  const { state, errors } = dashboard({ activeSite: { id: 1 }, failNews: true });
  await state.loadDashboard();
  assert.equal(state.users.value.length, 1);
  assert.equal(state.menus.value.length, 1);
  assert.equal(state.productList.value.length, 1);
  assert.equal(errors[0], 'news unavailable');
});

test('an empty site list clears selection and does not request PB languages', async () => {
  let languageCalls = 0, savedId;
  const store = evaluate(fs.readFileSync(path.join(root, 'frontend/src/stores/sites.ts'), 'utf8'), {
    vue, pinia: { defineStore: (_name, setup) => setup },
    '@/api/sites': { getSites: async () => ({ data: [] }), getCurrentSiteLanguages: async () => { languageCalls++; return { data: [] }; } },
    '@/utils/siteSelection': { getActiveSiteId: () => 99, saveActiveSiteId: id => { savedId = id; } },
  }).useSitesStore();
  await store.refresh();
  assert.equal(store.activeSiteId.value, 0);
  assert.equal(savedId, 0);
  assert.equal(languageCalls, 0);
  assert.equal(store.languagesLoaded.value, true);
});

test('an unconfigured brochure disables editing but still allows navigation', async () => {
  const { descriptor } = parse(fs.readFileSync(path.join(root, 'frontend/src/views/brochures/BrochureTool.vue'), 'utf8'));
  const source = ts.createSourceFile('brochure.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === 'discardChanges') ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ['busy', 'working'].includes(item.name.getText(source))))
  );
  assert.equal(selected.length, 3);
  const state = { sites: { activeSite: null }, ElMessageBox: { confirm: async () => {} } };
  for (const name of ['initializing', 'saving', 'exporting', 'importing', 'uploading', 'dirty']) state[name] = vue.ref(false);
  const code = `const {computed}=require('vue'); const {${Object.keys(state).join(',')}}=require('state');\n`
    + selected.map(node => node.getText(source)).join('\n') + '\nmodule.exports={working,discardChanges};';
  const guard = evaluate(code, { vue, state });
  assert.equal(guard.working.value, true);
  assert.equal(await guard.discardChanges(), true);
  state.saving.value = true;
  assert.equal(await guard.discardChanges(), false);
  state.saving.value = false;
  state.sites.activeSite = { id: 1 };
  assert.equal(guard.working.value, false);
  state.dirty.value = true;
  state.ElMessageBox.confirm = async () => { throw new Error('cancelled'); };
  assert.equal(await guard.discardChanges(), false);
});
