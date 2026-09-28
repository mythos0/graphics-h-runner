#!/usr/bin/env node
/**
 * setup-download-tests.js — v1.5.11 regression tests for the Sentry
 * GRAPHICS-H-RUNNER-F fix (WinBGIm download validation + probe-failure
 * classification + PII scrubbing of diagnostic extras).
 *
 * Root cause being pinned: installWinbgimWindows used to write ANY bytes
 * returned with HTTP 200 (HTML error page, truncated archive, AV-mangled
 * binary) as libbgi.a and log "install-winbgim ok" — every later probe then
 * failed with "undefined reference" while the user kept re-running Full
 * Setup. The artifacts are now validated before they land on disk, the link
 * probe runs right after the install, and failures are classified.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const {
  validateWinbgimArtifact,
  describeBgiProbeFailure,
  installWinbgimWindows,
  LIBBGI_MIN_BYTES
} = require(path.join(ROOT, 'out', 'setup'));

let pass = 0;
let fail = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ' :: ' + e.message);
    console.log('FAIL  ' + name + ' :: ' + e.message);
  }
}

/* ---------- fixtures ---------- */

const AR_MAGIC = Buffer.from('!<arch>\n', 'latin1');
const fakeValidLibbgi = Buffer.concat([
  AR_MAGIC,
  Buffer.alloc(LIBBGI_MIN_BYTES + 4096, 0x61) /* pad past the min size */
]);
const fakeHtmlPage = Buffer.from(
  '<!DOCTYPE html><html><head><title>404: Not Found</title></head><body>rate limited</body></html>',
  'utf8'
);
/* big HTML page: crosses the size gate so the NOT-AN-ARCHIVE branch is hit */
const fakeHtmlPageBig = Buffer.concat([
  Buffer.from('<!DOCTYPE html><html><head><title>Error</title></head><body><pre>', 'utf8'),
  Buffer.alloc(LIBBGI_MIN_BYTES + 2048, 0x78),
  Buffer.from('</pre></body></html>', 'utf8')
]);
const HEADER_LINES = [
  '/* graphics.h — WinBGIm header fixture */',
  '#ifndef __GRAPHICS_H',
  '#define __GRAPHICS_H',
  '#include <stddef.h>',
  'extern "C" {',
  'void initgraph(int far *graphdriver, int far *graphmode, const char far *pathtodriver);',
  'void initwindow(int width, int height, const char* title = "Windows BGI");',
  'void circle(int x, int y, int radius);'
];
/* pad past the 1000-byte plausibility gate (the real header is ~4-13 KB) */
while (HEADER_LINES.join('\n').length < 1400) {
  HEADER_LINES.push('void fixture_pad_function_' + HEADER_LINES.length + '(void);');
}
HEADER_LINES.push('}', '#endif');
const fakeValidHeader = Buffer.from(HEADER_LINES.join('\n'), 'utf8');
const NOGFX_LINES = ['#ifndef FOO', '#define FOO', '#include <stddef.h>', 'int foo(void);'];
while (NOGFX_LINES.join('\n').length < 1400) {
  NOGFX_LINES.push('int fixture_pad_' + NOGFX_LINES.length + '(void);');
}
NOGFX_LINES.push('#endif');
const fakeHeaderNoGraphics = Buffer.from(NOGFX_LINES.join('\n'), 'utf8');

const VALID_MAP = new Map([
  ['graphics.h', fakeValidHeader],
  ['winbgim.h', fakeValidHeader],
  ['libbgi.a', fakeValidLibbgi],
  ['libbgi64.a', fakeValidLibbgi] /* the real download URL basename */
]);

const UNDEF_REFS =
  "C:\\Users\\~\\AppData\\Local\\Temp\\ccAbCdEf.o:bgi_link_probe.cpp:(.text+0xc): undefined reference to `circle'";

/* ---------- runner: every check runs sequentially, sync or async ---------- */

(async () => {
  console.log('setup-download-tests');

  await check('library: valid ar archive passes', () => {
    const v = validateWinbgimArtifact('library', fakeValidLibbgi);
    assert.strictEqual(v.ok, true, v.why);
  });

  await check('library: HTML error page rejected (not an ar archive)', () => {
    const v = validateWinbgimArtifact('library', fakeHtmlPageBig);
    assert.strictEqual(v.ok, false);
    assert.ok(/not an ar archive/.test(v.why), v.why);
  });

  await check('library: empty download rejected', () => {
    const v = validateWinbgimArtifact('library', Buffer.alloc(0));
    assert.strictEqual(v.ok, false);
    assert.ok(/empty/.test(v.why), v.why);
  });

  await check('library: truncated archive (correct magic, too small) rejected', () => {
    const v = validateWinbgimArtifact('library', AR_MAGIC);
    assert.strictEqual(v.ok, false);
    assert.ok(/truncated|only \d+ bytes/.test(v.why), v.why);
  });

  await check('library: binary garbage of real size rejected', () => {
    const v = validateWinbgimArtifact('library', Buffer.alloc(LIBBGI_MIN_BYTES + 10, 0x00));
    assert.strictEqual(v.ok, false);
    assert.ok(/not an ar archive/.test(v.why), v.why);
  });

  await check('header: real graphics.h text passes', () => {
    const v = validateWinbgimArtifact('header', fakeValidHeader);
    assert.strictEqual(v.ok, true, v.why);
  });

  await check('header: HTML page rejected', () => {
    const v = validateWinbgimArtifact('header', fakeHtmlPage);
    assert.strictEqual(v.ok, false);
    assert.ok(/HTML page/.test(v.why), v.why);
  });

  await check('header: implausibly small file rejected', () => {
    const v = validateWinbgimArtifact('header', Buffer.from('#include <x>', 'utf8'));
    assert.strictEqual(v.ok, false);
    assert.ok(/small/.test(v.why), v.why);
  });

  await check('header: C++ text without graphics declarations rejected', () => {
    const v = validateWinbgimArtifact('header', fakeHeaderNoGraphics);
    assert.strictEqual(v.ok, false);
    assert.ok(/does not declare/.test(v.why), v.why);
  });

  await check('install: valid buffers land on disk and are logged', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-dl-ok-'));
    try {
      const fetched = [];
      const res = await installWinbgimWindows(dir, async (url) => {
        fetched.push(url);
        const base = url.split('/').pop();
        return VALID_MAP.get(base);
      });
      assert.ok(fs.existsSync(path.join(res.includeDir, 'graphics.h')));
      assert.ok(fs.existsSync(path.join(res.includeDir, 'winbgim.h')));
      assert.ok(fs.existsSync(path.join(res.libDir, 'libbgi.a')));
      assert.strictEqual(fetched.length, 3);
      assert.ok(res.log.every((l) => /^downloaded /.test(l)), res.log.join('; '));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('install: HTML garbage is REJECTED, nothing corrupt lands on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-dl-bad-'));
    try {
      await assert.rejects(
        () => installWinbgimWindows(dir, async () => fakeHtmlPage),
        (e) => /not an ar archive|HTML page/.test(String(e && e.message))
      );
      const lib = path.join(dir, 'winbgim', 'lib', 'libbgi.a');
      assert.strictEqual(fs.existsSync(lib), false, 'corrupt libbgi.a must not be written');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('install: a bad library aborts the whole install loudly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-dl-mix-'));
    try {
      await assert.rejects(() =>
        /* headers valid, library garbage -> whole install must throw loudly */
        installWinbgimWindows(dir, async (url) => {
          const base = url.split('/').pop();
          return base === 'libbgi.a' || base === 'libbgi64.a' ? fakeHtmlPage : VALID_MAP.get(base);
        })
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('classifier: undefined refs + 32-bit compiler = 32-bit message', () => {
    const out = describeBgiProbeFailure(UNDEF_REFS, 'mingw32');
    assert.ok(/32-bit/.test(out), out);
    assert.ok(/64-bit MinGW-w64/.test(out), out);
  });

  await check('classifier: undefined refs + i686 = 32-bit message', () => {
    const out = describeBgiProbeFailure(UNDEF_REFS, 'i686');
    assert.ok(/32-bit/.test(out), out);
  });

  await check('classifier: undefined refs + x86_64 = corrupt-library message', () => {
    const out = describeBgiProbeFailure(UNDEF_REFS, 'x86_64');
    assert.ok(/corrupt|quarantined/.test(out), out);
  });

  await check('classifier: missing graphics.h = include-path message', () => {
    const out = describeBgiProbeFailure(
      'bgi_link_probe.cpp:1:10: fatal error: graphics.h: No such file or directory',
      'x86_64'
    );
    assert.ok(/cannot find graphics\.h/.test(out), out);
  });

  await check('classifier: unknown stderr = tail of the error', () => {
    const out = describeBgiProbeFailure('some\nlong\nlast line about ld.exe crashing', 'x86_64');
    assert.ok(/last line about ld\.exe crashing/.test(out), out);
  });

  await check('classifier: empty detail = unknown-reason line', () => {
    const out = describeBgiProbeFailure('', 'x86_64');
    assert.ok(/unknown reason/.test(out), out);
  });

  await check('scrub: Windows username path is masked', () => {
    const mod = scrubModule();
    assert.strictEqual(mod.scrubText('C:\\Users\\noman\\AppData\\Roaming\\x'), 'C:\\Users\\~\\AppData\\Roaming\\x');
  });

  await check('scrub: POSIX home path is masked', () => {
    const mod = scrubModule();
    assert.strictEqual(mod.scrubText('/home/someuser/file.cpp:12'), '/home/~/file.cpp:12');
  });

  await check('scrub: plain compiler stderr is untouched', () => {
    const mod = scrubModule();
    const t = 'undefined reference to `circle` collected at cc0AF1.o';
    assert.strictEqual(mod.scrubText(t), t);
  });

  console.log('');
  console.log(`setup-download-tests: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('runner crashed:', e);
  process.exit(1);
});

/* helper: load out/instrument.js with a minimal vscode stub */
let scrubCache = null;
function scrubModule() {
  if (scrubCache) {
    return scrubCache;
  }
  const Module = require('module');
  const stub = {
    env: { isTelemetryEnabled: true, appName: 'test', uriScheme: 'vscode' },
    version: '0.0.0-test'
  };
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'vscode') {
      return stub;
    }
    return orig.call(this, id);
  };
  try {
    scrubCache = orig.call(require, path.join(ROOT, 'out', 'instrument.js'));
  } finally {
    Module.prototype.require = orig;
  }
  return scrubCache;
}
