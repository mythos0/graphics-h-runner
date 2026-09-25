/**
 * doctor.ts — Setup Doctor: probes the environment for a working
 * graphics.h (BGI) build toolchain. Uses only Node APIs (no vscode),
 * so the probe logic is unit-testable from a plain Node script.
 */

import { execFile } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Platform } from './toolchain';
import { LinuxLibrary } from './buildArgs';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorResult {
  platform: Platform;
  compilerCheck: DoctorCheck;
  libraryChecks: DoctorCheck[];
  /** First library that compiled the probe successfully, if any. */
  bestLibrary: string | null;
  graphicsReady: boolean;
}

export interface DoctorOptions {
  platform: Platform;
  compilerPath?: string;
  linuxLibrary?: LinuxLibrary;
  extraIncludePaths?: string[];
  extraLibPaths?: string[];
}

const PROBE_SOURCE = '#include <graphics.h>\n\nint main () { return 0; }\n';

interface RunOutcome {
  code: number;
  stderr: string;
}

function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err: Error | null, _stdout: string | Buffer, stderr: string | Buffer) => {
        if (!err) {
          resolve({ code: 0, stderr: String(stderr || '') });
        } else {
          const anyErr = err as { code?: number | string; killed?: boolean };
          let code = -1;
          if (typeof anyErr.code === 'number') {
            code = anyErr.code;
          } else if (anyErr.killed) {
            code = 124; // timeout-like
          }
          resolve({ code, stderr: String(stderr || err.message || '') });
        }
      }
    );
  });
}

const FIX_WINDOWS =
  'Run the extension\'s "graphics.h: Full Setup (everything, automatic)" command — it installs ' +
  'MinGW-w64 g++ (winget or direct download) and WinBGIM automatically, per-user, no admin rights. ' +
  'Manual route: install MinGW-w64 (winlibs.com or MSYS2) and set "graphics-h-runner.compilerPath".';

const FIX_SDL_BGI_LINUX =
  'Linux setup: install SDL2 dev files (sudo apt install libsdl2-dev) then build SDL_bgi: ' +
  'download from https://sourceforge.net/projects/sdl-bgi/ (or git clone the mirror), ' +
  'run make && sudo make install in its src/ folder. Details in the README (Linux section).';

const FIX_LIBGRAPH_LINUX =
  'libgraph setup: sudo apt install libsdl1.2-dev libsdl-gfx1.2-dev guile-2.2-dev, ' +
  'then build libgraph 1.0.2 (https://sourceforge.net/projects/libgraph/) with ' +
  './configure && make && sudo make install. Details in the README (Linux section).';

const FIX_SDL_BGI_MAC =
  'macOS setup: brew install sdl2, then build SDL_bgi from https://sourceforge.net/projects/sdl-bgi/ ' +
  'and install it into /usr/local. Details in the README (macOS section).';

/**
 * Compile a tiny `#include <graphics.h>` probe with the flags that would be
 * used for the given library. Success means the library + headers exist.
 */
async function probeLibrary(
  opts: DoctorOptions,
  libName: 'winbgim' | 'sdl_bgi' | 'libgraph',
  compiler: string
): Promise<DoctorCheck> {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(path.join(tmpdir(), 'bgi-doctor-'));
    const srcPath = path.join(dir, 'bgi_probe.cpp');
    const outName = opts.platform === 'windows' ? 'bgi_probe.exe' : 'bgi_probe';
    const outPath = path.join(dir, outName);
    writeFileSync(srcPath, PROBE_SOURCE);

    const args: string[] = [];
    for (const p of opts.extraIncludePaths || []) {
      args.push('-I' + p);
    }
    args.push(srcPath, '-o', outPath);
    for (const p of opts.extraLibPaths || []) {
      args.push('-L' + p);
    }
    if (libName === 'winbgim') {
      args.push('-lbgi', '-lgdi32', '-lcomdlg32', '-luuid', '-loleaut32', '-lole32');
    } else if (libName === 'sdl_bgi') {
      args.push('-lSDL_bgi', '-lSDL2', '-lm');
    } else {
      args.push('-lgraph');
    }

    const res = await runProcess(compiler, args, 30000);
    const tail = res.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
    return {
      name: libName,
      ok: res.code === 0,
      detail:
        res.code === 0
          ? 'graphics.h probe compiled successfully'
          : `probe failed (exit ${res.code})${tail ? ': ' + tail : ''}`,
      fix:
        res.code === 0
          ? undefined
          : libName === 'winbgim'
            ? FIX_WINDOWS
            : libName === 'sdl_bgi'
              ? opts.platform === 'macos'
                ? FIX_SDL_BGI_MAC
                : FIX_SDL_BGI_LINUX
              : FIX_LIBGRAPH_LINUX
    };
  } catch (e) {
    return {
      name: libName,
      ok: false,
      detail: 'probe crashed: ' + String(e),
      fix: libName === 'winbgim' ? FIX_WINDOWS : FIX_SDL_BGI_LINUX
    };
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/** Libraries to probe per platform. */
export function librariesForPlatform(platform: Platform): Array<'winbgim' | 'sdl_bgi' | 'libgraph'> {
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
export async function probeEnvironment(opts: DoctorOptions): Promise<DoctorResult> {
  const compiler = opts.compilerPath && opts.compilerPath.length > 0 ? opts.compilerPath : 'g++';

  const versionRes = await runProcess(compiler, ['--version'], 15000);
  const versionLine = versionRes.stderr
    ? ''
    : '';
  const compilerCheck: DoctorCheck = {
    name: `compiler (${compiler})`,
    ok: versionRes.code === 0,
    detail:
      versionRes.code === 0
        ? 'found and executable'
        : `could not run "${compiler}" (exit ${versionRes.code})`,
    fix:
      versionRes.code === 0
        ? undefined
        : opts.platform === 'windows'
          ? 'Run "graphics.h: Full Setup (everything, automatic)" — it installs g++ + WinBGIM automatically (winget or direct download, no admin rights). Or set "graphics-h-runner.compilerPath" to an existing g++.exe.'
          : 'Install g++ (e.g. sudo apt install build-essential) or set "graphics-h-runner.compilerPath".'
  };
  void versionLine;

  const libs = librariesForPlatform(opts.platform);
  const libraryChecks: DoctorCheck[] = [];
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
