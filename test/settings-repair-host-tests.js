#!/usr/bin/env node
/**
 * settings-repair-host-tests.js — runs INSIDE the VS Code extension host
 * (loaded by @vscode/test-electron via test/e2e-settings-repair.js).
 *
 * Reproduces Sentry GRAPHICS-H-RUNNER-10 end to end in a REAL VS Code host
 * and then walks the REAL production fix path — no test doubles on the
 * extension side:
 *
 *   1. the harness seeded the throwaway user-data-dir with a hand-broken
 *      settings.json (missing comma + doubled comma);
 *   2. VS Code itself refuses the global settings write with the exact
 *      "Unable to write into user settings" refusal (the production error);
 *   3. `graphics-h-runner.nativeRunSetup` — a real registered command whose
 *      no-folder branch performs guarded global settings writes — runs; its
 *      guarded writer health-checks the settings file on ANY failure,
 *      repairs it (backup first) and retries;
 *   4. the file parses again, with a backup of the broken original next to
 *      it, and every user VALUE from the broken file survived;
 *   5. the SAME registered-key write that was refused in (2) now succeeds;
 *   6. Complete Setup (`graphics-h-runner.setupEverything`) runs to
 *      completion on this machine without crashing.
 *
 * (Writes of keys owned by extensions that are not installed — e.g.
 * code-runner.* without Code Runner — keep failing with VS Code's
 * documented "not a registered configuration" refusal even on a healthy
 * file; that class is rethrown to the caller's own handling by design.)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const settingsHealth = require(path.join(__dirname, '..', 'out', 'settingsHealth'));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

exports.run = async function () {
  const vscode = require('vscode');

  /* the extension is active (the guarded writer is part of this bundle) */
  const ext = vscode.extensions.getExtension('mythos0-labs.graphics-h-runner');
  assert.ok(ext, 'extension not found in the development host');
  await ext.activate();
  assert.ok(ext.isActive, 'extension did not reach isActive');

  /* 1. REPRODUCTION: VS Code refuses the global write on the broken file */
  const cfg = vscode.workspace.getConfiguration();
  let refused;
  try {
    await cfg.update('graphics-h-runner.extraIncludePaths', ['/nonexistent/probe'], vscode.ConfigurationTarget.Global);
  } catch (e) {
    refused = e;
  }
  assert.ok(refused, 'expected the settings write to be REFUSED on the broken settings.json — the environment no longer reproduces GRAPHICS-H-RUNNER-10');
  assert.strictEqual(
    settingsHealth.classifySettingsWriteError(refused),
    'user',
    'the refusal did not classify as a user-settings write block: ' + String(refused)
  );
  console.log('  settings-repair-host: refusal reproduced and classified (GRAPHICS-H-RUNNER-10 reproduced)');

  /* 2. PRODUCTION PATH: a real command performs guarded global writes.
   * The command is fire-and-forget (void nativeRunSetup()), so poll until
   * the guarded writer's repair lands. */
  await vscode.commands.executeCommand('graphics-h-runner.nativeRunSetup');

  /* 3. the settings file was repaired — it parses now. The harness passes
   * the seeded settings.json location (the same file the extension's
   * storage-derived candidate list resolves to in this host). */
  const found = process.env.GHR_SETTINGS_PATH;
  assert.ok(found && fs.existsSync(found), 'seeded settings.json missing: ' + found);

  const deadline = Date.now() + 45000;
  let parsed = settingsHealth.analyzeJsonc(fs.readFileSync(found, 'utf8'));
  while (Date.now() < deadline && !parsed.ok) {
    await sleep(250);
    parsed = settingsHealth.analyzeJsonc(fs.readFileSync(found, 'utf8'));
  }
  assert.strictEqual(
    parsed.ok,
    true,
    'settings.json still broken after the guarded write ran: ' + settingsHealth.describeErrors(parsed.errors)
  );

  /* a backup of the broken original exists next to the file */
  const siblings = fs.readdirSync(path.dirname(found));
  assert.ok(
    siblings.some((f) => f.startsWith('settings.json.graphics-h-broken-backup-')),
    'no broken-settings backup written next to the repaired file: ' + siblings.join(', ')
  );

  /* 4. every user VALUE from the broken file survived */
  assert.strictEqual(parsed.value['editor.fontSize'], 14);
  assert.strictEqual(parsed.value['workbench.colorTheme'], 'Default Dark Modern');
  assert.strictEqual(parsed.value['window.titleBarStyle'], 'custom');
  assert.strictEqual(parsed.value['explorer.confirmDelete'], true);
  console.log('  settings-repair-host: guarded writer repaired the file (backup kept, values preserved)');

  /* 5. the SAME registered-key write that was refused now succeeds.
   * VS Code reloads its settings model asynchronously after external file
   * changes (and this sandbox's watcher can lag), so poll the FILE on disk
   * — the authoritative state — for the value landing. */
  const writeDeadline = Date.now() + 15000;
  let landedValue;
  for (;;) {
    try {
      await cfg.update('graphics-h-runner.extraIncludePaths', ['/nonexistent/probe'], vscode.ConfigurationTarget.Global);
    } catch (e) { /* refused — model may still be reloading; retry */ }
    const onDisk = settingsHealth.analyzeJsonc(fs.readFileSync(found, 'utf8'));
    landedValue = onDisk.ok && onDisk.value && onDisk.value['graphics-h-runner.extraIncludePaths'];
    if (Array.isArray(landedValue) && landedValue.includes('/nonexistent/probe')) {
      break;
    }
    if (Date.now() > writeDeadline) {
      break;
    }
    await sleep(300);
  }
  assert.ok(
    Array.isArray(landedValue) && landedValue.includes('/nonexistent/probe'),
    'the repaired settings file did not accept the write on disk'
  );

  /* 6. Complete Setup runs on this machine without crashing */
  await vscode.commands.executeCommand('graphics-h-runner.setupEverything');

  /* cleanup: drop the probe value (the user-data-dir dies with the run) */
  await cfg.update('graphics-h-runner.extraIncludePaths', undefined, vscode.ConfigurationTarget.Global);

  console.log('  settings-repair-host: write accepted after repair, setup ran clean');
};
