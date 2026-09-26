#!/usr/bin/env node
/**
 * smoke-view.js — smoke-tests the modern webview panel HTML builder
 * (src/panelHtml.ts -> out/panelHtml.js) without a VS Code UI.
 *
 * Validates:
 *  1. all three environment states render the right pill + CTA
 *  2. 31 program cards (23 + 8 lab) with Run + Open buttons, split into
 *     the Example Programs list and the Computer Graphics Lab section
 *  3. 7 action buttons wired to COMMAND_META ids (Open Examples Folder
 *     removed in v1.4.9), exactly one green accent
 *  4. CSP + nonce + script tag + version are present; the DIU badge sits on
 *     the exact right side of the footer text, and the footer carries the
 *     "Powered by Department of CSE …" credit
 *  5. dangerous text is HTML-escaped (including the logo URI)
 *  6. busy label markup would be safe (script-side escaping)
 *  7. ready state renders NO environment card (removed in v1.4.7)
 *  8. Example Programs: collapsed by default, scrolls inside its container
 */
'use strict';
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { buildPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

const programs = loadProgramCatalog(ROOT).map((p) => ({
  id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag, lab: !!p.lab
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

const LOGO = 'https://*.vscode-cdn.net/media/diu-logo.png';

function html(status, logoUri) {
  return buildPanelHtml({
    programs,
    commands: COMMAND_META,
    status: Object.assign({ state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null }, status),
    version: '1.4.0',
    nonce: 'testnonce123',
    cspSource: 'https://*.vscode-cdn.net',
    logoUri: logoUri === undefined ? LOGO : logoUri
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

check('31 program cards (23 + 8 lab), each with Run + Open', () => {
  const h = html({});
  const runs = (h.match(/data-run="/g) || []).length;
  const opens = (h.match(/data-open="/g) || []).length;
  assert.strictEqual(runs, 31, 'data-run count ' + runs);
  assert.strictEqual(opens, 31, 'data-open count ' + opens);
  assert.ok(h.includes('Winking Smiley') && h.includes('Fireworks Show') && h.includes('Warp Starfield'), 'fun programs missing');
  assert.ok(h.includes('Turbo C++ Graphics Tour') && h.includes('Conio Keyboard Paint') && h.includes('Sprite Animation'), 'new v1.4.7 programs missing');
  /* split: the classic list first, the lab list below it */
  const labAt = h.indexOf('id="lab-sec"');
  assert.ok(labAt > 0, 'lab section missing');
  const main = h.slice(0, labAt);
  const lab = h.slice(labAt);
  assert.strictEqual((main.match(/data-run="/g) || []).length, 23, 'main list should carry 23 cards');
  assert.strictEqual((lab.match(/data-run="/g) || []).length, 8, 'lab list should carry 8 cards');
  for (const t of ['Coordinate Viewer', 'Pixel Inspector', 'DDA Line Lab', 'Bresenham Line Lab', 'Bresenham Circle Lab', 'Midpoint Ellipse Lab', '2D Transformations Lab', 'Cohen-Sutherland Clipping']) {
    assert.ok(lab.includes(t), 'lab program missing: ' + t);
  }
  assert.strictEqual((h.match(/tag tag-lab/g) || []).length, 8, 'lab tag count wrong');
});

check('7 action buttons carrying COMMAND_META ids (no Open Examples Folder)', () => {
  const h = html({});
  const cmds = (h.match(/data-cmd="/g) || []).length;
  assert.strictEqual(cmds, 7, 'data-cmd count ' + cmds);
  for (const c of COMMAND_META) {
    assert.ok(h.includes(`id="${c.id}"`), 'button id missing: ' + c.id);
  }
  assert.ok(!h.includes('data-cmd="graphics-h-runner.openExamplesFolder"'), 'Open Examples Folder button still present');
  assert.ok(!h.includes('Open Examples Folder'), 'Open Examples Folder text leaked');
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
  assert.strictEqual(total, 7, 'action button count ' + total);
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

check('header layout: identity left, action buttons beside them; programs zone below', () => {
  const h = html({});
  const header = h.slice(h.indexOf('class="header"'), h.indexOf('class="programs-zone"'));
  assert.ok(header.includes('graphics.h Runner'), 'title not in the header');
  assert.ok(header.includes('id="env-pill"'), 'status pill not in the header');
  assert.ok(header.includes('class="chip"'), 'version/platform chips not in the header');
  assert.ok(header.indexOf('id="cmd-compileAndRun"') > header.indexOf('class="hero"'),
    'action buttons are not beside the identity block');
  const below = h.slice(h.indexOf('class="programs-zone"'));
  assert.ok(below.includes('id="programs"'), 'program cards missing below the header');
  assert.ok(below.includes('class="foot"'), 'footer missing below the header');
  assert.ok(h.includes('@media (min-width: 620px)'), 'wide-header media query missing');
  assert.ok(!h.includes('col-side') && !h.includes('col-main'), 'old two-pane classes leaked');
});

check('ready state: NO environment card at all (removed in v1.4.7)', () => {
  const h = html({});
  assert.ok(!h.includes('Everything is ready'), 'ready env card still rendered');
  assert.ok(!h.includes('id="env-card"'), 'env-card element leaked in ready state');
  assert.ok(!h.includes('id="env-cta"'), 'setup CTA leaked in ready state');
});

check('not-ready state: env card with the setup CTA still renders', () => {
  const h = html({ state: 'not-ready', compilerOk: false, library: null });
  assert.ok(h.includes('id="env-card"'), 'env card missing in not-ready state');
  assert.ok(h.includes('Environment needs setup'), 'not-ready copy missing');
});

check('CSP: nonce script + cspSource in img-src, no inline handlers', () => {
  const h = html({});
  assert.ok(h.includes(`script-src 'nonce-testnonce123'`), 'nonce CSP missing');
  assert.ok(h.includes(`img-src https://*.vscode-cdn.net`), 'cspSource not used');
  assert.ok(h.includes('<script nonce="testnonce123">'), 'script nonce missing');
  assert.ok(!/\son\w+="/.test(h), 'inline event handler found');
});

check('branding: DIU badge on the exact right side of the footer text, no hero text credit', () => {
  const h = html({});
  const imgs = h.match(/<img class="diu-logo"[^>]*>/g) || [];
  assert.strictEqual(imgs.length, 1, 'expected exactly one diu-logo img, got ' + imgs.length);
  assert.ok(imgs[0].includes('src="' + LOGO + '"'), 'logo src is not the webview uri');
  assert.ok(imgs[0].includes('alt='), 'logo alt missing');
  /* the badge lives INSIDE the footer row, right of the credit text */
  const footAt = h.indexOf('class="foot"');
  const creditAt = h.indexOf('class="credit"');
  const brandAt = h.indexOf('class="foot-brand"');
  assert.ok(footAt !== -1 && creditAt > footAt, 'footer credit missing');
  assert.ok(brandAt > creditAt, 'DIU badge is not right of the footer text');
  assert.ok(h.includes('.foot-brand'), 'footer-brand CSS rule missing');
  const footCss = h.slice(h.indexOf('.foot {'), h.indexOf('.foot b'));
  assert.ok(footCss.includes('justify-content:space-between'), 'footer is not a space-between row');
  assert.ok(footCss.includes('align-items:center'), 'badge not vertically centred against the text');
  assert.ok(h.includes('.foot .credit { flex:1 1 auto'), 'credit does not take the remaining width');
  /* the title row must NOT carry the badge anymore (check the rendered
     <img> tag — the .diu-logo class name legitimately lives in <style>) */
  const head = h.slice(0, h.indexOf('class="header-actions"'));
  assert.ok(!head.includes('<img class="diu-logo"'), 'badge leaked back into the header');
  /* no TEXT credit in the hero (attribute title on the badge is fine) */
  const hero = h.slice(h.indexOf('class="header"'), h.indexOf('class="header-actions"'));
  const heroText = hero.replace(/<[^>]+>/g, ' ');
  assert.ok(!heroText.includes('Dhaka International University'), 'university credit leaked into hero text');
  assert.ok(!h.includes('made by'), 'old made-by wording present');
  assert.ok(!h.includes('made with'), 'old made-with wording present');
  assert.ok(h.includes('Powered by Department of CSE, Dhaka International University, Bangladesh.'), 'footer credit missing');
  assert.ok(h.includes('graphics.h Runner'), 'title missing');
  assert.ok(h.includes('v1.4.0'), 'version missing');
  /* no logoUri -> no img at all (defensive) */
  assert.ok(!html({}, null).includes('<img'), 'img rendered without a logoUri');
  /* hostile logoUri must be escaped */
  const evil = html({}, '"><script>alert(1)</script>');
  assert.ok(!evil.includes('<script>alert(1)'), 'logoUri not escaped');
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

check('version chip sits beside the Ready pill; platform chip gone', () => {
  const h = html({});
  assert.ok(h.includes('class="status-row"'), 'status row missing');
  const row = h.slice(h.indexOf('class="status-row"'), h.indexOf('class="status-row"') + 500);
  assert.ok(row.includes('id="env-pill"'), 'pill not in the status row');
  assert.ok(row.indexOf('class="chip"') > row.indexOf('id="env-pill"'), 'version chip is not beside the pill');
  assert.ok(!html({ platform: 'windows' }).includes('Windows · WinBGIM'), 'platform chip still rendered');
  assert.ok(!html({ platform: 'linux' }).includes('Linux · SDL_bgi'), 'platform chip still rendered');
  assert.ok(!html({ platform: 'macos' }).includes('macOS · SDL_bgi'), 'platform chip still rendered');
  assert.ok(html({}).includes('<span class="chip">v1.4.0</span>'), 'version chip missing');
  assert.strictEqual((html({}).match(/class="chip"/g) || []).length, 1, 'unexpected extra chips');
});

check('footer hint/telemetry lines removed; hero button keeps the shortcut hint', () => {
  const h = html({});
  assert.ok(!h.includes('Inside a .cpp file just press'), 'footer kbd sentence still present');
  assert.ok(!h.includes('errors are reported automatically'), 'footer telemetry line still present');
  assert.ok(!h.includes('telemetry setting'), 'telemetry disclosure still in the footer');
  /* the shortcut stays discoverable via the hero Compile & Run button
     (the button lives in .header-actions, beside the identity block) */
  const actions = h.slice(h.indexOf('class="header-actions"'), h.indexOf('class="programs-zone"'));
  assert.ok(actions.includes('Ctrl+Alt+R'), 'hero button lost the Ctrl+Alt+R hint');
});

check('hero button: exactly one, it is Compile & Run, full-width alone on its row', () => {
  const h = html({});
  const heroes = (h.match(/btn-accent btn-hero/g) || []).length;
  assert.strictEqual(heroes, 1, 'hero button count ' + heroes);
  const m = h.match(/<button class="([^"]*)"[^>]*id="cmd-compileAndRun"/);
  assert.ok(m && m[1].includes('btn-hero'), '1st action button is not the hero');
  assert.ok(h.includes('grid-column: 1 / -1'), 'hero must span the full row');
  assert.ok(h.includes('.btn-hero .btn-title'), 'hero typography rules missing');
  /* the other 6 stay in the 2-per-row grid; the freed row belongs to the
     programs zone (flex:1) which grows for expansion + scrolling */
  const re = /<button class="([^"]*)" data-cmd="[^"]*" id="(cmd-[^"]+)"/g;
  let m2, grid = 0;
  while ((m2 = re.exec(h)) !== null) {
    if (!m2[1].includes('btn-hero')) grid++;
  }
  assert.strictEqual(grid, 6, 'secondary buttons not in the grid: ' + grid);
  assert.ok(h.includes('repeat(2, minmax(0, 1fr))'), '2-per-row grid rule missing');
  assert.ok(h.includes('@media (max-width: 299px)'), 'very-narrow single-column fallback missing');
});

check('example programs: collapsed by default, remembered, scroll inside their zone', () => {
  const h = html({});
  assert.ok(h.includes('id="programs-sec"'), 'toggle section header missing');
  assert.ok(h.includes('id="programs" class="collapsed"'), 'program list is not collapsed by default');
  assert.ok(h.includes('aria-expanded="false"'), 'toggle not announced collapsed');
  assert.ok(h.includes('chev'), 'collapse chevron missing');
  assert.ok(h.includes('tap to expand'), 'collapsed hint missing');
  assert.ok(h.includes('programs-zone'), 'programs flex zone missing');
  assert.ok(h.includes('overflow-y:auto'), 'internal scrollbar rule missing');
  assert.ok(h.includes("vscode.getState() && vscode.getState().programsOpen"), 'expanded state not persisted via webview state');
  assert.ok(h.includes('st.programsOpen = !programsOpen(); vscode.setState(st)'), 'toggle does not persist its state');
  assert.ok(h.includes("progSec.addEventListener('click', togglePrograms)"), 'toggle click not wired');
  assert.ok(h.includes("progSec.addEventListener('keydown'"), 'toggle keyboard support missing');
  assert.ok(h.includes('height:100vh'), 'fixed-height page layout missing');
  assert.ok(h.includes('margin-top:auto'), 'footer not pinned to the bottom');
});

check('Computer Graphics Lab: own section below Example Programs, collapsed + persisted', () => {
  const h = html({});
  assert.ok(h.includes('id="lab-sec"'), 'lab section header missing');
  assert.ok(h.includes('Computer Graphics Lab'), 'lab section title missing');
  assert.ok(h.includes('id="lab-programs" class="collapsed"'), 'lab list not collapsed by default');
  assert.ok(h.includes('8 lab programs · tap to expand'), 'lab count header wrong');
  assert.ok(h.indexOf('id="programs-sec"') < h.indexOf('id="lab-sec"'), 'lab section must sit below Example Programs');
  assert.ok(h.indexOf('id="lab-programs"') < h.indexOf('class="foot"'), 'lab list must stay above the footer');
  assert.ok(h.includes('vscode.getState().labOpen'), 'lab expanded state not persisted');
  assert.ok(h.includes('st.labOpen = !labOpen(); vscode.setState(st)'), 'lab toggle does not merge persisted state');
  assert.ok(h.includes('st.programsOpen = !programsOpen(); vscode.setState(st)'), 'programs toggle does not merge persisted state');
  assert.ok(h.includes("labSec.addEventListener('click', toggleLab)"), 'lab toggle click not wired');
  assert.ok(h.includes("labSec.addEventListener('keydown'"), 'lab toggle keyboard support missing');
});

check('help "?" button beside the title opens a searchable graphics.h cheat sheet', () => {
  const h = html({});
  const heroAt = h.indexOf('class="hero"');
  const hero = h.slice(heroAt, h.indexOf('class="status-row"'));
  assert.ok(hero.includes('<h1>graphics.h Runner</h1>'), 'hero title missing');
  assert.ok(hero.includes('id="help-btn"'), 'help button missing beside the title');
  assert.ok(hero.includes('class="hero-row"'), 'hero row layout missing');
  assert.ok(hero.includes('>?</button>'), 'help button text missing');
  assert.ok(h.includes('class="cheat-overlay"'), 'cheat overlay missing');
  assert.ok(h.includes('graphics.h Cheat Sheet'), 'cheat sheet heading missing');
  assert.ok(h.includes('id="cheat-q"'), 'cheat search input missing');
  assert.ok(h.includes('id="cheat-close"'), 'cheat close button missing');
  assert.ok(h.includes('id="cheat-empty"'), 'cheat no-results row missing');
  const fns = (h.match(/class="cheat-fn"/g) || []).length;
  assert.ok(fns >= 40, 'too few cheat entries: ' + fns);
  for (const sig of ['initwindow(width, height', 'putpixel(x, y, color)', 'setfillstyle(pattern, color)', 'outtextxy(x, y', 'floodfill(x, y, border)', 'getmouseclick(kind', 'ismouseclick(kind', 'kbhit()', 'putimage(l, t, bitmap, verb)', 'setviewport(l, t, r, b, clip)', 'textheight("t")']) {
    assert.ok(h.includes(sig), 'cheat entry missing: ' + sig);
  }
  assert.ok(h.includes('filterCheat'), 'cheat search filter not wired');
  assert.ok(h.includes("ev.key === 'Escape'"), 'Esc close missing');
  assert.ok(h.includes("cheatOv.addEventListener('click'"), 'backdrop close missing');
  /* the help button is not a command button and must not post commands */
  const btn = h.slice(h.indexOf('id="help-btn"') - 200, h.indexOf('id="help-btn"') + 400);
  assert.ok(!btn.includes('data-cmd'), 'help button must not carry a data-cmd');
});

check('program count lives in the section header (per-button hint gone)', () => {
  const h = html({});
  assert.ok(!h.includes('all 23 programs'), 'old per-button count hint still rendered');
  assert.ok(h.includes('23 programs · tap to expand'), 'section count header wrong');
  assert.ok(h.includes('8 lab programs · tap to expand'), 'lab count header wrong');
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
