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

export type WebviewHealthState = 'idle' | 'watching' | 'alive' | 'fallback';

export type WebviewEvent = 'alive' | 'retry' | 'fallback';

export interface WebviewHealthHooks {
  /** Deliver a ping into the webview (postMessage). */
  ping(): void;
  /** Force a re-render of the webview HTML (clears the service-worker race). */
  retry(): void;
  /** The webview is unrecoverable — switch to the TreeView fallback. */
  fallback(): void;
  /** Optional observer for every lifecycle event (telemetry / context keys). */
  onEvent?(ev: WebviewEvent): void;
}

export interface WebviewHealthOptions {
  /** Milliseconds between pings. Default 1000. */
  pingIntervalMs?: number;
  /** Unanswered pings tolerated before one retry render. Default 4 (~4s). */
  pingsBeforeRetry?: number;
  /**
   * Unanswered pings tolerated (after the retry) before falling back to the
   * tree view. Default 4 (~4s more).
   */
  pingsBeforeFallback?: number;
  /** Timer injection (tests). Defaults to the global setTimeout/clearTimeout. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export class WebviewHealth {
  private state: WebviewHealthState = 'idle';
  private timer: unknown;
  private unanswered = 0;
  private retriesUsed = 0;

  constructor(
    private readonly hooks: WebviewHealthHooks,
    private readonly opts: Required<Pick<WebviewHealthOptions, 'pingIntervalMs' | 'pingsBeforeRetry' | 'pingsBeforeFallback'>> &
      Pick<WebviewHealthOptions, 'setTimer' | 'clearTimer'>
  ) {}

  static create(hooks: WebviewHealthHooks, options?: WebviewHealthOptions): WebviewHealth {
    const o = options || {};
    return new WebviewHealth(hooks, {
      pingIntervalMs: o.pingIntervalMs ?? 1000,
      pingsBeforeRetry: o.pingsBeforeRetry ?? 4,
      pingsBeforeFallback: o.pingsBeforeFallback ?? 4,
      setTimer: o.setTimer,
      clearTimer: o.clearTimer
    });
  }

  getState(): WebviewHealthState {
    return this.state;
  }

  /** Begin (or re-begin) watching a freshly rendered webview. */
  start(): void {
    if (this.state === 'fallback') {
      return; /* a dead webview never resurrects itself — reloadPanel() resets */
    }
    this.stopTimer();
    this.state = 'watching';
    this.unanswered = 0;
    this.scheduleTick();
  }

  /** The webview script answered — the panel is healthy. */
  pong(): void {
    if (this.state !== 'watching') {
      return; /* late pongs from a previous render are ignored */
    }
    this.state = 'alive';
    this.stopTimer();
    this.hooks.onEvent?.('alive');
  }

  /** Pause watching (webview hidden or disposed) without changing state. */
  stop(): void {
    this.stopTimer();
    if (this.state === 'watching') {
      this.state = 'idle';
    }
  }

  /** Reset the retry budget (user-triggered reloadPanel). */
  reset(): void {
    this.retriesUsed = 0;
    this.unanswered = 0;
    this.stopTimer();
    this.state = 'idle';
  }

  dispose(): void {
    this.stopTimer();
    this.state = 'idle';
  }

  private scheduleTick(): void {
    this.stopTimer();
    this.timer = this.timers().setTimer(() => this.tick(), this.opts.pingIntervalMs);
  }

  private tick(): void {
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

  private stopTimer(): void {
    if (this.timer !== undefined) {
      this.timers().clearTimer(this.timer);
      this.timer = undefined;
    }
  }

  private timers(): { setTimer: NonNullable<WebviewHealthOptions['setTimer']>; clearTimer: NonNullable<WebviewHealthOptions['clearTimer']> } {
    return {
      setTimer: this.opts.setTimer || ((fn: () => void, ms: number) => setTimeout(fn, ms)),
      clearTimer: this.opts.clearTimer || ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    };
  }
}
