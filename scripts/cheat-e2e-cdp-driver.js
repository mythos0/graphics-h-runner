/**
 * cheat-e2e-cdp-driver.js — outer driver for the REAL-HOST cheat-sheet
 * click test (pairs with scripts/e2e-cheat-host.js, which launches VS Code
 * with --remote-debugging-port=9333 and runs test/cheat-click-tests.js
 * inside the extension host).
 *
 * The panel webview is an OOPIF <iframe> target (vscode-webview://...),
 * which playwright's page.frames() does NOT expose over connectOverCDP —
 * so this driver talks RAW CDP: it attaches straight to the iframe target
 * and evaluates into the webview document.
 *
 * Protocol (file signals in build/):
 *   inner: opens the sheet via graphics-h-runner.cheatSheet -> cheat-e2e-ready
 *   outer: verifies the REAL DOM shows #cheat-overlay.open -> cheat-e2e-phase1
 *   inner: sees phase1, toggles the sheet closed -> cheat-e2e-phase2
 *   outer: verifies the sheet really closed            -> cheat-e2e-done
 *   inner: sees done -> test passes
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const READY = path.join(BUILD, 'cheat-e2e-ready');
const PHASE1 = path.join(BUILD, 'cheat-e2e-phase1');
const DONE = path.join(BUILD, 'cheat-e2e-done');
const CDP_HTTP = 'http://127.0.0.1:9333';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** attach to a vscode-webview iframe target; returns a poll() that yields
 *  the #cheat-overlay class string (null when the overlay does not exist). */
async function attachWebviewCdp() {
  let targets = [];
  for (let i = 0; i < 240; i++) {
    const res = await fetch(CDP_HTTP + '/json/list').then((r) => r.json()).catch(() => []);
    targets = res.filter((t) => t.type === 'iframe' && String(t.url || '').startsWith('vscode-webview://'));
    if (targets.length > 0) break;
    await sleep(500);
  }
  if (targets.length === 0) throw new Error('no vscode-webview iframe target found over CDP');

  const sessions = [];
  for (const t of targets) {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let seq = 0;
    const pend = new Map();
    ws.addEventListener('message', (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      } catch (e) { /* ignore malformed */ }
    });
    const call = (method, params) => new Promise((resolve) => {
      const id = ++seq;
      pend.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Runtime.enable', {});
    sessions.push({ url: t.url, call });
  }

  const poll = async () => {
    for (const s of sessions) {
      try {
        /* the webview target is the OUTER shell document; the real panel
         * lives inside its nested same-origin iframe#active-frame */
        const r = await s.call('Runtime.evaluate', {
          expression:
            "(function(){var f=document.getElementById('active-frame');" +
            "if(!f||!f.contentDocument)return null;" +
            "var el=f.contentDocument.getElementById('cheat-overlay');" +
            "return el?String(el.className):'';})()",
          returnByValue: true
        });
        const v = r && r.result && r.result.result && r.result.result.value;
        if (typeof v === 'string') return v;
      } catch (e) { /* target may detach mid-poll */ }
    }
    return null;
  };
  return poll;
}

(async () => {
  /* 1. wait for the inner test to open the sheet */
  let ready = false;
  for (let i = 0; i < 1500; i++) {
    if (fs.existsSync(READY)) { ready = true; break; }
    await sleep(100);
  }
  if (!ready) throw new Error('cheat-e2e-ready never appeared');

  /* 2. attach to the webview over raw CDP */
  const overlayClass = await attachWebviewCdp();

  /* 3. phase 1: the sheet is really OPEN in the DOM */
  let opened = false;
  for (let i = 0; i < 300; i++) {
    const cls = await overlayClass();
    if (cls !== null && /\bopen\b/.test(cls)) { opened = true; break; }
    await sleep(200);
  }
  if (!opened) throw new Error('cheat sheet never appeared open in the real DOM');
  fs.writeFileSync(PHASE1, String(Date.now()));

  /* 4. phase 2: the inner toggle really CLOSED it */
  let closed = false;
  for (let i = 0; i < 300; i++) {
    const cls = await overlayClass();
    if (cls !== null && !/\bopen\b/.test(cls)) { closed = true; break; }
    await sleep(200);
  }
  if (!closed) throw new Error('cheat sheet never closed after the toggle');
  fs.writeFileSync(DONE, String(Date.now()));
  console.log('CDP DRIVER: open + close verified in the real DOM -> done');
  process.exit(0);
})().catch((e) => {
  console.error('CDP DRIVER FAIL: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
