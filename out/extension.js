"use strict";
/**
 * extension.ts — graphics.h Runner for VS Code.
 *
 * One-press compile & run for C++ programs that #include <graphics.h>,
 * with the right linker flags per OS (WinBGIM on Windows, SDL_bgi / libgraph
 * on Linux/macOS), plus a Setup Doctor, snippets, templates and a
 * status-bar environment indicator.
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
exports.activate = activate;
exports.deactivate = deactivate;
/* Sentry automatic error collection — MUST stay the first import so the SDK is
 * initialized before any other extension module loads (instrument-first rule). */
require("./instrument");
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const toolchain_1 = require("./toolchain");
const detect_1 = require("./detect");
const buildArgs_1 = require("./buildArgs");
const doctor_1 = require("./doctor");
const setup_1 = require("./setup");
const programs_1 = require("./programs");
const panelView_1 = require("./panelView");
const programsTree_1 = require("./programsTree");
const debugAdapter_1 = require("./debugAdapter");
const normalize_1 = require("./normalize");
const instrument_1 = require("./instrument");
const diagnostics_1 = require("./diagnostics");
const depsAudit_1 = require("./depsAudit");
const runwrap_1 = require("./runwrap");
const globalize_1 = require("./globalize");
const celebrateHost_1 = require("./celebrateHost");
const programsTreeModel_1 = require("./programsTreeModel");
const OUTPUT_CHANNEL_NAME = 'graphics.h Runner';
const TERMINAL_NAME = 'graphics.h Runner';
const CONFIG_PREFIX = 'graphics-h-runner.';
let output;
let statusItem;
let doctorCache;
let doctorRunning;
let panel;
let catalog = [];
/* v1.5.4: ONE persistent runner terminal — created once, reused for
 * every run. The shell is its root process and never exits, so the
 * terminal and its output survive every program exit; a new run just
 * types into it again. Cleared only when the user closes it. */
let runnerTerminal;
let storageDir; /* globalStorage — real files for folder-less windows */
let diagnostics;
/* live run feedback for the status bar: idle -> compiling -> running -> idle */
let runState = 'idle';
/* which back-end the last successful build used ('none' = plain console C++) */
let lastBuildLibrary = 'none';
/* v1.5.5: the celebration overlay (confetti / error / school pride /
 * Fireworks Simulator) — exactly one panel, driven by the commands below */
let celebrator;
/* School Pride fires once per session: the first time the activity-bar
 * panel opens after a fresh desktop / window start. */
let schoolPrideDone = false;
/** Existence-probe options for the normalizers (real filesystem). */
function normOpts() {
    return { platform: (0, toolchain_1.currentPlatform)() };
}
function getConfig() {
    const cfg = vscode.workspace.getConfiguration();
    const rawCompiler = cfg.get(CONFIG_PREFIX + 'compilerPath', 'g++');
    return {
        /* healed on read: quotes, env vars, ~, directory paths, missing .exe */
        compilerPath: (0, normalize_1.normalizeCompilerPath)(rawCompiler || 'g++', normOpts()) || 'g++',
        autoDetect: cfg.get(CONFIG_PREFIX + 'autoDetect', true),
        linuxLibrary: cfg.get(CONFIG_PREFIX + 'linuxLibrary', 'auto'),
        staticLinkWindows: cfg.get(CONFIG_PREFIX + 'staticLinkWindows', true),
        extraIncludePaths: (0, normalize_1.normalizeDirList)(cfg.get(CONFIG_PREFIX + 'extraIncludePaths', []), normOpts()),
        extraLibPaths: (0, normalize_1.normalizeDirList)(cfg.get(CONFIG_PREFIX + 'extraLibPaths', []), normOpts()),
        extraCompilerArgs: cfg.get(CONFIG_PREFIX + 'extraCompilerArgs', []),
        showStatusBarItem: cfg.get(CONFIG_PREFIX + 'showStatusBarItem', true)
    };
}
function log(line) {
    output.appendLine(line);
}
/** Wrap a command handler with a breadcrumb so Sentry issues carry user context. */
function trackedCommand(name, fn) {
    return (...args) => {
        (0, instrument_1.addExtensionBreadcrumb)('ui.command', name);
        return fn(...args);
    };
}
/** v1.5.6 celebrations master switch (confetti / error / school pride). */
function celebrationsEnabled() {
    return vscode.workspace
        .getConfiguration('graphics-h-runner.celebrations')
        .get('enabled', true);
}
/** Fire a timed celebration; a celebration must never break a compile. */
function celebrate(kind, errorLines) {
    if (!celebrator || !celebrationsEnabled()) {
        return;
    }
    try {
        celebrator.show(kind, undefined, errorLines ? { errorLines } : undefined);
    }
    catch {
        /* ignore — the compile result matters more than the party */
    }
}
/* ---------------- full setup (0 -> running) ---------------- */
async function addPathsToSetting(key, additions) {
    const cfg = vscode.workspace.getConfiguration();
    const current = cfg.get(CONFIG_PREFIX + key, []);
    const merged = Array.from(new Set([...current, ...additions]));
    if (merged.length !== current.length) {
        await cfg.update(CONFIG_PREFIX + key, merged, vscode.ConfigurationTarget.Global);
        log(`[setup] ${key} += ${additions.join(', ')}`);
    }
}
async function setCompilerPathSetting(gppPath) {
    const cfg = vscode.workspace.getConfiguration();
    const current = cfg.get(CONFIG_PREFIX + 'compilerPath', 'g++');
    if (current !== gppPath) {
        await cfg.update(CONFIG_PREFIX + 'compilerPath', gppPath, vscode.ConfigurationTarget.Global);
        log('[setup] compilerPath := ' + gppPath);
    }
}
/** First g++.exe candidate that actually runs (Windows). v1.5.6: a candidate
 * whose target architecture is x86_64 is always preferred over legacy 32-bit
 * compilers — the bundled WinBGIM library is 64-bit and 32-bit compilers
 * can never link it. With `requireBgiCapable`, 32-bit/unknown candidates are
 * rejected outright (used when the current compiler is known-incompatible). */
async function findWorkingGpp(opts = {}) {
    const candidates = (0, setup_1.discoverGppWindows)();
    const scored = [];
    for (const candidate of candidates) {
        const v = await (0, setup_1.verifyCompilerRun)(candidate);
        if (!v.ok) {
            continue;
        }
        const arch = await (0, setup_1.compilerArchitecture)(candidate);
        if (opts.requireBgiCapable && arch !== 'x86_64') {
            continue;
        }
        scored.push({ gppPath: candidate, version: v.version, arch });
        if (arch === 'x86_64') {
            return scored[scored.length - 1]; /* best possible — take it at once */
        }
    }
    return scored[0];
}
/**
 * Drop stale entries (deleted toolchain folders, wiped globalStorage) from the
 * include/lib settings so diagnostics stay truthful. Non-fatal on failure.
 */
async function pruneStalePaths() {
    try {
        const cfg = vscode.workspace.getConfiguration();
        for (const key of ['extraIncludePaths', 'extraLibPaths']) {
            const current = (0, normalize_1.normalizeDirList)(cfg.get(CONFIG_PREFIX + key, []), normOpts());
            const kept = (0, normalize_1.pruneMissingDirs)(current, normOpts());
            if (kept.length !== current.length) {
                await cfg.update(CONFIG_PREFIX + key, kept, vscode.ConfigurationTarget.Global);
                log(`[setup] pruned ${current.length - kept.length} stale entrie(s) from ${key}`);
            }
        }
    }
    catch (e) {
        log('[setup] stale-path prune skipped: ' + String(e));
    }
}
/** Spawn environment that also contains the compiler's own bin dir (DLL safety). */
function compilerEnv(compiler, extraDirs = []) {
    const env = { ...process.env };
    try {
        const dirs = [];
        if (path.isAbsolute(compiler) && fs.existsSync(path.dirname(compiler))) {
            dirs.push(path.dirname(compiler));
        }
        for (const d of extraDirs) {
            if (d && fs.existsSync(d)) {
                dirs.push(d);
            }
        }
        if (dirs.length > 0) {
            env.PATH = dirs.join(path.delimiter) + path.delimiter + (env.PATH || '');
        }
    }
    catch {
        /* default env is fine */
    }
    return env;
}
async function runFullSetup(context) {
    const platform = (0, toolchain_1.currentPlatform)();
    const storageRoot = context.globalStorageUri.fsPath;
    const cfg = getConfig();
    const summary = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'graphics.h: Complete Setup', cancellable: false }, async (progress) => {
        progress.report({ message: 'Checking the current environment…' });
        const doctor = await (0, doctor_1.probeEnvironment)({
            platform,
            compilerPath: cfg.compilerPath,
            linuxLibrary: cfg.linuxLibrary,
            extraIncludePaths: cfg.extraIncludePaths,
            extraLibPaths: cfg.extraLibPaths
        });
        const probe = {
            compilerOk: doctor.compilerCheck.ok,
            winbgimOk: doctor.libraryChecks.some((c) => c.name === 'winbgim' && c.ok),
            sdlBgiOk: doctor.libraryChecks.some((c) => c.name === 'sdl_bgi' && c.ok),
            libgraphOk: doctor.libraryChecks.some((c) => c.name === 'libgraph' && c.ok)
        };
        /* v1.5.6 THE "Full Setup said READY but nothing runs" fix: a compiler
         * that runs --version can still be UNABLE to link the bundled 64-bit
         * WinBGIM library (legacy 32-bit MinGW.org g++). Detect it up front so
         * the plan installs a compatible 64-bit MinGW-w64 compiler. */
        let compilerBgiIncompatible = false;
        if (platform === 'windows' && probe.compilerOk) {
            const wbLib = path.join(storageRoot, 'winbgim', 'lib');
            const wbInc = path.join(storageRoot, 'winbgim', 'include');
            if (fs.existsSync(path.join(wbLib, 'libbgi.a'))) {
                /* library present: test the REAL thing — compile+link a probe */
                const link = await (0, setup_1.bgiLinkProbe)({
                    compiler: cfg.compilerPath || 'g++',
                    includeDir: wbInc,
                    libDir: wbLib,
                    platform
                });
                compilerBgiIncompatible = !link.ok && link.undefinedRefs;
                log('[setup] bgi link probe: ' + (link.ok ? 'OK' : 'FAILED — ' + link.detail.slice(0, 160)));
                if (compilerBgiIncompatible) {
                    (0, instrument_1.addExtensionBreadcrumb)('setup.probe', 'compiler cannot link the graphics library');
                }
            }
            else {
                /* library not installed yet: fall back to the target architecture */
                const arch = await (0, setup_1.compilerArchitecture)(cfg.compilerPath || 'g++');
                compilerBgiIncompatible = arch === 'mingw32' || arch === 'i686';
                if (compilerBgiIncompatible) {
                    log(`[setup] compiler target is ${arch} (32-bit) — it cannot link the 64-bit graphics library`);
                }
            }
        }
        let sdl2DevOk = true;
        if (platform === 'linux' || platform === 'macos') {
            progress.report({ message: 'Checking SDL2 headers…' });
            sdl2DevOk = await (0, setup_1.checkSdl2Dev)({ cc: platform === 'macos' ? 'clang' : 'gcc' });
        }
        const plan = (0, setup_1.planSetup)(platform, { ...probe, compilerBgiIncompatible }, sdl2DevOk);
        log('[setup] plan: ' + plan.map((s) => `${s.id}(${s.kind})`).join(' -> '));
        for (const step of plan) {
            progress.report({ message: step.title });
            panel?.setBusy(true, step.title);
            if (step.kind === 'auto' && step.id === 'install-sdl_bgi') {
                /* never attempt the build while the compiler is still missing —
                 * that would guarantee a confusing failure. The terminal step above
                 * installs it; Full Setup can be re-run afterwards. */
                if (platform !== 'windows' && !probe.compilerOk) {
                    summary.push('SDL_bgi auto-install postponed: install the compiler first (step above), then re-run Full Setup.');
                    continue;
                }
                try {
                    const res = await (0, setup_1.installSdlBgiUserPrefix)({ storageRoot });
                    await addPathsToSetting('extraIncludePaths', [res.includeDir]);
                    await addPathsToSetting('extraLibPaths', [res.libDir]);
                    summary.push('SDL_bgi downloaded, patched, built and installed into a user folder (no admin rights needed).');
                    summary.push('GLOBAL (optional): so graphics.h also works OUTSIDE VS Code, copy the library system-wide: ' +
                        `sudo cp "${res.includeDir}/graphics.h" /usr/local/include/ && sudo cp -r "${res.includeDir}/SDL2" /usr/local/include/ && sudo cp "${res.libDir}/libSDL_bgi.so" /usr/local/lib/ && sudo ldconfig`);
                    (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'install-sdl_bgi ok');
                }
                catch (e) {
                    output.appendLine('[setup] SDL_bgi install error: ' + String(e));
                    summary.push('SDL_bgi auto-install FAILED: ' + String(e));
                    (0, instrument_1.captureExtensionError)(e, { setup_step: 'install-sdl_bgi', platform: platform });
                }
            }
            else if (step.kind === 'auto' && step.id === 'install-compiler-winget') {
                /* half-setup fast path: a compiler may already be on disk (previous
                 * winget run, manual install, IDE bundle) — skip the whole download.
                 * v1.5.6: a BGI-incompatible compiler (32-bit MinGW.org) does NOT
                 * count — it is exactly what we are here to replace. */
                const existing = await findWorkingGpp({ requireBgiCapable: compilerBgiIncompatible });
                if (existing) {
                    await setCompilerPathSetting(existing.gppPath);
                    summary.push(`Compiler already present on this PC — using ${existing.gppPath} (${existing.version}` +
                        (existing.arch ? `, ${existing.arch}` : '') + '). winget step skipped.');
                    continue;
                }
                const winget = await (0, setup_1.installCompilerViaWinget)((p) => progress.report({ message: p.message.slice(0, 110) }));
                log('[setup] winget: ' + winget.detail);
                (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'install-compiler-winget', { ok: String(winget.ok) });
                const found = await findWorkingGpp({ requireBgiCapable: true });
                if (found) {
                    await setCompilerPathSetting(found.gppPath);
                    summary.push(`Compiler installed automatically via winget: ${found.gppPath} (${found.version}, ${found.arch})`);
                }
                else if (winget.ok) {
                    summary.push('winget finished but no working g++.exe was found — trying the direct-download fallback next.');
                }
                else {
                    summary.push('winget automatic install not possible: ' + winget.detail + ' — trying the direct-download fallback next.');
                }
            }
            else if (step.kind === 'auto' && step.id === 'install-compiler-download') {
                /* v1.5.6: "already" must mean a BGI-CAPABLE compiler when the
                 * current one is known-incompatible — otherwise this step would be
                 * skipped on the very PCs that need it most. */
                const current = getConfig();
                const runsOk = (await (0, setup_1.verifyCompilerRun)(current.compilerPath || 'g++')).ok;
                const currentArch = runsOk ? await (0, setup_1.compilerArchitecture)(current.compilerPath || 'g++') : 'unknown';
                const currentIsGood = runsOk && (!compilerBgiIncompatible || currentArch === 'x86_64');
                const already = currentIsGood || Boolean(await findWorkingGpp({ requireBgiCapable: compilerBgiIncompatible }));
                if (already) {
                    summary.push('Compiler already available — direct download skipped.');
                }
                else {
                    try {
                        const dl = await (0, setup_1.installCompilerWindowsDirect)(storageRoot, (p) => progress.report({ message: p.message.slice(0, 110) }));
                        dl.log.forEach((l) => output.appendLine('[setup] ' + l));
                        await setCompilerPathSetting(dl.gppPath);
                        summary.push(`Compiler downloaded, verified (sha256) and installed automatically: ${dl.gppPath}`);
                        (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'install-compiler-download ok');
                    }
                    catch (e) {
                        output.appendLine('[setup] direct download error: ' + String(e));
                        summary.push('Direct compiler download FAILED: ' + String(e));
                        (0, instrument_1.captureExtensionError)(e, { setup_step: 'install-compiler-download', platform: platform });
                    }
                }
            }
            else if (step.kind === 'auto' && step.id === 'install-winbgim') {
                try {
                    const res = await (0, setup_1.installWinbgimWindows)(storageRoot);
                    await addPathsToSetting('extraIncludePaths', [res.includeDir]);
                    await addPathsToSetting('extraLibPaths', [res.libDir]);
                    summary.push('WinBGIM (graphics.h / winbgim.h / libbgi.a) installed into the extension folder.');
                    (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'install-winbgim ok');
                }
                catch (e) {
                    output.appendLine('[setup] WinBGIM install error: ' + String(e));
                    summary.push('WinBGIM auto-install FAILED: ' + String(e));
                    (0, instrument_1.captureExtensionError)(e, { setup_step: 'install-winbgim', platform: platform });
                }
            }
            else if (step.kind === 'auto' && step.id === 'make-global') {
                /* v1.5.1 major feature: graphics.h must compile ANYWHERE after Full
                 * Setup — not only inside this extension. */
                const fresh = getConfig();
                const compilerOkNow = (await (0, setup_1.verifyCompilerRun)(fresh.compilerPath || 'g++')).ok;
                const wbInclude = path.join(storageRoot, 'winbgim', 'include');
                const wbLib = path.join(storageRoot, 'winbgim', 'lib');
                const haveWinbgim = fs.existsSync(path.join(wbInclude, 'graphics.h')) &&
                    fs.existsSync(path.join(wbLib, 'libbgi.a'));
                if (platform !== 'windows') {
                    summary.push('Global setup: handled automatically on this platform (system packages / user prefix).');
                }
                else if (!compilerOkNow) {
                    summary.push('Global setup skipped: no working g++ yet — finish the compiler steps above, then re-run Full Setup.');
                }
                else if (!haveWinbgim) {
                    summary.push('Global setup skipped: WinBGIM files are not installed yet — finish the WinBGIM step above, then re-run Full Setup.');
                }
                else {
                    try {
                        progress.report({ message: 'Making graphics.h work in ANY terminal (global)…' });
                        const res = await (0, globalize_1.makeGlobalWindows)({
                            compilerPath: fresh.compilerPath,
                            includeDir: wbInclude,
                            libDir: wbLib,
                            onLog: (l) => log('[global] ' + l)
                        });
                        if (res.globalProbeOk) {
                            summary.push('GLOBAL: graphics.h now compiles ANYWHERE without this extension. From any terminal: ' + res.universalCommand);
                            if (res.includeTarget) {
                                summary.push(`GLOBAL: WinBGIM lives in the toolchain itself (${res.includeTarget}, ${res.libTarget}).`);
                            }
                            (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'make-global ok');
                        }
                        else {
                            summary.push('Global setup could NOT make plain "g++ ..." resolve graphics.h (details in the output). The extension keeps working via its own settings.');
                            (0, instrument_1.captureExtensionWarning)('make-global probe failed', { platform: platform });
                        }
                        if (res.pathChanged) {
                            summary.push('PATH: the compiler folder was added to your user PATH — new terminals (and VS Code after a restart) can call g++ directly.');
                        }
                        else if (!res.pathOk) {
                            summary.push('PATH update failed (non-fatal): add the compiler bin folder to PATH manually — details in the output.');
                        }
                    }
                    catch (e) {
                        output.appendLine('[global] error: ' + String(e));
                        summary.push('Global setup FAILED: ' + String(e));
                        (0, instrument_1.captureExtensionError)(e, { setup_step: 'make-global', platform: platform });
                    }
                }
            }
            else if (step.kind === 'terminal') {
                summary.push(`ACTION NEEDED (run in a terminal): ${step.command}`);
            }
            else if (step.kind === 'manual') {
                summary.push(`ACTION NEEDED (manual): ${step.detail}${step.url ? ' — ' + step.url : ''}`);
            }
            else if (step.kind === 'verify') {
                await pruneStalePaths();
                const fresh = getConfig();
                const res = await (0, doctor_1.probeEnvironment)({
                    platform,
                    compilerPath: fresh.compilerPath,
                    linuxLibrary: fresh.linuxLibrary,
                    extraIncludePaths: fresh.extraIncludePaths,
                    extraLibPaths: fresh.extraLibPaths
                });
                doctorCache = res;
                updateStatusBar();
                panel?.setDoctorResult(res);
                summary.push(res.graphicsReady
                    ? `VERIFIED: graphics.h is ready (library: ${res.bestLibrary}). Press Ctrl+Alt+R inside a graphics.h program to run it.`
                    : 'NOT READY YET — finish the ACTION NEEDED items above, then re-run Full Setup.');
                (0, instrument_1.addExtensionBreadcrumb)('setup.verify', res.graphicsReady ? 'ready' : 'not ready', {
                    compilerOk: String(res.compilerCheck.ok),
                    bestLibrary: String(res.bestLibrary || '')
                });
            }
        }
    });
    panel?.setBusy(false);
    output.show(true);
    output.appendLine('=== Complete Setup summary ===');
    summary.forEach((s) => output.appendLine('- ' + s));
    (0, instrument_1.addExtensionBreadcrumb)('setup', 'full setup finished', { steps: String(summary.length) });
    const needsAction = summary.some((s) => s.startsWith('ACTION NEEDED'));
    if (needsAction) {
        const pick = await vscode.window.showInformationMessage('A few system packages must be installed with your password. Run the printed commands in the terminal, then re-run "Complete Setup" to verify.', 'Open Terminal', 'Show Output');
        if (pick === 'Open Terminal') {
            vscode.window.createTerminal('graphics.h Setup').show();
        }
        else if (pick === 'Show Output') {
            output.show(true);
        }
    }
    else if (summary.some((s) => s.startsWith('VERIFIED: graphics.h is ready'))) {
        vscode.window.showInformationMessage('Everything is set up! Open a .cpp file that includes <graphics.h> and press Ctrl+Alt+R.');
    }
    else {
        vscode.window.showWarningMessage('Complete Setup finished with problems — see the graphics.h Runner output.');
    }
}
function resolvePlan(sourceFile, cfg) {
    const platform = (0, toolchain_1.currentPlatform)();
    const outFile = (0, toolchain_1.binaryPathFor)(sourceFile, platform);
    let source = '';
    try {
        source = fs.readFileSync(sourceFile, 'utf8');
    }
    catch {
        source = '';
    }
    const detected = (0, detect_1.detectGraphicsInclude)(source);
    const useBgi = cfg.autoDetect ? detected : true;
    log(`[plan] ${sourceFile}`);
    log(`[plan] graphics.h ${detected ? 'detected' : 'not detected'} -> ${useBgi ? 'BGI build' : 'plain C++ build'}`);
    return (0, buildArgs_1.buildCompilePlan)({
        platform,
        linuxLibrary: cfg.linuxLibrary,
        compilerPath: cfg.compilerPath,
        sourceFile,
        outFile,
        extraIncludePaths: cfg.extraIncludePaths,
        extraLibPaths: cfg.extraLibPaths,
        extraCompilerArgs: cfg.extraCompilerArgs,
        staticLinkWindows: cfg.staticLinkWindows
    }, useBgi, doctorCache
        ? {
            sdlBgiAvailable: doctorCache.libraryChecks.some((c) => c.name === 'sdl_bgi' && c.ok),
            libgraphAvailable: doctorCache.libraryChecks.some((c) => c.name === 'libgraph' && c.ok)
        }
        : undefined);
}
async function compileSource(sourceFile) {
    const cfg = getConfig();
    const plan = resolvePlan(sourceFile, cfg);
    log('[compile] ' + plan.commandLine);
    setRunState('compiling');
    let compilerText = '';
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `graphics.h: compiling ${path.basename(sourceFile)}…`,
        cancellable: false
    }, () => new Promise((resolve) => {
        let settled = false;
        const done = (r) => {
            if (!settled) {
                settled = true;
                resolve(r);
            }
        };
        let child;
        try {
            child = (0, child_process_1.spawn)(plan.compiler, plan.args, {
                cwd: path.dirname(sourceFile),
                env: compilerEnv(plan.compiler),
                windowsHide: true
            });
        }
        catch (e) {
            log('[error] failed to start compiler: ' + String(e));
            done('no-compiler');
            return;
        }
        child.stdout?.on('data', (d) => output.append(d.toString()));
        child.stderr?.on('data', (d) => {
            output.append(d.toString());
            /* kept for the Problems panel + the failure breadcrumb */
            compilerText += d.toString();
            if (compilerText.length > 131072) {
                compilerText = compilerText.slice(-65536); /* keep the tail */
            }
        });
        child.on('error', (e) => {
            const kind = (0, normalize_1.classifySpawnFailure)({ errorCode: e.code, closeCode: null });
            if (kind === 'no-compiler') {
                log(`[error] compiler not found: "${plan.compiler}" — offering automatic setup`);
                done('no-compiler');
            }
            else {
                log('[error] ' + e.message);
                done('failed');
            }
        });
        child.on('close', (code) => {
            if (code === 0) {
                log('[compile] success');
                (0, instrument_1.addExtensionBreadcrumb)('compile', 'ok', { file: path.basename(sourceFile) });
                done('ok');
                return;
            }
            /* Windows surfaces spawn ENOENT as a negative close code (-4058) on
             * some runtimes — classify it as "no compiler", not "compile error" */
            const kind = (0, normalize_1.classifySpawnFailure)({ errorCode: undefined, closeCode: code });
            if (code !== null && code < 0 && kind === 'no-compiler') {
                log(`[error] compiler "${plan.compiler}" could not be started (exit ${code}) — offering automatic setup`);
                done('no-compiler');
            }
            else {
                log(`[compile] failed with exit code ${code}`);
                done('failed');
            }
        });
    }));
    /* v1.4.9 robustness fix: only clear the indicator when no program is
     * still alive. A plain Compile (or a failed rebuild) while a graphics
     * program runs used to flip the status bar to "idle" even though the
     * runner terminal — and the window — were still up (Ctrl+Alt+S kept
     * working, but the visible state lied). */
    const stillRunning = !!runnerTerminal && !runnerTerminal.exitStatus;
    setRunState(stillRunning ? 'running' : 'idle');
    (0, instrument_1.addExtensionBreadcrumb)('compile', result, { file: path.basename(sourceFile) });
    if (result === 'ok') {
        celebrate('confetti'); /* v1.5.5: every successful compilation */
        diagnostics?.delete(vscode.Uri.file(sourceFile));
        if ((0, toolchain_1.currentPlatform)() === 'windows') {
            auditExeAfterBuild((0, toolchain_1.binaryPathFor)(sourceFile, (0, toolchain_1.currentPlatform)()));
        }
    }
    else if (result === 'failed') {
        /* v1.5.6: the snowfall is gone — a failed build now gets a relatable
         * ERROR overlay: giant ✗ + shake, the actual compiler error headers in
         * big type, and a red-ember rain for 5 s (click/Esc to dismiss). */
        const errorHeaders = (0, diagnostics_1.pickErrorHeaders)(compilerText, 3, 120);
        celebrate('error', errorHeaders);
        /* Compile errors are the NORMAL edit-compile loop for a graphics.h
         * teaching tool — they belong in the Problems panel and the output
         * channel, NOT in the telemetry error inbox (a single student session
         * could otherwise raise dozens of "g++ exited non-zero" issues). The
         * first error lines ride along as a breadcrumb so any genuinely
         * unrelated crash in the same session still carries compiler context. */
        publishCompilerDiagnostics(sourceFile, compilerText);
        const firstErrors = errorHeaders.join(' | ');
        (0, instrument_1.addExtensionBreadcrumb)('compile', 'failed', {
            file: path.basename(sourceFile),
            errors: (firstErrors || 'no error lines captured').slice(0, 600)
        });
        /* v1.5.6: undefined references to graphics symbols = the graphics
         * library could not be LINKED (classic: 32-bit MinGW.org g++ vs the
         * 64-bit libbgi.a). Turn the wall of linker errors into one fix. */
        if ((0, diagnostics_1.looksLikeBgiLinkFailure)(compilerText)) {
            log('[deps] graphics library could not be linked — the compiler is incompatible with libbgi.a');
            (0, instrument_1.captureExtensionWarning)('graphics library link failed (incompatible compiler/library)', {
                file: path.basename(sourceFile)
            });
            void vscode.window
                .showErrorMessage('The graphics library (libbgi.a) could not be LINKED — every graphics symbol is unresolved. ' +
                'This compiler cannot use the installed 64-bit graphics library (typical cause: the legacy ' +
                '32-bit MinGW.org g++). Complete Run Setup can install a compatible 64-bit MinGW-w64 ' +
                'compiler automatically.', 'Complete Run Setup (recommended)', 'Show Output')
                .then((pick) => {
                if (pick === 'Complete Run Setup (recommended)') {
                    vscode.commands.executeCommand('graphics-h-runner.setupEverything');
                }
                else if (pick === 'Show Output') {
                    output.show(true);
                }
            });
        }
    }
    return result;
}
/** Parse the compiler's output and surface it in the Problems panel. */
function publishCompilerDiagnostics(sourceFile, compilerText) {
    if (!diagnostics) {
        return;
    }
    try {
        const parsed = (0, diagnostics_1.capCompilerDiagnostics)((0, diagnostics_1.parseCompilerOutput)(compilerText), 200);
        diagnostics.clear();
        const byFile = new Map();
        for (const d of parsed) {
            const file = path.resolve(path.dirname(sourceFile), d.file);
            const line = Math.max(0, d.line - 1);
            const col = Math.max(0, (d.column || 1) - 1);
            const range = new vscode.Range(line, col, line, col + 1);
            const sev = d.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : d.severity === 'warning'
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;
            const diag = new vscode.Diagnostic(range, d.message, sev);
            diag.source = 'g++';
            const list = byFile.get(file) || [];
            list.push(diag);
            byFile.set(file, list);
        }
        for (const [file, list] of byFile) {
            diagnostics.set(vscode.Uri.file(file), list);
        }
    }
    catch {
        /* diagnostics must never break the compile flow */
    }
}
/**
 * v1.5.1 safety net: scan the fresh Windows exe for DLL imports that are not
 * part of base Windows. A dynamically-linked MinGW exe dies at launch with
 * exit code -1073741515 (0xC0000135 STATUS_DLL_NOT_FOUND) on student PCs —
 * this surfaces the problem AT COMPILE TIME, with the fix, instead of at run
 * time with a hex code the student cannot google.
 */
function auditExeAfterBuild(exePath) {
    try {
        const res = (0, depsAudit_1.auditWindowsExe)(exePath);
        if (!res) {
            return;
        }
        if (res.ok) {
            log('[deps] import audit OK — ' + path.basename(exePath) + ' runs without MinGW runtime DLLs');
            return;
        }
        log('[deps] WARNING: ' + (0, depsAudit_1.buildAuditMessage)(res, path.basename(exePath)));
        (0, instrument_1.captureExtensionWarning)('windows exe imports non-system DLLs', {
            exe: path.basename(exePath),
            dlls: res.missing.join(',').slice(0, 200)
        });
        void vscode.window
            .showWarningMessage(path.basename(exePath) + ' needs ' + res.missing.join(', ') +
            ' and would fail to launch on PCs without MinGW (exit code -1073741515). ' +
            'Rebuild with static linking enabled (it is on by default).', 'Show Output')
            .then((pick) => {
            if (pick === 'Show Output') {
                output.show(true);
            }
        });
    }
    catch {
        /* audit must never break the build flow */
    }
}
async function runBinary(sourceFile) {
    const platform = (0, toolchain_1.currentPlatform)();
    const bin = (0, toolchain_1.binaryPathFor)(sourceFile, platform);
    if (!fs.existsSync(bin)) {
        /* expected UX (Run before Compile) — the dialog below is the fix,
         * telemetry noise is not: breadcrumb only. */
        (0, instrument_1.addExtensionBreadcrumb)('run', 'binary not found', {
            file: path.basename(sourceFile),
            bin: path.basename(bin)
        });
        vscode.window.showErrorMessage(`Binary not found: ${bin}. Compile first.`, 'Compile now').then((pick) => {
            if (pick === 'Compile now') {
                vscode.commands.executeCommand('graphics-h-runner.compile');
            }
        });
        return;
    }
    /* v1.5.3: "Run" used to execute whatever binary was on disk — a student
     * who edits the source and presses Run saw the OLD program with no hint.
     * When the source is newer than the exe (50 ms slack absorbs copy/zip
     * mtime quirks), recompile first through the exact compileSource path
     * Ctrl+Alt+B uses, so diagnostics and the DLL audit stay identical. */
    try {
        if (fs.statSync(sourceFile).mtimeMs > fs.statSync(bin).mtimeMs + 50) {
            log('[run] source is newer than the exe — recompiling first');
            const staleness = await compileSource(sourceFile);
            if (staleness !== 'ok') {
                if (staleness === 'no-compiler') {
                    showNoCompilerHelp();
                }
                else {
                    showCompileFailure(sourceFile);
                }
                return;
            }
        }
    }
    catch {
        /* stat trouble — run what we have rather than blocking the student */
    }
    /* v1.5.4: every program runs in the ONE persistent runner terminal. The
     * shell is the terminal's root process and never exits, so the terminal
     * and all printf/cout output survive every program exit — and the same
     * terminal is reused for the next run (the v1.5.1/v1.5.3 pause wrappers
     * ran as the root process, so answering their "Press any key" prompt
     * closed the whole terminal, output and all). */
    /* Always run inside the integrated terminal: the graphics window opens as
     * usual, AND the terminal gives the program a real console — cin/scanf/getch
     * input works and printf/cout output is visible. The old detached launch had
     * no stdio at all, so interactive programs could neither read input nor show
     * output. */
    void runInTerminal(bin);
}
/** Promise-based sleep (pacing between Ctrl+C and the run line). */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Absolute cmd.exe path (the persistent Windows runner shell). */
function comSpecPath() {
    return (process.env.ComSpec ||
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'));
}
/** The persistent runner terminal: reused while alive, recreated if the user
 * closed it (adopting a live namesake first). Created ONCE, used ALWAYS —
 * "the same terminal every time". */
function ensureRunnerTerminal(cwd) {
    if (runnerTerminal && runnerTerminal.exitStatus === undefined) {
        return runnerTerminal;
    }
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && t.exitStatus === undefined);
    if (existing) {
        runnerTerminal = existing;
        return existing;
    }
    const windows = (0, toolchain_1.currentPlatform)() === 'windows';
    runnerTerminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        shellPath: windows ? comSpecPath() : '/bin/bash',
        cwd,
        env: compilerEnv(getConfig().compilerPath, [cwd])
    });
    return runnerTerminal;
}
async function runInTerminal(bin) {
    /* v1.5.4: ONE persistent terminal, reused for every run ("use the same
     * terminal always"). The program is started by TYPING its command line
     * into the live shell (sendText); the shell is the root process and never
     * exits, so the terminal and all program output stay open. The graphics
     * window opens as usual AND the program has a real console — cin/scanf/
     * getch work, printf/cout is visible. Ctrl+C (the Stop command) kills the
     * program and lands back at the prompt of the very same terminal. The
     * terminal env carries the COMPILER's bin dir so even a non-static exe
     * finds its runtime DLLs. */
    const abs = path.resolve(bin);
    const platform = (0, toolchain_1.currentPlatform)();
    const term = ensureRunnerTerminal(path.dirname(abs));
    /* If the previous program is still alive, stop it first (Ctrl+C) so the
     * new command line is not swallowed by the running program's stdin. When
     * the previous run already ended this is a harmless empty prompt line. */
    if (runState === 'running') {
        term.sendText('\x03');
        await delay(350);
    }
    const line = platform === 'windows' ? (0, runwrap_1.cmdRunLine)(abs) : (0, runwrap_1.posixRunLine)(abs);
    term.sendText(line + '\r');
    term.show(false); /* focus the terminal so prompts can be answered at once */
    log('[run] ' + abs + ' (persistent ' + (platform === 'windows' ? 'cmd' : 'bash') +
        ' terminal — command typed into the live shell)');
    (0, instrument_1.addExtensionBreadcrumb)('run', 'terminal-persistent', {
        file: path.basename(abs),
        shell: platform === 'windows' ? 'cmd' : 'bash'
    });
    setRunState('running');
}
/** Stop the most recently started program (Stop command): Ctrl+C typed into
 * the persistent runner terminal. The terminal itself is NOT closed — it
 * keeps all output and is immediately ready for the next run ("use the same
 * terminal always"); closing it is the user's choice. */
async function stopRunningProgram() {
    const term = runnerTerminal;
    if (runState === 'running' && term && term.exitStatus === undefined) {
        /* The pty raises SIGINT (POSIX) / delivers CTRL_C_EVENT (Windows) to the
         * running console program, which dies and returns control to the shell
         * prompt. The exe is a console-subsystem binary and the graphics window
         * belongs to the same process, so the window closes with it. The exe is
         * a direct command (not a batch file), so Windows never shows the
         * "Terminate batch job (Y/N)?" prompt. */
        term.sendText('\x03');
        setRunState('idle');
        log('[stop] sent Ctrl+C to the persistent runner terminal');
        vscode.window.showInformationMessage('Stopped the running graphics program.');
        return;
    }
    vscode.window.showInformationMessage('No graphics.h program is currently running.');
}
async function getTargetSourceFile() {
    const editor = vscode.window.activeTextEditor;
    if (editor && (0, toolchain_1.isCppSourceFile)(editor.document.fileName)) {
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        return editor.document.fileName;
    }
    /* untitled documents (sidebar examples opened without a workspace folder)
     * have no path to compile — offer a Save dialog first instead of failing */
    if (editor && (editor.document.uri.scheme === 'untitled') && /^c(pp|\+\+)?$/i.test(editor.document.languageId)) {
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        const defaultUri = vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.join(os.homedir(), 'Documents'), 'program.cpp'));
        const target = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'C++ source': ['cpp', 'cc', 'cxx'], 'C source': ['c'] }
        });
        if (!target) {
            return undefined;
        }
        const buf = Buffer.from(editor.document.getText(), 'utf8');
        fs.writeFileSync(target.fsPath, buf);
        const doc = await vscode.workspace.openTextDocument(target.fsPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        log('[compile] untitled document saved to ' + target.fsPath);
        return target.fsPath;
    }
    const cppEditors = vscode.window.visibleTextEditors.filter((e) => (0, toolchain_1.isCppSourceFile)(e.document.fileName));
    if (cppEditors.length === 1) {
        if (cppEditors[0].document.isDirty) {
            await cppEditors[0].document.save();
        }
        return cppEditors[0].document.fileName;
    }
    if (cppEditors.length > 1) {
        const picked = await vscode.window.showQuickPick(cppEditors.map((e) => path.basename(e.document.fileName)), { placeHolder: 'Select the C++ file to build' });
        const chosen = cppEditors.find((e) => path.basename(e.document.fileName) === picked);
        if (chosen) {
            return chosen.document.fileName;
        }
    }
    vscode.window.showErrorMessage('Open a .cpp file (that includes <graphics.h>) and try again.');
    return undefined;
}
function showCompileFailure(sourceFile) {
    vscode.window
        .showErrorMessage(`Compilation failed for ${path.basename(sourceFile)}. See the "${OUTPUT_CHANNEL_NAME}" output for errors.`, 'Show Output', 'Setup Doctor')
        .then((pick) => {
        if (pick === 'Show Output') {
            output.show(true);
        }
        else if (pick === 'Setup Doctor') {
            vscode.commands.executeCommand('graphics-h-runner.doctor');
        }
    });
}
/** The compiler itself is missing — offer the fully automatic fix. */
function showNoCompilerHelp() {
    vscode.window
        .showErrorMessage('No C++ compiler found on this PC. graphics.h Runner can set up everything from zero — compiler + graphics library, no admin rights.', 'Complete Run Setup (recommended)', 'Run Setup Doctor', 'Show Output')
        .then((pick) => {
        if (pick === 'Complete Run Setup (recommended)') {
            vscode.commands.executeCommand('graphics-h-runner.setupEverything');
        }
        else if (pick === 'Run Setup Doctor') {
            vscode.commands.executeCommand('graphics-h-runner.doctor');
        }
        else if (pick === 'Show Output') {
            output.show(true);
        }
    });
}
/* ---------------- status bar ---------------- */
function setRunState(state) {
    if (runState === state) {
        return;
    }
    runState = state;
    updateStatusBar();
}
function updateStatusBar() {
    if (!statusItem) {
        return;
    }
    const cfg = getConfig();
    if (!cfg.showStatusBarItem) {
        statusItem.hide();
        return;
    }
    if (runState === 'compiling') {
        statusItem.text = '$(sync~spin) graphics.h';
        statusItem.command = 'graphics-h-runner.doctor';
        statusItem.tooltip = 'Compiling your program…';
        statusItem.show();
        return;
    }
    if (runState === 'running') {
        statusItem.text = '$(debug-stop) graphics.h';
        statusItem.command = 'graphics-h-runner.stopProgram';
        statusItem.tooltip = 'A graphics program is RUNNING — click to stop it (Ctrl+Alt+S).';
        statusItem.show();
        return;
    }
    statusItem.command = 'graphics-h-runner.doctor';
    statusItem.text = '$(circle-outline) graphics.h';
    statusItem.show();
    if (!doctorCache) {
        statusItem.text = '$(circle-outline) graphics.h';
        statusItem.tooltip = 'graphics.h environment not checked yet — click to run the Setup Doctor';
        return;
    }
    if (doctorCache.graphicsReady) {
        statusItem.text = '$(check) graphics.h';
        statusItem.tooltip = `graphics.h ready — compiler OK, library: ${doctorCache.bestLibrary}. Click to re-run the Setup Doctor.`;
    }
    else {
        statusItem.text = '$(alert) graphics.h';
        statusItem.tooltip = `graphics.h NOT ready — ${doctorCache.compilerCheck.ok ? 'no graphics library found' : 'no working C++ compiler'}. Click for the Setup Doctor, or run Full Setup.`;
    }
}
async function runDoctor(verbose) {
    if (doctorRunning) {
        return doctorRunning;
    }
    const cfg = getConfig();
    if (statusItem) {
        statusItem.text = '$(sync~spin) BGI';
    }
    doctorRunning = (0, doctor_1.probeEnvironment)({
        platform: (0, toolchain_1.currentPlatform)(),
        compilerPath: cfg.compilerPath,
        linuxLibrary: cfg.linuxLibrary,
        extraIncludePaths: cfg.extraIncludePaths,
        extraLibPaths: cfg.extraLibPaths
    }).finally(() => {
        doctorRunning = undefined;
    });
    const res = await doctorRunning;
    doctorCache = res;
    updateStatusBar();
    panel?.setDoctorResult(res);
    (0, instrument_1.addExtensionBreadcrumb)('doctor', res.graphicsReady ? 'ready' : 'not ready', {
        compilerOk: String(res.compilerCheck.ok),
        bestLibrary: String(res.bestLibrary || '')
    });
    log('=== Setup Doctor ===');
    log(`platform      : ${res.platform}`);
    log(`compiler      : ${res.compilerCheck.ok ? 'OK' : 'MISSING'} — ${res.compilerCheck.detail}`);
    for (const lib of res.libraryChecks) {
        log(`library ${lib.name.padEnd(9)}: ${lib.ok ? 'OK' : 'not found'} — ${lib.detail}`);
        if (!lib.ok && lib.fix) {
            log(`   fix -> ${lib.fix}`);
        }
    }
    if (res.globalCheck) {
        log(`global       : ${res.globalCheck.ok ? 'OK — plain g++ resolves graphics.h in ANY terminal' : 'extension-only'} — ${res.globalCheck.detail}`);
        if (!res.globalCheck.ok && res.globalCheck.fix) {
            log(`   fix -> ${res.globalCheck.fix}`);
        }
    }
    log(`graphics.h    : ${res.graphicsReady ? 'READY' : 'NOT READY'}`);
    log('');
    if (verbose) {
        if (res.graphicsReady) {
            vscode.window
                .showInformationMessage(`graphics.h environment is ready (library: ${res.bestLibrary}).`, 'Show Output')
                .then((pick) => {
                if (pick === 'Show Output') {
                    output.show(true);
                }
            });
        }
        else {
            const picks = ['Fix automatically', 'Show Output'];
            const pick = await vscode.window.showWarningMessage('graphics.h environment is not ready yet. The Setup Doctor found problems.', ...picks);
            if (pick === 'Show Output') {
                output.show(true);
            }
            else if (pick === 'Fix automatically') {
                vscode.commands.executeCommand('graphics-h-runner.setupEverything');
            }
        }
    }
    return res;
}
/* ---------------- sidebar: open a program as filename.cpp ---------------- */
async function openProgram(program) {
    if (!program || !program.source) {
        vscode.window.showErrorMessage('No program selected.');
        return;
    }
    try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const target = (0, programs_1.resolveProgramTarget)(folder, program.filename);
        if (target) {
            if (!fs.existsSync(target)) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, program.source, 'utf8');
                log('[programs] created ' + target);
            }
            const doc = await vscode.workspace.openTextDocument(target);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
        else if (storageDir) {
            /* No folder open: still give the example a REAL file on disk (private
             * extension storage) so one-click Run works immediately — no untitled
             * document, no Save-As dialog in the way. */
            const dir = path.join(storageDir, 'examples');
            fs.mkdirSync(dir, { recursive: true });
            const realFile = path.join(dir, program.filename);
            if (!fs.existsSync(realFile)) {
                fs.writeFileSync(realFile, program.source, 'utf8');
                log('[programs] created ' + realFile + ' (no workspace folder open)');
            }
            const doc = await vscode.workspace.openTextDocument(realFile);
            await vscode.window.showTextDocument(doc, { preview: false });
            void vscode.window.showInformationMessage(`Opened ${program.filename} from graphics.h Runner storage — press Run to compile & launch.`);
        }
        else {
            const doc = await vscode.workspace.openTextDocument({
                language: 'cpp',
                content: program.source
            });
            await vscode.window.showTextDocument(doc);
            void vscode.window.showInformationMessage(`No folder is open — use "Save As" to keep this file as ${program.filename}.`);
        }
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not open program: ' + String(e));
        (0, instrument_1.captureExtensionError)(e, { command: 'openProgram' });
    }
}
/** Copy every bundled example into a workspace folder and reveal it. */
async function openExamplesFolder(context) {
    try {
        const catalog = (0, programs_1.loadProgramCatalog)(context.extensionPath);
        if (catalog.length === 0) {
            vscode.window.showErrorMessage('No example programs were found in the installation.');
            return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (folder) {
            const dir = path.join(folder, 'graphics-h-programs');
            fs.mkdirSync(dir, { recursive: true });
            for (const prog of catalog) {
                const target = path.join(dir, prog.filename);
                if (!fs.existsSync(target)) {
                    fs.writeFileSync(target, prog.source, 'utf8');
                }
            }
            log('[examples] copied ' + catalog.length + ' programs to ' + dir);
            await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir));
            void vscode.window.showInformationMessage(`${catalog.length} example programs are in graphics-h-programs/ — open any and press Ctrl+Alt+R.`);
        }
        else {
            /* no workspace: offer to open the examples as a workspace folder */
            const pick = await vscode.window.showInformationMessage('Open a folder first so the examples have somewhere to live. Open the examples folder as a workspace?', 'Open Examples Folder', 'Cancel');
            if (pick === 'Open Examples Folder') {
                const dir = path.join(context.globalStorageUri.fsPath, 'examples');
                fs.mkdirSync(dir, { recursive: true });
                for (const prog of catalog) {
                    const target = path.join(dir, prog.filename);
                    if (!fs.existsSync(target)) {
                        fs.writeFileSync(target, prog.source, 'utf8');
                    }
                }
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), false);
            }
        }
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not open the examples folder: ' + String(e));
        (0, instrument_1.captureExtensionError)(e, { command: 'openExamplesFolder' });
    }
}
/** Copy the exact compiler command line for the active file to the clipboard. */
async function copyCompileCommand() {
    const file = await getTargetSourceFile();
    if (!file) {
        return;
    }
    try {
        const plan = resolvePlan(file, getConfig());
        await vscode.env.clipboard.writeText(plan.commandLine);
        void vscode.window.showInformationMessage('Compile command copied to the clipboard.', 'Show Output').then((pick) => {
            if (pick === 'Show Output') {
                output.show(true);
            }
        });
        log('[copy] ' + plan.commandLine);
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not build the compile command: ' + String(e));
    }
}
/* ---------------- activation ---------------- */
/** Native TreeView shown (and focused) when the webview fails to load. */
const FALLBACK_VIEW_ID = 'graphics-h-runner.fallback';
/** Panel click router: buttons in the webview land here. */
async function handlePanelClick(msg) {
    if (msg.type === 'pong') {
        return; /* liveness heartbeat — handled by the panel's watchdog */
    }
    if (msg.type === 'command') {
        const known = await vscode.commands.getCommands().then((all) => all.includes(msg.command));
        if (known) {
            await vscode.commands.executeCommand(msg.command);
        }
        else {
            vscode.window.showErrorMessage('Unknown action: ' + msg.command);
        }
        return;
    }
    const prog = catalog.find((p) => p.id === msg.id);
    if (!prog) {
        vscode.window.showErrorMessage('Example program not found: ' + msg.id);
        return;
    }
    if (msg.type === 'openProgram') {
        await openProgram(prog);
        return;
    }
    /* runProgram: open + compile + run in one click */
    await openProgram(prog);
    await vscode.commands.executeCommand('graphics-h-runner.compileAndRun');
}
function activate(context) {
    output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(output);
    /* compile errors -> Problems panel: clickable file:line entries + squiggles */
    diagnostics = vscode.languages.createDiagnosticCollection('graphics.h Runner');
    context.subscriptions.push(diagnostics);
    /* ---- automatic error collection (Sentry — see instrument.ts) ---- */
    (0, instrument_1.setTelemetryContext)({ extensionRoot: context.extensionPath, extensionMode: context.extensionMode });
    (0, instrument_1.initTelemetry)(); /* consent may have flipped since module load */
    (0, instrument_1.setRuntimeTags)({
        'vscode.version': String(vscode.version || 'unknown'),
        'vscode.app_host': String(vscode.env.appHost || 'unknown'),
        'vscode.uri_scheme': String(vscode.env.uriScheme || 'unknown')
    });
    context.subscriptions.push(vscode.env.onDidChangeTelemetryEnabled((enabled) => {
        (0, instrument_1.onTelemetryConsentChanged)(enabled);
    }));
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    statusItem.name = 'graphics.h environment';
    statusItem.command = 'graphics-h-runner.doctor';
    context.subscriptions.push(statusItem);
    updateStatusBar();
    // Background probe so the status bar is meaningful without user action.
    void runDoctor(false).catch(() => {
        /* errors already logged */
    });
    // ---- activity bar: modern webpage-style panel ----
    catalog = (0, programs_1.loadProgramCatalog)(context.extensionPath);
    log(`[programs] panel catalog: ${catalog.length} programs loaded`);
    storageDir = context.globalStorageUri.fsPath;
    const version = String(context.extension.packageJSON?.version || '0.0.0');
    const panelProvider = new panelView_1.GhPanelProvider(context.extensionPath, version, catalog, (msg) => {
        void handlePanelClick(msg);
    }, {
        onPanelFirstOpen: () => {
            /* v1.5.5 School Pride — once per session, first panel open */
            if (!schoolPrideDone) {
                schoolPrideDone = true;
                celebrate('schoolpride');
            }
        },
        onWebviewEvent: (ev) => {
            if (ev === 'retry') {
                log('[panel] webview did not answer — re-rendering once to clear the service-worker race');
                return;
            }
            if (ev === 'fallback') {
                log('[panel] webview failed to load — switching to the list view automatically');
                (0, instrument_1.addExtensionBreadcrumb)('panel', 'webview fallback engaged');
                /* resilience WORKED here (automatic retry + list-view fallback):
                 * warning-level visibility, not an error issue */
                (0, instrument_1.captureExtensionWarning)('webview failed to load (no pong after retry render)', {
                    stage: 'webview-fallback'
                });
                void (async () => {
                    await vscode.commands.executeCommand('setContext', 'graphics-h-runner.showFallback', true);
                    await vscode.commands.executeCommand(FALLBACK_VIEW_ID + '.focus');
                })().catch(() => undefined);
                return;
            }
            if (ev === 'alive') {
                /* the webview answers again — the fallback list no longer needed */
                void vscode.commands
                    .executeCommand('setContext', 'graphics-h-runner.showFallback', false)
                    .then(() => undefined, () => undefined);
            }
        }
    });
    panel = panelProvider;
    /* v1.5.5: the celebration overlay + its workbench state sync */
    celebrator = new celebrateHost_1.Celebrator(context.extensionPath, {
        onStateChange: (kind) => {
            const running = kind === 'fireworks';
            void vscode.commands
                .executeCommand('setContext', 'graphics-h-runner.fireworksRunning', running)
                .then(() => undefined, () => undefined);
            panelProvider.setFireworksState(running);
        },
        onLog: log
    });
    context.subscriptions.push({ dispose: () => celebrator?.dispose() });
    if (doctorCache) {
        panelProvider.setDoctorResult(doctorCache);
    }
    /* ---- native list view: instant fallback when the webview cannot load,
     * hidden by default (context key) and revealed only on failure ---- */
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(panelView_1.GhPanelProvider.VIEW_ID, panelProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }), vscode.window.createTreeView(FALLBACK_VIEW_ID, {
        treeDataProvider: new programsTree_1.GhFallbackTreeProvider(catalog),
        showCollapseAll: false
    }), vscode.commands.registerCommand('graphics-h-runner.runSample', trackedCommand('runSample', async (programId) => {
        /* used by the fallback tree: open + compile + run in one click */
        await handlePanelClick({ type: 'runProgram', id: String(programId || '') });
    })), 
    /* v1.5.5: one STATIC command per example program for the fallback tree
     * (TreeItem.command must not carry arguments — see programsTreeModel). */
    ...catalog.map((p) => vscode.commands.registerCommand((0, programsTreeModel_1.treeRunCommandId)(p.id), trackedCommand('runSample:' + p.id, async () => {
        await handlePanelClick({ type: 'runProgram', id: p.id });
    }))), vscode.commands.registerCommand('graphics-h-runner.fireworks', trackedCommand('fireworks', () => {
        /* the SAME button starts and stops the show */
        if (celebrator?.running === 'fireworks') {
            celebrator.stop();
            return;
        }
        celebrator?.show('fireworks');
    })), vscode.commands.registerCommand('graphics-h-runner.stopFireworks', trackedCommand('stopFireworks', () => {
        celebrator?.stop();
    })), vscode.commands.registerCommand('graphics-h-runner.reloadPanel', trackedCommand('reloadPanel', () => {
        panel?.reloadPanel();
    })), vscode.commands.registerCommand('graphics-h-runner.openProgram', trackedCommand('openProgram', async (program) => {
        await openProgram(program); /* awaitable: executeCommand resolves when the file is open */
    })));
    void vscode.commands
        .executeCommand('setContext', 'graphics-h-runner.showFallback', false)
        .then(() => undefined, () => undefined);
    // ---- F5 / Run-and-Debug integration ("Run graphics.h program") ----
    (0, debugAdapter_1.registerGraphicsHDebugger)(context, async (file, outputLine) => {
        panel?.setBusy(true, 'Compiling ' + path.basename(file) + '…');
        try {
            const result = await compileSource(file);
            if (result === 'ok') {
                outputLine('Compiled OK — launching the graphics window.');
                await runBinary(file);
                return { ok: true, message: '' };
            }
            if (result === 'no-compiler') {
                showNoCompilerHelp();
                return { ok: false, message: 'No working C++ compiler was found on this PC.' };
            }
            showCompileFailure(file);
            return { ok: false, message: 'Compilation failed — see the graphics.h Runner output.' };
        }
        finally {
            panel?.setBusy(false);
        }
    });
    context.subscriptions.push(vscode.commands.registerCommand('graphics-h-runner.compileAndRun', trackedCommand('compileAndRun', async () => {
        panel?.setBusy(true, 'Compiling…');
        try {
            const file = await getTargetSourceFile();
            if (!file) {
                return;
            }
            const result = await compileSource(file);
            if (result === 'ok') {
                await runBinary(file);
            }
            else if (result === 'no-compiler') {
                showNoCompilerHelp();
            }
            else {
                showCompileFailure(file);
            }
        }
        finally {
            panel?.setBusy(false);
        }
    })), vscode.commands.registerCommand('graphics-h-runner.compile', trackedCommand('compile', async () => {
        panel?.setBusy(true, 'Compiling…');
        try {
            const file = await getTargetSourceFile();
            if (!file) {
                return;
            }
            const result = await compileSource(file);
            if (result === 'ok') {
                vscode.window.showInformationMessage(`Compiled OK: ${path.basename((0, toolchain_1.binaryPathFor)(file, (0, toolchain_1.currentPlatform)()))}`);
            }
            else if (result === 'no-compiler') {
                showNoCompilerHelp();
            }
            else {
                showCompileFailure(file);
            }
        }
        finally {
            panel?.setBusy(false);
        }
    })), vscode.commands.registerCommand('graphics-h-runner.run', trackedCommand('run', async () => {
        const file = await getTargetSourceFile();
        if (!file) {
            return;
        }
        await runBinary(file);
    })), vscode.commands.registerCommand('graphics-h-runner.stopProgram', trackedCommand('stopProgram', () => {
        void stopRunningProgram();
    })), vscode.commands.registerCommand('graphics-h-runner.doctor', trackedCommand('doctor', async () => {
        await runDoctor(true).catch(() => undefined);
    })), vscode.commands.registerCommand('graphics-h-runner.setupEverything', trackedCommand('setupEverything', () => {
        void runFullSetup(context).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.trim() === 'Canceled') {
                /* user dismissed the progress notification — not an error
                 * (the only real issue Sentry ever saw for this command) */
                log('[setup] canceled by the user');
                panel?.setBusy(false);
                return;
            }
            log('[setup] crashed: ' + String(e));
            (0, instrument_1.captureExtensionError)(e, { command: 'setupEverything' });
            panel?.setBusy(false);
            vscode.window.showErrorMessage('Complete Setup failed: ' + String(e));
        });
    })), vscode.commands.registerCommand('graphics-h-runner.copyCompileCommand', trackedCommand('copyCompileCommand', () => {
        void copyCompileCommand();
    })), vscode.commands.registerCommand('graphics-h-runner.openExamplesFolder', trackedCommand('openExamplesFolder', () => {
        void openExamplesFolder(context);
    })), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_PREFIX)) {
            doctorCache = undefined;
            updateStatusBar();
            panel?.setDoctorResult(undefined);
            void runDoctor(false).catch(() => undefined);
        }
    }), vscode.window.onDidCloseTerminal((t) => {
        if (t === runnerTerminal) {
            /* the user closed the persistent terminal — the next Run
             * creates a fresh one with the same name */
            runnerTerminal = undefined;
            setRunState('idle');
        }
    }));
    log('graphics.h Runner activated.');
    (0, instrument_1.addExtensionBreadcrumb)('lifecycle', 'activated');
}
async function deactivate() {
    /* give queued Sentry events a moment to leave before the host tears us down */
    await (0, instrument_1.flushTelemetry)(2000);
}
//# sourceMappingURL=extension.js.map