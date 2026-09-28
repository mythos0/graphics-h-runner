/**
 * nativeRun.ts — v1.5.12 THE "native VS Code run" integration.
 *
 * User request: "complete run setup will modify the vs code main run option
 * (ctrl+alt+n) / f5 run, so that normal vs code cpp run can run with our
 * ctrl+alt+r setting."
 *
 * Complete Setup (and the standalone command) now WRITES the standard VS
 * Code run surfaces so that a plain C++ run — without touching our own
 * buttons — behaves exactly like Ctrl+Alt+R:
 *
 *   F5            -> .vscode/launch.json with the extension's OWN
 *                    `graphics-h` debug type: the session compiles the open
 *                    .cpp through the SAME resolvePlan/buildCompilePlan
 *                    pipeline as Ctrl+Alt+R (auto-detect graphics.h, static
 *                    linking, the right -l list). Zero external debugger
 *                    extensions required.
 *   Ctrl+Alt+N    -> code-runner.executorMap.cpp — Code Runner ("Run Code")
 *                    gets the exact same compiler + graphics linker flags
 *                    and runs the binary in the INTEGRATED TERMINAL
 *                    (stdin/cin/getch work, like our runner terminal).
 *   Ctrl+Shift+B  -> .vscode/tasks.json default build task with the same
 *                    flags; the $gcc problemMatcher routes compiler errors
 *                    into the Problems panel.
 *   IntelliSense  -> C_Cpp.default.compilerPath so the C/C++ extension (when
 *                    installed) squiggle-checks against the same g++.
 *
 * This module is PURE (no vscode import): every string/file shape it
 * produces is unit-testable in plain Node (test/native-run-tests.js),
 * including a REAL compile that pastes the generated executor template
 * into a shell on the sandbox toolchain.
 */

import { Platform } from './toolchain';
import { WINBGIM_LINK_LIBS, SDL_BGI_LINK_LIBS, LinuxLibrary } from './buildArgs';

/** Everything the builders need — straight from the extension config. */
export interface NativeToolchain {
  platform: Platform;
  /** Resolved (absolute when known) compiler executable. */
  compilerPath: string;
  /** graphics-h-runner.extraIncludePaths (already normalized). */
  includePaths: string[];
  /** graphics-h-runner.extraLibPaths (already normalized). */
  libPaths: string[];
  /** graphics-h-runner.extraCompilerArgs. */
  extraArgs: string[];
  /** graphics-h-runner.staticLinkWindows (Windows only effect). */
  staticLinkWindows: boolean;
  linuxLibrary?: LinuxLibrary;
}

/** Placeholder tokens understood by Code Runner's executorMap. */
export const CR_FILE = '$fileName';
export const CR_DIR = '$dir';
export const CR_NOEXT = '$fileNameWithoutExt';

/** VS Code task variables. */
export const TASK_FILE = '${file}';
export const TASK_DIRNAME = '${fileDirname}';
export const TASK_NOEXT = '${fileBasenameNoExtension}';

/** Names this extension owns inside the user's .vscode files. */
export const TASK_LABEL = 'graphics.h: build active file';
export const LAUNCH_CONFIG_NAME = 'Run graphics.h program';

function quoteIfNeeded(p: string): string {
  return /[\s"]/.test(p) ? '"' + p.replace(/"/g, '') + '"' : p;
}

function outExecutable(noExt: string, platform: Platform): string {
  return platform === 'windows' ? noExt + '.exe' : noExt;
}

/**
 * The Code Runner `executorMap.cpp` command — the same compile the
 * extension performs for Ctrl+Alt+R, written as a Code Runner template.
 *
 * The graphics flags are ALWAYS present: for a plain C++ file the linker
 * pulls nothing from libbgi.a / libSDL_bgi (unused symbols are not
 * linked), so one template serves "normal cpp" and graphics.h alike —
 * which is exactly what the user asked for.
 */
export function codeRunnerExecutor(info: NativeToolchain): string {
  const parts: string[] = [`cd "${CR_DIR}" &&`];
  parts.push(quoteIfNeeded(info.compilerPath));

  for (const inc of info.includePaths) {
    parts.push('-I' + quoteIfNeeded(inc));
  }
  for (const a of info.extraArgs) {
    parts.push(quoteIfNeeded(a));
  }
  parts.push(CR_FILE, '-o', outExecutable(CR_NOEXT, info.platform));

  if (info.platform === 'windows') {
    if (info.staticLinkWindows) {
      parts.push('-static');
    }
    parts.push(...WINBGIM_LINK_LIBS);
    if (info.staticLinkWindows) {
      parts.push('-static-libgcc', '-static-libstdc++');
    }
    parts.push('&&', `"${CR_DIR}${CR_NOEXT}.exe"`);
  } else {
    for (const lib of info.libPaths) {
      parts.push('-L' + quoteIfNeeded(lib));
      parts.push('-Wl,-rpath,' + quoteIfNeeded(lib));
    }
    parts.push(...SDL_BGI_LINK_LIBS);
    parts.push('&&', `"${CR_DIR}${CR_NOEXT}"`);
  }
  return parts.join(' ');
}

/**
 * .vscode/tasks.json content — a default build task carrying the same
 * flags. `stealDefault` is false when the user already has their own
 * default build task (we then register ours as a plain build task and
 * leave their default alone).
 */
export function buildTaskJson(info: NativeToolchain, stealDefault: boolean): Record<string, unknown> {
  const out = outExecutable(TASK_DIRNAME + '/' + TASK_NOEXT, info.platform);
  const args: string[] = [];
  for (const inc of info.includePaths) {
    args.push('-I' + inc);
  }
  args.push(...info.extraArgs);
  args.push(TASK_FILE, '-o', out);
  if (info.platform === 'windows') {
    if (info.staticLinkWindows) {
      args.push('-static');
    }
    args.push(...WINBGIM_LINK_LIBS);
    if (info.staticLinkWindows) {
      args.push('-static-libgcc', '-static-libstdc++');
    }
  } else {
    for (const lib of info.libPaths) {
      args.push('-L' + lib);
      args.push('-Wl,-rpath,' + lib);
    }
    args.push(...SDL_BGI_LINK_LIBS);
  }

  return {
    version: '2.0.0',
    tasks: [
      {
        label: TASK_LABEL,
        type: 'shell',
        command: info.compilerPath,
        args,
        options: { cwd: TASK_DIRNAME },
        group: stealDefault ? { kind: 'build', isDefault: true } : 'build',
        problemMatcher: ['$gcc'],
        detail: 'Same compiler + graphics.h flags as the graphics.h Runner (Ctrl+Alt+R).'
      }
    ]
  };
}

/**
 * .vscode/launch.json content — F5 compiles & runs the open file through
 * the extension's own `graphics-h` debug type (the Ctrl+Alt+R engine).
 * No preLaunchTask needed: the adapter compiles first itself.
 */
export function buildLaunchJson(): Record<string, unknown> {
  return {
    version: '0.2.0',
    configurations: [
      {
        type: 'graphics-h',
        request: 'launch',
        name: LAUNCH_CONFIG_NAME,
        program: '${file}'
      }
    ]
  };
}

/* ---------------- JSONC (VS Code settings files tolerate comments) ---------------- */

/**
 * String-aware comment stripper for JSONC. Quotes, escapes and both
 * comment styles are handled; the result is valid JSON apart from
 * possible trailing commas (handled by stripTrailingCommas).
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i++; /* skip the closing '/' on the next loop step */
      continue;
    }
    out += ch;
  }
  return out;
}

/** String-aware trailing-comma remover (`[1,2,]` -> `[1,2]`). */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === '}' || text[j] === ']') {
        continue; /* drop the comma — the next meaningful char closes */
      }
    }
    out += ch;
  }
  return out;
}

/** Tolerant JSONC parse; undefined when the file is not salvageable. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(text)));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export interface MergeResult {
  /** Full file text to write. */
  text: string;
  /** The .vscode file did not exist (or was empty) — we created content fresh. */
  created: boolean;
  /** An entry with the same identity existed and was replaced (not duplicated). */
  replaced: boolean;
  /** True when the original text was unparseable — caller must back it up. */
  needsBackup: boolean;
}

/**
 * Merge our entry into an existing VS Code JSONC document without losing
 * the user's own content.
 *
 *  - fresh file                -> our doc verbatim (created)
 *  - unparseable existing file -> needsBackup (caller saves a .bak copy)
 *  - entry with the same identity already present -> replaced in place
 *  - otherwise                 -> our entry PREPENDED (launch default) or
 *                                 APPENDED (tasks) per `prepend`
 *
 * All other top-level keys (user comments lost by necessity, data kept)
 * and sibling array entries survive untouched.
 */
export function mergeConfigDoc(
  existingText: string | undefined,
  freshDoc: Record<string, unknown>,
  arrayKey: 'tasks' | 'configurations',
  matchField: 'label' | 'name',
  matchValue: string,
  opts: { prepend?: boolean } = {}
): MergeResult {
  const empty = !existingText || existingText.trim().length === 0;
  if (empty) {
    return { text: JSON.stringify(freshDoc, null, 4) + '\n', created: true, replaced: false, needsBackup: false };
  }
  const parsed = parseJsonc(existingText as string);
  if (!parsed) {
    return { text: JSON.stringify(freshDoc, null, 4) + '\n', created: false, replaced: false, needsBackup: true };
  }

  const existingList = Array.isArray(parsed[arrayKey]) ? (parsed[arrayKey] as unknown[]) : [];
  const ours = (freshDoc[arrayKey] as unknown[])[0];
  const idx = existingList.findIndex(
    (e) => e && typeof e === 'object' && (e as Record<string, unknown>)[matchField] === matchValue
  );

  let list: unknown[];
  let replaced = false;
  if (idx >= 0) {
    list = existingList.slice();
    list[idx] = ours;
    replaced = true;
  } else if (opts.prepend) {
    list = [ours, ...existingList];
  } else {
    list = [...existingList, ours];
  }

  const doc: Record<string, unknown> = { ...parsed, [arrayKey]: list };
  if (!doc.version && typeof freshDoc.version === 'string') {
    doc.version = freshDoc.version;
  }
  return { text: JSON.stringify(doc, null, 4) + '\n', created: false, replaced, needsBackup: false };
}

/**
 * True when the existing tasks.json already carries its own default build
 * task (we then do not steal the Ctrl+Shift+B default).
 */
export function hasDefaultBuildTask(existingText: string | undefined): boolean {
  if (!existingText) {
    return false;
  }
  const parsed = parseJsonc(existingText);
  const tasks = parsed && Array.isArray(parsed.tasks) ? (parsed.tasks as Record<string, unknown>[]) : [];
  return tasks.some((t) => {
    if (!t || typeof t !== 'object') {
      return false;
    }
    const g = t.group;
    if (g === 'build') {
      return false; /* in the group, but not the default */
    }
    if (g && typeof g === 'object' && (g as Record<string, unknown>).kind === 'build') {
      return (g as Record<string, unknown>).isDefault === true;
    }
    return false;
  });
}

/**
 * Merge a settings patch into an existing .vscode/settings.json document.
 *
 * Why not the vscode Settings API? `config.update('executorMap.cpp', …)`
 * REFUSES to write keys owned by an extension that is not installed/loaded
 * ("Unable to write to Workspace Settings because code-runner.executorMap.cpp
 * is not a registered configuration") — precisely the situation of a user
 * who has not installed Code Runner yet. Writing the file directly works in
 * every case and is what the user would have typed themselves; the keys are
 * inert until the owning extension is present.
 *
 * Patch semantics (top-level keys, VS Code settings files are flat):
 *   - scalar keys            -> set (only when the value actually changes)
 *   - object keys            -> deep-merged per key (e.g. executorMap keeps
 *                               the user's custom javascript/c executors)
 * Everything else in the file survives; a corrupt file backs up first.
 */
export function mergeSettingsDoc(
  existingText: string | undefined,
  patch: Record<string, unknown>
): MergeResult {
  const empty = !existingText || existingText.trim().length === 0;
  if (empty) {
    return { text: JSON.stringify(patch, null, 4) + '\n', created: true, replaced: false, needsBackup: false };
  }
  const parsed = parseJsonc(existingText as string);
  if (!parsed) {
    return { text: JSON.stringify(patch, null, 4) + '\n', created: false, replaced: false, needsBackup: true };
  }

  const doc: Record<string, unknown> = { ...parsed };
  let changed: boolean = empty;
  for (const [key, value] of Object.entries(patch)) {
    const current = doc[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const merged = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        doc[key] = merged;
        changed = true;
      }
    } else if (JSON.stringify(current) !== JSON.stringify(value)) {
      doc[key] = value;
      changed = true;
    }
  }
  if (!changed) {
    return { text: existingText as string, created: false, replaced: false, needsBackup: false };
  }
  return { text: JSON.stringify(doc, null, 4) + '\n', created: false, replaced: false, needsBackup: false };
}
