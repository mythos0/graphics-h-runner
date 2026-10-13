#!/usr/bin/env node
/**
 * webview-round3-tests.js — v1.5.26 panel resilience regression tests
 * (Sentry GRAPHICS-H-RUNNER-S: "webview failed to load (no pong after 2
 * retry renders)" kept firing on v1.5.25 builds).
 *
 * Drives the REAL provider (out/panelView.js) against a stubbed 'vscode'
 * module and a fake WebviewView with a virtual clock:
 *
 *  A. boot renders the real page and starts pinging
 *  B. ANY page message (a click) proves liveness — no false verdict
 *  C. a dead page gets FOUR retry renders, then the recovery page
 *  D. the recovery page is PROBED, and a probe pong reports
 *     onRecoveryPageAlive exactly once (latched)
 *  E. postState re-render mid-watch resets the ping counter (no stale
 *     counts -> no false retry / false fallback)
 *  F. page script-error reports are forwarded to the extension host
 *  G. reloadPanel() brings the real page back and re-arms everything
 *  H. hiding the panel stops the probe; showing it restarts it
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
function makeFakeView() {
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
    visible: true,
    onDidChangeVisibility: (fn) => visibilityListeners.push(fn),
    onDidDispose: (fn) => disposeListeners.push(fn)
  };
  /* the provider assigns html directly on webview — record via defineProperty */
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
    hide() {
      view.visible = false;
      for (const fn of visibilityListeners) fn();
    },
    show() {
      view.visible = true;
      for (const fn of visibilityListeners) fn();
    },
    dispose() {
      for (const fn of disposeListeners) fn();
    }
  };
}

const PROGRAMS = [
  { id: 'demo', title: 'Demo', description: 'demo program', emoji: 'x', filename: 'demo.cpp', tag: 'demo', lab: false }
];

/* tuning: fast + deterministic */
const TUNING = {
  healthOptions: {
    pingIntervalMs: 10,
    pingsBeforeRetry: 3,
    pingsBeforeFallback: 3
  },
  recoveryProbeIntervalMs: 10
};

function makeProvider(overrides = {}) {
  const clock = makeClock();
  const timers = { setTimer: clock.setTimer, clearTimer: clock.clearTimer };
  const tuning = JSON.parse(JSON.stringify(TUNING));
  tuning.healthOptions.setTimer = timers.setTimer;
  tuning.healthOptions.clearTimer = timers.clearTimer;
  const events = [];
  const clicks = [];
  let recoveryAlive = 0;
  const provider = new GhPanelProvider(
    ROOT,
    '1.5.26-test',
    PROGRAMS,
    (msg) => clicks.push(msg),
    {
      onWebviewEvent: (ev) => events.push(ev),
      onRecoveryPageAlive: () => recoveryAlive++
    },
    tuning
  );
  const fake = makeFakeView();
  provider.resolveWebviewView(fake.view);
  return { clock, events, clicks, provider, fake, recoveryAlive: () => recoveryAlive, timers };
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

console.log('webview-round3-tests — v1.5.26 panel resilience\n');

check('A. boot renders the real page and pings it', () => {
  const { clock, fake, events } = makeProvider();
  assert.strictEqual(fake.recorded.htmlSets.length, 1, 'one html render on resolve');
  assert.ok(fake.recorded.htmlSets[0].includes(REAL_PAGE_MARK), 'first render must be the real panel');
  assert.ok(fake.recorded.htmlSets[0].includes('script-error'), 'page must carry the v1.5.26 crash trap');
  clock.advance(10);
  assert.ok(fake.recorded.pingsSent > 0, 'watchdog pings the page');
  assert.deepStrictEqual(events, [], 'no lifecycle events while nothing happened');
});

check('B. ANY page message proves liveness (click before a pong)', () => {
  const { clock, events, fake } = makeProvider();
  clock.advance(20); /* 2 unanswered pings — watching, below the retry threshold */
  fake.deliver({ type: 'command', command: 'graphics-h-runner.doctor' });
  clock.advance(500);
  assert.ok(!events.includes('retry'), 'a real click must prevent retry renders');
  assert.ok(!events.includes('fallback'), 'a real click must prevent the fallback verdict');
});

check('C. dead page: FOUR retry renders, then the recovery page', () => {
  const { clock, events, fake } = makeProvider();
  clock.advance(200); /* 3+3+3+3 windows -> retry x4, then 3 more -> fallback */
  const retries = events.filter((e) => e === 'retry').length;
  assert.strictEqual(retries, 4, 'four retry renders expected');
  assert.ok(events.includes('fallback'), 'fallback verdict after the retry budget');
  const lastHtml = fake.recorded.htmlSets[fake.recorded.htmlSets.length - 1];
  assert.ok(lastHtml.includes(RECOVERY_MARK), 'recovery page must replace the dead panel');
  assert.ok(lastHtml.includes('probe: true') || lastHtml.includes('probe'), 'recovery page must answer probes');
  assert.ok(events.indexOf('retry') < events.indexOf('fallback'), 'order: retries then fallback');
});

check('D. recovery page is probed; a probe pong reports onRecoveryPageAlive once', () => {
  const { clock, events, fake, recoveryAlive } = makeProvider();
  clock.advance(200); /* -> fallback + recovery page */
  assert.ok(events.includes('fallback'));
  const pingsBeforeProbe = fake.recorded.pingsSent;
  clock.advance(50); /* probe interval 10ms -> several probe pings */
  assert.ok(fake.recorded.pingsSent > pingsBeforeProbe, 'probe pings the recovery page');
  const pongsBefore = fake.recorded.messages.filter((m) => m.type === 'ping').length;
  assert.ok(pongsBefore > 0, 'probe messages are pings');
  fake.deliver({ type: 'pong', probe: true });
  assert.strictEqual(recoveryAlive(), 1, 'onRecoveryPageAlive fires exactly once');
  fake.deliver({ type: 'pong', probe: true });
  assert.strictEqual(recoveryAlive(), 1, 'latched: no second report in the same episode');
  /* a BOOT pong (no probe flag) must not trigger the hook */
  fake.deliver({ type: 'pong' });
  assert.strictEqual(recoveryAlive(), 1, 'plain boot pong never triggers the recovery hook');
});

check('E. postState re-render mid-watch resets stale ping counts', () => {
  const { clock, events, provider, fake } = makeProvider();
  clock.advance(20); /* 2 unanswered pings on the first page */
  provider.setDoctorResult({ graphicsReady: true, bestLibrary: 'SDL_bgi', compilerCheck: { ok: true } });
  /* re-render + watchdog restart happened. 2 more unanswered pings on the
   * FRESH page: with the old stale-count carryover (2+2=4 >= threshold 3)
   * this fired a premature retry render of the brand-new page. */
  clock.advance(20);
  assert.ok(!events.includes('retry'), 'no premature retry from stale counts');
  assert.ok(!events.includes('fallback'), 'no false fallback after a doctor re-render');
  fake.deliver({ type: 'pong' }); /* fresh page answers */
  clock.advance(200);
  assert.ok(!events.includes('fallback'), 'healthy page stays healthy');
});

check('F. script-error reports are forwarded to the extension host', () => {
  const { clock, clicks, events, fake } = makeProvider();
  clock.advance(10);
  clicks.length = 0;
  fake.deliver({ type: 'script-error', message: 'boom in panel.js', line: 42, col: 7 });
  const err = clicks.find((m) => m.type === 'script-error');
  assert.ok(err, 'script-error must reach the extension click router');
  assert.strictEqual(err.message, 'boom in panel.js');
  assert.strictEqual(err.line, 42);
  /* it also proves liveness */
  clock.advance(200);
  assert.ok(!events.includes('fallback'), 'a page that reports errors is ALIVE');
});

check('G. reloadPanel() restores the real page and re-arms the watchdog', () => {
  const { clock, events, provider, fake } = makeProvider();
  clock.advance(200); /* -> fallback */
  assert.ok(events.includes('fallback'));
  assert.strictEqual(provider.isFallbackActive(), true, 'fallback active after the verdict');
  provider.reloadPanel();
  assert.strictEqual(provider.isFallbackActive(), false, 'reloadPanel clears the fallback');
  const lastHtml = fake.recorded.htmlSets[fake.recorded.htmlSets.length - 1];
  assert.ok(lastHtml.includes(REAL_PAGE_MARK) && !lastHtml.includes(RECOVERY_MARK), 'real page restored');
  clock.advance(10);
  fake.deliver({ type: 'pong' });
  clock.advance(200);
  assert.strictEqual(events.filter((e) => e === 'fallback').length, 1, 'restored page answers — no second verdict');
});

check('H. hiding the panel stops the recovery probe; showing restarts it', () => {
  const { clock, fake } = makeProvider();
  clock.advance(200); /* -> fallback + probe running */
  const pendBefore = clock.pending();
  assert.ok(pendBefore > 0, 'probe timer is pending while visible');
  fake.hide();
  assert.strictEqual(clock.pending(), 0, 'probe + watchdog stop when hidden');
  const pings = fake.recorded.pingsSent;
  clock.advance(500);
  assert.strictEqual(fake.recorded.pingsSent, pings, 'no probe pings while hidden');
  fake.show();
  assert.ok(clock.pending() > 0, 'probe restarts when shown (fallback still active)');
});

check('I. probe pong after reloadPanel re-arms the latch for the next episode', () => {
  const { clock, events, fake, provider, recoveryAlive } = makeProvider();
  clock.advance(200); /* episode 1: fallback */
  fake.deliver({ type: 'pong', probe: true });
  assert.strictEqual(recoveryAlive(), 1);
  provider.reloadPanel(); /* real page back */
  clock.advance(200); /* episode 2: dead again -> fallback */
  assert.strictEqual(events.filter((e) => e === 'fallback').length, 2, 'second verdict in episode 2');
  fake.deliver({ type: 'pong', probe: true });
  assert.strictEqual(recoveryAlive(), 2, 'latch re-armed per episode');
});

console.log(failures === 0 ? '\nWEBVIEW ROUND-3 TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
