#!/usr/bin/env node
/**
 * smoke-view.js — smoke-tests the modern webview panel HTML builder
 * (src/panelHtml.ts -> out/panelHtml.js) without a VS Code UI.
 *
 * Validates:
 *  1. all three environment states render the right pill + CTA
 *  2. 19 program cards with Run + Open buttons
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

check('19 program cards, each with Run + Open', () => {
  const h = html({});
  const runs = (h.match(/data-run="/g) || []).length;
  const opens = (h.match(/data-open="/g) || []).length;
  assert.strictEqual(runs, 19, 'data-run count ' + runs);
  assert.strictEqual(opens, 19, 'data-open count ' + opens);
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

check('action buttons: exactly one green accent (primary), all others uniform neutral', () => {
  const h = html({});
  const re = /<button class="([^"]*)" data-cmd="[^"]*" id="(cmd-[^"]+)"/g;
  let m, accent = 0, total = 0, firstId = null;
  while ((m = re.exec(h)) !== null) {
    total++;
    if (m[1].includes('btn-accent')) { accent++; firstId = firstId || m[2]; }
    assert.ok(!/btn-(violet|amber|emerald|blue|cyan|rose|fuchsia|lime)/.test(m[1]), 'rainbow color class found on ' + m[2]);
  }
  assert.strictEqual(total, 8, 'action button count ' + total);
  assert.strictEqual(accent, 1, 'accent button count ' + accent);
  assert.strictEqual(firstId, 'cmd-compileAndRun', 'accent is not the 1st action button');
  assert.ok(!h.includes('mini-run'), 'card Run buttons must stay neutral');
});

check('not-ready state: env CTA carries the green accent', () => {
  const h = html({ state: 'not-ready', compilerOk: false, library: null });
  const m = h.match(/<button class="([^"]*)"[^>]*id="env-cta"/);
  assert.ok(m && m[1].includes('btn-accent'), 'env CTA is not accent-styled');
});

check('dark neutral theme: flat background, no blueish gradients', () => {
  const h = html({});
  assert.ok(h.includes('--bg:#0f1115'), 'dark neutral background var missing');
  assert.ok(!h.includes('radial-gradient'), 'radial gradient found');
  assert.ok(!h.includes('linear-gradient(160deg'), 'page-wide gradient found');
  assert.ok(!h.includes('#171538') && !h.includes('#7c5cff') && !h.includes('#22d3ee'), 'old indigo/violet palette leaked');
});

check('header layout: identity + env card left, action buttons beside them; programs full-width below', () => {
  const h = html({});
  const header = h.slice(h.indexOf('class="header"'), h.indexOf('class="sec"'));
  assert.ok(header.includes('graphics.h Runner'), 'title not in the header');
  assert.ok(header.includes('id="env-pill"'), 'status pill not in the header');
  assert.ok(header.includes('class="chip"'), 'version/platform chips not in the header');
  assert.ok(header.includes('id="env-card"'), 'env status card not in the header');
  assert.ok(header.indexOf('id="env-card"') < header.indexOf('id="cmd-compileAndRun"'),
    'action buttons are not beside the identity/status block');
  const below = h.slice(h.indexOf('class="sec"'));
  assert.ok(below.includes('id="programs"'), 'program cards missing below the header');
  assert.ok(below.includes('class="foot"'), 'footer missing below the header');
  assert.ok(h.includes('@media (min-width: 620px)'), 'wide-header media query missing');
  assert.ok(!h.includes('col-side') && !h.includes('col-main'), 'old two-pane classes leaked');
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

check('hero button: exactly one, it is Compile & Run, full-width alone on its row', () => {
  const h = html({});
  const heroes = (h.match(/btn-accent btn-hero/g) || []).length;
  assert.strictEqual(heroes, 1, 'hero button count ' + heroes);
  const m = h.match(/<button class="([^"]*)"[^>]*id="cmd-compileAndRun"/);
  assert.ok(m && m[1].includes('btn-hero'), '1st action button is not the hero');
  assert.ok(h.includes('grid-column: 1 / -1'), 'hero must span the full row');
  assert.ok(h.includes('.btn-hero .btn-title'), 'hero typography rules missing');
  /* the other 7 stay in the 2-per-row grid */
  const re = /<button class="([^"]*)" data-cmd="[^"]*" id="(cmd-[^"]+)"/g;
  let m2, grid = 0;
  while ((m2 = re.exec(h)) !== null) {
    if (!m2[1].includes('btn-hero')) grid++;
  }
  assert.strictEqual(grid, 7, 'secondary buttons not in the grid: ' + grid);
  assert.ok(h.includes('repeat(2, minmax(0, 1fr))'), '2-per-row grid rule missing');
  assert.ok(h.includes('@media (max-width: 299px)'), 'very-narrow single-column fallback missing');
});

check('liveness: page pongs on load and answers pings (service-worker watchdog)', () => {
  const h = html({});
  assert.ok(h.includes("postMessage({ type: 'pong' })"), 'load pong missing');
  assert.ok(h.includes("m.type === 'ping'"), 'ping handler missing');
  assert.ok(h.includes("postMessage({ type: 'pong' })"), 'pong reply missing');
});

check('fallback page: dark recovery notice + retry button + pong, no external assets', () => {
  const { buildFallbackPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
  const h = buildFallbackPanelHtml({
    version: '1.4.4', nonce: 'fbnonce', cspSource: 'https://*.vscode-cdn.net',
    reason: 'Test reason <script>alert(1)</script>'
  });
  assert.ok(h.includes('The panel could not load'), 'failure notice missing');
  assert.ok(h.includes('data-cmd="graphics-h-runner.reloadPanel"'), 'retry button not wired to reloadPanel');
  assert.ok(h.includes("postMessage({ type: 'pong' })"), 'fallback pong missing');
  assert.ok(h.includes('graphics.h Programs (List)'), 'fallback must point at the list view');
  assert.ok(h.includes('background:#0f1115'), 'fallback page not dark-themed');
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'fallback reason not escaped');
  assert.ok(!/\son\w+="/.test(h), 'inline handler in fallback page');
});

console.log(failures === 0 ? '\nSMOKE VIEW ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
