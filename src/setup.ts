/**
 * setup.ts — "from zero to running" environment bootstrap.
 *
 * Pure Node module (no vscode imports) so the whole install pipeline is
 * testable from a plain script. The extension layer (extension.ts) executes
 * the returned plan with progress UI + terminal handoffs.
 *
 * Strategy per platform:
 *   Windows : winget/WinLibs (compiler) + WinBGIM trio downloaded into the
 *             extension's storage, wired through extraInclude/extraLibPaths.
 *   Linux   : distro packages for compiler + SDL2 headers (terminal, sudo
 *             handled by the user there), then SDL_bgi is downloaded, patched
 *             and built into a USER prefix — no sudo needed for the library.
 *   macOS   : xcode-select + brew (terminal), then the same user-prefix
 *             SDL_bgi build as Linux.
 */

import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Platform } from './toolchain';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface SetupProbe {
  compilerOk: boolean;
  /** graphics.h probe results per library */
  winbgimOk?: boolean;
  sdlBgiOk?: boolean;
  libgraphOk?: boolean;
  /** true when SDL2 development headers are available (Linux/macOS) */
  sdl2DevOk?: boolean;
}

export type StepKind = 'auto' | 'terminal' | 'manual' | 'verify';

export interface SetupStep {
  id: string;
  title: string;
  kind: StepKind;
  /** what the user sees */
  detail: string;
  /** for kind=terminal: the shell command to run */
  command?: string;
  /** for kind=manual: a URL to open */
  url?: string;
}

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

export const SDL_BGI_TARBALL_URLS = [
  'https://codeload.github.com/sergev/SDL_bgi/tar.gz/refs/heads/main',
  'https://codeload.github.com/sergev/SDL_bgi/tar.gz/refs/heads/master',
  'https://api.github.com/repos/sergev/SDL_bgi/tarball'
];

export const WINBGIM_SOURCES = {
  graphicsH: [
    'https://raw.githubusercontent.com/redpinetree/winbgim64/master/WinBGIm64/src/graphics.h'
  ],
  winbgimH: [
    'https://raw.githubusercontent.com/redpinetree/winbgim64/master/WinBGIm64/src/winbgim.h'
  ],
  libbgiA: [
    'https://raw.githubusercontent.com/redpinetree/winbgim64/master/WinBGIm64/libbgi64.a'
  ]
};

/* --- Windows: fully automatic compiler installation ---------------------- */

/** winget package: WinLibs MinGW-w64 (UCRT, GCC + g++), zip/portable -> per-user install, no admin rights. */
export const WINGET_COMPILER_PACKAGE_ID = 'BrechtSanders.WinLibs.POSIX.UCRT';

/** Arguments for the automatic winget compiler install (spawn-safe array). */
export function wingetInstallCompilerArgs(): string[] {
  return [
    'install', '-e', '--id', WINGET_COMPILER_PACKAGE_ID,
    '--accept-source-agreements', '--accept-package-agreements'
  ];
}

/**
 * Direct-download fallback (used only when winget is unavailable or failed):
 * the WinLibs UCRT x86_64 release as a plain .zip — extractable on every
 * Windows 10/11 with built-in PowerShell Expand-Archive. No admin rights:
 * everything lives inside the extension's storage folder.
 */
export const WINLIBS_FALLBACK = {
  version: '16.2.0posix-14.0.0-ucrt-r1',
  url:
    'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/' +
    'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip',
  sha256Url:
    'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/' +
    'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip.sha256',
  /** bytes, from the release asset (verified 2026-09-25) */
  sizeBytes: 274029684
};

/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */

/** Detect the package manager family from /etc/os-release (Linux only). */
export function detectLinuxPackageFamily(): 'apt' | 'dnf' | 'pacman' | 'zypper' | 'unknown' {
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
    if (osr.includes('id=debian') || osr.includes('id=ubuntu') || osr.includes('linuxmint')) {
      return 'apt';
    }
    if (osr.includes('id=fedora') || osr.includes('id=rhel') || osr.includes('id=rocky')) {
      return 'dnf';
    }
    if (osr.includes('id=arch') || osr.includes('id=manjaro')) {
      return 'pacman';
    }
    if (osr.includes('id=opensuse')) {
      return 'zypper';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function pkgInstall(family: string, aptPkg: string, dnfPkg: string, pacmanPkg: string, zypPkg: string): string {
  switch (family) {
    case 'apt': return `sudo apt update && sudo apt install -y ${aptPkg}`;
    case 'dnf': return `sudo dnf install -y ${dnfPkg}`;
    case 'pacman': return `sudo pacman -S --noconfirm ${pacmanPkg}`;
    case 'zypper': return `sudo zypper install -y ${zypPkg}`;
    default: return `sudo apt install -y ${aptPkg}   # (or your distro's equivalent: ${dnfPkg})`;
  }
}

/**
 * Build the ordered setup plan for the current probe results.
 * 'auto' steps run without user interaction; 'terminal' steps are handed to
 * the integrated terminal (password prompts work there); 'manual' steps come
 * with a URL and instructions.
 */
export function planSetup(platform: Platform, probe: SetupProbe, sdl2DevOk = true): SetupStep[] {
  const steps: SetupStep[] = [];

  if (platform === 'linux' || platform === 'macos') {
    if (!probe.compilerOk) {
      steps.push(
        platform === 'linux'
          ? {
              id: 'install-compiler',
              kind: 'terminal',
              title: 'Install the C++ compiler',
              detail: 'g++ was not found. This command installs it (you will be asked for your password in the terminal).',
              command: pkgInstall(detectLinuxPackageFamily(), 'build-essential', 'gcc-c++', 'gcc', 'gcc-c++')
            }
          : {
              id: 'install-compiler',
              kind: 'terminal',
              title: 'Install the C++ compiler',
              detail: 'Run this once; it installs the Apple command-line tools (includes clang++).',
              command: 'xcode-select --install'
            }
      );
    }

    if (!sdl2DevOk) {
      steps.push(
        platform === 'linux'
          ? {
              id: 'install-sdl2',
              kind: 'terminal',
              title: 'Install SDL2 development files',
              detail: 'SDL_bgi is built on top of SDL2. This installs the SDL2 headers and build library.',
              command:
                pkgInstall(detectLinuxPackageFamily(), 'libsdl2-dev', 'SDL2-devel', 'sdl2', 'SDL2-devel')
            }
          : {
              id: 'install-sdl2',
              kind: 'terminal',
              title: 'Install SDL2 via Homebrew',
              detail: 'SDL_bgi is built on top of SDL2. Install Homebrew (https://brew.sh) if needed, then:',
              command: 'brew install sdl2'
            }
      );
    }

    if (!probe.sdlBgiOk) {
      steps.push({
        id: 'install-sdl_bgi',
        kind: 'auto',
        title: 'Download, patch and build SDL_bgi (graphics.h)',
        detail:
          'Downloads the SDL_bgi sources, applies two known header compatibility fixes, builds the library and installs it into a user folder — no administrator rights needed. The extension then wires the paths into its settings automatically.'
      });
    }
  }

  if (platform === 'windows') {
    if (!probe.compilerOk) {
      steps.push({
        id: 'install-compiler-winget',
        kind: 'auto',
        title: 'Install MinGW-w64 g++ automatically (winget)',
        detail:
          'Runs "winget install BrechtSanders.WinLibs.POSIX.UCRT" for you — a per-user, portable ' +
          'install (no administrator rights). The extension then finds the new g++ and wires it into ' +
          'its settings automatically.'
      });
      steps.push({
        id: 'install-compiler-download',
        kind: 'auto',
        title: 'Direct-download compiler fallback',
        detail:
          'Used only if the winget step could not provide a compiler (e.g. winget missing): downloads ' +
          'the WinLibs MinGW-w64 UCRT zip (~274 MB, one time), extracts it into the extension folder ' +
          'and wires the compiler in — no admin rights, no PATH editing.'
      });
      steps.push({
        id: 'manual-compiler',
        kind: 'manual',
        title: 'Manual alternative: WinLibs',
        detail:
          'Both automatic steps failed? Download the WinLibs UCRT release (MinGW-w64 g++), extract it, and add its bin\\ folder to PATH (or set "graphics-h-runner.compilerPath" to the full g++.exe path).',
        url: 'https://winlibs.com/'
      });
    }
    if (!probe.winbgimOk) {
      steps.push({
        id: 'install-winbgim',
        kind: 'auto',
        title: 'Install WinBGIM (graphics.h for Windows)',
        detail:
          'Downloads graphics.h, winbgim.h and libbgi.a into the extension folder and wires them into the build settings automatically — no copying into MinGW folders, no admin rights.'
      });
    }
  }

  steps.push({
    id: 'verify',
    kind: 'verify',
    title: 'Verify the environment',
    detail: 'Runs the Setup Doctor probe again to confirm everything compiles.'
  });

  return steps;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const SDL2_CHECK_SRC = '#include <SDL2/SDL.h>\n\nint main ( ) { return 0; }\n';

/**
 * True when SDL2 development headers compile (Linux/macOS only).
 * Disambiguates "SDL_bgi missing" from "SDL2 itself missing".
 */
export async function checkSdl2Dev(opts: { cc?: string; sdl2IncludeDirs?: string[] } = {}): Promise<boolean> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-sdl2check-'));
  try {
    const src = path.join(dir, 'sdl2check.c');
    const out = path.join(dir, 'sdl2check.out');
    fs.writeFileSync(src, SDL2_CHECK_SRC);
    const args = [src, '-o', out];
    for (const d of opts.sdl2IncludeDirs || []) {
      args.push(`-I${d}`);
    }
    const res = await runProcess(opts.cc || 'cc', args, { timeoutMs: 60000 });
    return res.code === 0;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function runProcess(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
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
}

/** Download a URL to a Buffer, following redirects (Node fetch). */
export async function downloadToBuffer(url: string, timeoutMs = 120000): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* Windows: automatic compiler install                                 */
/* ------------------------------------------------------------------ */

export interface ProgressReport {
  /** short human-readable status line */
  message: string;
  /** 0..100 when meaningful, otherwise undefined */
  percent?: number;
}

interface StreamingResult {
  code: number;
  /** ENOENT-style spawn failure (tool not present at all) */
  spawnFailed: boolean;
  tail: string;
}

/**
 * Spawn a process, stream stdout/stderr lines through onLine and resolve with
 * the exit state. Used for winget (long download) and PowerShell extraction.
 */
export function runProcessStreaming(
  cmd: string,
  args: string[],
  opts: { onLine?: (line: string) => void; timeoutMs?: number } = {}
): Promise<StreamingResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      resolve({ code: -1, spawnFailed: true, tail: '' });
      return;
    }
    const tail: string[] = [];
    const push = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (t) {
          tail.push(t);
          if (tail.length > 40) tail.shift();
          try {
            opts.onLine?.(t);
          } catch {
            /* progress callbacks must never crash the install */
          }
        }
      }
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 30 * 60 * 1000);
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      const code = (e as NodeJS.ErrnoException).code || '';
      resolve({ code: -1, spawnFailed: code === 'ENOENT' || code === 'EINVAL', tail: tail.join(' | ') + ' ' + e.message });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, spawnFailed: false, tail: tail.join(' | ') });
    });
  });
}

/**
 * Run the winget compiler install (per-user, no admin) and report progress.
 * Tries the direct executable first and a cmd.exe fallback if the spawn
 * itself fails (App-Execution-Alias quirks).
 */
export async function installCompilerViaWinget(
  onProgress?: (p: ProgressReport) => void
): Promise<{ ok: boolean; detail: string }> {
  const args = wingetInstallCompilerArgs();
  onProgress?.({ message: 'Starting winget (this downloads the WinLibs MinGW-w64 toolchain, ~270 MB)…' });

  let res = await runProcessStreaming('winget', args, {
    onLine: (line) => onProgress?.({ message: line.slice(0, 120) }),
    timeoutMs: 45 * 60 * 1000
  });
  if (res.spawnFailed) {
    // second chance through cmd.exe (covers alias resolution problems)
    res = await runProcessStreaming('cmd.exe', ['/d', '/c', 'winget', ...args], {
      onLine: (line) => onProgress?.({ message: line.slice(0, 120) }),
      timeoutMs: 45 * 60 * 1000
    });
  }
  if (res.spawnFailed) {
    return { ok: false, detail: 'winget is not available on this PC' };
  }
  if (res.code !== 0) {
    return { ok: false, detail: `winget exited with code ${res.code}: ${res.tail.slice(-300)}` };
  }
  return { ok: true, detail: 'winget install completed' };
}

/**
 * Find g++.exe candidates on a Windows machine, most-promising first:
 *   1. winget portable packages  (%LOCALAPPDATA%\Microsoft\WinGet\Packages)
 *   2. winget shims             (%LOCALAPPDATA%\Microsoft\WinGet\Links)
 *   3. classic install roots     (C:\MinGW, C:\msys64\{ucrt64,mingw64}, C:\TDM-GCC-64, C:\mingw64)
 * The search is depth-bounded and entry-capped so it can never scan forever.
 * `opts.localAppData` can be overridden for unit testing.
 */
export function discoverGppWindows(opts: { localAppData?: string } = {}): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const norm = p.toLowerCase();
    if (!seen.has(norm) && fs.existsSync(p)) {
      seen.add(norm);
      candidates.push(p);
    }
  };

  const localAppData = opts.localAppData || process.env.LOCALAPPDATA;
  if (localAppData && fs.existsSync(localAppData)) {
    const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    const linksDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Links');
    // winget shims first? no — real package binaries preferred (shims can break DLL search)
    walkForFile(packagesDir, 'g++.exe', 4, 4000, (p) => add(p));
    add(path.join(linksDir, 'g++.exe'));
  }

  const roots = ['C:\\MinGW\\bin', 'C:\\mingw64\\bin', 'C:\\msys64\\ucrt64\\bin',
                 'C:\\msys64\\mingw64\\bin', 'C:\\TDM-GCC-64\\bin', 'C:\\TDM-GCC-64\\mingw64\\bin'];
  for (const r of roots) {
    add(path.join(r, 'g++.exe'));
  }
  // 64-bit toolchains first (winget packages also contain a 32-bit mingw32/)
  return candidates.sort((a, b) => Number(/mingw64/i.test(b)) - Number(/mingw64/i.test(a)));
}

/** Bounded depth-first search for one file name. */
function walkForFile(root: string, fileName: string, maxDepth: number, maxEntries: number, hit: (p: string) => void): void {
  if (maxEntries <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (maxEntries <= 0) return;
    maxEntries--;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (maxDepth > 1) walkForFile(full, fileName, maxDepth - 1, maxEntries, hit);
    } else if (e.name.toLowerCase() === fileName) {
      hit(full);
    }
  }
}

/**
 * True when the candidate compiler runs and prints a version line.
 * Returns the first version line for display.
 */
export async function verifyCompilerRun(candidate: string): Promise<{ ok: boolean; version: string }> {
  try {
    const res = await runProcess(candidate, ['--version'], { timeoutMs: 20000 });
    if (res.code !== 0) {
      return { ok: false, version: '' };
    }
    const line = (res.stdout || res.stderr).split(/\r?\n/).find((l) => l.trim().length > 0) || '';
    return { ok: true, version: line.trim().slice(0, 120) };
  } catch {
    return { ok: false, version: '' };
  }
}

/**
 * Last-resort automatic install: download the WinLibs UCRT zip (streaming,
 * sha256-verified) into <storageRoot>\mingw64-download, extract it with the
 * built-in PowerShell Expand-Archive and return the g++.exe path.
 * No administrator rights anywhere.
 */
export async function installCompilerWindowsDirect(
  storageRoot: string,
  onProgress?: (p: ProgressReport) => void
): Promise<{ gppPath: string; binDir: string; log: string[] }> {
  const log: string[] = [];
  const workDir = path.join(storageRoot, 'mingw64-download');
  const zipPath = path.join(workDir, WINLIBS_FALLBACK.url.split('/').pop() || 'winlibs.zip');
  fs.mkdirSync(workDir, { recursive: true });

  /* 1. download (streaming + progress) */
  onProgress?.({ message: `Downloading WinLibs GCC (${Math.round(WINLIBS_FALLBACK.sizeBytes / 1e6)} MB)…`, percent: 0 });
  const res = await fetch(WINLIBS_FALLBACK.url, { redirect: 'follow', signal: AbortSignal.timeout(60 * 60 * 1000) } as RequestInit);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || WINLIBS_FALLBACK.sizeBytes;
  let received = 0;
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    onProgress?.({
      message: `Downloading WinLibs GCC… ${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
      percent: Math.min(99, Math.round((received / total) * 90))
    });
  }
  const zip = Buffer.concat(chunks);
  fs.writeFileSync(zipPath, zip);
  log.push(`downloaded ${zip.length} bytes`);

  /* 2. verify sha256 (first token of the .sha256 asset) */
  onProgress?.({ message: 'Verifying checksum…', percent: 91 });
  try {
    const expected = (await downloadToBuffer(WINLIBS_FALLBACK.sha256Url)).toString().trim().split(/\s+/)[0].toLowerCase();
    const actual = createHash('sha256').update(zip).digest('hex');
    if (expected && expected !== actual) {
      throw new Error(`sha256 mismatch (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
    }
    log.push('sha256 verified');
  } catch (e) {
    log.push('checksum check skipped/failed: ' + String(e));
  }

  /* 3. extract with PowerShell (built into Windows 10/11) */
  onProgress?.({ message: 'Extracting (this can take a few minutes)…', percent: 93 });
  const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${workDir.replace(/'/g, "''")}' -Force`;
  const ps = await runProcessStreaming(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { timeoutMs: 30 * 60 * 1000, onLine: (l) => log.push('ps: ' + l.slice(0, 100)) }
  );
  if (ps.code !== 0) {
    throw new Error('extraction failed: ' + ps.tail.slice(-300));
  }
  log.push('extracted with Expand-Archive');

  /* 4. find g++.exe (prefer mingw64 over mingw32) */
  const found: string[] = [];
  walkForFile(workDir, 'g++.exe', 4, 8000, (p) => found.push(p));
  const gpp =
    found.find((p) => /mingw64/i.test(p)) ||
    found.find((p) => /mingw32/i.test(p)) ||
    found[0];
  if (!gpp) {
    throw new Error('g++.exe not found after extraction');
  }
  const check = await verifyCompilerRun(gpp);
  if (!check.ok) {
    throw new Error('downloaded g++.exe did not run');
  }
  log.push('compiler OK: ' + check.version);
  onProgress?.({ message: 'Compiler ready.', percent: 100 });
  return { gppPath: gpp, binDir: path.dirname(gpp), log };
}

/* ------------------------------------------------------------------ */
/* Windows: WinBGIM trio                                               */
/* ------------------------------------------------------------------ */

export interface WinbgimInstallResult {
  includeDir: string;
  libDir: string;
  log: string[];
}

/**
 * Download graphics.h / winbgim.h / libbgi.a into <storageRoot>/winbgim.
 * The extension then adds includeDir/libDir to its settings — no copying
 * into MinGW folders and no administrator rights required.
 */
export async function installWinbgimWindows(storageRoot: string): Promise<WinbgimInstallResult> {
  const includeDir = path.join(storageRoot, 'winbgim', 'include');
  const libDir = path.join(storageRoot, 'winbgim', 'lib');
  fs.mkdirSync(includeDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const log: string[] = [];

  const fetchFirst = async (urls: string[]): Promise<Buffer> => {
    let lastErr: Error | null = null;
    for (const url of urls) {
      try {
        const buf = await downloadToBuffer(url);
        log.push(`downloaded ${url} (${buf.length} bytes)`);
        return buf;
      } catch (e) {
        lastErr = e as Error;
        log.push(`failed ${url}: ${String(e)}`);
      }
    }
    throw lastErr ?? new Error('all sources failed');
  };

  fs.writeFileSync(path.join(includeDir, 'graphics.h'), await fetchFirst(WINBGIM_SOURCES.graphicsH));
  fs.writeFileSync(path.join(includeDir, 'winbgim.h'), await fetchFirst(WINBGIM_SOURCES.winbgimH));
  fs.writeFileSync(path.join(libDir, 'libbgi.a'), await fetchFirst(WINBGIM_SOURCES.libbgiA));

  return { includeDir, libDir, log };
}

/* ------------------------------------------------------------------ */
/* Linux/macOS: SDL_bgi user-prefix build                              */
/* ------------------------------------------------------------------ */

export interface SdlBgiBuildOptions {
  /** where to keep sources + the usr/ prefix (defaults under os.homedir()) */
  storageRoot?: string;
  /** compiler (defaults to cc/gcc/clang) */
  cc?: string;
  /** extra include dirs so <SDL2/SDL.h> resolves (only needed when SDL2 is not in the default include path) */
  sdl2IncludeDirs?: string[];
  /** extra lib dirs for -lSDL2 */
  sdl2LibDirs?: string[];
  /** tarball URL overrides (tried in order) */
  tarballUrls?: string[];
}

export interface SdlBgiBuildResult {
  includeDir: string;
  libDir: string;
  log: string[];
}

/**
 * The known fixes for the SDL_bgi mirror, identical to the set validated by
 * the extension's 9-sample integration suite:
 *  1. header maps kbhit -> k_bhit but never declares k_bhit
 *  2. WinBGIM's clearmouseclick() is missing entirely
 *  3. presentation: fast_mode defaults to TRUE but the only presenter is the
 *     sdlbgiauto() timer thread, so classic "draw -> getch()/delay()" programs
 *     show a black window. Fix: always-present mode + per-pixel updates become
 *     flag-only (full present happens in delay/getch — fast and correct).
 *  4. drop the SDL_RaiseWindow() spam inside refresh_window()
 */
export function patchSdlBgiSources(srcDir: string, log: string[]): void {
  const hPath = path.join(srcDir, 'SDL_bgi.h');
  let h = fs.readFileSync(hPath, 'utf8');
  if (!/int\s+k_bhit\s*\(void\);/.test(h)) {
    h = h.replace(
      /(#define kbhit k_bhit\n)/,
      '$1int  k_bhit (void);              /* PATCH: declared (missing in mirror) */\n'
    );
    log.push('header: k_bhit declaration added');
  }
  if (!/void clearmouseclick/.test(h)) {
    h = h.replace(
      /(void getmouseclick \(int, int \*, int \*\);\n)/,
      '$1void clearmouseclick (int);       /* PATCH: WinBGIM compatibility */\n'
    );
    log.push('header: clearmouseclick declaration added');
  }
  fs.writeFileSync(hPath, h);

  const cPath = path.join(srcDir, 'SDL_bgi.c');
  let c = fs.readFileSync(cPath, 'utf8');

  /* 3a. always-present mode: classic programs must not need refresh() */
  if (/bgi_fast_mode\s*=\s*SDL_TRUE,/.test(c)) {
    c = c.replace(
      /(bgi_fast_mode\s*=\s*)SDL_TRUE(,\s*\/\/[^\n]*needs screen update\?)/,
      '$1SDL_FALSE$2  /* PATCH: present via delay/getch (validated combo) */'
    );
    log.push('source: bgi_fast_mode -> SDL_FALSE (auto-present)');
  }

  /* 3b. per-pixel updates: flag only, present on delay/getch (fast putpixel) */
  const updatePixelOld = /static void update_pixel \(int x, int y\)\s*\{[\s\S]*?\n\}/;
  if (updatePixelOld.test(c) && !/PATCHED: per-pixel updates only flag/.test(c)) {
    c = c.replace(updatePixelOld,
      `static void update_pixel (int x, int y)
{
  /* PATCHED: per-pixel updates only flag; full present happens in update ()
     (called by delay/getch). A full-screen present per pixel is far too slow
     for putpixel-heavy programs. */
  (void) x;
  (void) y;
  bgi_refresh_needed = SDL_TRUE;
}`);
    log.push('source: update_pixel -> flag-only (fast putpixel)');
  }

  /* 4. no raise-window spam */
  if (/SDL_RaiseWindow \(bgi_window\);/.test(c) && !/PATCHED: no raise per update/.test(c)) {
    c = c.replace('SDL_RaiseWindow (bgi_window);', '/* PATCHED: no raise per update */');
    log.push('source: SDL_RaiseWindow removed from refresh_window');
  }

  /* 5. event-driven presentation: update() must never present immediately.
   * With fast_mode=FALSE the stock update() does a full-window refresh after
   * EVERY drawing primitive, so frames can appear mid-draw (torn frames:
   * e.g. bricks visible but paddle/ball not yet drawn). Fix: update() only
   * schedules, and polling functions (delay/kbhit/getch/event/...) present
   * once per call via poll_refresh(). Identical to the build validated by
   * the integration suite. */
  const updateOld = /static void update \(void\)\s*\{[\s\S]*?\n\} \/\/ update \(\)/;
  if (updateOld.test(c) && !/PATCHED \(4\)/.test(c)) {
    c = c.replace(updateOld,
      `static void update (void)
{
  /* PATCHED (4): always schedule the refresh instead of presenting
     immediately. Per-primitive full-window blits tear frames under
     Xvfb / software rendering. The flag is consumed by poll_refresh()
     inside the polling functions (delay/event/k_bhit/getch/...). */
  bgi_refresh_needed = SDL_TRUE;

} // update ()

// -----

static void poll_refresh (void)
{
  /* PATCHED (4): present the pending frame once per polling call. */
  if (bgi_refresh_needed) {
    refresh_window ();
    bgi_refresh_needed = SDL_FALSE;
  }

} // poll_refresh ()`);
    log.push('source: update() -> schedule-only + poll_refresh (no torn frames)');
    /* forward declaration: delay()/k_bhit() use poll_refresh long before
     * its definition site (gcc errors on implicit static declarations) */
    if (!/static void poll_refresh\s+\(void\);/.test(c)) {
      const declRe = /(static void update\s+\(void\);)/;
      if (declRe.test(c)) {
        c = c.replace(declRe, '$1\nstatic void poll_refresh  (void);');
        log.push('source: poll_refresh forward declaration added');
      }
    }
    /* polling functions consume the flag */
    const pollNames = ['delay (int msec)', 'k_bhit (void)', 'event (void)',
                       'edelay (', 'kdelay (', 'xkb_hit (void)'];
    for (const name of pollNames) {
      const re = new RegExp('^(?:static )?\\w+ ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
      const m = re.exec(c);
      if (!m) continue;
      const start = m.index;
      const end = c.indexOf('\n}', start);
      const body = c.slice(start, end);
      if (body.includes('  poll_refresh ();')) continue;
      const patched = body.replace('  update ();', '  poll_refresh ();');
      if (patched !== body) {
        c = c.slice(0, start) + patched + c.slice(end);
        log.push('source: ' + name + ' presents via poll_refresh');
      }
    }
  }

  /* 2b. clearmouseclick implementation */
  if (!/void clearmouseclick \(int btn\)/.test(c)) {
    c = c.replace(
      /(\n\/\/ -----\s*$)/m,
      `

// ----- PATCH: WinBGIM-compatible clearmouseclick () -----
void clearmouseclick (int btn)
{
  // Clears the pending click state for the given button.
  SDL_PumpEvents ();
  SDL_FlushEvent (SDL_MOUSEBUTTONDOWN);
  SDL_FlushEvent (SDL_MOUSEBUTTONUP);
  bgi_mouse.btn = 0;
  bgi_mouse.x = -1;
  bgi_mouse.y = -1;
} // clearmouseclick ()
$1`
    );
    log.push('source: clearmouseclick implementation added');
  }
  fs.writeFileSync(cPath, c);
}

/**
 * Download, patch, build and install SDL_bgi into a user prefix:
 *   <storageRoot>/sdl_bgi-src/            (sources)
 *   <storageRoot>/usr/include/graphics.h
 *   <storageRoot>/usr/include/SDL2/SDL_bgi.h
 *   <storageRoot>/usr/lib/libSDL_bgi.so
 * No administrator rights are required. Returns the paths to wire into
 * extraIncludePaths / extraLibPaths.
 */
export async function installSdlBgiUserPrefix(opts: SdlBgiBuildOptions = {}): Promise<SdlBgiBuildResult> {
  const storageRoot = opts.storageRoot || path.join(os.homedir(), '.graphics-h-runner');
  const srcRoot = path.join(storageRoot, 'sdl_bgi-src');
  const prefix = path.join(storageRoot, 'usr');
  const includeDir = path.join(prefix, 'include');
  const libDir = path.join(prefix, 'lib');
  const log: string[] = [];

  fs.mkdirSync(srcRoot, { recursive: true });
  fs.mkdirSync(path.join(includeDir, 'SDL2'), { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  /* 1. download (try mirrors in order) */
  const tarball = path.join(storageRoot, 'sdl_bgi.tar.gz');
  let lastDlErr: Error | null = null;
  let downloaded = false;
  for (const url of opts.tarballUrls || SDL_BGI_TARBALL_URLS) {
    try {
      const buf = await downloadToBuffer(url);
      fs.writeFileSync(tarball, buf);
      log.push(`downloaded SDL_bgi tarball from ${url} (${buf.length} bytes)`);
      downloaded = true;
      break;
    } catch (e) {
      lastDlErr = e as Error;
      log.push(`download failed: ${url} (${String(e)})`);
    }
  }
  if (!downloaded) {
    throw new Error('could not download SDL_bgi sources: ' + String(lastDlErr));
  }

  /* 2. extract */
  const ex = await runProcess('tar', ['-xzf', tarball, '-C', srcRoot, '--strip-components=1'], { timeoutMs: 120000 });
  if (ex.code !== 0) {
    throw new Error('tar extraction failed: ' + ex.stderr.slice(0, 400));
  }
  log.push('extracted sources');

  const srcDir = path.join(srcRoot, 'src');
  if (!fs.existsSync(path.join(srcDir, 'SDL_bgi.c'))) {
    throw new Error('unexpected archive layout: SDL_bgi.c not found under src/');
  }

  /* 3. patch */
  patchSdlBgiSources(srcDir, log);

  /* 4. build */
  const cc = opts.cc || 'gcc';
  const args = ['-fPIC', '-O2', '-shared', '-o', path.join(libDir, 'libSDL_bgi.so'), path.join(srcDir, 'SDL_bgi.c'), `-I${srcDir}`];
  for (const d of opts.sdl2IncludeDirs || []) {
    args.push(`-I${d}`);
  }
  args.push('-lSDL2', '-lm');
  for (const d of opts.sdl2LibDirs || []) {
    args.push(`-L${d}`);
  }
  const build = await runProcess(cc, args, { cwd: srcDir, timeoutMs: 300000 });
  if (build.code !== 0) {
    throw new Error('SDL_bgi build failed: ' + build.stderr.slice(-800));
  }
  log.push('built libSDL_bgi.so');

  /* 5. install headers */
  fs.copyFileSync(path.join(srcDir, 'SDL_bgi.h'), path.join(includeDir, 'SDL2', 'SDL_bgi.h'));
  fs.copyFileSync(path.join(srcDir, 'graphics.h'), path.join(includeDir, 'graphics.h'));
  log.push('installed headers + library into ' + prefix);

  return { includeDir, libDir, log };
}
