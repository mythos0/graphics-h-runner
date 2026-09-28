#!/usr/bin/env node
/**
 * native-run-tests.js — v1.5.12 "native VS Code run" battery.
 *
 * Pins every artifact the new integration writes, PLUS a real end-to-end
 * proof: the Code Runner executor string generated for the sandbox Linux
 * toolchain is substituted ($dir/$fileName/$fileNameWithoutExt) and executed
 * through a real shell on a real graphics.h program (compile + link + run
 * under Xvfb) — the exact command Ctrl+Alt+N will run on a user PC.
 *
 * Pure module checks (no vscode import):
 *   1. JSONC: comments, strings with //, escapes, trailing commas, CRLF
 *   2. Windows executor: quoting, -static, the full WinBGIm -l list, run leg
 *   3. Linux executor: SDL libs + rpath, extensionless binary
 *   4. lib drift guard: executor always matches buildArgs' exported lists
 *   5. tasks.json: label/type/args/matcher/default-build semantics
 *   6. launch.json: the graphics-h debug type contract
 *   7. mergeConfigDoc: fresh / prepend / append / replace / corrupt-backup,
 *      user content preserved
 *   8. hasDefaultBuildTask semantics
 *   9. REAL compile+run of the generated executor (this platform)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const nr = require(path.join(ROOT, 'out', 'nativeRun'));
const { WINBGIM_LINK_LIBS, SDL_BGI_LINK_LIBS } = require(path.join(ROOT, 'out', 'buildArgs'));

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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('  ✅ ' + name);
  } catch (e) {
    failures++;
    console.log('  ❌ ' + name + ' -> ' + e.message);
  }
}

const WIN_INFO = {
  platform: 'windows',
  compilerPath: 'C:\\WinLibs\\mingw64\\bin\\g++.exe',
  includePaths: ['C:\\ext storage\\winbgim\\include'],
  libPaths: ['C:\\ext storage\\winbgim\\lib'],
  extraArgs: [],
  staticLinkWindows: true
};
const LIN_INFO = {
  platform: 'linux',
  compilerPath: '/usr/bin/g++',
  includePaths: [
    '/home/z/my-project/bgi-env/usr/include',
    '/home/z/my-project/bgi-env/sysroot/usr/include',
    '/home/z/my-project/bgi-env/sysroot/usr/include/x86_64-linux-gnu'
  ],
  libPaths: [
    '/home/z/my-project/bgi-env/usr/lib',
    '/home/z/my-project/bgi-env/sysroot/usr/lib/x86_64-linux-gnu'
  ],
  extraArgs: [],
  staticLinkWindows: true,
  linuxLibrary: 'sdl_bgi'
};

console.log('native-run-tests — v1.5.12 native VS Code run battery\n');

/* ---------- 1. JSONC tolerance ---------- */
check('JSONC: line + block comments stripped, strings kept verbatim', () => {
  const src = [
    '{',
    '  // full line comment',
    '  "a": "http://keep//this", /* block',
    '      spanning lines */',
    '  "b": 2',
    '}'
  ].join('\n');
  const parsed = nr.parseJsonc(src);
  assert.ok(parsed, 'parse failed');
  assert.strictEqual(parsed.a, 'http://keep//this');
  assert.strictEqual(parsed.b, 2);
});
check('JSONC: escapes and trailing commas survive', () => {
  const parsed = nr.parseJsonc('{ "s": "quote \\" and \\\\ back", "arr": [1, 2,], }');
  assert.ok(parsed);
  assert.strictEqual(parsed.s, 'quote " and \\ back');
  assert.deepStrictEqual(parsed.arr, [1, 2]);
});
check('JSONC: CRLF + version kept', () => {
  const parsed = nr.parseJsonc('{\r\n  "version": "0.2.0",\r\n  "configurations": [],\r\n}');
  assert.ok(parsed);
  assert.strictEqual(parsed.version, '0.2.0');
});
check('JSONC: corrupt file -> undefined (needsBackup path)', () => {
  assert.strictEqual(nr.parseJsonc('{ "a": '), undefined);
  assert.strictEqual(nr.parseJsonc('not json at all }}'), undefined);
});

/* ---------- 2. Windows executor ---------- */
check('Windows executor: quoting, static flags, full WinBGIm list, run leg', () => {
  const s = nr.codeRunnerExecutor(WIN_INFO);
  assert.ok(s.startsWith('cd "$dir" &&'), 'must cd into $dir first: ' + s);
  assert.ok(s.includes('-I"C:\\ext storage\\winbgim\\include"'), 'spaced include joined+quoted: ' + s.slice(0, 120));
  assert.ok(s.includes('$fileName -o $fileNameWithoutExt.exe'), 'source + out placeholders');
  assert.ok(s.includes('-static -lbgi'), 'static before libs');
  for (const lib of ['-lbgi', '-lgdi32', '-lcomdlg32', '-luuid', '-loleaut32', '-lole32']) {
    assert.ok(s.includes(lib + ' '), lib + ' missing');
  }
  assert.ok(s.includes('-static-libgcc -static-libstdc++'), 'runtime statics');
  assert.ok(s.trim().endsWith('&& "$dir$fileNameWithoutExt.exe"'), 'run leg: ' + s.slice(-60));
});
check('Windows executor: no static when staticLinkWindows=false', () => {
  const s = nr.codeRunnerExecutor({ ...WIN_INFO, staticLinkWindows: false });
  assert.ok(!s.includes('-static'), 'no -static expected');
});
check('Windows executor: bare g++ stays unquoted, spaced paths get quoted', () => {
  const s = nr.codeRunnerExecutor({ ...WIN_INFO, compilerPath: 'g++' });
  assert.ok(s.includes('&& g++ '), 'bare g++ unquoted');
  const spaced = nr.codeRunnerExecutor({ ...WIN_INFO, compilerPath: 'C:\\Win Libs\\mingw64\\bin\\g++.exe' });
  assert.ok(spaced.includes('"C:\\Win Libs\\mingw64\\bin\\g++.exe"'), 'spaced compiler quoted: ' + spaced.slice(0, 80));
});

/* ---------- 3. Linux executor ---------- */
check('Linux executor: SDL list, rpath per lib dir, extensionless run leg', () => {
  const s = nr.codeRunnerExecutor(LIN_INFO);
  assert.ok(s.includes('-L/home/z/my-project/bgi-env/usr/lib'), 'lib path');
  assert.ok(s.includes('-Wl,-rpath,/home/z/my-project/bgi-env/usr/lib'), 'rpath baked in');
  for (const lib of SDL_BGI_LINK_LIBS) {
    assert.ok(s.includes(lib), lib);
  }
  assert.ok(s.includes('$fileName -o $fileNameWithoutExt '), 'no .exe on linux out');
  assert.ok(s.trim().endsWith('&& "$dir$fileNameWithoutExt"'), 'linux run leg');
});

/* ---------- 4. drift guard ---------- */
check('lib drift guard: executor matches buildArgs exports exactly', () => {
  const win = nr.codeRunnerExecutor(WIN_INFO);
  for (const lib of WINBGIM_LINK_LIBS) assert.ok(win.includes(lib), 'win missing ' + lib);
  const lin = nr.codeRunnerExecutor(LIN_INFO);
  for (const lib of SDL_BGI_LINK_LIBS) assert.ok(lin.includes(lib), 'linux missing ' + lib);
});

/* ---------- 5. tasks.json ---------- */
check('tasks.json: default build task contract', () => {
  const doc = nr.buildTaskJson(LIN_INFO, true);
  assert.strictEqual(doc.version, '2.0.0');
  const t = doc.tasks[0];
  assert.strictEqual(t.label, nr.TASK_LABEL);
  assert.strictEqual(t.type, 'shell');
  assert.strictEqual(t.command, '/usr/bin/g++');
  assert.ok(t.args.includes('${file}'), '${file} compiled');
  const oi = t.args.indexOf('-o');
  assert.ok(oi > 0 && t.args[oi + 1] === '${fileDirname}/${fileBasenameNoExtension}', 'out var: ' + t.args[oi + 1]);
  assert.deepStrictEqual(t.options, { cwd: '${fileDirname}' });
  assert.deepStrictEqual(t.group, { kind: 'build', isDefault: true });
  assert.deepStrictEqual(t.problemMatcher, ['$gcc']);
  for (const lib of SDL_BGI_LINK_LIBS) assert.ok(t.args.includes(lib), lib);
});
check('tasks.json: no default steal when asked', () => {
  const t = nr.buildTaskJson(LIN_INFO, false).tasks[0];
  assert.strictEqual(t.group, 'build');
});
check('tasks.json (win): static + exe suffix in out path', () => {
  const t = nr.buildTaskJson(WIN_INFO, true).tasks[0];
  assert.ok(t.args.includes('-static'));
  const oi = t.args.indexOf('-o');
  assert.strictEqual(t.args[oi + 1], '${fileDirname}/${fileBasenameNoExtension}.exe');
});

/* ---------- 6. launch.json ---------- */
check('launch.json: graphics-h debug type contract', () => {
  const doc = nr.buildLaunchJson();
  assert.strictEqual(doc.version, '0.2.0');
  const c = doc.configurations[0];
  assert.strictEqual(c.type, 'graphics-h');
  assert.strictEqual(c.request, 'launch');
  assert.strictEqual(c.name, nr.LAUNCH_CONFIG_NAME);
  assert.strictEqual(c.program, '${file}');
});

/* ---------- 7. merging ---------- */
check('merge: fresh (empty) -> created, pretty JSON', () => {
  const r = nr.mergeConfigDoc(undefined, nr.buildLaunchJson(), 'configurations', 'name', nr.LAUNCH_CONFIG_NAME);
  assert.ok(r.created && !r.needsBackup);
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed.configurations[0].type, 'graphics-h');
});
check('merge: user configs preserved, ours PREPENDED as F5 default', () => {
  const existing = JSON.stringify({
    version: '0.2.0',
    configurations: [{ type: 'cppdbg', name: 'User g++ build', request: 'launch' }]
  });
  const r = nr.mergeConfigDoc(existing, nr.buildLaunchJson(), 'configurations', 'name', nr.LAUNCH_CONFIG_NAME, { prepend: true });
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed.configurations.length, 2);
  assert.strictEqual(parsed.configurations[0].type, 'graphics-h');
  assert.strictEqual(parsed.configurations[1].name, 'User g++ build');
});
check('merge: our entry replaced in place (idempotent, no dup)', () => {
  const existing = JSON.stringify({
    configurations: [
      { type: 'graphics-h', name: nr.LAUNCH_CONFIG_NAME, program: '${file}', stopOthers: true },
      { type: 'cppdbg', name: 'x' }
    ]
  });
  const r = nr.mergeConfigDoc(existing, nr.buildLaunchJson(), 'configurations', 'name', nr.LAUNCH_CONFIG_NAME, { prepend: true });
  assert.ok(r.replaced && !r.created);
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed.configurations.length, 2);
  assert.strictEqual(parsed.configurations[0].name, nr.LAUNCH_CONFIG_NAME);
  assert.strictEqual(parsed.configurations[0].stopOthers, undefined); /* our fresh shape won */
});
check('merge: tasks APPENDED, unrelated tasks + compounds kept', () => {
  const existing = JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'make', type: 'shell', command: 'make' }],
    compounds: [{ name: 'All', configurations: ['a'] }]
  });
  const r = nr.mergeConfigDoc(existing, nr.buildTaskJson(LIN_INFO, false), 'tasks', 'label', nr.TASK_LABEL);
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed.tasks.length, 2);
  assert.strictEqual(parsed.tasks[0].label, 'make');
  assert.strictEqual(parsed.tasks[1].label, nr.TASK_LABEL);
  assert.ok(parsed.compounds, 'compounds lost');
});
check('merge: comments tolerated, corrupt -> needsBackup with fresh text', () => {
  const commented = '{\n // my notes\n "tasks": []\n}';
  const r1 = nr.mergeConfigDoc(commented, nr.buildTaskJson(LIN_INFO, true), 'tasks', 'label', nr.TASK_LABEL);
  assert.ok(!r1.needsBackup);
  assert.strictEqual(JSON.parse(r1.text).tasks.length, 1);
  const r2 = nr.mergeConfigDoc('{{{{', nr.buildTaskJson(LIN_INFO, true), 'tasks', 'label', nr.TASK_LABEL);
  assert.ok(r2.needsBackup);
  assert.ok(JSON.parse(r2.text).tasks[0].label === nr.TASK_LABEL);
});

/* ---------- 8. hasDefaultBuildTask ---------- */
check('hasDefaultBuildTask: isDefault object true, "build" string false', () => {
  assert.ok(nr.hasDefaultBuildTask(JSON.stringify({ tasks: [{ label: 'x', group: { kind: 'build', isDefault: true } }] })));
  assert.ok(!nr.hasDefaultBuildTask(JSON.stringify({ tasks: [{ label: 'x', group: 'build' }] })));
  assert.ok(!nr.hasDefaultBuildTask(undefined));
  assert.ok(!nr.hasDefaultBuildTask('{ broken'));
});

/* ---------- 8b. settings.json merging (the Settings-API bypass) ---------- */
check('settings merge: fresh + patch applied', () => {
  const r = nr.mergeSettingsDoc(undefined, { 'code-runner.executorMap': { cpp: 'g++' }, 'code-runner.runInTerminal': true });
  assert.ok(r.created);
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed['code-runner.runInTerminal'], true);
  assert.strictEqual(parsed['code-runner.executorMap'].cpp, 'g++');
});
check('settings merge: user languages + unrelated keys survive, cpp replaced', () => {
  const existing = JSON.stringify({
    'editor.fontSize': 14,
    'code-runner.executorMap': { javascript: 'node', cpp: 'OLD' },
    'code-runner.runInTerminal': false
  });
  const r = nr.mergeSettingsDoc(existing, { 'code-runner.executorMap': { cpp: 'NEW' }, 'code-runner.runInTerminal': true });
  const parsed = JSON.parse(r.text);
  assert.strictEqual(parsed['editor.fontSize'], 14, 'unrelated key lost');
  assert.strictEqual(parsed['code-runner.executorMap'].javascript, 'node', 'other language lost');
  assert.strictEqual(parsed['code-runner.executorMap'].cpp, 'NEW');
  assert.strictEqual(parsed['code-runner.runInTerminal'], true);
});
check('settings merge: comments tolerated, no-change -> text untouched, corrupt -> backup', () => {
  const commented = '{\n // user note\n "code-runner.executorMap": { "cpp": "NEW" }\n}';
  const r1 = nr.mergeSettingsDoc(commented, { 'code-runner.executorMap': { cpp: 'NEW' } });
  assert.ok(!r1.needsBackup);
  assert.strictEqual(r1.text, commented, 'no-change must not rewrite the file');
  const r2 = nr.mergeSettingsDoc('{{{', { 'code-runner.executorMap': { cpp: 'NEW' } });
  assert.ok(r2.needsBackup);
  assert.strictEqual(JSON.parse(r2.text)['code-runner.executorMap'].cpp, 'NEW');
});

/* ---------- 9. REAL executor run on this platform (linux sandbox) ---------- */
const REAL_SRC = [
  '#include <graphics.h>',
  '#include <cstdio>',
  'int main() {',
  '  initwindow(220, 150);',
  '  setcolor(RED);',
  '  line(10, 10, 200, 130);',
  '  circle(110, 75, 40);',
  '  delay(250);',
  '  closegraph();',
  '  printf("NATIVE-RUN-OK\\n");',
  '  return 0;',
  '}'
].join('\n');

/* Code Runner substitution semantics: $dir carries the TRAILING separator
 * (the README ships $dirWithoutTrailingSlash as the no-separator variant,
 * and the stock template glues $dir$fileNameWithoutExt). */
function substituteExecutor(template, dir, noExt, fileName) {
  return template
    .replace(/\$fileNameWithoutExt/g, noExt)
    .replace(/\$fileName/g, fileName)
    .replace(/\$dir/g, dir + path.sep);
}

function sh(cmd, args, env) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(env || {}) } });
}

let DISPLAY = ':121';
const DISPLAY_NUM = '121';

/* same strategy as run-tests.js: the socket is the only reliable signal
 * here (xdpyinfo is not installed); stale artifacts are removed first */
function cleanStaleArtifacts() {
  try { fs.rmSync('/tmp/.X' + DISPLAY_NUM + '-lock', { force: true }); } catch { /* */ }
  try { fs.rmSync('/tmp/.X11-unix/X' + DISPLAY_NUM, { force: true }); } catch { /* */ }
}

async function startXvfb() {
  cleanStaleArtifacts();
  const xvfb = sh('Xvfb', [DISPLAY, '-screen', '0', '800x600x24', '-nolisten', 'tcp']);
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (xvfb.exitCode !== null) break;
    ready = fs.existsSync('/tmp/.X11-unix/X' + DISPLAY_NUM);
  }
  if (!ready) { try { xvfb.kill('SIGKILL'); } catch { /* */ } }
  return { xvfb: ready ? xvfb : null, cleanup: ready };
}

async function stopXvfb(handle) {
  if (handle.xvfb) { try { handle.xvfb.kill('SIGKILL'); } catch { /* */ } }
  if (handle.cleanup) {
    await new Promise((r) => setTimeout(r, 300));
    cleanStaleArtifacts();
  }
}

/** Run env for spawned graphics programs — mirrors run-tests.js. */
function graphicsEnv(DISPLAY) {
  const xdg = '/tmp/xdg-native-run';
  try { fs.mkdirSync(xdg, { recursive: true, mode: 0o700 }); } catch { /* */ }
  const extra = LIN_INFO.libPaths.join(':');
  return {
    DISPLAY,
    XDG_RUNTIME_DIR: xdg,
    SDL_VIDEODRIVER: 'x11',
    SDL_AUDIODRIVER: 'dummy',
    LD_LIBRARY_PATH: extra + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '')
  };
}

(async () => {
  await checkAsync('REAL RUN: generated executor compiles + runs a graphics.h program (Ctrl+Alt+N equivalent)', async () => {
    const handle = await startXvfb();
    assert.ok(handle.xvfb !== null, 'Xvfb not available on ' + DISPLAY);
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-native-run-'));
      const file = path.join(dir, 'native_probe.cpp');
      fs.writeFileSync(file, REAL_SRC);

      /* executor template -> the literal command Code Runner would send */
      const cmd = substituteExecutor(nr.codeRunnerExecutor(LIN_INFO), dir, 'native_probe', 'native_probe.cpp');
      assert.ok(!cmd.includes('$'), 'unsubstituted placeholder left: ' + cmd);

      const res = await new Promise((resolve) => {
        const p = spawn('sh', ['-c', cmd], { env: { ...process.env, ...graphicsEnv(DISPLAY) } });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { err += d; });
        const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, 30000);
        p.on('exit', (code) => { clearTimeout(killer); resolve({ code, out, err }); });
      });
      assert.strictEqual(res.code, 0, 'executor exit ' + res.code + '\nstderr: ' + res.err.slice(0, 400) + '\nstdout: ' + res.out.slice(0, 200));
      assert.ok(fs.existsSync(path.join(dir, 'native_probe')), 'binary not produced');
      assert.ok(res.out.includes('NATIVE-RUN-OK'), 'program stdout missing: ' + res.out);
      console.log('      command: ' + cmd.slice(0, 140) + '…');
    } finally {
      await stopXvfb(handle);
    }
  });

  await checkAsync('REAL RUN: plain C++ (no graphics.h) through the SAME executor — nothing breaks', async () => {
    const handle = await startXvfb();
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-native-plain-'));
      fs.writeFileSync(path.join(dir, 'plain_probe.cpp'), '#include <cstdio>\nint main(){ printf("PLAIN-OK\\n"); return 0; }\n');
      const cmd = substituteExecutor(nr.codeRunnerExecutor(LIN_INFO), dir, 'plain_probe', 'plain_probe.cpp');
      const res = await new Promise((resolve) => {
        const p = spawn('sh', ['-c', cmd], { env: { ...process.env, DISPLAY } });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { err += d; });
        const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, 30000);
        p.on('exit', (code) => { clearTimeout(killer); resolve({ code, out, err }); });
      });
      assert.strictEqual(res.code, 0, 'plain exit ' + res.code + '\nstderr: ' + res.err.slice(0, 400));
      assert.ok(res.out.includes('PLAIN-OK'), 'plain stdout missing');
    } finally {
      await stopXvfb(handle);
    }
  });

  console.log('');
  if (failures > 0) {
    console.log('native-run-tests: ' + failures + ' FAILURE(S)');
    process.exit(1);
  }
  console.log('native-run-tests: ALL PASS');
  process.exit(0);
})().catch((e) => {
  console.error('native-run-tests crashed:', e);
  process.exit(1);
});
