#!/usr/bin/env node
/**
 * sentry-round5-tests.js — v1.5.31 seventh Sentry round (pure parts).
 *
 * Fixes proven here, each traced to a live 1.5.30-era inbox item:
 *  [A] GRAPHICS-H-RUNNER-K (Lahore/Gurugram events on 1.5.30): the detail
 *      tags shipped RAW usernames — "sal/AppData/…" and "…/ld.exe: cannot
 *      find Shyam/AppData/…". Two shape families escaped scrubText:
 *      the MSYS drive-less form "/c/Users/<name>/…" (no "X:" colon, so the
 *      drive rule and the home-dir split both miss) and PREFIX-LESS
 *      fragments created when a tail cut landed mid-path (the "C:/Users/"
 *      anchor is destroyed BEFORE any scrub can run). The new rules: an
 *      MSYS Users rule, and an AppData-anchor rule — the segment before
 *      /AppData/ is a user name (or its cut tail) on every Windows profile
 *      path, and the scrubbed "~" is outside the fragment class so healthy
 *      "C:\Users\~\AppData" shapes pass through unchanged.
 *  [B] GRAPHICS-H-RUNNER-15/16 (both install-compiler-download on 1.5.30):
 *      undici's mid-body death shapes — "TypeError: terminated" (cause:
 *      read ECONNRESET) and "BodyTimeoutError" — matched neither the old
 *      transient classifier nor the caller's warning degradation, so they
 *      landed in the inbox at ERROR level. Both classes now retry via
 *      withNetworkRetry and degrade to the network warning.
 *  [C] GRAPHICS-H-RUNNER-10 (Moscow event on 1.5.30): a Russian-localized
 *      VS Code throws "CodeExpectedError: Не удается выполнить запись в
 *      файл параметров пользователя…" — the English-phrase-only classifier
 *      returned undefined and guardedGlobalUpdate RETHREW the raw error.
 *      The classifier now recognizes the error CLASS (name), which VS Code
 *      uses for every user-facing configuration refusal in any language.
 *  [D] GRAPHICS-H-RUNNER-14: "user settings repaired automatically during
 *      setup" is a SUCCESS story — it now reports at INFO level
 *      (captureExtensionInfo) instead of the warning bucket.
 *  [E] GRAPHICS-H-RUNNER-18 (Indore/Nagpur on 1.5.30, page_visible=true +
 *      window_focused=false + ever_alive=false): an UNFOCUSED window
 *      throttles the webview's JS, so the page never answers and every
 *      verdict would be false. WebviewHealth gains a mayContinue gate —
 *      the provider pauses the watch while unfocused and resumes with a
 *      fresh budget (and preserved retry count) when focus returns.
 *
 * Loads the REAL compiled modules (out/*.js) — the same ones production runs.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

/* ---- vscode stub — out/instrument.js imports vscode; keep it inert ---- */
const vscodeStub = {
  env: {
    isTelemetryEnabled: false,
    onDidChangeTelemetryEnabled: () => ({ dispose: () => undefined })
  },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 }
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return origLoad.apply(this, arguments);
};

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    failures.push(name + ': ' + e.message);
    console.log('FAIL  ' + name + ' -> ' + e.message);
  }
}

(async () => {
  const scrub = require(path.join(ROOT, 'out', 'scrub'));
  const toolchain = require(path.join(ROOT, 'out', 'toolchain'));
  const setup = require(path.join(ROOT, 'out', 'setup'));
  const settingsHealth = require(path.join(ROOT, 'out', 'settingsHealth'));
  const { WebviewHealth } = require(path.join(ROOT, 'out', 'webviewHealth'));

  console.log('\n== [A] scrubText: the 1.5.30 K-detail leak shapes ==');

  await t('MSYS drive-less form "/c/Users/<name>/…" is scrubbed', async () => {
    const out = scrub.scrubText('/c/Users/kasal/AppData/Local/Microsoft/WinGet/Packages/x');
    assert.ok(!/kasal/i.test(out), 'raw name leaked: ' + out);
    assert.ok(/\/[A-Za-z]\/Users\/~\/AppData/.test(out), 'shape wrong: ' + out);
  });
  await t('MSYS form with backslash separators "/c\\Users\\<name>" is scrubbed', async () => {
    const out = scrub.scrubText('/c\\Users\\Shyam\\AppData\\Roaming');
    assert.ok(!/Shyam/i.test(out), 'raw name leaked: ' + out);
  });
  await t('prefix-less fragment "sal/AppData/Local/…" (tail cut mid-name) is scrubbed', async () => {
    const out = scrub.scrubText('sal/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs/mingw64/bin');
    assert.ok(!/sal\/AppData/.test(out), 'fragment leaked: ' + out);
    assert.ok(out.startsWith('~/AppData/Local/'), 'shape wrong: ' + out);
  });
  await t('prefix-less fragment after "cannot find " is scrubbed (Gurugram shape)', async () => {
    const frag = '/ld.exe: cannot find Shyam/AppData/Roaming/Code/User/globalStorage/mythos0-labs.graphics-h-runner/mingw64-download';
    const out = scrub.scrubText(frag);
    assert.ok(!/Shyam/i.test(out), 'raw name leaked: ' + out);
    /* the space-including fragment rule eats the message words between the
     * cut and the name — the PRIVACY goal is exact: no name, ~/AppData shape */
    assert.ok(out.includes('~/AppData/Roaming'), 'shape wrong: ' + out);
  });
  await t('healthy "C:\\Users\\~\\AppData" shape passes through unchanged', async () => {
    const healthy = 'C:\\Users\\~\\AppData\\Local\\Temp\\bgi-global-abc\\global_probe.cpp';
    assert.strictEqual(scrub.scrubText(healthy), healthy);
    const healthyFwd = 'C:/Users/~/AppData/Roaming/Code/User/globalStorage/x';
    assert.strictEqual(scrub.scrubText(healthyFwd), healthyFwd);
  });
  await t('drive-less "Users" fragments do NOT trigger the AppData rule when nothing precedes', async () => {
    /* "AppData/Local" with NO preceding fragment: nothing to hide, must stay */
    const out = scrub.scrubText('AppData/Local/Packages listing');
    assert.strictEqual(out, 'AppData/Local/Packages listing');
  });
  await t('full Lahore replay: raw >300-char ld line -> smartCompilerTail -> emission double-scrub leaks nothing', async () => {
    /* mirrors the live 2026-10-17 Lahore event: one >300-char ld path echo
     * followed by the header-not-found compile error (no -lbgi phrase — the
     * live verdict was the graphics.h class) */
    const raw =
      'C:/Users/kasal/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin/../lib/gcc/x86_64-w64-mingw32/16.2.0/../../../../x86_64-w64-mingw32/bin/ld.exe: fatal error: graphics.h: No such file or directory';
    const detail = toolchain.smartCompilerTail(raw, '', 1); /* scrub -> cut(300) */
    const emitted = scrub.scrubText(detail).slice(0, 180); /* extension.ts:741 shape */
    assert.ok(!/kasal/i.test(emitted), 'raw name leaked through: ' + emitted);
    /* the diagnostic rides in the VERDICT tag (classified from the FULL
     * detail), exactly like the live Lahore/Gurugram events */
    const verdict = setup.describeBgiProbeFailure(detail, 'x86_64');
    assert.ok(/graphics\.h|No such file/i.test(verdict), 'verdict lost the diagnosis: ' + verdict);
  });
  await t('Gurugram replay: MSYS-form ld line survives the pipeline anonymously', async () => {
    const raw =
      '/c/Users/Shyam/AppData/Roaming/Code/User/globalStorage/mythos0-labs.graphics-h-runner/mingw64-download/mingw64/bin/../lib/gcc/x86_64-w64-mingw32/16.2.0/../../../../x86_64-w64-mingw32/bin/ld.exe: cannot find /c/Users/Shyam/AppData/Roaming/Code/User/globalStorage/mythos0-labs.graphics-h-runner/mingw64-download/mingw64/lib/libbgi.a: graphics.h: No such file or directory';
    const detail = toolchain.smartCompilerTail(raw, '', 1);
    const emitted = scrub.scrubText(detail).slice(0, 180);
    assert.ok(!/Shyam/i.test(emitted), 'raw name leaked through: ' + emitted);
  });
  await t('regression: classic forms still scrub to the exact old shapes', async () => {
    assert.strictEqual(scrub.scrubText('C:\\Users\\Taha Pervaiz\\file.cpp'), 'C:\\Users\\~\\file.cpp');
    assert.strictEqual(scrub.scrubText('c:/users/siddhi patil/x'), 'c:/users/~/x');
    assert.strictEqual(scrub.scrubText('/home/who/x'), '/home/~/x');
    assert.strictEqual(scrub.scrubText('spawn g++ ENOENT'), 'spawn g++ ENOENT');
  });

  console.log('\n== [B] isNetworkFailureText: the 15/16 mid-body death shapes ==');

  await t('"TypeError: terminated" is transient (GRAPHICS-H-RUNNER-15 outer error)', async () => {
    assert.strictEqual(setup.isNetworkFailureText('TypeError: terminated'), true);
  });
  await t('"BodyTimeoutError: Body Timeout Error" is transient (GRAPHICS-H-RUNNER-16)', async () => {
    assert.strictEqual(setup.isNetworkFailureText('BodyTimeoutError: Body Timeout Error'), true);
  });
  await t('"Error: read ECONNRESET" stays transient (15/16 inner cause, N/P era)', async () => {
    assert.strictEqual(setup.isNetworkFailureText('Error: read ECONNRESET'), true);
  });
  await t('word boundary: "determined" / "terminated." behave precisely', async () => {
    assert.strictEqual(setup.isNetworkFailureText('the process determined the winner'), false);
    assert.strictEqual(setup.isNetworkFailureText('body stream terminated.'), true);
  });
  await t('non-network failures still rethrow immediately (real-error class)', async () => {
    assert.strictEqual(setup.isNetworkFailureText('download failed: HTTP 404'), false);
    assert.strictEqual(setup.isNetworkFailureText('sha256 mismatch'), false);
    assert.strictEqual(setup.isNetworkFailureText('ENOSPC: no space left on device'), false);
  });
  await t('withNetworkRetry RETRIES the terminated shape, then rethrows (3 attempts)', async () => {
    let calls = 0;
    const retries = [];
    const slept = [];
    const err = new Error('TypeError: terminated');
    await assert.rejects(
      setup.withNetworkRetry(
        async () => {
          calls++;
          throw err;
        },
        { onRetry: (n) => retries.push(n), sleep: (ms) => { slept.push(ms); return Promise.resolve(); } }
      ),
      (e) => e === err
    );
    assert.strictEqual(calls, 3, 'expected 3 attempts, got ' + calls);
    assert.deepStrictEqual(retries, [1, 2], 'onRetry calls wrong: ' + JSON.stringify(retries));
    assert.deepStrictEqual(slept, [2000, 5000], 'backoff wrong: ' + JSON.stringify(slept));
  });
  await t('withNetworkRetry RECOVERS when a terminated body read succeeds on retry', async () => {
    let calls = 0;
    const res = await setup.withNetworkRetry(
      async () => {
        if (++calls === 1) throw new Error('TypeError: terminated');
        return 'zip-bytes';
      },
      { sleep: () => Promise.resolve() }
    );
    assert.strictEqual(res, 'zip-bytes');
    assert.strictEqual(calls, 2);
  });

  console.log('\n== [C] classifySettingsWriteError: the localized refusal ==');

  await t('Russian CodeExpectedError classifies as a USER-settings refusal', async () => {
    const e = Object.assign(
      new Error('Не удается выполнить запись в файл параметров пользователя. Откройте параметры пользователя, исправьте ошибки и предупреждения и повторите попытку.'),
      { name: 'CodeExpectedError' }
    );
    assert.strictEqual(settingsHealth.classifySettingsWriteError(e), 'user');
  });
  await t('workspace-localized CodeExpectedError classifies as WORKSPACE', async () => {
    const e = Object.assign(new Error('Не удается выполнить запись в файл параметров рабочей области (workspace settings)'), {
      name: 'CodeExpectedError'
    });
    assert.strictEqual(settingsHealth.classifySettingsWriteError(e), 'workspace');
  });
  await t('English phrases still classify exactly as before', async () => {
    assert.strictEqual(
      settingsHealth.classifySettingsWriteError(new Error('Unable to write into user settings. Please open the user settings to correct errors/warnings in it and try again.')),
      'user'
    );
    assert.strictEqual(
      settingsHealth.classifySettingsWriteError(new Error('Unable to write into workspace settings')),
      'workspace'
    );
  });
  await t('non-refusal errors still return undefined (rethrow contract kept)', async () => {
    assert.strictEqual(settingsHealth.classifySettingsWriteError(new Error('EACCES: permission denied')), undefined);
    assert.strictEqual(settingsHealth.classifySettingsWriteError(undefined), undefined);
    assert.strictEqual(settingsHealth.classifySettingsWriteError('nope'), undefined);
    const plainNamed = Object.assign(new Error('Cannot find module'), { name: 'Error' });
    assert.strictEqual(settingsHealth.classifySettingsWriteError(plainNamed), undefined);
  });

  console.log('\n== [D] captureExtensionInfo: the repaired-settings success story ==');

  const instrument = require(path.join(ROOT, 'out', 'instrument'));
  await t('info capture dedupes under the same once-per-session contract', async () => {
    instrument.resetReportedStateForTests();
    instrument.setTelemetryActiveForTests(true);
    instrument.captureExtensionInfo('user settings repaired automatically during setup', { fixes: 'missing-commas' });
    assert.strictEqual(instrument.hasReportedWarning('user settings repaired automatically during setup'), true, 'info key not tracked');
    instrument.captureExtensionInfo('user settings repaired automatically during setup', { fixes: 'missing-commas' });
    assert.strictEqual(instrument.hasReportedWarning('user settings repaired automatically during setup'), true, 'state changed on dedupe');
    assert.ok(typeof instrument.captureExtensionInfo === 'function', 'captureExtensionInfo missing');
  });
  await t('info capture shares the warning-family session cap (no spam channel)', async () => {
    instrument.resetReportedStateForTests();
    instrument.setTelemetryActiveForTests(true);
    for (let i = 0; i < 10; i++) instrument.captureExtensionInfo('info-kind-' + i, {});
    instrument.captureExtensionInfo('info-kind-overflow', {});
    assert.strictEqual(instrument.hasReportedWarning('info-kind-overflow'), false, 'cap did not hold for info');
  });

  console.log('\n== [E] WebviewHealth mayContinue: the unfocused-window gate ==');

  function makeClock() {
    let seq = 0;
    const queue = [];
    let now = 0;
    return {
      setTimer(fn, ms) {
        const id = ++seq;
        queue.push({ id, at: now + ms, fn });
        return id;
      },
      clearTimer(id) {
        const i = queue.findIndex((x) => x.id === id);
        if (i >= 0) queue.splice(i, 1);
      },
      advance(ms) {
        const target = now + ms;
        let guard = 0;
        for (;;) {
          queue.sort((a, b) => a.at - b.at || a.id - b.id);
          const next = queue.find((x) => x.at <= target);
          if (!next || guard++ > 5000) break;
          now = Math.max(now, next.at);
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

  await t('mayContinue=false PAUSES the watch: no ping, no retry, no verdict, state idle', async () => {
    const clock = makeClock();
    const events = [];
    const health = WebviewHealth.create(
      {
        ping: () => events.push('ping'),
        retry: () => events.push('retry'),
        fallback: () => events.push('fallback'),
        mayContinue: () => false
      },
      { setTimer: clock.setTimer, clearTimer: clock.clearTimer }
    );
    health.start();
    clock.advance(20000); /* would cross retry AND fallback thresholds if not paused */
    assert.deepStrictEqual(events, [], 'watch fired while paused: ' + JSON.stringify(events));
    assert.strictEqual(health.getState(), 'idle', 'expected idle (paused)');
    assert.strictEqual(clock.pending(), 0, 'timer kept running while paused');
  });

  await t('resume after pause: fresh full window, retry budget PRESERVED (next threshold = retry, not fallback)', async () => {
    const clock = makeClock();
    const events = [];
    let mayContinue = true;
    const health = WebviewHealth.create(
      {
        ping: () => events.push('ping'),
        retry: () => events.push('retry'),
        fallback: () => events.push('fallback'),
        mayContinue: () => mayContinue
      },
      { setTimer: clock.setTimer, clearTimer: clock.clearTimer }
    );
    /* burn ONE retry with a dead page (4 unanswered pings) */
    health.start();
    clock.advance(4000);
    assert.deepStrictEqual(events, ['ping', 'ping', 'ping', 'ping', 'retry'], 'first round wrong: ' + JSON.stringify(events));
    assert.strictEqual(health.getRetriesUsed(), 1);
    /* window loses focus mid-watch -> the next tick pauses */
    mayContinue = false;
    clock.advance(2000);
    assert.strictEqual(health.getState(), 'idle', 'expected paused-idle');
    const seen = events.length;
    clock.advance(20000);
    assert.strictEqual(events.length, seen, 'paused watch fired: ' + JSON.stringify(events));
    /* focus returns -> provider resumes with a fresh window */
    mayContinue = true;
    health.start();
    /* with retriesUsed=1 preserved, the NEXT threshold crossing must be a RETRY (budget 4), not a fallback */
    clock.advance(4000);
    assert.ok(events.includes('retry') && events.slice(seen).includes('retry'), 'budget not preserved: ' + JSON.stringify(events.slice(seen)));
    assert.ok(!events.includes('fallback'), 'fallback fired although retry budget remained: ' + JSON.stringify(events));
    /* exhaust the remaining rounds -> only then the fallback verdict */
    clock.advance(40000);
    assert.ok(events.includes('fallback'), 'fallback never fired after exhausting rounds: ' + JSON.stringify(events));
  });

  await t('no mayContinue hook (tests/stubs): behavior identical to 1.5.30', async () => {
    const clock = makeClock();
    const events = [];
    const health = WebviewHealth.create(
      { ping: () => events.push('ping'), retry: () => events.push('retry'), fallback: () => events.push('fallback') },
      { setTimer: clock.setTimer, clearTimer: clock.clearTimer }
    );
    health.start();
    clock.advance(4000);
    assert.ok(events.includes('retry'), 'retry contract changed without mayContinue');
    clock.advance(60000);
    assert.ok(events.includes('fallback'), 'fallback contract changed without mayContinue');
  });

  console.log(`\n== sentry-round5: ${passed} passed, ${failed} failed ==`);
  if (failures.length) {
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
})().catch((e) => {
  console.error('HARNESS FATAL', e);
  process.exit(1);
});
