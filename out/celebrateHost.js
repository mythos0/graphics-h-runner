"use strict";
/**
 * celebrateHost.ts — the VS Code side of the celebration overlays (v1.5.5).
 *
 * Celebrator owns ONE WebviewPanel at a time (the "full VS Code screen"
 * overlay in the editor area). It:
 *   - shows confetti / snow / school pride for their scheduled duration
 *     and closes itself;
 *   - shows the Fireworks Simulator and stays open until the user stops
 *     (overlay Stop button, Esc, the activity-bar button, the panel
 *     action button, or closing the tab);
 *   - reports every start/stop through hooks.onStateChange so the host
 *     can drive the `graphics-h-runner.fireworksRunning` context key and
 *     re-render the panel action button as Stop/Start;
 *   - never throws into the caller: every entry point swallows and logs
 *     (a celebration must never break a compile).
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
exports.Celebrator = void 0;
const vscode = __importStar(require("vscode"));
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const celebrate_1 = require("./celebrate");
class Celebrator {
    constructor(extensionRoot, hooks = {}) {
        this.extensionRoot = extensionRoot;
        this.hooks = hooks;
    }
    /** The kind currently on screen, if any. */
    get running() {
        return this.current;
    }
    /**
     * Show an overlay. Any overlay already on screen is replaced. Timed
     * kinds auto-close after their scheduled duration (explicit durationMs
     * overrides it — used by tests); fireworks stays until stopped.
     */
    show(kind, durationMs) {
        this.close();
        if (durationMs === undefined && kind !== 'fireworks') {
            durationMs = celebrate_1.CELEBRATION_DURATIONS_MS[kind];
        }
        let panel;
        try {
            panel = vscode.window.createWebviewPanel(celebrate_1.CELEBRATION_VIEW_TYPE, (0, celebrate_1.celebrationTitle)(kind), { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.extensionRoot, 'media'))]
            });
        }
        catch (e) {
            this.hooks.onLog?.('[celebrate] could not open the overlay: ' + String(e));
            return;
        }
        const nonce = (0, crypto_1.randomBytes)(12).toString('hex');
        const cspSource = panel.webview.cspSource;
        const media = (0, celebrate_1.celebrationMediaPaths)(this.extensionRoot);
        const uri = (fsPath) => panel.webview.asWebviewUri(vscode.Uri.file(fsPath)).toString();
        try {
            panel.webview.html =
                kind === 'fireworks'
                    ? (0, celebrate_1.buildFireworksHtml)({
                        nonce,
                        cspSource,
                        cssUri: uri(media.fireworksCss),
                        fscreenJsUri: uri(media.fscreenJs),
                        myMathJsUri: uri(media.myMathJs),
                        stageJsUri: uri(media.stageJs),
                        scriptJsUri: uri(media.scriptJs)
                    })
                    : (0, celebrate_1.buildCelebrationHtml)({
                        kind: kind,
                        nonce,
                        cspSource,
                        confettiJsUri: uri(media.confettiJs),
                        celebrateJsUri: uri(media.celebrateJs),
                        durationMs: durationMs || 0
                    });
        }
        catch (e) {
            this.hooks.onLog?.('[celebrate] failed to build the overlay html: ' + String(e));
            panel.dispose();
            return;
        }
        panel.webview.onDidReceiveMessage((msg) => {
            if (msg && msg.type === 'stop') {
                this.stop();
            }
        });
        panel.onDidDispose(() => {
            if (this.autoClose) {
                clearTimeout(this.autoClose);
                this.autoClose = undefined;
            }
            if (this.panel === panel) {
                this.panel = undefined;
            }
            if (this.current === kind) {
                this.current = undefined;
                this.hooks.onStateChange?.(undefined);
            }
        });
        this.panel = panel;
        this.current = kind;
        if (durationMs && durationMs > 0) {
            this.autoClose = setTimeout(() => this.stop(), durationMs);
        }
        this.hooks.onStateChange?.(kind);
        this.hooks.onLog?.('[celebrate] ' + kind + (durationMs && durationMs > 0 ? ' (' + durationMs + ' ms)' : ' (until stopped)'));
    }
    /** Stop whatever is on screen (idempotent, safe when nothing runs). */
    stop() {
        this.close();
    }
    dispose() {
        this.close();
    }
    /** Single teardown path: clear the timer, dispose the panel; the
     * panel's onDidDispose performs the state notification. */
    close() {
        if (this.autoClose) {
            clearTimeout(this.autoClose);
            this.autoClose = undefined;
        }
        const p = this.panel;
        this.panel = undefined;
        const was = this.current;
        this.current = undefined;
        if (p) {
            try {
                p.dispose();
            }
            catch {
                /* already gone */
            }
        }
        if (was) {
            this.hooks.onStateChange?.(undefined);
        }
    }
}
exports.Celebrator = Celebrator;
//# sourceMappingURL=celebrateHost.js.map