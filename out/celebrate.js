"use strict";
/**
 * celebrate.ts — full-screen celebration overlays (v1.5.6), PURE builders.
 *
 * A dedicated WebviewPanel takes over the editor area (the closest thing
 * VS Code offers to "full VS Code screen") and plays a canvas effect:
 *
 *   confetti     — canvas-confetti "Realistic Look" burst on every
 *                  successful compilation (vendored: catdad/canvas-confetti
 *                  v1.9.4, ISC license — media/confetti.browser.js).
 *   error        — a relatable COMPILE-ERROR overlay when a build stops on
 *                  errors: a giant shaking ✗, the actual compiler error
 *                  headers in big type, and a red-ember rain. Replaces the
 *                  old snowfall (v1.5.5) that looked like weather, not like
 *                  a failure.
 *   schoolpride  — canvas-confetti "School Pride" side cannons for 5 s,
 *                  fired once per session the first time the activity-bar
 *                  panel opens (every fresh desktop / window start).
 *   fireworks    — the full Fireworks Simulator show (vendored verbatim:
 *                  media/fireworks/* — MIT, (c) 2023 Troy, simulation
 *                  originally by Caleb Miller / cmiller.tech). Stays open
 *                  until the user stops it.
 *
 * This module has NO vscode import so celebrate-tests.js can assert CSP
 * safety, payloads and durations in plain node. The VS Code side of the
 * overlay lives in celebrateHost.ts.
 *
 * Security model (matches the panel): `default-src 'none'`, scripts only
 * via nonce + the webview's own cspSource (all media is bundled — zero
 * remote requests), styles inline + bundled css, no eval anywhere in the
 * vendored engines (checked by celebrate-tests.js).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CELEBRATION_VIEW_TYPE = exports.CELEBRATION_DURATIONS_MS = void 0;
exports.celebrationTitle = celebrationTitle;
exports.celebrationMediaPaths = celebrationMediaPaths;
exports.buildCelebrationHtml = buildCelebrationHtml;
exports.buildFireworksHtml = buildFireworksHtml;
const path = __importStar(require("path"));
/** How long each timed overlay stays open (fireworks runs until stopped). */
exports.CELEBRATION_DURATIONS_MS = {
    confetti: 3200,
    error: 5000,
    schoolpride: 5000
};
exports.CELEBRATION_VIEW_TYPE = 'graphicsHRunnerCelebration';
/** Window titles for the overlay panel. */
function celebrationTitle(kind) {
    switch (kind) {
        case 'confetti':
            return 'graphics.h — 🎉 Compiled OK';
        case 'error':
            return 'graphics.h — ✗ Compile error';
        case 'schoolpride':
            return 'graphics.h — 🎒 School Pride';
        case 'fireworks':
            return 'Fireworks Simulator — Stop from the button or Esc';
    }
}
/** All bundled media the overlays need (existence is unit-tested). */
function celebrationMediaPaths(extensionRoot) {
    const m = (...p) => path.join(extensionRoot, 'media', ...p);
    return {
        confettiJs: m('confetti.browser.js'),
        celebrateJs: m('celebrate.js'),
        fireworksCss: m('fireworks', 'fireworks.css'),
        fscreenJs: m('fireworks', 'fscreen.js'),
        myMathJs: m('fireworks', 'MyMath.js'),
        stageJs: m('fireworks', 'Stage.js'),
        scriptJs: m('fireworks', 'script.js')
    };
}
function esc(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** JSON safe for embedding in a <script> block (no </script>, <, U+2028…). */
function jsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
const CELEBRATION_CSS = `
  html, body { height:100%; margin:0; }
  body { background:#05070b; overflow:hidden; cursor:pointer;
    font-family:'Segoe UI', system-ui, -apple-system, sans-serif; }
  .cap { position:fixed; right:14px; bottom:12px; z-index:0;
    font-size:12px; font-weight:600; color:rgba(255,255,255,.55);
    letter-spacing:.3px; user-select:none; pointer-events:none; }

  /* ---- v1.5.6 error overlay: giant ✗ + shake + big error headers ---- */
  .err-stage { position:fixed; inset:0; z-index:2; display:flex;
    flex-direction:column; align-items:center; justify-content:center;
    gap:10px; padding:4vh 5vw; box-sizing:border-box; pointer-events:none;
    animation: err-vignette 2.2s ease-in-out infinite; }
  @keyframes err-vignette {
    0%, 100% { box-shadow: inset 0 0 18vmin rgba(190,18,18,.28); }
    50%      { box-shadow: inset 0 0 26vmin rgba(190,18,18,.55); }
  }
  .err-x { font: 900 22vmin/0.9 'Segoe UI', system-ui, sans-serif;
    color:#ef4444; text-shadow: 0 0 4vmin rgba(239,68,68,.55),
      0 6px 0 rgba(0,0,0,.35); user-select:none;
    animation: err-shake 0.55s cubic-bezier(.36,.07,.19,.97) both,
      err-pulse 1.6s ease-in-out .6s infinite; }
  @keyframes err-shake {
    10%, 90% { transform: translateX(-2px); }
    20%, 80% { transform: translateX(4px); }
    30%, 50%, 70% { transform: translateX(-7px); }
    40%, 60% { transform: translateX(7px); }
  }
  @keyframes err-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .82; }
  }
  .err-title { font-size: clamp(26px, 5vw, 44px); font-weight: 800;
    letter-spacing: 4px; color:#fecaca; text-transform: uppercase;
    user-select:none; text-align:center; }
  .err-lines { display:flex; flex-direction:column; gap:8px;
    max-width: 88vw; margin-top: 8px; }
  .err-line { font-family: Consolas, 'Courier New', monospace;
    font-size: clamp(17px, 2.6vw, 26px); font-weight: 600; line-height: 1.45;
    color:#fecaca; background: rgba(127,29,29,.42);
    border: 1px solid rgba(248,113,113,.35); border-left: 5px solid #ef4444;
    border-radius: 8px; padding: 10px 16px; overflow-wrap: anywhere;
    text-align: left; user-select: text; }
  .err-hint { margin-top: 10px; font-size: 14px; color: rgba(255,255,255,.6);
    user-select:none; }
`;
/**
 * Timed celebration page: confetti / error / school pride. The canvas-
 * confetti library renders onto its own fixed full-window canvas; any
 * click, Esc or the schedule closes the panel from the host side.
 * The error kind additionally renders the compiler's error headers as
 * DOM in big type (escaped; they travel via JSON, never raw HTML).
 */
function buildCelebrationHtml(opts) {
    const { kind, nonce, cspSource, confettiJsUri, celebrateJsUri, durationMs } = opts;
    const caption = kind === 'confetti'
        ? '🎉 Compiled OK — confetti!'
        : kind === 'error'
            ? '✗ Compile error — fix and press Ctrl+Alt+R again'
            : '🎒 Welcome! The graphics.h panel is ready';
    const errorLines = (opts.errorLines || []).slice(0, 4);
    const cfg = { kind, durationMs, errorLines };
    const errDom = kind === 'error'
        ? `
  <div class="err-stage" aria-live="assertive">
    <div class="err-x">✗</div>
    <div class="err-title">Compile error</div>
    <div class="err-lines">${errorLines.length
            ? errorLines.map((l) => `<div class="err-line">${esc(l)}</div>`).join('\n')
            : '<div class="err-line">The compiler reported errors — open the graphics.h Runner output for details.</div>'}</div>
    <div class="err-hint">click or Esc to dismiss</div>
  </div>`
        : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
<title>${esc(celebrationTitle(kind))}</title>
<style>${CELEBRATION_CSS}</style>
</head>
<body>
  <div class="cap">${esc(caption)} · click or Esc to dismiss</div>${errDom}
  <script nonce="${nonce}">window.__GHR_WORKER__ = window.Worker; window.Worker = undefined;</script>
  <script nonce="${nonce}" src="${esc(confettiJsUri)}"></script>
  <script nonce="${nonce}">window.__GHR_CELEBRATE__ = ${jsonForScript(cfg)};</script>
  <script nonce="${nonce}" src="${esc(celebrateJsUri)}"></script>
  <!-- Worker note: the first inline script HIDES Worker while canvas-confetti
       loads. v1.9.x renders through a blob:-URL Worker + OffscreenCanvas when
       Worker support is visible, and the strict webview CSP blocks blob:
       workers — the transferred canvas would stay blank forever. With Worker
       hidden the library uses its main-thread renderer; media/celebrate.js
       restores Worker first thing. -->
</body>
</html>`;
}
/**
 * Fireworks Simulator page. The DOM skeleton mirrors the upstream
 * index.html contract EXACTLY (the vendored script.js queries every
 * selector at load time and would throw on a missing node): the hidden
 * SVG sprite, loading-init, stage-container with both canvases, the
 * three control buttons with their <use> icons, the full settings menu
 * (all labels/selects/checkboxes present) and the help modal. Our chrome
 * adds the Stop button (top-right) and Esc handling.
 */
function buildFireworksHtml(opts) {
    const { nonce, cspSource, cssUri, fscreenJsUri, myMathJsUri, stageJsUri, scriptJsUri } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};">
<title>Fireworks Simulator</title>
<link rel="stylesheet" href="${esc(cssUri)}">
<style>
  #ghr-stop { position:fixed; top:14px; right:14px; z-index:60;
    display:inline-flex; align-items:center; gap:8px;
    font:700 13px 'Segoe UI', system-ui, sans-serif; color:#fff;
    background:linear-gradient(135deg, #ef4444, #b91c1c);
    border:1px solid rgba(255,255,255,.25); border-radius:999px;
    padding:9px 18px; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,.5); }
  #ghr-stop:hover { background:linear-gradient(135deg, #f87171, #dc2626); }
  .ghr-credit { position:fixed; left:12px; bottom:10px; z-index:60;
    font-size:10.5px; color:rgba(255,255,255,.4); user-select:none; pointer-events:none; }
</style>
</head>
<body>
<div style="height: 0; width: 0; position: absolute; visibility: hidden;">
    <svg xmlns="http://www.w3.org/2000/svg">
        <symbol id="icon-play" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
        </symbol>
        <symbol id="icon-pause" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </symbol>
        <symbol id="icon-close" viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </symbol>
        <symbol id="icon-settings" viewBox="0 0 24 24">
            <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22-.07.49.12.64l-2.11 1.65z"/>
        </symbol>
        <symbol id="icon-sound-on" viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </symbol>
        <symbol id="icon-sound-off" viewBox="0 0 24 24">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
        </symbol>
    </svg>
</div>
<div class="container">
    <div class="loading-init">
        <div class="loading-init__header">Loading</div>
        <div class="loading-init__status">Loading fireworks…</div>
    </div>
    <div class="stage-container remove">
        <div class="canvas-container">
            <canvas id="trails-canvas"></canvas>
            <canvas id="main-canvas"></canvas>
        </div>
        <div class="controls">
            <div class="btn pause-btn">
                <svg fill="white" width="24" height="24"><use href="#icon-pause" xlink:href="#icon-pause"></use></svg>
            </div>
            <div class="btn sound-btn">
                <svg fill="white" width="24" height="24"><use href="#icon-sound-off" xlink:href="#icon-sound-off"></use></svg>
            </div>
            <div class="btn settings-btn">
                <svg fill="white" width="24" height="24"><use href="#icon-settings" xlink:href="#icon-settings"></use></svg>
            </div>
        </div>
        <div class="menu hide">
            <div class="menu__inner-wrap">
                <div class="btn btn--bright close-menu-btn">
                    <svg fill="white" width="24" height="24"><use href="#icon-close" xlink:href="#icon-close"></use></svg>
                </div>
                <div class="menu__header">Settings</div>
                <div class="menu__subheader">Tap a setting name to learn more about it.</div>
                <form>
                    <div class="form-option form-option--select">
                        <label class="shell-type-label">Shell type</label>
                        <select class="shell-type"></select>
                    </div>
                    <div class="form-option form-option--select">
                        <label class="shell-size-label">Shell size</label>
                        <select class="shell-size"></select>
                    </div>
                    <div class="form-option form-option--select">
                        <label class="quality-ui-label">Quality</label>
                        <select class="quality-ui"></select>
                    </div>
                    <div class="form-option form-option--select">
                        <label class="sky-lighting-label">Sky lighting</label>
                        <select class="sky-lighting"></select>
                    </div>
                    <div class="form-option form-option--select">
                        <label class="scaleFactor-label">Scale factor</label>
                        <select class="scaleFactor"></select>
                    </div>
                    <div class="form-option form-option--checkbox">
                        <label class="auto-launch-label">Auto launch</label>
                        <input class="auto-launch" type="checkbox" />
                    </div>
                    <div class="form-option form-option--checkbox form-option--finale-mode">
                        <label class="finale-mode-label">Finale mode</label>
                        <input class="finale-mode" type="checkbox" />
                    </div>
                    <div class="form-option form-option--checkbox">
                        <label class="hide-controls-label">Hide controls</label>
                        <input class="hide-controls" type="checkbox" />
                    </div>
                    <div class="form-option form-option--checkbox form-option--fullscreen">
                        <label class="fullscreen-label">Fullscreen</label>
                        <input class="fullscreen" type="checkbox" />
                    </div>
                    <div class="form-option form-option--checkbox">
                        <label class="long-exposure-label">Long exposure</label>
                        <input class="long-exposure" type="checkbox" />
                    </div>
                </form>
                <div class="credits">
                    Fireworks simulation by <a href="https://cmiller.tech" target="_blank">Caleb Miller</a>.<br>
                    MIT — vendored from <a href="https://github.com/troyxun/fireworks-simulator" target="_blank">troyxun/fireworks-simulator</a>.
                </div>
            </div>
        </div>
    </div>
    <div class="help-modal">
        <div class="help-modal__overlay"></div>
        <div class="help-modal__dialog">
            <div class="help-modal__header"></div>
            <div class="help-modal__body"></div>
            <button type="button" class="help-modal__close-btn">Close</button>
        </div>
    </div>
</div>
<button id="ghr-stop" title="Stop the show (Esc)">⏹ Stop</button>
<div class="ghr-credit">Fireworks Simulator · MIT · Caleb Miller (cmiller.tech) · troyxun/fireworks-simulator</div>
<script nonce="${nonce}" src="${esc(fscreenJsUri)}"></script>
<script nonce="${nonce}" src="${esc(stageJsUri)}"></script>
<script nonce="${nonce}" src="${esc(myMathJsUri)}"></script>
<script nonce="${nonce}" src="${esc(scriptJsUri)}"></script>
<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
    var stopped = false;
    function stop() {
      if (stopped) { return; }
      stopped = true;
      try { vscode.postMessage({ type: 'stop' }); } catch (e) { /* host already gone */ }
    }
    var btn = document.getElementById('ghr-stop');
    if (btn) {
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); stop(); });
      btn.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    }
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { stop(); } });
  })();
</script>
</body>
</html>`;
}
//# sourceMappingURL=celebrate.js.map