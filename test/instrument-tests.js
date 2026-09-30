#!/usr/bin/env node
/**
 * instrument-tests.js — v1.5.16 regression tests for the Sentry
 * GRAPHICS-H-RUNNER-H fix (observer-frame attribution).
 *
 * Root cause being pinned: the bundled Sentry uncaught-exception handler
 * ("Object.assign._errorHandler", bundled inside dist/extension.js) appeared
 * inside the stack of every error it observed in the shared extension-host
 * process, so a host-thrown error from the Oracle Java language server
 * ("Oracle Java SE Language Server not enabled") passed attribution — the
 * only frame in our files was the observer that CAUGHT it, not code that
 * CAUSED it. Observer frames are now attribution-neutral.
 *
 * The fixtures below mirror the real event shapes seen in the Sentry inbox
 * (GRAPHICS-H-RUNNER-H frames verbatim; the earlier "Canceled" and prettier
 * noise shapes from the v1.5.1 / v1.5.2 rounds).
 */
'use strict';
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

/* load out/instrument.js with a minimal vscode stub (module-level require) */
const Module = require('module');
const VSCODE_STUB = {
  env: { isTelemetryEnabled: true, appName: 'test', uriScheme: 'vscode' },
  version: '0.0.0-test'
};
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return VSCODE_STUB;
  }
  return origRequire.call(this, id);
};
const { isAttributableToUs, scrubText } = origRequire.call(
  require,
  path.join(ROOT, 'out', 'instrument')
);
Module.prototype.require = origRequire;

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

/* ---------- event builders ---------- */

function eventWithFrames(frames, tags) {
  return {
    exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames } }] },
    tags
  };
}

/* GRAPHICS-H-RUNNER-H verbatim shape (paths as Sentry normalised them). */
const JAVA_NOISE_FRAMES = [
  { function: 'process._fatalException', filename: 'node:internal/process/execution', inApp: false },
  { function: 'process.emit', filename: 'node:events', inApp: false },
  {
    function: 'process.e',
    filename:
      '/c:/Users/avcoe/AppData/Local/Programs/Microsoft VS Code/04c0d99f4f/resources/app/out/vs/workbench/api/node/extensionHostProcess.js',
    inApp: true
  },
  {
    function: 'Object.assign._errorHandler',
    filename: 'c:\\Users\\~\\.vscode\\extensions\\mythos0-labs.graphics-h-runner-1.5.14\\dist\\extension.js',
    inApp: false
  }
];

const INSTALL_ROOT = 'c:\\Users\\~\\.vscode\\extensions\\mythos0-labs.graphics-h-runner-1.5.14';

/* ---------- runner ---------- */

(async () => {
  console.log('instrument-tests');

  await check('GRAPHICS-H-RUNNER-H shape: observer-only frames are NOT attributable', () => {
    assert.strictEqual(isAttributableToUs(eventWithFrames(JAVA_NOISE_FRAMES), INSTALL_ROOT), false);
  });

  await check('observer frame alone in our bundle is NOT attributable', () => {
    const e = eventWithFrames([
      { function: 'Object.assign._errorHandler', filename: '.../dist/extension.js' }
    ]);
    assert.strictEqual(isAttributableToUs(e), false);
  });

  await check('bare "_errorHandler" name is also treated as the observer', () => {
    const e = eventWithFrames([
      { function: '_errorHandler', filename: '.../dist/extension.js' }
    ]);
    assert.strictEqual(isAttributableToUs(e), false);
  });

  await check('a REAL frame in our bundle still attributes (genuine bug survives)', () => {
    const e = eventWithFrames([
      { function: 'process._fatalException', filename: 'node:internal/process/execution' },
      { function: 'runSetupStep', filename: 'c:\\...\\mythos0-labs.graphics-h-runner-1.5.16\\dist\\extension.js' },
      { function: 'Object.assign._errorHandler', filename: 'c:\\...\\mythos0-labs.graphics-h-runner-1.5.16\\dist\\extension.js' }
    ]);
    assert.strictEqual(isAttributableToUs(e), true);
  });

  await check('real our-code frame named *errorHandler* (not the observer) still attributes', () => {
    const e = eventWithFrames([
      { function: 'showAndLogErrorHandler', filename: 'c:\\...\\dist\\extension.js' }
    ]);
    assert.strictEqual(isAttributableToUs(e), true);
  });

  await check('deliberate captures (ghr.source=handled) always pass', () => {
    const e = eventWithFrames([], { 'ghr.source': 'handled' });
    assert.strictEqual(isAttributableToUs(e), true);
  });

  await check('frame-less events stay unattributable (module-loader rejections)', () => {
    assert.strictEqual(isAttributableToUs({ exception: { values: [{}] } }), false);
  });

  await check('no frames at all -> false even with an extensionRoot', () => {
    assert.strictEqual(isAttributableToUs({ exception: { values: [{}] } }, INSTALL_ROOT), false);
  });

  await check('frames from another extension folder are not attributable', () => {
    const e = eventWithFrames([
      { function: 'lint', filename: 'c:\\Users\\~\\.vscode\\extensions\\esbenp.prettier-vscode-9.0.0\\dist\\prettier.js' }
    ]);
    assert.strictEqual(isAttributableToUs(e), false);
  });

  await check('scrubText is unchanged (regression guard on the shared module)', () => {
    assert.strictEqual(scrubText('C:\\Users\\noman\\x'), 'C:\\Users\\~\\x');
  });

  console.log('');
  console.log(`instrument-tests: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('runner crashed:', e);
  process.exit(1);
});
