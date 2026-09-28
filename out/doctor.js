"use strict";
/**
 * doctor.ts — Setup Doctor: probes the environment for a working
 * graphics.h (BGI) build toolchain. Uses only Node APIs (no vscode),
 * so the probe logic is unit-testable from a plain Node script.
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
exports.librariesForPlatform = librariesForPlatform;
exports.probeEnvironment = probeEnvironment;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path = __importStar(require("path"));
const normalize_1 = require("./normalize");
/* v1.5.6: the probe must REFERENCE a graphics function. A `main(){return 0;}`
 * probe links nothing from the graphics library, so a 32-bit compiler that
 * silently skips the 64-bit libbgi.a looked "OK" and every real program then
 * failed with undefined references (the user-reported Full Setup failure).
 * circle() forces the linker to actually pull the symbol from the archive. */
const PROBE_SOURCE = '#include <graphics.h>\n\nint main () { circle ( 100, 100, 50 ); return 0; }\n';
function runProcess(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
            const stdout = String(_stdout || '');
            if (!err) {
                resolve({ code: 0, stderr: String(stderr || ''), stdout });
            }
            else {
                const anyErr = err;
                let code = -1;
                if (typeof anyErr.code === 'number') {
                    code = anyErr.code;
                }
                else if (anyErr.killed) {
                    code = 124; // timeout-like
                }
                resolve({ code, stderr: String(stderr || err.message || ''), stdout });
            }
        });
    });
}
const FIX_WINDOWS = 'Run the extension\'s "graphics.h: Full Setup (everything, automatic)" command — it installs ' +
    'MinGW-w64 g++ (winget or direct download) and WinBGIM automatically, per-user, no admin rights. ' +
    'Manual route: install MinGW-w64 (winlibs.com or MSYS2) and set "graphics-h-runner.compilerPath".';
const FIX_SDL_BGI_LINUX = 'Linux setup: install SDL2 dev files (sudo apt install libsdl2-dev) then build SDL_bgi: ' +
    'download from https://sourceforge.net/projects/sdl-bgi/ (or git clone the mirror), ' +
    'run make && sudo make install in its src/ folder. Details in the README (Linux section).';
const FIX_LIBGRAPH_LINUX = 'libgraph setup: sudo apt install libsdl1.2-dev libsdl-gfx1.2-dev guile-2.2-dev, ' +
    'then build libgraph 1.0.2 (https://sourceforge.net/projects/libgraph/) with ' +
    './configure && make && sudo make install. Details in the README (Linux section).';
const FIX_SDL_BGI_MAC = 'macOS setup: brew install sdl2, then build SDL_bgi from https://sourceforge.net/projects/sdl-bgi/ ' +
    'and install it into /usr/local. Details in the README (macOS section).';
/**
 * Compile a tiny `#include <graphics.h>` probe with the flags that would be
 * used for the given library. Success means the library + headers exist.
 */
async function probeLibrary(opts, libName, compiler) {
    let dir = null;
    try {
        dir = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'bgi-doctor-'));
        const srcPath = path.join(dir, 'bgi_probe.cpp');
        const outName = opts.platform === 'windows' ? 'bgi_probe.exe' : 'bgi_probe';
        const outPath = path.join(dir, outName);
        (0, fs_1.writeFileSync)(srcPath, PROBE_SOURCE);
        const args = [];
        for (const p of opts.extraIncludePaths || []) {
            args.push('-I' + p);
        }
        args.push(srcPath, '-o', outPath);
        for (const p of opts.extraLibPaths || []) {
            args.push('-L' + p);
        }
        if (libName === 'winbgim') {
            args.push('-lbgi', '-lgdi32', '-lcomdlg32', '-luuid', '-loleaut32', '-lole32');
        }
        else if (libName === 'sdl_bgi') {
            args.push('-lSDL_bgi', '-lSDL2', '-lm');
        }
        else {
            args.push('-lgraph');
        }
        const res = await runProcess(compiler, args, 30000);
        const tail = res.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        /* v1.5.6: undefined references to graphics symbols mean the library
         * exists but THIS compiler cannot link it (classic: 32-bit MinGW.org
         * g++ + 64-bit libbgi.a — its ld skips the incompatible archive). */
        const unresolved = /undefined reference to [`'](?:circle|line|initwindow|initgraph|cleardevice|closegraph|setcolor|outtextxy|getmaxx|getmaxy|bar|delay|setfillstyle|settextstyle|putpixel|getpixel|rectangle|fillellipse|kbhit|getch)/i.test(res.stderr);
        return {
            name: libName,
            ok: res.code === 0,
            detail: res.code === 0
                ? 'graphics.h probe compiled AND linked successfully'
                : unresolved
                    ? 'headers compile but the graphics library cannot be LINKED — every graphics symbol is unresolved. ' +
                        'This compiler is incompatible with the installed graphics library ' +
                        '(e.g. a 32-bit MinGW.org g++ with the 64-bit library).'
                    : `probe failed (exit ${res.code})${tail ? ': ' + tail : ''}`,
            fix: res.code === 0
                ? undefined
                : libName === 'winbgim'
                    ? FIX_WINDOWS
                    : libName === 'sdl_bgi'
                        ? opts.platform === 'macos'
                            ? FIX_SDL_BGI_MAC
                            : FIX_SDL_BGI_LINUX
                        : FIX_LIBGRAPH_LINUX
        };
    }
    catch (e) {
        return {
            name: libName,
            ok: false,
            detail: 'probe crashed: ' + String(e),
            fix: libName === 'winbgim' ? FIX_WINDOWS : FIX_SDL_BGI_LINUX
        };
    }
    finally {
        if (dir) {
            try {
                (0, fs_1.rmSync)(dir, { recursive: true, force: true });
            }
            catch {
                /* ignore cleanup errors */
            }
        }
    }
}
/** Libraries to probe per platform. */
function librariesForPlatform(platform) {
    switch (platform) {
        case 'windows':
            return ['winbgim'];
        case 'linux':
            return ['sdl_bgi', 'libgraph'];
        case 'macos':
            return ['sdl_bgi'];
        default:
            return ['sdl_bgi'];
    }
}
/**
 * Full environment probe: compiler + every candidate graphics library.
 */
async function probeEnvironment(opts) {
    /* heal messy settings first: quotes, env vars, ~, directory paths, .exe */
    const compiler = (0, normalize_1.normalizeCompilerPath)(opts.compilerPath && opts.compilerPath.length > 0 ? opts.compilerPath : 'g++');
    const versionRes = await runProcess(compiler, ['--version'], 15000);
    const versionLine = versionRes.code === 0
        ? versionRes.stdout.split(/\r?\n/).find((l) => l.trim()) || ''
        : '';
    /* v1.5.6: surface the compiler's target architecture — the legacy 32-bit
     * MinGW.org (dumpmachine "mingw32") cannot link the bundled 64-bit
     * WinBGIM library, and this one line explains a LOT of broken setups. */
    let archNote = '';
    if (versionRes.code === 0) {
        const machineRes = await runProcess(compiler, ['-dumpmachine'], 15000);
        const machine = machineRes.code === 0 ? machineRes.stdout.trim().toLowerCase() : '';
        if (machine === 'mingw32' || (!machine.includes('w64') && machine.includes('mingw') && machine.includes('32'))) {
            archNote = ' — target ' + machine + ' (32-bit: cannot link the bundled 64-bit graphics library — run Full Setup)';
        }
        else if (machine) {
            archNote = ' — target ' + machine;
        }
    }
    const compilerCheck = {
        name: `compiler (${compiler})`,
        ok: versionRes.code === 0,
        detail: versionRes.code === 0
            ? `found and executable — ${(versionLine.trim().slice(0, 90) || 'no version line')}${archNote}`
            : `could not run "${compiler}" (exit ${versionRes.code})`,
        fix: versionRes.code === 0
            ? undefined
            : opts.platform === 'windows'
                ? 'Run "graphics.h: Full Setup (everything, automatic)" — it installs g++ + WinBGIM automatically (winget or direct download, no admin rights). Or set "graphics-h-runner.compilerPath" to an existing g++.exe.'
                : 'Install g++ (e.g. sudo apt install build-essential) or set "graphics-h-runner.compilerPath".'
    };
    const libs = librariesForPlatform(opts.platform);
    const libraryChecks = [];
    for (const lib of libs) {
        if (!compilerCheck.ok) {
            libraryChecks.push({
                name: lib,
                ok: false,
                detail: 'skipped — compiler is not available',
                fix: compilerCheck.fix
            });
            continue;
        }
        // Honour the linuxLibrary preference order when probing on linux.
        libraryChecks.push(await probeLibrary(opts, lib, compiler));
    }
    const best = libraryChecks.find((c) => c.ok);
    /* v1.5.1 global probe (Windows only): can a plain terminal command
     * `g++ probe.cpp -lbgi ...` resolve graphics.h with NO extension help? */
    let globalCheck;
    if (opts.platform === 'windows' && compilerCheck.ok && best && best.name === 'winbgim') {
        globalCheck = await probeGlobalWindows(compiler);
    }
    return {
        platform: opts.platform,
        compilerCheck,
        libraryChecks,
        bestLibrary: best ? best.name : null,
        graphicsReady: compilerCheck.ok && Boolean(best),
        globalCheck
    };
}
const GLOBAL_FIX = 'Run "graphics.h: Complete graphics.h Run Setup" once — it copies WinBGIM into the ' +
    'compiler toolchain folders and adds the compiler to your user PATH, so ANY terminal ' +
    'or IDE can compile graphics.h programs without this extension.';
/** Probe: plain `g++ probe.cpp -lbgi ...` with zero -I/-L (Windows). */
async function probeGlobalWindows(compiler) {
    let dir = null;
    try {
        dir = (0, fs_1.mkdtempSync)(path.join((0, os_1.tmpdir)(), 'bgi-globalcheck-'));
        const srcPath = path.join(dir, 'global_probe.cpp');
        const outPath = path.join(dir, 'global_probe.exe');
        (0, fs_1.writeFileSync)(srcPath, PROBE_SOURCE);
        const res = await runProcess(compiler, [srcPath, '-o', outPath, '-lbgi', '-lgdi32', '-lcomdlg32', '-luuid', '-loleaut32', '-lole32'], 60000);
        return res.code === 0
            ? {
                name: 'global (no flags)',
                ok: true,
                detail: 'g++ resolves graphics.h + -lbgi with no -I/-L — works in ANY terminal without this extension'
            }
            : {
                name: 'global (no flags)',
                ok: false,
                detail: 'plain "g++ ..." does not resolve graphics.h yet (the extension wires it via settings only)',
                fix: GLOBAL_FIX
            };
    }
    catch (e) {
        return { name: 'global (no flags)', ok: false, detail: 'probe crashed: ' + String(e), fix: GLOBAL_FIX };
    }
    finally {
        if (dir) {
            try {
                (0, fs_1.rmSync)(dir, { recursive: true, force: true });
            }
            catch {
                /* ignore */
            }
        }
    }
}
//# sourceMappingURL=doctor.js.map