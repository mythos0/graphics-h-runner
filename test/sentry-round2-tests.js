#!/usr/bin/env node
/**
 * sentry-round2-tests.js — v1.5.25 fixes for the second Sentry round
 * (issues still firing ON v1.5.24 builds):
 *
 *  GRAPHICS-H-RUNNER-K/F/M (winbgim link probe / make-global probe / verify
 *    not ready): one Windows machine runs a 32-bit MinGW.org g++
 *    (C:\MinGW, arch "mingw32"). Its ld prints "skipping incompatible
 *    ...libbgi.a when searching for -lbgi" so `undefinedRefs` stayed FALSE
 *    and the plan MISSED the compiler steps; the doomed 64-bit library
 *    download + probe + toolchain copy + failed verify all ran anyway.
 *    Fixes: arch-aware incompatibility detection, 32-bit skip gates at the
 *    winbgim/make-global steps, new describeBgiProbeFailure classes.
 *
 *  GRAPHICS-H-RUNNER-T ("downloaded g++.exe did not run (probe:
 *    spawn-failed)"): the probe fired ONCE with zero diagnostics.
 *    Fixes: verifyCompilerRun now carries `detail` (the underlying error
 *    message), spawn-type failures get unblock+retry rounds, and the cached
 *    toolchain is unblocked before a 274 MB re-download.
 *
 *  Empty diagnostic tails ("probe with C:\msys64\... failed (exit 1):"):
 *    the last-stderr-line slice was EMPTY whenever the compiler wrote to
 *    stdout or crashed silently; the doctor fell back to execFile's
 *    "Command failed: <whole command>" which ate the tail budget.
 *    Fixes: smartCompilerTail (both streams, diagnostic-first, never empty).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const toolchain = require(path.join(ROOT, 'out', 'toolchain'));
const setup = require(path.join(ROOT, 'out', 'setup'));
const doctor = require(path.join(ROOT, 'out', 'doctor'));
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

/* ------------------------------------------------------------------ */
(async () => {
console.log('smartCompilerTail (toolchain)');
/* ------------------------------------------------------------------ */

await t('prefers diagnostic lines over benign tail lines', () => {
  const stderr = [
    'In file included from probe.cpp:1:',
    'note: some benign note line',
    'probe.cpp:2:3: error: something broke'
  ].join('\n');
  const out = toolchain.smartCompilerTail(stderr, '', 1);
  assert.ok(out.includes('error: something broke'), out);
});

await t('falls back to stdout when stderr is empty (the live F-event shape)', () => {
  const out = toolchain.smartCompilerTail('', 'collect2.exe: fatal error: ld terminated with signal 11', 1);
  assert.ok(out.includes('ld terminated'), out);
});

await t('NEVER returns an empty string — silence is reported as such', () => {
  const out = toolchain.smartCompilerTail('', '', 1);
  assert.ok(out.length > 0, 'empty tail returned');
  assert.ok(/exit 1 with no compiler output/.test(out), out);
});

await t('captures the "skipping incompatible" class (the live mingw32 event)', () => {
  const stderr = [
    'c:/mingw/bin/../lib/gcc/mingw32/6.3.0/../../../../mingw32/bin/ld.exe: skipping incompatible C:/lib/libbgi.a when searching for -lbgi',
    'c:/mingw/.../ld.exe: cannot find -lbgi',
    'collect2.exe: error: ld returned 1 exit status'
  ].join('\n');
  const out = toolchain.smartCompilerTail(stderr, '', 1);
  assert.ok(out.includes('skipping incompatible'), out);
  assert.ok(out.includes('cannot find -lbgi'), out);
});

await t('undefined reference lines win the priority race', () => {
  const stderr = [
    'bgi_link_probe.cpp:(.text+0x26): undefined reference to `circle\'',
    'collect2.exe: error: ld returned 1 exit status'
  ].join('\n');
  const out = toolchain.smartCompilerTail(stderr, '', 1);
  assert.ok(out.includes('undefined reference to `circle\''), out);
});

await t('respects maxChars and keeps the TAIL', () => {
  const longLine = 'x'.repeat(500) + ' error: at the very end';
  const out = toolchain.smartCompilerTail(longLine, '', 1, 300);
  assert.ok(out.length <= 300, 'length ' + out.length);
  assert.ok(out.includes('at the very end'), out);
});

await t('deduplicates repeated lines', () => {
  const out = toolchain.smartCompilerTail('error: a\nerror: a\nerror: a', '', 1);
  assert.strictEqual((out.match(/error: a/g) || []).length, 1, out);
});

/* ------------------------------------------------------------------ */
console.log('verifyCompilerRun detail (GRAPHICS-H-RUNNER-T diagnostics)');
/* ------------------------------------------------------------------ */

await t('spawn failure carries reason AND the underlying message', async () => {
  const res = await setup.verifyCompilerRun(path.join(os.tmpdir(), 'definitely-not-here-g++.exe'));
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason.startsWith('spawn-'), res.reason);
  assert.ok(res.detail && res.detail.length > 0, 'detail missing');
  assert.ok(/ENOENT|no such file/i.test(res.detail), res.detail);
});

await t('a real compiler still verifies OK without detail', async () => {
  const res = await setup.verifyCompilerRun('g++');
  assert.strictEqual(res.ok, true, 'g++ should exist in this sandbox');
  assert.ok(!res.detail);
});

/* ------------------------------------------------------------------ */
console.log('bgiLinkProbe smart detail');
/* ------------------------------------------------------------------ */

await t('link probe on a nonexistent compiler reports a non-empty detail', async () => {
  const res = await setup.bgiLinkProbe({
    compiler: path.join(os.tmpdir(), 'no-such-compiler'),
    platform: 'linux'
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.detail.length > 0);
  assert.ok(!/^link probe failed \(exit -1\)$/.test(res.detail), 'bare fallback detail: ' + res.detail);
});

/* ------------------------------------------------------------------ */
console.log('describeBgiProbeFailure — the live mingw32 classes');
/* ------------------------------------------------------------------ */

await t('skipping-incompatible + mingw32 → bitness mismatch verdict', () => {
  const v = setup.describeBgiProbeFailure(
    'ld.exe: skipping incompatible C:/lib/libbgi.a when searching for -lbgi | collect2.exe: error: ld returned 1 exit status',
    'mingw32'
  );
  assert.ok(/SKIPS|incompatible/i.test(v), v);
  assert.ok(/64-bit MinGW-w64|WinLibs/i.test(v), v);
});

await t('cannot find -lbgi → missing/blocked archive verdict', () => {
  const v = setup.describeBgiProbeFailure('collect2.exe: error: cannot find -lbgi', 'x86_64');
  assert.ok(/cannot find -lbgi/i.test(v), v);
  assert.ok(/re-run Full Setup/i.test(v), v);
});

await t('undefined refs + mingw32 → 32-bit verdict (existing behavior kept)', () => {
  const v = setup.describeBgiProbeFailure("undefined reference to `circle'", 'mingw32');
  assert.ok(/32-bit toolchain/.test(v), v);
});

await t('undefined refs + x86_64 → corrupt/quarantined archive verdict (kept)', () => {
  const v = setup.describeBgiProbeFailure("undefined reference to `circle'", 'x86_64');
  assert.ok(/corrupt or was quarantined/.test(v), v);
});

await t('graphics.h missing verdict kept', () => {
  const v = setup.describeBgiProbeFailure('fatal error: graphics.h: No such file or directory', 'x86_64');
  assert.ok(/cannot find graphics\.h/.test(v), v);
});

/* ------------------------------------------------------------------ */
console.log('Setup Doctor keeps pure streams + smart tail');
/* ------------------------------------------------------------------ */

await t('doctor reports silence instead of "Command failed: <command>"', async () => {
  const dir = tmpdir('bgi-fakecc-');
  const cc = path.join(dir, 'fakecc.sh');
  /* --version OK, -dumpmachine OK, probe compile exits 1 SILENTLY — the
   * exact live shape that produced "Command failed: g++ -I... <300 chars
   * of command line>" in the M event. */
  fs.writeFileSync(
    cc,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake g++ 12.3"; exit 0; fi\nif [ "$1" = "-dumpmachine" ]; then echo "x86_64-linux-gnu"; exit 0; fi\nexit 1\n'
  );
  fs.chmodSync(cc, 0o755);
  try {
    const res = await doctor.probeEnvironment({ platform: 'linux', compilerPath: cc, linuxLibrary: 'sdl_bgi' });
    assert.strictEqual(res.compilerCheck.ok, true);
    const sdl = res.libraryChecks.find((c) => c.name === 'sdl_bgi');
    assert.ok(sdl, 'sdl_bgi check missing');
    assert.strictEqual(sdl.ok, false);
    assert.ok(!sdl.detail.includes('Command failed'), 'raw execFile message leaked: ' + sdl.detail);
    assert.ok(/exit 1 with no compiler output/.test(sdl.detail), sdl.detail);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await t('doctor surfaces stdout diagnostics when stderr is empty', async () => {
  const dir = tmpdir('bgi-fakecc2-');
  const cc = path.join(dir, 'fakecc2.sh');
  fs.writeFileSync(
    cc,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake g++ 12.3"; exit 0; fi\nif [ "$1" = "-dumpmachine" ]; then echo "x86_64-linux-gnu"; exit 0; fi\necho "ld: cannot find -lSDL_bgi" >&2\nexit 1\n'
  );
  fs.chmodSync(cc, 0o755);
  try {
    const res = await doctor.probeEnvironment({ platform: 'linux', compilerPath: cc, linuxLibrary: 'sdl_bgi' });
    const sdl = res.libraryChecks.find((c) => c.name === 'sdl_bgi');
    assert.ok(/cannot find -lSDL_bgi/.test(sdl.detail), sdl.detail);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
console.log('globalize probe line never empty (the live F-event shape)');
/* ------------------------------------------------------------------ */

await t('make-global probe failure carries the stdout diagnostic', async () => {
  const dir = tmpdir('bgi-global-fix-');
  const toolchainRoot = path.join(dir, 'tc');
  const binDir = path.join(toolchainRoot, 'bin');
  const incDir = path.join(toolchainRoot, 'include');
  const libDir = path.join(toolchainRoot, 'lib');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(incDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  const compiler = path.join(binDir, 'g++.exe');
  fs.writeFileSync(compiler, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(compiler, 0o755);
  fs.writeFileSync(path.join(incDir, 'graphics.h'), '#pragma once\n');
  fs.writeFileSync(path.join(incDir, 'winbgim.h'), '#pragma once\n');
  fs.writeFileSync(path.join(libDir, 'libbgi.a'), 'x');
  /* the winbgim step output (extension storage layout) */
  const wbInc = path.join(dir, 'winbgim', 'include');
  const wbLib = path.join(dir, 'winbgim', 'lib');
  fs.mkdirSync(wbInc, { recursive: true });
  fs.mkdirSync(wbLib, { recursive: true });
  fs.writeFileSync(path.join(wbInc, 'graphics.h'), '#pragma once\n');
  fs.writeFileSync(path.join(wbInc, 'winbgim.h'), '#pragma once\n');
  fs.writeFileSync(path.join(wbLib, 'libbgi.a'), 'x');

  const calls = [];
  const fakeRunner = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'reg') {
      return { code: 1, stdout: '', stderr: '' };
    }
    /* the probe compile: exit 1 with EMPTY stderr and a stdout diagnostic —
     * the exact shape that produced "probe with ... failed (exit 1): " */
    return { code: 1, stdout: 'internal compiler error: crashed', stderr: '' };
  };
  try {
    const res = await globalize.makeGlobalWindows({
      compilerPath: compiler,
      includeDir: wbInc,
      libDir: wbLib,
      runner: fakeRunner
    });
    assert.strictEqual(res.globalProbeOk, false);
    const probeLine = res.log.find((l) => /^probe with .* failed/.test(l));
    assert.ok(probeLine, 'no probe failure line in log: ' + JSON.stringify(res.log));
    assert.ok(probeLine.includes('internal compiler error'), 'stdout diagnostic lost: ' + probeLine);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
console.log('32-bit skip-gate helpers (pure decision, mirrors extension.ts)');
/* ------------------------------------------------------------------ */

await t('arch classification gates: mingw32/i686 blocked, x86_64/unknown not', () => {
  const blocked = (a) => a === 'mingw32' || a === 'i686';
  assert.strictEqual(blocked('mingw32'), true);
  assert.strictEqual(blocked('i686'), true);
  assert.strictEqual(blocked('x86_64'), false);
  assert.strictEqual(blocked('unknown'), false);
});

await t('compilerArchitecture maps the classic triplet shapes', async () => {
  const fake = async (cmd) => {
    const table = {
      x64run: { code: 0, stdout: 'x86_64-w64-mingw32', stderr: '' },
      i68run: { code: 0, stdout: 'i686-w64-mingw32', stderr: '' },
      legacyrun: { code: 0, stdout: 'mingw32', stderr: '' },
      brokenrun: { code: 1, stdout: '', stderr: 'nope' }
    };
    return table[String(cmd)] || { code: 1, stdout: '', stderr: '' };
  };
  assert.strictEqual(await setup.compilerArchitecture('x64run', fake), 'x86_64');
  assert.strictEqual(await setup.compilerArchitecture('i68run', fake), 'i686');
  assert.strictEqual(await setup.compilerArchitecture('legacyrun', fake), 'mingw32');
  assert.strictEqual(await setup.compilerArchitecture('brokenrun', fake), 'unknown');
});

/* ------------------------------------------------------------------ */
console.log('');
console.log(`passed: ${passed}, failed: ${failed}`);
if (failed > 0) {
  failures.forEach((f) => console.log('  FAILED: ' + f.name + ' — ' + f.err.message));
  process.exit(1);
}
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
