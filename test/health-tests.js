#!/usr/bin/env node
/**
 * health-tests.js — unit tests for the webview liveness watchdog
 * (src/webviewHealth.ts -> out/webviewHealth.js) using injected fake timers.
 *
 * Covers the production recovery contract:
 *  - a healthy page (pong) -> state 'alive', no retry / no fallback
 *  - a dead page: retry render once after the first unanswered window,
 *    then fall back to the tree view after the second window
 *  - recovery mid-way (pong after the retry) -> alive, no fallback
 *  - stop()/restart()/reset() semantics used by visibility + reloadPanel
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { WebviewHealth } = require(path.join(ROOT, 'out', 'webviewHealth'));

/** Minimal fake timer queue: deterministic, virtual-time advance. */
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
        if (!next || guard++ > 1000) break;
        now = Math.max(now, next.at); /* reschedules chain from their due time */
        queue.splice(queue.indexOf(next), 1);
        next.fn();
      }
      now = target;
    },
    pending() {
      return queue.length;
    }
  };
}

function makeHarness(opts) {
  const clock = makeClock();
  const events = [];
  const health = WebviewHealth.create(
    {
      ping: () => events.push('ping'),
      retry: () => events.push('retry'),
      fallback: () => events.push('fallback'),
      onEvent: (ev) => events.push('event:' + ev)
    },
    Object.assign({ setTimer: clock.setTimer, clearTimer: clock.clearTimer }, opts)
  );
  return { clock, events, health };
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

console.log('health-tests — webview liveness watchdog\n');

check('initial state is idle and nothing is scheduled', () => {
  const { clock, health } = makeHarness();
  assert.strictEqual(health.getState(), 'idle');
  assert.strictEqual(clock.pending(), 0);
});

check('start() watches; a pong marks alive and stops the timers', () => {
  const { clock, events, health } = makeHarness();
  health.start();
  assert.strictEqual(health.getState(), 'watching');
  clock.advance(300);
  assert.strictEqual(clock.pending(), 1, 'ping tick should be pending');
  health.pong();
  assert.strictEqual(health.getState(), 'alive');
  assert.strictEqual(clock.pending(), 0, 'timers must stop when alive');
  assert.deepStrictEqual(events, ['event:alive']);
});

check('unanswered pings: retry render once after the first window', () => {
  const { clock, events, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 4, pingsBeforeFallback: 4 });
  health.start();
  clock.advance(400);
  assert.ok(events.includes('retry'), 'no retry after 4 unanswered pings');
  assert.strictEqual(events.filter((e) => e === 'retry').length, 1, 'exactly one retry');
  assert.strictEqual(health.getState(), 'watching', 'still watching after retry');
});

check('dead webview: fallback fires after the post-retry window, exactly once', () => {
  const { clock, events, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 4, pingsBeforeFallback: 4 });
  health.start();
  clock.advance(800); /* 4 ticks -> retry, then 4 more -> fallback */
  assert.ok(events.includes('fallback'), 'no fallback after second dead window');
  assert.strictEqual(events.filter((e) => e === 'fallback').length, 1, 'fallback more than once');
  assert.strictEqual(health.getState(), 'fallback');
  assert.strictEqual(clock.pending(), 0, 'timers must stop after fallback');
  assert.ok(events.indexOf('event:retry') < events.indexOf('event:fallback'), 'order must be retry -> fallback');
});

check('recovery after the retry render: pong -> alive, never falls back', () => {
  const { clock, events, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 4, pingsBeforeFallback: 4 });
  health.start();
  clock.advance(400); /* retry happens here */
  assert.ok(events.includes('retry'));
  health.start(); /* the retry hook re-renders and restarts watching */
  health.pong(); /* the re-navigated page answers */
  assert.strictEqual(health.getState(), 'alive');
  clock.advance(1000);
  assert.ok(!events.includes('fallback'), 'must not fall back after recovery');
});

check('late pongs are ignored (stale page cannot fake liveness)', () => {
  const { health } = makeHarness();
  health.start();
  health.stop();
  health.pong();
  assert.strictEqual(health.getState(), 'idle', 'pong after stop must not resurrect the watch');
});

check('stop() pauses watching; start() re-arms (visibility semantics)', () => {
  const { clock, events, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 4, pingsBeforeFallback: 4 });
  health.start();
  clock.advance(250); /* 2 unanswered pings */
  health.stop();
  assert.strictEqual(clock.pending(), 0, 'stop must clear the timer');
  const pingsBefore = events.filter((e) => e === 'ping').length;
  clock.advance(1000);
  assert.strictEqual(events.filter((e) => e === 'ping').length, pingsBefore, 'no pings while stopped');
  health.start();
  clock.advance(100);
  assert.ok(events.filter((e) => e === 'ping').length > pingsBefore, 'pings resume after start');
});

check('reset() clears the retry budget for a user-triggered reload', () => {
  const { clock, events, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 2, pingsBeforeFallback: 2 });
  health.start();
  clock.advance(200); /* retry used */
  health.reset();
  assert.strictEqual(health.getState(), 'idle');
  health.start();
  health.pong();
  assert.strictEqual(health.getState(), 'alive');
  assert.ok(!events.includes('fallback'));
});

check('fallback state survives stop/start (dead webview never resurrects itself)', () => {
  const { clock, health } = makeHarness({ pingIntervalMs: 100, pingsBeforeRetry: 2, pingsBeforeFallback: 2 });
  health.start();
  clock.advance(400); /* -> fallback */
  health.start(); /* provider guards, but the FSM must also hold the line */
  assert.strictEqual(health.getState(), 'fallback', 'start() must not clear a fallback verdict');
});

check('default options are production-tuned (1s ping, 4+4 pings)', () => {
  const { clock, events, health } = makeHarness();
  health.start();
  clock.advance(4000); /* 4 ticks at the default 1000ms */
  assert.ok(events.includes('retry'), 'default retry window should be ~4s');
  clock.advance(4000);
  assert.ok(events.includes('fallback'), 'default fallback window should be ~8s total');
});

console.log(failures === 0 ? '\nHEALTH TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
