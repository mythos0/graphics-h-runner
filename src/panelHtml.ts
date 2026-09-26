/**
 * panelHtml.ts — HTML/CSS for the graphics.h Runner activity-bar panel.
 *
 * The panel is styled like a modern webpage (gradient hero, glass cards,
 * emoji program grid) instead of the plain VS Code tree view. It keeps a
 * constant dark-indigo design so it looks identical in light & dark
 * themes. Pure function, unit-testable: no vscode import.
 */

import type { CommandMeta } from './programs';

export interface PanelProgramInfo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  filename: string;
  tag: string;
}

export interface PanelStatus {
  state: 'checking' | 'ready' | 'not-ready';
  library: string | null;
  compilerOk: boolean;
  platform: string;
  busy: boolean;
  busyLabel: string | null;
}

export interface PanelHtmlOptions {
  programs: PanelProgramInfo[];
  commands: CommandMeta[];
  status: PanelStatus;
  version: string;
  nonce: string;
  logoUri: string;
  cspSource: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusPill(status: PanelStatus): string {
  if (status.state === 'ready') {
    return `<span class="pill pill-ok" id="env-pill"><span class="dot"></span>Ready — ${esc(status.library || 'graphics')}</span>`;
  }
  if (status.state === 'checking') {
    return `<span class="pill pill-wait" id="env-pill"><span class="dot dot-spin"></span>Checking environment…</span>`;
  }
  return `<span class="pill pill-bad" id="env-pill"><span class="dot"></span>Not ready${status.compilerOk ? ' — no graphics library' : ' — no C++ compiler'}</span>`;
}

function envCard(status: PanelStatus): string {
  if (status.state === 'not-ready') {
    return `
    <div class="card env-card" id="env-card">
      <div class="env-main">
        <div class="env-title">⚠️ Environment needs setup</div>
        <div class="env-sub">${status.compilerOk
          ? 'A C++ compiler was found, but the graphics library is missing. One click installs WinBGIM / SDL_bgi for you.'
          : 'No working C++ compiler found. One click installs the compiler + graphics library automatically — no admin rights needed.'}</div>
      </div>
      <button class="btn btn-primary btn-lg" data-cmd="graphics-h-runner.setupEverything" id="env-cta">🚀 Complete Run Setup</button>
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

function actionButtons(commands: CommandMeta[]): string {
  return commands
    .map(
      (c) =>
        `<button class="btn${c.primary ? ' btn-primary' : ''}" data-cmd="${esc(c.commandId)}" id="${esc(c.id)}" title="${esc(c.title)}">
           <span class="btn-ico">${c.icon}</span>
           <span class="btn-body"><span class="btn-title">${esc(c.title)}</span><span class="btn-hint">${esc(c.hint)}</span></span>
         </button>`
    )
    .join('\n        ');
}

function programCards(programs: PanelProgramInfo[]): string {
  return programs
    .map(
      (p) =>
        `<div class="prog" id="prog-${esc(p.id)}">
           <div class="prog-emoji">${p.emoji}</div>
           <div class="prog-body">
             <div class="prog-title">${esc(p.title)} <span class="tag tag-${esc(p.tag)}">${esc(p.tag)}</span></div>
             <div class="prog-desc">${esc(p.description)}</div>
             <div class="prog-file">${esc(p.filename)}</div>
           </div>
           <div class="prog-actions">
             <button class="mini-btn mini-run" data-run="${esc(p.id)}" title="Open + compile + run">▶ Run</button>
             <button class="mini-btn" data-open="${esc(p.id)}" title="Open the source code">Open</button>
           </div>
         </div>`
    )
    .join('\n        ');
}

export function buildPanelHtml(opts: PanelHtmlOptions): string {
  const { programs, commands, status, version, nonce, logoUri, cspSource } = opts;
  const platformName =
    status.platform === 'windows' ? 'Windows · WinBGIM' : status.platform === 'macos' ? 'macOS · SDL_bgi' : 'Linux · SDL_bgi';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>graphics.h Runner</title>
<style>
  :root {
    --bg1:#171538; --bg2:#241d54; --bg3:#0f1e3d;
    --card:rgba(255,255,255,.055); --card-line:rgba(255,255,255,.11);
    --txt:#eef0ff; --txt-dim:#a7acdb;
    --acc1:#7c5cff; --acc2:#22d3ee;
    --ok:#34d399; --bad:#fb7185; --wait:#fbbf24;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
    background:
      radial-gradient(900px 420px at 85% -80px, rgba(124,92,255,.28), transparent 60%),
      radial-gradient(700px 380px at -60px 30%, rgba(34,211,238,.16), transparent 55%),
      linear-gradient(160deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%);
    color:var(--txt); padding:14px 12px 20px;
  }
  .hero { text-align:center; padding:10px 6px 16px; }
  .hero img { width:46px; height:46px; border-radius:12px; box-shadow:0 4px 18px rgba(124,92,255,.45); vertical-align:middle; }
  .hero h1 { font-size:19px; letter-spacing:.4px; margin-top:8px;
    background:linear-gradient(90deg,#c7d2fe,#8de9ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .hero .by { font-size:11px; color:var(--txt-dim); margin-top:3px; }
  .pill { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600;
    padding:5px 13px; border-radius:999px; margin-top:10px; border:1px solid; }
  .pill-ok   { color:var(--ok);   border-color:rgba(52,211,153,.4);  background:rgba(52,211,153,.1); }
  .pill-bad  { color:var(--bad);  border-color:rgba(251,113,133,.4); background:rgba(251,113,133,.1); }
  .pill-wait { color:var(--wait); border-color:rgba(251,191,36,.4);  background:rgba(251,191,36,.1); }
  .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  .dot-spin { animation:pulse 1s infinite alternate; }
  @keyframes pulse { from {opacity:.35} to {opacity:1} }

  .card { background:var(--card); border:1px solid var(--card-line); border-radius:14px; padding:13px; margin-top:12px; }
  .env-card { display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-color:rgba(251,113,133,.35); }
  .env-card.env-ok { border-color:rgba(52,211,153,.35); }
  .env-main { flex:1 1 180px; }
  .env-title { font-size:13.5px; font-weight:700; }
  .env-sub { font-size:11.5px; color:var(--txt-dim); margin-top:4px; line-height:1.45; }

  .btn { display:flex; align-items:center; gap:10px; width:100%; text-align:left;
    background:var(--card); border:1px solid var(--card-line); color:var(--txt);
    border-radius:11px; padding:9px 11px; cursor:pointer; transition:.15s; }
  .btn:hover { background:rgba(255,255,255,.1); border-color:rgba(124,92,255,.55); transform:translateY(-1px); }
  .btn:active { transform:translateY(0); }
  .btn-ico { font-size:15px; width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.07); border-radius:8px; }
  .btn-body { display:flex; flex-direction:column; }
  .btn-title { font-size:12.5px; font-weight:600; }
  .btn-hint { font-size:10.5px; color:var(--txt-dim); }
  .btn-primary { background:linear-gradient(135deg, var(--acc1), #5b8def); border-color:transparent; }
  .btn-primary:hover { background:linear-gradient(135deg,#8f73ff,#6b9bff); }
  .btn-primary .btn-hint { color:rgba(255,255,255,.75); }
  .btn-lg { width:auto; padding:10px 16px; font-size:13px; font-weight:700; border-radius:11px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }

  .sec { display:flex; align-items:baseline; justify-content:space-between; margin:18px 2px 9px; }
  .sec h2 { font-size:11px; text-transform:uppercase; letter-spacing:1.6px; color:var(--txt-dim); font-weight:700; }
  .sec .count { font-size:10.5px; color:var(--txt-dim); }

  .prog { display:flex; gap:10px; align-items:center; background:var(--card);
    border:1px solid var(--card-line); border-radius:12px; padding:9px 10px; margin-bottom:8px; transition:.15s; }
  .prog:hover { border-color:rgba(34,211,238,.5); background:rgba(255,255,255,.085); transform:translateY(-1px); }
  .prog-emoji { font-size:21px; width:38px; height:38px; flex:0 0 38px; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(145deg, rgba(124,92,255,.25), rgba(34,211,238,.18)); border-radius:10px; }
  .prog-body { flex:1; min-width:0; }
  .prog-title { font-size:12.5px; font-weight:650; }
  .prog-desc { font-size:10.8px; color:var(--txt-dim); margin-top:2px; }
  .prog-file { font-size:9.5px; color:rgba(167,172,219,.6); margin-top:3px; font-family:Consolas, monospace; }
  .tag { font-size:8.5px; text-transform:uppercase; letter-spacing:.8px; padding:1.5px 7px; border-radius:999px; vertical-align:2px; }
  .tag-fun { background:rgba(124,92,255,.25); color:#c4b5fd; }
  .tag-classic { background:rgba(34,211,238,.2); color:#7dd3fc; }
  .tag-math { background:rgba(52,211,153,.2); color:#6ee7b7; }
  .tag-interactive { background:rgba(251,191,36,.2); color:#fcd34d; }
  .prog-actions { display:flex; flex-direction:column; gap:5px; }
  .mini-btn { font-size:11px; font-weight:600; color:var(--txt); background:rgba(255,255,255,.08);
    border:1px solid var(--card-line); border-radius:8px; padding:4px 10px; cursor:pointer; transition:.15s; white-space:nowrap; }
  .mini-btn:hover { background:rgba(255,255,255,.14); }
  .mini-run { background:linear-gradient(135deg, var(--acc1), #4f7cff); border-color:transparent; }
  .mini-run:hover { background:linear-gradient(135deg,#8f73ff,#6b9bff); }

  .foot { text-align:center; font-size:10.5px; color:var(--txt-dim); margin-top:16px; line-height:1.7; }
  .foot b { color:var(--txt); }
  .kbd { background:rgba(255,255,255,.09); border:1px solid var(--card-line); border-radius:5px; padding:1px 6px; font-size:10px; }
  .chip { display:inline-block; font-size:10px; color:var(--txt-dim); border:1px solid var(--card-line); border-radius:999px; padding:2px 10px; margin:0 3px; }

  /* narrow activity-bar sidebar: stack actions, move card buttons inline */
  @media (max-width: 360px) {
    body { padding:10px 9px 16px; }
    .grid2 { grid-template-columns:1fr; }
    .prog { flex-wrap:wrap; }
    .prog-body { flex:1 1 calc(100% - 110px); }
    .prog-actions { flex-direction:row; width:100%; justify-content:flex-end; }
  }
</style>
</head>
<body>
  <div class="hero">
    <img src="${logoUri}" alt="logo">
    <h1>graphics.h Runner</h1>
    <div class="by">made by Department of CSE, Dhaka International University, Bangladesh</div>
    ${statusPill(status)}
    <div style="margin-top:9px"><span class="chip">${platformName}</span><span class="chip">v${esc(version)}</span></div>
  </div>

  ${envCard(status)}

  <div class="sec"><h2>Actions</h2></div>
  <div class="grid2">
        ${actionButtons(commands)}
  </div>

  <div class="sec"><h2>Example Programs</h2><span class="count">${programs.length} programs · click Run or Open</span></div>
  <div id="programs">
        ${programCards(programs)}
  </div>

  <div class="foot">
    Inside a .cpp file just press <span class="kbd">Ctrl+Alt+R</span> (or F5 → “Run graphics.h program”).<br>
    <b>made with 💜 by DIU CSE</b> · errors are reported automatically (VS Code telemetry setting respected)
  </div>

<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
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
