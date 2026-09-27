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
 * src/setup.ts installs (keep in sync!), then runs
 *   g++ -fsyntax-only -D_WIN32 -I test/stubs -I <headers> samples/*.cpp
 * -D_WIN32 activates the exact code path a Windows user compiles (samples
 * carry #ifdef _WIN32 shims). Only syntax is checked — nothing links, so
 * no Windows libraries are needed.
 *
 * Requirements: g++ and network access. Skips cleanly (exit 0) when g++ is
 * unavailable so constrained environments are not blocked.
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
  const gxx = spawnSync('g++', ['--version'], { encoding: 'utf8' });
  if (gxx.error || gxx.status !== 0) {
    console.log('win-header-tests: SKIPPED (g++ not available)');
    return;
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
      const r = spawnSync('g++', ['-fsyntax-only', '-D_WIN32', '-I', STUBS, '-I', incDir,
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
