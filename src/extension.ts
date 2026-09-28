/**
 * extension.ts — graphics.h Runner for VS Code.
 *
 * One-press compile & run for C++ programs that #include <graphics.h>,
 * with the right linker flags per OS (WinBGIM on Windows, SDL_bgi / libgraph
 * on Linux/macOS), plus a Setup Doctor, snippets, templates and a
 * status-bar environment indicator.
 */

/* Sentry automatic error collection — MUST stay the first import so the SDK is
 * initialized before any other extension module loads (instrument-first rule). */
import './instrument';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  currentPlatform,
  isCppSourceFile,
  binaryPathFor,
  Platform
} from './toolchain';
import { detectGraphicsInclude } from './detect';
import { buildCompilePlan, CompilePlan, LinuxLibrary, BgiLibrary } from './buildArgs';
import { probeEnvironment, DoctorResult } from './doctor';
import {
  planSetup,
  installSdlBgiUserPrefix,
  installWinbgimWindows,
  checkSdl2Dev,
  installCompilerViaWinget,
  installCompilerWindowsDirect,
  discoverGppWindows,
  verifyCompilerRun,
  compilerArchitecture,
  bgiLinkProbe,
  describeBgiProbeFailure
} from './setup';
import { loadProgramCatalog, LoadedProgram, resolveProgramTarget } from './programs';
import { GhPanelProvider, PanelClick } from './panelView';
import { GhFallbackTreeProvider } from './programsTree';
import { registerGraphicsHDebugger, LaunchOutcome } from './debugAdapter';
import {
  normalizeCompilerPath,
  normalizeDirList,
  pruneMissingDirs,
  classifySpawnFailure,
  NormalizeOptions
} from './normalize';
import {
  initTelemetry,
  onTelemetryConsentChanged,
  addExtensionBreadcrumb,
  captureExtensionError,
  captureExtensionWarning,
  setRuntimeTags,
  setTelemetryContext,
  flushTelemetry,
  scrubText
} from './instrument';
import { parseCompilerOutput, capCompilerDiagnostics, looksLikeBgiLinkFailure, pickErrorHeaders } from './diagnostics';
import { auditWindowsExe, buildAuditMessage } from './depsAudit';
import { cmdRunLine, posixRunLine } from './runwrap';
import {
  NativeToolchain,
  codeRunnerExecutor,
  buildTaskJson,
  buildLaunchJson,
  mergeConfigDoc,
  mergeSettingsDoc,
  hasDefaultBuildTask,
  TASK_LABEL,
  LAUNCH_CONFIG_NAME
} from './nativeRun';
import { makeGlobalWindows } from './globalize';
import { Celebrator } from './celebrateHost';
import type { CelebrationKind } from './celebrate';
import { treeRunCommandId } from './programsTreeModel';

const OUTPUT_CHANNEL_NAME = 'graphics.h Runner';
const TERMINAL_NAME = 'graphics.h Runner';
const CONFIG_PREFIX = 'graphics-h-runner.';

let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem | undefined;
let doctorCache: DoctorResult | undefined;
let doctorRunning: Promise<DoctorResult> | undefined;
let panel: GhPanelProvider | undefined;
let catalog: LoadedProgram[] = [];
/* v1.5.4: ONE persistent runner terminal — created once, reused for
 * every run. The shell is its root process and never exits, so the
 * terminal and its output survive every program exit; a new run just
 * types into it again. Cleared only when the user closes it. */
let runnerTerminal: vscode.Terminal | undefined;
let storageDir: string | undefined; /* globalStorage — real files for folder-less windows */
let diagnostics: vscode.DiagnosticCollection | undefined;
/* live run feedback for the status bar: idle -> compiling -> running -> idle */
let runState: 'idle' | 'compiling' | 'running' = 'idle';
/* which back-end the last successful build used ('none' = plain console C++) */
let lastBuildLibrary: BgiLibrary | 'none' = 'none';
/* v1.5.6: the FULL-SCREEN celebration overlay — now only the error page
 * and the Fireworks Simulator live here. Success confetti + School Pride
 * play INSIDE the activity panel instead (panel.playCelebration). */
let celebrator: Celebrator | undefined;
/* School Pride fires once per session: the first time the activity-bar
 * panel opens after a fresh desktop / window start. */
let schoolPrideDone = false;

interface ExtensionConfig {
  compilerPath: string;
  autoDetect: boolean;
  linuxLibrary: LinuxLibrary;
  staticLinkWindows: boolean;
  extraIncludePaths: string[];
  extraLibPaths: string[];
  extraCompilerArgs: string[];
  showStatusBarItem: boolean;
}

/** Existence-probe options for the normalizers (real filesystem). */
function normOpts(): NormalizeOptions {
  return { platform: currentPlatform() };
}

function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration();
  const rawCompiler = cfg.get<string>(CONFIG_PREFIX + 'compilerPath', 'g++');
  return {
    /* healed on read: quotes, env vars, ~, directory paths, missing .exe */
    compilerPath: normalizeCompilerPath(rawCompiler || 'g++', normOpts()) || 'g++',
    autoDetect: cfg.get<boolean>(CONFIG_PREFIX + 'autoDetect', true),
    linuxLibrary: cfg.get<LinuxLibrary>(CONFIG_PREFIX + 'linuxLibrary', 'auto'),
    staticLinkWindows: cfg.get<boolean>(CONFIG_PREFIX + 'staticLinkWindows', true),
    extraIncludePaths: normalizeDirList(cfg.get<string[]>(CONFIG_PREFIX + 'extraIncludePaths', []), normOpts()),
    extraLibPaths: normalizeDirList(cfg.get<string[]>(CONFIG_PREFIX + 'extraLibPaths', []), normOpts()),
    extraCompilerArgs: cfg.get<string[]>(CONFIG_PREFIX + 'extraCompilerArgs', []),
    showStatusBarItem: cfg.get<boolean>(CONFIG_PREFIX + 'showStatusBarItem', true)
  };
}

/**
 * v1.5.11: the output channel can be disposed UNDER us — VS Code closes it on
 * window reload, extension update or extension-host shutdown while a pending
 * async continuation (setup flow, compile watcher, timer) still wants to
 * write. appendLine/show then THROW "Channel has been closed", and inside an
 * async function that throw surfaces as an UNHANDLED PROMISE REJECTION
 * (Sentry GRAPHICS-H-RUNNER-G). Every channel access now goes through these
 * guarded helpers: after the first closed-channel error the channel is
 * considered gone for the rest of the session and writes become no-ops.
 */
let outputClosed = false;

function log(line: string): void {
  if (outputClosed) {
    return;
  }
  try {
    output.appendLine(line);
  } catch {
    outputClosed = true; /* host shutdown / reload — nowhere left to log */
  }
}

function showOutput(preserveFocus = true): void {
  if (outputClosed) {
    return;
  }
  try {
    output.show(preserveFocus);
  } catch {
    outputClosed = true;
  }
}

/** Wrap a command handler with a breadcrumb so Sentry issues carry user context. */
function trackedCommand<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => R
): (...args: A) => R {
  return (...args: A) => {
    addExtensionBreadcrumb('ui.command', name);
    return fn(...args);
  };
}

/** v1.5.6 celebrations master switch (confetti / error / school pride). */
function celebrationsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('graphics-h-runner.celebrations')
    .get<boolean>('enabled', true);
}

/**
 * v1.5.6 routing — WHERE each celebration plays:
 *   confetti / schoolpride -> INSIDE the activity panel only (the full
 *     panel screen; no editor tab opens — panel.playCelebration bakes the
 *     effect into the next panel render, media/celebrate-panel.js plays it);
 *   error -> the FULL-SCREEN overlay tab (giant ✗ + big compiler error
 *     headers + red-ember rain), unchanged from the v1.5.6 design;
 *   fireworks -> the FULL-SCREEN overlay tab (command path shows it
 *     directly through the celebrator).
 */
function celebrate(kind: 'confetti' | 'error' | 'schoolpride', errorLines?: string[]): void {
  if (!celebrationsEnabled()) {
    return;
  }
  try {
    if (kind === 'confetti' || kind === 'schoolpride') {
      panel?.playCelebration(kind);
    } else {
      celebrator?.show(kind, undefined, errorLines ? { errorLines } : undefined);
    }
  } catch {
    /* ignore — the compile result matters more than the party */
  }
}

/* ---------------- full setup (0 -> running) ---------------- */

async function addPathsToSetting(key: 'extraIncludePaths' | 'extraLibPaths', additions: string[]): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<string[]>(CONFIG_PREFIX + key, []);
  const merged = Array.from(new Set([...current, ...additions]));
  if (merged.length !== current.length) {
    await cfg.update(CONFIG_PREFIX + key, merged, vscode.ConfigurationTarget.Global);
    log(`[setup] ${key} += ${additions.join(', ')}`);
  }
}

async function setCompilerPathSetting(gppPath: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const current = cfg.get<string>(CONFIG_PREFIX + 'compilerPath', 'g++');
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
async function findWorkingGpp(opts: { requireBgiCapable?: boolean } = {}): Promise<
  { gppPath: string; version: string; arch: string } | undefined
> {
  const candidates = discoverGppWindows();
  const scored: Array<{ gppPath: string; version: string; arch: string }> = [];
  for (const candidate of candidates) {
    const v = await verifyCompilerRun(candidate);
    if (!v.ok) {
      continue;
    }
    const arch = await compilerArchitecture(candidate);
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
 * v1.5.11: run the REAL compile+link probe right after the WinBGIm download
 * and classify the failure. This is where a corrupt libbgi.a (truncated or
 * HTML error page that slipped through, or a later AV quarantine) and a
 * 32-bit compiler get caught AT THE STEP THAT CAUSED THEM — in v1.5.10 both
 * surfaced only as a blind "make-global probe failed" warning after the
 * user had already retried a dozen times (Sentry GRAPHICS-H-RUNNER-F).
 */
async function verifyWinbgimInstall(
  platform: Platform,
  storageRoot: string,
  includeDir: string,
  libDir: string,
  summary: string[]
): Promise<void> {
  if (platform !== 'windows') {
    return; /* SDL_bgi platforms verify themselves at the final verify step */
  }
  const cfg = getConfig();
  const compiler = cfg.compilerPath || 'g++';
  let link = await bgiLinkProbe({ compiler, includeDir, libDir, platform });
  if (link.ok) {
    addExtensionBreadcrumb('setup.step', 'winbgim link probe ok');
    return;
  }
  const arch = await compilerArchitecture(compiler);
  const verdict = describeBgiProbeFailure(link.detail, arch);
  log('[setup] winbgim link probe FAILED (' + arch + '): ' + link.detail.slice(0, 200));
  addExtensionBreadcrumb('setup.step', 'winbgim link probe failed', { arch: String(arch) });

  if (link.undefinedRefs && arch === 'x86_64') {
    /* A 64-bit compiler that cannot link the archive means the library
     * itself is bad — re-download it once (a fresh fetch clears transient
     * bad copies; AV interference gets a second, immediate chance to
     * betray itself in the capture below). */
    try {
      summary.push('The graphics library failed to link with the 64-bit compiler — re-downloading it once…');
      const res2 = await installWinbgimWindows(storageRoot);
      const link2 = await bgiLinkProbe({ compiler, includeDir: res2.includeDir, libDir: res2.libDir, platform });
      if (link2.ok) {
        summary.push('WinBGIM re-downloaded and verified: it links correctly now.');
        addExtensionBreadcrumb('setup.step', 'winbgim re-download ok');
        return;
      }
      link = link2;
      log('[setup] still failing after re-download: ' + link2.detail.slice(0, 200));
    } catch (e) {
      log('[setup] WinBGIM re-download error: ' + String(e));
    }
  }
  captureExtensionWarning('winbgim link probe failed', {
    platform,
    arch: String(arch),
    undefinedRefs: String(Boolean(link.undefinedRefs)),
    detail: scrubText(link.detail).slice(0, 180)
  });
  summary.push('WARNING: ' + verdict);
}

/**
 * Drop stale entries (deleted toolchain folders, wiped globalStorage) from the
 * include/lib settings so diagnostics stay truthful. Non-fatal on failure.
 */
async function pruneStalePaths(): Promise<void> {
  try {
    const cfg = vscode.workspace.getConfiguration();
    for (const key of ['extraIncludePaths', 'extraLibPaths'] as const) {
      const current = normalizeDirList(cfg.get<string[]>(CONFIG_PREFIX + key, []), normOpts());
      const kept = pruneMissingDirs(current, normOpts());
      if (kept.length !== current.length) {
        await cfg.update(CONFIG_PREFIX + key, kept, vscode.ConfigurationTarget.Global);
        log(`[setup] pruned ${current.length - kept.length} stale entrie(s) from ${key}`);
      }
    }
  } catch (e) {
    log('[setup] stale-path prune skipped: ' + String(e));
  }
}

/** Spawn environment that also contains the compiler's own bin dir (DLL safety). */
function compilerEnv(compiler: string, extraDirs: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    const dirs: string[] = [];
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
  } catch {
    /* default env is fine */
  }
  return env;
}

/* ---------------- v1.5.12 native VS Code run (F5 / Ctrl+Alt+N / Ctrl+Shift+B) ---------------- */

/** The Code Runner extension that owns Ctrl+Alt+N. */
const CODE_RUNNER_ID = 'formulahendry.code-runner';

/**
 * Write the NATIVE VS Code run surfaces so a plain C++ run — F5, Code
 * Runner's Ctrl+Alt+N, Ctrl+Shift+B — behaves exactly like Ctrl+Alt+R.
 *
 *  - launch.json  -> the extension's own `graphics-h` debug type (compiles
 *                    through resolvePlan — the same engine — no external
 *                    debugger extension needed; VS Code offers to install
 *                    nothing, it is built in)
 *  - tasks.json   -> default build task with the same flags ($gcc matcher ->
 *                    Problems panel), unless the user already has their own
 *                    default build task
 *  - settings     -> code-runner.executorMap.cpp + terminal mode (input
 *                    works) + C_Cpp.default.compilerPath for IntelliSense
 *
 * Workspace files go to the first workspace folder's .vscode/; without an
 * open folder the Code Runner / C_Cpp settings fall back to the user
 * (global) scope so single-file users keep Ctrl+Alt+N working, and the
 * caller explains how to get the F5 config later.
 *
 * Every write is MERGE-safe: existing user entries are kept, ours replaces
 * only an entry with our own name/label (idempotent re-runs), and an
 * unparseable file is backed up before it is rebuilt.
 */
async function applyNativeRunIntegration(summary?: string[]): Promise<void> {
  const platform = currentPlatform();
  const cfg = getConfig();
  const info: NativeToolchain = {
    platform,
    compilerPath: cfg.compilerPath,
    includePaths: cfg.extraIncludePaths,
    libPaths: cfg.extraLibPaths,
    extraArgs: cfg.extraCompilerArgs,
    staticLinkWindows: cfg.staticLinkWindows,
    linuxLibrary: cfg.linuxLibrary
  };
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0]
    : undefined;

  /* 1+2. Code Runner (Ctrl+Alt+N) + IntelliSense settings.
   *    Written directly into .vscode/settings.json (JSONC-merged) — the
   *    Settings API REFUSES keys owned by an extension that is not loaded
   *    ("code-runner.executorMap.cpp is not a registered configuration"),
   *    which is exactly the state of a user who has not installed Code
   *    Runner yet. Direct file writes are inert until the owner exists. */
  const executor = codeRunnerExecutor(info);
  if (folder) {
    const dotVscode = path.join(folder.uri.fsPath, '.vscode');
    fs.mkdirSync(dotVscode, { recursive: true });
    const settingsPath = path.join(dotVscode, 'settings.json');
    const existing = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : undefined;
    const wantRunInTerminal = vscode.workspace.getConfiguration('code-runner').get<boolean>('runInTerminal', false) !== true;
    const wantSave = vscode.workspace.getConfiguration('code-runner').get<boolean>('saveFileBeforeRun', false) !== true;
    const wantCwd = vscode.workspace.getConfiguration('code-runner').get<boolean>('fileDirectoryAsCwd', true) !== true;
    const settingsMerged = mergeSettingsDoc(existing, {
      'code-runner.executorMap': { cpp: executor },
      ...(wantRunInTerminal ? { 'code-runner.runInTerminal': true } : {}),
      ...(wantSave ? { 'code-runner.saveFileBeforeRun': true } : {}),
      ...(wantCwd ? { 'code-runner.fileDirectoryAsCwd': true } : {}),
      'C_Cpp.default.compilerPath': cfg.compilerPath
    });
    if (settingsMerged.needsBackup) {
      fs.writeFileSync(path.join(dotVscode, 'settings.json.graphics-h-backup'), existing as string);
    }
    if (settingsMerged.text !== existing) {
      fs.writeFileSync(settingsPath, settingsMerged.text);
    }
  } else {
    /* no folder open: best-effort write of the Code Runner map into the
     * USER settings so single-file Ctrl+Alt+N still works */
    try {
      const cr = vscode.workspace.getConfiguration('code-runner');
      const currentMap = cr.get<Record<string, string>>('executorMap') || {};
      if (currentMap['cpp'] !== executor) {
        await cr.update('executorMap.cpp', executor, vscode.ConfigurationTarget.Global);
      }
      if (cr.get<boolean>('runInTerminal', false) !== true) {
        await cr.update('runInTerminal', true, vscode.ConfigurationTarget.Global);
      }
      if (cr.get<boolean>('saveFileBeforeRun', false) !== true) {
        await cr.update('saveFileBeforeRun', true, vscode.ConfigurationTarget.Global);
      }
      if (cr.get<boolean>('fileDirectoryAsCwd', true) !== true) {
        await cr.update('fileDirectoryAsCwd', true, vscode.ConfigurationTarget.Global);
      }
      await vscode.workspace.getConfiguration('C_Cpp.default').update('compilerPath', cfg.compilerPath, vscode.ConfigurationTarget.Global);
    } catch (e) {
      log('[native-run] global settings write skipped: ' + String(e));
      if (summary) {
        summary.push('NATIVE RUN: user-level settings write was refused (settings file is write-protected or invalid) — open your code folder and run "Enable native VS Code run" there.');
      }
    }
  }

  /* 3. .vscode/launch.json + tasks.json (need a folder to live in). */
  let launchNote = '';
  if (folder) {
    const dotVscode = path.join(folder.uri.fsPath, '.vscode');
    fs.mkdirSync(dotVscode, { recursive: true });

    const launchPath = path.join(dotVscode, 'launch.json');
    const launchExisting = fs.existsSync(launchPath) ? fs.readFileSync(launchPath, 'utf8') : undefined;
    const launchMerged = mergeConfigDoc(
      launchExisting,
      buildLaunchJson(),
      'configurations',
      'name',
      LAUNCH_CONFIG_NAME,
      { prepend: true } /* F5 defaults to the FIRST entry — ours */
    );
    if (launchMerged.needsBackup) {
      fs.writeFileSync(path.join(dotVscode, 'launch.json.graphics-h-backup'), launchExisting as string);
    }
    if (launchMerged.needsBackup || launchMerged.created || launchMerged.text !== launchExisting) {
      fs.writeFileSync(launchPath, launchMerged.text);
    }

    const tasksPath = path.join(dotVscode, 'tasks.json');
    const tasksExisting = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : undefined;
    const stealDefault = !hasDefaultBuildTask(tasksExisting);
    const tasksMerged = mergeConfigDoc(
      tasksExisting,
      buildTaskJson(info, stealDefault),
      'tasks',
      'label',
      TASK_LABEL,
      { prepend: false }
    );
    if (tasksMerged.needsBackup) {
      fs.writeFileSync(path.join(dotVscode, 'tasks.json.graphics-h-backup'), tasksExisting as string);
    }
    if (tasksMerged.needsBackup || tasksMerged.created || tasksMerged.text !== tasksExisting) {
      fs.writeFileSync(tasksPath, tasksMerged.text);
    }
    launchNote = stealDefault
      ? ''
      : ' Your existing default build task was left in place — our task is available as "graphics.h: build active file".';
  } else {
    launchNote = ' F5/Ctrl+Shift+B configs are written per-folder — open your code folder and run "Enable native VS Code run" once.';
  }

  /* 4. Tell the user what changed, exactly once per line, and report. */
  const hasCodeRunner = Boolean(vscode.extensions.getExtension(CODE_RUNNER_ID));
  if (summary) {
    summary.push('NATIVE RUN: F5 now compiles & runs the open .cpp with the graphics.h engine (no extra debugger extension needed).' + (folder ? '' : launchNote));
    summary.push(
      hasCodeRunner
        ? 'NATIVE RUN: Ctrl+Alt+N (Code Runner) compiles with the same graphics.h flags and runs in the terminal with input.'
        : 'NATIVE RUN: Ctrl+Alt+N needs the free "Code Runner" extension — install it once and Run Code works with this setup.'
    );
    if (folder) {
      summary.push('NATIVE RUN: Ctrl+Shift+B builds the open file with the same flags; compiler errors appear in the Problems panel.' + launchNote);
    }
  }
  addExtensionBreadcrumb('setup.native-run', 'configured', {
    scope: folder ? 'workspace' : 'global',
    codeRunner: hasCodeRunner ? 'yes' : 'no'
  });
  log('[native-run] executorMap.cpp = ' + executor);
}

async function runFullSetup(context: vscode.ExtensionContext): Promise<void> {
  const platform = currentPlatform();
  const storageRoot = context.globalStorageUri.fsPath;
  const cfg = getConfig();
  const summary: string[] = [];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'graphics.h: Complete Setup', cancellable: false },
    async (progress) => {
      progress.report({ message: 'Checking the current environment…' });
      const doctor = await probeEnvironment({
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
          const link = await bgiLinkProbe({
            compiler: cfg.compilerPath || 'g++',
            includeDir: wbInc,
            libDir: wbLib,
            platform
          });
          compilerBgiIncompatible = !link.ok && link.undefinedRefs;
          log('[setup] bgi link probe: ' + (link.ok ? 'OK' : 'FAILED — ' + link.detail.slice(0, 160)));
          if (compilerBgiIncompatible) {
            addExtensionBreadcrumb('setup.probe', 'compiler cannot link the graphics library');
          }
        } else {
          /* library not installed yet: fall back to the target architecture */
          const arch = await compilerArchitecture(cfg.compilerPath || 'g++');
          compilerBgiIncompatible = arch === 'mingw32' || arch === 'i686';
          if (compilerBgiIncompatible) {
            log(`[setup] compiler target is ${arch} (32-bit) — it cannot link the 64-bit graphics library`);
          }
        }
      }

      let sdl2DevOk = true;
      if (platform === 'linux' || platform === 'macos') {
        progress.report({ message: 'Checking SDL2 headers…' });
        sdl2DevOk = await checkSdl2Dev({ cc: platform === 'macos' ? 'clang' : 'gcc' });
      }

      const plan = planSetup(platform, { ...probe, compilerBgiIncompatible }, sdl2DevOk);
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
            const res = await installSdlBgiUserPrefix({ storageRoot });
            await addPathsToSetting('extraIncludePaths', [res.includeDir]);
            await addPathsToSetting('extraLibPaths', [res.libDir]);
            summary.push('SDL_bgi downloaded, patched, built and installed into a user folder (no admin rights needed).');
            summary.push(
              'GLOBAL (optional): so graphics.h also works OUTSIDE VS Code, copy the library system-wide: ' +
              `sudo cp "${res.includeDir}/graphics.h" /usr/local/include/ && sudo cp -r "${res.includeDir}/SDL2" /usr/local/include/ && sudo cp "${res.libDir}/libSDL_bgi.so" /usr/local/lib/ && sudo ldconfig`
            );
            addExtensionBreadcrumb('setup.step', 'install-sdl_bgi ok');
          } catch (e) {
            log('[setup] SDL_bgi install error: ' + String(e));
            summary.push('SDL_bgi auto-install FAILED: ' + String(e));
            captureExtensionError(e, { setup_step: 'install-sdl_bgi', platform: platform });
          }
        } else if (step.kind === 'auto' && step.id === 'install-compiler-winget') {
          /* half-setup fast path: a compiler may already be on disk (previous
           * winget run, manual install, IDE bundle) — skip the whole download.
           * v1.5.6: a BGI-incompatible compiler (32-bit MinGW.org) does NOT
           * count — it is exactly what we are here to replace. */
          const existing = await findWorkingGpp({ requireBgiCapable: compilerBgiIncompatible });
          if (existing) {
            await setCompilerPathSetting(existing.gppPath);
            summary.push(
              `Compiler already present on this PC — using ${existing.gppPath} (${existing.version}` +
                (existing.arch ? `, ${existing.arch}` : '') + '). winget step skipped.'
            );
            continue;
          }
          const winget = await installCompilerViaWinget((p) =>
            progress.report({ message: p.message.slice(0, 110) })
          );
          log('[setup] winget: ' + winget.detail);
          addExtensionBreadcrumb('setup.step', 'install-compiler-winget', { ok: String(winget.ok) });
          const found = await findWorkingGpp({ requireBgiCapable: true });
          if (found) {
            await setCompilerPathSetting(found.gppPath);
            summary.push(`Compiler installed automatically via winget: ${found.gppPath} (${found.version}, ${found.arch})`);
          } else if (winget.ok) {
            summary.push('winget finished but no working g++.exe was found — trying the direct-download fallback next.');
          } else {
            summary.push('winget automatic install not possible: ' + winget.detail + ' — trying the direct-download fallback next.');
          }
        } else if (step.kind === 'auto' && step.id === 'install-compiler-download') {
          /* v1.5.6: "already" must mean a BGI-CAPABLE compiler when the
           * current one is known-incompatible — otherwise this step would be
           * skipped on the very PCs that need it most. */
          const current = getConfig();
          const runsOk = (await verifyCompilerRun(current.compilerPath || 'g++')).ok;
          const currentArch = runsOk ? await compilerArchitecture(current.compilerPath || 'g++') : 'unknown';
          const currentIsGood = runsOk && (!compilerBgiIncompatible || currentArch === 'x86_64');
          const already = currentIsGood || Boolean(await findWorkingGpp({ requireBgiCapable: compilerBgiIncompatible }));
          if (already) {
            summary.push('Compiler already available — direct download skipped.');
          } else {
            try {
              const dl = await installCompilerWindowsDirect(storageRoot, (p) =>
                progress.report({ message: p.message.slice(0, 110) })
              );
              dl.log.forEach((l) => log('[setup] ' + l));
              await setCompilerPathSetting(dl.gppPath);
              summary.push(`Compiler downloaded, verified (sha256) and installed automatically: ${dl.gppPath}`);
              addExtensionBreadcrumb('setup.step', 'install-compiler-download ok');
            } catch (e) {
              log('[setup] direct download error: ' + String(e));
              summary.push('Direct compiler download FAILED: ' + String(e));
              captureExtensionError(e, { setup_step: 'install-compiler-download', platform: platform });
            }
          }
        } else if (step.kind === 'auto' && step.id === 'install-winbgim') {
          try {
            const res = await installWinbgimWindows(storageRoot);
            await addPathsToSetting('extraIncludePaths', [res.includeDir]);
            await addPathsToSetting('extraLibPaths', [res.libDir]);
            summary.push('WinBGIM (graphics.h / winbgim.h / libbgi.a) installed into the extension folder.');
            addExtensionBreadcrumb('setup.step', 'install-winbgim ok');
            res.log.forEach((l) => log('[setup] ' + l));
            await verifyWinbgimInstall(platform, storageRoot, res.includeDir, res.libDir, summary);
          } catch (e) {
            log('[setup] WinBGIM install error: ' + String(e));
            summary.push('WinBGIM auto-install FAILED: ' + String(e));
            captureExtensionError(e, { setup_step: 'install-winbgim', platform: platform });
          }
        } else if (step.kind === 'auto' && step.id === 'make-global') {
          /* v1.5.1 major feature: graphics.h must compile ANYWHERE after Full
           * Setup — not only inside this extension. */
          const fresh = getConfig();
          const compilerOkNow = (await verifyCompilerRun(fresh.compilerPath || 'g++')).ok;
          const wbInclude = path.join(storageRoot, 'winbgim', 'include');
          const wbLib = path.join(storageRoot, 'winbgim', 'lib');
          const haveWinbgim =
            fs.existsSync(path.join(wbInclude, 'graphics.h')) &&
            fs.existsSync(path.join(wbLib, 'libbgi.a'));
          if (platform !== 'windows') {
            summary.push('Global setup: handled automatically on this platform (system packages / user prefix).');
          } else if (!compilerOkNow) {
            summary.push('Global setup skipped: no working g++ yet — finish the compiler steps above, then re-run Full Setup.');
          } else if (!haveWinbgim) {
            summary.push('Global setup skipped: WinBGIM files are not installed yet — finish the WinBGIM step above, then re-run Full Setup.');
          } else {
            try {
              progress.report({ message: 'Making graphics.h work in ANY terminal (global)…' });
              const res = await makeGlobalWindows({
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
                addExtensionBreadcrumb('setup.step', 'make-global ok');
              } else {
                summary.push('Global setup could NOT make plain "g++ ..." resolve graphics.h (details in the output). The extension keeps working via its own settings.');
                /* v1.5.11: the warning used to carry NOTHING but the platform —
                 * 15 events across two users told us exactly that. Attach the
                 * compiler architecture and the probe's own stderr tail (both
                 * scrubbed) so the root cause arrives with the event. */
                const gArch = await compilerArchitecture(fresh.compilerPath || 'g++');
                const probeLine = [...res.log].reverse().find((l) => /^(probe|copy into|could not locate|compiler location check)/.test(l)) || '';
                captureExtensionWarning('make-global probe failed', {
                  platform: platform,
                  arch: String(gArch),
                  detail: scrubText(probeLine).slice(0, 180)
                });
              }
              if (res.pathChanged) {
                summary.push('PATH: the compiler folder was added to your user PATH — new terminals (and VS Code after a restart) can call g++ directly.');
              } else if (!res.pathOk) {
                summary.push('PATH update failed (non-fatal): add the compiler bin folder to PATH manually — details in the output.');
              }
            } catch (e) {
              log('[global] error: ' + String(e));
              summary.push('Global setup FAILED: ' + String(e));
              captureExtensionError(e, { setup_step: 'make-global', platform: platform });
            }
          }
        } else if (step.kind === 'terminal') {
          summary.push(`ACTION NEEDED (run in a terminal): ${step.command}`);
        } else if (step.kind === 'manual') {
          summary.push(`ACTION NEEDED (manual): ${step.detail}${step.url ? ' — ' + step.url : ''}`);
        } else if (step.kind === 'verify') {
          await pruneStalePaths();
          const fresh = getConfig();
          const res = await probeEnvironment({
            platform,
            compilerPath: fresh.compilerPath,
            linuxLibrary: fresh.linuxLibrary,
            extraIncludePaths: fresh.extraIncludePaths,
            extraLibPaths: fresh.extraLibPaths
          });
          doctorCache = res;
          updateStatusBar();
          panel?.setDoctorResult(res);
          summary.push(
            res.graphicsReady
              ? `VERIFIED: graphics.h is ready (library: ${res.bestLibrary}). Press Ctrl+Alt+R inside a graphics.h program to run it.`
              : 'NOT READY YET — finish the ACTION NEEDED items above, then re-run Full Setup.'
          );
          /* v1.5.12 THE native-run integration: the toolchain is proven —
           * wire F5 / Code Runner (Ctrl+Alt+N) / Ctrl+Shift+B to the very
           * same compiler + flags so a "normal VS Code cpp run" works too. */
          if (res.graphicsReady) {
            progress.report({ message: 'Wiring F5 / Code Runner / Ctrl+Shift+B to the same toolchain…' });
            try {
              await applyNativeRunIntegration(summary);
            } catch (e) {
              log('[native-run] error: ' + String(e));
              summary.push('NATIVE RUN: configuring F5 / Code Runner failed (non-fatal): ' + String(e));
              captureExtensionWarning('native run config failed', {
                platform: platform,
                detail: scrubText(String(e)).slice(0, 180)
              });
            }
          }
          addExtensionBreadcrumb('setup.verify', res.graphicsReady ? 'ready' : 'not ready', {
            compilerOk: String(res.compilerCheck.ok),
            bestLibrary: String(res.bestLibrary || '')
          });
          if (!res.graphicsReady) {
            /* v1.5.11: a failed verify used to be INVISIBLE to error reporting
             * (only a breadcrumb) — the Win-26200 machine failed the verify 12
             * times and produced ZERO events, so the root cause never reached
             * us. Capture it now with the failing checks + compiler arch. */
            const failing = res.libraryChecks
              .filter((c) => !c.ok)
              .map((c) => `${c.name}: ${String(c.detail || '').split(/\r?\n/)[0]}`)
              .join(' | ');
            const vArch = await compilerArchitecture(fresh.compilerPath || 'g++');
            captureExtensionWarning('setup verify not ready', {
              platform: platform,
              arch: String(vArch),
              compilerOk: String(res.compilerCheck.ok),
              detail: scrubText(failing).slice(0, 180)
            });
            log('[setup] verify NOT ready: ' + (failing || '(no detail)'));
          }
        }
      }
    }
  );

  panel?.setBusy(false);
  showOutput(true);
  log('=== Complete Setup summary ===');
  summary.forEach((s) => log('- ' + s));
  addExtensionBreadcrumb('setup', 'full setup finished', { steps: String(summary.length) });

  const needsAction = summary.some((s) => s.startsWith('ACTION NEEDED'));
  if (needsAction) {
    const pick = await vscode.window.showInformationMessage(
      'A few system packages must be installed with your password. Run the printed commands in the terminal, then re-run "Complete Setup" to verify.',
      'Open Terminal',
      'Show Output'
    );
    if (pick === 'Open Terminal') {
      vscode.window.createTerminal('graphics.h Setup').show();
    } else if (pick === 'Show Output') {
      showOutput(true);
    }
  } else if (summary.some((s) => s.startsWith('VERIFIED: graphics.h is ready'))) {
    vscode.window.showInformationMessage(
      'Everything is set up! Open a .cpp file that includes <graphics.h> and press Ctrl+Alt+R — F5 and Code Runner (Ctrl+Alt+N) now run with the same setup.'
    );
  } else {
    vscode.window.showWarningMessage('Complete Setup finished with problems — see the graphics.h Runner output.');
  }
}

function resolvePlan(sourceFile: string, cfg: ExtensionConfig): CompilePlan {
  const platform = currentPlatform();
  const outFile = binaryPathFor(sourceFile, platform);
  let source = '';
  try {
    source = fs.readFileSync(sourceFile, 'utf8');
  } catch {
    source = '';
  }
  const detected = detectGraphicsInclude(source);
  const useBgi = cfg.autoDetect ? detected : true;

  log(`[plan] ${sourceFile}`);
  log(`[plan] graphics.h ${detected ? 'detected' : 'not detected'} -> ${useBgi ? 'BGI build' : 'plain C++ build'}`);

  return buildCompilePlan(
    {
      platform,
      linuxLibrary: cfg.linuxLibrary,
      compilerPath: cfg.compilerPath,
      sourceFile,
      outFile,
      extraIncludePaths: cfg.extraIncludePaths,
      extraLibPaths: cfg.extraLibPaths,
      extraCompilerArgs: cfg.extraCompilerArgs,
      staticLinkWindows: cfg.staticLinkWindows
    },
    useBgi,
    doctorCache
      ? {
          sdlBgiAvailable: doctorCache.libraryChecks.some((c) => c.name === 'sdl_bgi' && c.ok),
          libgraphAvailable: doctorCache.libraryChecks.some((c) => c.name === 'libgraph' && c.ok)
        }
      : undefined
  );
}

type CompileResult = 'ok' | 'failed' | 'no-compiler';

async function compileSource(sourceFile: string): Promise<CompileResult> {
  const cfg = getConfig();
  const plan = resolvePlan(sourceFile, cfg);

  log('[compile] ' + plan.commandLine);
  setRunState('compiling');
  let compilerText = '';

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `graphics.h: compiling ${path.basename(sourceFile)}…`,
      cancellable: false
    },
    () =>
      new Promise<CompileResult>((resolve) => {
        let settled = false;
        const done = (r: CompileResult) => {
          if (!settled) {
            settled = true;
            resolve(r);
          }
        };
        let child;
        try {
          child = spawn(plan.compiler, plan.args, {
            cwd: path.dirname(sourceFile),
            env: compilerEnv(plan.compiler),
            windowsHide: true
          });
        } catch (e) {
          log('[error] failed to start compiler: ' + String(e));
          done('no-compiler');
          return;
        }

        child.stdout?.on('data', (d: Buffer) => output.append(d.toString()));
        child.stderr?.on('data', (d: Buffer) => {
          output.append(d.toString());
          /* kept for the Problems panel + the failure breadcrumb */
          compilerText += d.toString();
          if (compilerText.length > 131072) {
            compilerText = compilerText.slice(-65536); /* keep the tail */
          }
        });

        child.on('error', (e: Error) => {
          const kind = classifySpawnFailure({ errorCode: (e as NodeJS.ErrnoException).code, closeCode: null });
          if (kind === 'no-compiler') {
            log(`[error] compiler not found: "${plan.compiler}" — offering automatic setup`);
            done('no-compiler');
          } else {
            log('[error] ' + e.message);
            done('failed');
          }
        });

        child.on('close', (code: number | null) => {
          if (code === 0) {
            log('[compile] success');
            addExtensionBreadcrumb('compile', 'ok', { file: path.basename(sourceFile) });
            done('ok');
            return;
          }
          /* Windows surfaces spawn ENOENT as a negative close code (-4058) on
           * some runtimes — classify it as "no compiler", not "compile error" */
          const kind = classifySpawnFailure({ errorCode: undefined, closeCode: code });
          if (code !== null && code < 0 && kind === 'no-compiler') {
            log(`[error] compiler "${plan.compiler}" could not be started (exit ${code}) — offering automatic setup`);
            done('no-compiler');
          } else {
            log(`[compile] failed with exit code ${code}`);
            done('failed');
          }
        });
      })
  );

  /* v1.4.9 robustness fix: only clear the indicator when no program is
   * still alive. A plain Compile (or a failed rebuild) while a graphics
   * program runs used to flip the status bar to "idle" even though the
   * runner terminal — and the window — were still up (Ctrl+Alt+S kept
   * working, but the visible state lied). */
  const stillRunning = !!runnerTerminal && !runnerTerminal.exitStatus;
  setRunState(stillRunning ? 'running' : 'idle');
  addExtensionBreadcrumb('compile', result, { file: path.basename(sourceFile) });
  if (result === 'ok') {
    celebrate('confetti'); /* v1.5.6: success confetti rains over the activity panel */
    diagnostics?.delete(vscode.Uri.file(sourceFile));
    if (currentPlatform() === 'windows') {
      auditExeAfterBuild(binaryPathFor(sourceFile, currentPlatform()));
    }
  } else if (result === 'failed') {
    /* v1.5.6: the snowfall is gone — a failed build now gets a relatable
     * ERROR overlay: giant ✗ + shake, the actual compiler error headers in
     * big type, and a red-ember rain for 5 s (click/Esc to dismiss). */
    const errorHeaders = pickErrorHeaders(compilerText, 3, 120);
    celebrate('error', errorHeaders);
    /* Compile errors are the NORMAL edit-compile loop for a graphics.h
     * teaching tool — they belong in the Problems panel and the output
     * channel, NOT in the telemetry error inbox (a single student session
     * could otherwise raise dozens of "g++ exited non-zero" issues). The
     * first error lines ride along as a breadcrumb so any genuinely
     * unrelated crash in the same session still carries compiler context. */
    publishCompilerDiagnostics(sourceFile, compilerText);
    const firstErrors = errorHeaders.join(' | ');
    addExtensionBreadcrumb('compile', 'failed', {
      file: path.basename(sourceFile),
      errors: (firstErrors || 'no error lines captured').slice(0, 600)
    });
    /* v1.5.6: undefined references to graphics symbols = the graphics
     * library could not be LINKED (classic: 32-bit MinGW.org g++ vs the
     * 64-bit libbgi.a). Turn the wall of linker errors into one fix. */
    if (looksLikeBgiLinkFailure(compilerText)) {
      log('[deps] graphics library could not be linked — the compiler is incompatible with libbgi.a');
      captureExtensionWarning('graphics library link failed (incompatible compiler/library)', {
        file: path.basename(sourceFile)
      });
      void vscode.window
        .showErrorMessage(
          'The graphics library (libbgi.a) could not be LINKED — every graphics symbol is unresolved. ' +
            'This compiler cannot use the installed 64-bit graphics library (typical cause: the legacy ' +
            '32-bit MinGW.org g++). Complete Run Setup can install a compatible 64-bit MinGW-w64 ' +
            'compiler automatically.',
          'Complete Run Setup (recommended)',
          'Show Output'
        )
        .then((pick) => {
          if (pick === 'Complete Run Setup (recommended)') {
            vscode.commands.executeCommand('graphics-h-runner.setupEverything');
          } else if (pick === 'Show Output') {
            showOutput(true);
          }
        });
    }
  }
  return result;
}

/** Parse the compiler's output and surface it in the Problems panel. */
function publishCompilerDiagnostics(sourceFile: string, compilerText: string): void {
  if (!diagnostics) {
    return;
  }
  try {
    const parsed = capCompilerDiagnostics(parseCompilerOutput(compilerText), 200);
    diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of parsed) {
      const file = path.resolve(path.dirname(sourceFile), d.file);
      const line = Math.max(0, d.line - 1);
      const col = Math.max(0, (d.column || 1) - 1);
      const range = new vscode.Range(line, col, line, col + 1);
      const sev =
        d.severity === 'error'
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
  } catch {
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
function auditExeAfterBuild(exePath: string): void {
  try {
    const res = auditWindowsExe(exePath);
    if (!res) {
      return;
    }
    if (res.ok) {
      log('[deps] import audit OK — ' + path.basename(exePath) + ' runs without MinGW runtime DLLs');
      return;
    }
    log('[deps] WARNING: ' + buildAuditMessage(res, path.basename(exePath)));
    captureExtensionWarning('windows exe imports non-system DLLs', {
      exe: path.basename(exePath),
      dlls: res.missing.join(',').slice(0, 200)
    });
    void vscode.window
      .showWarningMessage(
        path.basename(exePath) + ' needs ' + res.missing.join(', ') +
        ' and would fail to launch on PCs without MinGW (exit code -1073741515). ' +
        'Rebuild with static linking enabled (it is on by default).',
        'Show Output'
      )
      .then((pick) => {
        if (pick === 'Show Output') {
          showOutput(true);
        }
      });
  } catch {
    /* audit must never break the build flow */
  }
}

async function runBinary(sourceFile: string): Promise<void> {
  const platform = currentPlatform();
  const bin = binaryPathFor(sourceFile, platform);
  if (!fs.existsSync(bin)) {
    /* expected UX (Run before Compile) — the dialog below is the fix,
     * telemetry noise is not: breadcrumb only. */
    addExtensionBreadcrumb('run', 'binary not found', {
      file: path.basename(sourceFile),
      bin: path.basename(bin)
    });
    vscode.window.showErrorMessage(`Binary not found: ${bin}. Compile first.`, 'Compile now').then(
      (pick) => {
        if (pick === 'Compile now') {
          vscode.commands.executeCommand('graphics-h-runner.compile');
        }
      }
    );
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
        } else {
          showCompileFailure(sourceFile);
        }
        return;
      }
    }
  } catch {
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
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Absolute cmd.exe path (the persistent Windows runner shell). */
function comSpecPath(): string {
  return (
    process.env.ComSpec ||
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
  );
}

/** The persistent runner terminal: reused while alive, recreated if the user
 * closed it (adopting a live namesake first). Created ONCE, used ALWAYS —
 * "the same terminal every time". */
function ensureRunnerTerminal(cwd: string): vscode.Terminal {
  if (runnerTerminal && runnerTerminal.exitStatus === undefined) {
    return runnerTerminal;
  }
  const existing = vscode.window.terminals.find(
    (t) => t.name === TERMINAL_NAME && t.exitStatus === undefined
  );
  if (existing) {
    runnerTerminal = existing;
    return existing;
  }
  const windows = currentPlatform() === 'windows';
  runnerTerminal = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    shellPath: windows ? comSpecPath() : '/bin/bash',
    cwd,
    env: compilerEnv(getConfig().compilerPath, [cwd])
  });
  return runnerTerminal;
}

async function runInTerminal(bin: string): Promise<void> {
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
  const platform = currentPlatform();
  const term = ensureRunnerTerminal(path.dirname(abs));

  /* If the previous program is still alive, stop it first (Ctrl+C) so the
   * new command line is not swallowed by the running program's stdin. When
   * the previous run already ended this is a harmless empty prompt line. */
  if (runState === 'running') {
    term.sendText('\x03');
    await delay(350);
  }

  const line = platform === 'windows' ? cmdRunLine(abs) : posixRunLine(abs);
  term.sendText(line + '\r');
  term.show(false); /* focus the terminal so prompts can be answered at once */
  log('[run] ' + abs + ' (persistent ' + (platform === 'windows' ? 'cmd' : 'bash') +
    ' terminal — command typed into the live shell)');
  addExtensionBreadcrumb('run', 'terminal-persistent', {
    file: path.basename(abs),
    shell: platform === 'windows' ? 'cmd' : 'bash'
  });
  setRunState('running');
}

/** Stop the most recently started program (Stop command): Ctrl+C typed into
 * the persistent runner terminal. The terminal itself is NOT closed — it
 * keeps all output and is immediately ready for the next run ("use the same
 * terminal always"); closing it is the user's choice. */
async function stopRunningProgram(): Promise<void> {
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

async function getTargetSourceFile(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor && isCppSourceFile(editor.document.fileName)) {
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
    const defaultUri = vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.join(os.homedir(), 'Documents'), 'program.cpp')
    );
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

  const cppEditors = vscode.window.visibleTextEditors.filter((e) =>
    isCppSourceFile(e.document.fileName)
  );
  if (cppEditors.length === 1) {
    if (cppEditors[0].document.isDirty) {
      await cppEditors[0].document.save();
    }
    return cppEditors[0].document.fileName;
  }
  if (cppEditors.length > 1) {
    const picked = await vscode.window.showQuickPick(
      cppEditors.map((e) => path.basename(e.document.fileName)),
      { placeHolder: 'Select the C++ file to build' }
    );
    const chosen = cppEditors.find((e) => path.basename(e.document.fileName) === picked);
    if (chosen) {
      return chosen.document.fileName;
    }
  }
  vscode.window.showErrorMessage('Open a .cpp file (that includes <graphics.h>) and try again.');
  return undefined;
}

function showCompileFailure(sourceFile: string): void {
  vscode.window
    .showErrorMessage(
      `Compilation failed for ${path.basename(sourceFile)}. See the "${OUTPUT_CHANNEL_NAME}" output for errors.`,
      'Show Output',
      'Setup Doctor'
    )
    .then((pick) => {
      if (pick === 'Show Output') {
        showOutput(true);
      } else if (pick === 'Setup Doctor') {
        vscode.commands.executeCommand('graphics-h-runner.doctor');
      }
    });
}

/** The compiler itself is missing — offer the fully automatic fix. */
function showNoCompilerHelp(): void {
  vscode.window
    .showErrorMessage(
      'No C++ compiler found on this PC. graphics.h Runner can set up everything from zero — compiler + graphics library, no admin rights.',
      'Complete Run Setup (recommended)',
      'Run Setup Doctor',
      'Show Output'
    )
    .then((pick) => {
      if (pick === 'Complete Run Setup (recommended)') {
        vscode.commands.executeCommand('graphics-h-runner.setupEverything');
      } else if (pick === 'Run Setup Doctor') {
        vscode.commands.executeCommand('graphics-h-runner.doctor');
      } else if (pick === 'Show Output') {
        showOutput(true);
      }
    });
}

/* ---------------- status bar ---------------- */

function setRunState(state: 'idle' | 'compiling' | 'running'): void {
  if (runState === state) {
    return;
  }
  runState = state;
  updateStatusBar();
}

function updateStatusBar(): void {
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
  } else {
    statusItem.text = '$(alert) graphics.h';
    statusItem.tooltip = `graphics.h NOT ready — ${doctorCache.compilerCheck.ok ? 'no graphics library found' : 'no working C++ compiler'}. Click for the Setup Doctor, or run Full Setup.`;
  }
}

async function runDoctor(verbose: boolean): Promise<DoctorResult> {
  if (doctorRunning) {
    return doctorRunning;
  }
  const cfg = getConfig();
  if (statusItem) {
    statusItem.text = '$(sync~spin) BGI';
  }
  doctorRunning = probeEnvironment({
    platform: currentPlatform(),
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
  addExtensionBreadcrumb('doctor', res.graphicsReady ? 'ready' : 'not ready', {
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
    log(
      `global       : ${res.globalCheck.ok ? 'OK — plain g++ resolves graphics.h in ANY terminal' : 'extension-only'} — ${res.globalCheck.detail}`
    );
    if (!res.globalCheck.ok && res.globalCheck.fix) {
      log(`   fix -> ${res.globalCheck.fix}`);
    }
  }
  log(`graphics.h    : ${res.graphicsReady ? 'READY' : 'NOT READY'}`);
  log('');

  if (verbose) {
    if (res.graphicsReady) {
      vscode.window
        .showInformationMessage(
          `graphics.h environment is ready (library: ${res.bestLibrary}).`,
          'Show Output'
        )
        .then((pick) => {
          if (pick === 'Show Output') {
            showOutput(true);
          }
        });
    } else {
      const picks = ['Fix automatically', 'Show Output'];
      const pick = await vscode.window.showWarningMessage(
        'graphics.h environment is not ready yet. The Setup Doctor found problems.',
        ...picks
      );
      if (pick === 'Show Output') {
        showOutput(true);
      } else if (pick === 'Fix automatically') {
        vscode.commands.executeCommand('graphics-h-runner.setupEverything');
      }
    }
  }
  return res;
}

/* ---------------- sidebar: open a program as filename.cpp ---------------- */

async function openProgram(program: LoadedProgram): Promise<void> {
  if (!program || !program.source) {
    vscode.window.showErrorMessage('No program selected.');
    return;
  }
  try {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const target = resolveProgramTarget(folder, program.filename);
    if (target) {
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, program.source, 'utf8');
        log('[programs] created ' + target);
      }
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc, { preview: false });
    } else if (storageDir) {
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
      void vscode.window.showInformationMessage(
        `Opened ${program.filename} from graphics.h Runner storage — press Run to compile & launch.`
      );
    } else {
      const doc = await vscode.workspace.openTextDocument({
        language: 'cpp',
        content: program.source
      });
      await vscode.window.showTextDocument(doc);
      void vscode.window.showInformationMessage(
        `No folder is open — use "Save As" to keep this file as ${program.filename}.`
      );
    }
  } catch (e) {
    vscode.window.showErrorMessage('Could not open program: ' + String(e));
    captureExtensionError(e, { command: 'openProgram' });
  }
}

/** Copy every bundled example into a workspace folder and reveal it. */
async function openExamplesFolder(context: vscode.ExtensionContext): Promise<void> {
  try {
    const catalog = loadProgramCatalog(context.extensionPath);
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
      void vscode.window.showInformationMessage(
        `${catalog.length} example programs are in graphics-h-programs/ — open any and press Ctrl+Alt+R.`
      );
    } else {
      /* no workspace: offer to open the examples as a workspace folder */
      const pick = await vscode.window.showInformationMessage(
        'Open a folder first so the examples have somewhere to live. Open the examples folder as a workspace?',
        'Open Examples Folder',
        'Cancel'
      );
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
  } catch (e) {
    vscode.window.showErrorMessage('Could not open the examples folder: ' + String(e));
    captureExtensionError(e, { command: 'openExamplesFolder' });
  }
}

/**
 * v1.5.12 standalone entry: "graphics.h: Enable native VS Code run (F5,
 * Ctrl+Alt+N, Ctrl+Shift+B)" — the same wiring Complete Setup performs,
 * runnable any time (new folder, changed settings, single-file users).
 */
async function nativeRunSetup(): Promise<void> {
  const summary: string[] = [];
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'graphics.h: enabling native VS Code run…', cancellable: false },
      async () => {
        await applyNativeRunIntegration(summary);
      }
    );
  } catch (e) {
    log('[native-run] error: ' + String(e));
    captureExtensionWarning('native run config failed', {
      command: 'nativeRunSetup',
      detail: scrubText(String(e)).slice(0, 180)
    });
    vscode.window.showErrorMessage('Could not enable native VS Code run: ' + String(e));
    return;
  }
  log('=== Native VS Code run summary ===');
  summary.forEach((s) => log('- ' + s));
  addExtensionBreadcrumb('native-run', 'finished', { lines: String(summary.length) });

  const hasCodeRunner = Boolean(vscode.extensions.getExtension(CODE_RUNNER_ID));
  const buttons: string[] = hasCodeRunner ? ['Show Output'] : ['Install Code Runner', 'Show Output'];
  const pick = await vscode.window.showInformationMessage(
    'Native VS Code run is on: F5, Code Runner (Ctrl+Alt+N) and Ctrl+Shift+B now compile with the graphics.h setup.',
    ...buttons
  );
  if (pick === 'Show Output') {
    showOutput(true);
  } else if (pick === 'Install Code Runner') {
    /* opens the Extensions view with the exact id pre-filled — one click installs */
    void vscode.commands.executeCommand('workbench.extensions.search', CODE_RUNNER_ID);
  }
}

/** Copy the exact compiler command line for the active file to the clipboard. */
async function copyCompileCommand(): Promise<void> {
  const file = await getTargetSourceFile();
  if (!file) {
    return;
  }
  try {
    const plan = resolvePlan(file, getConfig());
    await vscode.env.clipboard.writeText(plan.commandLine);
    void vscode.window.showInformationMessage('Compile command copied to the clipboard.', 'Show Output').then((pick) => {
      if (pick === 'Show Output') {
        showOutput(true);
      }
    });
    log('[copy] ' + plan.commandLine);
  } catch (e) {
    vscode.window.showErrorMessage('Could not build the compile command: ' + String(e));
  }
}

/* ---------------- activation ---------------- */

/** Native TreeView shown (and focused) when the webview fails to load. */
const FALLBACK_VIEW_ID = 'graphics-h-runner.fallback';

/** Panel click router: buttons in the webview land here. */
async function handlePanelClick(msg: PanelClick): Promise<void> {
  if (msg.type === 'pong') {
    return; /* liveness heartbeat — handled by the panel's watchdog */
  }
  if (msg.type === 'cheat') {
    return; /* v1.5.8: cheat-sheet open/close sync — handled by the panel provider itself */
  }
  if (msg.type === 'command') {
    const known = await vscode.commands.getCommands().then((all) => all.includes(msg.command));
    if (known) {
      await vscode.commands.executeCommand(msg.command);
    } else {
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

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);
  /* v1.5.11: when VS Code disposes the channel (reload/update/shutdown) the
   * guarded log()/showOutput() helpers must stop writing immediately — see
   * the "Channel has been closed" fix for GRAPHICS-H-RUNNER-G. */
  context.subscriptions.push({ dispose: () => { outputClosed = true; } });

  /* compile errors -> Problems panel: clickable file:line entries + squiggles */
  diagnostics = vscode.languages.createDiagnosticCollection('graphics.h Runner');
  context.subscriptions.push(diagnostics);

  /* ---- automatic error collection (Sentry — see instrument.ts) ---- */
  setTelemetryContext({ extensionRoot: context.extensionPath, extensionMode: context.extensionMode });
  initTelemetry(); /* consent may have flipped since module load */
  setRuntimeTags({
    'vscode.version': String(vscode.version || 'unknown'),
    'vscode.app_host': String(vscode.env.appHost || 'unknown'),
    'vscode.uri_scheme': String(vscode.env.uriScheme || 'unknown')
  });
  context.subscriptions.push(
    vscode.env.onDidChangeTelemetryEnabled((enabled: boolean) => {
      onTelemetryConsentChanged(enabled);
    })
  );

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
  catalog = loadProgramCatalog(context.extensionPath);
  log(`[programs] panel catalog: ${catalog.length} programs loaded`);
  storageDir = context.globalStorageUri.fsPath;
  const version: string = String(context.extension.packageJSON?.version || '0.0.0');
  const panelProvider = new GhPanelProvider(context.extensionPath, version, catalog, (msg) => {
    void handlePanelClick(msg);
  }, {
    onPanelFirstOpen: () => {
      /* School Pride — once per session, first panel open; v1.5.6: it now
       * fires across the panel itself, not a full-screen tab */
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
        addExtensionBreadcrumb('panel', 'webview fallback engaged');
        /* resilience WORKED here (automatic retry + list-view fallback):
         * warning-level visibility, not an error issue */
        captureExtensionWarning('webview failed to load (no pong after retry render)', {
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
  celebrator = new Celebrator(context.extensionPath, {
    onStateChange: (kind: CelebrationKind | undefined) => {
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
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GhPanelProvider.VIEW_ID, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),

    vscode.window.createTreeView(FALLBACK_VIEW_ID, {
      treeDataProvider: new GhFallbackTreeProvider(catalog),
      showCollapseAll: false
    }),

    vscode.commands.registerCommand(
      'graphics-h-runner.runSample',
      trackedCommand('runSample', async (programId: string) => {
        /* used by the fallback tree: open + compile + run in one click */
        await handlePanelClick({ type: 'runProgram', id: String(programId || '') });
      })
    ),

    /* v1.5.5: one STATIC command per example program for the fallback tree
     * (TreeItem.command must not carry arguments — see programsTreeModel). */
    ...catalog.map((p) =>
      vscode.commands.registerCommand(
        treeRunCommandId(p.id),
        trackedCommand('runSample:' + p.id, async () => {
          await handlePanelClick({ type: 'runProgram', id: p.id });
        })
      )
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.fireworks',
      trackedCommand('fireworks', () => {
        /* the SAME button starts and stops the show */
        if (celebrator?.running === 'fireworks') {
          celebrator.stop();
          return;
        }
        celebrator?.show('fireworks');
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.stopFireworks',
      trackedCommand('stopFireworks', () => {
        celebrator?.stop();
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.reloadPanel',
      trackedCommand('reloadPanel', () => {
        panel?.reloadPanel();
      })
    ),

    /* v1.5.9: the "?" in the view TITLE bar (the in-panel ? button is gone).
       Opens/toggles the cheat sheet inside the activity-bar panel. */
    vscode.commands.registerCommand(
      'graphics-h-runner.cheatSheet',
      trackedCommand('cheatSheet', () => {
        void panelProvider.openCheatSheet();
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.openProgram',
      trackedCommand('openProgram', async (program: LoadedProgram) => {
        await openProgram(program); /* awaitable: executeCommand resolves when the file is open */
      })
    )
  );
  void vscode.commands
    .executeCommand('setContext', 'graphics-h-runner.showFallback', false)
    .then(() => undefined, () => undefined);

  // ---- F5 / Run-and-Debug integration ("Run graphics.h program") ----
  registerGraphicsHDebugger(context, async (file, outputLine): Promise<LaunchOutcome> => {
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
    } finally {
      panel?.setBusy(false);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'graphics-h-runner.compileAndRun',
      trackedCommand('compileAndRun', async () => {
        panel?.setBusy(true, 'Compiling…');
        try {
          const file = await getTargetSourceFile();
          if (!file) {
            return;
          }
          const result = await compileSource(file);
          if (result === 'ok') {
            await runBinary(file);
          } else if (result === 'no-compiler') {
            showNoCompilerHelp();
          } else {
            showCompileFailure(file);
          }
        } finally {
          panel?.setBusy(false);
        }
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.compile',
      trackedCommand('compile', async () => {
        panel?.setBusy(true, 'Compiling…');
        try {
          const file = await getTargetSourceFile();
          if (!file) {
            return;
          }
          const result = await compileSource(file);
          if (result === 'ok') {
            vscode.window.showInformationMessage(
              `Compiled OK: ${path.basename(binaryPathFor(file, currentPlatform()))}`
            );
          } else if (result === 'no-compiler') {
            showNoCompilerHelp();
          } else {
            showCompileFailure(file);
          }
        } finally {
          panel?.setBusy(false);
        }
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.run',
      trackedCommand('run', async () => {
        const file = await getTargetSourceFile();
        if (!file) {
          return;
        }
        await runBinary(file);
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.stopProgram',
      trackedCommand('stopProgram', () => {
        void stopRunningProgram();
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.doctor',
      trackedCommand('doctor', async () => {
        await runDoctor(true).catch(() => undefined);
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.setupEverything',
      trackedCommand('setupEverything', () => {
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
          captureExtensionError(e, { command: 'setupEverything' });
          panel?.setBusy(false);
          vscode.window.showErrorMessage('Complete Setup failed: ' + String(e));
        });
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.copyCompileCommand',
      trackedCommand('copyCompileCommand', () => {
        void copyCompileCommand();
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.nativeRunSetup',
      trackedCommand('nativeRunSetup', () => {
        void nativeRunSetup();
      })
    ),

    vscode.commands.registerCommand(
      'graphics-h-runner.openExamplesFolder',
      trackedCommand('openExamplesFolder', () => {
        void openExamplesFolder(context);
      })
    ),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PREFIX)) {
        doctorCache = undefined;
        updateStatusBar();
        panel?.setDoctorResult(undefined);
        void runDoctor(false).catch(() => undefined);
      }
    }),

    vscode.window.onDidCloseTerminal((t) => {
      if (t === runnerTerminal) {
        /* the user closed the persistent terminal — the next Run
         * creates a fresh one with the same name */
        runnerTerminal = undefined;
        setRunState('idle');
      }
    })
  );

  log('graphics.h Runner activated.');
  addExtensionBreadcrumb('lifecycle', 'activated');
}

export async function deactivate(): Promise<void> {
  /* give queued Sentry events a moment to leave before the host tears us down */
  await flushTelemetry(2000);
}
