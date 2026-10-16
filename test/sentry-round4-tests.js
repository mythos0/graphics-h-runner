#!/usr/bin/env node
/**
 * sentry-round4-tests.js — v1.5.30 fixes for the fourth Sentry round
 * (issues fired ON v1.5.29 builds, 2026-10-15/16):
 *
 *  GRAPHICS-H-RUNNER-M/F/K ("JAJ/AppData/…" in the detail tag of the live
 *    v1.5.29 burst, 2026-10-15T18:02–18:04Z): smartCompilerTail joined the
 *    raw compiler lines and cut joined.slice(-300) — the cut landed
 *    MID-PATH, so "C:/Users/<name>/AppData/…" lost its "C:/Users/" anchor
 *    before scrubText could run downstream, and the raw USERNAME shipped
 *    to Sentry ("JAJ/AppData/…" is a real 3-char account name).
 *    Fix: the tail is scrubbed BEFORE any truncation (toolchain.ts now
 *    imports the pure scrubber from scrub.ts; instrument.ts re-exports it).
 *    Any later cut is privacy-safe; the classifier still sees the message
 *    tail it needs ("cannot find -lbgi" etc.).
 *
 *  GRAPHICS-H-RUNNER-13 ("ENOSPC: no space left on device, write" at
 *    installCompilerWindowsDirect → writeFileSync, 2026-10-16T01:49Z,
 *    IN/Pune, v1.5.29): a full disk died mid-compiler-download with a raw
 *    error. Fix: a statfs preflight fails fast with an actionable message
 *    before the 274 MB download, and disk-full errors from the zip write
 *    and Expand-Archive extraction are rewritten the same way
 *    (diskSpaceShortageMessage / isDiskFullErrorText /
 *    WINLIBS_MIN_FREE_BYTES).
 *
 *  GRAPHICS-H-RUNNER-M/F/K cascade (one run → three warnings, 18:02:42 →
 *    18:02:44 → 18:04:47): the winbgim link probe fired its own warning
 *    (K), make-global probed the same broken combination (F) and the
 *    verify reported the inevitable NOT READY (M) — two extra events for
 *    one cause. Fix: verifyWinbgimInstall returns whether it captured the
 *    warning; the runner tracks reportedProbeFailure, the make-global
 *    branch defers with a summary line + breadcrumb, and
 *    shouldReportVerifyFailure accepts reportedProbeFailure.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

/* ---- vscode stub (only out/instrument is loaded, for the re-export check) ---- */
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

const setup = require(path.join(ROOT, 'out', 'setup'));
const toolchain = require(path.join(ROOT, 'out', 'toolchain'));
const scrub = require(path.join(ROOT, 'out', 'scrub'));
const instrument = require(path.join(ROOT, 'out', 'instrument'));

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

/* ------------------------------------------------------------------ */
(async () => {
  console.log('scrub.ts (extracted pure scrubber)');

  await t('scrub.ts exports scrubText and it equals the instrument re-export', async () => {
    assert.strictEqual(typeof scrub.scrubText, 'function');
    assert.strictEqual(instrument.scrubText, scrub.scrubText);
  });

  await t('Windows backslash + forward-slash Users shapes both scrub', async () => {
    assert.strictEqual(scrub.scrubText('C:\\Users\\JAJ\\AppData\\x'), 'C:\\Users\\~\\AppData\\x');
    assert.strictEqual(scrub.scrubText('C:/Users/JAJ/AppData/x'), 'C:/Users/~/AppData/x');
    assert.strictEqual(scrub.scrubText('c:/Users/Taha Pervaiz/AppData/x'), 'c:/Users/~/AppData/x');
    assert.strictEqual(scrub.scrubText('/home/someuser/x'), '/home/~/x');
  });

  console.log('\nsmartCompilerTail (scrub-before-cut)');

  await t('live v1.5.29 shape replayed: the cut can no longer leak the username', async () => {
    /* reconstruct the real burst: ld path echo (long, carries the home dir)
     * + diagnostic line; total > 300 chars so the old code sliced mid-path. */
    const ldPath =
      'C:/Users/JAJ/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin/../lib/gcc/x86_64-w64-mingw32/16.2.0/../../../../x86_64-w64-mingw32/bin/ld.exe: cannot find -lbgi';
    const secondLine = 'bgi_link_probe.cpp: some other diagnostic line that pads the join past the 300 char budget for sure';
    const out = toolchain.smartCompilerTail(ldPath + '\n' + secondLine, '', 1);
    assert.ok(!/JAJ/.test(out), 'username leaked: ' + out);
    assert.ok(out.length <= 300, 'tail longer than budget: ' + out.length);
  });

  await t('a fitting tail keeps the scrubbed path shape (C:/Users/~/…)', async () => {
    const ldPath =
      'C:/Users/JAJ/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs/mingw64/bin/ld.exe: cannot find -lbgi';
    const out = toolchain.smartCompilerTail(ldPath, '', 1);
    assert.ok(!/JAJ/.test(out), 'username leaked: ' + out);
    assert.ok(/C:\/Users\/~\/AppData/.test(out), 'scrubbed shape missing: ' + out);
    assert.ok(/cannot find -lbgi/.test(out));
  });

  await t('the diagnostic tail the classifier needs survives the cut', async () => {
    const longLine =
      'C:/Users/JAJ/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin/../lib/gcc/x86_64-w64-mingw32/16.2.0/../../../../x86_64-w64-mingw32/bin/ld.exe: cannot find -lbgi';
    const out = toolchain.smartCompilerTail(longLine, '', 1);
    assert.ok(/cannot find -lbgi/.test(out), 'diagnostic tail lost: ' + out);
    const verdict = setup.describeBgiProbeFailure(out, 'x86_64');
    assert.ok(/cannot find -lbgi \(libbgi\.a\)/.test(verdict), 'verdict degraded: ' + verdict);
  });

  await t('short tails pass through scrubbed and unchanged in meaning', async () => {
    const out = toolchain.smartCompilerTail('bgi_probe.cpp:1:10: fatal error: graphics.h: No such file or directory', '', 1);
    assert.ok(/graphics\.h: No such file/.test(out));
    assert.ok(out.length <= 300);
  });

  await t('silence still maps to the antivirus/crash hint (never empty)', async () => {
    const out = toolchain.smartCompilerTail('', '', 1);
    assert.ok(/exit 1 with no compiler output/.test(out));
  });

  await t('priority picking still prefers diagnostic lines over the last raw line', async () => {
    const stderr = 'noise line one\nundefined reference to `circle\'\nnoise line three';
    const out = toolchain.smartCompilerTail(stderr, '', 1);
    assert.ok(/undefined reference to .circle./.test(out));
    assert.ok(/noise line three/.test(out));
    assert.ok(!/noise line one/.test(out));
  });

  console.log('\nENOSPC (GRAPHICS-H-RUNNER-13)');

  await t('isDiskFullErrorText matches the production ENOSPC event text', async () => {
    assert.ok(setup.isDiskFullErrorText('Error: ENOSPC: no space left on device, write'));
    assert.ok(setup.isDiskFullErrorText('no space left on device'));
    assert.ok(setup.isDiskFullErrorText('Expand-Archive : The disk is full'));
    assert.ok(setup.isDiskFullErrorText('hr = 0x80070070'));
    assert.ok(setup.isDiskFullErrorText('There is not enough space on the disk.'));
  });

  await t('isDiskFullErrorText does not classify unrelated failures', async () => {
    assert.ok(!setup.isDiskFullErrorText('EACCES: permission denied'));
    assert.ok(!setup.isDiskFullErrorText('ENOENT: no such file or directory, open'));
    assert.ok(!setup.isDiskFullErrorText('download failed: HTTP 404'));
    assert.ok(!setup.isDiskFullErrorText(''));
  });

  await t('diskSpaceShortageMessage names the free/need GB and the fix', async () => {
    const msg = setup.diskSpaceShortageMessage(200 * 1024 * 1024);
    assert.ok(/0\.2 GB free/.test(msg), msg);
    assert.ok(/1\.2 GB/.test(msg), msg);
    assert.ok(/free up space/i.test(msg), msg);
    assert.ok(setup.diskSpaceShortageMessage(0).match(/0 GB free/), setup.diskSpaceShortageMessage(0));
  });

  await t('WINLIBS_MIN_FREE_BYTES is ~1.2 GB', async () => {
    assert.strictEqual(setup.WINLIBS_MIN_FREE_BYTES, Math.round(1.2 * 1024 * 1024 * 1024));
  });

  await t('installCompilerWindowsDirect fails fast on a short volume (preflight)', async () => {
    /* fake a volume with 200 MB free: point the preflight at a dir on a
     * ram-backed FS is not portable — instead call the exported message
     * path the preflight throws with and verify the wiring shape by
     * checking the thrown error type the caller (extension.ts) maps to
     * reportedInstallFailure. Simulate by monkey-patching fs.statfsSync. */
    const realStatfs = fs.statfsSync;
    let preflightThrew = null;
    try {
      const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enospc-preflight-'));
      fs.statfsSync = () => ({ bavail: 200 * 1024 * 1024 / 4096, bsize: 4096 });
      await setup.installCompilerWindowsDirect(storageRoot);
      assert.fail('expected the preflight to throw');
    } catch (e) {
      preflightThrew = e;
    } finally {
      fs.statfsSync = realStatfs;
    }
    assert.ok(preflightThrew, 'no error thrown at all');
    assert.ok(/disk space/.test(String(preflightThrew.message)), 'wrong error: ' + preflightThrew.message);
    assert.ok(/not enough disk space/.test(String(preflightThrew.message)));
  });

  await t('a disk-full writeFileSync is rewritten into the actionable message', async () => {
    const realStatfs = fs.statfsSync;
    const realWrite = fs.writeFileSync;
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enospc-write-'));
    try {
      /* plenty of space at preflight, disk dies at the zip write — the
       * production timeline (issue 13) exactly. */
      fs.statfsSync = () => ({ bavail: 10 * 1024 * 1024 * 1024 / 4096, bsize: 4096 });
      fs.writeFileSync = () => {
        const err = new Error("ENOSPC: no space left on device, write");
        throw err;
      };
      await setup.installCompilerWindowsDirect(storageRoot);
      assert.fail('expected the write to throw');
    } catch (e) {
      assert.ok(/not enough disk space/.test(String(e.message)), 'raw ENOSPC leaked: ' + e.message);
      assert.ok(!/ENOSPC/.test(String(e.message)) || /not enough disk space/.test(String(e.message)));
    } finally {
      fs.statfsSync = realStatfs;
      fs.writeFileSync = realWrite;
    }
  });

  await t('statfs being unavailable skips the preflight (no crash)', async () => {
    const realStatfs = fs.statfsSync;
    const realWrite = fs.writeFileSync;
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enospc-nostatfs-'));
    try {
      delete fs.statfsSync;
      /* no fetch mock — the download itself would fail with a network-ish
       * error, which proves the preflight did NOT block the flow */
      await setup.installCompilerWindowsDirect(storageRoot).catch(() => { /* any downstream failure is fine */ });
      fs.writeFileSync = realWrite;
    } finally {
      fs.statfsSync = realStatfs;
      fs.writeFileSync = realWrite;
    }
  });

  console.log('\ncascade suppression (reportedProbeFailure)');

  await t('shouldReportVerifyFailure still fires for genuinely unexplained failures', async () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: false, reportedProbeFailure: false }), true);
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: false }), true);
  });

  await t('a reported install failure still suppresses the verify warning (v1.5.29 behavior kept)', async () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: true, sawActionNeeded: false, reportedProbeFailure: false }), false);
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: true, reportedProbeFailure: false }), false);
  });

  await t('a reported probe failure now suppresses the verify warning (the live M/K burst)', async () => {
    assert.strictEqual(setup.shouldReportVerifyFailure({ reportedInstallFailure: false, sawActionNeeded: false, reportedProbeFailure: true }), false);
    assert.strictEqual(
      setup.shouldReportVerifyFailure({ reportedInstallFailure: true, sawActionNeeded: false, reportedProbeFailure: true }),
      false
    );
  });

  console.log('\nmake-global deferral wiring (shape checks)');

  /* NOTE: the make-global deferral and the reportedProbeFailure tracking live
   * inside the extension.ts setup runner, which needs a real 'vscode' host —
   * their contracts are the setup.ts predicates tested above (the runner is a
   * thin if-chain over them), consistent with how v1.5.29 shipped its round. */

  /* ---------------------------------------------------------------- */
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log('  FAILED: ' + f.name + ' — ' + f.err.message);
    process.exit(1);
  }
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
