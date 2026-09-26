const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('retired template bindings has no UI, route or Nest registration', () => {
  for (const file of ['frontend/src/router/index.ts', 'frontend/src/components/layout/AppAside.vue', 'frontend/src/views/sites/SitesView.vue', 'backend/src/sites/sites.module.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /template-bindings|TemplateBindings|模板栏目绑定/);
  }
  for (const file of ['frontend/src/views/sites/TemplateBindingsView.vue', 'frontend/src/api/templateBindings.ts', 'backend/src/sites/template-bindings.controller.ts', 'backend/src/sites/template-bindings.service.ts', 'backend/src/sites/template-bindings.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});
