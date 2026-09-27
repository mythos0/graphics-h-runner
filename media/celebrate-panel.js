/* graphics.h Runner — IN-PANEL celebration controller (v1.5.6).
 *
 * Runs INSIDE the activity-bar panel webview (the graphics.h side panel),
 * unlike media/celebrate.js which runs in the full-screen overlay tab.
 * v1.5.6 routing: the panel owns the "small" celebrations —
 *
 *   confetti     — compile success: the canvas-confetti README
 *                  "Realistic Look" staged burst;
 *   schoolpride  — first panel open of the session: the README
 *                  "School Pride" side cannons for the duration.
 *
 * while the full-screen overlay tab keeps ONLY the error overlay and the
 * Fireworks Simulator (see celebrate.ts / celebrateHost.ts).
 *
 * Contract (differs deliberately from the overlay controller):
 *   - does NOT call acquireVsCodeApi() — the panel page already owns the
 *     one-and-only vscode API instance;
 *   - never captures clicks or keys — the panel stays fully usable while
 *     the particles fall (the canvas is pointer-events:none);
 *   - renders through confetti.create(canvas, { useWorker:false }) — no
 *     blob: Worker, so the strict panel CSP needs no Worker-hiding trick;
 *   - reads window.__GHR_CELEBRATE__ = { kind, durationMs } baked into the
 *     page by panelHtml.ts. The host re-delivers by re-rendering: every
 *     panel re-render while a celebration is active bakes the REMAINING
 *     time, so visibility changes and state updates replay the show
 *     instead of losing it.
 */
(function () {
  'use strict';
  var cfg = window.__GHR_CELEBRATE__;
  if (!cfg || typeof window.confetti !== 'function') { return; }
  var kind = cfg.kind === 'schoolpride' ? 'schoolpride' : 'confetti';
  var durationMs = Number(cfg.durationMs) > 0 ? Number(cfg.durationMs) : 3000;

  /* full-panel screen: fixed canvas over the whole webview viewport,
   * transparent to the pointer so buttons and cards stay clickable */
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:2147483000;';
  (document.body || document.documentElement).appendChild(canvas);

  var confetti = window.confetti.create(canvas, { resize: true, useWorker: false });
  var done = false;
  function finish() {
    if (done) { return; }
    done = true;
    if (canvas && canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
  }

  if (kind === 'confetti') {
    /* canvas-confetti README — "Realistic Look" (same preset as the overlay) */
    var defaults = { origin: { y: 0.7 } };
    function fire(particleRatio, opts) {
      confetti(Object.assign({}, defaults, opts, {
        particleCount: Math.floor(220 * particleRatio)
      }));
    }
    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
    /* a second wave a beat later keeps the whole panel alive */
    setTimeout(function () {
      if (!done) { confetti({ particleCount: 90, spread: 100, origin: { y: 0.6 }, scalar: 0.9 }); }
    }, 550);
  } else {
    /* canvas-confetti README — "School Pride" (side cannons, 5 s) */
    var end = Date.now() + durationMs;
    var colors = ['#bb0000', '#ffffff'];
    (function frame() {
      if (done) { return; }
      confetti({ particleCount: 2, angle: 60, spread: 55, origin: { x: 0 }, colors: colors });
      confetti({ particleCount: 2, angle: 120, spread: 55, origin: { x: 1 }, colors: colors });
      if (Date.now() < end) { requestAnimationFrame(frame); }
    }());
  }

  /* particles keep falling ~4 s past the last burst — keep the canvas
   * that long, then remove it so nothing stacks across re-renders */
  setTimeout(finish, durationMs + 2500);
}());
