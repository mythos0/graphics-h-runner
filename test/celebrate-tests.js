#!/usr/bin/env node
/**
 * celebrate-tests.js — unit tests for the v1.5.5 celebration overlays
 * (src/celebrate.ts -> out/celebrate.js) and their bundled media.
 *
 * Contract (from the user requirements):
 *   - confetti  = canvas-confetti "Realistic Look", on EVERY successful
 *                 compilation, full-screen overlay, auto-dismiss;
 *   - snow      = 3 seconds exactly, when a compile stops on errors;
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

check('durations match the requirements (snow exactly 3s, school pride 5s)', () => {
  assert.strictEqual(CELEBRATION_DURATIONS_MS.snow, 3000, 'snow must be exactly 3000 ms');
  assert.strictEqual(CELEBRATION_DURATIONS_MS.schoolpride, 5000, 'school pride must be exactly 5000 ms');
  assert.ok(CELEBRATION_DURATIONS_MS.confetti >= 2000 && CELEBRATION_DURATIONS_MS.confetti <= 5000,
    'confetti window should be short and unobtrusive');
});

check('every kind has a human title; fireworks mentions stopping', () => {
  for (const kind of ['confetti', 'snow', 'schoolpride', 'fireworks']) {
    const t = celebrationTitle(kind);
    assert.ok(t && t.length > 5, 'no title for ' + kind);
  }
  assert.ok(/stop/i.test(celebrationTitle('fireworks')), 'fireworks title must mention how to stop');
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

/* ---------- celebration page (confetti / snow / school pride) ---------- */

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

for (const kind of ['confetti', 'snow', 'schoolpride']) {
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

check('snow page carries the exact 3000 ms schedule', () => {
  const h = celebrationHtml('snow');
  assert.ok(h.includes('"durationMs":3000'), 'snow duration must be 3000');
});

check('celebration pages contain no remote URLs (everything bundled)', () => {
  for (const kind of ['confetti', 'snow', 'schoolpride']) {
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
  assert.ok(src.includes("'confetti'") && src.includes("'snow'") && src.includes("'schoolpride'"),
    'a celebration kind is missing from the controller');
  assert.ok(src.includes('postMessage({ type: \'stop\' })') || src.includes("postMessage({ type: 'stop' });"),
    'controller must be able to stop early');
  assert.ok(src.includes('requestAnimationFrame'), 'effects must be frame-driven');
  assert.ok(src.includes('setTimeout(stop, durationMs)'), 'controller must carry its own schedule');
  new Function(src); /* syntax check */
});

console.log(failures === 0 ? '\nCELEBRATE TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
