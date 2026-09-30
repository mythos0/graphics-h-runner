#!/usr/bin/env node
/**
 * view-tests.js — tests for the graphics.h webview panel catalog +
 * package.json wiring (activity-bar view, commands, debugger, menus).
 *
 * Validates (without a VS Code UI):
 *   1. the program catalog loads 31 samples (23 classic + 8 lab, 0 templates)
 *   2. every source really includes <graphics.h>
 *   3. catalog sources match the bundled samples on disk byte-for-byte
 *   4. filenames are unique, .cpp-suffixed, every card carries an emoji + tag
 *   5. resolveProgramTarget() places files under <workspace>/graphics-h-programs/
 *   6. every COMMAND_META action references a command registered in package.json
 *   7. package.json wiring: webview view id, debugger type, editor/title/run
 *      menu, activation events; removed commands are really gone
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { loadProgramCatalog, resolveProgramTarget, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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

console.log('view-tests — catalog + package.json wiring\n');

check('catalog loads 9 samples (1 snake example + 8 lab, 0 templates)', () => {
  const catalog = loadProgramCatalog(ROOT);
  assert.strictEqual(catalog.filter((p) => p.kind === 'sample').length, 9, 'sample count');
  assert.strictEqual(catalog.filter((p) => p.kind === 'template').length, 0, 'template count');
  assert.strictEqual(catalog.length, 9, 'total count');
});

check('every sample source includes <graphics.h>', () => {
  for (const p of loadProgramCatalog(ROOT)) {
    assert.ok(p.source.includes('<graphics.h>'), p.filename + ' missing graphics.h include');
    assert.ok(p.source.length > 200, p.filename + ' suspiciously short');
    assert.ok(p.source.includes('closegraph'), p.filename + ' missing closegraph');
  }
});

check('catalog sources match bundled samples byte-for-byte', () => {
  for (const p of loadProgramCatalog(ROOT)) {
    const disk = fs.readFileSync(path.join(ROOT, 'samples', p.filename), 'utf8');
    assert.strictEqual(p.source, disk, p.filename + ' differs from disk');
  }
});

check('filenames unique + the exact v1.5.16 catalog (snake + lab 24..31)', () => {
  const catalog = loadProgramCatalog(ROOT);
  const names = catalog.map((p) => p.filename);
  assert.strictEqual(new Set(names).size, names.length, 'duplicate filenames');
  names.forEach((n) => assert.ok(n.endsWith('.cpp'), n + ' not .cpp'));
  /* v1.5.16: the example section is exactly ONE program — the Snake Game;
   * the Computer Graphics Lab keeps its 24..31 numbering. */
  const expected = ['01_snake_game.cpp'];
  for (let i = 24; i <= 31; i++) { expected.push(String(i).padStart(2, '0') + '_'); }
  for (const e of expected) {
    assert.ok(names.some((n) => n === e || n.startsWith(e)), 'missing sample #' + e);
  }
  assert.strictEqual(names.length, 9, 'catalog size drifted: ' + names.length);
});

check('every program card has emoji + valid tag', () => {
  const validTags = new Set(['classic', 'fun', 'math', 'interactive', 'lab']);
  for (const p of loadProgramCatalog(ROOT)) {
    assert.ok(p.emoji && p.emoji.length >= 1 && p.emoji.length <= 4, p.id + ' emoji missing');
    assert.ok(validTags.has(p.tag), p.id + ' bad tag: ' + p.tag);
    assert.ok(p.title.length >= 3 && p.description.length >= 10, p.id + ' weak metadata');
  }
});

check('v1.5.16 catalog shape: one Snake Game example + 8 lab programs', () => {
  const catalog = loadProgramCatalog(ROOT);
  const main = catalog.filter((p) => !p.lab);
  const lab = catalog.filter((p) => p.lab);
  assert.strictEqual(main.length, 1, 'example count = ' + main.length);
  assert.strictEqual(main[0].id, 'snake', 'the example must be the snake game');
  assert.strictEqual(main[0].filename, '01_snake_game.cpp', 'snake filename drifted');
  assert.strictEqual(main[0].tag, 'fun', 'snake tag');
  assert.strictEqual(lab.length, 8, 'lab count = ' + lab.length);
});

check('resolveProgramTarget places files under graphics-h-programs/', () => {
  assert.strictEqual(resolveProgramTarget(undefined, 'x.cpp'), undefined);
  assert.strictEqual(resolveProgramTarget('/ws', 'a.cpp'), path.join('/ws', 'graphics-h-programs', 'a.cpp'));
});

check('every COMMAND_META action is a registered command', () => {
  const registered = new Set(pkg.contributes.commands.map((c) => c.command));
  assert.ok(COMMAND_META.length >= 7, 'expected >=7 actions, got ' + COMMAND_META.length);
  for (const c of COMMAND_META) {
    assert.ok(registered.has(c.commandId), c.commandId + ' not in package.json contributes.commands');
  }
});

check('removed commands are gone (insertTemplate, showGuide)', () => {
  const registered = pkg.contributes.commands.map((c) => c.command);
  assert.ok(!registered.includes('graphics-h-runner.insertTemplate'), 'insertTemplate still registered');
  assert.ok(!registered.includes('graphics-h-runner.showGuide'), 'showGuide still registered');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'templates.ts')), 'src/templates.ts still exists');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'guide.ts')), 'src/guide.ts still exists');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'programsView.ts')), 'src/programsView.ts still exists');
});

check('setup command renamed to Complete graphics.h Run Setup', () => {
  const c = pkg.contributes.commands.find((x) => x.command === 'graphics-h-runner.setupEverything');
  assert.ok(c, 'setupEverything missing');
  assert.strictEqual(c.title, 'Complete graphics.h Run Setup');
});

check('new commands registered: stop / copy / examples', () => {
  const registered = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const id of ['stopProgram', 'copyCompileCommand', 'openExamplesFolder']) {
    assert.ok(registered.has('graphics-h-runner.' + id), id + ' missing');
  }
});

check('activity-bar view is declared type=webview with stable id', () => {
  const container = pkg.contributes.viewsContainers.activitybar[0];
  assert.strictEqual(container.id, 'graphics-h-runner');
  const view = pkg.contributes.views[container.id][0];
  assert.strictEqual(view.id, 'graphics-h-runner.programs');
  /* REGRESSION (v1.4.0 bug): without type:"webview" VS Code creates a TREE pane,
   * registerWebviewViewProvider never matches it, and the user sees
   * "There is no data provider registered that can provide view data". */
  assert.strictEqual(view.type, 'webview', 'view must be type=webview for the webview provider');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'panelView.ts'), 'utf8');
  assert.ok(src.includes("VIEW_ID = 'graphics-h-runner.programs'"), 'provider must target the same view id');
});

check('v1.5.14: 8 lab catalog entries + professional naming contract', () => {
  const lab = loadProgramCatalog(ROOT).filter((p) => p.lab);
  assert.strictEqual(lab.length, 8, 'lab count ' + lab.length);
  const ids = new Set(lab.map((p) => p.id));
  for (const id of ['coordview', 'pixelinspector', 'ddalab', 'bresenhamline', 'bresenhamcircle', 'midpointellipse', 'transforms', 'clipping']) {
    assert.ok(ids.has(id), 'missing lab id: ' + id);
  }
  assert.strictEqual(pkg.displayName, 'graphics.h Runner — One-Click Setup', 'displayName wrong');
  assert.strictEqual(pkg.contributes.viewsContainers.activitybar[0].title, 'graphics.h Runner', 'container title wrong');
  assert.strictEqual(pkg.contributes.views['graphics-h-runner'][0].name, 'graphics.h Runner', 'view name wrong');
  assert.strictEqual(pkg.contributes.views['graphics-h-runner'][0].type, 'webview', 'view type drifted');
});

check('debugger type graphics-h contributed with snippets', () => {
  const dbg = (pkg.contributes.debuggers || []).find((d) => d.type === 'graphics-h');
  assert.ok(dbg, 'graphics-h debugger missing');
  assert.strictEqual(dbg.label, 'graphics.h Runner');
  assert.ok(dbg.configurationAttributes.launch.properties.program, 'program attribute missing');
  assert.ok(dbg.configurationSnippets.length >= 1, 'no configuration snippets');
  assert.ok((pkg.activationEvents || []).includes('onDebug:type:graphics-h'), 'activation event missing');
});

check('Run button menu (editor/title/run) has compileAndRun for cpp', () => {
  const run = pkg.contributes.menus['editor/title/run'] || [];
  const ours = run.find((m) => m.command === 'graphics-h-runner.compileAndRun');
  assert.ok(ours, 'compileAndRun not in editor/title/run');
  assert.ok(ours.when.includes('resourceLangId == cpp'), 'when clause missing cpp');
});

console.log(failures === 0 ? '\nALL VIEW TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
