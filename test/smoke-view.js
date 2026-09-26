#!/usr/bin/env node
/**
 * smoke-view.js — smoke-tests the modern webview panel HTML builder
 * (src/panelHtml.ts -> out/panelHtml.js) without a VS Code UI.
 *
 * Validates:
 *  1. all three environment states render the right pill + CTA
 *  2. 18 program cards with Run + Open buttons
 *  3. 8 action buttons wired to COMMAND_META ids, each with its own color
 *  4. CSP + nonce + script tag + version are present; no logo, and the
 *     footer carries the "Powered by Department of CSE …" credit
 *  5. dangerous text is HTML-escaped
 *  6. busy label markup would be safe (script-side escaping)
 */
'use strict';
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { buildPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

const programs = loadProgramCatalog(ROOT).map((p) => ({
  id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag
}));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✅ ' + name);
  } catch (e) {
    failures++;
    console.log('  ❌ ' + name + ' -> ' + e.message);
  }
}

function html(status) {
  return buildPanelHtml({
    programs,
    commands: COMMAND_META,
    status: Object.assign({ state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null }, status),
    version: '1.4.0',
    nonce: 'testnonce123',
    cspSource: 'https://*.vscode-cdn.net'
  });
}

console.log('smoke-view — webview panel HTML\n');

check('not-ready state: red pill + Complete Run Setup CTA + no-compiler copy', () => {
  const h = html({ state: 'not-ready', compilerOk: false, library: null });
  assert.ok(h.includes('pill-bad'), 'no bad pill');
  assert.ok(h.includes('Complete Run Setup'), 'no CTA');
  assert.ok(h.includes('data-cmd="graphics-h-runner.setupEverything"'), 'CTA not wired to setupEverything');
  assert.ok(h.includes('No working C++ compiler found'), 'no-compiler copy missing');
  assert.ok(!h.includes('env-card env-ok'), 'env-ok class leaked');
});

check('not-ready (library missing): mentions graphics library, not compiler', () => {
  const h = html({ state: 'not-ready', compilerOk: true, library: null });
  assert.ok(h.includes('graphics library is missing'), 'library copy wrong');
  assert.ok(!h.includes('No working C++ compiler found'), 'compiler copy leaked');
});

check('ready state: green pill with library, no CTA', () => {
  const h = html({});
  assert.ok(h.includes('pill-ok'), 'no ok pill');
  assert.ok(h.includes('SDL_bgi'), 'library not shown');
  assert.ok(h.includes('env-ok'), 'env-ok missing');
  assert.ok(!h.includes('env-cta'), 'CTA should be hidden when ready');
});

check('checking state: amber pill', () => {
  const h = html({ state: 'checking', compilerOk: false, library: null });
  assert.ok(h.includes('pill-wait'), 'no wait pill');
  assert.ok(h.includes('Checking environment'), 'no checking copy');
});

check('18 program cards, each with Run + Open', () => {
  const h = html({});
  const runs = (h.match(/data-run="/g) || []).length;
  const opens = (h.match(/data-open="/g) || []).length;
  assert.strictEqual(runs, 18, 'data-run count ' + runs);
  assert.strictEqual(opens, 18, 'data-open count ' + opens);
  assert.ok(h.includes('Winking Smiley') && h.includes('Fireworks Show') && h.includes('Warp Starfield'), 'fun programs missing');
});

check('8 action buttons carrying COMMAND_META ids', () => {
  const h = html({});
  const cmds = (h.match(/data-cmd="/g) || []).length;
  assert.strictEqual(cmds, 8, 'data-cmd count ' + cmds);
  for (const c of COMMAND_META) {
    assert.ok(h.includes(`id="${c.id}"`), 'button id missing: ' + c.id);
  }
});

check('each action button has its own distinct color', () => {
  const h = html({});
  const colors = ['violet', 'amber', 'emerald', 'blue', 'cyan', 'rose', 'fuchsia', 'lime'];
  for (const c of COMMAND_META) {
    const m = h.match(new RegExp('<button class="([^"]*)" data-cmd="[^"]*" id="' + c.id + '"'));
    assert.ok(m, 'button markup missing for ' + c.id);
    assert.match(m[1], /btn-color/, 'no shared color styling on ' + c.id);
    assert.match(m[1], /btn-(violet|amber|emerald|blue|cyan|rose|fuchsia|lime)/, 'no color class on ' + c.id);
  }
  for (const col of colors) {
    const n = (h.match(new RegExp('btn-' + col + '"', 'g')) || []).length;
    assert.strictEqual(n, 1, 'color ' + col + ' used ' + n + ' times (want exactly 1)');
  }
});

check('CSP: nonce script + cspSource in img-src, no inline handlers', () => {
  const h = html({});
  assert.ok(h.includes(`script-src 'nonce-testnonce123'`), 'nonce CSP missing');
  assert.ok(h.includes(`img-src https://*.vscode-cdn.net`), 'cspSource not used');
  assert.ok(h.includes('<script nonce="testnonce123">'), 'script nonce missing');
  assert.ok(!/\son\w+="/.test(h), 'inline event handler found');
});

check('branding: no logo / no hero credit, Powered-by footer credit, title + version', () => {
  const h = html({});
  assert.ok(!h.includes('<img'), 'logo image tag still present');
  assert.ok(!h.includes('made by'), 'old made-by wording present');
  assert.ok(!h.includes('made with'), 'old made-with wording present');
  const hero = h.slice(0, h.indexOf('class="foot"'));
  assert.ok(!hero.includes('Dhaka International University'), 'university credit leaked into hero');
  assert.ok(h.includes('Powered by Department of CSE, Dhaka International University, Bangladesh.'), 'footer credit missing');
  assert.ok(h.includes('graphics.h Runner'), 'title missing');
  assert.ok(h.includes('v1.4.0'), 'version missing');
});

check('XSS: hostile title/description are escaped', () => {
  const h = buildPanelHtml({
    programs: [{ id: 'x', title: '<img src=x onerror=alert(1)>', description: '</div><script>bad()</script>', emoji: '🙂', filename: 'x.cpp', tag: 'fun' }],
    commands: COMMAND_META,
    status: { state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null },
    version: '1.4.0',
    nonce: 'n1',
    cspSource: 'https://*.vscode-cdn.net'
  });
  assert.ok(!h.includes('<img src=x'), 'raw img tag leaked');
  assert.ok(!h.includes('</div><script>bad()'), 'raw script leaked');
  assert.ok(h.includes('&lt;script&gt;bad()'), 'escaped script not found');
});

check('platform chip reflects platform', () => {
  assert.ok(html({ platform: 'windows' }).includes('Windows · WinBGIM'));
  assert.ok(html({ platform: 'linux' }).includes('Linux · SDL_bgi'));
  assert.ok(html({ platform: 'macos' }).includes('macOS · SDL_bgi'));
});

check('keyboard hint + telemetry disclosure in footer', () => {
  const h = html({});
  assert.ok(h.includes('Ctrl+Alt+R'), 'kbd hint missing');
  assert.ok(h.includes('telemetry setting'), 'telemetry disclosure missing');
});

console.log(failures === 0 ? '\nSMOKE VIEW ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
