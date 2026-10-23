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
  /* v1.5.31 (GRAPHICS-H-RUNNER-K on 1.5.30 — the detail tags arrived as
   * "sal/AppData/…" and "…/ld.exe: cannot find Shyam/AppData/…" with RAW
   * usernames): two real-world shapes the rules above still miss.
   *
   * 1. MSYS/Git-Bash drive-less form "/c/Users/<name>/…" — there is NO
   *    "X:" colon, so the drive rule cannot match, and the home-dir split
   *    cannot either (the text never contains the homedir literal).
   * 2. PREFIX-LESS FRAGMENTS — a tail cut that landed mid-path destroys
   *    the "C:/Users/" anchor BEFORE this scrub ever sees the string, and
   *    no prefix rule can match a fragment that no longer has a prefix.
   *    AppData is itself a reliable anchor: on every Windows profile path
   *    the segment immediately before \AppData\ is the user name (or the
   *    cut tail of one). The rule fires only when that segment is a word
   *    fragment — the scrubbed "~" is deliberately OUTSIDE the class, so
   *    healthy "C:\Users\~\AppData\…" shapes pass through unchanged. */
  out = out.replace(/(\/[A-Za-z]\/[Uu]sers[\\/]+)[^\\/:*?"<>|]*/g, '$1~');
  out = out.replace(/([\w.@ -]{1,80})[\\/]AppData[\\/](?=Local\b|Roaming\b|LocalLow\b)/g, '~/AppData/');
  return out;
}
