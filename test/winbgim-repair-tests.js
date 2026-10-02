#!/usr/bin/env node
/**
 * winbgim-repair-tests.js — v1.5.20 compile-time self-repair (pure parts).
 *
 *  1. patchWinbgimHeaderConstChar patches exactly the textbook text API
 *     (outtext/outtextxy/textheight/textwidth/initgraph) in graphics.h AND
 *     winbgim.h, leaves writable-buffer APIs (getfillpattern/setfillpattern)
 *     and return types alone, and is IDEMPOTENT (second run = no-op).
 *  2. looksLikeStaleWinbgimInstall matches the real MinGW error classes:
 *     const-char conversion, missing graphics.h — and rejects ordinary
 *     compile errors and the pure link-failure signature.
 *  3. looksLikeBgiLinkFailure still drives its own dialog (regression pin).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { patchWinbgimHeaderConstChar } = require(path.join(ROOT, 'out', 'setup'));
const { looksLikeStaleWinbgimInstall, looksLikeBgiLinkFailure } = require(path.join(ROOT, 'out', 'diagnostics'));

let passed = 0;
let failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log('  ok - ' + name);
    })
    .catch((e) => {
      failed++;
      console.log('  FAIL - ' + name + ': ' + (e && e.message ? e.message : e));
    });
}

const RAW_GRAPHICS_H = `#ifndef WINBGI_H
#define WINBGI_H
#ifdef __cplusplus
extern "C" {
#endif
void getfillpattern( char *pattern );
void setfillpattern( char *upattern, int color );
char *getmodename( int mode_number );
void initgraph( int *graphdriver, int *graphmode, char *pathtodriver );
int installuserfont( char *name );
void outtext(char *textstring);
void outtextxy(int x, int y, char *textstring);
int textheight(char *textstring);
int textwidth(char *textstring);
#ifdef __cplusplus
}
#endif
#endif
`;

async function main() {
  console.log('winbgim-repair-tests — v1.5.20 self-repair\n');

  await t('patch corrects the textbook text API in graphics.h and winbgim.h', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbpatch-'));
    fs.writeFileSync(path.join(dir, 'graphics.h'), RAW_GRAPHICS_H);
    fs.writeFileSync(path.join(dir, 'winbgim.h'), RAW_GRAPHICS_H);
    const log = [];
    patchWinbgimHeaderConstChar(dir, log);
    const out = fs.readFileSync(path.join(dir, 'graphics.h'), 'utf8');
    assert.ok(out.includes('void outtextxy(int x, int y, const char *textstring);'), 'outtextxy not const-corrected');
    assert.ok(out.includes('void outtext(const char *textstring);'), 'outtext not const-corrected');
    assert.ok(out.includes('int textheight(const char *textstring);'), 'textheight not const-corrected');
    assert.ok(out.includes('int textwidth(const char *textstring);'), 'textwidth not const-corrected');
    assert.ok(out.includes('void initgraph( int *graphdriver, int *graphmode, const char *pathtodriver );'), 'initgraph not const-corrected');
    assert.ok(out.includes('int installuserfont( const char *name );'), 'installuserfont not const-corrected');
    /* writable buffers + return types must stay untouched */
    assert.ok(out.includes('void getfillpattern( char *pattern );'), 'getfillpattern must NOT be patched');
    assert.ok(out.includes('void setfillpattern( char *upattern, int color );'), 'setfillpattern must NOT be patched');
    assert.ok(out.includes('char *getmodename( int mode_number );'), 'return type must NOT be patched');
    assert.ok(log.some((l) => l.includes('const-corrected')), 'log line missing');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('patch is idempotent (second run changes nothing)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbpatch2-'));
    fs.writeFileSync(path.join(dir, 'graphics.h'), RAW_GRAPHICS_H);
    const log1 = [];
    patchWinbgimHeaderConstChar(dir, log1);
    const once = fs.readFileSync(path.join(dir, 'graphics.h'), 'utf8');
    const log2 = [];
    patchWinbgimHeaderConstChar(dir, log2);
    const twice = fs.readFileSync(path.join(dir, 'graphics.h'), 'utf8');
    assert.strictEqual(once, twice, 'second pass rewrote the file');
    assert.strictEqual(log2.filter((l) => l.includes('graphics.h')).length, 0, 'second pass logged patches');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('patch tolerates a missing folder / missing headers (no throw)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbpatch3-'));
    const log = [];
    patchWinbgimHeaderConstChar(path.join(dir, 'nope'), log);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('looksLikeStaleWinbgimInstall: matches real MinGW error classes', () => {
    assert.ok(looksLikeStaleWinbgimInstall(
      "main.cpp: In function 'int main()':\nmain.cpp:5:23: error: invalid conversion from 'const char*' to 'char*' [-fpermissive]"
    ), 'const-char conversion missed');
    assert.ok(looksLikeStaleWinbgimInstall(
      'main.cpp:2:10: fatal error: graphics.h: No such file or directory'
    ), 'missing graphics.h missed');
    assert.ok(looksLikeStaleWinbgimInstall(
      'main.cpp:2:10: fatal error: graphics.h: No such file or directory\n #include <graphics.h>'
    ), 'missing graphics.h variant missed');
  });

  await t('looksLikeStaleWinbgimInstall: rejects ordinary errors and pure link failures', () => {
    assert.strictEqual(looksLikeStaleWinbgimInstall("main.cpp:7:5: error: 'foo' was not declared in this scope"), false);
    assert.strictEqual(looksLikeStaleWinbgimInstall(
      "/usr/bin/ld: main.cpp:(.text+0x11): undefined reference to `initwindow'"
    ), false, 'link failure is the other detector');
    assert.strictEqual(looksLikeStaleWinbgimInstall(''), false);
  });

  await t('looksLikeBgiLinkFailure regression pin (v1.5.6 dialog driver)', () => {
    assert.ok(looksLikeBgiLinkFailure("/tmp/ccX.o:main.cpp:(.text+0xa): undefined reference to `initwindow'"));
    assert.ok(looksLikeBgiLinkFailure("undefined reference to `circle'"));
    assert.strictEqual(looksLikeBgiLinkFailure('undefined reference to `std::cout'), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
