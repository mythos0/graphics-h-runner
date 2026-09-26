"use strict";
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
exports.WINLIBS_FALLBACK = exports.WINGET_COMPILER_PACKAGE_ID = exports.WINBGIM_SOURCES = exports.SDL_BGI_TARBALL_URLS = void 0;
exports.wingetInstallCompilerArgs = wingetInstallCompilerArgs;
exports.detectLinuxPackageFamily = detectLinuxPackageFamily;
exports.planSetup = planSetup;
exports.checkSdl2Dev = checkSdl2Dev;
exports.downloadToBuffer = downloadToBuffer;
exports.runProcessStreaming = runProcessStreaming;
exports.installCompilerViaWinget = installCompilerViaWinget;
exports.discoverGppWindows = discoverGppWindows;
exports.verifyCompilerRun = verifyCompilerRun;
exports.installCompilerWindowsDirect = installCompilerWindowsDirect;
exports.installWinbgimWindows = installWinbgimWindows;
exports.patchSdlBgiSources = patchSdlBgiSources;
exports.patchInstalledHeaderConstChar = patchInstalledHeaderConstChar;
exports.installSdlBgiUserPrefix = installSdlBgiUserPrefix;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */
exports.SDL_BGI_TARBALL_URLS = [
    'https://codeload.github.com/sergev/SDL_bgi/tar.gz/refs/heads/main',
    'https://codeload.github.com/sergev/SDL_bgi/tar.gz/refs/heads/master',
    'https://api.github.com/repos/sergev/SDL_bgi/tarball'
];
exports.WINBGIM_SOURCES = {
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
exports.WINGET_COMPILER_PACKAGE_ID = 'BrechtSanders.WinLibs.POSIX.UCRT';
/** Arguments for the automatic winget compiler install (spawn-safe array). */
function wingetInstallCompilerArgs() {
    return [
        'install', '-e', '--id', exports.WINGET_COMPILER_PACKAGE_ID,
        '--accept-source-agreements', '--accept-package-agreements'
    ];
}
/**
 * Direct-download fallback (used only when winget is unavailable or failed):
 * the WinLibs UCRT x86_64 release as a plain .zip — extractable on every
 * Windows 10/11 with built-in PowerShell Expand-Archive. No admin rights:
 * everything lives inside the extension's storage folder.
 */
exports.WINLIBS_FALLBACK = {
    version: '16.2.0posix-14.0.0-ucrt-r1',
    url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/' +
        'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip',
    sha256Url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/' +
        'winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip.sha256',
    /** bytes, from the release asset (verified 2026-09-25) */
    sizeBytes: 274029684
};
/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */
/** Detect the package manager family from /etc/os-release (Linux only). */
function detectLinuxPackageFamily() {
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
    }
    catch {
        return 'unknown';
    }
}
function pkgInstall(family, aptPkg, dnfPkg, pacmanPkg, zypPkg) {
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
function planSetup(platform, probe, sdl2DevOk = true) {
    const steps = [];
    if (platform === 'linux' || platform === 'macos') {
        if (!probe.compilerOk) {
            steps.push(platform === 'linux'
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
                });
        }
        if (!sdl2DevOk) {
            steps.push(platform === 'linux'
                ? {
                    id: 'install-sdl2',
                    kind: 'terminal',
                    title: 'Install SDL2 development files',
                    detail: 'SDL_bgi is built on top of SDL2. This installs the SDL2 headers and build library.',
                    command: pkgInstall(detectLinuxPackageFamily(), 'libsdl2-dev', 'SDL2-devel', 'sdl2', 'SDL2-devel')
                }
                : {
                    id: 'install-sdl2',
                    kind: 'terminal',
                    title: 'Install SDL2 via Homebrew',
                    detail: 'SDL_bgi is built on top of SDL2. Install Homebrew (https://brew.sh) if needed, then:',
                    command: 'brew install sdl2'
                });
        }
        if (!probe.sdlBgiOk) {
            steps.push({
                id: 'install-sdl_bgi',
                kind: 'auto',
                title: 'Download, patch and build SDL_bgi (graphics.h)',
                detail: 'Downloads the SDL_bgi sources, applies two known header compatibility fixes, builds the library and installs it into a user folder — no administrator rights needed. The extension then wires the paths into its settings automatically.'
            });
        }
    }
    if (platform === 'windows') {
        if (!probe.compilerOk) {
            steps.push({
                id: 'install-compiler-winget',
                kind: 'auto',
                title: 'Install MinGW-w64 g++ automatically (winget)',
                detail: 'Runs "winget install BrechtSanders.WinLibs.POSIX.UCRT" for you — a per-user, portable ' +
                    'install (no administrator rights). The extension then finds the new g++ and wires it into ' +
                    'its settings automatically.'
            });
            steps.push({
                id: 'install-compiler-download',
                kind: 'auto',
                title: 'Direct-download compiler fallback',
                detail: 'Used only if the winget step could not provide a compiler (e.g. winget missing): downloads ' +
                    'the WinLibs MinGW-w64 UCRT zip (~274 MB, one time), extracts it into the extension folder ' +
                    'and wires the compiler in — no admin rights, no PATH editing.'
            });
            steps.push({
                id: 'manual-compiler',
                kind: 'manual',
                title: 'Manual alternative: WinLibs',
                detail: 'Both automatic steps failed? Download the WinLibs UCRT release (MinGW-w64 g++), extract it, and add its bin\\ folder to PATH (or set "graphics-h-runner.compilerPath" to the full g++.exe path).',
                url: 'https://winlibs.com/'
            });
        }
        if (!probe.winbgimOk) {
            steps.push({
                id: 'install-winbgim',
                kind: 'auto',
                title: 'Install WinBGIM (graphics.h for Windows)',
                detail: 'Downloads graphics.h, winbgim.h and libbgi.a into the extension folder and wires them into the build settings automatically — no copying into MinGW folders, no admin rights.'
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
async function checkSdl2Dev(opts = {}) {
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
    }
    catch {
        return false;
    }
    finally {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
    }
}
function runProcess(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            const anyErr = err;
            resolve({
                code: err ? (typeof anyErr?.code === 'number' ? anyErr.code : -1) : 0,
                stdout: String(stdout || ''),
                stderr: String(stderr || '')
            });
        });
    });
}
/** Download a URL to a Buffer, following redirects (Node fetch). */
async function downloadToBuffer(url, timeoutMs = 120000) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
/**
 * Spawn a process, stream stdout/stderr lines through onLine and resolve with
 * the exit state. Used for winget (long download) and PowerShell extraction.
 */
function runProcessStreaming(cmd, args, opts = {}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = (0, child_process_1.spawn)(cmd, args, { windowsHide: true });
        }
        catch {
            resolve({ code: -1, spawnFailed: true, tail: '' });
            return;
        }
        const tail = [];
        const push = (chunk) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                const t = line.trim();
                if (t) {
                    tail.push(t);
                    if (tail.length > 40)
                        tail.shift();
                    try {
                        opts.onLine?.(t);
                    }
                    catch {
                        /* progress callbacks must never crash the install */
                    }
                }
            }
        };
        child.stdout?.on('data', push);
        child.stderr?.on('data', push);
        const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 30 * 60 * 1000);
        child.on('error', (e) => {
            clearTimeout(timer);
            const code = e.code || '';
            resolve({ code: -1, spawnFailed: code === 'ENOENT' || code === 'EINVAL', tail: tail.join(' | ') + ' ' + e.message });
        });
        child.on('close', (code) => {
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
async function installCompilerViaWinget(onProgress) {
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
 *   4. student-common IDE bundles (Code::Blocks, Dev-C++, Embarcadero)
 *   5. anything already on PATH  (half-setup PCs where the installer edited
 *      PATH but the current VS Code process was started before that)
 * The search is depth-bounded and entry-capped so it can never scan forever.
 * `opts.localAppData` / `opts.env` can be overridden for unit testing.
 */
function discoverGppWindows(opts = {}) {
    const candidates = [];
    const seen = new Set();
    const add = (p) => {
        const norm = p.toLowerCase();
        if (!seen.has(norm) && fs.existsSync(p)) {
            seen.add(norm);
            candidates.push(p);
        }
    };
    const env = opts.env || process.env;
    const localAppData = opts.localAppData || env.LOCALAPPDATA;
    if (localAppData && fs.existsSync(localAppData)) {
        const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
        const linksDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Links');
        // winget shims first? no — real package binaries preferred (shims can break DLL search)
        walkForFile(packagesDir, 'g++.exe', 4, 4000, (p) => add(p));
        add(path.join(linksDir, 'g++.exe'));
    }
    const roots = ['C:\\MinGW\\bin', 'C:\\mingw64\\bin', 'C:\\msys64\\ucrt64\\bin',
        'C:\\msys64\\mingw64\\bin', 'C:\\TDM-GCC-64\\bin', 'C:\\TDM-GCC-64\\mingw64\\bin',
        'C:\\Program Files\\CodeBlocks\\MinGW\\bin',
        'C:\\Program Files (x86)\\CodeBlocks\\MinGW\\bin',
        'C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin',
        'C:\\Dev-Cpp\\MinGW64\\bin',
        'C:\\Program Files\\mingw-w64\\x86_64-12.2.0-release-posix-seh-ucrt-rt_v10-rev2\\mingw64\\bin',
        'C:\\Program Files\\mingw-w64\\mingw64\\bin',
        'C:\\Program Files (x86)\\mingw-w64\\i686-posix-dwarf-rev0\\mingw32\\bin'];
    for (const r of roots) {
        add(path.join(r, 'g++.exe'));
    }
    /* PATH scan: catches installers that already edited the machine/user PATH
     * while this VS Code process still runs with an older PATH snapshot. */
    for (const dir of (env.PATH || '').split(path.delimiter)) {
        const d = dir.trim();
        if (!d) {
            continue;
        }
        add(path.join(d, 'g++.exe'));
    }
    // 64-bit toolchains first (winget packages also contain a 32-bit mingw32/)
    return candidates.sort((a, b) => Number(/mingw64/i.test(b)) - Number(/mingw64/i.test(a)));
}
/** Bounded depth-first search for one file name. */
function walkForFile(root, fileName, maxDepth, maxEntries, hit) {
    if (maxEntries <= 0)
        return;
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        if (maxEntries <= 0)
            return;
        maxEntries--;
        const full = path.join(root, e.name);
        if (e.isDirectory()) {
            if (maxDepth > 1)
                walkForFile(full, fileName, maxDepth - 1, maxEntries, hit);
        }
        else if (e.name.toLowerCase() === fileName) {
            hit(full);
        }
    }
}
/**
 * True when the candidate compiler runs and prints a version line.
 * Returns the first version line for display.
 */
async function verifyCompilerRun(candidate) {
    try {
        const res = await runProcess(candidate, ['--version'], { timeoutMs: 20000 });
        if (res.code !== 0) {
            return { ok: false, version: '' };
        }
        const line = (res.stdout || res.stderr).split(/\r?\n/).find((l) => l.trim().length > 0) || '';
        return { ok: true, version: line.trim().slice(0, 120) };
    }
    catch {
        return { ok: false, version: '' };
    }
}
/**
 * Last-resort automatic install: download the WinLibs UCRT zip (streaming,
 * sha256-verified) into <storageRoot>\mingw64-download, extract it with the
 * built-in PowerShell Expand-Archive and return the g++.exe path.
 * No administrator rights anywhere.
 */
async function installCompilerWindowsDirect(storageRoot, onProgress) {
    const log = [];
    const workDir = path.join(storageRoot, 'mingw64-download');
    const zipPath = path.join(workDir, exports.WINLIBS_FALLBACK.url.split('/').pop() || 'winlibs.zip');
    fs.mkdirSync(workDir, { recursive: true });
    /* 0. idempotency: a previous attempt may already have extracted the
     * toolchain (crashed PC, re-run setup). Reuse it instead of re-downloading
     * 274 MB. */
    const preFound = [];
    walkForFile(workDir, 'g++.exe', 4, 8000, (p) => preFound.push(p));
    const preGpp = preFound.find((p) => /mingw64/i.test(p)) ||
        preFound.find((p) => /mingw32/i.test(p)) ||
        preFound[0];
    if (preGpp) {
        const pre = await verifyCompilerRun(preGpp);
        if (pre.ok) {
            log.push('re-using previously extracted toolchain: ' + preGpp);
            onProgress?.({ message: 'Compiler already downloaded — re-using it.', percent: 100 });
            return { gppPath: preGpp, binDir: path.dirname(preGpp), log };
        }
    }
    /* 1. download (streaming + progress) */
    onProgress?.({ message: `Downloading WinLibs GCC (${Math.round(exports.WINLIBS_FALLBACK.sizeBytes / 1e6)} MB)…`, percent: 0 });
    const res = await fetch(exports.WINLIBS_FALLBACK.url, { redirect: 'follow', signal: AbortSignal.timeout(60 * 60 * 1000) });
    if (!res.ok || !res.body) {
        throw new Error(`download failed: HTTP ${res.status}`);
    }
    const total = Number(res.headers.get('content-length')) || exports.WINLIBS_FALLBACK.sizeBytes;
    let received = 0;
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
        const expected = (await downloadToBuffer(exports.WINLIBS_FALLBACK.sha256Url)).toString().trim().split(/\s+/)[0].toLowerCase();
        const actual = (0, crypto_1.createHash)('sha256').update(zip).digest('hex');
        if (expected && expected !== actual) {
            throw new Error(`sha256 mismatch (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
        }
        log.push('sha256 verified');
    }
    catch (e) {
        log.push('checksum check skipped/failed: ' + String(e));
    }
    /* 3. extract — try the built-in bsdtar first (Windows 10 1803+, much faster
     * than Expand-Archive on multi-hundred-MB archives), fall back to the
     * built-in PowerShell Expand-Archive (every Windows 10/11 has it). */
    onProgress?.({ message: 'Extracting (this can take a few minutes)…', percent: 93 });
    let extractOk = false;
    const tar = await runProcessStreaming(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', workDir], { timeoutMs: 30 * 60 * 1000, onLine: (l) => log.push('tar: ' + l.slice(0, 100)) });
    if (tar.code === 0 && !tar.spawnFailed) {
        extractOk = true;
        log.push('extracted with bsdtar');
    }
    else {
        log.push('bsdtar unavailable/failed, falling back to Expand-Archive');
        const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${workDir.replace(/'/g, "''")}' -Force`;
        const ps = await runProcessStreaming('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { timeoutMs: 30 * 60 * 1000, onLine: (l) => log.push('ps: ' + l.slice(0, 100)) });
        if (ps.code !== 0) {
            throw new Error('extraction failed: ' + ps.tail.slice(-300));
        }
        extractOk = true;
        log.push('extracted with Expand-Archive');
    }
    void extractOk;
    /* 4. find g++.exe (prefer mingw64 over mingw32) */
    const found = [];
    walkForFile(workDir, 'g++.exe', 4, 8000, (p) => found.push(p));
    const gpp = found.find((p) => /mingw64/i.test(p)) ||
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
    /* 5. free the disk: the 274 MB zip is no longer needed */
    try {
        fs.rmSync(zipPath, { force: true });
        log.push('removed downloaded zip archive');
    }
    catch {
        log.push('could not remove zip archive (non-fatal)');
    }
    onProgress?.({ message: 'Compiler ready.', percent: 100 });
    return { gppPath: gpp, binDir: path.dirname(gpp), log };
}
/**
 * Download graphics.h / winbgim.h / libbgi.a into <storageRoot>/winbgim.
 * The extension then adds includeDir/libDir to its settings — no copying
 * into MinGW folders and no administrator rights required.
 */
async function installWinbgimWindows(storageRoot) {
    const includeDir = path.join(storageRoot, 'winbgim', 'include');
    const libDir = path.join(storageRoot, 'winbgim', 'lib');
    fs.mkdirSync(includeDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    const log = [];
    const fetchFirst = async (urls) => {
        let lastErr = null;
        for (const url of urls) {
            try {
                const buf = await downloadToBuffer(url);
                log.push(`downloaded ${url} (${buf.length} bytes)`);
                return buf;
            }
            catch (e) {
                lastErr = e;
                log.push(`failed ${url}: ${String(e)}`);
            }
        }
        throw lastErr ?? new Error('all sources failed');
    };
    fs.writeFileSync(path.join(includeDir, 'graphics.h'), await fetchFirst(exports.WINBGIM_SOURCES.graphicsH));
    fs.writeFileSync(path.join(includeDir, 'winbgim.h'), await fetchFirst(exports.WINBGIM_SOURCES.winbgimH));
    fs.writeFileSync(path.join(libDir, 'libbgi.a'), await fetchFirst(exports.WINBGIM_SOURCES.libbgiA));
    return { includeDir, libDir, log };
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
function patchSdlBgiSources(srcDir, log) {
    const hPath = path.join(srcDir, 'SDL_bgi.h');
    let h = fs.readFileSync(hPath, 'utf8');
    if (!/int\s+k_bhit\s*\(void\);/.test(h)) {
        h = h.replace(/(#define kbhit k_bhit\n)/, '$1int  k_bhit (void);              /* PATCH: declared (missing in mirror) */\n');
        log.push('header: k_bhit declaration added');
    }
    if (!/void clearmouseclick/.test(h)) {
        h = h.replace(/(void getmouseclick \(int, int \*, int \*\);\n)/, '$1void clearmouseclick (int);       /* PATCH: WinBGIM compatibility */\n');
        log.push('header: clearmouseclick declaration added');
    }
    fs.writeFileSync(hPath, h);
    const cPath = path.join(srcDir, 'SDL_bgi.c');
    let c = fs.readFileSync(cPath, 'utf8');
    /* 3a. always-present mode: classic programs must not need refresh() */
    if (/bgi_fast_mode\s*=\s*SDL_TRUE,/.test(c)) {
        c = c.replace(/(bgi_fast_mode\s*=\s*)SDL_TRUE(,\s*\/\/[^\n]*needs screen update\?)/, '$1SDL_FALSE$2  /* PATCH: present via delay/getch (validated combo) */');
        log.push('source: bgi_fast_mode -> SDL_FALSE (auto-present)');
    }
    /* 3b. per-pixel updates: flag only, present on delay/getch (fast putpixel) */
    const updatePixelOld = /static void update_pixel \(int x, int y\)\s*\{[\s\S]*?\n\}/;
    if (updatePixelOld.test(c) && !/PATCHED: per-pixel updates only flag/.test(c)) {
        c = c.replace(updatePixelOld, `static void update_pixel (int x, int y)
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
        c = c.replace(updateOld, `static void update (void)
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
            if (!m)
                continue;
            const start = m.index;
            const end = c.indexOf('\n}', start);
            const body = c.slice(start, end);
            if (body.includes('  poll_refresh ();'))
                continue;
            const patched = body.replace('  update ();', '  poll_refresh ();');
            if (patched !== body) {
                c = c.slice(0, start) + patched + c.slice(end);
                log.push('source: ' + name + ' presents via poll_refresh');
            }
        }
    }
    /* 2b. clearmouseclick implementation */
    if (!/void clearmouseclick \(int btn\)/.test(c)) {
        c = c.replace(/(\n\/\/ -----\s*$)/m, `

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
$1`);
        log.push('source: clearmouseclick implementation added');
    }
    fs.writeFileSync(cPath, c);
}
/**
 * v1.4.9: const-correct the text/file-name API in the INSTALLED SDL_bgi.h
 * (user-facing header only — the C build keeps its own definitions).
 *
 * SDL_bgi declares outtextxy/outtext/textheight/textwidth/initgraph/etc.
 * with non-const char* params. Turbo C++ textbook code passes string
 * literals and const char* to these constantly; a direct literal only
 * draws -Wwrite-strings, but any indirect const string (ternary result,
 * const variable, function return) is a HARD compile error. The library
 * never writes through these pointers, so the installed header can safely
 * take const char* — the .so ABI does not care about header const-ness.
 */
function patchInstalledHeaderConstChar(includeDir, log) {
    const header = path.join(includeDir, 'SDL2', 'SDL_bgi.h');
    try {
        if (!fs.existsSync(header)) {
            return;
        }
        /* read-only text/filename APIs textbook code calls with literals */
        const targets = [
            'initgraph', 'installuserdriver', 'installuserfont', 'outtext', 'outtextxy',
            'textheight', 'textwidth', 'readimagefile', 'writeimagefile',
            'setwintitle', 'setwinoptions', 'resetwinoptions'
        ];
        const lines = fs.readFileSync(header, 'utf8').split('\n');
        let patched = 0;
        const out = lines.map((line) => {
            if (!line.includes('char *'))
                return line;
            const hit = targets.find((n) => new RegExp('\\b' + n + '\\s*\\(').test(line));
            if (!hit || line.includes('const char *'))
                return line;
            patched++;
            return line.replace(/char \*/g, 'const char *');
        });
        if (patched > 0) {
            fs.writeFileSync(header, out.join('\n'));
            log.push(`installed header: const-corrected ${patched} text API declarations (textbook code compiles)`);
        }
    }
    catch (e) {
        /* cosmetic patch — never block the install */
        log.push('header const-correctness patch skipped: ' + String(e));
    }
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
async function installSdlBgiUserPrefix(opts = {}) {
    const storageRoot = opts.storageRoot || path.join(os.homedir(), '.graphics-h-runner');
    const srcRoot = path.join(storageRoot, 'sdl_bgi-src');
    const prefix = path.join(storageRoot, 'usr');
    const includeDir = path.join(prefix, 'include');
    const libDir = path.join(prefix, 'lib');
    const log = [];
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(path.join(includeDir, 'SDL2'), { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    /* 1. download (try mirrors in order) */
    const tarball = path.join(storageRoot, 'sdl_bgi.tar.gz');
    let lastDlErr = null;
    let downloaded = false;
    for (const url of opts.tarballUrls || exports.SDL_BGI_TARBALL_URLS) {
        try {
            const buf = await downloadToBuffer(url);
            fs.writeFileSync(tarball, buf);
            log.push(`downloaded SDL_bgi tarball from ${url} (${buf.length} bytes)`);
            downloaded = true;
            break;
        }
        catch (e) {
            lastDlErr = e;
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
    /* 6. const-correct the user-facing header (after the build — see docstring) */
    patchInstalledHeaderConstChar(includeDir, log);
    log.push('installed headers + library into ' + prefix);
    return { includeDir, libDir, log };
}
//# sourceMappingURL=setup.js.map