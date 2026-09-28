#!/usr/bin/env node
/**
 * v159_render_pages.js — renders the REAL panel page (compiled
 * out/panelHtml.js) into standalone browser-checkable files:
 *
 *   build/cheat-page-after.html  — the fixed v1.5.9 page
 *   build/cheat-page-before.html — already captured: shipped v1.5.8 (buggy)
 *
 * For browser runs the CSP <meta> is stripped and a acquireVsCodeApi stub
 * is injected at the top of <head> (in the real webview VS Code provides
 * the API + CSP; the stub only replaces the transport, not the page logic).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { buildPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

const programs = loadProgramCatalog(ROOT).map((p) => ({
  id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag, lab: !!p.lab
}));

const html = buildPanelHtml({
  programs,
  commands: COMMAND_META,
  status: { state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null },
  version: '1.5.9',
  nonce: 'browsercheck',
  cspSource: 'https://*.vscode-cdn.net',
  logoUri: ''
});

const stub = `<script>
window.__ghrState = {};
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (m) { try { window.parent.postMessage({ __ghr: m }, '*'); } catch (e) {} window.__ghrLastPost = m; },
    getState: function () { return window.__ghrState; },
    setState: function (s) { window.__ghrState = s || {}; }
  };
};
</script>`;

/* strip the CSP meta (sandbox page, nonce'd scripts would be blocked) and
   inject the stub before any other script runs */
const noCsp = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '<!-- CSP stripped for browser check -->');
const withStub = noCsp.replace('<head>', '<head>\n' + stub);

fs.writeFileSync(path.join(ROOT, 'build', 'cheat-page-after.html'), withStub);
console.log('after page rendered:', withStub.length, 'bytes -> build/cheat-page-after.html');
if (!fs.existsSync(path.join(ROOT, 'build', 'cheat-page-before.html'))) {
  console.log('NOTE: before page missing (build/cheat-page-before.html)');
}
