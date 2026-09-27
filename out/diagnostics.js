"use strict";
/**
 * diagnostics.ts — turn raw g++/gcc console output into VS Code diagnostics.
 *
 * Compile errors used to be visible only in the output channel; now they also
 * light up the Problems panel with clickable file:line entries and inline
 * squiggles, like a real C++ toolchain integration.
 *
 * Pure functions, unit-testable: no vscode import.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCompilerOutput = parseCompilerOutput;
exports.capCompilerDiagnostics = capCompilerDiagnostics;
/**
 * Matches GCC-style diagnostic lines:
 *   main.cpp:12:5: error: 'x' was not declared in this scope
 *   main.cpp:12: warning: unused variable 'y'          (no column — older GCC)
 *   C:\dir\main.cpp:12:5: fatal error: foo.h: No such file or directory
 * Deliberately NOT matched (no file:line to act on):
 *   collect2.exe: error: ld returned 1 exit status
 *   /usr/bin/ld: main.cpp:(.text+0x11): undefined reference to `foo'
 *   In file included from /usr/include/SDL_bgi.h:312: ...
 */
const DIAG_LINE_RE = /^\s*(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+?)\s*$/;
function parseCompilerOutput(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const m = DIAG_LINE_RE.exec(raw);
        if (!m) {
            continue;
        }
        const line = parseInt(m[2], 10);
        if (!Number.isFinite(line) || line <= 0) {
            continue;
        }
        const colRaw = m[3] !== undefined ? parseInt(m[3], 10) : NaN;
        const col = Number.isFinite(colRaw) ? colRaw : null;
        const token = m[4];
        out.push({
            file: m[1].trim(),
            line,
            column: col,
            severity: token === 'warning' ? 'warning' : token === 'note' ? 'note' : 'error',
            message: m[5].trim()
        });
        if (out.length >= 1000) {
            break; /* pathological-output guard */
        }
    }
    return out;
}
/** Drop exact duplicates and cap the list so the Problems panel stays snappy. */
function capCompilerDiagnostics(list, max = 200) {
    const seen = new Set();
    const out = [];
    for (const d of list) {
        const key = `${d.file}|${d.line}|${d.column}|${d.severity}|${d.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(d);
        if (out.length >= max) {
            break;
        }
    }
    return out;
}
//# sourceMappingURL=diagnostics.js.map