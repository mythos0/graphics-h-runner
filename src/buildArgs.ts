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

import { Platform } from './toolchain';
import { normalizeCompilerPath } from './normalize';

export type LinuxLibrary = 'auto' | 'sdl_bgi' | 'libgraph';
export type BgiLibrary = 'winbgim' | 'sdl_bgi' | 'libgraph' | 'none';

export interface CompileOptions {
  platform: Platform;
  linuxLibrary?: LinuxLibrary;
  compilerPath?: string;
  sourceFile: string;
  outFile: string;
  extraIncludePaths?: string[];
  extraLibPaths?: string[];
  extraCompilerArgs?: string[];
  staticLinkWindows?: boolean;
}

export interface CompilePlan {
  /** Compiler executable. */
  compiler: string;
  /** Full argument array (safe for child_process.spawn without a shell). */
  args: string[];
  /** Which graphics back-end the flags target ('none' = plain C++ build). */
  library: BgiLibrary;
  /** Human-readable command line (paths quoted when needed) for logs/output. */
  commandLine: string;
}

export const WINBGIM_LINK_LIBS: string[] = [
  '-lbgi',
  '-lgdi32',
  '-lcomdlg32',
  '-luuid',
  '-loleaut32',
  '-lole32'
];

export const SDL_BGI_LINK_LIBS: string[] = ['-lSDL_bgi', '-lSDL2', '-lm'];
export const LIBGRAPH_LINK_LIBS: string[] = ['-lgraph'];

/**
 * Resolve the 'auto' linux library preference using optional probe results.
 * Preference order: SDL_bgi first (actively maintained, initwindow support),
 * libgraph as legacy fallback.
 */
export function resolveLinuxLibrary(
  pref: LinuxLibrary | undefined,
  probe?: { sdlBgiAvailable?: boolean; libgraphAvailable?: boolean }
): 'sdl_bgi' | 'libgraph' {
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

function quoteForDisplay(p: string): string {
  return /[\s"]/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p;
}

/**
 * Build the complete compile plan.
 * When `useBgi` is false the plan is a plain C++ compile (no graphics libs) —
 * used when autoDetect is on and the file does not include graphics.h.
 */
export function buildCompilePlan(
  opts: CompileOptions,
  useBgi: boolean,
  probe?: { sdlBgiAvailable?: boolean; libgraphAvailable?: boolean }
): CompilePlan {
  /* heal messy settings (quotes / directory paths / missing .exe) — the
   * extension already normalizes its config, this keeps pure callers safe */
  const compiler = normalizeCompilerPath(
    opts.compilerPath && opts.compilerPath.length > 0 ? opts.compilerPath : 'g++'
  );
  const args: string[] = [];
  const includes = opts.extraIncludePaths || [];
  const libPaths = opts.extraLibPaths || [];
  const extraArgs = opts.extraCompilerArgs || [];

  for (const p of includes) {
    args.push('-I' + p);
  }
  args.push(...extraArgs);
  args.push(opts.sourceFile);
  args.push('-o', opts.outFile);

  let library: BgiLibrary = 'none';

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
        args.push(...WINBGIM_LINK_LIBS);
        if (opts.staticLinkWindows !== false) {
          args.push('-static-libgcc', '-static-libstdc++');
        }
        break;
      case 'linux': {
        const resolved = resolveLinuxLibrary(opts.linuxLibrary, probe);
        library = resolved;
        if (resolved === 'sdl_bgi') {
          args.push(...SDL_BGI_LINK_LIBS);
        } else {
          args.push(...LIBGRAPH_LINK_LIBS);
        }
        break;
      }
      case 'macos':
        library = 'sdl_bgi';
        args.push(...SDL_BGI_LINK_LIBS);
        break;
      default:
        library = 'sdl_bgi';
        args.push(...SDL_BGI_LINK_LIBS);
        break;
    }
  }

  const commandLine =
    quoteForDisplay(compiler) + ' ' + args.map(quoteForDisplay).join(' ');

  return { compiler, args, library, commandLine };
}
