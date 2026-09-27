/**
 * globalize.ts — "make graphics.h work ANYWHERE" (global) setup.
 *
 * v1.5.1 major feature requested by users: after "Complete Run Setup" the
 * toolchain must serve the WHOLE machine, not just this extension. Concretely,
 * on Windows:
 *   1. WinBGIM (graphics.h, winbgim.h, libbgi.a) is copied into the compiler
 *      toolchain's OWN include/lib folders — MinGW resolves them with zero
 *      -I/-L flags, so `g++ main.cpp -o main.exe -lbgi ...` works from any
 *      terminal, IDE or build script.
 *   2. The toolchain's bin folder is appended to the USER PATH in the
 *      registry (HKCU\Environment\Path, REG_EXPAND_SZ preserved, idempotent),
 *      with a best-effort WM_SETTINGCHANGE broadcast so new processes see it.
 *   3. A probe compile WITHOUT any extension settings verifies the result:
 *      only a real `#include <graphics.h>` + `-lbgi` build proves "global".
 *   4. A small readme with the universal command lands in the toolchain root.
 *
 * Everything is idempotent and per-user (no admin rights). Pure Node module
 * with an injectable process runner, so the whole flow is unit-testable.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { universalCommandDoc, buildAnywhereReadme } from './runwrap';

export interface RunnerResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner (tests plug a fake; prod uses execFile). */
export type Runner = (
  cmd: string,
  args: string[],
  timeoutMs?: number
) => Promise<RunnerResult>;

export const defaultRunner: Runner = (cmd, args, timeoutMs = 30000) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const anyErr = err as { code?: number | string } | null;
        resolve({
          code: err ? (typeof anyErr?.code === 'number' ? anyErr.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      }
    );
  });

export interface GlobalTargets {
  binDir: string;
  toolchainRoot: string;
  /** include dirs tried in order (toolchain layout variations) */
  includeCandidates: string[];
  /** lib dirs tried in order, parallel to includeCandidates */
  libCandidates: string[];
  triplet: string | null;
}

/**
 * Derive where WinBGIM must land so the compiler finds it WITHOUT flags.
 * WinLibs / MSYS2 / Code::Blocks / TDM all follow <root>/bin/g++ with
 * <root>/include + <root>/lib (MSYS2 additionally mirrors <root>/<triplet>).
 */
export function computeGlobalTargets(compilerPath: string): GlobalTargets {
  const binDir = path.dirname(path.resolve(compilerPath));
  const toolchainRoot = path.dirname(binDir);
  const m = /((?:x86_64|i686)-w64-mingw32)/i.exec(compilerPath);
  const triplet = m ? m[1] : null;
  const includeCandidates = [path.join(toolchainRoot, 'include')];
  const libCandidates = [path.join(toolchainRoot, 'lib')];
  if (triplet) {
    includeCandidates.push(path.join(toolchainRoot, triplet, 'include'));
    libCandidates.push(path.join(toolchainRoot, triplet, 'lib'));
  }
  return { binDir, toolchainRoot, includeCandidates, libCandidates, triplet };
}

/** Windows `where` / POSIX `which` — first absolute hit that exists on disk. */
export async function resolveCompilerOnPath(
  compilerPath: string,
  platform: string,
  runner: Runner
): Promise<string | null> {
  if (path.isAbsolute(compilerPath) && fs.existsSync(compilerPath)) {
    return compilerPath;
  }
  try {
    const res = await runner(platform === 'windows' ? 'where' : 'which', [compilerPath], 15000);
    if (res.code !== 0) {
      return null;
    }
    for (const line of res.stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Extract the raw (unexpanded) value from `reg query HKCU\Environment /v Path`. */
export function parseRegQueryPath(stdout: string): string | null {
  const m = /^[ \t]*Path[ \t]+REG_(?:EXPAND_)?SZ[ \t]+(.*)$/im.exec(stdout || '');
  return m ? m[1].trimEnd() : null;
}

/**
 * Append one entry to a raw PATH string. Idempotent (case-insensitive,
 * trailing-backslash-insensitive), order-preserving, semicolon-safe.
 */
export function appendPathEntry(
  raw: string | null,
  dir: string
): { next: string; changed: boolean } {
  const wanted = path.normalize(dir).replace(/[\\/]+$/, '').toLowerCase();
  const entries =
    raw === null
      ? []
      : raw
          .split(';')
          .map((e) => e.trim())
          .filter((e) => e.length > 0);
  const exists = entries.some(
    (e) => path.normalize(e).replace(/[\\/]+$/, '').toLowerCase() === wanted
  );
  if (exists) {
    return { next: entries.join(';'), changed: false };
  }
  entries.push(dir);
  return { next: entries.join(';'), changed: true };
}

const GLOBAL_PROBE_SOURCE =
  '#include <graphics.h>\n\nint main ( ) { circle ( 100, 100, 50 ); return 0; }\n';

export interface GlobalizeOptions {
  /** absolute, healed path to g++.exe */
  compilerPath: string;
  /** folder that already contains graphics.h + winbgim.h */
  includeDir: string;
  /** folder that already contains libbgi.a */
  libDir: string;
  runner?: Runner;
  onLog?: (line: string) => void;
}

export interface GlobalizeResult {
  /** true when the no-flags probe compile succeeded in the toolchain */
  globalProbeOk: boolean;
  /** user PATH now contains the compiler bin dir */
  pathOk: boolean;
  /** true when this run actually appended a new entry */
  pathChanged: boolean;
  includeTarget?: string;
  libTarget?: string;
  universalCommand: string;
  log: string[];
}

/**
 * Full Windows global-setup flow. Idempotent: re-running refreshes the
 * copies, keeps the PATH entry unique and re-verifies with a probe compile.
 */
export async function makeGlobalWindows(opts: GlobalizeOptions): Promise<GlobalizeResult> {
  const runner = opts.runner || defaultRunner;
  const log: string[] = [];
  const say = (l: string) => {
    log.push(l);
    try {
      opts.onLog?.(l);
    } catch {
      /* progress callbacks must never crash the setup */
    }
  };

  const gfx = path.join(opts.includeDir, 'graphics.h');
  const wbh = path.join(opts.includeDir, 'winbgim.h');
  const lib = path.join(opts.libDir, 'libbgi.a');
  for (const f of [gfx, wbh, lib]) {
    if (!fs.existsSync(f)) {
      throw new Error('WinBGIM file missing: ' + f + ' — run the WinBGIM setup step first');
    }
  }

  /* v1.5.6 SAFETY GATE: the compiler path must resolve to a REAL toolchain.
   * A bare "g++" (compiler found on PATH, never written back as an absolute
   * path) used to be resolved against the extension host's CWD — producing
   * garbage targets like binDir=<VS Code install dir> and toolchainRoot=E:\ ,
   * which then polluted the user PATH and littered the drive root. */
  const realCompiler = await resolveCompilerOnPath(opts.compilerPath, 'windows', runner);
  if (!realCompiler) {
    say(
      'could not locate the real toolchain folder for "' + opts.compilerPath +
        '" — global setup skipped. The extension itself keeps working via its settings. ' +
        '(Set "graphics-h-runner.compilerPath" to the full g++.exe path to enable global setup.)'
    );
    return {
      globalProbeOk: false,
      pathOk: false,
      pathChanged: false,
      universalCommand: universalCommandDoc(),
      log
    };
  }
  const exeName = path.basename(realCompiler);
  const targets = computeGlobalTargets(realCompiler);
  if (!fs.existsSync(path.join(targets.binDir, exeName))) {
    say(
      'compiler location check failed (' + targets.binDir + ' does not contain ' + exeName +
        ') — global setup skipped to avoid touching the wrong folders.'
    );
    return {
      globalProbeOk: false,
      pathOk: false,
      pathChanged: false,
      universalCommand: universalCommandDoc(),
      log
    };
  }
  say('toolchain root: ' + targets.toolchainRoot + ' (compiler: ' + realCompiler + ')');

  /* 1. copy the trio into the toolchain's own include/lib, probe-compile
   *    with ZERO -I/-L flags; on failure try the next layout candidate. */
  let globalProbeOk = false;
  let includeTarget: string | undefined;
  let libTarget: string | undefined;

  for (let i = 0; i < targets.includeCandidates.length && !globalProbeOk; i++) {
    const incDir = targets.includeCandidates[i];
    const libDir = targets.libCandidates[i];
    try {
      fs.mkdirSync(incDir, { recursive: true });
      fs.mkdirSync(libDir, { recursive: true });
      if (path.resolve(incDir) !== path.resolve(opts.includeDir)) {
        fs.copyFileSync(gfx, path.join(incDir, 'graphics.h'));
        fs.copyFileSync(wbh, path.join(incDir, 'winbgim.h'));
      }
      if (path.resolve(libDir) !== path.resolve(opts.libDir)) {
        fs.copyFileSync(lib, path.join(libDir, 'libbgi.a'));
      }
    } catch (e) {
      say('copy into ' + incDir + ' failed: ' + String(e));
      continue;
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-global-'));
    try {
      const srcPath = path.join(dir, 'global_probe.cpp');
      const outPath = path.join(dir, 'global_probe.exe');
      fs.writeFileSync(srcPath, GLOBAL_PROBE_SOURCE);
      const res = await runner(
        opts.compilerPath,
        [
          srcPath,
          '-o',
          outPath,
          '-lbgi',
          '-lgdi32',
          '-lcomdlg32',
          '-luuid',
          '-loleaut32',
          '-lole32'
        ],
        60000
      );
      if (res.code === 0) {
        globalProbeOk = true;
        includeTarget = incDir;
        libTarget = libDir;
        say('probe compile WITHOUT -I/-L flags: OK (headers: ' + incDir + ')');
      } else {
        say('probe with ' + incDir + ' failed (exit ' + res.code + '): ' + res.stderr.trim().split(/\r?\n/).slice(-1)[0].slice(0, 200));
      }
    } catch (e) {
      say('probe crashed: ' + String(e));
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /* 2. user PATH += <binDir> (registry, idempotent, REG_EXPAND_SZ kept) */
  let pathOk = false;
  let pathChanged = false;
  try {
    const q = await runner('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], 15000);
    const raw = q.code === 0 ? parseRegQueryPath(q.stdout) : null;
    const { next, changed } = appendPathEntry(raw, targets.binDir);
    if (!changed) {
      pathOk = true;
      say('user PATH already contains ' + targets.binDir);
    } else {
      const add = await runner(
        'reg',
        ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', next, '/f'],
        15000
      );
      pathOk = add.code === 0;
      pathChanged = pathOk;
      say(pathOk ? 'user PATH updated (+ ' + targets.binDir + ')' : 'reg add failed (exit ' + add.code + '): ' + add.stderr.trim().slice(0, 200));
    }
  } catch (e) {
    say('PATH update skipped: ' + String(e));
  }

  /* 3. best-effort WM_SETTINGCHANGE so freshly started apps see the new PATH */
  if (pathChanged) {
    const ps =
      "$sig='[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);';" +
      '$t=Add-Type -MemberDefinition $sig -Name GhrEnv -Namespace Win32 -PassThru;' +
      '[UIntPtr]$r=[UIntPtr]::Zero;' +
      "$t::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r)|Out-Null";
    try {
      const b = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        20000
      );
      say(b.code === 0 ? 'environment change broadcast sent' : 'broadcast failed (non-fatal, exit ' + b.code + ')');
    } catch (e) {
      say('broadcast skipped: ' + String(e));
    }
  }

  /* 4. readme with the universal command (best effort) */
  try {
    fs.writeFileSync(
      path.join(targets.toolchainRoot, 'graphics-h-anywhere.txt'),
      buildAnywhereReadme(targets.binDir),
      'utf8'
    );
    say('readme written: ' + path.join(targets.toolchainRoot, 'graphics-h-anywhere.txt'));
  } catch (e) {
    say('readme skipped: ' + String(e));
  }

  return {
    globalProbeOk,
    pathOk,
    pathChanged,
    includeTarget,
    libTarget,
    universalCommand: universalCommandDoc(),
    log
  };
}
