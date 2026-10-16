/**
 * scrub.ts — pure privacy scrubber for telemetry strings.
 *
 * v1.5.30: extracted from instrument.ts so PURE modules (toolchain.ts —
 * no 'vscode' import allowed there) can scrub compiler output BEFORE any
 * truncation. instrument.ts re-exports this function, so every existing
 * call site and test keeps working unchanged.
 *
 * Replace user-identifying path segments with `~`.
 *
 * v1.5.23 hardening (leaks seen in live events GRAPHICS-H-RUNNER-Q/Z):
 *  - usernames with SPACES ("C:\\Users\\Taha Pervaiz\\…") survived the old
 *    character class that stopped at whitespace — only "Taha" became ~;
 *  - forward-slash Windows forms ("/c:/Users/name/…", "c:/Users/name/…")
 *    escaped the backslash-only regex entirely;
 *  - the os.homedir() literal split missed case variants (c:\users\…).
 * The home-dir split is now a case-insensitive, separator-agnostic regex and
 * the Windows "Users\\<name>" segment allows spaces and both separators.
 */
import * as os from 'os';

export function scrubText(value: string): string {
  let out = String(value);
  try {
    const home = os.homedir();
    if (home && home.length > 3) {
      const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reHome = new RegExp(esc.replace(/\\{1,2}/g, '[\\\\/]'), 'gi');
      out = out.replace(reHome, '~');
    }
  } catch {
    /* ignore */
  }
  /* C:\Users\<name> | c:/Users/<name> | /c:/Users/<name> — spaces allowed in
   * <name>, stopped by any path separator (or end of string). The whole
   * "X:\Users\<sep>" prefix is captured and the NAME becomes `~`, so the
   * shape stays exactly C:\Users\~\… (the pre-1.5.23 shape the tests and
   * log readers know), for every separator style. */
  out = out.replace(/([A-Za-z]:[\\/]+[Uu]sers[\\/]+)[^\\/:*?"<>|]*/g, '$1~');
  out = out.replace(/(\/home\/)[^/\s]+/g, '$1~');
  return out;
}
