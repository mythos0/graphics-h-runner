#!/usr/bin/env node
/**
 * globalize-tests.js — unit tests for src/globalize.ts + src/runwrap.ts.
 *
 * The v1.5.1 "works ANYWHERE" feature: WinBGIM copied into the toolchain's
 * own include/lib dirs, user PATH appended idempotently via the registry,
 * verified with a no-flags probe compile. Everything runs against a fake
 * process runner — no real compiler, no real registry.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  computeGlobalTargets,
  parseRegQueryPath,
  appendPathEntry,
  makeGlobalWindows
} = require(path.join(ROOT, 'out', 'globalize'));
const {
  shQuote,
  buildPauseCmdScript,
  writePauseWrapper,
  buildPosixPauseLaunch,
  universalCommandDoc
} = require(path.join(ROOT, 'out', 'runwrap'));

let passed = 0;
let failed = 0;
function t(name, fn) {
  /* fn may be sync or async; failures set the process exit code */
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log('  ok - ' + name);
    })
    .catch((e) => {
      failed++;
      process.exitCode = 1;
      console.error('  FAIL - ' + name + '\n    ' + (e && e.message ? e.message : e));
    });
}
function section(s) {
  console.log('\n' + s);
}

/* fake world: tmp toolchain + injectable runner with a simulated registry */
function makeFakeWorld(brokenProbe) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-global-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'g++.exe'), 'dummy');
  const includeDir = path.join(root, 'src-include');
  const libDir = path.join(root, 'src-lib');
  fs.mkdirSync(includeDir);
  fs.mkdirSync(libDir);
  fs.writeFileSync(path.join(includeDir, 'graphics.h'), '/* graphics.h */');
  fs.writeFileSync(path.join(includeDir, 'winbgim.h'), '/* winbgim.h */');
  fs.writeFileSync(path.join(libDir, 'libbgi.a'), 'LIBBGI');

  const calls = [];
  let regValue = '';
  const runner = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd.endsWith('g++.exe')) {
      return brokenProbe
        ? { code: 1, stdout: '', stderr: 'fatal error: graphics.h: No such file or directory' }
        : { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'reg' && args[0] === 'query') {
      return {
        code: 0,
        stdout: 'HKEY_CURRENT_USER\\Environment\n    Path    REG_EXPAND_SZ    ' + regValue + '\n',
        stderr: ''
      };
    }
    if (cmd === 'reg' && args[0] === 'add') {
      regValue = args[args.indexOf('/d') + 1];
      return { code: 0, stdout: 'The operation completed successfully.', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' }; /* powershell broadcast */
  };
  return { root, binDir, includeDir, libDir, calls, runner, getRegValue: () => regValue };
}

(async () => {
  /* ---------------------------------------------------------------- */
  section('A. pure helpers');
  await t('parseRegQueryPath: REG_EXPAND_SZ with spaces', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\Program Files\\mingw64\\bin;C:\\old\r\n';
    assert.strictEqual(parseRegQueryPath(out), 'C:\\Program Files\\mingw64\\bin;C:\\old');
  });
  await t('parseRegQueryPath: REG_SZ variant', () => {
    assert.strictEqual(parseRegQueryPath('    Path    REG_SZ    C:\\a'), 'C:\\a');
  });
  await t('parseRegQueryPath: missing -> null', () => {
    assert.strictEqual(parseRegQueryPath('HKEY_CURRENT_USER\\Environment'), null);
  });
  await t('appendPathEntry: appends to existing raw path', () => {
    const r = appendPathEntry('C:\\a;C:\\b', 'C:\\tc\\bin');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.next, 'C:\\a;C:\\b;C:\\tc\\bin');
  });
  await t('appendPathEntry: idempotent (case + trailing backslash insensitive)', () => {
    const r = appendPathEntry('C:\\TC\\BIN\\', 'c:\\tc\\bin');
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.next, 'C:\\TC\\BIN\\');
  });
  await t('appendPathEntry: null raw -> single entry', () => {
    const r = appendPathEntry(null, 'C:\\tc\\bin');
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.next, 'C:\\tc\\bin');
  });
  await t('appendPathEntry: drops empty segments, keeps order', () => {
    const r = appendPathEntry('C:\\a;;C:\\b;', 'C:\\c');
    assert.strictEqual(r.next, 'C:\\a;C:\\b;C:\\c');
  });
  await t('computeGlobalTargets: standard toolchain layout', () => {
    const g = computeGlobalTargets('/opt/tc/bin/g++.exe');
    assert.strictEqual(g.binDir, '/opt/tc/bin');
    assert.strictEqual(g.toolchainRoot, '/opt/tc');
    assert.ok(g.includeCandidates[0].endsWith('/opt/tc/include'));
    assert.ok(g.libCandidates[0].endsWith('/opt/tc/lib'));
  });
  await t('computeGlobalTargets: triplet mirror detected from path', () => {
    const g = computeGlobalTargets('/opt/msys/ucrt64/bin/x86_64-w64-mingw32-g++.exe');
    assert.strictEqual(g.triplet, 'x86_64-w64-mingw32');
    assert.strictEqual(g.includeCandidates.length, 2);
    assert.ok(g.includeCandidates[1].endsWith('/opt/msys/ucrt64/x86_64-w64-mingw32/include'));
  });
  await t('shQuote escapes single quotes', () => {
    assert.strictEqual(shQuote("/home/o'brien/a"), "'/home/o'\\''brien/a'");
  });
  await t('universal command carries the BGI libs', () => {
    for (const lib of ['-lbgi', '-lgdi32', '-lcomdlg32', '-luuid', '-loleaut32', '-lole32']) {
      assert.ok(universalCommandDoc().includes(lib), lib);
    }
  });

  /* ---------------------------------------------------------------- */
  section('B. run wrappers');
  await t('buildPauseCmdScript: quoted exe + exit code + pause', () => {
    const s = buildPauseCmdScript('C:\\my dir\\student.exe');
    assert.ok(s.startsWith('@echo off'));
    assert.ok(s.includes('"C:\\my dir\\student.exe"'));
    assert.ok(s.includes('%ERRORLEVEL%'));
    assert.ok(s.includes('pause >nul'));
  });
  await t('writePauseWrapper: writes <exe>.run.cmd next to the exe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-wrap-'));
    try {
      const exe = path.join(dir, 'student.exe');
      fs.writeFileSync(exe, 'dummy');
      const w = writePauseWrapper(exe);
      assert.ok(w.wrapperFile, 'wrapper path returned');
      assert.ok(fs.existsSync(w.wrapperFile), 'wrapper file written');
      assert.strictEqual(w.wrapperFile, path.join(dir, 'student.run.cmd'));
      assert.ok(w.shellArgs.includes(w.wrapperFile));
      assert.ok(/cmd\.exe$/i.test(w.shellPath), 'absolute ComSpec shell');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  await t('buildPosixPauseLaunch: quoted binary + exit code + read', () => {
    const w = buildPosixPauseLaunch('/home/st/my prog');
    assert.strictEqual(w.shellPath, '/bin/bash');
    const script = w.shellArgs[1];
    assert.ok(script.includes("'/home/st/my prog'"), 'quoted path');
    assert.ok(script.includes('$s'), 'exit code capture');
    assert.ok(script.includes('read -r'), 'holds the window open');
  });

  /* ---------------------------------------------------------------- */
  section('C. makeGlobalWindows full flow (fake runner)');

  await t('happy path: copies trio, probe OK, PATH appended, readme written', async () => {
    const w = makeFakeWorld(false);
    const res = await makeGlobalWindows({
      compilerPath: path.join(w.binDir, 'g++.exe'),
      includeDir: w.includeDir,
      libDir: w.libDir,
      runner: w.runner
    });
    assert.strictEqual(res.globalProbeOk, true, res.log.join('\n'));
    assert.strictEqual(res.pathOk, true);
    assert.strictEqual(res.pathChanged, true);
    assert.ok(fs.existsSync(path.join(w.root, 'include', 'graphics.h')), 'graphics.h copied into toolchain');
    assert.ok(fs.existsSync(path.join(w.root, 'include', 'winbgim.h')), 'winbgim.h copied');
    assert.ok(fs.existsSync(path.join(w.root, 'lib', 'libbgi.a')), 'libbgi.a copied');
    assert.ok(w.getRegValue().toLowerCase().includes(w.binDir.toLowerCase()), 'registry got the bin dir');
    assert.ok(fs.existsSync(path.join(w.root, 'graphics-h-anywhere.txt')), 'readme written');
  });

  await t('idempotent re-run: PATH entry not duplicated', async () => {
    const w = makeFakeWorld(false);
    const opts = {
      compilerPath: path.join(w.binDir, 'g++.exe'),
      includeDir: w.includeDir,
      libDir: w.libDir,
      runner: w.runner
    };
    await makeGlobalWindows(opts);
    const addsAfterFirst = w.calls.filter((c) => c.startsWith('reg add')).length;
    assert.strictEqual(addsAfterFirst, 1, 'first run adds once');
    const res2 = await makeGlobalWindows(opts);
    assert.strictEqual(res2.pathChanged, false, 'second run is a PATH no-op');
    assert.strictEqual(res2.globalProbeOk, true);
  });

  await t('probe failure -> globalProbeOk=false, PATH still created, no crash', async () => {
    const w = makeFakeWorld(true);
    const res = await makeGlobalWindows({
      compilerPath: path.join(w.binDir, 'g++.exe'),
      includeDir: w.includeDir,
      libDir: w.libDir,
      runner: async (cmd, args) => {
        if (cmd.endsWith('g++.exe')) {
          return { code: 1, stdout: '', stderr: 'graphics.h: No such file or directory' };
        }
        if (cmd === 'reg' && args[0] === 'query') {
          /* fresh account: no user Path value exists yet */
          return { code: 1, stdout: '', stderr: 'unable to find' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
    });
    assert.strictEqual(res.globalProbeOk, false);
    assert.strictEqual(res.pathOk, true, 'missing Path value is created, not skipped');
    assert.strictEqual(res.pathChanged, true);
    assert.ok(fs.existsSync(path.join(w.root, 'include', 'graphics.h')), 'copy still happened');
  });

  await t('missing WinBGIM sources -> friendly error', async () => {
    const w = makeFakeWorld(false);
    fs.rmSync(path.join(w.libDir, 'libbgi.a'));
    await assert.rejects(
      () =>
        makeGlobalWindows({
          compilerPath: path.join(w.binDir, 'g++.exe'),
          includeDir: w.includeDir,
          libDir: w.libDir,
          runner: w.runner
        }),
      (e) => /WinBGIM file missing/.test(e.message) && e.message.includes('libbgi.a')
    );
  });

  console.log('\nglobalize-tests: ' + passed + ' passed, ' + failed + ' failed, exitCode=' + (process.exitCode || 0));
})().catch((e) => {
  console.error('FATAL: ' + e);
  process.exit(1);
});
