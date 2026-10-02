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
 *   2. If several pings go unanswered the HTML is re-set — re-navigating
 *      the webview clears the service-worker race in the vast majority of
 *      cases. v1.5.15: up to TWO retry renders (maxRetryRounds) before
 *      giving up — production telemetry (Sentry GRAPHICS-H-RUNNER-E) showed
 *      a real machine where one retry was not enough.
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
   * Unanswered pings tolerated (after the last retry) before falling back to
   * the tree view. Default 4 (~4s more).
   */
  pingsBeforeFallback?: number;
  /**
   * v1.5.15: how many automatic retry renders may be attempted before the
   * fallback verdict. Default 2 — one re-render is usually enough to clear
   * the service-worker race, but not always (real telemetry), so the
   * watchdog now gets a second shot (~4s later) first.
   */
  maxRetryRounds?: number;
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
    private readonly opts: Required<
      Pick<WebviewHealthOptions, 'pingIntervalMs' | 'pingsBeforeRetry' | 'pingsBeforeFallback' | 'maxRetryRounds'>
    > &
      Pick<WebviewHealthOptions, 'setTimer' | 'clearTimer'>
  ) {}

  static create(hooks: WebviewHealthHooks, options?: WebviewHealthOptions): WebviewHealth {
    const o = options || {};
    return new WebviewHealth(hooks, {
      pingIntervalMs: o.pingIntervalMs ?? 1000,
      pingsBeforeRetry: o.pingsBeforeRetry ?? 4,
      pingsBeforeFallback: o.pingsBeforeFallback ?? 4,
      maxRetryRounds: o.maxRetryRounds ?? 2,
      setTimer: o.setTimer,
      clearTimer: o.clearTimer
    });
  }

  getState(): WebviewHealthState {
    return this.state;
  }

  /** Retry renders used so far (telemetry detail for the fallback verdict). */
  getRetriesUsed(): number {
    return this.retriesUsed;
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

    /* v1.5.15: give the re-render TWO chances (maxRetryRounds) before the
     * fallback verdict — the second re-render clears the service-worker
     * race on machines where the first did not. */
    if (this.unanswered >= this.opts.pingsBeforeRetry) {
      if (this.retriesUsed < this.opts.maxRetryRounds) {
        this.retriesUsed++;
        this.unanswered = 0;
        this.hooks.onEvent?.('retry');
        this.hooks.retry(); /* re-set html -> clears the service-worker race */
        this.scheduleTick(); /* self-rearm: the machine reaches fallback on its own */
        return;
      }
      if (this.unanswered >= this.opts.pingsBeforeFallback) {
        this.state = 'fallback';
        this.stopTimer();
        this.hooks.onEvent?.('fallback');
        this.hooks.fallback();
        return;
      }
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
