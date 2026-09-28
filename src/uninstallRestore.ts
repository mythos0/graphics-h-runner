/**
 * uninstallRestore.ts — v1.5.13 THE "clean exit" guarantee.
 *
 * User request: "when uninstalling this extension, all settings (changed by
 * this extension) should be reverted as they were before running of complete
 * run setup. do it properly and test it properly."
 *
 * HOW IT WORKS (three moving parts, all in this module):
 *
 *   1. SNAPSHOT — before Complete Run Setup (or the standalone native-run
 *      command) touches ANYTHING, the original global-scope setting values
 *      and the raw text of the workspace .vscode files are captured into
 *      <globalStorage>/uninstall-restore/uninstall-backup.json. The FIRST
 *      capture wins: later setup runs never overwrite it, so the snapshot
 *      always represents the true pre-extension state.
 *
 *   2. NOTE — every setting/file the extension actually writes is recorded
 *      in the backup ("written" lists). Restore touches ONLY those — a
 *      setting the user changed themselves is never clobbered.
 *
 *   3. RESTORE — VS Code calls deactivate() when the extension is
 *      uninstalled (while VS Code is running), and also on every shutdown.
 *      isRealUninstall() tells the two apart by reading the extensions
 *      folder's .obsolete marker (our folder is marked deleted) and
 *      cross-checking that no other version of this extension is still
 *      installed (an UPDATE also marks the old version — that is not an
 *      uninstall, so nothing is restored). The surgical restore puts back
 *      exactly what was recorded:
 *
 *        - global settings          -> pre-setup value, or removed when
 *                                      the key did not exist before
 *        - .vscode/settings.json    -> per-key surgical (our executorMap.cpp
 *                                      removed, the user's other languages
 *                                      and every unrelated setting kept)
 *        - .vscode/launch.json      -> our entry removed / the user's
 *        - .vscode/tasks.json         same-name entry restored; a file we
 *                                      created is deleted again once empty
 *        - original file was not valid JSONC -> restored BYTE-EXACT
 *
 *  The one gap VS Code cannot close: uninstalling while VS Code is CLOSED
 *  runs no extension code, so deactivate cannot fire. The command
 *  "graphics.h: Restore Original Settings" performs the identical restore
 *  manually (and doubles as an explicit undo button). If the user
 *  reinstalls afterwards, the next Complete Run Setup takes a fresh
 *  snapshot and the cycle starts clean.
 *
 *  Scope note: the Windows "make global" step copies files into the MinGW
 *  toolchain folders and edits the user PATH — that is system state, not
 *  VS Code settings, and is deliberately NOT auto-deleted (removing files
 *  from a compiler installation automatically is too risky). It is
 *  documented in the README and visible in the Setup Doctor output.
 *
 * This module is PURE (no vscode import): everything runs on plain Node
 * fs and is unit-tested from test/uninstall-restore-tests.js, including
 * full end-to-end lifecycle round-trips in real temp directories.
 */

import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonc, LAUNCH_CONFIG_NAME, TASK_LABEL } from './nativeRun';

/** Backup location inside the extension's global storage. */
export const BACKUP_DIR_NAME = 'uninstall-restore';
export const BACKUP_FILE_NAME = 'uninstall-backup.json';

/** Suffix of the corrupt-file copies the v1.5.12 merge writes next to .vscode files. */
export const CORRUPT_BACKUP_SUFFIX = '.graphics-h-backup';

/** The flat .vscode/settings.json keys this extension may write. */
export const MANAGED_SETTINGS_KEYS = [
  'code-runner.executorMap',
  'code-runner.runInTerminal',
  'code-runner.saveFileBeforeRun',
  'code-runner.fileDirectoryAsCwd',
  'C_Cpp.default.compilerPath'
] as const;

/** The executorMap sub-key this extension owns (never touches others). */
export const EXECUTOR_MAP_KEY = 'code-runner.executorMap';
export const EXECUTOR_SUBKEY = 'cpp';

/**
 * Global-scope (user settings) keys snapshotted before setup. The
 * graphics-h-runner.* trio is written by the toolchain steps, the rest by
 * the native-run integration when no folder is open.
 */
export const GLOBAL_SNAPSHOT_KEYS = [
  'graphics-h-runner.extraIncludePaths',
  'graphics-h-runner.extraLibPaths',
  'graphics-h-runner.compilerPath',
  'code-runner.executorMap.cpp',
  'code-runner.runInTerminal',
  'code-runner.saveFileBeforeRun',
  'code-runner.fileDirectoryAsCwd',
  'C_Cpp.default.compilerPath'
] as const;

export const SETTINGS_FILE = 'settings.json';
export const LAUNCH_FILE = 'launch.json';
export const TASKS_FILE = 'tasks.json';
export const KNOWN_FILE_NAMES = [SETTINGS_FILE, LAUNCH_FILE, TASKS_FILE];

export type FileKind = 'settings' | 'launch' | 'tasks';

/** A global setting value BEFORE the extension touched it. */
export interface ValueSnapshot {
  /** false = the key did not exist at global scope (restore removes it). */
  set: boolean;
  value?: unknown;
}

/** One workspace file the extension actually created or modified. */
export interface FileWriteRecord {
  /** Absolute path, as written at setup time. */
  path: string;
  kind: FileKind;
  /** settings.json only: the managed keys that the write actually changed. */
  keys?: string[];
}

export interface UninstallBackup {
  schema: 1;
  createdAt: string;
  extensionVersion: string;
  /** Pre-extension global values, keyed by fully-qualified setting id. */
  global: Record<string, ValueSnapshot>;
  /** Pre-extension raw file text; null = the file did not exist. */
  files: Record<string, string | null>;
  /** Global keys the extension actually wrote (restore list). */
  writtenGlobal: string[];
  /** Workspace files the extension actually wrote (restore list). */
  writtenFiles: FileWriteRecord[];
}

export interface RestoreResult {
  status: 'restored' | 'nothing';
  restoredGlobal: string[];
  restoredFiles: string[];
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* backup file primitives                                              */
/* ------------------------------------------------------------------ */

export function backupFilePath(backupDir: string): string {
  return path.join(backupDir, BACKUP_FILE_NAME);
}

export async function readBackup(backupDir: string): Promise<UninstallBackup | undefined> {
  try {
    const raw = await fsp.readFile(backupFilePath(backupDir), 'utf8');
    const parsed = JSON.parse(raw) as UninstallBackup;
    if (!parsed || parsed.schema !== 1 || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function hasBackup(backupDir: string): Promise<boolean> {
  return (await readBackup(backupDir)) !== undefined;
}

/**
 * Create the backup from the pre-extension state. FIRST WINS: when a backup
 * already exists nothing is written (later setup runs must never replace the
 * original snapshot with an already-modified state).
 *
 * @returns true when a NEW backup was created, false when one existed.
 */
export async function ensureBackup(
  backupDir: string,
  base: { extensionVersion: string; global: Record<string, ValueSnapshot>; files: Record<string, string | null> }
): Promise<boolean> {
  if (await hasBackup(backupDir)) {
    return false;
  }
  const doc: UninstallBackup = {
    schema: 1,
    createdAt: new Date().toISOString(),
    extensionVersion: base.extensionVersion,
    global: base.global,
    files: base.files,
    writtenGlobal: [],
    writtenFiles: []
  };
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.writeFile(backupFilePath(backupDir), JSON.stringify(doc, null, 2), 'utf8');
  return true;
}

/**
 * Record what the extension actually wrote, so restore touches only those
 * items. Idempotent and additive: repeated setup runs merge into the same
 * lists; per-file `keys` union-merge for settings.json records.
 */
export async function noteWritten(
  backupDir: string,
  patch: { globalKeys?: string[]; files?: FileWriteRecord[] }
): Promise<void> {
  const backup = await readBackup(backupDir);
  if (!backup) {
    return; /* no snapshot -> nothing will be restored either */
  }
  let dirty = false;
  for (const key of patch.globalKeys || []) {
    if (!backup.writtenGlobal.includes(key)) {
      backup.writtenGlobal.push(key);
      dirty = true;
    }
  }
  for (const rec of patch.files || []) {
    if (!KNOWN_FILE_NAMES.includes(path.basename(rec.path))) {
      continue; /* never track foreign paths */
    }
    const existing = backup.writtenFiles.find((r) => r.path === rec.path);
    if (!existing) {
      backup.writtenFiles.push({ ...rec });
      dirty = true;
    } else {
      if (rec.keys && rec.keys.length > 0) {
        const merged = new Set([...(existing.keys || []), ...rec.keys]);
        const before = (existing.keys || []).join('|');
        existing.keys = MANAGED_SETTINGS_KEYS.filter((k) => merged.has(k));
        if (before !== existing.keys.join('|')) {
          dirty = true;
        }
      }
    }
  }
  if (dirty) {
    await fsp.writeFile(backupFilePath(backupDir), JSON.stringify(backup, null, 2), 'utf8');
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which of the managed keys did this write actually change? Used right
 * after a settings.json write to keep the restore list minimal.
 */
export function changedManagedKeys(
  beforeText: string | undefined,
  afterText: string,
  keys: readonly string[] = MANAGED_SETTINGS_KEYS
): string[] {
  const before = beforeText ? parseJsonc(beforeText) || {} : {};
  const after = parseJsonc(afterText) || {};
  return keys.filter((k) => !jsonEq(before[k], after[k]));
}

/* ------------------------------------------------------------------ */
/* surgical restore computations (pure)                                */
/* ------------------------------------------------------------------ */

export interface FileOps {
  /** Delete the file entirely (we created it and nothing of value remains). */
  deleteFile: boolean;
  /** Full text to write when deleteFile is false and changed is true. */
  text: string;
  changed: boolean;
  notes: string[];
}

function stringifyDoc(doc: Record<string, unknown>): string {
  return JSON.stringify(doc, null, 4) + '\n';
}

/** True when the parsed doc carries nothing but (at most) an empty container. */
function effectivelyEmpty(doc: Record<string, unknown>, containerKey: string): boolean {
  const meaningful = Object.keys(doc).filter((k) => k !== 'version' && k !== containerKey);
  if (meaningful.length > 0) {
    return false;
  }
  const list = doc[containerKey];
  return list === undefined || (Array.isArray(list) && list.length === 0);
}

/**
 * settings.json restore. `keys` = the managed keys actually written by the
 * extension (from the FileWriteRecord). Semantics per key:
 *   - executorMap  -> restore/remove ONLY the cpp sub-key; the user's other
 *                     language executors survive in every case
 *   - scalar keys  -> pre value restored; a key that did not exist before is
 *                     removed again
 * The file is deleted only when it did not exist before AND is empty after
 * removing our keys. An unparseable ORIGINAL is restored byte-exact.
 */
export function computeSettingsRestoreOps(
  preText: string | null,
  curText: string,
  keys: readonly string[] = MANAGED_SETTINGS_KEYS
): FileOps {
  const notes: string[] = [];

  /* The original file existed but was not valid JSONC: the v1.5.12 merge
   * replaced it wholesale, so the exact revert is the original bytes. */
  if (preText !== null && preText.trim().length > 0 && !parseJsonc(preText)) {
    return {
      deleteFile: false,
      text: preText,
      changed: preText !== curText,
      notes: ['original settings.json was not valid JSONC — restored byte-exact']
    };
  }

  const cur = parseJsonc(curText);
  if (!cur) {
    if (preText === null) {
      /* we created it and it is now corrupt -> removing returns to pre-state */
      return { deleteFile: true, text: '', changed: true, notes: ['created by the extension, now unparseable — deleted'] };
    }
    return { deleteFile: false, text: preText, changed: true, notes: ['current file unparseable — restored original bytes'] };
  }
  const originalCur = { ...cur };

  const pre: Record<string, unknown> = preText === null ? {} : parseJsonc(preText) || {};
  if (preText !== null && preText.trim().length === 0) {
    notes.push('original settings.json was empty');
  }

  for (const key of keys) {
    if (key === EXECUTOR_MAP_KEY) {
      const preMap = isObj(pre[key]) ? (pre[key] as Record<string, unknown>) : undefined;
      const curMap = isObj(cur[key]) ? (cur[key] as Record<string, unknown>) : undefined;
      /* executor values are STRINGS (the command template) — presence, not isObj */
      if (preMap && Object.prototype.hasOwnProperty.call(preMap, EXECUTOR_SUBKEY)) {
        cur[key] = { ...(curMap || {}), [EXECUTOR_SUBKEY]: preMap[EXECUTOR_SUBKEY] };
      } else if (curMap && Object.prototype.hasOwnProperty.call(curMap, EXECUTOR_SUBKEY)) {
        const rest = { ...curMap };
        delete rest[EXECUTOR_SUBKEY];
        if (Object.keys(rest).length > 0 || preMap) {
          cur[key] = rest;
        } else {
          delete cur[key];
        }
      }
    } else if (Object.prototype.hasOwnProperty.call(pre, key)) {
      cur[key] = pre[key];
    } else {
      delete cur[key];
    }
  }

  const emptyAfter = Object.keys(cur).length === 0;
  const deleteFile = preText === null && emptyAfter;
  return {
    deleteFile,
    text: stringifyDoc(cur),
    changed: deleteFile || !jsonEq(cur, originalCur),
    notes
  };
}

/**
 * launch.json / tasks.json restore. `matchField`+`matchValue` identify the
 * extension's own entry (name for launch, label for tasks). Semantics:
 *   - file did not exist before  -> our entry removed; the file is deleted
 *     only when nothing else remains (the user may have added their own
 *     entries after the setup — those survive)
 *   - user had the SAME-name entry -> their original entry restored verbatim
 *   - otherwise                  -> our entry removed, order preserved
 * An unparseable original or current file falls back to the raw bytes.
 */
export function computeConfigRestoreOps(
  preText: string | null,
  curText: string,
  arrayKey: 'configurations' | 'tasks',
  matchField: 'name' | 'label',
  matchValue: string
): FileOps {
  const notes: string[] = [];

  if (preText !== null && preText.trim().length > 0 && !parseJsonc(preText)) {
    return {
      deleteFile: false,
      text: preText,
      changed: preText !== curText,
      notes: ['original file was not valid JSONC — restored byte-exact']
    };
  }

  const cur = parseJsonc(curText);
  if (!cur) {
    if (preText === null) {
      return { deleteFile: true, text: '', changed: true, notes: ['created by the extension, now unparseable — deleted'] };
    }
    return { deleteFile: false, text: preText, changed: true, notes: ['current file unparseable — restored original bytes'] };
  }
  const originalCur = { ...cur };
  const curList = Array.isArray(cur[arrayKey]) ? (cur[arrayKey] as unknown[]) : undefined;

  const removeOurs = (doc: Record<string, unknown>): boolean => {
    const list = Array.isArray(doc[arrayKey]) ? (doc[arrayKey] as unknown[]) : undefined;
    if (!list) {
      return false;
    }
    const idx = list.findIndex(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>)[matchField] === matchValue
    );
    if (idx < 0) {
      return false;
    }
    const next = list.slice();
    next.splice(idx, 1);
    doc[arrayKey] = next;
    return true;
  };

  if (preText === null) {
    removeOurs(cur);
    if (effectivelyEmpty(cur, arrayKey)) {
      return { deleteFile: true, text: '', changed: true, notes: ['created by the extension — deleted'] };
    }
    return { deleteFile: false, text: stringifyDoc(cur), changed: !jsonEq(cur, originalCur), notes };
  }

  const pre = parseJsonc(preText) as Record<string, unknown>;
  const preList = Array.isArray(pre[arrayKey]) ? (pre[arrayKey] as unknown[]) : [];
  const preIdx = preList.findIndex(
    (e) => e && typeof e === 'object' && (e as Record<string, unknown>)[matchField] === matchValue
  );

  if (preIdx >= 0) {
    /* the user had an entry with OUR name — put their original back */
    const list = curList ? curList.slice() : [];
    const idx = list.findIndex(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>)[matchField] === matchValue
    );
    if (idx >= 0) {
      list[idx] = preList[preIdx];
    } else {
      list.push(preList[preIdx]);
    }
    cur[arrayKey] = list;
  } else {
    removeOurs(cur);
  }

  if (effectivelyEmpty(cur, arrayKey)) {
    return { deleteFile: true, text: '', changed: true, notes: ['nothing left after removing the extension entry — deleted'] };
  }
  return { deleteFile: false, text: stringifyDoc(cur), changed: !jsonEq(cur, originalCur), notes };
}

/* ------------------------------------------------------------------ */
/* the restore orchestration                                           */
/* ------------------------------------------------------------------ */

/**
 * Restore everything the extension actually wrote, from the backup.
 * `applyGlobal(fqKey, value)` receives `undefined` when the key must be
 * REMOVED (did not exist at global scope before). The backup file is
 * deleted only after a fully successful run (so a partial failure keeps
 * its state and can be retried).
 */
export async function restoreFromBackup(
  backupDir: string,
  opts: {
    applyGlobal: (fqKey: string, value: unknown | undefined) => Promise<void>;
    log?: (line: string) => void;
  }
): Promise<RestoreResult> {
  const log = opts.log || (() => undefined);
  const backup = await readBackup(backupDir);
  if (!backup) {
    return { status: 'nothing', restoredGlobal: [], restoredFiles: [], errors: [] };
  }
  const result: RestoreResult = { status: 'restored', restoredGlobal: [], restoredFiles: [], errors: [] };

  /* 1. global (user) settings — only the keys the extension wrote */
  for (const key of backup.writtenGlobal) {
    const snap = backup.global[key];
    if (!snap) {
      log('[uninstall-restore] no snapshot for written key ' + key + ' — skipped');
      continue;
    }
    try {
      await opts.applyGlobal(key, snap.set ? snap.value : undefined);
      result.restoredGlobal.push(key);
    } catch (e) {
      result.errors.push('setting ' + key + ': ' + String(e));
    }
  }

  /* 2. workspace .vscode files — only the files the extension wrote */
  for (const rec of backup.writtenFiles) {
    if (!KNOWN_FILE_NAMES.includes(path.basename(rec.path))) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(backup.files, rec.path)) {
      log('[uninstall-restore] no snapshot for written file ' + rec.path + ' — skipped');
      continue;
    }
    const preText = backup.files[rec.path];
    try {
      const curText = await fsp.readFile(rec.path, 'utf8').catch(() => undefined);

      if (curText === undefined && preText === null) {
        continue; /* gone already — done */
      }

      let ops: FileOps;
      if (rec.kind === 'settings') {
        ops = computeSettingsRestoreOps(preText, curText ?? '', rec.keys);
      } else if (rec.kind === 'launch') {
        ops = computeConfigRestoreOps(preText, curText ?? '', 'configurations', 'name', LAUNCH_CONFIG_NAME);
      } else {
        ops = computeConfigRestoreOps(preText, curText ?? '', 'tasks', 'label', TASK_LABEL);
      }

      if (ops.deleteFile) {
        await fsp.rm(rec.path, { force: true });
        result.restoredFiles.push(rec.path + ' (deleted)');
      } else if (ops.changed) {
        await fsp.writeFile(rec.path, ops.text, 'utf8');
        result.restoredFiles.push(rec.path);
      } else {
        continue; /* already in the pre state */
      }
      for (const note of ops.notes) {
        log('[uninstall-restore] ' + path.basename(rec.path) + ': ' + note);
      }
      /* the v1.5.12 corrupt-file copy is redundant once the original is back */
      await fsp.rm(rec.path + CORRUPT_BACKUP_SUFFIX, { force: true });
    } catch (e) {
      result.errors.push('file ' + rec.path + ': ' + String(e));
    }
  }

  /* 3. success -> forget the backup (a later setup takes a fresh one) */
  if (result.errors.length === 0) {
    await fsp.rm(backupFilePath(backupDir), { force: true });
    await fsp.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  } else {
    log('[uninstall-restore] ' + result.errors.length + ' error(s) — backup kept for retry');
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* uninstall detection (deactivate vs shutdown vs update)              */
/* ------------------------------------------------------------------ */

/**
 * True when THIS deactivation is a real uninstall:
 *   1. our folder is marked in <extensionsRoot>/.obsolete (uninstall or
 *      update writes this before deactivate is called), AND
 *   2. no other version folder of this extension is still installed
 *      (an UPDATE marks the old version but installs the new one first), AND
 *   3. extensions.json (the authoritative installed list) no longer lists
 *      this exact folder — protects against a stale .obsolete entry.
 * Any read/parse problem returns false: never touch user settings on doubt.
 */
export async function isRealUninstall(
  extensionPath: string,
  idPrefix = 'mythos0-labs.graphics-h-runner-'
): Promise<boolean> {
  try {
    const extRoot = path.dirname(extensionPath);
    const myFolder = path.basename(extensionPath);

    let obsoleteRaw: string;
    try {
      obsoleteRaw = await fsp.readFile(path.join(extRoot, '.obsolete'), 'utf8');
    } catch {
      return false; /* no marker file -> plain shutdown/reload */
    }
    let obsolete: Record<string, unknown>;
    try {
      const parsed = JSON.parse(obsoleteRaw);
      if (!isObj(parsed)) {
        return false;
      }
      obsolete = parsed;
    } catch {
      return false;
    }
    const markedUs = Object.keys(obsolete).some(
      (k) => k.startsWith(idPrefix) && obsolete[k] === true
    );
    if (!markedUs) {
      return false;
    }

    /* update in progress? then another (new) version folder is live on disk */
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(extRoot);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (!entry.startsWith(idPrefix) || obsolete[entry] === true) {
        continue;
      }
      try {
        const st = await fsp.stat(path.join(extRoot, entry));
        if (st.isDirectory()) {
          return false; /* another installed version — this is an update */
        }
      } catch {
        /* vanished between readdir and stat — treat as not-live */
      }
    }

    /* stale-marker protection: the authoritative installed list must not
     * contain this exact folder anymore */
    try {
      const extJsonRaw = await fsp.readFile(path.join(extRoot, 'extensions.json'), 'utf8');
      const extJson = JSON.parse(extJsonRaw);
      if (Array.isArray(extJson)) {
        const stillInstalled = extJson.some(
          (e) =>
            isObj(e) &&
            isObj((e as Record<string, unknown>).identifier) &&
            (e as Record<string, unknown>).relativeLocation === myFolder
        );
        if (stillInstalled) {
          return false;
        }
      }
    } catch {
      /* unreadable extensions.json -> fall through to the marker verdict */
    }
    return true;
  } catch {
    return false;
  }
}

/** Sync read helper for the activation-time snapshot (small files only). */
export function readTextOrNull(file: string): string | null {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
