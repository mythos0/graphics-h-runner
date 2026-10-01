#!/usr/bin/env node
/**
 * tree-model-tests.js — unit tests for the fallback TreeView models
 * (src/programsTreeModel.ts -> out/programsTreeModel.js) — no vscode needed.
 *
 * Contract (v1.5.15 SPLIT): the fallback is TWO separate views so each is
 * easy to understand at a glance —
 *   - buildActionEntries():  the 8 panel commands as a flat list;
 *   - buildProgramEntries(): the 3 game programs in one section
 *     Lab programs grouped under their own section headers.
 * Every program click runs through its own STATIC per-node command id
 * (graphics-h-runner.runSample.<id>). TreeItem.command must never carry
 * `arguments`: VS Code caches argument-carrying tree commands under a
 * throwaway id and clicks fail with "Actual command not found, wanted to
 * execute graphics-h-runner.runSample /N" after a host restart (fixed
 * in v1.5.5).
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  buildActionEntries,
  buildProgramEntries,
  TREE_RUN_COMMAND
} = require(path.join(ROOT, 'out', 'programsTreeModel'));
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

console.log('tree-model-tests — fallback list view models\n');

check('actions model = exactly the 8 panel commands, flat (no sections)', () => {
  const a = buildActionEntries();
  assert.strictEqual(a.length, COMMAND_META.length, 'action count');
  assert.ok(a.every((e) => e.kind === 'action'), 'every entry must be an action');
  assert.strictEqual(a[0].id, 'cmd-compileAndRun', 'Compile & Run must lead the actions view');
  for (const c of COMMAND_META) {
    const hit = a.find((e) => e.id === c.id);
    assert.ok(hit, 'action missing from tree: ' + c.id);
    assert.strictEqual(hit.commandId, c.commandId, 'command id mismatch for ' + c.id);
    assert.strictEqual(hit.label, c.title, 'label mismatch for ' + c.id);
    assert.ok(hit.hint && hit.hint.length > 0, 'empty hint for ' + c.id);
  }
});

check('programs model = 1 section + 3 games', () => {
  const m = buildProgramEntries(catalog);
  const sections = m.filter((e) => e.kind === 'section');
  const programs = m.filter((e) => e.kind === 'program');
  assert.strictEqual(sections.length, 1, 'section count ' + sections.length);
  assert.strictEqual(programs.length, 3, 'program count ' + programs.length);
  assert.ok(/Example Programs \(3\)/.test(sections[0].label), 'programs section label wrong: ' + sections[0].label);
});

check('every program carries its own STATIC per-node run command (no arguments)', () => {
  const m = buildProgramEntries(catalog);
  const programs = m.filter((e) => e.kind === 'program');
  const ids = new Set();
  for (const p of programs) {
    assert.strictEqual(p.runCommandId, TREE_RUN_COMMAND + '.' + p.id,
      'per-node run command wrong for ' + p.id + ' (got ' + p.runCommandId + ')');
    assert.strictEqual(TREE_RUN_COMMAND, 'graphics-h-runner.runSample', 'run command prefix drifted');
    assert.ok(!Object.prototype.hasOwnProperty.call(p, 'arguments'),
      'tree model must not carry command arguments (v1.5.5 regression)');
    assert.ok(p.label && p.description && p.filename, 'empty fields for ' + p.id);
    assert.ok(/\.cpp$/.test(p.filename), 'filename not a .cpp for ' + p.id);
    ids.add(p.id);
  }
  assert.strictEqual(ids.size, 3, 'duplicate program ids in the tree model');
  for (const loaded of catalog) {
    assert.ok(ids.has(loaded.id), 'catalog program missing from tree: ' + loaded.id);
  }
});

check('no lab programs remain (v1.5.16: the lab section was removed)', () => {
  const m = buildProgramEntries(catalog);
  const labCount = m.filter((e) => e.kind === 'program' && e.lab).length;
  assert.strictEqual(labCount, 0, 'lab program count ' + labCount);
});
check('lab flag matches the section a program belongs to (vacuous)', () => {
  const m = buildProgramEntries(catalog);
  let inLab = false;
  for (const e of m) {
    if (e.kind === 'section') {
      inLab = /Computer Graphics Lab/.test(e.label);
      continue;
    }
    if (e.kind === 'program') {
      assert.strictEqual(e.lab, inLab, 'lab flag mismatch for ' + e.id);
    }
  }
  const labCount = m.filter((e) => e.kind === 'program' && e.lab).length;
  assert.strictEqual(labCount, 0, 'lab program count ' + labCount);
});

check('per-node command ids are unique across the whole catalog', () => {
  const runIds = buildProgramEntries(catalog)
    .filter((e) => e.kind === 'program')
    .map((e) => e.runCommandId);
  assert.strictEqual(new Set(runIds).size, runIds.length, 'duplicate per-node command ids');
});

check('programs model opens with its section header (view title is the label)', () => {
  const m = buildProgramEntries(catalog);
  assert.strictEqual(m[0].kind, 'section');
  assert.strictEqual(m[m.length - 1].kind, 'program');
});

check('models tolerate an empty catalog (broken install still gets actions + 0 section)', () => {
  const a = buildActionEntries();
  assert.strictEqual(a.length, COMMAND_META.length, 'actions must exist even with no programs');
  const m = buildProgramEntries([]);
  const programs = m.filter((e) => e.kind === 'program');
  assert.strictEqual(programs.length, 0);
  const section = m.find((e) => e.kind === 'section' && /Example Programs/.test(e.label));
  assert.ok(/Example Programs \(0\)/.test(section.label));
  /* no lab section when there are no lab programs */
  assert.strictEqual(m.filter((e) => e.kind === 'section').length, 1, 'lab section should be absent for an empty catalog');
});

console.log(failures === 0 ? '\nTREE MODEL TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
