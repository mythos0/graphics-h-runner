#!/usr/bin/env node
/**
 * e2e-uninstall-restore.js — v1.5.13: launches a REAL VS Code instance with
 * a REAL, user-seeded workspace folder and runs
 * test/uninstall-restore-host-tests.js inside it:
 *
 *   - graphics-h-runner.nativeRunSetup wires the native run surfaces and
 *     snapshots the pre-extension state into globalStorage;
 *   - graphics-h-runner.restoreOriginalSettings reverts every written
 *     setting/file surgically and forgets the backup;
 *   - a second restore is a clean no-op.
 *
 * Run on a virtual display:  DISPLAY=:119 node test/e2e-uninstall-restore.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.join(__dirname, '..');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-restore-e2e-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-restore-ws-'));
  const userData = path.join(tmp, 'userdata');

  try {
    await runTests({
      version: 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(ROOT, 'test', 'uninstall-restore-host-tests.js'),
      launchArgs: [
        wsDir, /* a real folder open from the start */
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=' + userData,
        '--skip-release-notes',
        '--disable-workspace-trust'
      ],
      extensionTestsEnv: { GHR_E2E: '1', GHR_USER_DATA: userData }
    });
    console.log('E2E-UNINSTALL-RESTORE: PASS — snapshot taken, restore reverted settings/launch/tasks surgically, backup cleaned');
    process.exit(0);
  } catch (e) {
    console.error('E2E-UNINSTALL-RESTORE: FAILED:', e && e.message ? e.message : e);
    try {
      const walk = (d) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, f.name);
          if (f.isDirectory()) { walk(p); } else if (/exthost/.test(p)) {
            const txt = fs.readFileSync(p, 'utf8');
            const bad = txt.split('\n').filter((l) => /error|failed/i.test(l)).slice(-12);
            if (bad.length) { console.error('--- ext host log tail ---'); bad.forEach((l) => console.error('  ' + l)); }
          }
        }
      };
      walk(userData);
    } catch { /* log dump best-effort */ }
    process.exit(1);
  }
}

main();
