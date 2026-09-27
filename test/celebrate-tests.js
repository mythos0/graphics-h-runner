#!/usr/bin/env node
/**
 * celebrate-tests.js — unit tests for the v1.5.6 celebration overlays
 * (src/celebrate.ts -> out/celebrate.js) and their bundled media.
 *
 * Contract (from the user requirements):
 *   - confetti  = canvas-confetti "Realistic Look", on EVERY successful
 *                 compilation, full-screen overlay, auto-dismiss;
 *   - error     = a RELATABLE error overlay (giant shaking ✗ + the actual
 *                 compiler error headers in big type + red-ember rain)
 *                 when a compile stops on errors — replaces v1.5.5's snow;
 *   - schoolpride = canvas-confetti "School Pride" side cannons, 5 seconds,
 *                 first activity-bar panel open of every session;
 *   - fireworks = the vendored troyxun/fireworks-simulator show, full
 *                 screen, with a working Stop affordance.
 * Security contract: every overlay page is CSP-locked to its nonce +
 * the webview cspSource, loads only bundled media (no http(s) URLs),
 * embeds its config JSON safely (no raw < or </script>), and the
 * fireworks DOM skeleton satisfies every selector the vendored
 * script.js queries at load time.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  buildCelebrationHtml,
  buildFireworksHtml,
  celebrationMediaPaths,
  celebrationTitle,
  CELEBRATION_DURATIONS_MS,
  CELEBRATION_VIEW_TYPE
} = require(path.join(ROOT, 'out', 'celebrate'));

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

const CSP = 'https://*.vscode-cdn.net';
const media = celebrationMediaPaths(ROOT);

console.log('celebrate-tests — full-screen celebration overlays\n');

/* ---------- durations & titles ---------- */

check('durations: error overlay is readable (5s), school pride 5s', () => {
  assert.strictEqual(CELEBRATION_DURATIONS_MS.error, 5000,
    'error overlay must stay 5s so the big error headers are readable');
  assert.strictEqual(CELEBRATION_DURATIONS_MS.schoolpride, 5000, 'school pride must be exactly 5000 ms');
  assert.ok(CELEBRATION_DURATIONS_MS.confetti >= 2000 && CELEBRATION_DURATIONS_MS.confetti <= 5000,
    'confetti window should be short and unobtrusive');
  assert.ok(!('snow' in CELEBRATION_DURATIONS_MS), 'snow must be gone (replaced by the error overlay)');
});

check('every kind has a human title; fireworks mentions stopping', () => {
  for (const kind of ['confetti', 'error', 'schoolpride', 'fireworks']) {
    const t = celebrationTitle(kind);
    assert.ok(t && t.length > 5, 'no title for ' + kind);
  }
  assert.ok(/stop/i.test(celebrationTitle('fireworks')), 'fireworks title must mention how to stop');
  assert.ok(/error/i.test(celebrationTitle('error')), 'error title must say the compile failed');
  assert.strictEqual(CELEBRATION_VIEW_TYPE, 'graphicsHRunnerCelebration');
});

/* ---------- bundled media ---------- */

check('all vendored media files exist and are non-trivial', () => {
  const minSizes = {
    confettiJs: 15000,   /* canvas-confetti browser build ~25 KB */
    celebrateJs: 1500,   /* our controller */
    fireworksCss: 3000,  /* upstream style.css ~6 KB */
    fscreenJs: 1000,
    myMathJs: 1000,
    stageJs: 6000,       /* Stage + inlined Ticker ~12 KB */
    scriptJs: 30000      /* the simulator ~68 KB */
  };
  for (const [key, min] of Object.entries(minSizes)) {
    const st = fs.statSync(media[key]);
    assert.ok(st.size >= min, key + ' too small: ' + st.size + ' bytes');
  }
});

check('vendored libraries are the real upstream files (licenses intact)', () => {
  const confetti = fs.readFileSync(media.confettiJs, 'utf8');
  assert.ok(/canvas-confetti v1\.\d+\.\d+/.test(confetti), 'confetti build banner missing');
  assert.ok(!/https?:\/\/(?!schema)/.test(confetti.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'confetti build must not fetch remote resources');
  const script = fs.readFileSync(media.scriptJs, 'utf8');
  assert.ok(script.includes('MyMath') || script.includes('MyScreen'), 'fireworks engine signature missing');
  const stage = fs.readFileSync(media.stageJs, 'utf8');
  assert.ok(stage.includes('Ticker'), 'Stage.js must carry its inlined Ticker');
  const lic = fs.readFileSync(path.join(ROOT, 'media', 'fireworks', 'LICENSE'), 'utf8');
  assert.ok(/MIT License/.test(lic), 'fireworks MIT license file missing');
  assert.ok(/Troy/.test(lic), 'fireworks license must credit Troy');
  for (const f of [media.scriptJs, media.stageJs, media.myMathJs, media.fscreenJs]) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/[^.\w](eval\(|new Function\()/.test(src), 'vendored engine uses eval: ' + f);
  }
});

/* ---------- celebration page (confetti / error / school pride) ---------- */

function celebrationHtml(kind) {
  return buildCelebrationHtml({
    kind,
    nonce: 'abc123',
    cspSource: CSP,
    confettiJsUri: CSP + '/media/confetti.browser.js',
    celebrateJsUri: CSP + '/media/celebrate.js',
    durationMs: CELEBRATION_DURATIONS_MS[kind]
  });
}

for (const kind of ['confetti', 'error', 'schoolpride']) {
  check(kind + ' page: CSP-locked, nonce scripts, kind payload + duration embedded', () => {
    const h = celebrationHtml(kind);
    assert.ok(h.includes(`script-src 'nonce-abc123' ${CSP};`), 'script CSP must be nonce + cspSource');
    assert.ok(h.includes(`default-src 'none'`), 'default-src must be none');
    assert.ok((h.match(/<script /g) || []).length === 4, 'expected exactly 4 script tags (worker-hide + lib + config + controller)');
    assert.ok((h.match(/nonce="abc123"/g) || []).length === 4, 'every script must carry the nonce');
    assert.ok(h.includes('confetti.browser.js') && h.includes('celebrate.js'), 'bundled scripts not referenced');
    const payload = JSON.parse(h.match(/window\.__GHR_CELEBRATE__ = ([^;]+);/)[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
    assert.strictEqual(payload.kind, kind, 'wrong kind payload');
    assert.strictEqual(payload.durationMs, CELEBRATION_DURATIONS_MS[kind], 'wrong duration payload');
  });
}

check('error page carries the exact 5000 ms schedule', () => {
  const h = celebrationHtml('error');
  assert.ok(h.includes('"durationMs":5000'), 'error duration must be 5000');
});

check('ERROR overlay (v1.5.6): giant ✗ + headline + big-font error headers', () => {
  const h = buildCelebrationHtml({
    kind: 'error',
    nonce: 'e1',
    cspSource: CSP,
    confettiJsUri: CSP + '/c.js',
    celebrateJsUri: CSP + '/m.js',
    durationMs: 5000,
    errorLines: [
      'main.cpp:12:5: error: \'foo\' was not declared in this scope',
      '24_coordinate_viewer.cpp:(.text+0xc): undefined reference to `getmaxx\''
    ]
  });
  assert.ok(h.includes('class="err-x"'), 'giant ✗ missing');
  assert.ok(h.includes('err-shake'), 'the ✗ must shake in');
  assert.ok(h.includes('class="err-title"') && /Compile error/i.test(h), 'headline missing');
  assert.ok(h.includes('class="err-line"'), 'big error lines missing');
  assert.ok(h.includes('error: \'foo\' was not declared in this scope'), 'first error header not rendered');
  assert.ok(h.includes('undefined reference to `getmaxx\''), 'linker error header not rendered');
  assert.ok(h.includes('font-size: clamp(17px, 2.6vw, 26px)'), 'error lines must render in big type');
  assert.ok(!h.includes('snow'), 'no snow residue on the error page');
});

check('ERROR overlay renders a fallback line when no headers were captured', () => {
  const h = buildCelebrationHtml({
    kind: 'error',
    nonce: 'e2',
    cspSource: CSP,
    confettiJsUri: CSP + '/c.js',
    celebrateJsUri: CSP + '/m.js',
    durationMs: 5000
  });
  assert.ok(h.includes('open the graphics.h Runner output'), 'fallback guidance missing');
});

check('error headers with hostile content cannot break out (escaped + JSON-safe)', () => {
  const hostile = ['#include <graphics.h>', 'x" onclick="alert(1)', '</script><script>alert(2)</script>'];
  const h = buildCelebrationHtml({
    kind: 'error',
    nonce: 'e3',
    cspSource: CSP,
    confettiJsUri: CSP + '/c.js',
    celebrateJsUri: CSP + '/m.js',
    durationMs: 10,
    errorLines: hostile
  });
  assert.ok(!h.includes('</script><script>alert(2)'), 'raw </script> got through!');
  assert.ok(!h.includes('onclick="alert(1)'), 'raw attribute injection got through!');
  assert.ok(h.includes('&lt;script&gt;'), 'script tag must be entity-escaped in the DOM');
  /* the JSON payload must survive unescaping round-trip */
  const payload = h.match(/window\.__GHR_CELEBRATE__ = ([\s\S]*?);<\/script>/)[1];
  const parsed = JSON.parse(payload.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
  assert.deepStrictEqual(parsed.errorLines, hostile);
});

check('celebration pages contain no remote URLs (everything bundled)', () => {
  for (const kind of ['confetti', 'error', 'schoolpride']) {
    const h = celebrationHtml(kind);
    const stripped = h.replace(/https:\/\/\*\.vscode-cdn\.net/g, '');
    assert.ok(!/https?:\/\//.test(stripped), kind + ' page references a remote URL');
  }
});

check('Worker is hidden before the confetti lib loads and restored by the controller', () => {
  const h = celebrationHtml('confetti');
  const hideAt = h.indexOf('window.Worker = undefined');
  const libAt = h.indexOf('confetti.browser.js');
  assert.ok(hideAt > -1 && hideAt < libAt, 'Worker must be hidden BEFORE the library loads');
  const ctrl = fs.readFileSync(media.celebrateJs, 'utf8');
  assert.ok(ctrl.includes('window.Worker = window.__GHR_WORKER__'), 'controller must restore Worker');
  /* the confetti build must actually take the main-thread path when Worker
   * is hidden: it gates on the canUseWorker feature detection */
  const lib = fs.readFileSync(media.confettiJs, 'utf8');
  assert.ok(lib.includes('transferControlToOffscreen'), 'expected the offscreen-worker-capable build');
});

check('celebration config JSON cannot break out of the script tag', () => {
  const h = buildCelebrationHtml({
    kind: 'confetti',
    nonce: 'n',
    cspSource: CSP,
    confettiJsUri: 'x',
    celebrateJsUri: 'y',
    durationMs: 10
  });
  assert.ok((h.match(/<\/script>/gi) || []).length === 4, 'exactly the 4 real script closers');
  /* the embedded payload itself must be tag-free (escaped <, >, &) */
  const payload = h.match(/window\.__GHR_CELEBRATE__ = ([\s\S]*?);<\/script>/)[1];
  assert.ok(!/[<&>]/.test(payload), 'config payload contains raw <, > or &');
  const parsed = JSON.parse(payload.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
  assert.strictEqual(parsed.kind, 'confetti');
  assert.strictEqual(parsed.durationMs, 10);
});

/* ---------- fireworks page ---------- */

const fwHtml = buildFireworksHtml({
  nonce: 'fw456',
  cspSource: CSP,
  cssUri: CSP + '/media/fireworks/fireworks.css',
  fscreenJsUri: CSP + '/media/fireworks/fscreen.js',
  myMathJsUri: CSP + '/media/fireworks/MyMath.js',
  stageJsUri: CSP + '/media/fireworks/Stage.js',
  scriptJsUri: CSP + '/media/fireworks/script.js'
});

check('fireworks page: CSP + 5 nonce scripts in engine order', () => {
  assert.ok(fwHtml.includes(`script-src 'nonce-fw456' ${CSP};`), 'script CSP wrong');
  assert.ok((fwHtml.match(/<script /g) || []).length === 5, 'expected 5 script tags (4 libs + boot)');
  const order = ['fscreen.js', 'Stage.js', 'MyMath.js', 'script.js'];
  let last = -1;
  for (const f of order) {
    const at = fwHtml.indexOf(f);
    assert.ok(at > last, f + ' out of order');
    last = at;
  }
  assert.ok(fwHtml.includes('rel="stylesheet"'), 'fireworks.css must be linked');
});

check('fireworks page satisfies EVERY selector the vendored engine queries', () => {
  /* literal HTML tokens: every class / id / <use> target script.js needs */
  const required = [
    'class="loading-init"', 'class="loading-init__header"', 'class="loading-init__status"',
    'class="stage-container', 'class="canvas-container"',
    'id="trails-canvas"', 'id="main-canvas"',
    'class="controls"', 'class="btn pause-btn"', 'class="btn sound-btn"', 'class="btn settings-btn"',
    '<use href="#icon-pause"', '<use href="#icon-sound-off"', '<use href="#icon-settings"',
    'class="menu hide"', 'class="menu__inner-wrap"', 'class="btn btn--bright close-menu-btn"',
    'class="shell-type"', 'class="shell-type-label"', 'class="shell-size"', 'class="shell-size-label"',
    'class="quality-ui"', 'class="quality-ui-label"', 'class="sky-lighting"', 'class="sky-lighting-label"',
    'class="scaleFactor"', 'class="scaleFactor-label"',
    'class="auto-launch"', 'class="auto-launch-label"',
    'class="form-option form-option--checkbox form-option--finale-mode"', 'class="finale-mode"', 'class="finale-mode-label"',
    'class="hide-controls"', 'class="hide-controls-label"',
    'class="form-option form-option--checkbox form-option--fullscreen"', 'class="fullscreen"', 'class="fullscreen-label"',
    'class="long-exposure"', 'class="long-exposure-label"',
    'class="help-modal"', 'class="help-modal__overlay"', 'class="help-modal__dialog"',
    'class="help-modal__header"', 'class="help-modal__body"', 'class="help-modal__close-btn"',
    'id="icon-play"', 'id="icon-pause"', 'id="icon-close"', 'id="icon-settings"',
    'id="icon-sound-on"', 'id="icon-sound-off"'
  ];
  for (const sel of required) {
    assert.ok(fwHtml.includes(sel), 'fireworks DOM missing required node: ' + sel);
  }
});

check('fireworks page has a working Stop affordance wired to the host', () => {
  assert.ok(fwHtml.includes('id="ghr-stop"'), 'no Stop button');
  assert.ok(fwHtml.includes("postMessage({ type: 'stop' })"), 'Stop must post {type:stop} to the host');
  assert.ok(fwHtml.includes("ev.key === 'Escape'"), 'Esc must stop the show');
  assert.ok(fwHtml.includes('stopPropagation'), 'Stop click must not launch a firework through the stage');
});

check('fireworks page carries the upstream credit (MIT, Caleb Miller / troyxun)', () => {
  assert.ok(/Caleb Miller/.test(fwHtml), 'Caleb Miller credit missing');
  assert.ok(/troyxun\/fireworks-simulator/.test(fwHtml), 'repo credit missing');
});

/* ---------- celebrate.js controller ---------- */

check('controller implements all three confetti presets + dismissal + schedule', () => {
  const src = fs.readFileSync(media.celebrateJs, 'utf8');
  assert.ok(src.includes("'confetti'") && src.includes("'error'") && src.includes("'schoolpride'"),
    'a celebration kind is missing from the controller');
  assert.ok(!/['"]snow['"]/.test(src), 'snow must be gone from the controller');
  assert.ok(src.includes('emberColors'), 'error kind must drive the red-ember rain');
  assert.ok(src.includes('postMessage({ type: \'stop\' })') || src.includes("postMessage({ type: 'stop' });"),
    'controller must be able to stop early');
  assert.ok(src.includes('requestAnimationFrame'), 'effects must be frame-driven');
  assert.ok(src.includes('setTimeout(stop, durationMs)'), 'controller must carry its own schedule');
  new Function(src); /* syntax check */
});

/* ---------- v1.5.6 IN-PANEL celebrations (confetti + school pride) ---------- */
/* Routing contract (user requirement): success confetti and the School
 * Pride first-open show play INSIDE the activity panel (full panel
 * screen, no editor tab); the full-screen tab keeps ONLY the error
 * overlay and the Fireworks Simulator. */

const PANEL = 'https://*.vscode-cdn.net';
const { buildPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
const panelJsPath = path.join(ROOT, 'media', 'celebrate-panel.js');

function panelHtml(celebration) {
  return buildPanelHtml({
    programs: [],
    commands: [],
    status: { state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null },
    version: '1.5.6',
    nonce: 'pnl123',
    cspSource: PANEL,
    logoUri: PANEL + '/media/diu-logo.png',
    celebration,
    confettiJsUri: PANEL + '/media/confetti.browser.js',
    celebratePanelJsUri: PANEL + '/media/celebrate-panel.js'
  });
}

check('panel page bakes the celebration config + loads lib before controller (nonce everywhere)', () => {
  for (const kind of ['confetti', 'schoolpride']) {
    const h = panelHtml({ kind, durationMs: CELEBRATION_DURATIONS_MS[kind] });
    assert.ok(h.includes(`script-src 'nonce-pnl123' ${PANEL};`),
      'panel CSP must now allow the bundled media scripts (nonce + cspSource)');
    const cfgAt = h.indexOf('window.__GHR_CELEBRATE__');
    const libAt = h.indexOf('confetti.browser.js');
    const ctlAt = h.indexOf('celebrate-panel.js');
    assert.ok(cfgAt > -1 && libAt > -1 && ctlAt > -1, kind + ': boot block missing');
    assert.ok(cfgAt < libAt && libAt < ctlAt, kind + ': order must be config -> lib -> controller');
    /* every emitted script tag carries the nonce */
    const block = h.slice(cfgAt - 40, h.indexOf('</body>'));
    const tags = block.match(/<script[^>]*>/g) || [];
    assert.ok(tags.length === 3, kind + ': expected 3 celebrate scripts, got ' + tags.length);
    for (const t of tags) {
      assert.ok(t.includes('nonce="pnl123"'), kind + ': script without nonce: ' + t);
    }
    const payload = JSON.parse(h.match(/window\.__GHR_CELEBRATE__ = ([^;]+);/)[1]
      .replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
    assert.strictEqual(payload.kind, kind, kind + ': wrong baked kind');
    assert.strictEqual(payload.durationMs, CELEBRATION_DURATIONS_MS[kind], kind + ': wrong baked duration');
  }
});

check('panel page WITHOUT an active celebration stays clean (no config, controller no-ops)', () => {
  const h = panelHtml(undefined);
  assert.ok(!h.includes('__GHR_CELEBRATE__'), 'config must not be baked without a celebration');
  /* library + controller still load (they no-op), CSP already allows them */
  assert.ok(h.includes('confetti.browser.js') && h.includes('celebrate-panel.js'),
    'media scripts missing from the plain panel page');
});

check('celebrate-panel.js contract: no vscode API, click-through canvas, main-thread rendering', () => {
  const raw = fs.readFileSync(panelJsPath, 'utf8');
  /* strip comments so the header's "does NOT call acquireVsCodeApi()"
   * documentation cannot trip the code assertions */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!src.includes('acquireVsCodeApi'), 'panel controller must NOT acquire the vscode API (the panel page owns it)');
  assert.ok(!src.includes('postMessage'), 'panel controller must not talk back to the host');
  assert.ok(src.includes('confetti.create('), 'must render through confetti.create on its own canvas');
  assert.ok(/useWorker:\s*false/.test(src), 'must force the main-thread renderer (no blob: Worker under the panel CSP)');
  assert.ok(src.includes('pointer-events:none'), 'the canvas must be click-through so the panel stays usable');
  assert.ok(src.includes("'confetti'") && src.includes("'schoolpride'"), 'both in-panel kinds missing');
  assert.ok(!/['"]snow['"]/.test(src), 'snow must not return');
  assert.ok(src.includes('requestAnimationFrame'), 'school pride must be frame-driven');
  assert.ok(src.includes('setTimeout(finish'), 'canvas must be removed after the show');
  assert.ok(!/[^.\w](eval\(|new Function\()/.test(src), 'panel controller must not eval');
  new Function(raw); /* syntax check */
});

check('routing: extension sends confetti/schoolpride to the PANEL, error/fireworks to the tab', () => {
  const extSrc = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  const route = extSrc.match(/function celebrate\([\s\S]*?\n\}/);
  assert.ok(route, 'celebrate() router not found');
  assert.ok(/kind === 'confetti' \|\| kind === 'schoolpride'[\s\S]*?playCelebration/.test(route[0]),
    'confetti/schoolpride must route to panel.playCelebration');
  assert.ok(/celebrator\?\.show\(kind/.test(route[0]), 'the remaining kinds must still use the overlay');
  /* the overlay API itself is untouched: error + fireworks pages still exist */
  const overlay = fs.readFileSync(media.celebrateJs, 'utf8');
  assert.ok(overlay.includes("'error'"), 'error overlay controller must stay');
  const fw = buildFireworksHtml({
    nonce: 'x', cspSource: CSP, cssUri: 'a', fscreenJsUri: 'b', myMathJsUri: 'c', stageJsUri: 'd', scriptJsUri: 'e'
  });
  assert.ok(fw.includes('ghr-stop'), 'fireworks page must stay');
});

console.log(failures === 0 ? '\nCELEBRATE TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
