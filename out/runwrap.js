"use strict";
/**
 * runwrap.ts — run commands for the persistent runner terminal.
 *
 * v1.5.4: there is exactly ONE runner terminal, created once and reused for
 * every run ("use the same terminal always"). The compiled program is
 * started by TYPING its command line into that terminal's live shell
 * (terminal.sendText). The shell is the terminal's root process and never
 * exits, so the terminal — and every printf/cout line — stays open no
 * matter what the program does, and the next run reuses it right away.
 *
 * History: v1.5.1 ran plain console programs through a generated .cmd
 * "pause wrapper" because the program itself WAS the terminal's root
 * process and its exit closed the terminal; v1.5.3 extended that wrapper to
 * every program. But the wrapper was still the root process — answering its
 * "Press any key to close this window" prompt ended it, and VS Code closed
 * the whole terminal, output and all. v1.5.4 removes the wrapper entirely:
 * with a persistent shell there is nothing that needs keeping alive.
 *
 * Windows: the terminal runs an interactive cmd.exe (absolute ComSpec) and
 * we type    "<exe>" & echo [program finished]
 * — one quoted path plus a static echo. Static text only: on an interactive
 * line %ERRORLEVEL% expands at PARSE time and would print the PREVIOUS
 * command's code. Direct exe command (not a batch file) also means Ctrl+C
 * never raises the "Terminate batch job (Y/N)?" prompt.
 * POSIX: the terminal runs an interactive /bin/bash and we type
 *   '<exe>'; s=$?; echo "[program finished with exit code $s]"
 *
 * Pure module (string builders only): unit-testable.
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
exports.shQuote = shQuote;
exports.cmdRunLine = cmdRunLine;
exports.posixRunLine = posixRunLine;
exports.universalCommandDoc = universalCommandDoc;
exports.buildAnywhereReadme = buildAnywhereReadme;
const os = __importStar(require("os"));
/** POSIX sh quoting (single-quote style, safe for arbitrary paths). */
function shQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
/**
 * The line typed into the persistent cmd.exe terminal to run one program:
 * the quoted exe (a DIRECT command — not a batch file, so Ctrl+C kills it
 * cleanly) followed by a static finished marker. The prompt returning after
 * this line IS the visible "program ended" signal, and the terminal stays.
 */
function cmdRunLine(exePath) {
    return '"' + exePath + '" & echo [program finished]';
}
/** The line typed into the persistent /bin/bash terminal (POSIX). */
function posixRunLine(exePath) {
    return shQuote(exePath) + '; s=$?; echo "[program finished with exit code $s]"';
}
/** The exact global compile command shown to students (all platforms). */
function universalCommandDoc() {
    return 'g++ program.cpp -o program.exe -lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32';
}
/** The readme dropped into the toolchain root by the global setup step. */
function buildAnywhereReadme(binDir) {
    return [
        'graphics.h Runner - GLOBAL setup (works without the extension)',
        '==============================================================',
        '',
        'This toolchain folder now contains WinBGIM in its own include/lib',
        'folders, and its bin folder was added to your user PATH:',
        '  ' + binDir,
        '',
        'Compile & run a graphics.h program from ANY terminal (cmd.exe,',
        'PowerShell, Dev-C++, Code::Blocks, CLion, ...):',
        '',
        '  ' + universalCommandDoc().replace('.exe', os.platform() === 'win32' ? '.exe' : ''),
        '',
        'On Linux/macOS the equivalent one-liner is:',
        '  g++ program.cpp -o program -lSDL_bgi -lSDL2 -lm',
        '',
        'To REMOVE the global setup, delete graphics.h / winbgim.h from',
        'include\\ and libbgi.a from lib\\ and remove the bin folder from',
        'your user PATH environment variable.',
        ''
    ].join('\r\n');
}
//# sourceMappingURL=runwrap.js.map