const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../backend/node_modules/typescript');
const Module = require('node:module');
const file = path.resolve(__dirname, '../frontend/src/utils/toolUrls.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const loaded = new Module(file); loaded._compile(compiled.outputText, file);
const { buildToolUrls } = loaded.exports;

const local = buildToolUrls('http://localhost:5278', {}, 'http://localhost:5108');
assert.equal(local.seo, 'http://localhost:5388/');
assert.equal(local.ftp, 'http://localhost:5389/');
assert.equal(local.backend, 'http://localhost:5108/api-docs');
const server = buildToolUrls('https://admin.example.com', {
  VITE_SEO_TOOL_URL: 'https://seo-admin.example.com', VITE_FTP_TOOL_URL: 'https://ftp-admin.example.com',
}, '/api');
assert.equal(server.admin, 'https://admin.example.com/#/');
assert.equal(server.backend, 'https://admin.example.com/api/api-docs');
assert.equal(server.models, 'https://seo-admin.example.com/models.html');
assert.equal(server.ftp, 'https://ftp-admin.example.com/');
assert.ok(Object.values(server).every(url => !url.includes('localhost') && url.startsWith('https://')));
const lan = buildToolUrls('http://192.0.2.20:5278', { VITE_SEO_TOOL_PORT: '5380' }, '/api');
assert.equal(lan.seo, 'http://192.0.2.20:5380/');
const subpath = buildToolUrls('https://admin.example.com', { VITE_SEO_TOOL_URL: '/seo/' }, '/api/');
assert.equal(subpath.models, 'https://admin.example.com/seo/models.html');
assert.throws(() => buildToolUrls('https://admin.example.com', { VITE_SEO_TOOL_URL: 'javascript:bad' }, '/api'));
console.log('Passed: local, LAN, BaoTa HTTPS/reverse proxy, subpath, invalid protocol. No server connection made.');
