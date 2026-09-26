#!/usr/bin/env node
/**
 * tree-model-tests.js — unit tests for the fallback TreeView model
 * (src/programsTree.ts -> out/programsTree.js) — no vscode needed.
 *
 * Contract: the list view mirrors the webview panel — the same 8 actions and
 * the same 18 example programs — and every program click runs through a
 * single registered command with the program id as its argument.
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { buildTreeModel, TREE_RUN_COMMAND } = require(path.join(ROOT, 'out', 'programsTreeModel'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

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

const catalog = loadProgramCatalog(ROOT);

console.log('tree-model-tests — fallback list view model\n');

check('model = 2 sections + 8 actions + 18 programs', () => {
  const m = buildTreeModel(catalog);
  const sections = m.filter((e) => e.kind === 'section');
  const actions = m.filter((e) => e.kind === 'action');
  const programs = m.filter((e) => e.kind === 'program');
  assert.strictEqual(sections.length, 2, 'section count ' + sections.length);
  assert.strictEqual(actions.length, COMMAND_META.length, 'action count ' + actions.length);
  assert.strictEqual(programs.length, 18, 'program count ' + programs.length);
  assert.strictEqual(sections[0].label, 'Actions');
  assert.ok(/Example Programs \(18\)/.test(sections[1].label), 'programs section label wrong: ' + sections[1].label);
});

check('actions mirror COMMAND_META ids and command ids 1:1', () => {
  const m = buildTreeModel(catalog);
  const actions = m.filter((e) => e.kind === 'action');
  for (const c of COMMAND_META) {
    const hit = actions.find((a) => a.id === c.id);
    assert.ok(hit, 'action missing from tree: ' + c.id);
    assert.strictEqual(hit.commandId, c.commandId, 'command id mismatch for ' + c.id);
    assert.strictEqual(hit.label, c.title, 'label mismatch for ' + c.id);
    assert.ok(hit.hint && hit.hint.length > 0, 'empty hint for ' + c.id);
  }
});

check('every program is wired to the run command with its id as argument data', () => {
  const m = buildTreeModel(catalog);
  const programs = m.filter((e) => e.kind === 'program');
  const ids = new Set();
  for (const p of programs) {
    assert.strictEqual(p.runCommandId, TREE_RUN_COMMAND, 'wrong run command for ' + p.id);
    assert.strictEqual(TREE_RUN_COMMAND, 'graphics-h-runner.runSample', 'run command id drifted');
    assert.ok(p.label && p.description && p.filename, 'empty fields for ' + p.id);
    assert.ok(/\.cpp$/.test(p.filename), 'filename not a .cpp for ' + p.id);
    ids.add(p.id);
  }
  assert.strictEqual(ids.size, 18, 'duplicate program ids in the tree model');
  for (const loaded of catalog) {
    assert.ok(ids.has(loaded.id), 'catalog program missing from tree: ' + loaded.id);
  }
});

check('sections come first, actions before programs (fallback UX order)', () => {
  const m = buildTreeModel(catalog);
  assert.strictEqual(m[0].kind, 'section');
  assert.strictEqual(m[1].kind, 'action');
  assert.strictEqual(m[m.length - 1].kind, 'program');
});

check('model tolerates an empty catalog (broken install still gets actions)', () => {
  const m = buildTreeModel([]);
  const actions = m.filter((e) => e.kind === 'action');
  assert.strictEqual(actions.length, COMMAND_META.length, 'actions must exist even with no programs');
  const programs = m.filter((e) => e.kind === 'program');
  assert.strictEqual(programs.length, 0);
  const section = m.find((e) => e.kind === 'section' && /Example Programs/.test(e.label));
  assert.ok(/Example Programs \(0\)/.test(section.label));
});

console.log(failures === 0 ? '\nTREE MODEL TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
