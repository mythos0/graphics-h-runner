"use strict";
/**
 * toolchain.ts — platform detection helpers.
 * Pure module: no vscode imports, so it can be unit-tested in plain Node.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentPlatform = currentPlatform;
exports.defaultCompilerPath = defaultCompilerPath;
exports.isCppSourceFile = isCppSourceFile;
exports.binaryPathFor = binaryPathFor;
exports.smartCompilerTail = smartCompilerTail;
function currentPlatform() {
    switch (process.platform) {
        case 'win32':
            return 'windows';
        case 'linux':
            return 'linux';
        case 'darwin':
            return 'macos';
        default:
            return 'unknown';
    }
}
/** Default compiler binary name per platform. */
function defaultCompilerPath(platform) {
    return 'g++';
}
/** True when the file looks like a compilable C/C++ source file. */
function isCppSourceFile(fileName) {
    return /\.(cpp|cxx|cc|c\+\+|c)$/i.test(fileName);
}
/** Path of the binary produced after compiling sourceFile on the given platform. */
function binaryPathFor(sourceFile, platform) {
    const ext = platform === 'windows' ? '.exe' : '';
    const noExt = sourceFile.replace(/\.(cpp|cxx|cc|c\+\+|c)$/i, '');
    return noExt + ext;
}
/**
 * v1.5.25 (Sentry round 2): ONE smart extractor for the useful part of a
 * compiler invocation's output. The v1.5.24 events still arrived blind:
 * the link-probe and global-probe tails took the LAST stderr line only,
 * which is EMPTY whenever the compiler crashed silently or wrote to
 * stdout ("probe with C:\msys64\mingw64\include failed (exit 1):"), and
 * the Setup Doctor fell back to execFile's "Command failed: <the whole
 * command>" message whose 300-char budget ran out before any useful
 * character. This helper:
 *   1. prefers lines that actually carry diagnostics (error/undefined
 *      reference/fatal/cannot find/skipping incompatible/permission…),
 *   2. falls back to the LAST stderr lines, then the LAST stdout lines,
 *   3. deduplicates and keeps the tail of the join,
 *   4. NEVER returns an empty string — silence itself is the diagnosis
 *      ("exit N with no compiler output" points at antivirus interference
 *      or a crashed process, which is exactly what the live machines hit).
 */
function smartCompilerTail(stderr, stdout, exitCode, maxChars = 300) {
    const lines = (s) => String(s || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const errLines = lines(stderr);
    const outLines = lines(stdout);
    const PRIORITY = /error|undefined reference|fatal|No such file|cannot find|skipping incompatible|cannot execute|Permission denied|is not recognized|access is denied|being used by another process|Program '.*' failed/i;
    const picked = [];
    const push = (l) => {
        if (picked.indexOf(l) === -1) {
            picked.push(l);
        }
    };
    errLines.filter((l) => PRIORITY.test(l)).forEach(push);
    errLines.slice(-2).forEach(push);
    if (picked.length === 0) {
        outLines.filter((l) => PRIORITY.test(l)).forEach(push);
        outLines.slice(-1).forEach(push);
    }
    const joined = picked.join(' | ');
    if (joined) {
        return joined.length > maxChars ? joined.slice(-maxChars) : joined;
    }
    return `exit ${exitCode} with no compiler output (possible antivirus interference or a crashed process)`;
}
//# sourceMappingURL=toolchain.js.map