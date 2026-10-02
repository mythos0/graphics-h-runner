#!/usr/bin/env node
/**
 * registry-tests.js — cross-artifact command consistency (v1.5.5).
 *
 * The class of bug reported ("Actual command not found, wanted to execute
 * graphics-h-runner.runSample /2") and every "Unknown action" toast comes
 * from an id that is REFERENCED somewhere but never REGISTERED (or vice
 * versa). This suite pins the whole command graph together:
 *
 *   1. every panel action (COMMAND_META) exists in contributes.commands;
 *   2. every command in menus / keybindings exists in contributes.commands;
 *   3. every contributed command is actually registered by the bundle
 *      (the literal id appears in dist/extension.js) — or is a documented
 *      dynamic per-node id (graphics-h-runner.runSample.<id>);
 *   4. the fallback tree model hands out exactly one static per-node id
 *      per program, and the bundle registers the prefix;
 *   5. the v1.5.5 regression: the compiled tree provider must NOT build
 *      TreeItem commands carrying `arguments`;
 *   6. the celebrations setting + the fireworks/stop commands exist.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));
const { TREE_RUN_COMMAND, treeRunCommandId } = require(path.join(ROOT, 'out', 'programsTreeModel'));
const { loadProgramCatalog } = require(path.join(ROOT, 'out', 'programs'));

const bundle = fs.readFileSync(path.join(ROOT, 'dist', 'extension.js'), 'utf8');
const treeSrc = fs.readFileSync(path.join(ROOT, 'out', 'programsTree.js'), 'utf8');

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

const contributed = new Set(pkg.contributes.commands.map((c) => c.command));
const INTERNAL = new Set(['setContext']); /* workbench-internal, not ours to register */

console.log('registry-tests — command graph consistency\n');

check('version is 1.5.16', () => {
  assert.strictEqual(pkg.version, '1.5.19');
});

check('v1.5.9 regression: view title = the single ? cheat-sheet icon (setup/doctor/fireworks icons removed)', () => {
  const items = (pkg.contributes.menus['view/title'] || []).filter(
    (i) => typeof i.when === 'string' && i.when.includes('graphics-h-runner.programs')
  );
  assert.strictEqual(items.length, 1, 'programs view title must carry exactly ONE action, got: '
    + items.map((i) => i.command).join(', '));
  assert.strictEqual(items[0].command, 'graphics-h-runner.cheatSheet');
  const cmd = pkg.contributes.commands.find((c) => c.command === 'graphics-h-runner.cheatSheet');
  assert.ok(cmd, 'cheatSheet not contributed');
  assert.strictEqual(cmd.icon, '$(question)', 'the ? icon missing');
  assert.ok(bundle.includes('graphics-h-runner.cheatSheet'), 'cheatSheet never registered in the bundle');
  assert.ok(bundle.includes('openCheatSheet'), 'bundle never calls openCheatSheet');
});

check('every panel action button is a contributed command', () => {
  for (const c of COMMAND_META) {
    assert.ok(contributed.has(c.commandId), 'panel action not contributed: ' + c.commandId);
  }
  const fw = COMMAND_META.find((c) => c.id === 'cmd-fireworks');
  assert.ok(fw, 'Fireworks Simulator action button missing');
  assert.strictEqual(fw.variant, 'festive', 'Fireworks Simulator must use the festive design');
  assert.strictEqual(fw.commandId, 'graphics-h-runner.fireworks');
});

check('every menu + keybinding command is contributed (or workbench-internal)', () => {
  const menus = pkg.contributes.menus || {};
  for (const [slot, items] of Object.entries(menus)) {
    for (const item of items) {
      assert.ok(contributed.has(item.command) || INTERNAL.has(item.command),
        `menu ${slot} references unknown command: ${item.command}`);
    }
  }
  for (const kb of pkg.contributes.keybindings || []) {
    assert.ok(contributed.has(kb.command) || INTERNAL.has(kb.command),
      'keybinding references unknown command: ' + kb.command);
  }
});

check('every contributed command is registered by the bundle', () => {
  for (const id of contributed) {
    assert.ok(bundle.includes("'" + id + "'") || bundle.includes('"' + id + '"'),
      'contributed command never registered in the bundle: ' + id);
  }
});

check('fallback view when-clause context keys are produced somewhere in the bundle', () => {
  for (const when of ['graphics-h-runner.showFallback', 'graphics-h-runner.fireworksRunning']) {
    assert.ok(bundle.includes(when), 'context key never set by the bundle: ' + when);
  }
});

check('tree model: one static per-node id per program, prefix registered', () => {
  const catalog = loadProgramCatalog(ROOT);
  assert.ok(catalog.length >= 3, 'catalog shrank: ' + catalog.length);
  const ids = new Set();
  for (const p of catalog) {
    const id = treeRunCommandId(p.id);
    assert.strictEqual(id, TREE_RUN_COMMAND + '.' + p.id, 'prefix drifted for ' + p.id);
    ids.add(id);
  }
  assert.strictEqual(ids.size, catalog.length, 'duplicate per-node command ids');
  assert.ok(bundle.includes(TREE_RUN_COMMAND + '.'), 'bundle must register the per-node prefix');
});

check('v1.5.5 regression: compiled tree provider never builds argument commands', () => {
  assert.ok(!srcHasArgumentsCommand(treeSrc),
    'programsTree.js still constructs a TreeItem command with arguments');
  function srcHasArgumentsCommand(src) {
    return /command:\s*\{[^}]*arguments\s*:/.test(src);
  }
});

check('celebrations setting exists and defaults to true', () => {
  const prop = pkg.contributes.configuration.properties['graphics-h-runner.celebrations.enabled'];
  assert.ok(prop, 'graphics-h-runner.celebrations.enabled missing');
  assert.strictEqual(prop.default, true);
  assert.ok(bundle.includes('graphics-h-runner.celebrations'), 'setting never read by the bundle');
});

check('v1.5.13 clean exit: restore command contributed + registered, kill-switch defaults true', () => {
  const cmd = pkg.contributes.commands.find((c) => c.command === 'graphics-h-runner.restoreOriginalSettings');
  assert.ok(cmd, 'restoreOriginalSettings not contributed');
  assert.ok(cmd.title.includes('Restore Original Settings'), 'title should say what it does');
  assert.ok(bundle.includes('graphics-h-runner.restoreOriginalSettings'), 'restore command never registered in the bundle');
  const prop = pkg.contributes.configuration.properties['graphics-h-runner.restoreSettingsOnUninstall'];
  assert.ok(prop, 'graphics-h-runner.restoreSettingsOnUninstall missing');
  assert.strictEqual(prop.default, true, 'uninstall restore must default to ON');
  assert.ok(bundle.includes('restoreSettingsOnUninstall'), 'kill-switch never read by the bundle');
  assert.ok(bundle.includes('isRealUninstall'), 'uninstall discriminator never used by the bundle');
});

check('bundled media manifest matches what the bundle loads at runtime', () => {
  for (const rel of [
    'media/confetti.browser.js',
    'media/celebrate.js',
    'media/celebrate-panel.js',
    'media/fireworks/fireworks.css',
    'media/fireworks/fscreen.js',
    'media/fireworks/MyMath.js',
    'media/fireworks/Stage.js',
    'media/fireworks/script.js'
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), 'missing bundled media: ' + rel);
  }
});

console.log(failures === 0 ? '\nREGISTRY TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
