/**
 * cheat-click-tests.js — inner extension-test module for the REAL-HOST
 * cheat-sheet e2e. v1.5.9: the ? button lives in the view TITLE bar, so the
 * driver no longer clicks #help-btn — the inner test executes the
 * graphics-h-runner.cheatSheet command exactly like the workbench does, in
 * a live VS Code, then signals the outer CDP driver to verify that the
 * cheat sheet overlay REALLY opened inside the real webview iframe.
 *
 * Two phases per run (outer driver writes phase files):
 *   phase 1: verify open  -> build/cheat-e2e-phase1
 *   phase 2: verify toggle-close -> build/cheat-e2e-phase2
 * When both files exist, the outer test is done and we return.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const READY = path.join(BUILD, 'cheat-e2e-ready');
const DONE = path.join(BUILD, 'cheat-e2e-done');
const PHASE1 = path.join(BUILD, 'cheat-e2e-phase1');
const PHASE2 = path.join(BUILD, 'cheat-e2e-phase2');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

exports.run = async function () {
  fs.mkdirSync(BUILD, { recursive: true });
  for (const f of [READY, DONE, PHASE1, PHASE2]) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  }
  /* open the panel view (same entry the e2e-activation suite uses) */
  await vscode.commands.executeCommand('graphics-h-runner.programs.focus');
  await sleep(2500); /* let the webview boot + doctor land */
  /* v1.5.9: the view-title ? action = this command. It must open the sheet
     inside the panel — the outer CDP driver verifies the real DOM. */
  await vscode.commands.executeCommand('graphics-h-runner.cheatSheet');
  fs.writeFileSync(READY, String(Date.now()));
  for (let i = 0; i < 900; i++) { /* up to 90 s for the outer driver */
    if (fs.existsSync(PHASE1) && !fs.existsSync(PHASE2)) {
      /* phase 1 verified open — toggle close via the same command */
      await vscode.commands.executeCommand('graphics-h-runner.cheatSheet');
      fs.writeFileSync(PHASE2, String(Date.now()));
    }
    if (fs.existsSync(DONE)) {
      try { fs.unlinkSync(DONE); } catch (e) { /* ignore */ }
      for (const f of [PHASE1, PHASE2]) {
        try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
      }
      return;
    }
    await sleep(100);
  }
  throw new Error('cheat e2e: outer CDP driver never signalled done');
};
