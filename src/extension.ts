/**
 * extension.ts — graphics.h Runner for VS Code.
 *
 * One-press compile & run for C++ programs that #include <graphics.h>,
 * with the right linker flags per OS (WinBGIM on Windows, SDL_bgi / libgraph
 * on Linux/macOS), plus a Setup Doctor, snippets, templates and a
 * status-bar environment indicator.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  currentPlatform,
  isCppSourceFile,
  binaryPathFor
} from './toolchain';
import { detectGraphicsInclude } from './detect';
import { buildCompilePlan, CompilePlan, LinuxLibrary } from './buildArgs';
import { probeEnvironment, DoctorResult } from './doctor';
import {
  planSetup,
  installSdlBgiUserPrefix,
  installWinbgimWindows,
  checkSdl2Dev,
  installCompilerViaWinget,
  installCompilerWindowsDirect,
  discoverGppWindows,
  verifyCompilerRun
} from './setup';
import { TEMPLATES } from './templates';
import { guideHtml } from './guide';
import { loadProgramCatalog, LoadedProgram, resolveProgramTarget } from './programs';
import { ProgramsViewProvider } from './programsView';
import {
  normalizeCompilerPath,
  normalizeDirList,
  pruneMissingDirs,
  classifySpawnFailure,
  NormalizeOptions
} from './normalize';

const OUTPUT_CHANNEL_NAME = 'graphics.h Runner';
const TERMINAL_NAME = 'graphics.h Runner';
const CONFIG_PREFIX = 'graphics-h-runner.';

let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem | undefined;
let doctorCache: DoctorResult | undefined;
let doctorRunning: Promise<DoctorResult> | undefined;
let programsView: ProgramsViewProvider | undefined;

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

function log(line: string): void {
  output.appendLine(line);
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

/** First g++.exe candidate that actually runs (Windows). */
async function findWorkingGpp(): Promise<{ gppPath: string; version: string } | undefined> {
  for (const candidate of discoverGppWindows()) {
    const v = await verifyCompilerRun(candidate);
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
function compilerEnv(compiler: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  try {
    if (path.isAbsolute(compiler)) {
      const dir = path.dirname(compiler);
      if (fs.existsSync(dir)) {
        env.PATH = dir + path.delimiter + (env.PATH || '');
      }
    }
  } catch {
    /* default env is fine */
  }
  return env;
}

async function runFullSetup(context: vscode.ExtensionContext): Promise<void> {
  const platform = currentPlatform();
  const storageRoot = context.globalStorageUri.fsPath;
  const cfg = getConfig();
  const summary: string[] = [];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'graphics.h: Full Setup', cancellable: false },
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

      let sdl2DevOk = true;
      if (platform === 'linux' || platform === 'macos') {
        progress.report({ message: 'Checking SDL2 headers…' });
        sdl2DevOk = await checkSdl2Dev({ cc: platform === 'macos' ? 'clang' : 'gcc' });
      }

      const plan = planSetup(platform, probe, sdl2DevOk);
      log('[setup] plan: ' + plan.map((s) => `${s.id}(${s.kind})`).join(' -> '));

      for (const step of plan) {
        progress.report({ message: step.title });

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
          } catch (e) {
            output.appendLine('[setup] SDL_bgi install error: ' + String(e));
            summary.push('SDL_bgi auto-install FAILED: ' + String(e));
          }
        } else if (step.kind === 'auto' && step.id === 'install-compiler-winget') {
          /* half-setup fast path: a compiler may already be on disk (previous
           * winget run, manual install, IDE bundle) — skip the whole download */
          const existing = await findWorkingGpp();
          if (existing) {
            await setCompilerPathSetting(existing.gppPath);
            summary.push(`Compiler already present on this PC — using ${existing.gppPath} (${existing.version}). winget step skipped.`);
            continue;
          }
          const winget = await installCompilerViaWinget((p) =>
            progress.report({ message: p.message.slice(0, 110) })
          );
          log('[setup] winget: ' + winget.detail);
          const found = await findWorkingGpp();
          if (found) {
            await setCompilerPathSetting(found.gppPath);
            summary.push(`Compiler installed automatically via winget: ${found.gppPath} (${found.version})`);
          } else if (winget.ok) {
            summary.push('winget finished but no working g++.exe was found — trying the direct-download fallback next.');
          } else {
            summary.push('winget automatic install not possible: ' + winget.detail + ' — trying the direct-download fallback next.');
          }
        } else if (step.kind === 'auto' && step.id === 'install-compiler-download') {
          const current = getConfig();
          const already =
            (await verifyCompilerRun(current.compilerPath || 'g++')).ok ||
            Boolean(await findWorkingGpp());
          if (already) {
            summary.push('Compiler already available — direct download skipped.');
          } else {
            try {
              const dl = await installCompilerWindowsDirect(storageRoot, (p) =>
                progress.report({ message: p.message.slice(0, 110) })
              );
              dl.log.forEach((l) => output.appendLine('[setup] ' + l));
              await setCompilerPathSetting(dl.gppPath);
              summary.push(`Compiler downloaded, verified (sha256) and installed automatically: ${dl.gppPath}`);
            } catch (e) {
              output.appendLine('[setup] direct download error: ' + String(e));
              summary.push('Direct compiler download FAILED: ' + String(e));
            }
          }
        } else if (step.kind === 'auto' && step.id === 'install-winbgim') {
          try {
            const res = await installWinbgimWindows(storageRoot);
            await addPathsToSetting('extraIncludePaths', [res.includeDir]);
            await addPathsToSetting('extraLibPaths', [res.libDir]);
            summary.push('WinBGIM (graphics.h / winbgim.h / libbgi.a) installed into the extension folder.');
          } catch (e) {
            output.appendLine('[setup] WinBGIM install error: ' + String(e));
            summary.push('WinBGIM auto-install FAILED: ' + String(e));
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
          programsView?.setDoctorResult(res);
          summary.push(
            res.graphicsReady
              ? `VERIFIED: graphics.h is ready (library: ${res.bestLibrary}). Press Ctrl+Alt+R inside a graphics.h program to run it.`
              : 'NOT READY YET — finish the ACTION NEEDED items above, then re-run Full Setup.'
          );
        }
      }
    }
  );

  output.show(true);
  output.appendLine('=== Full Setup summary ===');
  summary.forEach((s) => output.appendLine('- ' + s));

  const needsAction = summary.some((s) => s.startsWith('ACTION NEEDED'));
  if (needsAction) {
    const pick = await vscode.window.showInformationMessage(
      'A few system packages must be installed with your password. Run the printed commands in the terminal, then re-run "Full Setup" to verify.',
      'Open Terminal',
      'Show Output'
    );
    if (pick === 'Open Terminal') {
      vscode.window.createTerminal('graphics.h Setup').show();
    } else if (pick === 'Show Output') {
      output.show(true);
    }
  } else if (summary.some((s) => s.startsWith('VERIFIED: graphics.h is ready'))) {
    vscode.window.showInformationMessage(
      'Everything is set up! Open a .cpp file that includes <graphics.h> and press Ctrl+Alt+R.'
    );
  } else {
    vscode.window.showWarningMessage('Full Setup finished with problems — see the graphics.h Runner output.');
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
        child.stderr?.on('data', (d: Buffer) => output.append(d.toString()));

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

  return result;
}

function runBinary(sourceFile: string): void {
  const platform = currentPlatform();
  const bin = binaryPathFor(sourceFile, platform);
  if (!fs.existsSync(bin)) {
    vscode.window.showErrorMessage(`Binary not found: ${bin}. Compile first.`, 'Compile now').then(
      (pick) => {
        if (pick === 'Compile now') {
          vscode.commands.executeCommand('graphics-h-runner.compile');
        }
      }
    );
    return;
  }

  /* Windows: launch the .exe directly (detached). This is immune to whichever
   * shell the user's terminal profile uses (PowerShell/cmd/Git Bash quoting
   * differences), and the graphics window lives on its own. */
  if (platform === 'windows') {
    try {
      const child = spawn(bin, [], {
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
      log('[run] ' + bin + ' (detached)');
      return;
    } catch {
      runInTerminal(bin, platform);
      return;
    }
  }

  runInTerminal(bin, platform);
}

function runInTerminal(bin: string, platform: string): void {
  const term =
    vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && !t.exitStatus) ||
    vscode.window.createTerminal(TERMINAL_NAME);
  term.show(true);

  const abs = path.resolve(bin);
  const cmd = platform === 'windows' ? `& "${abs}"` : `"${abs}"`;
  log('[run] ' + cmd);
  term.sendText(cmd, true);
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
        output.show(true);
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
      'Set up everything (recommended)',
      'Run Setup Doctor',
      'Show Output'
    )
    .then((pick) => {
      if (pick === 'Set up everything (recommended)') {
        vscode.commands.executeCommand('graphics-h-runner.setupEverything');
      } else if (pick === 'Run Setup Doctor') {
        vscode.commands.executeCommand('graphics-h-runner.doctor');
      } else if (pick === 'Show Output') {
        output.show(true);
      }
    });
}

/* ---------------- status bar ---------------- */

function updateStatusBar(): void {
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
  programsView?.setDoctorResult(res);

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
        .showInformationMessage(
          `graphics.h environment is ready (library: ${res.bestLibrary}).`,
          'Show Output'
        )
        .then((pick) => {
          if (pick === 'Show Output') {
            output.show(true);
          }
        });
    } else {
      const picks = ['Fix automatically', 'Show Output', 'Show Setup Guide'];
      const pick = await vscode.window.showWarningMessage(
        'graphics.h environment is not ready yet. The Setup Doctor found problems.',
        ...picks
      );
      if (pick === 'Show Output') {
        output.show(true);
      } else if (pick === 'Show Setup Guide') {
        vscode.commands.executeCommand('graphics-h-runner.showGuide');
      } else if (pick === 'Fix automatically') {
        vscode.commands.executeCommand('graphics-h-runner.setupEverything');
      }
    }
  }
  return res;
}

/* ---------------- templates ---------------- */

async function insertTemplate(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    TEMPLATES.map((t) => ({ label: t.label, description: t.description, template: t })),
    { placeHolder: 'Insert a graphics.h code template' }
  );
  if (!pick) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await editor.edit((eb) => {
      eb.insert(editor.selection.start, pick.template.code);
    });
  } else {
    const doc = await vscode.workspace.openTextDocument({
      language: 'cpp',
      content: pick.template.code
    });
    await vscode.window.showTextDocument(doc);
  }
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
  }
}

/* ---------------- setup guide ---------------- */

function showGuide(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'graphicsHSetupGuide',
    'graphics.h Setup Guide',
    vscode.ViewColumn.One,
    {}
  );
  panel.webview.html = guideHtml(currentPlatform());
  context.subscriptions.push(panel);
}

/* ---------------- activation ---------------- */

export function activate(context: vscode.ExtensionContext): void {
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
  const catalog = loadProgramCatalog(context.extensionPath);
  log(`[programs] sidebar catalog: ${catalog.length} programs loaded`);
  const viewProvider = new ProgramsViewProvider(catalog);
  programsView = viewProvider;
  if (doctorCache) {
    viewProvider.setDoctorResult(doctorCache);
  }
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('graphics-h-runner.programs', viewProvider),

    vscode.commands.registerCommand('graphics-h-runner.openProgram', (program: LoadedProgram) => {
      void openProgram(program);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('graphics-h-runner.compileAndRun', async () => {
      const file = await getTargetSourceFile();
      if (!file) {
        return;
      }
      const result = await compileSource(file);
      if (result === 'ok') {
        runBinary(file);
      } else if (result === 'no-compiler') {
        showNoCompilerHelp();
      } else {
        showCompileFailure(file);
      }
    }),

    vscode.commands.registerCommand('graphics-h-runner.compile', async () => {
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
    }),

    vscode.commands.registerCommand('graphics-h-runner.run', async () => {
      const file = await getTargetSourceFile();
      if (!file) {
        return;
      }
      runBinary(file);
    }),

    vscode.commands.registerCommand('graphics-h-runner.doctor', async () => {
      await runDoctor(true).catch(() => undefined);
    }),

    vscode.commands.registerCommand('graphics-h-runner.setupEverything', () => {
      void runFullSetup(context).catch((e) => {
        log('[setup] crashed: ' + String(e));
        vscode.window.showErrorMessage('Full Setup failed: ' + String(e));
      });
    }),

    vscode.commands.registerCommand('graphics-h-runner.insertTemplate', () => {
      void insertTemplate();
    }),

    vscode.commands.registerCommand('graphics-h-runner.showGuide', () => {
      showGuide(context);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_PREFIX)) {
        doctorCache = undefined;
        updateStatusBar();
        programsView?.setDoctorResult(undefined);
        void runDoctor(false).catch(() => undefined);
      }
    })
  );

  log('graphics.h Runner activated.');
}

export function deactivate(): void {
  /* nothing to clean up */
}
