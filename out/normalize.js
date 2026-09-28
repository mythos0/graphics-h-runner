"use strict";
/**
 * normalize.ts — heals "messy settings" before they reach the compiler.
 *
 * Everything here is pure Node (no vscode) and unit-testable. The extension
 * runs every user-supplied path through this module, because real-world PCs
 * produce settings like:
 *
 *   "C:\MinGW\bin\g++.exe"          <- pasted WITH quotes
 *   C:\MinGW\bin\                   <- trailing slash / backslash
 *   C:/MinGW/bin/g++.exe            <- forward slashes (fine, but tidy)
 *   C:\MinGW\bin                    <- directory instead of the exe
 *   C:\MinGW\bin\g++                <- missing .exe suffix (Windows)
 *   %MINGW64%\bin\g++.exe           <- Windows environment variables
 *   ~/sdlbgi/usr/include            <- POSIX home shorthand
 *   ${HOME}/sdlbgi/usr/include      <- POSIX variable form
 *   'C:\Users\O'Brien\...'         <- single quotes
 *
 * plus stale paths left behind by old installs (globalStorage wiped, moved
 * toolchains). gcc ignores dead -I/-L dirs, but dead entries pile up and make
 * diagnostics confusing, so the setup flow prunes them.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripQuotes = stripQuotes;
exports.expandEnvVars = expandEnvVars;
exports.normalizeDirEntry = normalizeDirEntry;
exports.normalizeDirList = normalizeDirList;
exports.pruneMissingDirs = pruneMissingDirs;
exports.normalizeCompilerPath = normalizeCompilerPath;
exports.classifySpawnFailure = classifySpawnFailure;
/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
/** Strip one pair of wrapping single/double quotes, if present. */
function stripQuotes(raw) {
    let s = raw.trim();
    for (;;) {
        if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
            s = s.slice(1, -1).trim();
            continue;
        }
        /* Windows "copy as path" double-quoting: ""C:\x"" */
        if (s.length >= 4 && s.startsWith('""') && s.endsWith('""')) {
            s = s.slice(2, -2).trim();
            continue;
        }
        return s;
    }
}
/** Expand %VAR% (Windows) and $VAR / ${VAR} (POSIX) against `env`. */
function expandEnvVars(raw, env, platform) {
    let out = raw;
    if (platform === 'windows') {
        out = out.replace(/%([^%]+)%/g, (whole, name) => {
            const v = env[name] ?? env[name.toUpperCase()];
            return v !== undefined && v !== '' ? v : whole;
        });
    }
    out = out.replace(/\$\{([^}]+)\}/g, (whole, name) => {
        const v = env[name] ?? (platform !== 'windows' ? env[name.toUpperCase()] : undefined);
        return v !== undefined && v !== '' ? v : whole;
    });
    out = out.replace(/(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name) => {
        const v = env[name] ?? (platform !== 'windows' ? env[name.toUpperCase()] : undefined);
        return v !== undefined && v !== '' ? v : whole;
    });
    return out;
}
function stripTrailingSeparators(p) {
    const stripped = p.replace(/[\\/]+$/, '');
    if (/^[A-Za-z]:$/.test(stripped)) {
        /* "C:" / "C:\\" / "C:/" all normalize to the drive root "C:\\" */
        return /^[A-Za-z]:\\$/.test(p) ? p : stripped + '\\';
    }
    return stripped;
}
function defaultPlatform() {
    return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}
/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */
/**
 * Heal a directory entry (extraIncludePaths / extraLibPaths items):
 * quotes, env vars, ~, trailing separators. Returns '' for empty input.
 * Does NOT require the directory to exist (use pruneMissingDirs for that).
 */
function normalizeDirEntry(raw, opts = {}) {
    const platform = opts.platform ?? defaultPlatform();
    const env = opts.env ?? process.env;
    const home = opts.home ?? '';
    let s = stripQuotes(String(raw ?? ''));
    s = expandEnvVars(s, env, platform);
    if (home && (s === '~' || s.startsWith('~/') || s.startsWith('~\\'))) {
        s = path_join2(home, s.slice(1));
    }
    s = stripTrailingSeparators(s.trim());
    return s;
}
/* tiny local join to stay dependency-light in tests */
function path_join2(a, b) {
    const sep = b.includes('\\') || /^[A-Za-z]:/.test(a) ? '\\' : '/';
    return a.replace(/[\\/]+$/, '') + sep + b.replace(/^[\\/]+/, '');
}
/**
 * Heal the full include/lib path list: normalize entries, drop empties and
 * de-duplicate (case-insensitively on Windows, where paths are case-insensitive).
 */
function normalizeDirList(list, opts = {}) {
    const platform = opts.platform ?? defaultPlatform();
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
        const n = normalizeDirEntry(item, opts);
        if (!n)
            continue;
        const key = platform === 'windows' ? n.toLowerCase() : n;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(n);
    }
    return out;
}
/** Remove entries whose directory does not exist (stale installs). */
function pruneMissingDirs(list, opts = {}) {
    const exists = opts.exists ?? defaultExists;
    return (list || []).filter((p) => {
        try {
            return p.length > 0 && exists(p);
        }
        catch {
            return false;
        }
    });
}
function defaultExists(p) {
    // lazily required so pure tests can inject their own probe
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    return fs.existsSync(p);
}
/**
 * Heal the compiler path setting into something spawn() can actually run.
 *   - strips quotes / whitespace / env vars / ~
 *   - a directory becomes <dir>\g++.exe (Windows) or <dir>/g++ (POSIX)
 *   - on Windows, an extension-less absolute path gets .exe appended when
 *     only the .exe variant exists
 *   - plain names (g++, g++.exe, clang++) are returned untouched (PATH lookup)
 */
function normalizeCompilerPath(raw, opts = {}) {
    const platform = opts.platform ?? ('win32' === process.platform ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux');
    const exists = opts.exists ?? defaultExists;
    const env = opts.env ?? process.env;
    let s = stripQuotes(String(raw ?? ''));
    s = expandEnvVars(s, env, platform);
    if (s.startsWith('~')) {
        const home = opts.home ?? '';
        if (home) {
            s = path_join2(home, s.slice(1));
        }
    }
    s = s.trim();
    if (!s) {
        return '';
    }
    const hasSep = /[\\/]/.test(s);
    /* directory -> append compiler binary name (even when the exe inside is
     * missing: spawning <dir>\g++.exe yields a clean ENOENT -> one-click setup,
     * while spawning the directory itself yields a confusing EACCES/failed) */
    if (hasSep || /^[A-Za-z]:$/.test(s)) {
        const trimmed = stripTrailingSeparators(s);
        const lastSeg = trimmed.split(/[\\/]/).pop() || '';
        const hasExtension = /\.[A-Za-z0-9]+$/.test(lastSeg);
        const compilerNamed = looksLikeCompilerBinary(lastSeg);
        const exeName = platform === 'windows' ? 'g++.exe' : 'g++';
        if (platform === 'windows') {
            /* Extension-less last segment ("...\bin", "...\mingw64", "C:\") is
             * directory shaped — resolve it to g++.exe regardless of whether we
             * can stat it (the dir may exist but be unreadable, or this probe may
             * run before the dir exists). Full exe names pass through. */
            if (!hasExtension && !compilerNamed) {
                return /[\\/]$/.test(trimmed) ? trimmed + exeName : trimmed + '\\' + exeName;
            }
            if (!fsExists(trimmed, exists) && fsExists(trimmed + '.exe', exists)) {
                return trimmed + '.exe';
            }
            return trimmed;
        }
        /* POSIX: append only when it is really directory-shaped */
        if (/[\\/]$/.test(s) || isDirectory(trimmed, exists)) {
            return trimmed + '/' + exeName;
        }
        return trimmed;
    }
    /* bare name or bare drive-relative like "g++.exe" — leave for PATH lookup */
    return s;
}
function fsExists(p, exists) {
    try {
        return exists(p);
    }
    catch {
        return false;
    }
}
/** "g++", "g++.exe", "clang++", "cc", "gcc" — file references, never dirs. */
function looksLikeCompilerBinary(lastSeg) {
    return /\+/.test(lastSeg) || /^(cc|gcc|clang)(\.exe)?$/i.test(lastSeg);
}
function isDirectory(p, exists) {
    try {
        if (!exists(p)) {
            return false;
        }
        const fs = require('fs');
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Map a compile spawn outcome to a user-facing class.
 * Windows ENOENT shows up as error code 'ENOENT' OR as a close code of
 * -4058 (and older runtimes even surface both) — both must map to
 * "no compiler" so the user gets the one-click setup dialog instead of a
 * raw compile error.
 */
function classifySpawnFailure(info) {
    const platform = info.platform ?? defaultPlatform();
    if (info.errorCode === 'ENOENT') {
        return 'no-compiler';
    }
    if (platform === 'windows' && typeof info.closeCode === 'number' && info.closeCode === -4058) {
        return 'no-compiler';
    }
    return 'failed';
}
//# sourceMappingURL=normalize.js.map