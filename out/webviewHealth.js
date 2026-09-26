"use strict";
/**
 * webviewHealth.ts — liveness watchdog for the graphics.h webview panel.
 *
 * VS Code webviews occasionally fail to load with
 *   "Could not register service worker: InvalidStateError"
 * (a renderer-side race the extension cannot prevent). When it happens the
 * page — including its scripts — never runs, so the panel looks permanently
 * dead. Recovery strategy:
 *
 *   1. After every render the extension "pings" the webview on a timer; a
 *      healthy page answers with a pong as soon as its script executes.
 *   2. If several pings go unanswered the HTML is re-set once — re-navigating
 *      the webview clears the service-worker race in the vast majority of
 *      cases.
 *   3. If pings still go unanswered the provider raises `fallback()` and the
 *      extension instantly reveals a native TreeView copy of the panel so
 *      the user is never blocked.
 *
 * Pure state machine: timers are injectable, so the whole lifecycle is unit
 * testable without VS Code or real clocks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebviewHealth = void 0;
class WebviewHealth {
    constructor(hooks, opts) {
        this.hooks = hooks;
        this.opts = opts;
        this.state = 'idle';
        this.unanswered = 0;
        this.retriesUsed = 0;
    }
    static create(hooks, options) {
        const o = options || {};
        return new WebviewHealth(hooks, {
            pingIntervalMs: o.pingIntervalMs ?? 1000,
            pingsBeforeRetry: o.pingsBeforeRetry ?? 4,
            pingsBeforeFallback: o.pingsBeforeFallback ?? 4,
            setTimer: o.setTimer,
            clearTimer: o.clearTimer
        });
    }
    getState() {
        return this.state;
    }
    /** Begin (or re-begin) watching a freshly rendered webview. */
    start() {
        if (this.state === 'fallback') {
            return; /* a dead webview never resurrects itself — reloadPanel() resets */
        }
        this.stopTimer();
        this.state = 'watching';
        this.unanswered = 0;
        this.scheduleTick();
    }
    /** The webview script answered — the panel is healthy. */
    pong() {
        if (this.state !== 'watching') {
            return; /* late pongs from a previous render are ignored */
        }
        this.state = 'alive';
        this.stopTimer();
        this.hooks.onEvent?.('alive');
    }
    /** Pause watching (webview hidden or disposed) without changing state. */
    stop() {
        this.stopTimer();
        if (this.state === 'watching') {
            this.state = 'idle';
        }
    }
    /** Reset the retry budget (user-triggered reloadPanel). */
    reset() {
        this.retriesUsed = 0;
        this.unanswered = 0;
        this.stopTimer();
        this.state = 'idle';
    }
    dispose() {
        this.stopTimer();
        this.state = 'idle';
    }
    scheduleTick() {
        this.stopTimer();
        this.timer = this.timers().setTimer(() => this.tick(), this.opts.pingIntervalMs);
    }
    tick() {
        if (this.state !== 'watching') {
            return;
        }
        this.hooks.ping();
        this.unanswered++;
        if (this.retriesUsed === 0 && this.unanswered >= this.opts.pingsBeforeRetry) {
            this.retriesUsed++;
            this.unanswered = 0;
            this.hooks.onEvent?.('retry');
            this.hooks.retry(); /* re-set html -> clears the service-worker race */
            this.scheduleTick(); /* self-rearm: the machine reaches fallback on its own */
            return;
        }
        if (this.retriesUsed > 0 && this.unanswered >= this.opts.pingsBeforeFallback) {
            this.state = 'fallback';
            this.stopTimer();
            this.hooks.onEvent?.('fallback');
            this.hooks.fallback();
            return;
        }
        this.scheduleTick();
    }
    stopTimer() {
        if (this.timer !== undefined) {
            this.timers().clearTimer(this.timer);
            this.timer = undefined;
        }
    }
    timers() {
        return {
            setTimer: this.opts.setTimer || ((fn, ms) => setTimeout(fn, ms)),
            clearTimer: this.opts.clearTimer || ((h) => clearTimeout(h))
        };
    }
}
exports.WebviewHealth = WebviewHealth;
//# sourceMappingURL=webviewHealth.js.map