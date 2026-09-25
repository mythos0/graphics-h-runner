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
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const toolchain_1 = require("./toolchain");
const detect_1 = require("./detect");
const buildArgs_1 = require("./buildArgs");
const doctor_1 = require("./doctor");
const setup_1 = require("./setup");
const templates_1 = require("./templates");
const guide_1 = require("./guide");
const programs_1 = require("./programs");
const programsView_1 = require("./programsView");
const OUTPUT_CHANNEL_NAME = 'graphics.h Runner';
const TERMINAL_NAME = 'graphics.h Runner';
const CONFIG_PREFIX = 'graphics-h-runner.';
let output;
let statusItem;
let doctorCache;
let doctorRunning;
function getConfig() {
    const cfg = vscode.workspace.getConfiguration();
    return {
        compilerPath: cfg.get(CONFIG_PREFIX + 'compilerPath', 'g++'),
        autoDetect: cfg.get(CONFIG_PREFIX + 'autoDetect', true),
        linuxLibrary: cfg.get(CONFIG_PREFIX + 'linuxLibrary', 'auto'),
        staticLinkWindows: cfg.get(CONFIG_PREFIX + 'staticLinkWindows', true),
        extraIncludePaths: cfg.get(CONFIG_PREFIX + 'extraIncludePaths', []),
        extraLibPaths: cfg.get(CONFIG_PREFIX + 'extraLibPaths', []),
        extraCompilerArgs: cfg.get(CONFIG_PREFIX + 'extraCompilerArgs', []),
        showStatusBarItem: cfg.get(CONFIG_PREFIX + 'showStatusBarItem', true)
    };
}
function log(line) {
    output.appendLine(line);
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
async function runFullSetup(context) {
    const platform = (0, toolchain_1.currentPlatform)();
    const storageRoot = context.globalStorageUri.fsPath;
    const cfg = getConfig();
    const summary = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'graphics.h: Full Setup', cancellable: false }, async (progress) => {
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
            if (step.kind === 'auto' && step.id === 'install-sdl_bgi') {
                try {
                    const res = await (0, setup_1.installSdlBgiUserPrefix)({ storageRoot });
                    await addPathsToSetting('extraIncludePaths', [res.includeDir]);
                    await addPathsToSetting('extraLibPaths', [res.libDir]);
                    summary.push('SDL_bgi downloaded, patched, built and installed into a user folder (no admin rights needed).');
                }
                catch (e) {
                    output.appendLine('[setup] SDL_bgi install error: ' + String(e));
                    summary.push('SDL_bgi auto-install FAILED: ' + String(e));
                }
            }
            else if (step.kind === 'auto' && step.id === 'install-winbgim') {
                try {
                    const res = await (0, setup_1.installWinbgimWindows)(storageRoot);
                    await addPathsToSetting('extraIncludePaths', [res.includeDir]);
                    await addPathsToSetting('extraLibPaths', [res.libDir]);
                    summary.push('WinBGIM (graphics.h / winbgim.h / libbgi.a) installed into the extension folder.');
                }
                catch (e) {
                    output.appendLine('[setup] WinBGIM install error: ' + String(e));
                    summary.push('WinBGIM auto-install FAILED: ' + String(e));
                }
            }
            else if (step.kind === 'terminal') {
                summary.push(`ACTION NEEDED (run in a terminal): ${step.command}`);
            }
            else if (step.kind === 'manual') {
                summary.push(`ACTION NEEDED (manual): ${step.detail}${step.url ? ' — ' + step.url : ''}`);
            }
            else if (step.kind === 'verify') {
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
                summary.push(res.graphicsReady
                    ? `VERIFIED: graphics.h is ready (library: ${res.bestLibrary}). Press Ctrl+Alt+R inside a graphics.h program to run it.`
                    : 'NOT READY YET — finish the ACTION NEEDED items above, then re-run Full Setup.');
            }
        }
    });
    output.show(true);
    output.appendLine('=== Full Setup summary ===');
    summary.forEach((s) => output.appendLine('- ' + s));
    const needsAction = summary.some((s) => s.startsWith('ACTION NEEDED'));
    if (needsAction) {
        const pick = await vscode.window.showInformationMessage('A few system packages must be installed with your password. Run the printed commands in the terminal, then re-run "Full Setup" to verify.', 'Open Terminal', 'Show Output');
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
        vscode.window.showWarningMessage('Full Setup finished with problems — see the graphics.h Runner output.');
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
    const ok = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `graphics.h: compiling ${path.basename(sourceFile)}…`,
        cancellable: false
    }, () => new Promise((resolve) => {
        let child;
        try {
            child = (0, child_process_1.spawn)(plan.compiler, plan.args, {
                cwd: path.dirname(sourceFile),
                windowsHide: true
            });
        }
        catch (e) {
            log('[error] failed to start compiler: ' + String(e));
            resolve(false);
            return;
        }
        child.stdout?.on('data', (d) => output.append(d.toString()));
        child.stderr?.on('data', (d) => output.append(d.toString()));
        child.on('error', (e) => {
            log('[error] ' + e.message);
            resolve(false);
        });
        child.on('close', (code) => {
            log(code === 0 ? '[compile] success' : `[compile] failed with exit code ${code}`);
            resolve(code === 0);
        });
    }));
    return ok;
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
    const term = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && !t.exitStatus) ||
        vscode.window.createTerminal(TERMINAL_NAME);
    term.show(true);
    const abs = path.resolve(bin);
    const cmd = platform === 'windows' ? `& "${abs}"` : `"${abs}"`;
    log('[run] ' + cmd);
    term.sendText(cmd, true);
}
async function getTargetSourceFile() {
    const editor = vscode.window.activeTextEditor;
    if (editor && (0, toolchain_1.isCppSourceFile)(editor.document.fileName)) {
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        return editor.document.fileName;
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
/* ---------------- status bar ---------------- */
function updateStatusBar() {
    if (!statusItem) {
        return;
    }
    const cfg = getConfig();
    statusItem.text = '$(check) BGI';
    if (!cfg.showStatusBarItem) {
        statusItem.hide();
        return;
    }
    statusItem.show();
    if (!doctorCache) {
        statusItem.text = '$(circle-outline) BGI';
        statusItem.tooltip = 'graphics.h environment not checked yet — click to run the Setup Doctor';
        return;
    }
    if (doctorCache.graphicsReady) {
        statusItem.text = '$(check) BGI';
        statusItem.tooltip = `graphics.h ready — compiler OK, library: ${doctorCache.bestLibrary}. Click to re-run the Setup Doctor.`;
    }
    else {
        statusItem.text = '$(alert) BGI';
        statusItem.tooltip = `graphics.h NOT ready — ${doctorCache.compilerCheck.ok ? 'no graphics library found' : 'no working C++ compiler'}. Click to run the Setup Doctor.`;
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
            const picks = ['Fix automatically', 'Show Output', 'Show Setup Guide'];
            const pick = await vscode.window.showWarningMessage('graphics.h environment is not ready yet. The Setup Doctor found problems.', ...picks);
            if (pick === 'Show Output') {
                output.show(true);
            }
            else if (pick === 'Show Setup Guide') {
                vscode.commands.executeCommand('graphics-h-runner.showGuide');
            }
            else if (pick === 'Fix automatically') {
                vscode.commands.executeCommand('graphics-h-runner.setupEverything');
            }
        }
    }
    return res;
}
/* ---------------- templates ---------------- */
async function insertTemplate() {
    const pick = await vscode.window.showQuickPick(templates_1.TEMPLATES.map((t) => ({ label: t.label, description: t.description, template: t })), { placeHolder: 'Insert a graphics.h code template' });
    if (!pick) {
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        await editor.edit((eb) => {
            eb.insert(editor.selection.start, pick.template.code);
        });
    }
    else {
        const doc = await vscode.workspace.openTextDocument({
            language: 'cpp',
            content: pick.template.code
        });
        await vscode.window.showTextDocument(doc);
    }
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
    }
}
/* ---------------- setup guide ---------------- */
function showGuide(context) {
    const panel = vscode.window.createWebviewPanel('graphicsHSetupGuide', 'graphics.h Setup Guide', vscode.ViewColumn.One, {});
    panel.webview.html = (0, guide_1.guideHtml)((0, toolchain_1.currentPlatform)());
    context.subscriptions.push(panel);
}
/* ---------------- activation ---------------- */
function activate(context) {
    output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(output);
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    statusItem.name = 'graphics.h environment';
    statusItem.command = 'graphics-h-runner.doctor';
    context.subscriptions.push(statusItem);
    updateStatusBar();
    // Background probe so the status bar is meaningful without user action.
    void runDoctor(false).catch(() => {
        /* errors already logged */
    });
    // ---- sidebar: graphics.h Programs (activity bar) ----
    const catalog = (0, programs_1.loadProgramCatalog)(context.extensionPath);
    log(`[programs] sidebar catalog: ${catalog.length} programs loaded`);
    const viewProvider = new programsView_1.ProgramsViewProvider(catalog);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('graphics-h-runner.programs', viewProvider), vscode.commands.registerCommand('graphics-h-runner.openProgram', (program) => {
        void openProgram(program);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('graphics-h-runner.compileAndRun', async () => {
        const file = await getTargetSourceFile();
        if (!file) {
            return;
        }
        const ok = await compileSource(file);
        if (ok) {
            runBinary(file);
        }
        else {
            showCompileFailure(file);
        }
    }), vscode.commands.registerCommand('graphics-h-runner.compile', async () => {
        const file = await getTargetSourceFile();
        if (!file) {
            return;
        }
        const ok = await compileSource(file);
        if (ok) {
            vscode.window.showInformationMessage(`Compiled OK: ${path.basename((0, toolchain_1.binaryPathFor)(file, (0, toolchain_1.currentPlatform)()))}`);
        }
        else {
            showCompileFailure(file);
        }
    }), vscode.commands.registerCommand('graphics-h-runner.run', async () => {
        const file = await getTargetSourceFile();
        if (!file) {
            return;
        }
        runBinary(file);
    }), vscode.commands.registerCommand('graphics-h-runner.doctor', async () => {
        await runDoctor(true).catch(() => undefined);
    }), vscode.commands.registerCommand('graphics-h-runner.setupEverything', () => {
        void runFullSetup(context).catch((e) => {
            log('[setup] crashed: ' + String(e));
            vscode.window.showErrorMessage('Full Setup failed: ' + String(e));
        });
    }), vscode.commands.registerCommand('graphics-h-runner.insertTemplate', () => {
        void insertTemplate();
    }), vscode.commands.registerCommand('graphics-h-runner.showGuide', () => {
        showGuide(context);
    }), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_PREFIX)) {
            doctorCache = undefined;
            updateStatusBar();
            void runDoctor(false).catch(() => undefined);
        }
    }));
    log('graphics.h Runner activated.');
}
function deactivate() {
    /* nothing to clean up */
}
//# sourceMappingURL=extension.js.map