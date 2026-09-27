/**
 * depsAudit.ts — post-compile dependency audit for Windows executables.
 *
 * The classic silent killer on student PCs: a compiled .exe that needs a
 * MinGW runtime DLL (libstdc++-6.dll, libgcc_s_seh-1.dll, libwinpthread-1.dll,
 * zlib1.dll, ...) which exists only inside the compiler folder. Windows then
 * kills the process with exit code -1073741515 (0xC0000135
 * STATUS_DLL_NOT_FOUND) and VS Code shows "The terminal process ... failed
 * to launch" — before main() runs a single line. The extension statically
 * links by default (buildArgs.ts), so this audit is a SAFETY NET: after every
 * successful Windows build it scans the exe for DLL names that are not part
 * of base Windows, so the problem surfaces AT COMPILE TIME with an
 * actionable message instead of at run time with a hex code.
 *
 * DLL import names are stored as plain ASCII inside the PE import table, so
 * scanning the raw file catches every real import; we only ever *act* on the
 * known runtime-DLL names to keep false positives away.
 *
 * Pure module: no vscode imports, unit-testable in plain Node.
 */

import * as fs from 'fs';

/** DLLs that ship with every Windows 10/11 installation. */
const WINDOWS_SYSTEM_DLLS = new Set<string>([
  'advapi32.dll', 'apphelp.dll', 'authz.dll', 'bcrypt.dll', 'bcryptprimitives.dll',
  'comctl32.dll', 'comdlg32.dll', 'crypt32.dll', 'cryptbase.dll', 'cryptsp.dll',
  'd3d11.dll', 'dnsapi.dll', 'dwmapi.dll', 'dxgi.dll', 'gdi32.dll',
  'imm32.dll', 'iphlpapi.dll', 'kernel32.dll', 'ksuser.dll', 'msimg32.dll',
  'msvcp_win.dll', 'msvcrt.dll', 'netapi32.dll', 'ntdll.dll', 'ole32.dll',
  'oleaut32.dll', 'opengl32.dll', 'powrprof.dll', 'propsys.dll', 'rpcrt4.dll',
  'sechost.dll', 'setupapi.dll', 'shcore.dll', 'shell32.dll', 'shlwapi.dll',
  'ucrtbase.dll', 'user32.dll', 'uxtheme.dll', 'version.dll', 'win32u.dll',
  'winmm.dll', 'winspool.drv', 'winsta.dll', 'wintrust.dll', 'ws2_32.dll',
  'wtsapi32.dll', 'normaliz.dll', 'psapi.dll', 'sfc_os.dll'
]);

/** UCRT API-set forwarders — present on every Windows 10/11. */
function isApiSet(name: string): boolean {
  return /^api-ms-win-/i.test(name) || /^ext-ms-/i.test(name);
}

/**
 * MinGW / MSVC runtime DLLs that are NOT guaranteed to exist on a student
 * PC. If one of these shows up in the import table, the exe will fail to
 * launch with 0xC0000135 on machines without the compiler in PATH.
 */
export const RUNTIME_DLL_PATTERNS: RegExp[] = [
  /^libstdc\+\+-[0-9]+\.dll$/i,
  /^libgcc_s_(seh|dw2|sjlj)(-[0-9]+)?\.dll$/i,
  /^libwinpthread(-[0-9]+)?\.dll$/i,
  /^zlib1\.dll$/i,
  /^liblzma(-[0-9]+)?\.dll$/i,
  /^libzstd\.dll$/i,
  /^libbrotli(dec|enc|common)?\.dll$/i,
  /^libgcc[_0-9a-z]*\.dll$/i,
  /^msvcp(60|70|71|80|90|100|110|120|140|140_1|140_2)(_d)?\.dll$/i,
  /^vcruntime(40|90|110|120|140|140_1)(_d)?\.dll$/i,
  /^concrt140(_d)?\.dll$/i
];

export interface DepsAuditResult {
  /** exe size in bytes */
  bytes: number;
  /** every *.dll name found in the file (lowercase, unique, sorted) */
  imports: string[];
  /** imports that are NOT part of base Windows (the dangerous ones) */
  missing: string[];
  ok: boolean;
}

/** Pull every `*.dll`-looking ASCII token out of a PE image. */
export function extractDllNames(buf: Buffer): string[] {
  const found = new Set<string>();
  const s = buf.toString('latin1');
  const re = /[A-Za-z0-9_+\-.]+\.dll\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    found.add(m[0].toLowerCase());
    if (found.size > 512) {
      break; /* pathological binary — do not scan forever */
    }
  }
  return Array.from(found).sort();
}

export function auditExeBuffer(buf: Buffer): DepsAuditResult {
  const imports = extractDllNames(buf);
  const missing = imports.filter((n) => {
    if (WINDOWS_SYSTEM_DLLS.has(n) || isApiSet(n)) {
      return false;
    }
    return true;
  });
  return { bytes: buf.length, imports, missing, ok: missing.length === 0 };
}

/**
 * Audit a compiled Windows exe. Returns null when the file cannot be read
 * (audit must never break the build flow).
 */
export function auditWindowsExe(exePath: string): DepsAuditResult | null {
  try {
    const st = fs.statSync(exePath);
    if (!st.isFile() || st.size === 0 || st.size > 96 * 1024 * 1024) {
      return null;
    }
    return auditExeBuffer(fs.readFileSync(exePath));
  } catch {
    return null;
  }
}

/** Human-readable, actionable warning text for a failed audit. */
export function buildAuditMessage(res: DepsAuditResult, exeName: string): string {
  return (
    exeName + ' imports ' + res.missing.join(', ') +
    ', which are NOT part of Windows. On PCs without MinGW in PATH the program ' +
    'fails to launch with exit code -1073741515 (0xc0000135 DLL not found). ' +
    'Fix: keep "graphics-h-runner.staticLinkWindows" enabled (adds -static) and ' +
    'rebuild — or copy the DLL(s) from the compiler bin folder next to the .exe.'
  );
}
