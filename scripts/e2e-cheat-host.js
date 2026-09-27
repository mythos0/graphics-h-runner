/**
 * e2e-cheat-host.js — node side of the REAL-HOST cheat-sheet click test.
 * Launches VS Code via @vscode/test-electron with a CDP debug port, runs
 * test/cheat-click-tests.js inside the extension host, and records the
 * host outcome to build/cheat-e2e-host-exit for the python orchestrator.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-cheat-'));
  try {
    await runTests({
      version: 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(ROOT, 'test', 'cheat-click-tests.js'),
      launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=' + tmp,
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--remote-debugging-port=9333'
      ],
      extensionTestsEnv: { GHR_E2E: '1' }
    });
    fs.writeFileSync(path.join(BUILD, 'cheat-e2e-host-exit'), 'host-ok');
  } catch (e) {
    try {
      fs.writeFileSync(path.join(BUILD, 'cheat-e2e-host-exit'), 'host-fail: ' + (e && e.message ? e.message : e));
    } catch (e2) { /* ignore */ }
  }
})();
