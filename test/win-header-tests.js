#!/usr/bin/env node
/**
 * win-header-tests.js — "run all programs before release" gate, Windows side.
 *
 * Every sample must compile against the EXACT WinBGIm headers the extension
 * installs on Windows. The Linux battery (run-tests.js) compiles against
 * SDL_bgi, whose header differs in C++-only corners — the classic trap was
 * getmouseclick: WinBGIm declares void getmouseclick(int, int&, int&)
 * (references, C++ library) while SDL_bgi (a C library) uses int* — sample
 * code written for one fails on the other with "invalid conversion from
 * int* to int". This gate would have caught it before v1.5.0 shipped.
 *
 * How it works: downloads graphics.h + winbgim.h from the same URLs
 * src/setup.ts installs (keep in sync!), then compiles every sample
 *   <win-g++> -fsyntax-only -D_WIN32 -I test/stubs -I <headers> samples/*.cpp
 * -D_WIN32 activates the exact code path a Windows user compiles (samples
 * carry #ifdef _WIN32 shims). Only syntax is checked — nothing links, so
 * no Windows libraries are needed.
 *
 * Toolchain preference (v1.5.21): a REAL MinGW-w64 g++ is used when one is
 * available — BGI_WIN_GXX env override, then x86_64-w64-mingw32-g++ / 
 * x86_64-w64-mingw32-g++-posix on PATH. A real MinGW toolchain ships the
 * SAME C/C++ standard headers a Windows user compiles against, which is
 * strictly more faithful than Linux g++ (field bug: a sample using time()
 * without <ctime> compiled on glibc, which leaks the declaration, but
 * failed on a user's stricter MinGW — see strict-include-tests.js). When
 * only Linux g++ exists it is still used, with a warning that its glibc
 * headers leak more declarations than MinGW's; strict-include-tests.js
 * covers that gap statically.
 *
 * Requirements: g++ (or a mingw cross g++) and network access. Skips
 * cleanly (exit 0) when neither is available so constrained environments
 * are not blocked.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const STUBS = path.join(__dirname, 'stubs');

/* v1.5.21: prefer a real MinGW-w64 cross g++ over Linux g++ — same class of
 * standard headers a Windows user compiles against. BGI_WIN_GXX wins so CI
 * machines can point at an extracted toolchain anywhere. */
function pickWinGxx() {
  const candidates = [];
  if (process.env.BGI_WIN_GXX) candidates.push(process.env.BGI_WIN_GXX);
  candidates.push('x86_64-w64-mingw32-g++', 'x86_64-w64-mingw32-g++-posix', 'i686-w64-mingw32-g++');
  for (const c of candidates) {
    const probe = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return { cmd: c, real: true };
  }
  return { cmd: 'g++', real: false };
}

/* keep these URLs in sync with src/setup.ts (WINBGIM sources) */
const HEADER_URLS = [
  ['graphics.h',
   'https://raw.githubusercontent.com/redpinetree/winbgim64/master/WinBGIm64/src/graphics.h'],
  ['winbgim.h',
   'https://raw.githubusercontent.com/redpinetree/winbgim64/master/WinBGIm64/src/winbgim.h']
];

function download(url, dest, redirects) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects >= 5) return reject(new Error('too many redirects for ' + url));
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(url + ' -> HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  const picked = pickWinGxx();
  const GXX = picked.cmd;
  const gxx = spawnSync(GXX, ['--version'], { encoding: 'utf8' });
  if (gxx.error || gxx.status !== 0) {
    console.log('win-header-tests: SKIPPED (no usable g++)');
    return;
  }
  if (picked.real) {
    console.log('win-header-tests: using REAL MinGW toolchain ' + GXX +
      ' (' + (gxx.stdout || '').split('\n')[0] + ')');
  } else {
    console.log('win-header-tests: using Linux g++ fallback — glibc headers leak MORE declarations than MinGW; strict-include-tests.js covers that gap statically. Set BGI_WIN_GXX (or install g++-mingw-w64-x86-64) for the faithful run.');
  }

  const incDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-winhdr-'));
  try {
    for (const [name, url] of HEADER_URLS) {
      const dest = path.join(incDir, name);
      await download(url, dest, 0);
      if (!fs.readFileSync(dest, 'utf8').includes('getmouseclick')) {
        throw new Error('downloaded ' + name + ' does not look like WinBGIm');
      }
    }
    console.log('win-header-tests: WinBGIm headers fetched to ' + incDir);

    const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.cpp')).sort();
    let pass = 0;
    const failures = [];
    for (const f of files) {
      const r = spawnSync(GXX, ['-fsyntax-only', '-D_WIN32', '-I', STUBS, '-I', incDir,
                                  path.join(SAMPLES, f)], { encoding: 'utf8' });
      if (r.status === 0) {
        pass++;
        console.log('  PASS ' + f);
      } else {
        failures.push(f);
        console.error('  FAIL ' + f);
        const out = ((r.stderr || '') + (r.stdout || '')).split('\n').slice(0, 8).join('\n');
        console.error(out.replace(/^/gm, '    '));
      }
    }
    console.log('win-header-tests: ' + pass + '/' + files.length + ' samples compile against WinBGIm headers');
    if (failures.length) {
      console.error('win-header-tests: FAILED — ' + failures.join(', '));
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(incDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('win-header-tests: ERROR ' + e.message);
  process.exitCode = 1;
});
