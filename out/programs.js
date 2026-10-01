"use strict";
/**
 * programs.ts — catalog of the example programs shipped with the
 * extension (samples/*.cpp inside the .vsix) plus the command list
 * shown in the graphics.h webview panel.
 *
 * Clicking a program card opens it in the editor as a real
 * filename.cpp (created under <workspace>/graphics-h-programs/ when a
 * folder is open, or as an untitled document otherwise); the card's
 * Run button opens AND compiles AND runs it in one click.
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
exports.COMMAND_META = void 0;
exports.resolveProgramTarget = resolveProgramTarget;
exports.loadProgramCatalog = loadProgramCatalog;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Pure helper: where should a program file live inside a workspace? */
function resolveProgramTarget(workspaceFolder, filename) {
    if (!workspaceFolder) {
        return undefined;
    }
    return path.join(workspaceFolder, 'graphics-h-programs', filename);
}
const SAMPLE_META = [
    /* v1.5.16: the example section is now a GAME SUITE, exactly as the
     * user asked — the old teaching programs were removed and three
     * complete games took their place, each a full showpiece:
     *   1. Snake            — the classic, with a save database
     *   2. 2-Player Football — street-rules derby, pitch drawn with
     *                          hand-written putpixel algorithms only
     *   3. Bounce           — the rubber-ball classic with sounds */
    { id: 'snake', kind: 'sample', filename: '01_snake_game.cpp', title: 'Snake', description: 'The classic — WASD/arrows, bonus apples, top-5 score database', emoji: '🐍', tag: 'fun' },
    { id: 'football', kind: 'sample', filename: '02_football_game.cpp', title: '2-Player Football', description: 'Street-rules derby for two — field drawn without a single built-in shape call', emoji: '⚽', tag: 'fun' },
    { id: 'bounce', kind: 'sample', filename: '03_bounce_game.cpp', title: 'Bounce', description: 'The rubber-ball classic — charge jumps, rings, springs, six levels, sounds', emoji: '🔴', tag: 'fun' }
];
/** Commands rendered as action buttons in the webview panel. */
exports.COMMAND_META = [
    { id: 'cmd-compileAndRun', commandId: 'graphics-h-runner.compileAndRun', title: 'Compile & Run', hint: 'Ctrl+Alt+R', icon: '▶', primary: true },
    { id: 'cmd-setup', commandId: 'graphics-h-runner.setupEverything', title: 'Complete Run Setup', hint: 'installs everything', icon: '🚀' },
    { id: 'cmd-doctor', commandId: 'graphics-h-runner.doctor', title: 'Setup Doctor', hint: 'check environment', icon: '🩺' },
    { id: 'cmd-compile', commandId: 'graphics-h-runner.compile', title: 'Compile', hint: 'Ctrl+Alt+B', icon: '🛠' },
    { id: 'cmd-run', commandId: 'graphics-h-runner.run', title: 'Run Last Build', hint: 'opens a terminal', icon: '🎬' },
    { id: 'cmd-stop', commandId: 'graphics-h-runner.stopProgram', title: 'Stop Running Program', hint: 'kills the window', icon: '⏹' },
    { id: 'cmd-copycmd', commandId: 'graphics-h-runner.copyCompileCommand', title: 'Copy Compile Command', hint: 'exact g++ line', icon: '📋' },
    /* v1.5.5: the Fireworks Simulator (festive design; the SAME button
     * stops the show while it runs — toggle handled by the command). */
    { id: 'cmd-fireworks', commandId: 'graphics-h-runner.fireworks', title: 'Fireworks Simulator', hint: 'full-screen show', icon: '🎆', variant: 'festive' }
];
/** Load the full catalog: sample sources from disk. */
function loadProgramCatalog(extensionRoot) {
    const out = [];
    for (const meta of SAMPLE_META) {
        const file = path.join(extensionRoot, 'samples', meta.filename);
        let source = '';
        try {
            source = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue; /* sample not bundled — skip silently */
        }
        out.push({ ...meta, source });
    }
    return out;
}
//# sourceMappingURL=programs.js.map