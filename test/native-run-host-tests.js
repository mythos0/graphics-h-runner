#!/usr/bin/env node
/**
 * native-run-host-tests.js — runs INSIDE a real VS Code extension host
 * (loaded by @vscode/test-electron via test/e2e-native-run.js) with a REAL
 * workspace folder open from process start.
 *
 * v1.5.12: validates the whole "native VS Code run" integration the way a
 * user experiences it:
 *   1. graphics-h-runner.nativeRunSetup writes .vscode/launch.json
 *      (graphics-h debug type as the F5 default), .vscode/tasks.json
 *      (default build task with the real graphics flags) and
 *      .vscode/settings.json (code-runner.executorMap.cpp + terminal mode).
 *   2. A REAL debug session is started FROM the written launch.json — the
 *      exact F5 path: it compiles the open probe through the Ctrl+Alt+R
 *      engine and launches the graphics window.
 *   3. A re-run of the command is idempotent (no duplicate entries).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.run = async function () {
  const vscode = require('vscode');
  const ext = vscode.extensions.getExtension('mythos0-labs.graphics-h-runner');
  assert.ok(ext, 'extension not found in the development host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension did not reach isActive');

  const cmds = await vscode.commands.getCommands(true);
  assert.ok(cmds.includes('graphics-h-runner.nativeRunSetup'), 'nativeRunSetup not registered');

  /* a REAL folder must be open (launchArgs guarantee it) */
  assert.ok(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1, 'test workspace folder missing');
  const wsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const dot = path.join(wsDir, '.vscode');

  /* point the doctor at the sandbox toolchain (same as activation-tests) */
  const BGI = '/home/z/my-project/bgi-env';
  const cfg = vscode.workspace.getConfiguration('graphics-h-runner');
  await cfg.update('compilerPath', '/usr/bin/g++', vscode.ConfigurationTarget.Global);
  await cfg.update('extraIncludePaths', [
    BGI + '/usr/include',
    BGI + '/sysroot/usr/include',
    BGI + '/sysroot/usr/include/x86_64-linux-gnu'
  ], vscode.ConfigurationTarget.Global);
  await cfg.update('extraLibPaths', [
    BGI + '/usr/lib',
    BGI + '/sysroot/usr/lib/x86_64-linux-gnu'
  ], vscode.ConfigurationTarget.Global);

  /* 1. the standalone command writes every native-run artifact */
  await vscode.commands.executeCommand('graphics-h-runner.nativeRunSetup');
  await new Promise((r) => setTimeout(r, 4000));

  const { parseJsonc } = require(path.join(__dirname, '..', 'out', 'nativeRun'));

  const launchText = fs.readFileSync(path.join(dot, 'launch.json'), 'utf8');
  const tasksText = fs.readFileSync(path.join(dot, 'tasks.json'), 'utf8');
  const settingsText = fs.readFileSync(path.join(dot, 'settings.json'), 'utf8');

  const launch = parseJsonc(launchText);
  assert.ok(launch, 'launch.json unparseable');
  assert.ok(Array.isArray(launch.configurations) && launch.configurations.length >= 1, 'no launch configurations');
  assert.strictEqual(launch.configurations[0].type, 'graphics-h', 'F5 default must be the graphics-h runner');
  assert.strictEqual(launch.configurations[0].request, 'launch');
  assert.strictEqual(launch.configurations[0].program, '${file}');

  const tasks = parseJsonc(tasksText);
  assert.ok(tasks, 'tasks.json unparseable');
  const ourTask = (tasks.tasks || []).find((t) => t.label === 'graphics.h: build active file');
  assert.ok(ourTask, 'build task missing');
  assert.strictEqual(ourTask.command, '/usr/bin/g++');
  assert.ok(ourTask.args.includes('${file}'), 'task compiles ${file}');
  const argStr = JSON.stringify(ourTask.args);
  assert.ok(argStr.includes('-lSDL_bgi'), 'task carries the SDL_bgi link list');
  assert.deepStrictEqual(ourTask.problemMatcher, ['$gcc']);
  assert.deepStrictEqual(ourTask.group, { kind: 'build', isDefault: true });
  assert.strictEqual(ourTask.options.cwd, '${fileDirname}');

  const settings = parseJsonc(settingsText);
  assert.ok(settings, 'settings.json unparseable');
  const exec = settings['code-runner.executorMap'] && settings['code-runner.executorMap'].cpp;
  assert.ok(exec, 'code-runner.executorMap.cpp missing from workspace settings');
  assert.ok(exec.includes('$fileName') && exec.includes('$dir'), 'executor template placeholders missing');
  assert.ok(exec.includes('/usr/bin/g++'), 'executor uses the configured compiler');
  assert.ok(exec.includes('&&'), 'executor must compile AND run');
  assert.strictEqual(settings['code-runner.runInTerminal'], true, 'Ctrl+Alt+N needs terminal input (cin/getch)');
  assert.strictEqual(settings['code-runner.saveFileBeforeRun'], true);
  assert.strictEqual(settings['C_Cpp.default.compilerPath'], '/usr/bin/g++');
  console.log('native-run-host-tests: .vscode artifacts OK — launch.json (graphics-h default), tasks.json (isDefault + $gcc), settings.json (executorMap.cpp + terminal)');

  /* 2. F5 EQUIVALENCE — start a REAL debug session FROM the written
   * launch.json (the file VS Code uses when the user presses F5). */
  const probe = path.join(wsDir, 'f5probe.cpp');
  fs.writeFileSync(probe, [
    '#include <graphics.h>',
    '#include <cstdio>',
    'int main() {',
    '  initwindow(160, 120);',
    '  setcolor(YELLOW);',
    '  bar(10, 10, 150, 110);',
    '  delay(200);',
    '  closegraph();',
    '  printf("F5-OK\\n");',
    '  return 0;',
    '}'
  ].join('\n'));

  const startedP = new Promise((res) => {
    const d = vscode.debug.onDidStartDebugSession(() => { d.dispose(); res(true); });
    setTimeout(() => { d.dispose(); res(false); }, 20000);
  });
  const termP = new Promise((res) => {
    const d = vscode.debug.onDidTerminateDebugSession(() => { d.dispose(); res(true); });
    setTimeout(() => { d.dispose(); res(false); }, 40000);
  });
  const configFromDisk = JSON.parse(JSON.stringify(launch.configurations[0]));
  configFromDisk.program = probe; /* ${file} = the open file in real usage */
  const launched = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0], configFromDisk);
  assert.ok(launched, 'startDebugging rejected the launch.json configuration');
  const started = await startedP;
  assert.ok(started, 'graphics-h debug session (from launch.json) never started');
  const terminated = await termP;
  assert.ok(terminated, 'graphics-h debug session (from launch.json) never terminated');
  assert.ok(fs.existsSync(probe.replace(/\.cpp$/, '')), 'the F5 session did not compile the probe');
  await vscode.commands.executeCommand('graphics-h-runner.stopProgram');
  await new Promise((r) => setTimeout(r, 500));
  console.log('native-run-host-tests: F5 equivalence OK — a session started FROM the written launch.json compiled + launched + terminated');

  /* 3. idempotency — a second run replaces, never duplicates */
  await vscode.commands.executeCommand('graphics-h-runner.nativeRunSetup');
  await new Promise((r) => setTimeout(r, 3000));
  const launch2 = parseJsonc(fs.readFileSync(path.join(dot, 'launch.json'), 'utf8'));
  assert.strictEqual(launch2.configurations.filter((c) => c.name === 'Run graphics.h program').length, 1, 'duplicate launch config on re-run');
  const tasks2 = parseJsonc(fs.readFileSync(path.join(dot, 'tasks.json'), 'utf8'));
  assert.strictEqual(tasks2.tasks.filter((t) => t.label === 'graphics.h: build active file').length, 1, 'duplicate task on re-run');
  const settings2 = parseJsonc(fs.readFileSync(path.join(dot, 'settings.json'), 'utf8'));
  assert.strictEqual(settings2['code-runner.executorMap'].cpp, exec, 'executor drifted on re-run');
  console.log('native-run-host-tests: idempotency OK — second run replaced in place, nothing duplicated');

  /* 4. merge discipline — a user task/config added between runs survives */
  const tasksTextNow = fs.readFileSync(path.join(dot, 'tasks.json'), 'utf8');
  fs.writeFileSync(path.join(dot, 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [...parseJsonc(tasksTextNow).tasks, { label: 'my own task', type: 'shell', command: 'make' }]
  }, null, 4));
  await vscode.commands.executeCommand('graphics-h-runner.nativeRunSetup');
  await new Promise((r) => setTimeout(r, 2500));
  const tasks3 = parseJsonc(fs.readFileSync(path.join(dot, 'tasks.json'), 'utf8'));
  assert.ok(tasks3.tasks.some((t) => t.label === 'my own task'), 'user task destroyed by re-run');
  assert.strictEqual(tasks3.tasks.filter((t) => t.label === 'graphics.h: build active file').length, 1, 'our task duplicated');
  console.log('native-run-host-tests: merge discipline OK — user task preserved alongside ours');

  console.log('NATIVE-RUN HOST TESTS PASS');
};
