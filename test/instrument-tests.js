#!/usr/bin/env node
/**
 * instrument-tests.js — v1.5.23 Sentry inbox hardening (pure parts).
 *
 * Root causes fixed from the live inbox (18 issues triaged 2026-10-09):
 *  [A] GRAPHICS-H-RUNNER-J/Q/Y/W/V/Z (41 events, 8 days): Copilot + GitHub
 *      built-in crashes were ATTRIBUTED TO US — the old heuristic accepted any
 *      path ending in "/dist/extension.js", and built-in extension folders
 *      (resources/app/extensions/<name>/) were never rejected.
 *  [B] GRAPHICS-H-RUNNER-A/-6/-5 (53 events): "Canceled" noise — the v1.5.1
 *      filter matched only exception.type; VS Code also sends type=Error with
 *      value "Canceled: Canceled".
 *  [C] Privacy: usernames with SPACES ("C:\Users\Taha Pervaiz\...") and
 *      forward-slash forms ("/c:/Users/siddhi patil/...") escaped scrubText.
 *  [D] Inbox spam: identical warnings re-reported every Setup/Doctor run
 *      (make-global probe failed x38, setup verify not ready x25 in 11 days).
 *
 * Loads the REAL compiled module (out/instrument.js) with a vscode stub and
 * an un-initialized Sentry SDK (capture calls become harmless no-ops), so the
 * dedupe/cap state behaves exactly like production.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

/* ---- vscode stub (instrument only touches env/telemetry) ---- */
const vscodeStub = {
  env: {
    isTelemetryEnabled: false,
    onDidChangeTelemetryEnabled: () => ({ dispose: () => undefined })
  },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 }
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return origLoad.apply(this, arguments);
};

const instrument = require(path.join(ROOT, 'out', 'instrument'));

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    failures.push(name + ': ' + e.message);
    console.log('FAIL  ' + name + ' -> ' + e.message);
  }
}

function makeEvent(fields) {
  return Object.assign({ tags: {} }, fields);
}

(async () => {
  console.log('\n[A] attribution: our install dir vs built-in extension bundles');
  const OUR_DIST =
    'c:\\Users\\someone\\.vscode\\extensions\\mythos0-labs.graphics-h-runner-1.5.22\\dist\\extension.js';
  const COPILOT_DIST =
    'c:\\Users\\someone\\AppData\\Local\\Programs\\Microsoft VS Code\\07f806f999\\resources\\app\\extensions\\copilot\\dist\\extension.js';
  const GITHUB_BUILTIN =
    '/c:/Users/some user/AppData/Local/Programs/Microsoft VS Code/07f806f999/resources/app/extensions/github/dist/extension.js';

  await t('our installed dist path IS attributable', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'ours',
            stacktrace: { frames: [{ function: 'ourFn', filename: OUR_DIST }] }
          }
        ]
      }
    });
    assert.strictEqual(instrument.isAttributableToUs(ev), true);
  });

  await t('GRAPHICS-H-RUNNER-J class: copilot dist path is NOT attributable (endsWith leak closed)', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Failed with status 400 and body: source too short',
            stacktrace: {
              frames: [
                { function: 'Kye.handlePostInsertion', filename: COPILOT_DIST },
                { function: 'process.processTicksAndRejections', filename: 'node:internal/process/task_queues:104' }
              ]
            }
          }
        ]
      }
    });
    assert.strictEqual(instrument.isAttributableToUs(ev), false);
  });

  await t('mythos0-labs dist suffix still attributable (belt-and-braces clause)', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            stacktrace: {
              frames: [
                {
                  function: 'ourFn',
                  /* same suffix shape but OUR publisher folder */
                  filename: 'c:\\Users\\someone\\.vscode\\extensions\\mythos0-labs.graphics-h-runner-1.5.23\\dist\\extension.js'
                }
              ]
            }
          }
        ]
      }
    });
    assert.strictEqual(instrument.isAttributableToUs(ev), true);
  });

  await t('referencesOtherExtension rejects VS Code built-in folders (copilot)', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Sign in to GitHub to use the Cloud Agent.',
            stacktrace: { frames: [{ function: 'Object.refreshHandler', filename: COPILOT_DIST }] }
          }
        ]
      }
    });
    assert.strictEqual(instrument.referencesOtherExtension(ev), true);
  });

  await t('referencesOtherExtension rejects built-in folders (github, forward slashes)', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Channel has been closed',
            stacktrace: { frames: [{ function: 'Iv.updateRepositoryBranchProtection', filename: GITHUB_BUILTIN }] }
          }
        ]
      }
    });
    assert.strictEqual(instrument.referencesOtherExtension(ev), true);
  });

  await t('referencesOtherExtension rejects user-installed extensions (prettier)', async () => {
    const ev = makeEvent({
      exception: {
        values: [{ type: 'Error', value: "Cannot find package 'prettier' imported from .vscode\\extensions\\esbenp.prettier-vscode-9.0.2\\x" }]
      }
    });
    assert.strictEqual(instrument.referencesOtherExtension(ev), true);
  });

  await t('referencesOtherExtension: our own paths pass', async () => {
    const ev = makeEvent({
      exception: {
        values: [{ type: 'Error', value: 'ours', stacktrace: { frames: [{ filename: OUR_DIST }] } }]
      }
    });
    assert.strictEqual(instrument.referencesOtherExtension(ev), false);
  });

  await t('observer frame stays attribution-neutral (GRAPHICS-H-RUNNER-H regression pin)', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Oracle Java SE Language Server not enabled',
            stacktrace: { frames: [{ function: 'Object.assign._errorHandler', filename: COPILOT_DIST }] }
          }
        ]
      }
    });
    /* observer frame skipped -> no frames left -> not attributable,
     * AND the copilot folder reference rejects the event outright */
    assert.strictEqual(instrument.isAttributableToUs(ev), false);
    assert.strictEqual(instrument.referencesOtherExtension(ev), true);
  });

  console.log('\n[B] benign cancellation matching (v1.5.1 filter broadened)');
  await t('type Canceled alone is benign', async () => {
    const ev = makeEvent({
      exception: { values: [{ type: 'Canceled', value: 'Canceled' }] }
    });
    assert.strictEqual(instrument.isBenignCancellation(ev), true);
  });
  await t('GRAPHICS-H-RUNNER-A class: type=Error value="Canceled: Canceled" is benign', async () => {
    const ev = makeEvent({
      exception: { values: [{ type: 'Error', value: 'Canceled: Canceled' }] }
    });
    assert.strictEqual(instrument.isBenignCancellation(ev), true);
  });
  await t('message-event "Canceled" is benign', async () => {
    const ev = makeEvent({ message: 'Canceled: Canceled' });
    assert.strictEqual(instrument.isBenignCancellation(ev), true);
  });
  await t('mixed values (one real error) are NOT benign', async () => {
    const ev = makeEvent({
      exception: {
        values: [
          { type: 'Canceled', value: 'Canceled' },
          { type: 'Error', value: 'ENOENT: no such file' }
        ]
      }
    });
    assert.strictEqual(instrument.isBenignCancellation(ev), false);
  });
  await t('real errors are NOT benign', async () => {
    const ev = makeEvent({ exception: { values: [{ type: 'Error', value: 'spawn g++ ENOENT' }] } });
    assert.strictEqual(instrument.isBenignCancellation(ev), false);
  });

  console.log('\n[C] scrubText privacy hardening');
  await t('username with a space is fully scrubbed (was "Taha Pervaiz" leak)', async () => {
    const out = instrument.scrubText('c:\\Users\\Taha Pervaiz\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\x.js');
    assert.ok(!/Taha/i.test(out), 'first name leaked: ' + out);
    assert.ok(!/Pervaiz/.test(out), 'surname leaked: ' + out);
    assert.ok(/Users[\\/]~[\\/]AppData/.test(out), 'shape changed unexpectedly: ' + out);
  });
  await t('forward-slash Windows form is scrubbed (was /c:/Users/siddhi patil leak)', async () => {
    const out = instrument.scrubText('/c:/Users/siddhi patil/AppData/Local/Programs/Microsoft VS Code/resources/app/out/vs/x.js');
    assert.ok(!/siddhi/i.test(out), 'username leaked: ' + out);
    assert.ok(!/ patil/.test(out), 'surname leaked: ' + out);
    assert.ok(/Users\/~\/AppData/.test(out), 'shape changed unexpectedly: ' + out);
  });
  await t('lowercase c:/Users form is scrubbed', async () => {
    const out = instrument.scrubText('c:/Users/MCOE/Library/Application Support/x.log');
    assert.ok(!/MCOE/.test(out), 'username leaked: ' + out);
  });
  await t('capital C:\\Users form is scrubbed', async () => {
    const out = instrument.scrubText('C:\\Users\\Suhail-Mac\\AppData\\Roaming\\Code\\logs\\x.log');
    assert.ok(!/Suhail-Mac/.test(out), 'username leaked: ' + out);
  });
  await t('/home/<user> is scrubbed', async () => {
    const out = instrument.scrubText('/home/devuser/project/main.cpp');
    assert.ok(!/devuser/.test(out), 'username leaked: ' + out);
    assert.ok(/\/home\/~\/project\/main.cpp/.test(out), 'shape changed: ' + out);
  });
  await t('this sandbox homedir is scrubbed (literal split replacement)', async () => {
    const os = require('os');
    const out = instrument.scrubText(os.homedir() + '/secret/file.txt');
    assert.ok(!out.includes(os.homedir()), 'homedir leaked: ' + out);
    assert.ok(/secret\/file.txt$/.test(out), 'tail preserved: ' + out);
  });
  await t('non-path text passes through unchanged', async () => {
    assert.strictEqual(instrument.scrubText('spawn g++ ENOENT'), 'spawn g++ ENOENT');
  });
  await t('ordinary words like "Users" outside a Windows path are untouched', async () => {
    assert.strictEqual(instrument.scrubText('the Users folder concept'), 'the Users folder concept');
  });

  console.log('\n[D] session dedupe + caps (inbox-spam hardening)');
  instrument.resetReportedStateForTests();
  await t('warning marks its key once telemetry is force-active (test hook)', async () => {
    instrument.setTelemetryActiveForTests(true);
    instrument.captureExtensionWarning('make-global probe failed', { arch: 'x86_64' });
    assert.strictEqual(instrument.hasReportedWarning('make-global probe failed'), true);
    /* second identical call is deduped — no error, state unchanged */
    instrument.captureExtensionWarning('make-global probe failed', { arch: 'x86_64' });
    assert.strictEqual(instrument.hasReportedWarning('make-global probe failed'), true);
  });
  await t('a DIFFERENT warning still reports', async () => {
    instrument.captureExtensionWarning('setup verify not ready', {});
    assert.strictEqual(instrument.hasReportedWarning('setup verify not ready'), true);
    assert.strictEqual(instrument.hasReportedWarning('winbgim link probe failed'), false);
  });
  await t('error signatures dedupe', async () => {
    const e1 = new Error('SDL_bgi build failed: clang dump');
    instrument.captureExtensionError(e1, { setup_step: 'install-sdl_bgi' });
    assert.strictEqual(instrument.hasReportedError('Error', 'SDL_bgi build failed: clang dump', 'install-sdl_bgi'), true);
    /* same signature would be suppressed (observable only via the hook) */
    instrument.captureExtensionError(new Error('SDL_bgi build failed: clang dump'), { setup_step: 'install-sdl_bgi' });
    assert.strictEqual(instrument.hasReportedError('Error', 'SDL_bgi build failed: clang dump', 'install-sdl_bgi'), true);
  });
  await t('warning cap: after 10 distinct warnings, further ones are dropped', async () => {
    instrument.resetReportedStateForTests();
    instrument.setTelemetryActiveForTests(true);
    for (let i = 0; i < 10; i++) {
      instrument.captureExtensionWarning('warn-kind-' + i, {});
    }
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(instrument.hasReportedWarning('warn-kind-' + i), true, 'kind ' + i + ' should be reported');
    }
    instrument.captureExtensionWarning('warn-kind-overflow', {});
    assert.strictEqual(instrument.hasReportedWarning('warn-kind-overflow'), false, 'cap did not hold');
  });
  await t('dedupe state resets for tests', async () => {
    instrument.resetReportedStateForTests();
    assert.strictEqual(instrument.hasReportedWarning('make-global probe failed'), false);
  });

  console.log(`\ninstrument-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
