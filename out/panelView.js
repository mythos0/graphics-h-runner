"use strict";
/**
 * panelView.ts — WebviewViewProvider for the graphics.h activity-bar
 * panel (view id: graphics-h-runner.programs).
 *
 * Replaces the old plain TreeDataProvider with a modern webpage-style
 * panel: gradient hero, live environment status, action buttons and an
 * emoji card grid for all example programs. All clicks flow back to the
 * extension through postMessage.
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
class GhPanelProvider {
    constructor(extensionRoot, version, programs, onClick) {
        this.extensionRoot = extensionRoot;
        this.version = version;
        this.programs = programs;
        this.onClick = onClick;
        this.busy = false;
        this.busyLabel = null;
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
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(this.extensionRoot, 'media'))] };
        view.webview.html = this.renderHtml();
        view.webview.onDidReceiveMessage((msg) => {
            try {
                this.onClick(msg);
            }
            catch {
                /* never let a panel click crash the host */
            }
        });
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.postState();
            }
        });
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
        /* full re-render: the HTML is cheap to rebuild and always consistent */
        this.view.webview.html = this.renderHtml();
    }
    postBusy() {
        if (!this.view) {
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
        const logoUri = this.view.webview
            .asWebviewUri(vscode.Uri.file(path.join(this.extensionRoot, 'media', 'diu-logo.png')))
            .toString();
        return (0, panelHtml_1.buildPanelHtml)({
            programs: this.programs.map((p) => ({
                id: p.id,
                title: p.title,
                description: p.description,
                emoji: p.emoji,
                filename: p.filename,
                tag: p.tag
            })),
            commands: programs_1.COMMAND_META,
            status: this.currentStatus(),
            version: this.version,
            nonce,
            logoUri,
            cspSource: this.view.webview.cspSource
        });
    }
}
exports.GhPanelProvider = GhPanelProvider;
GhPanelProvider.VIEW_ID = 'graphics-h-runner.programs';
//# sourceMappingURL=panelView.js.map