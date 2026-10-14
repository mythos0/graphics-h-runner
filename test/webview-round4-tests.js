#!/usr/bin/env node
/**
 * webview-round4-tests.js — v1.5.27 panel liveness ROOT-CAUSE regression
 * tests (Sentry GRAPHICS-H-RUNNER-11: "webview failed to load (no pong
 * after 4 retry renders, ~22 s)" — the third verdict of this class in a
 * row, each round more tolerant, none fixing the cause).
 *
 * REAL CAUSE (proven by the v1.5.27 analysis + the event's breadcrumbs):
 * the verdict clock ran regardless of webview VISIBILITY. VS Code may
 * resolve a restored view while it is NOT visible — a hidden view never
 * loads its iframe, so no page script can ever answer a ping, and the
 * watchdog produced a GUARANTEED false verdict ~22 s later (plus a
 * focus-stealing fallback swap while the user never had the panel open).
 *
 * The fix under test:
 *  1. renderAndWatch() only starts the watch when view.visible is true;
 *     a hidden resolve renders the page but never starts the clock.
 *  2. a retry decision while hidden pauses the watch (lost visibility
 *     event defense) instead of burning the retry budget.
 *  3. the reveal path starts a FRESH watch with a full budget.
 *  4. retry/fallback events carry WebviewWatchDetail (visible, everAlive,
 *     retriesUsed, watchMs, windowFocused) so the next Sentry event NAMES
 *     its real cause instead of inviting a fourth blind round.
 *
 * Drives the REAL provider (out/panelView.js) against a stubbed 'vscode'
 * module and a fake WebviewView with a virtual clock (same harness as
 * webview-round3-tests.js).
 */
'use strict';
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

/* ---- vscode stub (provider needs Uri.file + the provider base class) ---- */
const vscodeStub = {
  Uri: { file: (p) => ({ fsPath: p, path: p }) },
  WebviewViewProvider: class WebviewViewProvider {}
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return origLoad.apply(this, arguments);
};

const { GhPanelProvider } = require(path.join(ROOT, 'out', 'panelView'));

/* ---- virtual clock (same shape as health-tests.js) ---- */
function makeClock() {
  let seq = 0;
  const queue = []; /* {id, at, fn} */
  let now = 0;
  return {
    setTimer(fn, ms) {
      const id = ++seq;
      queue.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      const i = queue.findIndex((t) => t.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue.find((t) => t.at <= target);
        if (!next || guard++ > 10000) break;
        now = Math.max(now, next.at);
        queue.splice(queue.indexOf(next), 1);
        next.fn();
      }
      now = target;
    },
    pending() {
      return queue.length;
    },
    now() {
      return now;
    }
  };
}

/* ---- fake WebviewView ---- */
function makeFakeView(initialVisible) {
  const recorded = {
    htmlSets: [],
    pingsSent: 0,
    messages: [] /* inbound postMessage calls from the extension */
  };
  const messageListeners = [];
  const visibilityListeners = [];
  const disposeListeners = [];
  const webview = {
    cspSource: 'https://*.vscode-cdn.net',
    asWebviewUri: (uri) => 'https://*.vscode-cdn.net/media/' + String(uri.fsPath || uri).split('/').pop(),
    postMessage: async (m) => {
      if (m && m.type === 'ping') recorded.pingsSent++;
      recorded.messages.push(m);
      return true;
    },
    onDidReceiveMessage: (fn) => messageListeners.push(fn)
  };
  const view = {
    webview,
    visible: initialVisible !== false,
    onDidChangeVisibility: (fn) => visibilityListeners.push(fn),
    onDidDispose: (fn) => disposeListeners.push(fn)
  };
  let currentHtml = '';
  Object.defineProperty(webview, 'html', {
    get: () => currentHtml,
    set: (v) => {
      currentHtml = v;
      recorded.htmlSets.push(String(v));
    }
  });
  return {
    view,
    recorded,
    deliver(msg) {
      for (const fn of messageListeners) fn(msg);
    },
    /* visibility flip WITH the workbench event (the normal path) */
    hide() {
      view.visible = false;
      for (const fn of visibilityListeners) fn();
    },
    show() {
      view.visible = true;
      for (const fn of visibilityListeners) fn();
    },
    /* visibility flip WITHOUT the event — models the lost/deferred
     * onDidChangeVisibility delivery the defensive code must survive */
    hideSilently() {
      view.visible = false;
    },
    dispose() {
      for (const fn of disposeListeners) fn();
    }
  };
}

const PROGRAMS = [
  { id: 'demo', title: 'Demo', description: 'demo program', emoji: 'x', filename: 'demo.cpp', tag: 'demo', lab: false }
];

/* tuning: fast + deterministic; the final window uses the fast value too */
const TUNING = {
  healthOptions: {
    pingIntervalMs: 10,
    pingsBeforeRetry: 3,
    pingsBeforeFallback: 3
  },
  recoveryProbeIntervalMs: 10
};

function makeProvider(initialVisible, overrides = {}) {
  const clock = makeClock();
  const timers = { setTimer: clock.setTimer, clearTimer: clock.clearTimer };
  const tuning = JSON.parse(JSON.stringify(TUNING));
  tuning.healthOptions.setTimer = timers.setTimer;
  tuning.healthOptions.clearTimer = timers.clearTimer;
  Object.assign(tuning, overrides);
  const events = []; /* {ev, detail} */
  const clicks = [];
  const provider = new GhPanelProvider(
    ROOT,
    '1.5.27-test',
    PROGRAMS,
    (msg) => clicks.push(msg),
    {
      onWebviewEvent: (ev, detail) => events.push({ ev, detail }),
      onRecoveryPageAlive: () => undefined
    },
    tuning
  );
  const fake = makeFakeView(initialVisible);
  provider.resolveWebviewView(fake.view);
  return { clock, events, clicks, provider, fake, timers };
}

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

const REAL_PAGE_MARK = '<!DOCTYPE html>';
const RECOVERY_MARK = 'The panel could not load.';

console.log('webview-round4-tests — v1.5.27 visibility-gated liveness\n');

check('K. resolve while HIDDEN renders the page but NEVER starts the verdict clock', () => {
  const { clock, events, fake } = makeProvider(false);
  assert.strictEqual(fake.recorded.htmlSets.length, 1, 'exactly one render on a hidden resolve');
  assert.ok(fake.recorded.htmlSets[0].includes(REAL_PAGE_MARK), 'the real panel is prepared for the reveal');
  const pings = fake.recorded.pingsSent;
  clock.advance(500); /* far past the whole retry+fallback budget */
  assert.strictEqual(fake.recorded.pingsSent, pings, 'zero pings into a hidden view');
  assert.deepStrictEqual(events.map((e) => e.ev), [], 'no retry and no verdict while hidden');
});

check('L. hidden resolve then SHOW: fresh watch starts, a booting page proves alive', () => {
  const { clock, events, fake } = makeProvider(false);
  clock.advance(500); /* hidden whole time — nothing happened */
  fake.show();
  clock.advance(10); /* one ping window on the now-visible view */
  assert.ok(fake.recorded.pingsSent > 0, 'the watch begins on the reveal');
  fake.deliver({ type: 'pong' });
  clock.advance(500);
  assert.deepStrictEqual(
    events.map((e) => e.ev).filter((ev) => ev !== 'alive'),
    [],
    'a page that boots on reveal is never verdicted (alive is the success signal)'
  );
});

check('M. doctor re-render while hidden stays passive; reveal starts the first real watch', () => {
  const { clock, events, provider, fake } = makeProvider(false);
  provider.setDoctorResult({ graphicsReady: true, bestLibrary: 'SDL_bgi', compilerCheck: { ok: true } });
  assert.ok(fake.recorded.htmlSets.length >= 2, 'the doctor update re-renders (content freshness)');
  const pings = fake.recorded.pingsSent;
  clock.advance(500);
  assert.strictEqual(fake.recorded.pingsSent, pings, 'still zero pings while hidden');
  fake.show();
  clock.advance(10);
  assert.ok(fake.recorded.pingsSent > pings, 'pings begin only after the reveal');
  assert.ok(!events.some((e) => e.ev === 'fallback'), 'no verdict for the hidden phase');
});

check('N. retry decision while HIDDEN pauses the watch (lost visibility event defense)', () => {
  const { clock, events, fake } = makeProvider(true);
  clock.advance(10); /* 1 unanswered ping on the visible view */
  fake.hideSilently(); /* visibility flip WITHOUT the event — the old code verdicted here */
  clock.advance(500); /* far past the whole budget */
  const retries = events.filter((e) => e.ev === 'retry').length;
  assert.ok(retries <= 1, 'at most the first retry fires before the watch pauses');
  assert.ok(!events.some((e) => e.ev === 'fallback'), 'NO fallback verdict for a hidden view');
  const rendersAfterHide = fake.recorded.htmlSets.length - 1;
  assert.strictEqual(rendersAfterHide, 0, 'no retry renders into a hidden view');
  const pings = fake.recorded.pingsSent;
  clock.advance(500);
  assert.strictEqual(fake.recorded.pingsSent, pings, 'the paused watch sends no pings');
});

check('O. paused-by-hidden watch: the reveal restarts a FRESH full-budget watch', () => {
  const { clock, events, fake } = makeProvider(true);
  clock.advance(10);
  fake.hideSilently();
  clock.advance(500); /* first retry burned, watch paused */
  fake.show(); /* the event arrives now */
  clock.advance(25); /* a full verdict budget on the fresh watch */
  assert.ok(!events.some((e) => e.ev === 'fallback'), 'a page with the FULL budget again cannot be verdicted this fast');
  fake.deliver({ type: 'pong' });
  clock.advance(500);
  assert.ok(!events.some((e) => e.ev === 'fallback'), 'healthy page stays healthy after the reveal');
});

check('P. a visible dead page still verdicts (the real-signal path is intact)', () => {
  const { clock, events, fake } = makeProvider(true);
  clock.advance(200); /* 3+3+3+3 windows -> retry x4, then 3 more -> fallback */
  const retries = events.filter((e) => e.ev === 'retry').length;
  assert.strictEqual(retries, 4, 'four retry renders expected');
  assert.ok(events.some((e) => e.ev === 'fallback'), 'fallback verdict still fires for a visible dead page');
  const lastHtml = fake.recorded.htmlSets[fake.recorded.htmlSets.length - 1];
  assert.ok(lastHtml.includes(RECOVERY_MARK), 'recovery page replaces the dead panel');
});

check('Q. the fallback verdict carries WebviewWatchDetail that names the cause', () => {
  const { clock, events } = makeProvider(true);
  clock.advance(200); /* -> visible verdict */
  const fb = events.find((e) => e.ev === 'fallback');
  assert.ok(fb, 'fallback event fired');
  const d = fb.detail;
  assert.ok(d, 'the verdict carries detail (v1.5.27 telemetry contract)');
  assert.strictEqual(d.visible, true, 'visible=true for a verdict on a visible view');
  assert.strictEqual(d.retriesUsed, 4, 'all four retry renders used');
  assert.strictEqual(d.everAlive, false, 'no page message ever arrived');
  assert.strictEqual(typeof d.watchMs, 'number', 'watchMs is a number');
  assert.ok(d.watchMs >= 0, 'watchMs is non-negative');
  assert.strictEqual(d.windowFocused, undefined, 'window focus is unknown in the stub env (never a crash)');
});

check('R. everAlive=true after the page ran once — "ran then died" is distinguishable', () => {
  const { clock, events, provider, fake } = makeProvider(true);
  clock.advance(10);
  fake.deliver({ type: 'pong' }); /* the page booted and answered */
  provider.reloadPanel(); /* fresh page — and it never answers this time */
  clock.advance(200); /* -> verdict */
  const verdicts = events.filter((e) => e.ev === 'fallback');
  assert.strictEqual(verdicts.length, 1, 'one verdict');
  assert.strictEqual(verdicts[0].detail.everAlive, true, 'everAlive=true: the page RAN earlier this session');
});

check('S. a hidden resolve that later verdicts reports visible=false (never again blind)', () => {
  const { clock, events, fake } = makeProvider(false);
  fake.show();
  clock.advance(200); /* dead page, now visible -> verdict */
  const fb = events.find((e) => e.ev === 'fallback');
  assert.ok(fb, 'verdict after the reveal (fresh watch)');
  assert.strictEqual(fb.detail.visible, true, 'the verdict sees the revealed view');
  assert.strictEqual(fb.detail.everAlive, false, 'the page truly never ran');
});

check('T. fallback while hidden (lost event): recovery page prepared, probe only on reveal', () => {
  const { clock, events, fake } = makeProvider(true);
  clock.advance(10);
  fake.hideSilently();
  clock.advance(500); /* watch pauses at the first retry — no verdict while hidden */
  assert.ok(!events.some((e) => e.ev === 'fallback'), 'no verdict while hidden (see N)');
  fake.show();
  clock.advance(200); /* fresh watch, still dead -> verdict while visible */
  const fb = events.find((e) => e.ev === 'fallback');
  assert.ok(fb, 'verdict on the revealed dead page');
  assert.ok(clock.pending() > 0, 'the recovery probe runs while the recovery page is visible');
  fake.hide();
  assert.strictEqual(clock.pending(), 0, 'the probe stops when hidden again');
  fake.show();
  assert.ok(clock.pending() > 0, 'the probe restarts on the next reveal');
});

console.log(failures === 0 ? '\nWEBVIEW ROUND-4 TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
