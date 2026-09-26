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
    { id: 'hello', kind: 'sample', filename: '01_hello_graphics.cpp', title: 'Hello, graphics.h!', description: 'First window — shapes, colors, text', emoji: '👋', tag: 'classic' },
    { id: 'shapes', kind: 'sample', filename: '02_shapes_showcase.cpp', title: 'Shapes Showcase', description: 'Bars, circles, ellipses, polygons', emoji: '🔷', tag: 'classic' },
    { id: 'ball', kind: 'sample', filename: '03_bouncing_ball.cpp', title: 'Bouncing Ball', description: 'delay()-based animation loop', emoji: '🔴', tag: 'classic' },
    { id: 'car', kind: 'sample', filename: '04_moving_car.cpp', title: 'Moving Car', description: 'Scene animation with scrolling road', emoji: '🚗', tag: 'fun' },
    { id: 'flag', kind: 'sample', filename: '05_tricolor_flag.cpp', title: 'Tricolor Flag', description: 'Filled rectangles + flag pole', emoji: '🚩', tag: 'classic' },
    { id: 'tree', kind: 'sample', filename: '06_fractal_tree.cpp', title: 'Fractal Tree', description: 'Recursive line drawing showcase', emoji: '🌳', tag: 'math' },
    { id: 'mandel', kind: 'sample', filename: '07_mandelbrot.cpp', title: 'Mandelbrot Set', description: 'putpixel() math showcase', emoji: '🌀', tag: 'math' },
    { id: 'paint', kind: 'sample', filename: '08_mouse_paint.cpp', title: 'Mouse Paint', description: 'ismouseclick() drawing program', emoji: '🖌️', tag: 'interactive' },
    { id: 'paddle', kind: 'sample', filename: '09_keyboard_paddle.cpp', title: 'Keyboard Paddle', description: 'kbhit()/getch() mini game', emoji: '🏓', tag: 'interactive' },
    { id: 'smiley', kind: 'sample', filename: '10_smiley_wink.cpp', title: 'Winking Smiley', description: 'Giant bobbing smiley that winks at you', emoji: '😊', tag: 'fun' },
    { id: 'balls', kind: 'sample', filename: '11_bouncing_balls.cpp', title: 'Bouncing Balls', description: 'Seven colorful balls with ghost trails', emoji: '🎱', tag: 'fun' },
    { id: 'fireworks', kind: 'sample', filename: '12_fireworks.cpp', title: 'Fireworks Show', description: 'Rockets exploding over a city skyline', emoji: '🎆', tag: 'fun' },
    { id: 'solar', kind: 'sample', filename: '13_solar_system.cpp', title: 'Solar System', description: 'Orbiting planets, moon and a comet', emoji: '🪐', tag: 'fun' },
    { id: 'aquarium', kind: 'sample', filename: '14_aquarium.cpp', title: 'Aquarium', description: 'Swimming fish, bubbles and seaweed', emoji: '🐠', tag: 'fun' },
    { id: 'spiral', kind: 'sample', filename: '15_rainbow_spiral.cpp', title: 'Rainbow Spiral', description: 'Ever-growing rotating rainbow spiral', emoji: '🌈', tag: 'fun' },
    { id: 'heli', kind: 'sample', filename: '16_helicopter.cpp', title: 'Helicopter', description: 'Heli over a night city, spinning rotor', emoji: '🚁', tag: 'fun' },
    { id: 'sunset', kind: 'sample', filename: '17_sunset.cpp', title: 'Sunset Scene', description: 'Sun sinks, stars come out, moon rises', emoji: '🌅', tag: 'fun' },
    { id: 'starfield', kind: 'sample', filename: '18_starfield.cpp', title: 'Warp Starfield', description: 'Fly through space at warp speed', emoji: '✨', tag: 'fun' },
    { id: 'dda', kind: 'sample', filename: '19_dda_line.cpp', title: 'DDA Line (Terminal Input)', description: 'Type endpoints in the terminal, see every DDA step', emoji: '📏', tag: 'math' },
    { id: 'turbos', kind: 'sample', filename: '20_turbo_tour.cpp', title: 'Turbo C++ Graphics Tour', description: 'bar3d, pieslice, sector, floodfill, fill patterns', emoji: '🏛️', tag: 'classic' },
    { id: 'viewport', kind: 'sample', filename: '21_viewport_bounce.cpp', title: 'Viewport & Clipping', description: 'Two clipped panes with bouncing balls inside', emoji: '🖼️', tag: 'classic' },
    { id: 'sprite', kind: 'sample', filename: '22_sprite_ride.cpp', title: 'Sprite Animation', description: 'getimage/putimage rocket over a starfield', emoji: '🚀', tag: 'fun' },
    { id: 'coniopaint', kind: 'sample', filename: '23_conio_paint.cpp', title: 'Conio Keyboard Paint', description: 'conio.h kbhit/getch drawing pad with a menu bar', emoji: '⌨️', tag: 'interactive' }
];
/** Commands rendered as action buttons in the webview panel. */
exports.COMMAND_META = [
    { id: 'cmd-compileAndRun', commandId: 'graphics-h-runner.compileAndRun', title: 'Compile & Run', hint: 'Ctrl+Alt+R', icon: '▶', primary: true },
    { id: 'cmd-setup', commandId: 'graphics-h-runner.setupEverything', title: 'Complete Run Setup', hint: 'installs everything', icon: '🚀' },
    { id: 'cmd-doctor', commandId: 'graphics-h-runner.doctor', title: 'Setup Doctor', hint: 'check environment', icon: '🩺' },
    { id: 'cmd-compile', commandId: 'graphics-h-runner.compile', title: 'Compile', hint: 'Ctrl+Alt+B', icon: '🛠' },
    { id: 'cmd-run', commandId: 'graphics-h-runner.run', title: 'Run Last Build', hint: 'opens a terminal', icon: '🎬' },
    { id: 'cmd-stop', commandId: 'graphics-h-runner.stopProgram', title: 'Stop Running Program', hint: 'kills the window', icon: '⏹' },
    { id: 'cmd-copycmd', commandId: 'graphics-h-runner.copyCompileCommand', title: 'Copy Compile Command', hint: 'exact g++ line', icon: '📋' }
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