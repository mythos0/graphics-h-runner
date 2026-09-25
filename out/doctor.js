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
const PROBE_SOURCE = '#include <graphics.h>\n\nint main () { return 0; }\n';
function runProcess(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
            if (!err) {
                resolve({ code: 0, stderr: String(stderr || '') });
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
                resolve({ code, stderr: String(stderr || err.message || '') });
            }
        });
    });
}
const FIX_WINDOWS = 'Windows setup: install MinGW-w64 (e.g. from winlibs.com or MSYS2), then install WinBGIM: ' +
    'copy graphics.h and winbgim.h into <MinGW>/include, and libbgi.a into <MinGW>/lib. ' +
    'See the full walkthrough in the README (Windows section).';
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
        return {
            name: libName,
            ok: res.code === 0,
            detail: res.code === 0
                ? 'graphics.h probe compiled successfully'
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
    const compiler = opts.compilerPath && opts.compilerPath.length > 0 ? opts.compilerPath : 'g++';
    const versionRes = await runProcess(compiler, ['--version'], 15000);
    const versionLine = versionRes.stderr
        ? ''
        : '';
    const compilerCheck = {
        name: `compiler (${compiler})`,
        ok: versionRes.code === 0,
        detail: versionRes.code === 0
            ? 'found and executable'
            : `could not run "${compiler}" (exit ${versionRes.code})`,
        fix: versionRes.code === 0
            ? undefined
            : opts.platform === 'windows'
                ? 'Install MinGW-w64 g++ (winlibs.com or MSYS2) and add its bin/ folder to PATH, or set "graphics-h-runner.compilerPath" to the full path of g++.exe.'
                : 'Install g++ (e.g. sudo apt install build-essential) or set "graphics-h-runner.compilerPath".'
    };
    void versionLine;
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
    return {
        platform: opts.platform,
        compilerCheck,
        libraryChecks,
        bestLibrary: best ? best.name : null,
        graphicsReady: compilerCheck.ok && Boolean(best)
    };
}
//# sourceMappingURL=doctor.js.map