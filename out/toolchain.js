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
//# sourceMappingURL=toolchain.js.map