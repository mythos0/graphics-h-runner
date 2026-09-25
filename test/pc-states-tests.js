#!/usr/bin/env node
/**
 * pc-states-tests.js — robustness suite for "any kind of PC".
 *
 * Simulates the PC states the extension must survive:
 *   A. FRESH PC        — nothing installed, no settings, winget missing
 *   B. HALF-SETUP PC   — compiler present / library present, but not both;
 *                        installers that edited PATH after VS Code started
 *   C. MESSY SETTINGS  — quoted paths, %ENV% vars, ~, trailing slashes,
 *                        directory-instead-of-exe, missing .exe, stale dirs,
 *                        Windows -4058 spawn codes, wrong-case duplicates
 *
 * Everything runs without VS Code (pure Node) against the compiled out/*.js.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  stripQuotes, expandEnvVars, normalizeDirEntry, normalizeDirList,
  pruneMissingDirs, normalizeCompilerPath, classifySpawnFailure
} = require(path.join(ROOT, 'out', 'normalize'));
const { buildCompilePlan } = require(path.join(ROOT, 'out', 'buildArgs'));
const { probeEnvironment } = require(path.join(ROOT, 'out', 'doctor'));
const {
  planSetup, discoverGppWindows, verifyCompilerRun,
  installCompilerWindowsDirect, wingetInstallCompilerArgs
} = require(path.join(ROOT, 'out', 'setup'));

let passed = 0, failed = 0;
const failedNames = [];
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    failedNames.push(name + ' — ' + e.message);
    console.log('  FAIL  ' + name + ' — ' + e.message);
  }
}
async function tAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    failedNames.push(name + ' — ' + e.message);
    console.log('  FAIL  ' + name + ' — ' + e.message);
  }
}
const section = (s) => console.log('\n== ' + s + ' ==');

(async function main() {

  /* ================================================================== */
  section('A1. messy compilerPath healing — Windows shapes');
  const win = { platform: 'windows' };
  t('quoted exe path (single pair)', () => {
    assert.strictEqual(normalizeCompilerPath('"C:\\MinGW\\bin\\g++.exe"', win), 'C:\\MinGW\\bin\\g++.exe');
  });
  t('copy-as-path double quoting', () => {
    assert.strictEqual(normalizeCompilerPath('""C:\\my tools\\bin\\g++.exe""', win), 'C:\\my tools\\bin\\g++.exe');
  });
  t('single quotes', () => {
    assert.strictEqual(normalizeCompilerPath("'C:\\mgw\\bin\\g++.exe'", win), 'C:\\mgw\\bin\\g++.exe');
  });
  t('trailing whitespace + backslashes', () => {
    assert.strictEqual(normalizeCompilerPath('  C:\\mgw\\bin\\g++.exe\\\\ ', win), 'C:\\mgw\\bin\\g++.exe');
  });
  t('directory instead of exe -> g++.exe appended', () => {
    assert.strictEqual(normalizeCompilerPath('C:\\msys64\\ucrt64\\bin', win), 'C:\\msys64\\ucrt64\\bin\\g++.exe');
  });
  t('trailing-slash directory -> g++.exe appended', () => {
    assert.strictEqual(normalizeCompilerPath('C:\\msys64\\ucrt64\\bin\\', win), 'C:\\msys64\\ucrt64\\bin\\g++.exe');
  });
  t('%ENV% expansion (Windows)', () => {
    const env = { MINGW64: 'D:\\tools\\mingw64' };
    assert.strictEqual(normalizeCompilerPath('%MINGW64%\\bin\\g++.exe', { platform: 'windows', env }), 'D:\\tools\\mingw64\\bin\\g++.exe');
  });
  t('missing .exe + only .exe variant exists -> .exe appended', () => {
    const exists = (p) => p === 'C:\\mgw\\bin\\g++.exe';
    assert.strictEqual(normalizeCompilerPath('C:\\mgw\\bin\\g++', { platform: 'windows', exists }), 'C:\\mgw\\bin\\g++.exe');
  });
  t('missing .exe + bare file exists -> untouched', () => {
    const exists = (p) => p === 'C:\\mgw\\bin\\g++';
    assert.strictEqual(normalizeCompilerPath('C:\\mgw\\bin\\g++', { platform: 'windows', exists }), 'C:\\mgw\\bin\\g++');
  });
  t('drive root C:/ -> C:\\\\g++.exe (garbage-in, clean error out)', () => {
    assert.strictEqual(normalizeCompilerPath('C:/', win), 'C:\\g++.exe');
  });
  t('bare name g++ untouched (PATH lookup)', () => {
    assert.strictEqual(normalizeCompilerPath('g++', win), 'g++');
  });
  t('bare name g++.exe untouched', () => {
    assert.strictEqual(normalizeCompilerPath('  g++.exe  ', win), 'g++.exe');
  });
  t('empty / whitespace -> empty string', () => {
    assert.strictEqual(normalizeCompilerPath('   ', win), '');
  });
  t('spaces inside path preserved (no bogus splitting)', () => {
    assert.strictEqual(normalizeCompilerPath('"C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\g++.exe"', win),
      'C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\g++.exe');
  });

  section('A2. messy compilerPath healing — POSIX shapes');
  const lnx = { platform: 'linux' };
  t('directory -> /dir/g++', () => {
    assert.strictEqual(normalizeCompilerPath('/usr/bin', lnx), '/usr/bin/g++');
  });
  t('$HOME expansion', () => {
    assert.strictEqual(normalizeCompilerPath('$HOME/.local/bin/g++', { platform: 'linux', env: { HOME: '/home/u' } }), '/home/u/.local/bin/g++');
  });
  t('${VAR} expansion', () => {
    assert.strictEqual(normalizeCompilerPath('${TOOLCHAINS}/g++', { platform: 'linux', env: { TOOLCHAINS: '/opt/tc' } }), '/opt/tc/g++');
  });
  t('~ expansion', () => {
    assert.strictEqual(normalizeCompilerPath('~/bin/g++', { platform: 'linux', home: '/home/u' }), '/home/u/bin/g++');
  });
  t('unset env var stays literal (honest error later)', () => {
    assert.strictEqual(normalizeCompilerPath('%NOPE%\\g++.exe', { platform: 'windows', env: {} }), '%NOPE%\\g++.exe');
  });

  section('A3. include/lib dir list healing');
  t('quotes + trailing slashes + empties cleaned', () => {
    assert.deepStrictEqual(
      normalizeDirList(['"C:\\a\\include"', 'C:\\a\\include\\\\', '', '   ', 'C:\\b'], win),
      ['C:\\a\\include', 'C:\\b']
    );
  });
  t('Windows dedupe is case-insensitive', () => {
    assert.deepStrictEqual(normalizeDirList(['C:\\A', 'c:\\a', 'C:\\A\\'], win), ['C:\\A']);
  });
  t('POSIX dedupe is case-sensitive', () => {
    assert.deepStrictEqual(normalizeDirList(['/A', '/a'], lnx), ['/A', '/a']);
  });
  t('$VAR in include paths expands', () => {
    assert.deepStrictEqual(
      normalizeDirList(['$HOME/bgi/usr/include'], { platform: 'linux', env: { HOME: '/h' } }),
      ['/h/bgi/usr/include']
    );
  });
  t('pruneMissingDirs drops only dead entries (real fs)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-prune-'));
    try {
      const good = path.join(tmp, 'good');
      fs.mkdirSync(good);
      assert.deepStrictEqual(pruneMissingDirs([good, '/definitely/not/here', ''], lnx), [good]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  section('A4. spawn-failure classification (the fresh-PC -4058 bug)');
  t("error ENOENT -> no-compiler", () => {
    assert.strictEqual(classifySpawnFailure({ errorCode: 'ENOENT' }), 'no-compiler');
  });
  t('Windows close code -4058 -> no-compiler', () => {
    assert.strictEqual(classifySpawnFailure({ closeCode: -4058, platform: 'windows' }), 'no-compiler');
  });
  t('Windows close code -1 -> failed (not a spawn miss)', () => {
    assert.strictEqual(classifySpawnFailure({ closeCode: -1, platform: 'windows' }), 'failed');
  });
  t('real compile error exit 1 -> failed', () => {
    assert.strictEqual(classifySpawnFailure({ closeCode: 1, platform: 'windows' }), 'failed');
  });
  t('POSIX null close -> failed', () => {
    assert.strictEqual(classifySpawnFailure({ closeCode: null, platform: 'linux' }), 'failed');
  });

  /* ================================================================== */
  section('B. compile plans built from messy settings');
  t('plan.compiler healed from quoted path (windows)', () => {
    const plan = buildCompilePlan({
      platform: 'windows', compilerPath: '"C:\\mgw\\bin\\g++.exe"',
      sourceFile: 'C:\\ws\\m.cpp', outFile: 'C:\\ws\\m.exe'
    }, true);
    assert.strictEqual(plan.compiler, 'C:\\mgw\\bin\\g++.exe');
  });
  t('plan keeps spaces-safe arg array (no shell string)', () => {
    const plan = buildCompilePlan({
      platform: 'windows', compilerPath: 'C:\\my tools\\bin\\g++.exe',
      sourceFile: 'C:\\my docs\\m.cpp', outFile: 'C:\\my docs\\m.exe'
    }, true);
    assert.ok(!plan.commandLine.includes('"C:\\my tools\\bin\\g++.exe" C:\\my'), 'display quotes properly');
    assert.ok(plan.args.includes('C:\\my docs\\m.cpp'));
  });
  t('winbgim flags present with static linking', () => {
    const plan = buildCompilePlan({
      platform: 'windows', compilerPath: 'g++', sourceFile: 'a.cpp', outFile: 'a.exe'
    }, true);
    for (const flag of ['-lbgi', '-lgdi32', '-lole32', '-static', '-static-libgcc', '-static-libstdc++']) {
      assert.ok(plan.args.includes(flag), 'missing ' + flag);
    }
  });
  t('autoDetect off + plain file -> no BGI libs', () => {
    const plan = buildCompilePlan({
      platform: 'windows', compilerPath: 'g++', sourceFile: 'a.cpp', outFile: 'a.exe'
    }, false);
    assert.strictEqual(plan.library, 'none');
    assert.ok(!plan.args.includes('-lbgi'));
  });
  t('SDL_bgi rpath added per custom lib dir (linux)', () => {
    const plan = buildCompilePlan({
      platform: 'linux', compilerPath: 'g++', sourceFile: '/w/a.cpp', outFile: '/w/a',
      extraLibPaths: ['/opt/bgi/lib']
    }, true, { sdlBgiAvailable: true });
    assert.ok(plan.args.includes('-Wl,-rpath,/opt/bgi/lib'));
    assert.ok(plan.args.includes('-lSDL_bgi'));
  });

  /* ================================================================== */
  section('C. setup plans across PC states');
  const WIN_BGI = { name: 'winbgim', ok: true };
  t('FRESH Windows (nothing installed)', () => {
    const ids = planSetup('windows', { compilerOk: false }).map((s) => s.id);
    assert.deepStrictEqual(ids, ['install-compiler-winget', 'install-compiler-download', 'manual-compiler', 'install-winbgim', 'verify']);
  });
  t('HALF Windows: compiler OK, WinBGIM missing', () => {
    const ids = planSetup('windows', { compilerOk: true, winbgimOk: false }).map((s) => s.id);
    assert.deepStrictEqual(ids, ['install-winbgim', 'verify']);
  });
  t('HALF Windows: WinBGIM installed, compiler missing (stale settings PC)', () => {
    const ids = planSetup('windows', { compilerOk: false, winbgimOk: true }).map((s) => s.id);
    assert.deepStrictEqual(ids, ['install-compiler-winget', 'install-compiler-download', 'manual-compiler', 'verify']);
  });
  t('READY Windows: only verify (idempotent re-run)', () => {
    const ids = planSetup('windows', { compilerOk: true, winbgimOk: true }).map((s) => s.id);
    assert.deepStrictEqual(ids, ['verify']);
  });
  t('FRESH Linux (no compiler, no SDL2, no SDL_bgi)', () => {
    const ids = planSetup('linux', { compilerOk: false, sdlBgiOk: false }, false).map((s) => s.id);
    assert.deepStrictEqual(ids, ['install-compiler', 'install-sdl2', 'install-sdl_bgi', 'verify']);
  });
  t('HALF Linux: compiler OK, SDL2 dev missing', () => {
    const ids = planSetup('linux', { compilerOk: true, sdlBgiOk: false }, false).map((s) => s.id);
    assert.deepStrictEqual(ids, ['install-sdl2', 'install-sdl_bgi', 'verify']);
  });
  t('READY Linux: only verify', () => {
    const ids = planSetup('linux', { compilerOk: true, sdlBgiOk: true }, true).map((s) => s.id);
    assert.deepStrictEqual(ids, ['verify']);
  });
  t('winget args carry silent/accept flags + correct package id', () => {
    const a = wingetInstallCompilerArgs();
    assert.ok(a.includes('BrechtSanders.WinLibs.POSIX.UCRT'));
    assert.ok(a.includes('--accept-source-agreements'));
    assert.ok(a.includes('--accept-package-agreements'));
  });

  /* ================================================================== */
  section('D. compiler discovery on half-setup PCs (fixtures)');
  t('winget depth-4 package layout, Links shim, PATH entries, mingw64 first', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-disc-'));
    try {
      const local = path.join(tmp, 'LOCALAPPDATA');
      const pkg = path.join(local, 'Microsoft', 'WinGet', 'Packages', 'BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe', 'winlibs-x86_64-x', 'bin');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'g++.exe'), 'fake');
      const links = path.join(local, 'Microsoft', 'WinGet', 'Links');
      fs.mkdirSync(links, { recursive: true });
      fs.writeFileSync(path.join(links, 'g++.exe'), 'fake');
      const pathDir = path.join(tmp, 'ondisk', 'mingw64', 'bin');
      fs.mkdirSync(pathDir, { recursive: true });
      fs.writeFileSync(path.join(pathDir, 'g++.exe'), 'fake');
      const pathDir32 = path.join(tmp, 'ondisk', 'mingw32', 'bin');
      fs.mkdirSync(pathDir32, { recursive: true });
      fs.writeFileSync(path.join(pathDir32, 'g++.exe'), 'fake');

      const found = discoverGppWindows({
        localAppData: local,
        env: { PATH: [pathDir, pathDir32].join(path.delimiter) }
      });
      assert.ok(found.length >= 4, 'expected >=4 candidates, got ' + found.length);
      assert.ok(/mingw64/i.test(found[0]), 'mingw64 candidate must sort first, got ' + found[0]);
      assert.ok(found.some((p) => p.includes('WinGet') && p.includes('Packages')));
      assert.ok(found.some((p) => p.includes('Links')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  t('discovery survives junk roots + empty PATH (no crash, no dupes)', () => {
    const found = discoverGppWindows({ localAppData: '/nonexistent-la', env: { PATH: '' } });
    assert.ok(Array.isArray(found));
    assert.strictEqual(new Set(found.map((p) => p.toLowerCase())).size, found.length);
  });

  /* ================================================================== */
  section('E. Setup Doctor under messy / half / ready settings (real probes)');

  await tAsync('quoted + padded compilerPath still finds g++ (linux sandbox)', async () => {
    const res = await probeEnvironment({ platform: 'linux', compilerPath: ' "g++" ' });
    assert.strictEqual(res.compilerCheck.ok, true, res.compilerCheck.detail);
    assert.match(res.compilerCheck.detail, /g\+\+/);
  });
  await tAsync('dead compilerPath -> clean NOT-READY report (no crash)', async () => {
    const res = await probeEnvironment({ platform: 'linux', compilerPath: '/no/such/g++' });
    assert.strictEqual(res.compilerCheck.ok, false);
    assert.match(res.compilerCheck.detail, /no\/such\/g\+\+/);
    assert.strictEqual(res.graphicsReady, false);
    assert.ok(res.libraryChecks.every((c) => !c.ok));
  });
  await tAsync('directory as compilerPath -> resolved to <dir>/g++', async () => {
    const res = await probeEnvironment({ platform: 'linux', compilerPath: '/usr/bin' });
    assert.strictEqual(res.compilerCheck.ok, true, res.compilerCheck.detail);
    assert.match(res.compilerCheck.name, /\/usr\/bin\/g\+\+/);
  });
  await tAsync('READY PC: doctor probe compiles graphics.h with custom prefix', async () => {
    const BGI = '/home/z/my-project/bgi-env';
    if (!fs.existsSync(path.join(BGI, 'usr/lib/libSDL_bgi.so'))) {
      console.log('  SKIP  (sandbox bgi-env not present)');
      return;
    }
    const res = await probeEnvironment({
      platform: 'linux',
      compilerPath: 'g++',
      extraIncludePaths: [
        path.join(BGI, 'usr/include'),
        path.join(BGI, 'sysroot/usr/include'),
        path.join(BGI, 'sysroot/usr/include/x86_64-linux-gnu')
      ],
      extraLibPaths: [
        path.join(BGI, 'usr/lib'),
        path.join(BGI, 'sysroot/usr/lib/x86_64-linux-gnu')
      ]
    });
    assert.strictEqual(res.graphicsReady, true, JSON.stringify(res.libraryChecks, null, 1));
    assert.strictEqual(res.bestLibrary, 'sdl_bgi');
  });
  await tAsync('messy include/lib lists (quotes, $VAR, dead dirs) still probe READY', async () => {
    const BGI = '/home/z/my-project/bgi-env';
    if (!fs.existsSync(path.join(BGI, 'usr/lib/libSDL_bgi.so'))) {
      console.log('  SKIP  (sandbox bgi-env not present)');
      return;
    }
    const res = await probeEnvironment({
      platform: 'linux',
      compilerPath: 'g++',
      extraIncludePaths: normalizeDirList([
        '"' + path.join(BGI, 'usr/include') + '"',
        path.join(BGI, 'sysroot/usr/include') + '/',
        path.join(BGI, 'sysroot/usr/include/x86_64-linux-gnu'),
        '/dead/toolchain/include'
      ]),
      extraLibPaths: normalizeDirList([
        '"' + path.join(BGI, 'usr/lib') + '"',
        path.join(BGI, 'sysroot/usr/lib/x86_64-linux-gnu')
      ])
    });
    assert.strictEqual(res.graphicsReady, true, JSON.stringify(res.libraryChecks, null, 1));
  });

  /* ================================================================== */
  section('F. direct-download fallback — idempotent re-run (no re-download)');
  await tAsync('pre-extracted toolchain is detected and re-used', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-dl-'));
    try {
      const binDir = path.join(tmp, 'mingw64-download', 'winlibs-x86_64-fake', 'mingw64', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fake = path.join(binDir, 'g++.exe');
      fs.writeFileSync(fake, '#!/bin/sh\necho "g++ (MinGW-W64 fake) 13.2.0"\n');
      fs.chmodSync(fake, 0o755);
      const res = await installCompilerWindowsDirect(tmp);
      assert.match(res.gppPath, /mingw64.*g\+\+\.exe$/);
      assert.ok(res.log.join('\n').includes('re-using previously extracted toolchain'), 'should reuse, log: ' + res.log.join(' | '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  await tAsync('verifyCompilerRun reads a real version line', async () => {
    const v = await verifyCompilerRun('g++');
    assert.ok(v.ok, 'sandbox g++ must run');
    assert.match(v.version, /g\+\+/);
  });

  /* ================================================================== */
  console.log(`\n=== pc-states: ${passed} passed, ${failed} failed ===`);
  if (failed) {
    failedNames.forEach((n) => console.log('  FAILED: ' + n));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('suite crashed:', e);
  process.exit(2);
});
