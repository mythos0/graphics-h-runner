#!/usr/bin/env node
/**
 * settings-health-tests.js — v1.5.24 "Unable to write into user settings" defusal.
 *
 * Sentry GRAPHICS-H-RUNNER-10 (2026-10-10): VS Code refuses EVERY global
 * configuration update while the user's settings.json contains a JSON syntax
 * error ("CodeExpectedError: Unable to write into user settings. Please open
 * the user settings to correct errors/warnings in it and try again."), and
 * Complete Setup ran its configuration.update() calls unguarded — one
 * hand-broken settings file crashed the whole run.
 *
 * This suite pins the pure core of the fix (out/settingsHealth.js):
 *   - analyzeJsonc tolerates exactly what VS Code's settings.json editor
 *     tolerates (comments, trailing commas, BOM) and reports the first real
 *     syntax error with gutter-accurate 1-based line/column;
 *   - repairJsonc fixes the classes a hand-edited settings.json actually
 *     breaks with (smart quotes, single quotes, doubled commas, missing
 *     commas, unclosed braces), never touches anything inside real
 *     strings/comments, preserves the user's VALUES and (where unmodified)
 *     formatting, and refuses to return anything it cannot vouch for;
 *   - classifySettingsWriteError recognizes VS Code's exact refusal;
 *   - userSettingsCandidates covers every VS Code flavor and platform.
 */
'use strict';
const path = require('path');
const assert = require('assert');

const h = require(path.join(__dirname, '..', 'out', 'settingsHealth'));

let passed = 0;
let failed = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, e });
    console.log('FAIL  ' + name + ' — ' + e.message);
  }
}

console.log('== analyzeJsonc: VS Code tolerance ==');

t('clean object parses with value', () => {
  const r = h.analyzeJsonc('{\n  "editor.fontSize": 14\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { 'editor.fontSize': 14 });
});

t('line comments tolerated', () => {
  const r = h.analyzeJsonc('{\n  // trusted\n  "a": 1\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { a: 1 });
});

t('block comments tolerated', () => {
  const r = h.analyzeJsonc('{\n  /* trusted\n     multi */\n  "a": 1\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { a: 1 });
});

t('trailing commas tolerated (VS Code does)', () => {
  const r = h.analyzeJsonc('{ "a": [1, 2,], "b": { "c": 1, }, }');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { a: [1, 2], b: { c: 1 } });
});

t('BOM tolerated and value unaffected', () => {
  const r = h.analyzeJsonc('\uFEFF{ "a": 1 }');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { a: 1 });
});

t('empty file accepted (VS Code accepts too)', () => {
  assert.strictEqual(h.analyzeJsonc('').ok, true);
  assert.strictEqual(h.analyzeJsonc('   \n  ').ok, true);
});

t('nested types round-trip (numbers, bools, null, escapes)', () => {
  const r = h.analyzeJsonc('{ "n": -1.5e3, "b": false, "x": null, "s": "a\\nb\\u0041" }');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { n: -1500, b: false, x: null, s: 'a\nbA' });
});

console.log('== analyzeJsonc: real syntax errors with positions ==');

t('missing comma between members -> line/col of the offending line', () => {
  const r = h.analyzeJsonc('{\n  "editor.fontSize": 14\n  "workbench.colorTheme": "Dark"\n}');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].line, 3);
  assert.strictEqual(r.errors[0].col, 3);
});

t('smart quotes -> explicit "Smart/curly" message', () => {
  const r = h.analyzeJsonc('{\n  \u201ceditor.fontSize\u201d: 14\n}');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /Smart\/curly double quote/);
  assert.strictEqual(r.errors[0].line, 2);
});

t('smart single quote inside value position also caught', () => {
  const r = h.analyzeJsonc('{ "a": \u2018hello\u2019 }');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /Smart\/curly single quote/);
});

t('single-quoted key caught', () => {
  const r = h.analyzeJsonc("{ 'editor.fontSize': 14 }");
  assert.strictEqual(r.ok, false);
});

t('unterminated string caught with line', () => {
  const r = h.analyzeJsonc('{\n  "a": "oops\n}');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /Unterminated string/);
  assert.strictEqual(r.errors[0].line, 2);
});

t('invalid escape caught', () => {
  const r = h.analyzeJsonc('{ "a": "bad\\x escape" }');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /Invalid escape/);
});

t('unclosed object caught at EOF', () => {
  const r = h.analyzeJsonc('{\n  "a": { "b": 1\n}');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /missing "\}"/);
});

t('garbage caught with a usable message', () => {
  const r = h.analyzeJsonc('{just garbage here');
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0].message, /Expected a quoted property name/);
});

t('non-object root rejected (settings.json must be an object)', () => {
  assert.strictEqual(h.analyzeJsonc('"just a string"').ok, false);
  assert.strictEqual(h.analyzeJsonc('42').ok, false);
  assert.strictEqual(h.analyzeJsonc('null').ok, false);
});

console.log('== repairJsonc: the real hand-edit breakage classes ==');

t('valid file comes back byte-identical with no fixes', () => {
  const text = '{\n  // mine\n  "editor.fontSize": 14,\n  "workbench.colorTheme": "Dark"\n}\n';
  const r = h.repairJsonc(text);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, []);
  assert.strictEqual(r.text, text);
});

t('missing comma repaired and VALUES preserved', () => {
  const r = h.repairJsonc('{\n  "editor.fontSize": 14\n  "workbench.colorTheme": "Dark"\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['missing-commas']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, {
    'editor.fontSize': 14,
    'workbench.colorTheme': 'Dark'
  });
  /* formatting otherwise untouched */
  assert.match(r.text, /^{\n  "editor\.fontSize": 14,\n  "workbench\.colorTheme": "Dark"\n}$/);
});

t('missing comma in a string array repaired', () => {
  const r = h.repairJsonc('{\n  "files.exclude": [\n    "**/.git"\n    "**/node_modules"\n  ]\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, {
    'files.exclude': ['**/.git', '**/node_modules']
  });
});

t('smart quotes repaired', () => {
  const r = h.repairJsonc('{\n  \u201ceditor.fontSize\u201d: 14,\n  \u201cworkbench.colorTheme\u201d: \u201cDark\u201d\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['smart-quotes']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, {
    'editor.fontSize': 14,
    'workbench.colorTheme': 'Dark'
  });
});

t('single quotes repaired', () => {
  const r = h.repairJsonc("{\n  'editor.fontSize': 14\n}");
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['single-quotes']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, { 'editor.fontSize': 14 });
});

t('apostrophes INSIDE real string values are never touched', () => {
  const broken = '{ "note": "don\\u2019t panic",\n  "a": 1\n  "b": 2 }'.replace('\\u2019', '\u2019');
  const r = h.repairJsonc(broken);
  assert.strictEqual(r.ok, true);
  const v = h.analyzeJsonc(r.text).value;
  assert.strictEqual(v.note, 'don\u2019t panic'); /* content survived verbatim */
  assert.deepStrictEqual([v.a, v.b], [1, 2]);
});

t('doubled commas repaired', () => {
  const r = h.repairJsonc('{\n  "a": 1,,\n  "b": 2\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['double-commas']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, { a: 1, b: 2 });
});

t('unclosed braces at EOF repaired with closers in the right order', () => {
  /* the classic "deleted one line too many" tail */
  const r = h.repairJsonc('{\n  "editor.fontSize": 14,\n  "files.exclude": [\n    "**/.git"');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['unclosed-braces']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, {
    'editor.fontSize': 14,
    'files.exclude': ['**/.git']
  });
  assert.strictEqual(r.text.endsWith(']}'), true);
});

t('a MISPOSITIONED closer is not guessed at (returns original)', () => {
  /* the trailing "}" is present but in the wrong spot — auto-closing would
   * have to move it, which we refuse to do */
  const text = '{\n  "a": { "b": [1, 2\n}';
  const r = h.repairJsonc(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.text, text);
});

t('combined breakage (smart quotes + missing comma) heals in one pass', () => {
  const r = h.repairJsonc('{\n  \u201cwindows.title\u201d: 600\n  \u201cwindows.height\u201d: 480\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, ['smart-quotes', 'missing-commas']);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, {
    'windows.title': 600,
    'windows.height': 480
  });
});

t('garbage is NOT repaired — original returned unchanged with the errors', () => {
  const text = '{just garbage here';
  const r = h.repairJsonc(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.text, text); /* byte-identical — nothing to vouch for */
  assert.deepStrictEqual(r.applied, []);
  assert.ok(r.errors.length >= 1);
});

t('comments survive a repair that only touches other lines', () => {
  const r = h.repairJsonc('{\n  // my theme lives here\n  "a": 1\n  // second comment\n  "b": 2\n}');
  assert.strictEqual(r.ok, true);
  assert.match(r.text, /\/\/ my theme lives here/);
  assert.match(r.text, /\/\/ second comment/);
});

t('CRLF line endings survive the repair', () => {
  const r = h.repairJsonc('{\r\n  "a": 1\r\n  "b": 2\r\n}');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(h.analyzeJsonc(r.text).value, { a: 1, b: 2 });
  assert.ok(r.text.includes('\r\n'), 'CRLF preserved');
  assert.ok(!r.text.includes(',\r\n\r'), 'no doubled line endings');
});

t('trailing-comma + comment file is already valid — untouched', () => {
  const text = '{\n  // ok\n  "a": [1, 2,],\n}';
  const r = h.repairJsonc(text);
  assert.strictEqual(r.text, text);
});

t('unterminated string is NOT silently rewritten', () => {
  const text = '{\n  "a": "oops\n}';
  const r = h.repairJsonc(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.text, text);
});

console.log('== classifySettingsWriteError: VS Code\u2019s exact refusal ==');

t('the Sentry GRAPHICS-H-RUNNER-10 message classifies as user', () => {
  const e = new Error(
    'Unable to write into user settings. Please open the user settings to correct errors/warnings in it and try again.'
  );
  assert.strictEqual(h.classifySettingsWriteError(e), 'user');
});

t('workspace variant classifies as workspace', () => {
  const e = new Error(
    'Unable to write into workspace settings. Please open the workspace settings to correct errors/warnings in it and try again.'
  );
  assert.strictEqual(h.classifySettingsWriteError(e), 'workspace');
});

t('unrelated errors do not classify', () => {
  assert.strictEqual(h.classifySettingsWriteError(new Error('EACCES: permission denied')), undefined);
  assert.strictEqual(h.classifySettingsWriteError(undefined), undefined);
  assert.strictEqual(h.classifySettingsWriteError('nope'), undefined);
});

t('message-embedded objects (CodeExpectedError shape) still match', () => {
  const err = { message: 'Unable to write into user settings. Please open the user settings to correct errors/warnings in it and try again.', code: 'x' };
  assert.strictEqual(h.classifySettingsWriteError(err), 'user');
});

console.log('== userSettingsCandidates: every flavor and platform ==');

t('win32 stable-first via APPDATA', () => {
  const list = h.userSettingsCandidates('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u');
  assert.deepStrictEqual(list, [
    'C:\\Users\\u\\AppData\\Roaming\\Code\\User\\settings.json',
    'C:\\Users\\u\\AppData\\Roaming\\Code - Insiders\\User\\settings.json',
    'C:\\Users\\u\\AppData\\Roaming\\VSCodium\\User\\settings.json',
    'C:\\Users\\u\\AppData\\Roaming\\Code - OSS\\User\\settings.json'
  ]);
});

t('portable mode comes first when VSCODE_PORTABLE is set', () => {
  const list = h.userSettingsCandidates('win32', { VSCODE_PORTABLE: 'D:\\port', APPDATA: 'C:\\roam' }, 'C:\\u');
  assert.strictEqual(list[0], 'D:\\port\\data\\user-data\\Code\\User\\settings.json');
  assert.ok(list.includes('C:\\roam\\Code\\User\\settings.json'));
});

t('linux respects XDG_CONFIG_HOME', () => {
  const list = h.userSettingsCandidates('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/u');
  assert.deepStrictEqual(list, [
    '/xdg/Code/User/settings.json',
    '/xdg/Code - Insiders/User/settings.json',
    '/xdg/VSCodium/User/settings.json',
    '/xdg/Code - OSS/User/settings.json'
  ]);
  const list2 = h.userSettingsCandidates('linux', {}, '/home/u');
  assert.strictEqual(list2[0], '/home/u/.config/Code/User/settings.json');
});

t('macOS Application Support paths', () => {
  const list = h.userSettingsCandidates('darwin', {}, '/Users/u');
  assert.strictEqual(list[0], '/Users/u/Library/Application Support/Code/User/settings.json');
  assert.strictEqual(list[2], '/Users/u/Library/Application Support/VSCodium/User/settings.json');
});

console.log('== describeErrors: human text for the output channel ==');

t('formats line/column/messages', () => {
  const s = h.describeErrors([{ line: 3, col: 7, message: 'Expected ","' }]);
  assert.strictEqual(s, 'line 3, column 7: Expected ","');
});

/* ---- summary ---- */
console.log('\nsettings-health-tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  failures.forEach((f) => console.log('FAILED: ' + f.name + '\n' + (f.e.stack || f.e.message)));
  process.exit(1);
}
