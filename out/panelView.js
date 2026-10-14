"use strict";
/**
 * panelView.ts — WebviewViewProvider for the graphics.h activity-bar
 * panel (view id: graphics-h-runner.programs).
 *
 * Modern webpage-style panel: dark hero, live environment status, a big
 * primary action button and example program cards. All clicks flow back to
 * the extension through postMessage.
 *
 * Resilience: a liveness watchdog (webviewHealth.ts) pings the page after
 * every render. If the page never answers — the known VS Code "Could not
 * register service worker: InvalidStateError" race — the HTML is re-set once
 * to re-navigate the webview, and if it still stays dead the extension is
 * notified so it can reveal the native TreeView fallback instantly.
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
exports.GhPanelProvider = void 0;
const vscode = __importStar(require("vscode"));
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const panelHtml_1 = require("./panelHtml");
const programs_1 = require("./programs");
const webviewHealth_1 = require("./webviewHealth");
const celebrate_1 = require("./celebrate");
class GhPanelProvider {
    constructor(extensionRoot, version, programs, onClick, hooks = {}, tuning = {}) {
        this.extensionRoot = extensionRoot;
        this.version = version;
        this.programs = programs;
        this.onClick = onClick;
        this.hooks = hooks;
        this.busy = false;
        this.busyLabel = null;
        this.fallbackActive = false;
        this.fireworksRunning = false;
        this.firstOpenNotified = false;
        /* v1.5.6: the celebration currently scheduled for this panel. Delivery
         * is baked into the next render (see activeCelebration) — every
         * re-render while it is active replays the REMAINING time, so busy
         * updates and visibility changes never lose the show. */
        this.celebration = null;
        /* v1.5.8: the panel page reports while its cheat sheet is open; the
         * provider then DEFERS full re-renders (doctor/busy/celebration
         * updates) until it closes, so the sheet can never be destroyed by a
         * page swap. A boot-restore on every fresh page re-syncs this flag. */
        this.cheatOpen = false;
        this.pendingRender = false;
        /* v1.5.9: the ? action lives in the view TITLE bar now. When the page
         * has not booted yet (or is showing the recovery page) the open request
         * is parked here and delivered on the page's boot handshake. */
        this.pendingCheatOpen = false;
        /* v1.5.9: did the page script answer since the last html render? */
        this.pageAlive = false;
        /* v1.5.26: the recovery page gets its own slow liveness probe while it
         * is on screen — if it EVER answers a ping, the webview is healthy
         * again and the extension can re-render the real panel right away. */
        this.recoveryProbeTimer = undefined;
        this.recoveryAliveReported = false;
        /* v1.5.27: verdict diagnostics (GRAPHICS-H-RUNNER-11). everAlive answers
         * "did ANY page script run at all this session" — the single fact that
         * separates a hidden-view false verdict from a genuinely dead webview.
         * watchStartedAt timestamps the final continuous watch for watchMs. */
        this.aliveSinceResolve = false;
        this.watchStartedAt = 0;
        this.healthOptions = tuning.healthOptions || {};
        this.recoveryProbeIntervalMs = tuning.recoveryProbeIntervalMs ?? 5000;
    }
    setDoctorResult(res) {
        this.doctorStatus = res;
        this.postState();
    }
    setBusy(busy, label = null) {
        this.busy = busy;
        this.busyLabel = label;
        this.postBusy();
    }
    /** Reveal the panel in the activity bar (used by "openExamplesFolder" etc.). */
    async reveal() {
        await vscode.commands.executeCommand(`${GhPanelProvider.VIEW_ID}.focus`);
    }
    /**
     * v1.5.9: the "?" cheat-sheet action moved from the panel header to the
     * view TITLE bar (package.json view/title -> graphics-h-runner.cheatSheet).
     * The host now drives the sheet: reveal the view, then tell the running
     * page to toggle it. A page that has not booted yet parks the request;
     * it is delivered when the page posts its boot cheat-sync message. A
     * fallback recovery page is first swapped back to the real panel.
     */
    async openCheatSheet() {
        if (this.fallbackActive) {
            this.reloadPanel(); /* recovery page -> bring the real panel back */
        }
        try {
            await this.reveal(); /* resolves the webview on first use */
        }
        catch {
            return;
        }
        if (!this.view) {
            this.pendingCheatOpen = true;
            return;
        }
        if (this.pageAlive) {
            const open = !this.cheatOpen; /* the title-bar ? toggles like a button */
            this.cheatOpen = open;
            void this.view.webview.postMessage({ type: 'cheat', open }).then(() => undefined, () => undefined);
        }
        else {
            this.pendingCheatOpen = true; /* delivered on the boot handshake */
        }
    }
    /**
     * User-facing recovery: rebuild the full panel HTML, clear any fallback
     * state and restart the liveness watchdog (command: reloadPanel).
     */
    reloadPanel() {
        this.fallbackActive = false;
        this.stopRecoveryProbe();
        this.recoveryAliveReported = false;
        this.health?.reset();
        if (this.view) {
            this.renderAndWatch();
        }
    }
    isFallbackActive() {
        return this.fallbackActive;
    }
    /** v1.5.5: the Fireworks Simulator overlay started/stopped — re-render
     * so the festive action button shows the red Stop state while running. */
    setFireworksState(running) {
        if (this.fireworksRunning === running) {
            return;
        }
        this.fireworksRunning = running;
        this.postState();
    }
    /**
     * v1.5.6: play a timed celebration across the FULL activity panel —
     * success confetti and the School Pride welcome live here now, not in
     * the full-screen tab (which keeps only the error overlay + fireworks).
     * Delivery = the next full re-render bakes the effect into the page
     * (window.__GHR_CELEBRATE__ in panelHtml.ts + media/celebrate-panel.js);
     * the canvas is pointer-events:none so the panel stays clickable.
     */
    playCelebration(kind) {
        this.celebration = { kind, endsAt: Date.now() + celebrate_1.CELEBRATION_DURATIONS_MS[kind] };
        this.postState();
    }
    /** The active celebration for the renderer, with its remaining ms. */
    activeCelebration() {
        if (!this.celebration) {
            return undefined;
        }
        const remaining = this.celebration.endsAt - Date.now();
        if (remaining < 400) {
            /* effectively over — drop it instead of replaying a stub */
            this.celebration = null;
            return undefined;
        }
        return { kind: this.celebration.kind, durationMs: remaining };
    }
    resolveWebviewView(view) {
        this.view = view;
        this.aliveSinceResolve = false;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.extensionRoot, 'media'))]
        };
        this.health = webviewHealth_1.WebviewHealth.create({
            onEvent: (ev) => this.notify(ev),
            ping: () => {
                void view.webview
                    .postMessage({ type: 'ping' })
                    .then(() => undefined, () => undefined);
            },
            retry: () => {
                /* v1.5.27: a retry while the view is HIDDEN can never clear a
                 * service-worker race (the iframe is not even loaded) and would
                 * burn the retry budget for nothing — the visibility flip below
                 * re-renders with a fresh budget instead. Lost-event defense:
                 * pause the watch, the reveal path restarts it. */
                if (!view.visible) {
                    this.health?.stop();
                    return;
                }
                /* re-navigating the webview clears the service-worker race.
                 * watchStartedAt restarts with the page: the verdict's watchMs
                 * measures the FINAL continuous watch, not the first one. */
                this.fallbackActive = false;
                this.pageAlive = false;
                view.webview.html = this.renderHtml();
                this.watchStartedAt = Date.now();
                this.health?.start();
            },
            fallback: () => {
                this.fallbackActive = true;
                this.pageAlive = false;
                view.webview.html = this.renderFallbackHtml();
                /* v1.5.26: watch the recovery page — but only while VISIBLE;
                 * a hidden view cannot answer, and the reveal handler restarts
                 * the probe with the correct visibility (v1.5.27). */
                if (view.visible) {
                    this.startRecoveryProbe();
                }
            }
        }, this.healthOptions);
        try {
            this.renderAndWatch();
        }
        catch {
            /* html construction itself failed — go straight to the tree fallback */
            this.fallbackActive = true;
            view.webview.html = this.renderFallbackHtml();
            this.startRecoveryProbe();
            this.notify('fallback');
            return;
        }
        /* v1.5.5: first panel open of the session (School Pride trigger) */
        if (!this.firstOpenNotified) {
            this.firstOpenNotified = true;
            this.notifyFirstOpen();
        }
        view.webview.onDidReceiveMessage((msg) => {
            try {
                if (!msg || typeof msg !== 'object') {
                    return;
                }
                /* v1.5.27: ANY inbound message proves a page script RAN this session
                 * (pong, click, cheat sync, crash report) — liveness evidence for
                 * the fallback-verdict diagnostics below. */
                this.aliveSinceResolve = true;
                /* v1.5.26: the recovery page answering a PROBE ping means the
                 * service-worker race has cleared — the real panel will boot now.
                 * Reported to the extension once per fallback episode. */
                if (msg.type === 'pong' && msg.probe === true) {
                    if (this.fallbackActive && !this.recoveryAliveReported) {
                        this.recoveryAliveReported = true;
                        this.stopRecoveryProbe();
                        this.notifyRecoveryAlive();
                    }
                    return;
                }
                /* v1.5.26: ANY inbound message from the real page is proof its
                 * script executed — not just pongs. A user click on a healthy
                 * page can never be misread as a dead webview again. */
                this.pageAlive = true;
                this.health?.pong();
                if (msg.type === 'pong') {
                    return;
                }
                /* v1.5.8: cheat-sheet open/close sync from the page.
                 * v1.5.9: this message is also the boot handshake — a parked
                 * view-title "?" open request is delivered right here. */
                if (msg.type === 'cheat') {
                    this.cheatOpen = !!msg.open;
                    if (this.pendingCheatOpen) {
                        /* the title-bar ? opened the panel itself — now that the
                         * page can receive messages, open the sheet */
                        this.pendingCheatOpen = false;
                        this.cheatOpen = true;
                        void this.view?.webview.postMessage({ type: 'cheat', open: true }).then(() => undefined, () => undefined);
                        return;
                    }
                    if (!this.cheatOpen && this.pendingRender) {
                        /* sheet closed — deliver the re-render that was deferred */
                        this.postState();
                    }
                    return;
                }
                /* v1.5.26: page-side crash reports — forward to the extension for
                 * telemetry (they prove the service worker works AND explain the
                 * failure the old "no pong" events could not). */
                if (msg.type === 'script-error') {
                    this.onClick(msg);
                    return;
                }
                this.onClick(msg);
            }
            catch {
                /* never let a panel click crash the host */
            }
        });
        view.onDidChangeVisibility(() => {
            if (!this.health) {
                return;
            }
            if (view.visible) {
                /* resume watching — a healthy page answers the next ping in ~1s.
                 * v1.5.27: the watch start itself is visibility-gated inside
                 * renderAndWatch/postState below, so a view that resolved while
                 * hidden gets its FIRST fresh watch here, on the reveal. */
                if (!this.fallbackActive && this.health.getState() !== 'fallback') {
                    this.health.start();
                }
                else if (this.fallbackActive) {
                    this.startRecoveryProbe(); /* v1.5.26: keep probing the recovery page */
                }
            }
            else {
                this.health.stop();
                this.stopRecoveryProbe();
            }
            if (view.visible) {
                this.postState();
            }
        });
        view.onDidDispose(() => {
            this.health?.dispose();
            this.health = undefined;
            this.pageAlive = false;
            this.stopRecoveryProbe();
            if (this.view === view) {
                this.view = undefined;
            }
        });
    }
    notify(ev) {
        try {
            /* v1.5.27: retry + fallback verdicts carry the discriminating facts
             * so the telemetry names WHY the page never answered. */
            this.hooks.onWebviewEvent?.(ev, ev === 'retry' || ev === 'fallback' ? this.getWatchDiagnostics() : undefined);
        }
        catch {
            /* hooks must never crash the provider */
        }
    }
    /**
     * v1.5.27: the facts that discriminate WHY the page never answered.
     * Sent with every retry/fallback event (see WebviewWatchDetail).
     */
    getWatchDiagnostics() {
        let windowFocused;
        try {
            /* the tests' vscode stub has no window — best effort by design */
            windowFocused = vscode.window.state?.focused;
        }
        catch {
            windowFocused = undefined;
        }
        return {
            visible: this.view?.visible ?? false,
            windowFocused,
            retriesUsed: this.health?.getRetriesUsed() ?? 0,
            watchMs: this.watchStartedAt > 0 ? Math.max(0, Date.now() - this.watchStartedAt) : 0,
            everAlive: this.aliveSinceResolve
        };
    }
    notifyRecoveryAlive() {
        try {
            this.hooks.onRecoveryPageAlive?.();
        }
        catch {
            /* hooks must never crash the provider */
        }
    }
    /**
     * v1.5.26: ONE code path for "swap in a fresh real panel page" — every
     * full re-render (boot, reloadPanel, doctor/busy/celebration updates)
     * restarts the watchdog, because unanswered-ping counts from the old
     * page are meaningless for the new one. Without this, a doctor refresh
     * landing mid-watch carried stale counts into the new page's boot and
     * could trigger false retry renders / a false fallback verdict.
     */
    renderAndWatch() {
        if (!this.view) {
            return;
        }
        this.pageAlive = false;
        this.view.webview.html = this.renderHtml();
        this.health?.reset();
        /* v1.5.27 ROOT FIX (GRAPHICS-H-RUNNER-11): only WATCH a visible view.
         * VS Code may resolve (or re-render) a restored view while it is NOT
         * visible — a hidden view never loads its iframe, so its page script
         * can never answer a ping, and a running watchdog produced a guaranteed
         * FALSE fallback verdict (~22 s later, stealing focus to the fallback
         * lists while the user never had the panel open). The visibility flip
         * below starts a fresh watch with a full budget when the view actually
         * appears. */
        if (this.view.visible) {
            this.watchStartedAt = Date.now();
            this.health?.start();
        }
    }
    notifyFirstOpen() {
        try {
            this.hooks.onPanelFirstOpen?.();
        }
        catch {
            /* hooks must never crash the provider */
        }
    }
    currentStatus() {
        if (!this.doctorStatus) {
            return { state: 'checking', library: null, compilerOk: false, platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux', busy: this.busy, busyLabel: this.busyLabel };
        }
        return {
            state: this.doctorStatus.graphicsReady ? 'ready' : 'not-ready',
            library: this.doctorStatus.bestLibrary,
            compilerOk: this.doctorStatus.compilerCheck.ok,
            platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
            busy: this.busy,
            busyLabel: this.busyLabel
        };
    }
    postState() {
        if (!this.view) {
            return;
        }
        /* v1.5.8: while the cheat sheet is open the page must NOT be swapped
           out from under the user — park the render and deliver it when the
           sheet reports closed (see the 'cheat' message handler above). */
        if (this.cheatOpen) {
            this.pendingRender = true;
            return;
        }
        this.pendingRender = false;
        this.cheatOpen = false;
        if (this.fallbackActive) {
            /* v1.5.26: refresh the RECOVERY page without touching the watchdog
             * — the real panel is still down; the probe keeps running. */
            this.pageAlive = false;
            this.view.webview.html = this.renderFallbackHtml();
            return;
        }
        /* full re-render: the HTML is cheap to rebuild and always consistent.
         * The watchdog restarts with the fresh page (renderAndWatch). */
        this.renderAndWatch();
    }
    postBusy() {
        if (!this.view || this.fallbackActive) {
            return;
        }
        if (!this.busy) {
            this.postState(); /* clear the spinner with a fresh render */
            return;
        }
        void this.view.webview
            .postMessage({ type: 'busy', busy: true, label: this.busyLabel })
            .then(() => undefined, () => undefined);
    }
    renderHtml() {
        if (!this.view) {
            return '';
        }
        const nonce = (0, crypto_1.randomBytes)(12).toString('hex');
        /* university badge for the title row's empty top-right corner */
        const logoUri = this.view.webview
            .asWebviewUri(vscode.Uri.file(path.join(this.extensionRoot, 'media', 'diu-logo.png')))
            .toString();
        /* v1.5.6: in-panel celebration media (confetti lib + controller) */
        const mediaUri = (file) => this.view.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionRoot, 'media', file))).toString();
        return (0, panelHtml_1.buildPanelHtml)({
            logoUri,
            programs: this.programs.map((p) => ({
                id: p.id,
                title: p.title,
                description: p.description,
                emoji: p.emoji,
                filename: p.filename,
                tag: p.tag,
                lab: !!p.lab
            })),
            commands: programs_1.COMMAND_META,
            status: this.currentStatus(),
            version: this.version,
            nonce,
            cspSource: this.view.webview.cspSource,
            fireworksRunning: this.fireworksRunning,
            celebration: this.activeCelebration(),
            confettiJsUri: mediaUri('confetti.browser.js'),
            celebratePanelJsUri: mediaUri('celebrate-panel.js')
        });
    }
    renderFallbackHtml() {
        if (!this.view) {
            return '';
        }
        const nonce = (0, crypto_1.randomBytes)(12).toString('hex');
        return (0, panelHtml_1.buildFallbackPanelHtml)({
            version: this.version,
            nonce,
            cspSource: this.view.webview.cspSource,
            reason: 'The panel page failed to load in this VS Code window (service worker error).'
        });
    }
    /**
     * v1.5.26: while the recovery page is on screen, ping it slowly. If it
     * ever answers (pong probe:true), the webview itself is healthy again
     * and the extension can immediately re-render the real panel instead of
     * waiting for the next ladder slot.
     */
    startRecoveryProbe() {
        this.stopRecoveryProbe();
        if (!this.fallbackActive) {
            return;
        }
        const timers = this.probeTimers();
        const tick = () => {
            if (!this.fallbackActive || !this.view) {
                this.stopRecoveryProbe();
                return;
            }
            void this.view.webview
                .postMessage({ type: 'ping' })
                .then(() => undefined, () => undefined);
            this.recoveryProbeTimer = timers.setTimer(tick, this.recoveryProbeIntervalMs);
        };
        this.recoveryProbeTimer = timers.setTimer(tick, this.recoveryProbeIntervalMs);
    }
    stopRecoveryProbe() {
        if (this.recoveryProbeTimer !== undefined) {
            this.probeTimers().clearTimer(this.recoveryProbeTimer);
            this.recoveryProbeTimer = undefined;
        }
    }
    probeTimers() {
        return {
            setTimer: this.healthOptions.setTimer ||
                ((fn, ms) => setTimeout(fn, ms)),
            clearTimer: this.healthOptions.clearTimer ||
                ((h) => clearTimeout(h))
        };
    }
}
exports.GhPanelProvider = GhPanelProvider;
GhPanelProvider.VIEW_ID = 'graphics-h-runner.programs';
//# sourceMappingURL=panelView.js.map