#!/usr/bin/env node
/**
 * deps-audit-tests.js — unit tests for src/depsAudit.ts (out/depsAudit.js).
 *
 * Covers the production failure this guards against: an exe that needs a
 * MinGW runtime DLL dies at launch with -1073741515 (0xC0000135). The audit
 * must flag exactly those imports and pass clean static builds.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  extractDllNames,
  auditExeBuffer,
  auditWindowsExe,
  buildAuditMessage,
  RUNTIME_DLL_PATTERNS
} = require(path.join(ROOT, 'out', 'depsAudit'));

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}
function section(s) {
  console.log('\n' + s);
}

/* fake PE-ish buffers: import names are plain ASCII in the image */
function bufWith(names) {
  const junk = Buffer.alloc(64, 0);
  const parts = [junk];
  for (const n of names) {
    parts.push(Buffer.from('\0' + n + '\0', 'latin1'));
  }
  return Buffer.concat(parts);
}

section('A. extractDllNames');
t('finds all dll tokens, lowercase+unique+sorted', () => {
  const names = extractDllNames(bufWith(['KERNEL32.dll', 'user32.DLL', 'libstdc++-6.dll', 'kernel32.dll']));
  assert.deepStrictEqual(names, ['kernel32.dll', 'libstdc++-6.dll', 'user32.dll']);
});
t('empty buffer -> no imports', () => {
  assert.deepStrictEqual(extractDllNames(Buffer.alloc(32, 0)), []);
});

section('B. auditExeBuffer — the -1073741515 killer set');
t('static build (system DLLs only) is OK', () => {
  const res = auditExeBuffer(bufWith(['KERNEL32.dll', 'user32.dll', 'gdi32.dll', 'comdlg32.dll', 'ole32.dll', 'oleaut32.dll', 'msvcrt.dll', 'ucrtbase.dll']));
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
  assert.deepStrictEqual(res.missing, []);
});
t('dynamic build needing libstdc++/libgcc/winpthread is flagged', () => {
  const res = auditExeBuffer(bufWith(['kernel32.dll', 'libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll']));
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.missing, ['libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll']);
});
t('UCRT api-set forwarders are treated as system', () => {
  const res = auditExeBuffer(bufWith(['api-ms-win-crt-runtime-l1-1-0.dll', 'kernel32.dll']));
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
});
t('zlib1.dll and VC redistributables are flagged', () => {
  const res = auditExeBuffer(bufWith(['zlib1.dll', 'msvcp140.dll', 'vcruntime140.dll']));
  assert.deepStrictEqual(res.missing, ['msvcp140.dll', 'vcruntime140.dll', 'zlib1.dll']);
});
t('dw2 / sjlj libgcc variants flagged too', () => {
  for (const n of ['libgcc_s_dw2.dll', 'libgcc_s_sjlj-1.dll']) {
    assert.ok(RUNTIME_DLL_PATTERNS.some((re) => re.test(n)), n);
  }
});

section('C. auditWindowsExe + message');
t('real file round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-deps-'));
  try {
    const exe = path.join(dir, 'prog.exe');
    fs.writeFileSync(exe, bufWith(['kernel32.dll', 'libstdc++-6.dll']));
    const res = auditWindowsExe(exe);
    assert.ok(res, 'result returned');
    assert.strictEqual(res.ok, false);
    assert.ok(res.missing.includes('libstdc++-6.dll'));
    const msg = buildAuditMessage(res, 'prog.exe');
    assert.ok(msg.includes('-1073741515'), 'message names the exit code');
    assert.ok(msg.includes('static'), 'message names the fix');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
t('missing file -> null (audit never breaks the flow)', () => {
  assert.strictEqual(auditWindowsExe('/definitely/not/here.exe'), null);
});

console.log('\ndeps-audit-tests: ' + passed + ' passed, exitCode=' + (process.exitCode || 0));
