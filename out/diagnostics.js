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
exports.looksLikeBgiLinkFailure = looksLikeBgiLinkFailure;
exports.pickErrorHeaders = pickErrorHeaders;
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
/* ------------------------------------------------------------------ */
/* v1.5.6 — BGI link-failure signature ("works on my PC" killer)        */
/* ------------------------------------------------------------------ */
/**
 * The graphics functions WinBGIM/SDL_bgi/libgraph provide. When a LINK
 * fails with "undefined reference" to any of these, the graphics library
 * itself could not be connected to the program — the classic cause is a
 * compiler that cannot use the installed library (e.g. the legacy 32-bit
 * MinGW.org g++ with the 64-bit libbgi.a: its ld silently skips the
 * incompatible archive and every graphics symbol comes out unresolved).
 */
const BGI_SYMBOLS_RE = /undefined reference to [`'](?:initwindow|initgraph|closegraph|cleardevice|circle|line|rectangle|bar|putpixel|getpixel|outtextxy|setcolor|setbkcolor|setfillstyle|fillellipse|settextstyle|getmaxx|getmaxy|delay|kbhit|getch|ismouseclick|getmouseclick|clearmouseclick|mousex|mousey)[`']/;
/** `C:\Users\...\Temp\ccABC123.o:` / `/tmp/ccABC123.o:` object-file prefix. */
const TEMP_OBJECT_PREFIX_RE = /^.*(?:[/\\]\.o|\.o):/;
/**
 * True when the compiler output says the graphics library could not be
 * linked (undefined references to BGI symbols). Used to turn the scary
 * wall of linker errors into one actionable explanation + fix.
 */
function looksLikeBgiLinkFailure(compilerText) {
    return BGI_SYMBOLS_RE.test(String(compilerText || ''));
}
/**
 * Pick the most useful error "headers" for the big-font error overlay:
 * real `file:line:col: error: …` lines first, then linker errors, deduped,
 * with temp object-file prefixes stripped (`ccXyZ.o:main.cpp:(...)` ->
 * `main.cpp:(...)`). At most `max` lines, each capped to `maxLen` chars.
 */
function pickErrorHeaders(compilerText, max = 3, maxLen = 120) {
    const lines = String(compilerText || '').split(/\r?\n/);
    const headerLines = lines.filter((l) => /:\s+(fatal error|error):/i.test(l) || /undefined reference to/.test(l));
    const seen = new Set();
    const out = [];
    for (const raw of headerLines) {
        const line = raw.replace(TEMP_OBJECT_PREFIX_RE, '').trim();
        if (!line || line.length < 8) {
            continue;
        }
        const key = line.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(line.length > maxLen ? line.slice(0, maxLen - 1) + '…' : line);
        if (out.length >= max) {
            break;
        }
    }
    return out;
}
//# sourceMappingURL=diagnostics.js.map