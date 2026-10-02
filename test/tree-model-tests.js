#!/usr/bin/env node
/**
 * tree-model-tests.js — unit tests for the fallback TreeView models
 * (src/programsTreeModel.ts -> out/programsTreeModel.js) — no vscode needed.
 *
 * Contract (v1.5.16): the fallback is TWO separate views so each is
 * easy to understand at a glance —
 *   - buildActionEntries():  the 9 panel commands as a flat list;
 *   - buildProgramEntries(): the 3 game programs in one section + the
 *     Computer Graphics Lab (8 restored + 10 new zero-to-advanced labs)
 *     grouped under their own section header.
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

check('actions model = exactly the 9 panel commands, flat (no sections)', () => {
  const a = buildActionEntries();
  assert.strictEqual(a.length, COMMAND_META.length, 'action count');
  assert.strictEqual(COMMAND_META.length, 9, 'COMMAND_META drifted (expect 9 incl. Reset Setup + Fireworks)');
  assert.ok(a.every((e) => e.kind === 'action'), 'every entry must be an action');
  assert.strictEqual(a[0].id, 'cmd-compileAndRun', 'Compile & Run must lead the actions view');
  assert.ok(a.some((e) => e.id === 'cmd-resetSetup' && e.commandId === 'graphics-h-runner.restoreOriginalSettings'),
    'Reset Setup button must be wired to the surgical restore command');
  for (const c of COMMAND_META) {
    const hit = a.find((e) => e.id === c.id);
    assert.ok(hit, 'action missing from tree: ' + c.id);
    assert.strictEqual(hit.commandId, c.commandId, 'command id mismatch for ' + c.id);
    assert.strictEqual(hit.label, c.title, 'label mismatch for ' + c.id);
    assert.ok(hit.hint && hit.hint.length > 0, 'empty hint for ' + c.id);
  }
});

check('programs model = 2 sections + 21 programs (3 games + 18 lab)', () => {
  const m = buildProgramEntries(catalog);
  const sections = m.filter((e) => e.kind === 'section');
  const programs = m.filter((e) => e.kind === 'program');
  assert.strictEqual(sections.length, 2, 'section count ' + sections.length);
  assert.strictEqual(programs.length, 21, 'program count ' + programs.length);
  assert.ok(/Example Programs \(3\)/.test(sections[0].label), 'programs section label wrong: ' + sections[0].label);
  assert.ok(/Computer Graphics Lab \(18\)/.test(sections[1].label), 'lab section label wrong: ' + sections[1].label);
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
  assert.strictEqual(ids.size, 21, 'duplicate program ids in the tree model');
  for (const loaded of catalog) {
    assert.ok(ids.has(loaded.id), 'catalog program missing from tree: ' + loaded.id);
  }
});

check('lab section back as it was + extended: 18 lab programs (8 restored + 10 new)', () => {
  const m = buildProgramEntries(catalog);
  const labCount = m.filter((e) => e.kind === 'program' && e.lab).length;
  assert.strictEqual(labCount, 18, 'lab program count ' + labCount);
  /* the restored originals, byte-identical ids */
  for (const id of ['coordview', 'pixelinspector', 'ddalab', 'bresenhamline',
                    'bresenhamcircle', 'midpointellipse', 'transforms', 'clipping']) {
    const hit = m.find((e) => e.kind === 'program' && e.id === id && e.lab);
    assert.ok(hit, 'restored lab program missing: ' + id);
  }
  /* the new zero-to-advanced course */
  for (const id of ['labfirst', 'labcolors', 'labshapes', 'labinput', 'labanim',
                    'labsprite', 'labfill', 'labezier', 'labfractal', 'lab3dcube']) {
    const hit = m.find((e) => e.kind === 'program' && e.id === id && e.lab);
    assert.ok(hit, 'new lab program missing: ' + id);
  }
  /* ordering: the new course runs zero -> tools -> algorithms -> advanced */
  const labOrder = m.filter((e) => e.kind === 'program' && e.lab).map((e) => e.id);
  const idx = (id) => labOrder.indexOf(id);
  assert.ok(idx('labfirst') < idx('labcolors') && idx('labcolors') < idx('labanim'), 'start-here labs must lead');
  assert.ok(idx('labanim') < idx('coordview') && idx('coordview') < idx('ddalab'), 'tools before algorithms');
  assert.ok(idx('clipping') < idx('labsprite') && idx('labsprite') < idx('lab3dcube'), 'advanced labs must close the course');
});
check('lab flag matches the section a program belongs to', () => {
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
  assert.strictEqual(labCount, 18, 'lab program count ' + labCount);
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
