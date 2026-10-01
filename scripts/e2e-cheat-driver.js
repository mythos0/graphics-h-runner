#!/usr/bin/env node
/**
 * e2e-cheat-driver.js — the OUTER half of the real-host cheat-sheet e2e.
 * (The original driver lived only in an old session's scratch dir and was
 * never committed; this is the persisted replacement.)
 *
 * VS Code 1.13x/1.14x webview architecture, as discovered live:
 *   /json/list exposes ONE iframe target per webview (vscode-webview://).
 *   Its MAIN document is only VS Code's wrapper bootstrap (the
 *   "isSafari..." module). The REAL panel HTML (with #cheat-overlay) is a
 *   same-process CHILD FRAME of that wrapper. It has no target of its
 *   own and is NOT auto-attached — but Runtime.enable on the wrapper
 *   session surfaces every frame's execution context, and the overlay
 *   probe can be evaluated with an explicit contextId.
 *
 * Protocol (with test/cheat-click-tests.js inside the extension host of
 * the VS Code that scripts/e2e-cheat-host.js launches on CDP :9333):
 *   1. inner test opens the sheet, writes build/cheat-e2e-ready
 *   2. driver probes all frames: overlay present + .open -> writes
 *      build/cheat-e2e-phase1
 *   3. inner test toggles closed, writes build/cheat-e2e-phase2
 *   4. driver verifies no frame shows the open sheet -> writes
 *      build/cheat-e2e-done -> inner test returns -> host exits ok
 *
 * Uses only Node built-ins (fetch + global WebSocket, Node >= 22).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const READY = path.join(BUILD, 'cheat-e2e-ready');
const PHASE1 = path.join(BUILD, 'cheat-e2e-phase1');
const PHASE2 = path.join(BUILD, 'cheat-e2e-phase2');
const DONE = path.join(BUILD, 'cheat-e2e-done');
const CDP_HTTP = 'http://127.0.0.1:9333';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFile(file, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) { return true; }
    await sleep(250);
  }
  return false;
}

/* Connect to a wrapper target, collect every frame execution context. */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const ctxs = [];
    const send = (method, params) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.onopen = () => {
      send('Runtime.enable')
        .then(() => setTimeout(() => resolve({
          ctxs,
          evalIn: (expr, contextId) => send('Runtime.evaluate',
            { expression: expr, returnByValue: true, contextId }),
          close: () => { try { ws.close(); } catch { /* ignore */ } }
        }), 1800))
        .catch(reject);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        if (msg.method === 'Runtime.executionContextCreated') {
          const c = msg.params.context;
          ctxs.push({ id: c.id, name: c.name, origin: c.origin || '',
            frameId: c.auxData ? c.auxData.frameId : null });
        }
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) { p.rej(new Error(msg.error.message)); }
          else { p.res(msg.result); }
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => reject(new Error('CDP websocket error'));
  });
}

const OVERLAY_EXPR = `(() => {
  const o = document.querySelector('#cheat-overlay');
  if (!o) return 'absent';
  if (!o.classList.contains('open')) return 'closed';
  const cs = getComputedStyle(o);
  return (cs.display === 'none' || cs.visibility === 'hidden') ? 'closed' : 'open';
})()`;

/* Probe every webview wrapper's every frame context. 'open' when any
 * frame shows the sheet, 'closed' when frames were reachable but none
 * shows it. */
async function overlayStateAny() {
  let list = [];
  try {
    list = await (await fetch(CDP_HTTP + '/json/list')).json();
  } catch (e) {
    console.log('  [driver] cdp fetch failed:',
      (e && e.cause && e.cause.code) || (e && e.message) || e);
    return 'no-cdp';
  }
  const wrappers = list.filter((t) => t.type === 'iframe' &&
    /vscode-webview:\/\//.test(t.url || '') && t.webSocketDebuggerUrl);
  if (wrappers.length === 0) { return 'no-webview'; }
  let sawAny = false;
  for (const t of wrappers) {
    let cdp = null;
    try {
      cdp = await connect(t.webSocketDebuggerUrl);
      for (const x of cdp.ctxs) {
        try {
          const r = await cdp.evalIn(OVERLAY_EXPR, x.id);
          const v = r && r.result && r.result.value;
          sawAny = true;
          if (v === 'open') { cdp.close(); return 'open'; }
        } catch { /* context died mid-eval — skip */ }
      }
    } catch { /* wrapper gone — skip */ }
    if (cdp) { cdp.close(); }
  }
  return sawAny ? 'closed' : 'no-eval';
}

async function main() {
  for (const f of [READY, PHASE1, PHASE2, DONE]) { try { fs.unlinkSync(f); } catch { /* - */ } }

  if (!await waitForFile(READY, 240000)) {
    throw new Error('driver: inner test never signalled ready');
  }

  /* phase 1: the sheet must be OPEN right now (grace period for the
   * host -> page message round-trip) */
  let state = 'absent';
  for (let i = 0; i < 60 && state !== 'open'; i++) {
    state = await overlayStateAny();
    if (state !== 'open') { await sleep(400); }
  }
  if (state !== 'open') { throw new Error('driver: cheat overlay did not open (state=' + state + ')'); }
  fs.writeFileSync(PHASE1, String(Date.now()));

  /* inner test now toggles it closed and writes phase2 */
  if (!await waitForFile(PHASE2, 60000)) {
    throw new Error('driver: inner test never wrote phase2');
  }
  state = 'open';
  for (let i = 0; i < 60 && state !== 'closed'; i++) {
    state = await overlayStateAny();
    if (state === 'open') { await sleep(400); }
  }
  if (state === 'open') { throw new Error('driver: cheat overlay did not close'); }
  fs.writeFileSync(DONE, String(Date.now()));
  console.log('cheat driver: overlay opened + toggled closed — DONE');
}

main().then(
  () => process.exit(0),
  (e) => { console.error('DRIVER FAIL:', e && e.message ? e.message : e); process.exit(1); }
);
