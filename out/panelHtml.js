"use strict";
/**
 * panelHtml.ts — HTML/CSS for the graphics.h Runner activity-bar panel.
 *
 * Design language (v1.4.4): a flat, dark, professional control page —
 * no blueish/purple gradients, one green accent reserved for the primary
 * action, every other button in the same neutral style. The 1st action
 * button (Compile & Run) is the hero: big, full-width and alone on its row;
 * the remaining actions sit below it in a 2-per-row grid. The actions block
 * shares the header row with the title / status pill / version chips and
 * uses the empty space beside them (the environment status card sits in the
 * same header, under the identity block); example programs run full width
 * below, and narrow activity bars stack naturally. Pure function,
 * unit-testable: no vscode import.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPanelHtml = buildPanelHtml;
exports.buildFallbackPanelHtml = buildFallbackPanelHtml;
function esc(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function statusPill(status) {
    if (status.state === 'ready') {
        return `<span class="pill pill-ok" id="env-pill"><span class="dot"></span>Ready — ${esc(status.library || 'graphics')}</span>`;
    }
    if (status.state === 'checking') {
        return `<span class="pill pill-wait" id="env-pill"><span class="dot dot-spin"></span>Checking environment…</span>`;
    }
    return `<span class="pill pill-bad" id="env-pill"><span class="dot"></span>Not ready${status.compilerOk ? ' — no graphics library' : ' — no C++ compiler'}</span>`;
}
function envCard(status) {
    if (status.state === 'not-ready') {
        return `
    <div class="card env-card" id="env-card">
      <div class="env-main">
        <div class="env-title">⚠️ Environment needs setup</div>
        <div class="env-sub">${status.compilerOk
            ? 'A C++ compiler was found, but the graphics library is missing. One click installs WinBGIM / SDL_bgi for you.'
            : 'No working C++ compiler found. One click installs the compiler + graphics library automatically — no admin rights needed.'}</div>
      </div>
      <button class="btn btn-accent btn-lg" data-cmd="graphics-h-runner.setupEverything" id="env-cta">🚀 Complete Run Setup</button>
    </div>`;
    }
    if (status.state === 'checking') {
        return `
    <div class="card env-card" id="env-card">
      <div class="env-main">
        <div class="env-title">🔎 Probing your PC…</div>
        <div class="env-sub">The Setup Doctor is looking for a compiler and graphics libraries.</div>
      </div>
    </div>`;
    }
    return `
  <div class="card env-card env-ok" id="env-card">
    <div class="env-main">
      <div class="env-title">✅ Everything is ready</div>
      <div class="env-sub">Compiler OK · library <b>${esc(status.library || '?')}</b> · open a program below and press <b>Ctrl+Alt+R</b>.</div>
    </div>
  </div>`;
}
function actionButtons(commands) {
    return commands
        .map((c) => `<button class="btn${c.primary ? ' btn-accent btn-hero' : ''}" data-cmd="${esc(c.commandId)}" id="${esc(c.id)}" title="${esc(c.title)}">
           <span class="btn-ico">${c.icon}</span>
           <span class="btn-body"><span class="btn-title">${esc(c.title)}</span><span class="btn-hint">${esc(c.hint)}</span></span>
         </button>`)
        .join('\n        ');
}
function programCards(programs) {
    return programs
        .map((p) => `<div class="prog" id="prog-${esc(p.id)}">
           <div class="prog-emoji">${p.emoji}</div>
           <div class="prog-body">
             <div class="prog-title">${esc(p.title)} <span class="tag tag-${esc(p.tag)}">${esc(p.tag)}</span></div>
             <div class="prog-desc">${esc(p.description)}</div>
             <div class="prog-file">${esc(p.filename)}</div>
           </div>
           <div class="prog-actions">
             <button class="mini-btn" data-run="${esc(p.id)}" title="Open + compile + run">▶ Run</button>
             <button class="mini-btn" data-open="${esc(p.id)}" title="Open the source code">Open</button>
           </div>
         </div>`)
        .join('\n        ');
}
function buildPanelHtml(opts) {
    const { programs, commands, status, version, nonce, cspSource } = opts;
    const platformName = status.platform === 'windows' ? 'Windows · WinBGIM' : status.platform === 'macos' ? 'macOS · SDL_bgi' : 'Linux · SDL_bgi';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>graphics.h Runner</title>
<style>
  :root {
    --bg:#0f1115;
    --card:rgba(255,255,255,.05); --card-line:rgba(255,255,255,.09);
    --txt:#e9ebef; --txt-dim:#9aa1ad;
    --grn1:#10b981; --grn2:#059669; --grn1h:#34d399; --grn2h:#10b981;
    --ok:#34d399; --bad:#f87171; --wait:#fbbf24;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
    background:var(--bg);
    color:var(--txt); padding:14px 12px 20px;
  }
  .hero { padding:2px 2px 6px; }
  .hero h1 { font-size:19px; letter-spacing:.3px; color:#f3f5f8; }
  .pill { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600;
    padding:5px 13px; border-radius:999px; margin-top:10px; border:1px solid; }
  .pill-ok   { color:var(--ok);   border-color:rgba(52,211,153,.4);  background:rgba(52,211,153,.09); }
  .pill-bad  { color:var(--bad);  border-color:rgba(248,113,113,.4); background:rgba(248,113,113,.09); }
  .pill-wait { color:var(--wait); border-color:rgba(251,191,36,.4);  background:rgba(251,191,36,.09); }
  .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  .dot-spin { animation:pulse 1s infinite alternate; }
  @keyframes pulse { from {opacity:.35} to {opacity:1} }
  .chips { margin-top:10px; }

  .card { background:var(--card); border:1px solid var(--card-line); border-radius:12px; padding:13px; margin-top:12px; }
  .env-card { display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-color:rgba(248,113,113,.35); }
  .env-card.env-ok { border-color:rgba(52,211,153,.35); }
  .env-main { flex:1 1 180px; }
  .env-title { font-size:13.5px; font-weight:700; }
  .env-sub { font-size:11.5px; color:var(--txt-dim); margin-top:4px; line-height:1.45; }

  /* buttons: one uniform neutral style; the green accent is reserved for the
     primary action only (1st action button + the setup call-to-action) */
  .btn { display:flex; align-items:center; gap:10px; width:100%; text-align:left;
    background:var(--card); border:1px solid var(--card-line); color:var(--txt);
    border-radius:10px; padding:9px 11px; cursor:pointer; transition:.15s; }
  .btn:hover { background:rgba(255,255,255,.09); border-color:rgba(255,255,255,.2); transform:translateY(-1px); }
  .btn:active { transform:translateY(0); }
  .btn-ico { font-size:15px; width:26px; height:26px; flex:0 0 26px; display:inline-flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.07); border-radius:7px; }
  .btn-body { display:flex; flex-direction:column; min-width:0; }
  .btn-title { font-size:12.5px; font-weight:600; }
  .btn-hint { font-size:10.5px; color:var(--txt-dim); }
  .btn-accent { background:linear-gradient(135deg, var(--grn1), var(--grn2)); border-color:transparent; }
  .btn-accent:hover { background:linear-gradient(135deg, var(--grn1h), var(--grn2h)); border-color:transparent; }
  .btn-accent .btn-ico { background:rgba(255,255,255,.18); }
  .btn-accent .btn-hint { color:rgba(255,255,255,.8); }
  .btn-lg { width:auto; padding:10px 16px; font-size:13px; font-weight:700; border-radius:10px; }
  /* the 1st action (Compile & Run) is the hero: alone on its row, full
     width, larger type and icon, soft green glow — responsive to the pane */
  .btn-hero { grid-column: 1 / -1; padding:14px 16px; gap:12px; border-radius:12px;
    box-shadow:0 8px 22px rgba(16,185,129,.22); }
  .btn-hero:hover { box-shadow:0 10px 26px rgba(16,185,129,.32); }
  .btn-hero .btn-ico { width:30px; height:30px; flex:0 0 30px; font-size:17px; border-radius:9px; }
  .btn-hero .btn-title { font-size:14.5px; font-weight:800; letter-spacing:.2px; }
  .btn-hero .btn-hint { font-size:11px; }

  /* header layout: the action buttons live in the same header row as the
     title / status pill / version chips and fill the empty space beside
     them; on a narrow sidebar they wrap below the title block */
  .header { display:flex; flex-direction:column; }
  .header-actions { margin-top:6px; }
  /* secondary actions: 2 per row under the hero button (kept even on narrow
     panes; only very narrow sidebars collapse to one column) */
  .stack { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
  @media (max-width: 299px) {
    .stack { grid-template-columns:1fr; }
  }
  @media (min-width: 620px) {
    .header { flex-direction:row; align-items:flex-start; gap:16px; }
    .hero { flex:1 1 250px; min-width:0; }
    .header-actions { flex:0 0 360px; margin-top:0; }
  }

  .sec { display:flex; align-items:baseline; justify-content:space-between; margin:14px 2px 0; }
  .sec-tight { margin:0 2px 7px; }
  .sec h2 { font-size:11px; text-transform:uppercase; letter-spacing:1.6px; color:var(--txt-dim); font-weight:700; }
  .sec .count { font-size:10.5px; color:var(--txt-dim); }

  .prog { display:flex; gap:10px; align-items:center; background:var(--card);
    border:1px solid var(--card-line); border-radius:11px; padding:9px 10px; margin-top:8px; transition:.15s; }
  .prog:hover { border-color:rgba(255,255,255,.22); background:rgba(255,255,255,.08); transform:translateY(-1px); }
  .prog-emoji { font-size:20px; width:38px; height:38px; flex:0 0 38px; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.06); border-radius:9px; }
  .prog-body { flex:1; min-width:0; }
  .prog-title { font-size:12.5px; font-weight:650; }
  .prog-desc { font-size:10.8px; color:var(--txt-dim); margin-top:2px; }
  .prog-file { font-size:9.5px; color:rgba(154,161,173,.65); margin-top:3px; font-family:Consolas, monospace; }
  .tag { font-size:8.5px; text-transform:uppercase; letter-spacing:.8px; padding:1.5px 7px; border-radius:999px; vertical-align:2px; }
  .tag-fun { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-classic { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-math { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-interactive { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .prog-actions { display:flex; flex-direction:column; gap:5px; }
  .mini-btn { font-size:11px; font-weight:600; color:var(--txt); background:rgba(255,255,255,.08);
    border:1px solid var(--card-line); border-radius:8px; padding:4px 10px; cursor:pointer; transition:.15s; white-space:nowrap; }
  .mini-btn:hover { background:rgba(255,255,255,.15); }

  .foot { font-size:10.5px; color:var(--txt-dim); margin-top:16px; line-height:1.7;
    border-top:1px solid var(--card-line); padding-top:10px; }
  .foot b { color:var(--txt); }
  .kbd { background:rgba(255,255,255,.09); border:1px solid var(--card-line); border-radius:5px; padding:1px 6px; font-size:10px; }
  .chip { display:inline-block; font-size:10px; color:var(--txt-dim); border:1px solid var(--card-line); border-radius:999px; padding:2px 10px; margin:0 3px; }

  /* narrow activity-bar sidebar: stack card actions inline */
  @media (max-width: 360px) {
    body { padding:10px 9px 16px; }
    .prog { flex-wrap:wrap; }
    .prog-body { flex:1 1 calc(100% - 110px); }
    .prog-actions { flex-direction:row; width:100%; justify-content:flex-end; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="hero">
      <h1>graphics.h Runner</h1>
      ${statusPill(status)}
      <div class="chips"><span class="chip">${platformName}</span><span class="chip">v${esc(version)}</span></div>
      ${envCard(status)}
    </div>

    <div class="header-actions">
      <div class="sec sec-tight"><h2>Actions</h2></div>
      <div class="stack">
        ${actionButtons(commands)}
      </div>
    </div>
  </div>

  <div class="sec"><h2>Example Programs</h2><span class="count">${programs.length} programs · click Run or Open</span></div>
  <div id="programs">
    ${programCards(programs)}
  </div>

  <div class="foot">
    Inside a .cpp file just press <span class="kbd">Ctrl+Alt+R</span> (or F5 → “Run graphics.h program”).<br>
    errors are reported automatically (VS Code telemetry setting respected)
    <div class="credit"><b>Powered by Department of CSE, Dhaka International University, Bangladesh.</b></div>
  </div>

<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
    /* liveness: the page answers as soon as its script executes — a dead
       webview (service-worker race) never answers, which the extension
       detects and recovers from (retry render / list-view fallback) */
    vscode.postMessage({ type: 'pong' });
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.dataset) {
          if (el.dataset.cmd) { vscode.postMessage({ type: 'command', command: el.dataset.cmd }); return; }
          if (el.dataset.run)  { vscode.postMessage({ type: 'runProgram', id: el.dataset.run }); return; }
          if (el.dataset.open) { vscode.postMessage({ type: 'openProgram', id: el.dataset.open }); return; }
        }
        el = el.parentElement;
      }
    });
    window.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.type === 'ping') { vscode.postMessage({ type: 'pong' }); return; }
      if (m.type === 'busy' && m.busy) {
        var pill = document.getElementById('env-pill');
        if (pill) {
          pill.className = 'pill pill-wait';
          pill.innerHTML = '<span class="dot dot-spin"></span>' + (m.label ? String(m.label).replace(/</g, '&lt;') : 'Working…');
        }
      }
      /* busy=false -> the extension re-renders the whole panel HTML */
    });
  })();
</script>
</body>
</html>`;
}
/**
 * Static recovery page shown inside the webview when the panel page itself
 * could not load (service-worker race). Deliberately tiny and dependency-
 * free: it still carries the liveness pong and a Retry button, and points
 * the user at the native list view that the extension reveals beside it.
 */
function buildFallbackPanelHtml(opts) {
    const { version, nonce, cspSource, reason } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>graphics.h Runner</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
    background:#0f1115; color:#e9ebef; padding:16px 14px; }
  h1 { font-size:17px; color:#f3f5f8; }
  .card { background:rgba(255,255,255,.05); border:1px solid rgba(248,113,113,.35);
    border-radius:12px; padding:14px; margin-top:12px; }
  .card p { font-size:12px; color:#9aa1ad; line-height:1.6; }
  .card b { color:#e9ebef; }
  button { margin-top:12px; width:100%; padding:11px 14px; font-size:13px; font-weight:700;
    color:#fff; background:linear-gradient(135deg, #10b981, #059669); border:0;
    border-radius:10px; cursor:pointer; }
  .hint { font-size:11px; color:#9aa1ad; margin-top:12px; line-height:1.6; }
  .kbd { background:rgba(255,255,255,.09); border:1px solid rgba(255,255,255,.09);
    border-radius:5px; padding:1px 6px; font-size:10px; }
  .ver { font-size:10px; color:#9aa1ad; margin-top:14px; }
</style>
</head>
<body>
  <h1>graphics.h Runner</h1>
  <div class="card">
    <p><b>The panel could not load.</b></p>
    <p>${esc(reason)} Your example programs and actions are still available in the
    <b>graphics.h Programs (List)</b> view that was just opened.</p>
    <button data-cmd="graphics-h-runner.reloadPanel">Retry panel</button>
  </div>
  <p class="hint">You can also reload later from the Command Palette:
  <span class="kbd">graphics.h: Reload Panel</span>. In a .cpp file,
  <span class="kbd">Ctrl+Alt+R</span> keeps working regardless of this panel.</p>
  <p class="ver">v${esc(version)} · fallback view active</p>
<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'pong' });
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.cmd) { vscode.postMessage({ type: 'command', command: el.dataset.cmd }); return; }
        el = el.parentElement;
      }
    });
  })();
</script>
</body>
</html>`;
}
//# sourceMappingURL=panelHtml.js.map