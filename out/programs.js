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
     *   3. Bounce           — the rubber-ball classic with sounds
     * The Computer Graphics Lab section (below) is BACK — restored as it
     * was and extended with a full zero-to-advanced lab course (v1.5.16). */
    { id: 'snake', kind: 'sample', filename: '01_snake_game.cpp', title: 'Snake', description: 'The classic — WASD/arrows, bonus apples, top-5 score database', emoji: '🐍', tag: 'fun' },
    { id: 'football', kind: 'sample', filename: '02_football_game.cpp', title: '2-Player Football', description: 'Street-rules derby for two — field drawn without a single built-in shape call', emoji: '⚽', tag: 'fun' },
    { id: 'bounce', kind: 'sample', filename: '03_bounce_game.cpp', title: 'Bounce', description: 'The rubber-ball classic — charge jumps, rings, springs, six levels, sounds', emoji: '🔴', tag: 'fun' }
];
/** The Computer Graphics Lab — v1.5.16: the original 8 lab programs are
 *  restored exactly as they were, and the section now teaches graphics.h
 *  from ZERO to ADVANCED with 10 new labs arranged as a course:
 *
 *   start here      32-36  first window, colors & pixels, shapes & text,
 *                          keyboard & mouse, the animation loop
 *   the tools        24-25  coordinate viewer, pixel inspector
 *   the algorithms   26-31  DDA, Bresenham line/circle, midpoint ellipse,
 *                          2-D transformations, Cohen-Sutherland clipping
 *   advanced         37-41  sprites, scanline fill, Bézier curves,
 *                          fractals, a 3-D wireframe cube
 *
 *  Rendered as its own panel section below the Example Programs list. */
const LAB_SAMPLE_META = [
    /* — start here: zero — */
    { id: 'labfirst', kind: 'sample', filename: '32_lab_first_window.cpp', title: 'First Window (start here)', description: 'Your first graphics program, narrated line by line — window, shapes, text, colors', emoji: '🚪', tag: 'lab', lab: true },
    { id: 'labcolors', kind: 'sample', filename: '33_lab_colors_pixels.cpp', title: 'Colors & Pixels', description: 'The 16-color palette, fill patterns, putpixel and a plotted gradient', emoji: '🎨', tag: 'lab', lab: true },
    { id: 'labshapes', kind: 'sample', filename: '34_lab_shapes_text.cpp', title: 'Shapes & Text', description: 'Every shape call in one labeled scene — plus floodfill and all BGI fonts', emoji: '🔷', tag: 'lab', lab: true },
    { id: 'labinput', kind: 'sample', filename: '35_lab_keyboard_mouse.cpp', title: 'Keyboard & Mouse', description: 'kbhit/getch arrow codes + mouse events — move a crosshair, paint with the pointer', emoji: '🕹️', tag: 'lab', lab: true },
    { id: 'labanim', kind: 'sample', filename: '36_lab_animation_loop.cpp', title: 'Animation Loop', description: 'The game loop demystified — cleardevice, frame pacing, motion, trails, double buffering', emoji: '🎬', tag: 'lab', lab: true },
    /* — the interactive teaching tools — */
    { id: 'coordview', kind: 'sample', filename: '24_coordinate_viewer.cpp', title: 'Coordinate Viewer', description: 'Grid, axes, origin, labels, 10-px snap — the coordinate system live', emoji: '📐', tag: 'lab', lab: true },
    { id: 'pixelinspector', kind: 'sample', filename: '25_pixel_inspector.cpp', title: 'Pixel Inspector', description: 'Mouse x/y, color name + RGB readout; click prints a copy-ready coordinate', emoji: '🔍', tag: 'lab', lab: true },
    /* — the classic course algorithms — */
    { id: 'ddalab', kind: 'sample', filename: '26_dda_lab.cpp', title: 'DDA Line Lab', description: 'Every DDA step plotted on a grid, line() as the reference', emoji: '📏', tag: 'lab', lab: true },
    { id: 'bresenhamline', kind: 'sample', filename: '27_bresenham_line_lab.cpp', title: 'Bresenham Line Lab', description: 'Integer-only Bresenham with the decision-variable table', emoji: '📈', tag: 'lab', lab: true },
    { id: 'bresenhamcircle', kind: 'sample', filename: '28_bresenham_circle_lab.cpp', title: 'Bresenham Circle Lab', description: 'Midpoint circle, 8-way symmetry, step-by-step decision variable', emoji: '⚪', tag: 'lab', lab: true },
    { id: 'midpointellipse', kind: 'sample', filename: '29_midpoint_ellipse_lab.cpp', title: 'Midpoint Ellipse Lab', description: 'Region 1 / region 2 midpoint ellipse in 4 quadrants', emoji: '🥚', tag: 'lab', lab: true },
    { id: 'transforms', kind: 'sample', filename: '30_2d_transforms_lab.cpp', title: '2D Transformations Lab', description: 'Translate / rotate / scale a house with real 2-D matrices', emoji: '🔄', tag: 'lab', lab: true },
    { id: 'clipping', kind: 'sample', filename: '31_cohen_sutherland_clipping.cpp', title: 'Cohen-Sutherland Clipping', description: 'Outcodes, verdicts and clipped lines against a clip window', emoji: '✂️', tag: 'lab', lab: true },
    /* — advanced — */
    { id: 'labsprite', kind: 'sample', filename: '37_lab_sprite_getimage.cpp', title: 'Sprites (getimage)', description: 'imagesize/malloc/getimage/putimage — a UFO sprite over a saved starfield', emoji: '🛸', tag: 'lab', lab: true },
    { id: 'labfill', kind: 'sample', filename: '38_lab_scanline_fill.cpp', title: 'Scanline Polygon Fill', description: 'Polygon filling implemented by hand — edge table, sorted intersections, row by row', emoji: '🪣', tag: 'lab', lab: true },
    { id: 'labezier', kind: 'sample', filename: '39_lab_bezier_curves.cpp', title: 'Bézier Curves', description: 'De Casteljau construction animated — control points, lerps, the curve emerging', emoji: '〰️', tag: 'lab', lab: true },
    { id: 'labfractal', kind: 'sample', filename: '40_lab_fractals.cpp', title: 'Fractals (Recursion)', description: 'Koch snowflake + Sierpinski triangle — recursion depth on the +/− keys', emoji: '❄️', tag: 'lab', lab: true },
    { id: 'lab3dcube', kind: 'sample', filename: '41_lab_3d_wireframe_cube.cpp', title: '3D Wireframe Cube', description: '3-D points projected to 2-D by hand — rotation matrices, perspective, arrow-key spin', emoji: '🧊', tag: 'lab', lab: true }
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
    /* v1.5.16: Reset Setup — the same surgical restore that runs on
     * uninstall (v1.5.13), now as a button: every setting Complete Run
     * Setup ever wrote (toolchain paths, Code Runner, C_Cpp, .vscode
     * files) is reverted to its pre-extension value, behind a confirm. */
    { id: 'cmd-resetSetup', commandId: 'graphics-h-runner.restoreOriginalSettings', title: 'Reset Setup', hint: 'undo setup changes', icon: '↩' },
    /* v1.5.5: the Fireworks Simulator (festive design; the SAME button
     * stops the show while it runs — toggle handled by the command). */
    { id: 'cmd-fireworks', commandId: 'graphics-h-runner.fireworks', title: 'Fireworks Simulator', hint: 'full-screen show', icon: '🎆', variant: 'festive' }
];
/** Load the full catalog: sample sources from disk. */
function loadProgramCatalog(extensionRoot) {
    const out = [];
    for (const meta of [...SAMPLE_META, ...LAB_SAMPLE_META]) {
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