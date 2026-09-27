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
    constructor(extensionRoot, version, programs, onClick, hooks = {}) {
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
     * User-facing recovery: rebuild the full panel HTML, clear any fallback
     * state and restart the liveness watchdog (command: reloadPanel).
     */
    reloadPanel() {
        this.fallbackActive = false;
        this.health?.reset();
        if (this.view) {
            this.view.webview.html = this.renderHtml();
            this.health?.start();
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
                /* re-navigating the webview clears the service-worker race */
                this.fallbackActive = false;
                view.webview.html = this.renderHtml();
                this.health?.start();
            },
            fallback: () => {
                this.fallbackActive = true;
                view.webview.html = this.renderFallbackHtml();
            }
        });
        try {
            view.webview.html = this.renderHtml();
        }
        catch {
            /* html construction itself failed — go straight to the tree fallback */
            this.fallbackActive = true;
            view.webview.html = this.renderFallbackHtml();
            this.notify('fallback');
            return;
        }
        this.health.start();
        /* v1.5.5: first panel open of the session (School Pride trigger) */
        if (!this.firstOpenNotified) {
            this.firstOpenNotified = true;
            this.notifyFirstOpen();
        }
        view.webview.onDidReceiveMessage((msg) => {
            try {
                if (msg && msg.type === 'pong') {
                    this.health?.pong();
                    return;
                }
                /* v1.5.8: cheat-sheet open/close sync from the page */
                if (msg && msg.type === 'cheat') {
                    this.cheatOpen = !!msg.open;
                    if (!this.cheatOpen && this.pendingRender) {
                        /* sheet closed — deliver the re-render that was deferred */
                        this.postState();
                    }
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
                /* resume watching — a healthy page answers the next ping in ~1s */
                if (!this.fallbackActive && this.health.getState() !== 'fallback') {
                    this.health.start();
                }
            }
            else {
                this.health.stop();
            }
            if (view.visible) {
                this.postState();
            }
        });
        view.onDidDispose(() => {
            this.health?.dispose();
            this.health = undefined;
            if (this.view === view) {
                this.view = undefined;
            }
        });
    }
    notify(ev) {
        try {
            this.hooks.onWebviewEvent?.(ev);
        }
        catch {
            /* hooks must never crash the provider */
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
        /* full re-render: the HTML is cheap to rebuild and always consistent */
        this.view.webview.html = this.fallbackActive ? this.renderFallbackHtml() : this.renderHtml();
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
}
exports.GhPanelProvider = GhPanelProvider;
GhPanelProvider.VIEW_ID = 'graphics-h-runner.programs';
//# sourceMappingURL=panelView.js.map