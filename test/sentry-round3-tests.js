#!/usr/bin/env node
/**
 * sentry-round3-tests.js — v1.5.29 fixes for the third Sentry round
 * (issues still firing ON v1.5.27 builds):
 *
 *  GRAPHICS-H-RUNNER-12 ("setup download network failure",
 *    setup_step=install-compiler-download, "TypeError: fetch failed"):
 *    one transient hiccup aborted the 274 MB WinLibs download.
 *    Fix: withNetworkRetry — the download phase is retried (2 s / 5 s)
 *    on transient network errors only; real failures rethrow at once.
 *
 *  GRAPHICS-H-RUNNER-M ("setup verify not ready", detail "winbgim:
 *    skipped — compiler is not available", compilerOk=false): the SAME
 *    machine had fired GRAPHICS-H-RUNNER-12 ten seconds earlier — the
 *    compiler download lost the network, so the verify could never pass
 *    and fired a SECOND warning for ONE cause. Also: every ACTION NEEDED
 *    run (terminal steps pending) ended in the same expected NOT READY.
 *    Fix: in-run cause tracking — the verify warning fires only when
 *    nothing earlier in the run explains the failure
 *    (shouldReportVerifyFailure).
 *
 *  GRAPHICS-H-RUNNER-F ("make-global probe failed", detail "copy into
 *    C:\Program Files\CodeBlocks\MinGW\include failed: EPERM"): the
 *    toolchain is administrators-only, so the copies can NEVER succeed —
 *    an expected property of the machine, not a defect.
 *    Fix: writability preflight in makeGlobalWindows (skip + explain the
 *    admin route, count notWritableSkips / probeAttempts) and the caller
 *    suppresses the telemetry warning exactly when no candidate could be
 *    attempted (shouldReportMakeGlobalFailure).
 *
 *  GRAPHICS-H-RUNNER-11: single event from a v1.5.26 build, one hour
 *    before v1.5.27 shipped the visibility-gated watchdog — no code
 *    change in this round; verified via the release notes only.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const setup = require(path.join(ROOT, 'out', 'setup'));
const globalize = require(path.join(ROOT, 'out', 'globalize'));

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, err: e });
    console.log('  FAIL - ' + name + ': ' + e.message);
  }
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
(async () => {
  console.log('withNetworkRetry (setup)');

  await t('retries a transient failure and succeeds; onRetry sees the attempt', async () => {
    let calls = 0;
    const retries = [];
    const result = await setup.withNetworkRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('TypeError: fetch failed');
        return 'zip-bytes';
      },
      {
        sleep: async () => { /* no wait in tests */ },
        onRetry: (attempt, err) => retries.push({ attempt, msg: String(err.message) })
      }
    );
    assert.strictEqual(result, 'zip-bytes');
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(retries.map((r) => r.attempt), [1, 2]);
    assert.ok(retries[0].msg.includes('fetch failed'));
  });

  await t('a NON-transient failure rethrows immediately (single call)', async () => {
    let calls = 0;
    await assert.rejects(
      setup.withNetworkRetry(async () => {
        calls++;
        throw new Error('download failed: HTTP 404');
      }, { sleep: async () => {} }),
      /HTTP 404/
    );
    assert.strictEqual(calls, 1, 'must not retry a real failure');
  });

  await t('gives up after the attempt budget and rethrows the LAST error', async () => {
    let calls = 0;
    await assert.rejects(
      setup.withNetworkRetry(async () => {
        calls++;
        throw new Error('ConnectTimeoutError');
      }, { attempts: 3, sleep: async () => {} }),
      /ConnectTimeoutError/
    );
    assert.strictEqual(calls, 3);
  });

  await t('default transient classifier = isNetworkFailureText; custom one honored', async () => {
    let calls = 0;
    // default: "socket hang up" is transient → retried until success
    const ok = await setup.withNetworkRetry(async () => {
      calls++;
      if (calls < 2) throw new Error('socket hang up');
      return true;
    }, { sleep: async () => {} });
    assert.ok(ok);
    // custom classifier that rejects everything → immediate throw
    let calls2 = 0;
    await assert.rejects(
      setup.withNetworkRetry(async () => {
        calls2++;
        throw new Error('TypeError: fetch failed');
      }, { isTransient: () => false, sleep: async () => {} })
    );
    assert.strictEqual(calls2, 1);
  });

  await t('zero-attempt budget still runs once (attempts floored at 1)', async () => {
    let calls = 0;
    await assert.rejects(
      setup.withNetworkRetry(async () => { calls++; throw new Error('ETIMEDOUT'); }, { attempts: 0, sleep: async () => {} }),
      /ETIMEDOUT/
    );
    assert.strictEqual(calls, 1);
  });

  /* ---------------------------------------------------------------- */
  console.log('shouldReportVerifyFailure (setup)');

  await t('unexplained failure → report (v1.5.11 observability preserved)', () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: false }), true);
  });
  await t('an earlier install failure explains the not-ready → suppress', () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: true, sawActionNeeded: false }), false);
  });
  await t('pending ACTION NEEDED explains the not-ready → suppress', () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: true }), false);
  });
  await t('both → suppress', () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: true, sawActionNeeded: true }), false);
  });

  /* ---------------------------------------------------------------- */
  console.log('shouldReportMakeGlobalFailure (setup)');

  await t('probe ok → never report', () => {
    assert.strictEqual(setup.shouldReportMakeGlobalFailure({ globalProbeOk: true, probeAttempts: 1, notWritableSkips: 0 }), false);
  });
  await t('a real probe attempt failed → report (genuine signal)', () => {
    assert.strictEqual(setup.shouldReportMakeGlobalFailure({ globalProbeOk: false, probeAttempts: 1, notWritableSkips: 0 }), true);
  });
  await t('ALL candidates skipped as not writable → suppress (GRAPHICS-H-RUNNER-F)', () => {
    assert.strictEqual(setup.shouldReportMakeGlobalFailure({ globalProbeOk: false, probeAttempts: 0, notWritableSkips: 2 }), false);
  });
  await t('mixed: one skip + one failed probe → still report', () => {
    assert.strictEqual(setup.shouldReportMakeGlobalFailure({ globalProbeOk: false, probeAttempts: 1, notWritableSkips: 1 }), true);
  });

  /* ---------------------------------------------------------------- */
  console.log('makeGlobalWindows writability preflight (real fs)');

  function buildToolchain(opts) {
    const root = tmpdir('ghr-r3-toolchain-');
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bin', 'g++.exe'), ''); // location check
    fs.chmodSync(path.join(root, 'bin'), 0o755);
    if (!opts.leaveUnwritable) {
      fs.mkdirSync(path.join(root, 'include'), { recursive: true });
      fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    }
    return root;
  }

  function buildWinbgimStorage() {
    const storage = tmpdir('ghr-r3-storage-');
    fs.mkdirSync(path.join(storage, 'winbgim', 'include'), { recursive: true });
    fs.mkdirSync(path.join(storage, 'winbgim', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(storage, 'winbgim', 'include', 'graphics.h'), '/* gfx */\n');
    fs.writeFileSync(path.join(storage, 'winbgim', 'include', 'winbgim.h'), '/* wb */\n');
    fs.writeFileSync(path.join(storage, 'winbgim', 'lib', 'libbgi.a'), 'AR!\n');
    return storage;
  }

  const stubRunner = (probeCode) => async (cmd, args) => {
    if (cmd === 'where' || cmd === 'which') {
      return { code: 0, stdout: args[0] + '\n', stderr: '' };
    }
    /* the probe compile */
    return { code: probeCode, stdout: probeCode === 0 ? '' : 'fatal error: whatever', stderr: probeCode === 0 ? '' : 'undefined reference to `circle`' };
  };

  await t('unwritable toolchain (Program Files story): skipped with explanation, ZERO probe attempts', async () => {
    if (process.platform === 'win32') { console.log('  skip (needs POSIX perms)'); return; }
    const root = buildToolchain({ leaveUnwritable: true });
    fs.mkdirSync(path.join(root, 'include'), { recursive: true });
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.chmodSync(path.join(root, 'include'), 0o555);
    fs.chmodSync(path.join(root, 'lib'), 0o555);
    const storage = buildWinbgimStorage();
    try {
      const res = await globalize.makeGlobalWindows({
        compilerPath: path.join(root, 'bin', 'g++.exe'),
        includeDir: path.join(storage, 'winbgim', 'include'),
        libDir: path.join(storage, 'winbgim', 'lib'),
        runner: stubRunner(0)
      });
      assert.strictEqual(res.globalProbeOk, false);
      assert.strictEqual(res.probeAttempts, 0, 'no probe may run against a read-only toolchain');
      assert.strictEqual(res.notWritableSkips, 1, 'single candidate (no triplet) skipped once');
      assert.ok(res.log.some((l) => l.includes('not writable') && l.includes('administrator')), 'skip line must carry the admin route');
      assert.strictEqual(fs.readdirSync(path.join(root, 'include')).length, 0, 'no files may be copied');
      // the caller's predicate suppresses the telemetry warning for this shape
      assert.strictEqual(setup.shouldReportMakeGlobalFailure(res), false);
    } finally {
      fs.chmodSync(path.join(root, 'include'), 0o755);
      fs.chmodSync(path.join(root, 'lib'), 0o755);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  await t('writable toolchain: copies land, probe runs, result reports attempts=1', async () => {
    const root = buildToolchain({});
    const storage = buildWinbgimStorage();
    try {
      const res = await globalize.makeGlobalWindows({
        compilerPath: path.join(root, 'bin', 'g++.exe'),
        includeDir: path.join(storage, 'winbgim', 'include'),
        libDir: path.join(storage, 'winbgim', 'lib'),
        runner: stubRunner(0)
      });
      assert.strictEqual(res.globalProbeOk, true);
      assert.strictEqual(res.probeAttempts, 1);
      assert.strictEqual(res.notWritableSkips, 0);
      assert.ok(fs.existsSync(path.join(root, 'lib', 'libbgi.a')));
      assert.ok(fs.existsSync(path.join(root, 'include', 'graphics.h')));
      assert.strictEqual(setup.shouldReportMakeGlobalFailure(res), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  await t('writable toolchain but the probe FAILS → predicate still reports', async () => {
    const root = buildToolchain({});
    const storage = buildWinbgimStorage();
    try {
      const res = await globalize.makeGlobalWindows({
        compilerPath: path.join(root, 'bin', 'g++.exe'),
        includeDir: path.join(storage, 'winbgim', 'include'),
        libDir: path.join(storage, 'winbgim', 'lib'),
        runner: stubRunner(1)
      });
      assert.strictEqual(res.globalProbeOk, false);
      assert.strictEqual(res.probeAttempts, 1);
      assert.strictEqual(res.notWritableSkips, 0);
      assert.strictEqual(setup.shouldReportMakeGlobalFailure(res), true, 'a real probe failure stays a genuine signal');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  /* ---------------------------------------------------------------- */
  console.log('wiring (source-level, mirrors the production call sites)');

  const extSrc = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  const setupSrc = fs.readFileSync(path.join(ROOT, 'src', 'setup.ts'), 'utf8');

  await t('compiler download phase is wrapped in withNetworkRetry', () => {
    assert.ok(/const zip = await withNetworkRetry\(/.test(setupSrc), 'download must go through withNetworkRetry');
    assert.ok(/attempts: 3/.test(setupSrc), '3 attempts (initial + 2 retries)');
  });

  await t('every telemetry-capturing install failure sets reportedInstallFailure', () => {
    const n = (extSrc.match(/reportedInstallFailure = true;/g) || []).length;
    assert.ok(n >= 6, 'expected >=6 flag sites (3 branches x sdl_bgi + 2 x compiler-dl + 2 x winbgim), got ' + n);
  });

  await t('terminal/manual steps mark the run as ACTION NEEDED', () => {
    assert.ok(/step\.kind === 'terminal'/.test(extSrc) && /sawActionNeeded = true;/.test(extSrc));
    const n = (extSrc.match(/sawActionNeeded = true;/g) || []).length;
    assert.ok(n >= 2, 'terminal + manual branches, got ' + n);
  });

  await t('verify + make-global warnings go through the suppress predicates', () => {
    /* v1.5.30: the verify predicate call grew the reportedProbeFailure input
     * (the winbgim probe warning now also explains a NOT READY verdict). */
    assert.ok(
      extSrc.includes('shouldReportVerifyFailure({ reportedInstallFailure, sawActionNeeded, reportedProbeFailure })'),
      'verify capture must pass all three in-run cause flags'
    );
    assert.ok(extSrc.includes('shouldReportMakeGlobalFailure(res)'));
    // the suppression branch must NOT call captureExtensionWarning
    const suppressed = extSrc.split('shouldReportMakeGlobalFailure(res)')[1].split('} else {')[0];
    assert.ok(!suppressed.includes('captureExtensionWarning'), 'suppressed make-global path must stay telemetry-free');
  });

  /* ---------------------------------------------------------------- */
  console.log(`\nSENTRY ROUND 3: ${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log('  FAILED: ' + f.name + ' — ' + f.err.stack);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
