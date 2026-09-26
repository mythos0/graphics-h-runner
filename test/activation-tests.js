/**
 * activation-tests.js — runs INSIDE the VS Code extension host
 * (loaded by @vscode/test-electron via test/e2e-activation.js).
 *
 * Asserts that the graphics.h Runner extension activates cleanly and that
 * the panel + core commands exist and can be invoked.
 */
'use strict';
const assert = require('assert');

exports.run = async function () {
  const vscode = require('vscode');
  /* 1. the extension is present and can activate */
  const ext = vscode.extensions.getExtension('mythos0-labs.graphics-h-runner');
  assert.ok(ext, 'extension not found in the development host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension did not reach isActive');

  /* 2. the commands the panel + palette rely on are all registered */
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
    'graphics-h-runner.openProgram'
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

  console.log('activation-tests: extension active, 9 commands present, panel focused, doctor ran');
};
