/**
 * toolchain.ts — platform detection helpers.
 * Pure module: no vscode imports, so it can be unit-tested in plain Node.
 */

export type Platform = 'windows' | 'linux' | 'macos' | 'unknown';

export function currentPlatform(): Platform {
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
export function defaultCompilerPath(platform: Platform): string {
  return 'g++';
}

/** True when the file looks like a compilable C/C++ source file. */
export function isCppSourceFile(fileName: string): boolean {
  return /\.(cpp|cxx|cc|c\+\+|c)$/i.test(fileName);
}

/** Path of the binary produced after compiling sourceFile on the given platform. */
export function binaryPathFor(sourceFile: string, platform: Platform): string {
  const ext = platform === 'windows' ? '.exe' : '';
  const noExt = sourceFile.replace(/\.(cpp|cxx|cc|c\+\+|c)$/i, '');
  return noExt + ext;
}
