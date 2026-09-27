/**
 * cheat-click-tests.js — inner extension-test module for the REAL-HOST
 * cheat-sheet click test. Opens the graphics.h panel in a live VS Code,
 * signals the outer CDP driver that the webview should be up, then waits
 * for the outer driver to finish clicking #help-btn inside the REAL
 * webview iframe.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const READY = path.join(BUILD, 'cheat-e2e-ready');
const DONE = path.join(BUILD, 'cheat-e2e-done');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

exports.run = async function () {
  fs.mkdirSync(BUILD, { recursive: true });
  /* open the panel view (same entry the e2e-activation suite uses) */
  await vscode.commands.executeCommand('graphics-h-runner.programs.focus');
  await sleep(2500); /* let the webview boot + doctor land */
  fs.writeFileSync(READY, String(Date.now()));
  for (let i = 0; i < 900; i++) { /* up to 90 s for the outer driver */
    if (fs.existsSync(DONE)) {
      try { fs.unlinkSync(DONE); } catch (e) { /* ignore */ }
      return;
    }
    await sleep(100);
  }
  throw new Error('cheat e2e: outer CDP click test never signalled done');
};
