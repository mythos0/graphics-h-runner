#!/usr/bin/env node
/**
 * diagnostics-tests.js — unit tests for the g++ output parser
 * (src/diagnostics.ts -> out/diagnostics.js). No VS Code involved.
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { parseCompilerOutput, capCompilerDiagnostics } = require(path.join(ROOT, 'out', 'diagnostics'));

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

const SAMPLE = [
  'main.cpp:12:5: error: \x27x\x27 was not declared in this scope',
  'main.cpp:15: warning: unused variable \x27y\x27 [-Wunused-variable]',
  'C:\\Users\\student\\Documents\\prog.cpp:22:9: fatal error: foo.h: No such file or directory',
  'main.cpp:31: error: expected \x27;\x27 before \x27}\x27 token',
  'In file included from /usr/include/SDL2/SDL_bgi.h:312:',
  '                 from main.cpp:2:',
  '/usr/bin/ld: main.cpp:(.text+0x11): undefined reference to `foo\x27',
  'collect2.exe: error: ld returned 1 exit status',
  'make: *** [Makefile:12: all] Error 1',
  ''
].join('\n');

console.log('diagnostics-tests — g++ output parser\n');

check('parses error / warning / note lines with file:line:col', () => {
  const out = parseCompilerOutput(SAMPLE);
  assert.strictEqual(out.length, 4, 'parsed count ' + out.length);
  assert.deepStrictEqual(
    { f: out[0].file, l: out[0].line, c: out[0].column, s: out[0].severity },
    { f: 'main.cpp', l: 12, c: 5, s: 'error' });
  assert.strictEqual(out[1].severity, 'warning');
  assert.strictEqual(out[1].column, null, 'no-column form should parse with null column');
  assert.strictEqual(out[1].line, 15);
});

check('windows paths with drive letters survive', () => {
  const out = parseCompilerOutput(SAMPLE);
  assert.ok(/^[A-Za-z]:\\/.test(out[2].file), 'drive letter lost: ' + out[2].file);
  assert.strictEqual(out[2].severity, 'error', 'fatal error maps to error');
  assert.strictEqual(out[2].line, 22);
  assert.ok(out[2].message.includes('foo.h'), 'message body lost');
});

check('non-diagnostic lines are ignored (ld, collect2, make, includes)', () => {
  const out = parseCompilerOutput(SAMPLE);
  assert.ok(out.every((d) => !/ld returned/.test(d.message)), 'collect2 line parsed');
  assert.ok(out.every((d) => !/undefined reference/.test(d.message)), 'ld line parsed');
  assert.ok(out.every((d) => d.file !== '/usr/include/SDL2/SDL_bgi.h'), 'include line parsed');
  assert.ok(out.every((d) => d.file !== 'make'), 'make line parsed');
});

check('messages are trimmed and complete', () => {
  const out = parseCompilerOutput('  a.cpp:1:1: error:   syntax hiccup   \n');
  assert.strictEqual(out[0].message, 'syntax hiccup');
});

check('empty and garbage inputs yield empty arrays (never throw)', () => {
  assert.deepStrictEqual(parseCompilerOutput(''), []);
  assert.deepStrictEqual(parseCompilerOutput(null), []);
  assert.deepStrictEqual(parseCompilerOutput('totally not compiler output'), []);
  assert.deepStrictEqual(parseCompilerOutput('main.cpp:0:0: error: zero line\n'), []);
  assert.deepStrictEqual(parseCompilerOutput('main.cpp:notanumber: error: nah\n'), []);
});

check('CRLF output parses', () => {
  const out = parseCompilerOutput('a.cpp:3:7: error: boom\r\nb.cpp:4:1: warning: meh\r\n');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].line, 3);
  assert.strictEqual(out[1].file, 'b.cpp');
});

check('capCompilerDiagnostics dedupes and caps', () => {
  const many = [];
  for (let i = 0; i < 500; i++) {
    many.push({ file: 'a.cpp', line: i + 1, column: 1, severity: 'error', message: 'e' + i });
  }
  many.push({ file: 'a.cpp', line: 1, column: 1, severity: 'error', message: 'e1' }); /* dup */
  const capped = capCompilerDiagnostics(many, 200);
  assert.strictEqual(capped.length, 200, 'cap failed');
  const dups = capCompilerDiagnostics([...many.slice(0, 2), ...many.slice(0, 2)], 200);
  assert.strictEqual(dups.length, 2, 'dedupe failed');
});

check('cap preserves order (first errors first)', () => {
  const list = [
    { file: 'a.cpp', line: 1, column: 1, severity: 'error', message: 'first' },
    { file: 'a.cpp', line: 2, column: 1, severity: 'error', message: 'second' }
  ];
  const out = capCompilerDiagnostics(list, 10);
  assert.strictEqual(out[0].message, 'first');
  assert.strictEqual(out[1].message, 'second');
});

console.log(failures === 0 ? '\nDIAGNOSTICS TESTS ALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
