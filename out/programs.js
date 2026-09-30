"use strict";
/**
 * programs.ts — catalog of the example programs shipped with the
 * extension (samples/*.cpp inside the .vsix) plus the command list
 * shown in the graphics.h webview panel.
 *
 * v1.5.16: the Example Programs section is a single showpiece — the
 * Snake Game (WASD/arrow keys, bonus apples, difficulty levels, a
 * file-based high-score database). The classic course algorithms
 * remain as their own Computer Graphics Lab section below.
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
    /* v1.5.16: the example section is now exactly one program — the best
     * designed graphics.h game, playable with W A S D and the arrow keys,
     * with a tiny file database for the high scores. */
    { id: 'snake', kind: 'sample', filename: '01_snake_game.cpp', title: 'Snake Game',
        description: 'WASD/arrows, bonus apples, levels & a saved high-score table',
        emoji: '🐍', tag: 'fun' }
];
/** v1.5.0 — the Computer Graphics Lab: the classic course algorithms as
 *  runnable programs (screen coordinate system, DDA, Bresenham line and
 *  circle, midpoint ellipse, 2-D transformations, Cohen-Sutherland
 *  clipping) plus the two interactive teaching tools (Coordinate Viewer,
 *  Pixel Inspector). Rendered as its own panel section below the
 *  Example Programs list. */
const LAB_SAMPLE_META = [
    { id: 'coordview', kind: 'sample', filename: '24_coordinate_viewer.cpp', title: 'Coordinate Viewer', description: 'Grid, axes, origin, labels, 10-px snap — the coordinate system live', emoji: '📐', tag: 'lab', lab: true },
    { id: 'pixelinspector', kind: 'sample', filename: '25_pixel_inspector.cpp', title: 'Pixel Inspector', description: 'Mouse x/y, color name + RGB readout; click prints a copy-ready coordinate', emoji: '🔍', tag: 'lab', lab: true },
    { id: 'ddalab', kind: 'sample', filename: '26_dda_lab.cpp', title: 'DDA Line Lab', description: 'Every DDA step plotted on a grid, line() as the reference', emoji: '📏', tag: 'lab', lab: true },
    { id: 'bresenhamline', kind: 'sample', filename: '27_bresenham_line_lab.cpp', title: 'Bresenham Line Lab', description: 'Integer-only Bresenham with the decision-variable table', emoji: '📈', tag: 'lab', lab: true },
    { id: 'bresenhamcircle', kind: 'sample', filename: '28_bresenham_circle_lab.cpp', title: 'Bresenham Circle Lab', description: 'Midpoint circle, 8-way symmetry, step-by-step decision variable', emoji: '⚪', tag: 'lab', lab: true },
    { id: 'midpointellipse', kind: 'sample', filename: '29_midpoint_ellipse_lab.cpp', title: 'Midpoint Ellipse Lab', description: 'Region 1 / region 2 midpoint ellipse in 4 quadrants', emoji: '🥚', tag: 'lab', lab: true },
    { id: 'transforms', kind: 'sample', filename: '30_2d_transforms_lab.cpp', title: '2D Transformations Lab', description: 'Translate / rotate / scale a house with real 2-D matrices', emoji: '🔄', tag: 'lab', lab: true },
    { id: 'clipping', kind: 'sample', filename: '31_cohen_sutherland_clipping.cpp', title: 'Cohen-Sutherland Clipping', description: 'Outcodes, verdicts and clipped lines against a clip window', emoji: '✂️', tag: 'lab', lab: true }
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
    for (const meta of LAB_SAMPLE_META) {
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