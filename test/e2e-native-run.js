#!/usr/bin/env node
/**
 * e2e-native-run.js — v1.5.12: launches a REAL VS Code instance with a REAL
 * workspace folder open (the state users have when they press F5 / Ctrl+Alt+N)
 * and runs test/native-run-host-tests.js inside it:
 *
 *   - graphics-h-runner.nativeRunSetup writes .vscode/launch.json,
 *     .vscode/tasks.json and .vscode/settings.json;
 *   - a REAL debug session started FROM the written launch.json compiles +
 *     launches a graphics.h program (the exact F5 path);
 *   - re-runs are idempotent and never destroy user content.
 *
 * Run on a virtual display:  DISPLAY=:119 node test/e2e-native-run.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.join(__dirname, '..');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-native-e2e-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-native-ws-'));
  const userData = path.join(tmp, 'userdata');

  try {
    await runTests({
      version: 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(ROOT, 'test', 'native-run-host-tests.js'),
      launchArgs: [
        wsDir, /* a real folder open from the start — the user's F5 state */
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=' + userData,
        '--skip-release-notes',
        '--disable-workspace-trust'
      ],
      extensionTestsEnv: { GHR_E2E: '1' }
    });
    console.log('E2E-NATIVE-RUN: PASS — artifacts written, F5 session ran from launch.json, idempotent + merge-safe');
    process.exit(0);
  } catch (e) {
    console.error('E2E-NATIVE-RUN: FAILED:', e && e.message ? e.message : e);
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
