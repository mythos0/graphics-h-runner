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
const debugAdapter_1 = require("./debugAdapter");
const normalize_1 = require("./normalize");
const instrument_1 = require("./instrument");
const OUTPUT_CHANNEL_NAME = 'graphics.h Runner';
const TERMINAL_NAME = 'graphics.h Runner';
const CONFIG_PREFIX = 'graphics-h-runner.';
let output;
let statusItem;
let doctorCache;
let doctorRunning;
let panel;
let catalog = [];
let lastRunChild = null;
let lastRunTerminal;
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
/** First g++.exe candidate that actually runs (Windows). */
async function findWorkingGpp() {
    for (const candidate of (0, setup_1.discoverGppWindows)()) {
        const v = await (0, setup_1.verifyCompilerRun)(candidate);
        if (v.ok) {
            return { gppPath: candidate, version: v.version };
        }
    }
    return undefined;
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
function compilerEnv(compiler) {
    const env = { ...process.env };
    try {
        if (path.isAbsolute(compiler)) {
            const dir = path.dirname(compiler);
            if (fs.existsSync(dir)) {
                env.PATH = dir + path.delimiter + (env.PATH || '');
            }
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
        let sdl2DevOk = true;
        if (platform === 'linux' || platform === 'macos') {
            progress.report({ message: 'Checking SDL2 headers…' });
            sdl2DevOk = await (0, setup_1.checkSdl2Dev)({ cc: platform === 'macos' ? 'clang' : 'gcc' });
        }
        const plan = (0, setup_1.planSetup)(platform, probe, sdl2DevOk);
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
                 * winget run, manual install, IDE bundle) — skip the whole download */
                const existing = await findWorkingGpp();
                if (existing) {
                    await setCompilerPathSetting(existing.gppPath);
                    summary.push(`Compiler already present on this PC — using ${existing.gppPath} (${existing.version}). winget step skipped.`);
                    continue;
                }
                const winget = await (0, setup_1.installCompilerViaWinget)((p) => progress.report({ message: p.message.slice(0, 110) }));
                log('[setup] winget: ' + winget.detail);
                (0, instrument_1.addExtensionBreadcrumb)('setup.step', 'install-compiler-winget', { ok: String(winget.ok) });
                const found = await findWorkingGpp();
                if (found) {
                    await setCompilerPathSetting(found.gppPath);
                    summary.push(`Compiler installed automatically via winget: ${found.gppPath} (${found.version})`);
                }
                else if (winget.ok) {
                    summary.push('winget finished but no working g++.exe was found — trying the direct-download fallback next.');
                }
                else {
                    summary.push('winget automatic install not possible: ' + winget.detail + ' — trying the direct-download fallback next.');
                }
            }
            else if (step.kind === 'auto' && step.id === 'install-compiler-download') {
                const current = getConfig();
                const already = (await (0, setup_1.verifyCompilerRun)(current.compilerPath || 'g++')).ok ||
                    Boolean(await findWorkingGpp());
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
        child.stderr?.on('data', (d) => output.append(d.toString()));
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
    (0, instrument_1.addExtensionBreadcrumb)('compile', result, { file: path.basename(sourceFile) });
    return result;
}
function runBinary(sourceFile) {
    const platform = (0, toolchain_1.currentPlatform)();
    const bin = (0, toolchain_1.binaryPathFor)(sourceFile, platform);
    if (!fs.existsSync(bin)) {
        vscode.window.showErrorMessage(`Binary not found: ${bin}. Compile first.`, 'Compile now').then((pick) => {
            if (pick === 'Compile now') {
                vscode.commands.executeCommand('graphics-h-runner.compile');
            }
        });
        return;
    }
    /* Windows: launch the .exe directly (detached). This is immune to whichever
     * shell the user's terminal profile uses (PowerShell/cmd/Git Bash quoting
     * differences), and the graphics window lives on its own. */
    if (platform === 'windows') {
        try {
            const child = (0, child_process_1.spawn)(bin, [], {
                cwd: path.dirname(bin),
                env: compilerEnv(bin),
                detached: true,
                stdio: 'ignore',
                windowsHide: false
            });
            child.on('error', (e) => {
                log('[run] detached launch failed: ' + e.message + ' — falling back to terminal');
                runInTerminal(bin, platform);
            });
            child.unref();
            lastRunChild = child;
            lastRunTerminal = undefined;
            log('[run] ' + bin + ' (detached)');
            (0, instrument_1.addExtensionBreadcrumb)('run', 'detached', { file: path.basename(bin) });
            return;
        }
        catch {
            runInTerminal(bin, platform);
            return;
        }
    }
    runInTerminal(bin, platform);
}
function runInTerminal(bin, platform) {
    const term = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && !t.exitStatus) ||
        vscode.window.createTerminal(TERMINAL_NAME);
    term.show(true);
    const abs = path.resolve(bin);
    const cmd = platform === 'windows' ? `& "${abs}"` : `"${abs}"`;
    log('[run] ' + cmd);
    term.sendText(cmd, true);
    lastRunTerminal = term;
}
/** Kill the most recently launched graphics program (Stop command). */
async function stopRunningProgram() {
    const child = lastRunChild;
    const term = lastRunTerminal;
    lastRunChild = null;
    lastRunTerminal = undefined;
    if (child && child.pid && child.exitCode === null) {
        try {
            if ((0, toolchain_1.currentPlatform)() === 'windows') {
                /* /T = whole tree, /F = force — works for detached GUI exes */
                await new Promise((resolve) => {
                    const killer = (0, child_process_1.spawn)('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
                    killer.on('close', () => resolve());
                    killer.on('error', () => resolve());
                });
            }
            else {
                child.kill('SIGKILL');
            }
            log('[stop] killed running program (pid ' + child.pid + ')');
            vscode.window.showInformationMessage('Stopped the running graphics program.');
            return;
        }
        catch (e) {
            log('[stop] kill failed: ' + String(e));
        }
    }
    if (term && !term.exitStatus) {
        term.dispose(); /* closes the shell and with it the running binary */
        log('[stop] disposed runner terminal');
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
function updateStatusBar() {
    if (!statusItem) {
        return;
    }
    const cfg = getConfig();
    statusItem.text = '$(circle-outline) graphics.h';
    if (!cfg.showStatusBarItem) {
        statusItem.hide();
        return;
    }
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
/** Panel click router: buttons in the webview land here. */
async function handlePanelClick(msg) {
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
    /* ---- automatic error collection (Sentry — see instrument.ts) ---- */
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
    const version = String(context.extension.packageJSON?.version || '0.0.0');
    const panelProvider = new panelView_1.GhPanelProvider(context.extensionPath, version, catalog, (msg) => {
        void handlePanelClick(msg);
    });
    panel = panelProvider;
    if (doctorCache) {
        panelProvider.setDoctorResult(doctorCache);
    }
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(panelView_1.GhPanelProvider.VIEW_ID, panelProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }), vscode.commands.registerCommand('graphics-h-runner.openProgram', trackedCommand('openProgram', (program) => {
        void openProgram(program);
    })));
    // ---- F5 / Run-and-Debug integration ("Run graphics.h program") ----
    (0, debugAdapter_1.registerGraphicsHDebugger)(context, async (file, outputLine) => {
        panel?.setBusy(true, 'Compiling ' + path.basename(file) + '…');
        try {
            const result = await compileSource(file);
            if (result === 'ok') {
                outputLine('Compiled OK — launching the graphics window.');
                runBinary(file);
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
                runBinary(file);
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
        runBinary(file);
    })), vscode.commands.registerCommand('graphics-h-runner.stopProgram', trackedCommand('stopProgram', () => {
        void stopRunningProgram();
    })), vscode.commands.registerCommand('graphics-h-runner.doctor', trackedCommand('doctor', async () => {
        await runDoctor(true).catch(() => undefined);
    })), vscode.commands.registerCommand('graphics-h-runner.setupEverything', trackedCommand('setupEverything', () => {
        void runFullSetup(context).catch((e) => {
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
        if (t === lastRunTerminal) {
            lastRunTerminal = undefined;
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