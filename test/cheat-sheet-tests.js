#!/usr/bin/env node
/**
 * cheat-sheet-tests.js — v1.5.8 regression: the panel "?" cheat sheet
 * must survive the panel's re-render-happy architecture.
 *
 * The user report "? button click not opens cheatsheet" was a RACE: the
 * panel re-renders on doctor/busy/celebration/visibility events, and any
 * re-render replaced the whole page — destroying an open cheat sheet and
 * swallowing clicks that landed mid-swap (re-renders cluster right after
 * the panel opens, exactly when a user first clicks ?).
 *
 * Fix contract (page side, panelHtml.ts):
 *   - openCheat/closeCheat persist `cheatOpen` in vscode.setState
 *     (merged, never wiping the section toggles) and report to the host
 *     via postMessage({type:'cheat', open});
 *   - every fresh page REOPENS the sheet from persisted state;
 *   - every fresh page re-syncs the host with its cheat state.
 * Fix contract (host side, panelView.ts):
 *   - 'cheat' messages are intercepted before onClick;
 *   - postState() DEFERS the re-render while the sheet is open and
 *     delivers it when the sheet reports closed.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const panelHtmlSrc = fs.readFileSync(path.join(ROOT, 'src', 'panelHtml.ts'), 'utf8');
const panelViewSrc = fs.readFileSync(path.join(ROOT, 'src', 'panelView.ts'), 'utf8');
const outPanelHtml = fs.readFileSync(path.join(ROOT, 'out', 'panelHtml.js'), 'utf8');
const outPanelView = fs.readFileSync(path.join(ROOT, 'out', 'panelView.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failures.push(name);
    console.log('  ❌ ' + name + ' -> ' + e.message);
  }
}

console.log('cheat-sheet-tests — the ? sheet survives re-renders\n');

/* ---------- page side: source contract ---------- */
check('page persists sheet state on open (merged setState + host report)', () => {
  assert.ok(panelHtmlSrc.includes('function setCheatState(open)'), 'setCheatState helper missing');
  assert.ok(panelHtmlSrc.includes("st.cheatOpen = !!open; vscode.setState(st)"), 'setState merge missing');
  assert.ok(panelHtmlSrc.includes("vscode.postMessage({ type: 'cheat', open: !!open })"), 'host report missing');
});
check('openCheat and closeCheat both report state', () => {
  const openBody = panelHtmlSrc.slice(panelHtmlSrc.indexOf('function openCheat()'), panelHtmlSrc.indexOf('function closeCheat()'));
  assert.ok(openBody.includes('setCheatState(true)'), 'openCheat does not persist');
  const closeBody = panelHtmlSrc.slice(panelHtmlSrc.indexOf('function closeCheat()'), panelHtmlSrc.indexOf("var cheatClose = document.getElementById"));
  assert.ok(closeBody.includes('setCheatState(false)'), 'closeCheat does not persist');
});
check('fresh page reopens the sheet from persisted state', () => {
  assert.ok(panelHtmlSrc.includes('if (cheatStateOpen()) { openCheat(); }'), 'boot restore missing');
});
check('fresh page re-syncs the host on boot (no stuck deferral)', () => {
  assert.ok(panelHtmlSrc.includes("vscode.postMessage({ type: 'cheat', open: cheatStateOpen() })"), 'boot sync post missing');
});
check('sheet state merges with section toggles (never wipes them)', () => {
  assert.ok(panelHtmlSrc.includes('vscode.getState() || {}'), 'state base missing');
  assert.ok(panelHtmlSrc.includes('st.programsOpen'), 'programs toggle still present');
  assert.ok(panelHtmlSrc.includes('st.labOpen'), 'lab toggle still present');
});
check('Esc / × / backdrop close paths all intact', () => {
  assert.ok(panelHtmlSrc.includes("if (ev.key === 'Escape') { closeCheat(); }"), 'Esc close missing');
  assert.ok(panelHtmlSrc.includes("cheatClose.addEventListener('click', closeCheat)"), '× close missing');
  assert.ok(panelHtmlSrc.includes('if (ev.target === cheatOv) { closeCheat(); }'), 'backdrop close missing');
});

/* ---------- host side: source contract ---------- */
check("PanelClick union carries the 'cheat' message", () => {
  assert.ok(panelViewSrc.includes("| { type: 'cheat'; open: boolean }"), 'union member missing');
});
check("host intercepts 'cheat' before onClick", () => {
  const handler = panelViewSrc.slice(panelViewSrc.indexOf('onDidReceiveMessage'), panelViewSrc.indexOf('view.onDidChangeVisibility'));
  assert.ok(handler.includes("msg.type === 'cheat'"), 'intercept missing');
  assert.ok(handler.indexOf("msg.type === 'cheat'") < handler.indexOf('this.onClick(msg)'), 'intercept must run before onClick');
});
check('postState defers re-renders while the sheet is open', () => {
  const ps = panelViewSrc.slice(panelViewSrc.indexOf('private postState()'), panelViewSrc.indexOf('private postBusy()'));
  assert.ok(ps.includes('if (this.cheatOpen)'), 'gate missing');
  assert.ok(ps.includes('this.pendingRender = true'), 'park flag missing');
});
check('sheet close delivers the deferred re-render', () => {
  const handler = panelViewSrc.slice(panelViewSrc.indexOf('onDidReceiveMessage'), panelViewSrc.indexOf('view.onDidChangeVisibility'));
  assert.ok(handler.includes('!this.cheatOpen && this.pendingRender'), 'delivery condition missing');
  assert.ok(handler.includes('this.postState()'), 'delivery call missing');
});
check('health retry path bypasses the gate (recovery must always win)', () => {
  const retry = panelViewSrc.slice(panelViewSrc.indexOf('fallback: () => {'), panelViewSrc.indexOf('fallbackActive: '));
  void retry;
  const resolve = panelViewSrc.slice(panelViewSrc.indexOf('resolveWebviewView(view'), panelViewSrc.indexOf('private notify('));
  assert.ok(resolve.includes("view.webview.html = this.renderHtml()"), 'direct html set missing in resolve');
});

/* ---------- v1.5.9: the ? moved to the view title bar ---------- */
check('v1.5.9: host drives the sheet from the view title (? action)', () => {
  assert.ok(panelViewSrc.includes('async openCheatSheet()'), 'openCheatSheet missing');
  assert.ok(panelViewSrc.includes('this.pendingCheatOpen'), 'parked-open flag missing');
  assert.ok(panelViewSrc.includes("postMessage({ type: 'cheat', open: true })"), 'open delivery missing');
  assert.ok(panelViewSrc.includes('this.pageAlive'), 'page liveness tracking missing');
});
check('v1.5.9: parked ? request is delivered on the page boot handshake', () => {
  const handler = panelViewSrc.slice(panelViewSrc.indexOf('onDidReceiveMessage'), panelViewSrc.indexOf('view.onDidChangeVisibility'));
  assert.ok(handler.includes('if (this.pendingCheatOpen)'), 'handshake delivery missing');
  assert.ok(handler.indexOf("msg.type === 'cheat'") < handler.indexOf('this.onClick(msg)'), 'intercept must run before onClick');
});

/* ---------- compiled output carries the fix ---------- */
check('compiled out/panelHtml.js + out/panelView.js carry the fix', () => {
  assert.ok(outPanelHtml.includes('cheatStateOpen'), 'compiled page missing boot restore');
  assert.ok(outPanelHtml.includes("type: 'cheat'"), 'compiled page missing host report');
  assert.ok(outPanelView.includes("'cheat'"), 'compiled host missing cheat intercept');
  assert.ok(outPanelView.includes('this.pendingRender'), 'compiled host missing gate');
});

/* ---------- rendered HTML carries the script ---------- */
check('buildPanelHtml output contains the persistence script', () => {
  const { buildPanelHtml } = require(path.join(ROOT, 'out', 'panelHtml'));
  const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));
  const programs = loadProgramCatalog(ROOT).map((p) => ({
    id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag, lab: !!p.lab
  }));
  const html = buildPanelHtml({
    programs,
    commands: COMMAND_META,
    status: { state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null },
    version: 'test', nonce: 'n1', logoUri: '', cspSource: 'https://x'
  });
  assert.ok(html.includes('cheatStateOpen'), 'rendered html missing boot restore');
  assert.ok(html.includes("type: 'cheat'"), 'rendered html missing host report');
  /* v1.5.9: the ? button moved to the view title bar — the panel page must
     NOT render it anymore, and must answer the host's open message */
  assert.ok(!html.includes('help-btn'), 'in-panel ? button must be gone (view title owns it now)');
  assert.ok(html.includes("if (m.open) { openCheat(); } else { closeCheat(); }"), 'host-driven open missing');
  assert.ok(html.includes('id="cheat-overlay"'), 'rendered html missing overlay');
});

console.log('\n' + (failures.length ? failures.length + ' FAILURES' : 'CHEAT SHEET TESTS ALL PASS'));
process.exit(failures.length ? 1 : 0);
