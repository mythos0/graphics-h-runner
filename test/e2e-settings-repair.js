#!/usr/bin/env node
/**
 * e2e-settings-repair.js — launches a REAL VS Code instance with the user
 * settings.json BROKEN exactly the way the Sentry GRAPHICS-H-RUNNER-10
 * reporter's machine was (missing comma + doubled comma from a hand edit),
 * then proves the v1.5.24 fix chain end to end inside that host:
 * refusal -> classification -> repair (backup first) -> write accepted ->
 * user values preserved -> Complete Setup runs without crashing.
 *
 * Run on a virtual display:  DISPLAY=:119 node test/e2e-settings-repair.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.join(__dirname, '..');

/* The hand-broken settings.json — the two realistic classes a user pastes
 * or hand-edits their way into (missing member comma, doubled comma). */
const BROKEN_SETTINGS = [
  '{',
  '    // my editor prefs',
  '    "editor.fontSize": 14',
  '    "workbench.colorTheme": "Default Dark Modern",,',
  '    "window.titleBarStyle": "custom",',
  '    "explorer.confirmDelete": true',
  '}'
].join('\n') + '\n';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghr-e2e-settings-'));
  const userDataDir = path.join(tmp, 'userdata');
  const userDir = path.join(userDataDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });
  const settingsPath = path.join(userDir, 'settings.json');
  fs.writeFileSync(settingsPath, BROKEN_SETTINGS, 'utf8');
  console.log('E2E: seeded broken settings at ' + settingsPath);

  try {
    await runTests({
      version: 'stable',
      extensionDevelopmentPath: ROOT,
      extensionTestsPath: path.join(ROOT, 'test', 'settings-repair-host-tests.js'),
      launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--user-data-dir=' + userDataDir,
        '--skip-release-notes',
        '--disable-workspace-trust'
      ],
      extensionTestsEnv: { GHR_E2E: '1', GHR_SETTINGS_PATH: settingsPath, HOME: process.env.HOME || '' }
    });
    console.log('E2E SETTINGS-REPAIR: PASS — real host refused, repair healed the file, write accepted, setup ran clean');
    process.exit(0);
  } catch (e) {
    console.error('E2E SETTINGS-REPAIR: FAILED:', e && e.message ? e.message : e);
    /* diagnostics: what did the extension actually do in there? */
    try {
      const userDir = path.join(userDataDir, 'User');
      const gs = path.join(userDir, 'globalStorage');
      console.log('DIAG globalStorage exists:', fs.existsSync(gs));
      if (fs.existsSync(gs)) {
        const walk = (d, depth) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            console.log('DIAG   ' + '  '.repeat(depth) + f.name);
            if (f.isDirectory() && depth < 2) walk(path.join(d, f.name), depth + 1);
          }
        };
        walk(gs, 1);
      }
      console.log('DIAG settings now:', JSON.stringify(fs.readFileSync(settingsPath, 'utf8').slice(0, 200)));
      /* exthost log tail — extension console output lands here */
      const logsDir = path.join(userDataDir, 'logs');
      const newest = fs.readdirSync(logsDir).sort().pop();
      const exthostDir = path.join(logsDir, newest, 'window' + (fs.existsSync(path.join(logsDir, newest, 'window1')) ? '1' : ''), 'exthost');
      const walkLogs = (d, out) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, f.name);
          if (f.isDirectory()) walkLogs(p, out);
          else if (/exthost.*\.log$/.test(f.name) || f.name === 'renderer.log') {
            try { out.push(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
          }
        }
      };
      const logTexts = [];
      if (fs.existsSync(exthostDir)) walkLogs(exthostDir, logTexts);
      const interesting = logTexts.join('\n').split('\n').filter((l) => /settings write refused|settings-health|native-run|setup|repaired/i.test(l)).slice(-25);
      console.log('DIAG exthost log (filtered):\n' + interesting.join('\n'));
    } catch (diagErr) {
      console.log('DIAG failed:', diagErr.message);
    }
    process.exit(1);
  }
}

main();
