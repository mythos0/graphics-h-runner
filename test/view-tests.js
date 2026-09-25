#!/usr/bin/env node
/**
 * view-tests.js — smoke tests for the graphics.h sidebar (activity bar view).
 *
 * Validates (without a VS Code UI):
 *   1. the program catalog loads 9 samples + 5 templates
 *   2. every source really includes <graphics.h>
 *   3. catalog sources match the bundled samples on disk byte-for-byte
 *   4. filenames are unique and .cpp-suffixed
 *   5. resolveProgramTarget() places files under <workspace>/graphics-h-programs/
 *   6. the command list at the top of the view references registered commands
 *   7. package.json sidebar wiring is internally consistent
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
    console.log('  ❌ ' + name + ' — ' + e.message);
  }
}

console.log('── Sidebar view tests (out/programs.js) ──');

const catalog = loadProgramCatalog(ROOT);

check('catalog loads 9 samples + 5 templates', () => {
  assert.strictEqual(catalog.filter((p) => p.kind === 'sample').length, 9, 'sample count');
  assert.strictEqual(catalog.filter((p) => p.kind === 'template').length, 5, 'template count');
});

check('every catalog source includes <graphics.h>', () => {
  for (const p of catalog) {
    assert.ok(/#\s*include\s*<graphics\.h>/.test(p.source), p.filename + ' is missing the include');
  }
});

check('sample sources match the bundled files byte-for-byte', () => {
  for (const p of catalog.filter((p) => p.kind === 'sample')) {
    const disk = fs.readFileSync(path.join(ROOT, 'samples', p.filename), 'utf8');
    assert.strictEqual(disk, p.source, p.filename + ' diverges from disk');
  }
});

check('filenames are unique and end with .cpp', () => {
  const names = catalog.map((p) => p.filename);
  assert.strictEqual(new Set(names).size, names.length, 'duplicate filename');
  for (const n of names) assert.ok(n.endsWith('.cpp'), n);
});

check('titles are unique (sidebar readability)', () => {
  const titles = catalog.map((p) => p.title);
  assert.strictEqual(new Set(titles).size, titles.length, 'duplicate title');
});

check('resolveProgramTarget joins <workspace>/graphics-h-programs/', () => {
  assert.strictEqual(
    resolveProgramTarget('/ws', 'a.cpp'),
    path.join('/ws', 'graphics-h-programs', 'a.cpp')
  );
  assert.strictEqual(resolveProgramTarget(undefined, 'a.cpp'), undefined);
});

check('command list has 7 entries, all namespaced', () => {
  assert.strictEqual(COMMAND_META.length, 7);
  for (const c of COMMAND_META) {
    assert.ok(c.commandId.startsWith('graphics-h-runner.'), c.commandId);
  }
});

check('all sidebar commands are registered in package.json', () => {
  const registered = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const c of COMMAND_META) {
    assert.ok(registered.has(c.commandId), c.commandId + ' missing from contributes.commands');
  }
});

check('package.json sidebar wiring is consistent', () => {
  assert.ok(
    pkg.contributes.viewsContainers.activitybar.some(
      (v) => v.id === 'graphics-h-runner' && v.icon.endsWith('.svg')
    ),
    'activitybar container'
  );
  assert.ok(
    pkg.contributes.views['graphics-h-runner'].some((v) => v.id === 'graphics-h-runner.programs'),
    'view id'
  );
  const iconPath = path.join(ROOT, pkg.contributes.viewsContainers.activitybar[0].icon);
  assert.ok(fs.existsSync(iconPath), 'activity bar icon file exists');
  const registered = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const m of pkg.contributes.menus['view/title']) {
    assert.ok(registered.has(m.command), 'view/title command missing: ' + m.command);
  }
  for (const m of pkg.contributes.menus['view/item/context']) {
    assert.ok(registered.has(m.command), 'view/item/context command missing: ' + m.command);
  }
});

check('samples/ folder is bundled into the vsix (not vscodeignored)', () => {
  const ignored = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  assert.ok(!/^samples\/\*\*/m.test(ignored), 'samples/** must not be vscodeignored');
});

console.log(failures === 0 ? '\nAll sidebar tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
