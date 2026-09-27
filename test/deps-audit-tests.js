#!/usr/bin/env node
/**
 * deps-audit-tests.js — unit tests for src/depsAudit.ts (out/depsAudit.js).
 *
 * v1.5.2: the audit parses the REAL PE import table. These tests build
 * synthetic PE32/PE32+ images (import descriptors + name strings + delay
 * descriptors) and verify:
 *   - real imports are found (case/dupe-normalized, sorted)
 *   - system DLLs + api-sets pass; MinGW/VC runtime DLLs are flagged
 *   - THE REGRESSION: DLL-name strings embedded in a static build's body
 *     (libgcj-16.dll, libgcc_s_dw2-1.dll) are NOT imports -> no warning
 *   - non-PE / truncated / no-import-dir files audit clean and silent
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  parsePeImports,
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

/* ------------------------------------------------------------------ *
 * Synthetic PE builder
 * ------------------------------------------------------------------ *
 * Layout: DOS header | PE\0\0 | COFF | optional header | 1 section hdr |
 * payload section. The payload holds import descriptors, name strings,
 * optional delay-load descriptors and optional junk bytes (simulating
 * statically linked runtime code that MENTIONS dll names).
 */
function buildPe(opts) {
  opts = opts || {};
  const plus = opts.plus !== false;               // PE32+ by default
  const imports = opts.imports || [];
  const delays = opts.delay || [];
  const junk = opts.junk || null;

  const machine = plus ? 0x8664 : 0x14c;
  const magic = plus ? 0x20b : 0x10b;
  const optFixed = plus ? 112 : 96;
  const numDirs = 16;
  const sizeOfOptional = optFixed + numDirs * 8;
  const imageBase = plus ? 0x140000000 : 0x400000;

  const secRva = 0x1000;
  const secFile = 0x400;
  const secSize = 0x1000;

  /* one shared string pool for import + delay-load names */
  const allNames = imports.concat(delays);
  const descCount = imports.length + 1;           // + terminator
  const descOff = 0;                              // inside the section
  const strBase = descOff + descCount * 20;
  const strOff = [];
  let cur = strBase;
  for (const n of allNames) {
    strOff.push(cur);
    cur += Buffer.byteLength(n, 'ascii') + 1;
  }
  const delayBase = cur;
  const delayCount = delays.length + 1;
  const junkBase = delayBase + delayCount * 32;

  const payload = Buffer.alloc(secSize, 0);
  imports.forEach((n, i) => {
    const d = descOff + i * 20;
    payload.writeUInt32LE(secRva + 0x800, d);     // OriginalFirstThunk (nonzero)
    payload.writeUInt32LE(secRva + strOff[i], d + 12);  // Name RVA
  });
  allNames.forEach((n, i) => payload.write(n + '\0', strOff[i], 'ascii'));
  delays.forEach((n, i) => {
    const d = delayBase + i * 32;
    payload.writeUInt32LE(1, d);                  // grAttrs: RVA-bound
    payload.writeUInt32LE(secRva + strOff[imports.length + i], d + 4);  // szName RVA
  });
  if (junk) payload.write(junk, junkBase, 'latin1');

  const dos = Buffer.alloc(0x40, 0);
  dos.write('MZ', 0, 'ascii');
  dos.writeUInt32LE(0x40, 0x3c);                  // e_lfanew

  const pe = Buffer.alloc(4 + 20 + sizeOfOptional, 0);
  pe.write('PE\0\0', 0, 'ascii');
  pe.writeUInt16LE(machine, 4);                   // Machine
  pe.writeUInt16LE(1, 6);                         // NumberOfSections
  pe.writeUInt16LE(sizeOfOptional, 20);           // SizeOfOptionalHeader
  pe.writeUInt16LE(0x22, 22);                     // Characteristics
  const opt = 24;
  pe.writeUInt16LE(magic, opt);
  if (plus) pe.writeBigUInt64LE(BigInt(imageBase), opt + 24);
  else pe.writeUInt32LE(imageBase, opt + 28);
  const dd = opt + optFixed;
  pe.writeUInt32LE(numDirs, dd - 4);              // NumberOfRvaAndSizes
  if (imports.length) {
    pe.writeUInt32LE(secRva + descOff, dd + 8);   // dir[1].VirtualAddress
    pe.writeUInt32LE(descCount * 20, dd + 12);    // dir[1].Size
  }
  if (delays.length) {
    pe.writeUInt32LE(secRva + delayBase, dd + 13 * 8);
    pe.writeUInt32LE(delayCount * 32, dd + 13 * 8 + 4);
  }

  const sec = Buffer.alloc(40, 0);
  sec.write('.idata\0\0', 0, 'ascii');
  sec.writeUInt32LE(secSize, 8);                  // VirtualSize
  sec.writeUInt32LE(secRva, 12);                  // VirtualAddress
  sec.writeUInt32LE(secSize, 16);                 // SizeOfRawData
  sec.writeUInt32LE(secFile, 20);                 // PointerToRawData
  sec.writeUInt32LE(0x40000040, 36);              // Characteristics

  const head = Buffer.concat([dos, pe, sec]);
  const pad = Buffer.alloc(secFile - head.length, 0);  // payload sits at 0x400
  return Buffer.concat([head, pad, payload]);
}

/* ------------------------------------------------------------------ */
section('A. parsePeImports — real import table parsing');
t('PE32+: finds imports, lowercase + unique + sorted', () => {
  const buf = buildPe({ imports: ['KERNEL32.dll', 'user32.DLL', 'gdi32.dll', 'kernel32.dll'] });
  assert.deepStrictEqual(parsePeImports(buf), ['gdi32.dll', 'kernel32.dll', 'user32.dll']);
});
t('PE32: same parsing on 32-bit images', () => {
  const buf = buildPe({ plus: false, imports: ['KERNEL32.DLL', 'libstdc++-6.dll'] });
  assert.deepStrictEqual(parsePeImports(buf), ['kernel32.dll', 'libstdc++-6.dll']);
});
t('delay-load imports are included', () => {
  const buf = buildPe({ imports: ['kernel32.dll'], delay: ['zlib1.dll'] });
  assert.deepStrictEqual(parsePeImports(buf), ['kernel32.dll', 'zlib1.dll']);
});
t('no import directory -> empty list', () => {
  assert.deepStrictEqual(parsePeImports(buildPe({})), []);
});
t('garbage / truncated buffers -> null (never guess)', () => {
  assert.strictEqual(parsePeImports(Buffer.alloc(64, 0x41)), null);
  const dos = Buffer.alloc(0x40, 0);
  dos.write('MZ', 0, 'ascii');
  dos.writeUInt32LE(0xffffff, 0x3c);              // e_lfanew beyond the buffer
  assert.strictEqual(parsePeImports(dos), null);
  assert.strictEqual(parsePeImports(Buffer.alloc(0)), null);
});

section('B. auditExeBuffer — the -1073741515 killer set');
t('static build (system DLLs only) is OK', () => {
  const res = auditExeBuffer(buildPe({
    imports: ['kernel32.dll', 'user32.dll', 'gdi32.dll', 'comdlg32.dll',
              'ole32.dll', 'oleaut32.dll', 'msvcrt.dll', 'ucrtbase.dll']
  }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
  assert.deepStrictEqual(res.missing, []);
});
t('dynamic build needing libstdc++/libgcc/winpthread is flagged', () => {
  const res = auditExeBuffer(buildPe({
    imports: ['kernel32.dll', 'libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll']
  }));
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.missing, ['libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll']);
});
t('REGRESSION: dll-name STRINGS inside a static build are not imports', () => {
  // the user-reported false positive: MinGW.org static runtime carries
  // "libgcc_s_dw2-1.dll" and "libgcj-16.dll" as inert strings
  const buf = buildPe({
    imports: ['kernel32.dll', 'msvcrt.dll'],
    junk: '....gcc runtime data....libgcc_s_dw2-1.dll....libgcj-16.dll....zlib1.dll....'
  });
  const res = auditExeBuffer(buf);
  assert.deepStrictEqual(res.imports, ['kernel32.dll', 'msvcrt.dll'], 'only real imports');
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
});
t('UCRT api-set forwarders are treated as system', () => {
  const res = auditExeBuffer(buildPe({
    imports: ['api-ms-win-crt-runtime-l1-1-0.dll', 'kernel32.dll']
  }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
});
t('delay-loaded zlib1.dll and VC redistributables are flagged', () => {
  const res = auditExeBuffer(buildPe({
    imports: ['kernel32.dll'], delay: ['zlib1.dll', 'msvcp140.dll', 'vcruntime140.dll']
  }));
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.missing, ['msvcp140.dll', 'vcruntime140.dll', 'zlib1.dll']);
});
t('dw2 / sjlj libgcc variants match RUNTIME_DLL_PATTERNS', () => {
  for (const n of ['libgcc_s_dw2.dll', 'libgcc_s_sjlj-1.dll', 'libgcj-16.dll']) {
    if (n === 'libgcj-16.dll') continue;          // never an import of a C++ exe
    assert.ok(RUNTIME_DLL_PATTERNS.some((re) => re.test(n)), n);
  }
});

section('C. auditWindowsExe + message');
t('real file round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-deps-'));
  try {
    const exe = path.join(dir, 'prog.exe');
    fs.writeFileSync(exe, buildPe({ imports: ['kernel32.dll', 'libstdc++-6.dll'] }));
    const res = auditWindowsExe(exe);
    assert.ok(res, 'result returned');
    assert.strictEqual(res.ok, false);
    assert.deepStrictEqual(res.missing, ['libstdc++-6.dll']);
    const msg = buildAuditMessage(res, 'prog.exe');
    assert.ok(msg.includes('-1073741515'), 'message names the exit code');
    assert.ok(msg.includes('static'), 'message names the fix');
    assert.ok(msg.includes('prog.exe'), 'message names the exe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
t('missing file -> null (audit never breaks the flow)', () => {
  assert.strictEqual(auditWindowsExe('/definitely/not/here.exe'), null);
});
t('non-PE junk file audits clean and silent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-junk-'));
  try {
    const exe = path.join(dir, 'junk.exe');
    fs.writeFileSync(exe, Buffer.concat([
      Buffer.alloc(128, 0x20),
      Buffer.from('\0libgcj-16.dll\0libgcc_s_dw2-1.dll\0', 'latin1')
    ]));
    const res = auditWindowsExe(exe);
    assert.ok(res, 'result returned');
    assert.strictEqual(res.ok, true, 'no PE imports -> no warning');
    assert.deepStrictEqual(res.imports, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log('\ndeps-audit-tests: ' + passed + ' passed, exitCode=' + (process.exitCode || 0));
