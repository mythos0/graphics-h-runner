"use strict";
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
exports.scrubText = scrubText;
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
const os = __importStar(require("os"));
function scrubText(value) {
    let out = String(value);
    try {
        const home = os.homedir();
        if (home && home.length > 3) {
            const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const reHome = new RegExp(esc.replace(/\\{1,2}/g, '[\\\\/]'), 'gi');
            out = out.replace(reHome, '~');
        }
    }
    catch {
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
//# sourceMappingURL=scrub.js.map