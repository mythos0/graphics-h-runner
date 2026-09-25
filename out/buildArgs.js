"use strict";
/**
 * buildArgs.ts — builds the exact compiler command line for graphics.h (BGI) programs.
 * Pure module: no vscode / child_process imports, so it can be unit-tested in plain Node.
 *
 * Supported back-ends:
 *  - Windows: WinBGIM  (g++/MinGW-w64)  -> -lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32
 *  - Linux:   SDL_bgi   (g++)           -> -lSDL_bgi -lSDL2 -lm
 *             libgraph  (g++)           -> -lgraph
 *  - macOS:   SDL_bgi   (brew sdl2)     -> -lSDL_bgi -lSDL2 -lm
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIBGRAPH_LINK_LIBS = exports.SDL_BGI_LINK_LIBS = exports.WINBGIM_LINK_LIBS = void 0;
exports.resolveLinuxLibrary = resolveLinuxLibrary;
exports.buildCompilePlan = buildCompilePlan;
exports.WINBGIM_LINK_LIBS = [
    '-lbgi',
    '-lgdi32',
    '-lcomdlg32',
    '-luuid',
    '-loleaut32',
    '-lole32'
];
exports.SDL_BGI_LINK_LIBS = ['-lSDL_bgi', '-lSDL2', '-lm'];
exports.LIBGRAPH_LINK_LIBS = ['-lgraph'];
/**
 * Resolve the 'auto' linux library preference using optional probe results.
 * Preference order: SDL_bgi first (actively maintained, initwindow support),
 * libgraph as legacy fallback.
 */
function resolveLinuxLibrary(pref, probe) {
    if (pref === 'libgraph') {
        return 'libgraph';
    }
    if (pref === 'sdl_bgi') {
        return 'sdl_bgi';
    }
    if (probe && probe.sdlBgiAvailable) {
        return 'sdl_bgi';
    }
    if (probe && probe.libgraphAvailable) {
        return 'libgraph';
    }
    return 'sdl_bgi';
}
function quoteForDisplay(p) {
    return /[\s"]/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p;
}
/**
 * Build the complete compile plan.
 * When `useBgi` is false the plan is a plain C++ compile (no graphics libs) —
 * used when autoDetect is on and the file does not include graphics.h.
 */
function buildCompilePlan(opts, useBgi, probe) {
    const compiler = opts.compilerPath && opts.compilerPath.length > 0 ? opts.compilerPath : 'g++';
    const args = [];
    const includes = opts.extraIncludePaths || [];
    const libPaths = opts.extraLibPaths || [];
    const extraArgs = opts.extraCompilerArgs || [];
    for (const p of includes) {
        args.push('-I' + p);
    }
    args.push(...extraArgs);
    args.push(opts.sourceFile);
    args.push('-o', opts.outFile);
    let library = 'none';
    if (useBgi) {
        for (const p of libPaths) {
            args.push('-L' + p);
            // make custom-prefix libraries work at runtime without LD_LIBRARY_PATH
            if (opts.platform === 'linux' || opts.platform === 'macos') {
                args.push('-Wl,-rpath,' + p);
            }
        }
        switch (opts.platform) {
            case 'windows':
                library = 'winbgim';
                if (opts.staticLinkWindows !== false) {
                    // full static link BEFORE the -l list: the produced .exe must run on
                    // a fresh PC with zero DLL hunting (libgcc/libstdc++/winpthread)
                    args.push('-static');
                }
                args.push(...exports.WINBGIM_LINK_LIBS);
                if (opts.staticLinkWindows !== false) {
                    args.push('-static-libgcc', '-static-libstdc++');
                }
                break;
            case 'linux': {
                const resolved = resolveLinuxLibrary(opts.linuxLibrary, probe);
                library = resolved;
                if (resolved === 'sdl_bgi') {
                    args.push(...exports.SDL_BGI_LINK_LIBS);
                }
                else {
                    args.push(...exports.LIBGRAPH_LINK_LIBS);
                }
                break;
            }
            case 'macos':
                library = 'sdl_bgi';
                args.push(...exports.SDL_BGI_LINK_LIBS);
                break;
            default:
                library = 'sdl_bgi';
                args.push(...exports.SDL_BGI_LINK_LIBS);
                break;
        }
    }
    const commandLine = quoteForDisplay(compiler) + ' ' + args.map(quoteForDisplay).join(' ');
    return { compiler, args, library, commandLine };
}
//# sourceMappingURL=buildArgs.js.map