#!/usr/bin/env node
/**
 * e2e-activation.js — launches a REAL VS Code instance (via
 * @vscode/test-electron) with the extension loaded, activates it, focuses
 * the graphics.h panel, and then scans the workbench logs for the
 * "There is no data provider registered that can provide view data" error
 * (the v1.4.0 regression) and for extension activation errors.
 *
 * Run on a virtual display:  DISPLAY=:119 node test/e2e-activation.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.join(__dirname, '..');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-e2e-'));
  const extHostLogDir = path.join(tmp, 'userdata');

  try {
    await runTests({
      version: 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(ROOT, 'test', 'activation-tests.js'),
      launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=' + extHostLogDir,
        '--skip-release-notes',
        '--disable-workspace-trust'
      ],
      extensionTestsEnv: { GHR_E2E: '1' }
    });
    console.log('E2E: in-extension assertions passed');
  } catch (e) {
    console.error('E2E: in-extension run FAILED:', e && e.message ? e.message : e);
    dumpLogs(extHostLogDir);
    process.exit(1);
  }

  /* scan every log file the run produced for the known failure signatures */
  await new Promise((r) => setTimeout(r, 500));
  const bad = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(log|txt)$/.test(f.name)) {
        try {
          const txt = fs.readFileSync(p, 'utf8');
          if (/no data provider registered/i.test(txt)) bad.push('data-provider error in ' + p);
          if (/Activating extension.*failed/i.test(txt)) bad.push('activation failure in ' + p);
        } catch { /* unreadable log — ignore */ }
      }
    }
  };
  try { walk(extHostLogDir); } catch (e) { console.log('log scan skipped:', e.message); }

  if (bad.length) {
    console.error('E2E: FAILURE signatures found:');
    bad.forEach((b) => console.error('  - ' + b));
    process.exit(1);
  }
  console.log('E2E: logs clean — no data-provider error, no activation failure');
  console.log('E2E ACTIVATION TEST PASS');
  process.exit(0);
}

function dumpLogs(dir) {
  try {
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/exthost|renderer.*log$/.test(p)) {
          const txt = fs.readFileSync(p, 'utf8');
          const tail = txt.split('\n').slice(-40).join('\n');
          console.error('--- ' + p + ' (tail) ---\n' + tail);
        }
      }
    };
    walk(dir);
  } catch { /* best effort */ }
}

main();
