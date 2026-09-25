"use strict";
/**
 * programs.ts — catalog of everything the graphics.h sidebar offers:
 *  - bundled example programs (samples/*.cpp, shipped inside the .vsix)
 *  - quick templates (embedded code from templates.ts)
 *  - the command list shown at the top of the view
 *
 * Clicking a program in the sidebar opens it in the editor as a real
 * filename.cpp (created under <workspace>/graphics-h-programs/ when a
 * folder is open, or as an untitled document otherwise).
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
const templates_1 = require("./templates");
/** Pure helper: where should a program file live inside a workspace? */
function resolveProgramTarget(workspaceFolder, filename) {
    if (!workspaceFolder) {
        return undefined;
    }
    return path.join(workspaceFolder, 'graphics-h-programs', filename);
}
const SAMPLE_META = [
    { id: 'hello', kind: 'sample', filename: '01_hello_graphics.cpp', title: 'Hello, graphics.h!', description: 'First window — shapes, colors, text' },
    { id: 'shapes', kind: 'sample', filename: '02_shapes_showcase.cpp', title: 'Shapes Showcase', description: 'Bars, circles, ellipses, polygons' },
    { id: 'ball', kind: 'sample', filename: '03_bouncing_ball.cpp', title: 'Bouncing Ball', description: 'delay()-based animation loop' },
    { id: 'car', kind: 'sample', filename: '04_moving_car.cpp', title: 'Moving Car', description: 'Scene animation with scrolling road' },
    { id: 'flag', kind: 'sample', filename: '05_tricolor_flag.cpp', title: 'Tricolor Flag', description: 'Filled rectangles + flag pole' },
    { id: 'tree', kind: 'sample', filename: '06_fractal_tree.cpp', title: 'Fractal Tree', description: 'Recursive line drawing showcase' },
    { id: 'mandel', kind: 'sample', filename: '07_mandelbrot.cpp', title: 'Mandelbrot Set', description: 'putpixel() math showcase' },
    { id: 'paint', kind: 'sample', filename: '08_mouse_paint.cpp', title: 'Mouse Paint', description: 'ismouseclick() drawing program' },
    { id: 'paddle', kind: 'sample', filename: '09_keyboard_paddle.cpp', title: 'Keyboard Paddle', description: 'kbhit()/getch() mini game' }
];
const TEMPLATE_META = [
    { id: 'tpl-window', kind: 'template', filename: 'template_basic_window.cpp', title: 'Basic window + shapes', description: 'initwindow, shapes, getch, closegraph' },
    { id: 'tpl-anim', kind: 'template', filename: 'template_animation_loop.cpp', title: 'Animation loop', description: 'Classic bouncing-ball skeleton' },
    { id: 'tpl-mouse', kind: 'template', filename: 'template_mouse_paint.cpp', title: 'Mouse paint', description: 'ismouseclick drawing loop' },
    { id: 'tpl-kbd', kind: 'template', filename: 'template_keyboard_control.cpp', title: 'Keyboard control loop', description: 'kbhit + getch arrow-key movement' },
    { id: 'tpl-fractal', kind: 'template', filename: 'template_fractal_tree.cpp', title: 'Recursive fractal tree', description: 'Recursion + line drawing' }
];
/** Commands shown at the top of the sidebar for discoverability. */
exports.COMMAND_META = [
    { id: 'cmd-compileAndRun', commandId: 'graphics-h-runner.compileAndRun', title: 'Compile & Run', hint: 'Ctrl+Alt+R', icon: 'play' },
    { id: 'cmd-setup', commandId: 'graphics-h-runner.setupEverything', title: 'Full Setup (0 to running)', hint: 'installs everything', icon: 'rocket' },
    { id: 'cmd-doctor', commandId: 'graphics-h-runner.doctor', title: 'Setup Doctor', hint: 'check environment', icon: 'check' },
    { id: 'cmd-compile', commandId: 'graphics-h-runner.compile', title: 'Compile', hint: 'Ctrl+Alt+B', icon: 'file-binary' },
    { id: 'cmd-run', commandId: 'graphics-h-runner.run', title: 'Run Last Build', hint: 'opens a terminal', icon: 'terminal' },
    { id: 'cmd-template', commandId: 'graphics-h-runner.insertTemplate', title: 'Insert Code Template', hint: 'into editor', icon: 'wand' },
    { id: 'cmd-guide', commandId: 'graphics-h-runner.showGuide', title: 'Show Setup Guide', hint: 'step-by-step', icon: 'book' }
];
/** Load the full catalog: sample sources from disk, templates from memory. */
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
    templates_1.TEMPLATES.forEach((t, i) => {
        const meta = TEMPLATE_META[i];
        if (meta) {
            out.push({ ...meta, source: t.code });
        }
    });
    return out;
}
//# sourceMappingURL=programs.js.map