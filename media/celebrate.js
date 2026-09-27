/* graphics.h Runner — celebration overlay controller (v1.5.6).
 *
 * Runs inside the celebration WebviewPanel. Consumes
 *   window.__GHR_CELEBRATE__ = { kind: 'confetti'|'error'|'schoolpride',
 *                                durationMs: number,
 *                                errorLines?: string[] }
 * written by celebrate.ts. The confetti library
 * (media/confetti.browser.js — catdad/canvas-confetti v1.9.4, ISC) is
 * loaded before this script.
 *
 * Effects:
 *   confetti    — the canvas-confetti README "Realistic Look" staged
 *                 burst (plus one later wave for the full-screen feel).
 *   error       — a red-ember rain across the whole screen for the
 *                 duration (5 s); the giant shaking ✗, the "COMPILE
 *                 ERROR" headline and the big compiler error headers are
 *                 DOM built by celebrate.ts (kind:'error' replaced the
 *                 old snowfall, which read as weather instead of failure).
 *   schoolpride — the canvas-confetti README "School Pride" side
 *                 cannons, exact preset, fired for the duration (5 s).
 *
 * Any click, Esc, Enter or Space dismisses the overlay early; the host
 * also auto-closes the panel after durationMs (belt and braces).
 */
(function () {
  'use strict';
  /* the page hid Worker while canvas-confetti loaded (blob:-worker CSP
   * workaround) — restore it before anything else runs */
  if (window.__GHR_WORKER__) {
    window.Worker = window.__GHR_WORKER__;
    try { delete window.__GHR_WORKER__; } catch (e) { window.__GHR_WORKER__ = undefined; }
  }
  var cfg = window.__GHR_CELEBRATE__ || {};
  var kind = cfg.kind || 'confetti';
  var durationMs = cfg.durationMs || 3000;

  var vscode = acquireVsCodeApi();
  var stopped = false;
  function stop() {
    if (stopped) { return; }
    stopped = true;
    try { vscode.postMessage({ type: 'stop' }); } catch (e) { /* host gone */ }
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { stop(); }
  });
  document.addEventListener('click', stop);

  var confetti = typeof window.confetti === 'function' ? window.confetti : null;

  if (!confetti) {
    /* Library failed to load — the host schedule still closes the panel;
     * keep the dark screen quiet until then. */
  } else if (kind === 'confetti') {
    /* canvas-confetti README — "Realistic Look" */
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
    /* a second wave a beat later keeps the whole screen alive */
    setTimeout(function () {
      if (stopped) { return; }
      confetti({ particleCount: 90, spread: 100, origin: { y: 0.6 }, scalar: 0.9 });
    }, 550);
  } else if (kind === 'error') {
    /* red-ember rain behind the big ✗ / COMPILE ERROR headline and the
     * big-font error headers (DOM built by celebrate.ts): embers spawn
     * above the top edge with slow gravity and a slight drift, in an
     * error palette — impossible to mistake for weather or success */
    var emberEnd = Date.now() + durationMs + 300;
    var emberColors = ['#ef4444', '#f87171', '#b91c1c', '#fbbf24', '#7f1d1d'];
    (function loop() {
      if (stopped) { return; }
      for (var i = 0; i < 4; i++) {
        confetti({
          particleCount: 1,
          startVelocity: 0,
          angle: 90,
          spread: 0,
          ticks: 220,
          gravity: 0.45,
          drift: (Math.random() - 0.5) * 1.2,
          scalar: 0.5 + Math.random() * 0.8,
          origin: { x: Math.random(), y: -0.05 },
          colors: emberColors
        });
      }
      if (Date.now() < emberEnd) { requestAnimationFrame(loop); }
    }());
  } else if (kind === 'schoolpride') {
    /* canvas-confetti README — "School Pride" (side cannons, 5 s) */
    var end = Date.now() + durationMs;
    var colors = ['#bb0000', '#ffffff'];
    (function frame() {
      if (stopped) { return; }
      confetti({ particleCount: 2, angle: 60, spread: 55, origin: { x: 0 }, colors: colors });
      confetti({ particleCount: 2, angle: 120, spread: 55, origin: { x: 1 }, colors: colors });
      if (Date.now() < end) { requestAnimationFrame(frame); }
    }());
  }

  /* local schedule too — the host timer is the source of truth, this
   * makes dismissal work even if the host timer was lost */
  setTimeout(stop, durationMs);
}());
