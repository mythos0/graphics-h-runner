#!/usr/bin/env node
/**
 * sentry-fix-tests.js — v1.5.23 setup-side classifiers that came out of the
 * Sentry triage (GRAPHICS-H-RUNNER-T/X/N/P):
 *
 *  1. classifySdlBgiBuildFailure turns the raw macOS clang dump
 *     ("'SDL2/SDL.h' file not found") into an actionable per-platform message
 *     and ignores unrelated compiler errors.
 *  2. isNetworkFailureText recognizes the download-failure family (fetch
 *     failed / TimeoutError / undici ConnectTimeoutError / getaddrinfo …) so
 *     connectivity problems become warnings, not error-inbox entries.
 *  3. verifyCompilerRun now reports WHY a compiler probe failed
 *     (spawn-ENOENT / exit codes) instead of a bare { ok: false }.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const setup = require(path.join(ROOT, 'out', 'setup'));

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
  console.log('\n[1] classifySdlBgiBuildFailure (GRAPHICS-H-RUNNER-X, macOS)');
  const realDump = [
    'In file included from ~/Library/Application Support/Code/User/globalStorage/mythos0-labs.graphics-h-runner/sdl_bgi-src/src/SDL_bgi.c:37:',
    '~/Library/Application Support/Code/User/globalStorage/mythos0-labs.graphics-h-runner/sdl_bgi-src/src/SDL_bgi.h:44:10: fatal error: \'SDL2/SDL.h\' file not found',
    '   44 | #include <SDL2/SDL.h>',
    '1 error generated.'
  ].join('\n');

  await t('missing SDL2 header dump -> actionable message with the exact install command', async () => {
    const msg = setup.classifySdlBgiBuildFailure(realDump);
    assert.ok(msg.length > 0, 'expected classification, got empty');
    assert.ok(/SDL2 development headers are not installed/.test(msg), 'no explanation: ' + msg);
    assert.ok(
      /brew install sdl2|libsdl2-dev|SDL2-devel|sdl2\b/.test(msg),
      'no install command for platform ' + process.platform + ': ' + msg
    );
  });
  await t('linker cannot find -lSDL2 -> classified message', async () => {
    const msg = setup.classifySdlBgiBuildFailure('ld: library not found for -lSDL2\ngcc: error: linker command failed');
    assert.ok(/SDL2 runtime\/development library is missing/.test(msg), 'got: ' + msg);
  });
  await t('cannot find -lSDL2 (mingw-style) -> classified message', async () => {
    const msg = setup.classifySdlBgiBuildFailure('/usr/bin/ld: cannot find -lSDL2: No such file or directory');
    assert.ok(/SDL2 runtime\/development library is missing/.test(msg), 'got: ' + msg);
  });
  await t('unrelated compile error -> empty (raw stderr path preserved)', async () => {
    assert.strictEqual(setup.classifySdlBgiBuildFailure('SDL_bgi.c:210:5: error: use of undeclared identifier xyz'), '');
    assert.strictEqual(setup.classifySdlBgiBuildFailure(''), '');
  });

  console.log('\n[2] isNetworkFailureText (GRAPHICS-H-RUNNER-N/P)');
  await t('TypeError: fetch failed -> network', async () => {
    assert.strictEqual(setup.isNetworkFailureText('Error: TypeError: fetch failed'), true);
  });
  await t('undici ConnectTimeoutError -> network', async () => {
    assert.strictEqual(
      setup.isNetworkFailureText(
        'ConnectTimeoutError: Connect Timeout Error (attempted addresses: 185.199.110.133:443, timeout: 10000ms)'
      ),
      true
    );
  });
  await t('AbortSignal TimeoutError -> network', async () => {
    assert.strictEqual(setup.isNetworkFailureText('TimeoutError: The operation was aborted due to timeout'), true);
  });
  await t('getaddrinfo ENOTFOUND -> network', async () => {
    assert.strictEqual(setup.isNetworkFailureText('getaddrinfo ENOTFOUND raw.githubusercontent.com'), true);
  });
  await t('real bugs are NOT network failures', async () => {
    assert.strictEqual(setup.isNetworkFailureText('TypeError: Cannot read properties of undefined'), false);
    assert.strictEqual(setup.isNetworkFailureText('downloaded g++.exe did not run'), false);
    assert.strictEqual(setup.isNetworkFailureText('SDL_bgi build failed: clang dump'), false);
    assert.strictEqual(setup.isNetworkFailureText(''), false);
  });

  console.log('\n[3] verifyCompilerRun failure reasons (GRAPHICS-H-RUNNER-T)');
  await t('nonexistent compiler -> spawn-ENOENT reason', async () => {
    const res = await setup.verifyCompilerRun(path.join(os.tmpdir(), 'definitely-not-a-compiler-' + Date.now()));
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.version, '');
    assert.ok(/^spawn-(ENOENT|failed)$/.test(res.reason), 'reason: ' + res.reason);
  });
  await t('compiler that exits non-zero -> exit-N reason with exitCode', async () => {
    const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vcr-')), 'failer.sh');
    fs.writeFileSync(script, '#!/bin/sh\nexit 42\n');
    fs.chmodSync(script, 0o755);
    const res = await setup.verifyCompilerRun(script);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'exit-42', 'reason: ' + res.reason);
    assert.strictEqual(res.exitCode, 42);
  });
  await t('real compiler -> ok with a version line (sandbox g++)', async () => {
    const res = await setup.verifyCompilerRun('g++');
    if (!res.ok) {
      console.log('  (skip: no g++ in this environment)');
      return;
    }
    assert.ok(res.ok === true);
    assert.ok(res.version.length > 0, 'version empty');
    assert.strictEqual(res.reason, '');
  });
  await t('real compiler still reports old shape fields (back-compat)', async () => {
    const res = await setup.verifyCompilerRun('g++');
    assert.ok('ok' in res && 'version' in res && 'reason' in res);
  });

  console.log(`\nsentry-fix-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
