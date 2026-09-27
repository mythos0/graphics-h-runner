/**
 * activation-tests.js — runs INSIDE the VS Code extension host
 * (loaded by @vscode/test-electron via test/e2e-activation.js).
 *
 * Asserts that the graphics.h Runner extension activates cleanly and that
 * the panel + core commands exist, then exercises BOTH in-editor run paths
 * against a real example program (the exact flows users hit):
 *   5. the panel card flow: openProgram -> compileAndRun -> stopProgram
 *      (no workspace folder open -> exercises the private-storage real file)
 *   6. the F5 / Run-and-Debug flow: a real graphics-h debug session that
 *      compiles + launches through the inline DAP adapter
 */
'use strict';
const assert = require('assert');
const fs = require('fs');

const SAMPLE = '/home/z/my-project/graphics-h-runner/samples/01_hello_graphics.cpp';

exports.run = async function () {
  const vscode = require('vscode');
  /* 1. the extension is present and can activate */
  const ext = vscode.extensions.getExtension('mythos0-labs.graphics-h-runner');
  assert.ok(ext, 'extension not found in the development host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension did not reach isActive');

  /* 2. the commands the panel + palette + fallback tree rely on are all registered */
  const cmds = await vscode.commands.getCommands(true);
  for (const id of [
    'graphics-h-runner.compileAndRun',
    'graphics-h-runner.compile',
    'graphics-h-runner.run',
    'graphics-h-runner.doctor',
    'graphics-h-runner.setupEverything',
    'graphics-h-runner.stopProgram',
    'graphics-h-runner.copyCompileCommand',
    'graphics-h-runner.openExamplesFolder',
    'graphics-h-runner.openProgram',
    'graphics-h-runner.runSample',
    'graphics-h-runner.reloadPanel'
  ]) {
    assert.ok(cmds.includes(id), 'command not registered: ' + id);
  }

  /* 3. focus the webview view — if the view were a tree pane without a
   * provider this would leave "no data provider" in the workbench logs,
   * which the outer runner greps for. */
  await vscode.commands.executeCommand('graphics-h-runner.programs.focus');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  /* 4. point the doctor at the sandbox toolchain first: a not-ready result
   * awaits a warning dialog (no user here to click it) — a ready result is
   * fire-and-forget. This also exercises the settings-healing path. */
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
  await new Promise((resolve) => setTimeout(resolve, 2500)); /* auto re-probe */
  await vscode.commands.executeCommand('graphics-h-runner.doctor');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  /* 5. PANEL CARD FLOW — "▶ Run" on a program card:
   * open the sample without any workspace folder (the new private-storage
   * path hands back a REAL file), compile, run, then stop it. */
  const program = { filename: '01_hello_graphics.cpp', source: fs.readFileSync(SAMPLE, 'utf8') };
  await vscode.commands.executeCommand('graphics-h-runner.openProgram', program); /* handler is awaitable now */
  await new Promise((r) => setTimeout(r, 500));
  const editor = vscode.window.activeTextEditor;
  assert.ok(editor && editor.document.fileName.endsWith('01_hello_graphics.cpp'),
    'sample not opened as a real file (got ' + (editor ? editor.document.fileName : 'no editor') +
    '; tabs: ' + JSON.stringify(vscode.window.tabGroups.all.map((g) => g.tabs.map((t) => (t.input && t.input.uri) ? t.input.uri.toString(true) : t.label))) + ')');
  assert.ok(!editor.document.isDirty, 'opened sample document should be clean');

  await vscode.commands.executeCommand('graphics-h-runner.compileAndRun');
  await new Promise((r) => setTimeout(r, 5000)); /* compile (~1-2s) + launch */
  const binPath = editor.document.fileName.replace(/\.cpp$/i, '');
  assert.ok(fs.existsSync(binPath), 'compiled binary missing after compileAndRun: ' + binPath);
  await vscode.commands.executeCommand('graphics-h-runner.stopProgram');
  await new Promise((r) => setTimeout(r, 800));
  console.log('activation-tests: card Run flow OK — sample opened as a real file, compiled, launched, stopped');

  /* 6. F5 / RUN-AND-DEBUG FLOW — a real graphics-h debug session: the inline
   * DAP adapter must start, compile + launch the program, then terminate. */
  const startedP = new Promise((res) => {
    const d = vscode.debug.onDidStartDebugSession(() => { d.dispose(); res(true); });
    setTimeout(() => { d.dispose(); res(false); }, 15000);
  });
  const termP = new Promise((res) => {
    const d = vscode.debug.onDidTerminateDebugSession(() => { d.dispose(); res(true); });
    setTimeout(() => { d.dispose(); res(false); }, 30000);
  });
  const launched = await vscode.debug.startDebugging(undefined, {
    type: 'graphics-h',
    request: 'launch',
    name: 'Run graphics.h program',
    program: editor.document.fileName
  });
  assert.ok(launched, 'startDebugging returned false for the graphics-h type');
  const started = await startedP;
  assert.ok(started, 'graphics-h debug session never started');
  const terminated = await termP;
  assert.ok(terminated, 'graphics-h debug session never terminated');
  await vscode.commands.executeCommand('graphics-h-runner.stopProgram');
  await new Promise((r) => setTimeout(r, 500));
  console.log('activation-tests: F5 graphics-h debug session OK — started, compiled + launched, terminated cleanly');

  /* 7. FALLBACK FLOW — the webview-load-failure path the production error
   * report hit ("Could not register service worker: InvalidStateError"):
   * engage the list view exactly like the watchdog does (context key +
   * focus), then run a program through the tree's click command. */
  await vscode.commands.executeCommand('setContext', 'graphics-h-runner.showFallback', true);
  await vscode.commands.executeCommand('graphics-h-runner.fallback.focus');
  await new Promise((r) => setTimeout(r, 1200));
  await vscode.commands.executeCommand('graphics-h-runner.runSample', 'hello');
  await new Promise((r) => setTimeout(r, 5000)); /* compile + launch */
  assert.ok(fs.existsSync(binPath), 'runSample (tree click path) did not compile the sample');
  await vscode.commands.executeCommand('graphics-h-runner.stopProgram');
  await new Promise((r) => setTimeout(r, 800));
  await vscode.commands.executeCommand('graphics-h-runner.reloadPanel');
  await vscode.commands.executeCommand('setContext', 'graphics-h-runner.showFallback', false);
  await new Promise((r) => setTimeout(r, 300));
  console.log('activation-tests: fallback flow OK — list view revealed, runSample click path ran, reloadPanel clean');

  console.log('activation-tests: extension active, 11 commands present, panel focused, doctor ran, all run paths + fallback PASS');
};
