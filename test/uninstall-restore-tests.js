#!/usr/bin/env node
/**
 * uninstall-restore-tests.js — v1.5.13 "clean exit" battery (pure Node).
 *
 * Pins the whole uninstall-revert feature from src/uninstallRestore.ts:
 *   1. backup primitives: first-wins snapshot, noteWritten merge discipline
 *   2. changedManagedKeys: the exact per-key write bookkeeping
 *   3. surgical settings.json restore (executorMap.cpp subkey semantics,
 *      scalar restore/remove, byte-exact corrupt-pre fallback)
 *   4. surgical launch.json / tasks.json restore (own entry removed,
 *      same-name user entry restored, created file deleted when empty)
 *   5. FULL LIFECYCLE round-trip in a real temp dir: snapshot -> simulate
 *      setup writes -> restore -> byte/semantic equality + backup cleanup
 *   6. partial failure keeps the backup for retry
 *   7. isRealUninstall discriminator: shutdown vs update vs uninstall,
 *      stale .obsolete protection, garbage tolerance
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureBackup,
  hasBackup,
  readBackup,
  noteWritten,
  changedManagedKeys,
  computeSettingsRestoreOps,
  computeConfigRestoreOps,
  restoreFromBackup,
  isRealUninstall,
  readTextOrNull,
  MANAGED_SETTINGS_KEYS,
  GLOBAL_SNAPSHOT_KEYS,
  EXECUTOR_MAP_KEY,
  CORRUPT_BACKUP_SUFFIX
} = require(path.join(__dirname, '..', 'out', 'uninstallRestore'));

const { LAUNCH_CONFIG_NAME, TASK_LABEL } = require(path.join(__dirname, '..', 'out', 'nativeRun'));

let failures = 0;
let passed = 0;
const asyncJobs = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failures++;
    console.log('  ❌ ' + name + ' -> ' + e.message);
  }
}
function acheck(name, fn) {
  asyncJobs.push(
    (async () => {
      try {
        await fn();
        passed++;
        console.log('  ✅ ' + name);
      } catch (e) {
        failures++;
        console.log('  ❌ ' + name + ' -> ' + e.message);
      }
    })()
  );
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const j = (o) => JSON.stringify(o);

/* ================================ 1+2. backup primitives ================ */
console.log('\nuninstall-restore-tests — backup primitives\n');

acheck('ensureBackup creates a backup once; second call never overwrites (FIRST WINS)', async () => {
  const dir = tmpdir('ghr-ur-prim-');
  const ok1 = await ensureBackup(dir, {
    extensionVersion: '1.5.13',
    global: { 'a.b': { set: false } },
    files: { '/ws/.vscode/launch.json': null }
  });
  assert.strictEqual(ok1, true, 'first ensureBackup must create');
  const before = fs.readFileSync(path.join(dir, 'uninstall-backup.json'), 'utf8');
  const ok2 = await ensureBackup(dir, {
    extensionVersion: '9.9.9',
    global: { 'a.b': { set: true, value: 'MODIFIED' } },
    files: {}
  });
  assert.strictEqual(ok2, false, 'second ensureBackup must NOT overwrite');
  const after = fs.readFileSync(path.join(dir, 'uninstall-backup.json'), 'utf8');
  assert.strictEqual(after, before, 'first-wins snapshot was overwritten');
});

acheck('noteWritten merges global keys (dedup) and settings keys (union, canonical order)', async () => {
  const dir = tmpdir('ghr-ur-note-');
  await ensureBackup(dir, { extensionVersion: '1.5.13', global: {}, files: {} });
  const p = '/ws/.vscode/settings.json';
  await noteWritten(dir, { globalKeys: ['x.y', 'x.z'] });
  await noteWritten(dir, { globalKeys: ['x.y'] }); // dedup
  await noteWritten(dir, { files: [{ path: p, kind: 'settings', keys: ['code-runner.runInTerminal'] }] });
  await noteWritten(dir, { files: [{ path: p, kind: 'settings', keys: [EXECUTOR_MAP_KEY] }] });
  const b = await readBackup(dir);
  assert.deepStrictEqual(b.writtenGlobal, ['x.y', 'x.z']);
  assert.strictEqual(b.writtenFiles.length, 1, 'same file must merge into one record');
  assert.deepStrictEqual(b.writtenFiles[0].keys, MANAGED_SETTINGS_KEYS.filter((k) => k === EXECUTOR_MAP_KEY || k === 'code-runner.runInTerminal'));
});

check('noteWritten without a backup is a silent no-op (never creates one)', async () => {
  const dir = tmpdir('ghr-ur-nobackup-');
  await noteWritten(dir, { globalKeys: ['x.y'] });
  assert.strictEqual(await hasBackup(dir), false);
});

check('changedManagedKeys reports only the keys a write really changed', () => {
  const before = j({ 'editor.tabSize': 2, 'code-runner.executorMap': { javascript: 'node' } });
  const after = j({
    'editor.tabSize': 2,
    'code-runner.executorMap': { javascript: 'node', cpp: 'g++' },
    'code-runner.runInTerminal': true
  });
  assert.deepStrictEqual(changedManagedKeys(before, after), [EXECUTOR_MAP_KEY, 'code-runner.runInTerminal']);
  assert.deepStrictEqual(changedManagedKeys(after, after), [], 'identical text -> no keys');
  assert.deepStrictEqual(changedManagedKeys(undefined, after), [EXECUTOR_MAP_KEY, 'code-runner.runInTerminal'], 'fresh file -> all present keys');
});

/* ============================ 3. settings restore ======================== */
console.log('\nuninstall-restore-tests — surgical settings.json restore\n');

const MANAGED = MANAGED_SETTINGS_KEYS;

check('file CREATED by setup and holding only our keys -> file is deleted again', () => {
  const cur = j({
    'code-runner.executorMap': { cpp: 'g++ ...' },
    'code-runner.runInTerminal': true,
    'C_Cpp.default.compilerPath': '/usr/bin/g++'
  });
  const ops = computeSettingsRestoreOps(null, cur, MANAGED);
  assert.strictEqual(ops.deleteFile, true);
});

check('file CREATED by setup + later user additions -> our keys removed, user keys kept', () => {
  const cur = j({
    'code-runner.executorMap': { cpp: 'g++ ...' },
    'code-runner.runInTerminal': true,
    'C_Cpp.default.compilerPath': '/usr/bin/g++',
    'editor.tabSize': 2
  });
  const ops = computeSettingsRestoreOps(null, cur, MANAGED);
  assert.strictEqual(ops.deleteFile, false);
  const doc = JSON.parse(ops.text);
  assert.strictEqual(doc['editor.tabSize'], 2, 'user key must survive');
  assert.strictEqual(doc['code-runner.executorMap'], undefined);
  assert.strictEqual(doc['code-runner.runInTerminal'], undefined);
  assert.strictEqual(doc['C_Cpp.default.compilerPath'], undefined);
  assert.strictEqual(ops.changed, true);
});

check("pre-existing executorMap with the user's own cpp -> cpp restored to the pre value", () => {
  const pre = j({ 'code-runner.executorMap': { cpp: 'clang++ custom', java: 'javac' } });
  const cur = j({ 'code-runner.executorMap': { cpp: 'g++ graphics-wired', java: 'javac' } });
  const ops = computeSettingsRestoreOps(pre, cur, [EXECUTOR_MAP_KEY]);
  assert.strictEqual(ops.deleteFile, false);
  const doc = JSON.parse(ops.text);
  assert.strictEqual(doc['code-runner.executorMap'].cpp, 'clang++ custom');
  assert.strictEqual(doc['code-runner.executorMap'].java, 'javac', "user's other executors survive");
});

check("pre-existing executorMap WITHOUT cpp (user's java only) -> our cpp removed, java kept", () => {
  const pre = j({ 'code-runner.executorMap': { java: 'javac' } });
  const cur = j({ 'code-runner.executorMap': { java: 'javac', cpp: 'g++ graphics-wired' } });
  const ops = computeSettingsRestoreOps(pre, cur, [EXECUTOR_MAP_KEY]);
  const doc = JSON.parse(ops.text);
  assert.deepStrictEqual(doc['code-runner.executorMap'], { java: 'javac' });
  assert.strictEqual(ops.changed, true);
});

check('scalar keys: absent before -> removed; present before -> restored to the pre value', () => {
  const pre = j({ 'code-runner.saveFileBeforeRun': false, 'C_Cpp.default.compilerPath': 'old-g++' });
  const cur = j({ 'code-runner.saveFileBeforeRun': true, 'C_Cpp.default.compilerPath': 'new-g++', 'code-runner.runInTerminal': true });
  const ops = computeSettingsRestoreOps(pre, cur, MANAGED);
  const doc = JSON.parse(ops.text);
  assert.strictEqual(doc['code-runner.saveFileBeforeRun'], false, 'restored to pre value');
  assert.strictEqual(doc['C_Cpp.default.compilerPath'], 'old-g++');
  assert.strictEqual(doc['code-runner.runInTerminal'], undefined, 'did not exist before -> removed');
  assert.strictEqual(ops.changed, true);
});

check('already-reverted file -> changed=false (no pointless rewrite)', () => {
  const pre = j({ 'code-runner.executorMap': { cpp: 'old' } });
  const ops = computeSettingsRestoreOps(pre, pre, [EXECUTOR_MAP_KEY]);
  assert.strictEqual(ops.changed, false);
  assert.strictEqual(ops.deleteFile, false);
});

check('corrupt ORIGINAL -> byte-exact restore (the v1.5.12 merge replaced it wholesale)', () => {
  const corrupt = '{ // trailing garbage with no closing brace...';
  const cur = j({ 'code-runner.executorMap': { cpp: 'g++' } });
  const ops = computeSettingsRestoreOps(corrupt, cur, MANAGED);
  assert.strictEqual(ops.text, corrupt, 'must restore the original bytes');
  assert.strictEqual(ops.changed, true);
});

check('current file corrupt + file was created by setup -> deleted', () => {
  const ops = computeSettingsRestoreOps(null, '{ oops', MANAGED);
  assert.strictEqual(ops.deleteFile, true);
});

/* ============================ 4. launch/tasks restore ==================== */
console.log('\nuninstall-restore-tests — launch/tasks restore\n');

check('launch.json CREATED by setup with only our entry -> deleted', () => {
  const cur = j({ version: '0.2.0', configurations: [{ type: 'graphics-h', name: LAUNCH_CONFIG_NAME, request: 'launch', program: '${file}' }] });
  const ops = computeConfigRestoreOps(null, cur, 'configurations', 'name', LAUNCH_CONFIG_NAME);
  assert.strictEqual(ops.deleteFile, true);
});

check('launch.json created + user added their own entry afterwards -> ours removed, theirs kept', () => {
  const userEntry = { type: 'cppdbg', name: 'My Own Launch', request: 'launch' };
  const cur = j({
    version: '0.2.0',
    configurations: [
      { type: 'graphics-h', name: LAUNCH_CONFIG_NAME, request: 'launch', program: '${file}' },
      userEntry
    ]
  });
  const ops = computeConfigRestoreOps(null, cur, 'configurations', 'name', LAUNCH_CONFIG_NAME);
  assert.strictEqual(ops.deleteFile, false);
  const doc = JSON.parse(ops.text);
  assert.deepStrictEqual(doc.configurations, [userEntry]);
});

check('user had the SAME-name entry before -> their original entry restored verbatim', () => {
  const userOriginal = { type: 'cppdbg', name: LAUNCH_CONFIG_NAME, request: 'launch', program: 'mine' };
  const pre = j({ version: '0.2.0', configurations: [userOriginal] });
  const cur = j({ version: '0.2.0', configurations: [{ type: 'graphics-h', name: LAUNCH_CONFIG_NAME, program: '${file}' }] });
  const ops = computeConfigRestoreOps(pre, cur, 'configurations', 'name', LAUNCH_CONFIG_NAME);
  assert.strictEqual(ops.deleteFile, false);
  const doc = JSON.parse(ops.text);
  assert.deepStrictEqual(doc.configurations, [userOriginal]);
});

check('user entries + our appended task -> ours removed, order and rest of doc preserved', () => {
  const pre = j({
    version: '2.0.0',
    tasks: [{ label: 'theirs', type: 'shell', command: 'make' }],
    somethingElse: true
  });
  const cur = j({
    version: '2.0.0',
    tasks: [{ label: 'theirs', type: 'shell', command: 'make' }, { label: TASK_LABEL, type: 'shell', command: 'g++' }],
    somethingElse: true
  });
  const ops = computeConfigRestoreOps(pre, cur, 'tasks', 'label', TASK_LABEL);
  assert.strictEqual(ops.deleteFile, false);
  const doc = JSON.parse(ops.text);
  assert.strictEqual(doc.tasks.length, 1);
  assert.strictEqual(doc.tasks[0].label, 'theirs');
  assert.strictEqual(doc.somethingElse, true, 'non-array keys survive');
});

check('corrupt CURRENT + valid pre -> raw original restored', () => {
  const pre = j({ version: '2.0.0', tasks: [{ label: 't' }] });
  const ops = computeConfigRestoreOps(pre, '{ broken', 'tasks', 'label', TASK_LABEL);
  assert.strictEqual(ops.text, pre);
  assert.strictEqual(ops.changed, true);
});

/* ======================== 5+6. full lifecycle round-trip ================= */
console.log('\nuninstall-restore-tests — full lifecycle round-trip (real temp dir)\n');

acheck('snapshot -> setup writes -> restore = exact pre state; backup gone; corrupt-copies cleaned', async () => {
  const backupDir = tmpdir('ghr-ur-cycle-backup-');
  const wsDir = tmpdir('ghr-ur-cycle-ws-');
  const dot = path.join(wsDir, '.vscode');
  fs.mkdirSync(dot, { recursive: true });

  const settingsPath = path.join(dot, 'settings.json');
  const launchPath = path.join(dot, 'launch.json');
  const tasksPath = path.join(dot, 'tasks.json');

  const preSettings = '{\n  // user comment\n  "editor.tabSize": 2,\n  "code-runner.executorMap": { "javascript": "node" }\n}\n';
  fs.writeFileSync(settingsPath, preSettings);
  fs.writeFileSync(tasksPath, JSON.stringify({ version: '2.0.0', tasks: [{ label: 'theirs', type: 'shell', command: 'make' }] }, null, 4) + '\n');
  /* launch.json did NOT exist before */

  /* 1. snapshot (what extension.ts does at setup start) */
  await ensureBackup(backupDir, {
    extensionVersion: '1.5.13',
    global: {
      'graphics-h-runner.compilerPath': { set: false },
      'graphics-h-runner.extraIncludePaths': { set: true, value: ['/old-include'] }
    },
    files: {
      [settingsPath]: preSettings,
      [launchPath]: null,
      [tasksPath]: readTextOrNull(tasksPath)
    }
  });

  /* 2. what the setup writes + bookkeeping */
  fs.writeFileSync(settingsPath, j({
    'editor.tabSize': 2,
    'code-runner.executorMap': { javascript: 'node', cpp: 'g++ wired' },
    'code-runner.runInTerminal': true,
    'C_Cpp.default.compilerPath': '/usr/bin/g++'
  }, null, 4) + '\n');
  fs.writeFileSync(launchPath, j({ version: '0.2.0', configurations: [{ type: 'graphics-h', name: LAUNCH_CONFIG_NAME }] }, null, 4) + '\n');
  fs.writeFileSync(tasksPath, j({ version: '2.0.0', tasks: [{ label: 'theirs', type: 'shell', command: 'make' }, { label: TASK_LABEL, type: 'shell', command: 'g++' }] }, null, 4) + '\n');
  fs.writeFileSync(settingsPath + CORRUPT_BACKUP_SUFFIX, 'old corrupt copy');
  await noteWritten(backupDir, { globalKeys: ['graphics-h-runner.compilerPath', 'graphics-h-runner.extraIncludePaths'] });
  await noteWritten(backupDir, {
    files: [
      { path: settingsPath, kind: 'settings', keys: [EXECUTOR_MAP_KEY, 'code-runner.runInTerminal', 'C_Cpp.default.compilerPath'] },
      { path: launchPath, kind: 'launch' },
      { path: tasksPath, kind: 'tasks' }
    ]
  });

  /* 3. restore */
  const applied = [];
  const res = await restoreFromBackup(backupDir, {
    log: () => undefined,
    applyGlobal: async (key, value) => {
      applied.push({ key, value });
    }
  });

  assert.strictEqual(res.status, 'restored');
  assert.strictEqual(res.errors.length, 0, 'errors: ' + res.errors.join('; '));
  assert.deepStrictEqual(applied, [
    { key: 'graphics-h-runner.compilerPath', value: undefined },
    { key: 'graphics-h-runner.extraIncludePaths', value: ['/old-include'] }
  ]);

  /* settings.json: surgical — user comment data + tabSize + javascript kept, our keys gone */
  const settingsDoc = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.strictEqual(settingsDoc['editor.tabSize'], 2);
  assert.deepStrictEqual(settingsDoc['code-runner.executorMap'], { javascript: 'node' });
  assert.strictEqual(settingsDoc['code-runner.runInTerminal'], undefined);
  assert.strictEqual(settingsDoc['C_Cpp.default.compilerPath'], undefined);
  /* launch.json: we created it and nothing else remained -> deleted */
  assert.strictEqual(fs.existsSync(launchPath), false, 'created launch.json must be deleted');
  /* tasks.json: theirs kept, ours gone */
  const tasksDoc = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  assert.deepStrictEqual(tasksDoc.tasks, [{ label: 'theirs', type: 'shell', command: 'make' }]);
  /* corrupt-copy sibling cleaned */
  assert.strictEqual(fs.existsSync(settingsPath + CORRUPT_BACKUP_SUFFIX), false, 'stale .graphics-h-backup must be removed');
  /* backup forgotten after success */
  assert.strictEqual(await hasBackup(backupDir), false, 'backup must be deleted after full success');

  /* 4. restoring again = nothing */
  const res2 = await restoreFromBackup(backupDir, { applyGlobal: async () => undefined });
  assert.strictEqual(res2.status, 'nothing');
});

acheck('partial failure (applyGlobal throws) KEEPS the backup for a retry', async () => {
  const backupDir = tmpdir('ghr-ur-fail-');
  await ensureBackup(backupDir, {
    extensionVersion: '1.5.13',
    global: { 'a.b': { set: true, value: 1 }, 'c.d': { set: false } },
    files: {}
  });
  await noteWritten(backupDir, { globalKeys: ['a.b', 'c.d'] });
  const res = await restoreFromBackup(backupDir, {
    applyGlobal: async (key) => {
      if (key === 'a.b') {
        throw new Error('settings file locked');
      }
    }
  });
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.restoredGlobal.length, 1, 'the other key still restored');
  assert.strictEqual(await hasBackup(backupDir), true, 'backup must survive a partial failure');
});

/* ============================ 7. uninstall detection ===================== */
console.log('\nuninstall-restore-tests — isRealUninstall discriminator\n');

function makeExtRoot(opts) {
  const root = tmpdir('ghr-ur-extroot-');
  const my = path.join(root, 'mythos0-labs.graphics-h-runner-1.5.13');
  fs.mkdirSync(my, { recursive: true });
  if (opts.obsolete) {
    fs.writeFileSync(path.join(root, '.obsolete'), JSON.stringify(opts.obsolete));
  }
  if (opts.newer) {
    fs.mkdirSync(path.join(root, 'mythos0-labs.graphics-h-runner-1.5.14'), { recursive: true });
  }
  if (opts.extensionsJson) {
    fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify(opts.extensionsJson));
  }
  return my;
}

acheck('no .obsolete file (plain shutdown/reload) -> false', async () => {
  assert.strictEqual(await isRealUninstall(makeExtRoot({})), false);
});

acheck('our folder marked, nothing else installed -> TRUE (real uninstall)', async () => {
  const my = makeExtRoot({ obsolete: { 'mythos0-labs.graphics-h-runner-1.5.13': true } });
  assert.strictEqual(await isRealUninstall(my), true);
});

acheck('our folder marked BUT a newer version folder is live -> false (that is an UPDATE)', async () => {
  const my = makeExtRoot({
    obsolete: { 'mythos0-labs.graphics-h-runner-1.5.13': true },
    newer: true
  });
  assert.strictEqual(await isRealUninstall(my), false);
});

acheck('our folder marked + sibling also obsolete (both being cleaned) -> true', async () => {
  const my = makeExtRoot({
    obsolete: {
      'mythos0-labs.graphics-h-runner-1.5.13': true,
      'mythos0-labs.graphics-h-runner-1.5.14': true
    },
    newer: true
  });
  assert.strictEqual(await isRealUninstall(my), true);
});

acheck('stale .obsolete but extensions.json still lists our folder -> false (safety)', async () => {
  const my = makeExtRoot({
    obsolete: { 'mythos0-labs.graphics-h-runner-1.5.13': true },
    extensionsJson: [
      {
        identifier: { id: 'mythos0-labs.graphics-h-runner' },
        relativeLocation: 'mythos0-labs.graphics-h-runner-1.5.13',
        version: '1.5.13'
      }
    ]
  });
  assert.strictEqual(await isRealUninstall(my), false);
});

acheck('garbage .obsolete JSON -> false (never touch settings on doubt)', async () => {
  const root = tmpdir('ghr-ur-garbage-');
  const my = path.join(root, 'mythos0-labs.graphics-h-runner-1.5.13');
  fs.mkdirSync(my, { recursive: true });
  fs.writeFileSync(path.join(root, '.obsolete'), 'not json at all');
  assert.strictEqual(await isRealUninstall(my), false);
});

acheck('only a FOREIGN extension marked in .obsolete -> false', async () => {
  const my = makeExtRoot({ obsolete: { 'other.publisher.ext-1.0.0': true } });
  assert.strictEqual(await isRealUninstall(my), false);
});

/* ================================ invariants ============================ */
console.log('\nuninstall-restore-tests — invariants\n');

check('GLOBAL_SNAPSHOT_KEYS covers exactly the settings the extension writes', () => {
  assert.deepStrictEqual([...GLOBAL_SNAPSHOT_KEYS], [
    'graphics-h-runner.extraIncludePaths',
    'graphics-h-runner.extraLibPaths',
    'graphics-h-runner.compilerPath',
    'code-runner.executorMap.cpp',
    'code-runner.runInTerminal',
    'code-runner.saveFileBeforeRun',
    'code-runner.fileDirectoryAsCwd',
    'C_Cpp.default.compilerPath'
  ]);
});

check('managed file names + corrupt-copy suffix are as the native-run merge writes them', () => {
  assert.strictEqual(CORRUPT_BACKUP_SUFFIX, '.graphics-h-backup');
});

(async () => {
  await Promise.all(asyncJobs);
  console.log(
    failures === 0
      ? `\nUNINSTALL-RESTORE TESTS ALL PASS (${passed} checks)`
      : `\n${failures} FAILURES (${passed} passed)`
  );
  process.exit(failures === 0 ? 0 : 1);
})();
