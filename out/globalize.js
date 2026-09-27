"use strict";
/**
 * globalize.ts — "make graphics.h work ANYWHERE" (global) setup.
 *
 * v1.5.1 major feature requested by users: after "Complete Run Setup" the
 * toolchain must serve the WHOLE machine, not just this extension. Concretely,
 * on Windows:
 *   1. WinBGIM (graphics.h, winbgim.h, libbgi.a) is copied into the compiler
 *      toolchain's OWN include/lib folders — MinGW resolves them with zero
 *      -I/-L flags, so `g++ main.cpp -o main.exe -lbgi ...` works from any
 *      terminal, IDE or build script.
 *   2. The toolchain's bin folder is appended to the USER PATH in the
 *      registry (HKCU\Environment\Path, REG_EXPAND_SZ preserved, idempotent),
 *      with a best-effort WM_SETTINGCHANGE broadcast so new processes see it.
 *   3. A probe compile WITHOUT any extension settings verifies the result:
 *      only a real `#include <graphics.h>` + `-lbgi` build proves "global".
 *   4. A small readme with the universal command lands in the toolchain root.
 *
 * Everything is idempotent and per-user (no admin rights). Pure Node module
 * with an injectable process runner, so the whole flow is unit-testable.
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
exports.defaultRunner = void 0;
exports.computeGlobalTargets = computeGlobalTargets;
exports.parseRegQueryPath = parseRegQueryPath;
exports.appendPathEntry = appendPathEntry;
exports.makeGlobalWindows = makeGlobalWindows;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const runwrap_1 = require("./runwrap");
const defaultRunner = (cmd, args, timeoutMs = 30000) => new Promise((resolve) => {
    (0, child_process_1.execFile)(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const anyErr = err;
        resolve({
            code: err ? (typeof anyErr?.code === 'number' ? anyErr.code : -1) : 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || '')
        });
    });
});
exports.defaultRunner = defaultRunner;
/**
 * Derive where WinBGIM must land so the compiler finds it WITHOUT flags.
 * WinLibs / MSYS2 / Code::Blocks / TDM all follow <root>/bin/g++ with
 * <root>/include + <root>/lib (MSYS2 additionally mirrors <root>/<triplet>).
 */
function computeGlobalTargets(compilerPath) {
    const binDir = path.dirname(path.resolve(compilerPath));
    const toolchainRoot = path.dirname(binDir);
    const m = /((?:x86_64|i686)-w64-mingw32)/i.exec(compilerPath);
    const triplet = m ? m[1] : null;
    const includeCandidates = [path.join(toolchainRoot, 'include')];
    const libCandidates = [path.join(toolchainRoot, 'lib')];
    if (triplet) {
        includeCandidates.push(path.join(toolchainRoot, triplet, 'include'));
        libCandidates.push(path.join(toolchainRoot, triplet, 'lib'));
    }
    return { binDir, toolchainRoot, includeCandidates, libCandidates, triplet };
}
/** Extract the raw (unexpanded) value from `reg query HKCU\Environment /v Path`. */
function parseRegQueryPath(stdout) {
    const m = /^[ \t]*Path[ \t]+REG_(?:EXPAND_)?SZ[ \t]+(.*)$/im.exec(stdout || '');
    return m ? m[1].trimEnd() : null;
}
/**
 * Append one entry to a raw PATH string. Idempotent (case-insensitive,
 * trailing-backslash-insensitive), order-preserving, semicolon-safe.
 */
function appendPathEntry(raw, dir) {
    const wanted = path.normalize(dir).replace(/[\\/]+$/, '').toLowerCase();
    const entries = raw === null
        ? []
        : raw
            .split(';')
            .map((e) => e.trim())
            .filter((e) => e.length > 0);
    const exists = entries.some((e) => path.normalize(e).replace(/[\\/]+$/, '').toLowerCase() === wanted);
    if (exists) {
        return { next: entries.join(';'), changed: false };
    }
    entries.push(dir);
    return { next: entries.join(';'), changed: true };
}
const GLOBAL_PROBE_SOURCE = '#include <graphics.h>\n\nint main ( ) { circle ( 100, 100, 50 ); return 0; }\n';
/**
 * Full Windows global-setup flow. Idempotent: re-running refreshes the
 * copies, keeps the PATH entry unique and re-verifies with a probe compile.
 */
async function makeGlobalWindows(opts) {
    const runner = opts.runner || exports.defaultRunner;
    const log = [];
    const say = (l) => {
        log.push(l);
        try {
            opts.onLog?.(l);
        }
        catch {
            /* progress callbacks must never crash the setup */
        }
    };
    const gfx = path.join(opts.includeDir, 'graphics.h');
    const wbh = path.join(opts.includeDir, 'winbgim.h');
    const lib = path.join(opts.libDir, 'libbgi.a');
    for (const f of [gfx, wbh, lib]) {
        if (!fs.existsSync(f)) {
            throw new Error('WinBGIM file missing: ' + f + ' — run the WinBGIM setup step first');
        }
    }
    const targets = computeGlobalTargets(opts.compilerPath);
    say('toolchain root: ' + targets.toolchainRoot);
    /* 1. copy the trio into the toolchain's own include/lib, probe-compile
     *    with ZERO -I/-L flags; on failure try the next layout candidate. */
    let globalProbeOk = false;
    let includeTarget;
    let libTarget;
    for (let i = 0; i < targets.includeCandidates.length && !globalProbeOk; i++) {
        const incDir = targets.includeCandidates[i];
        const libDir = targets.libCandidates[i];
        try {
            fs.mkdirSync(incDir, { recursive: true });
            fs.mkdirSync(libDir, { recursive: true });
            if (path.resolve(incDir) !== path.resolve(opts.includeDir)) {
                fs.copyFileSync(gfx, path.join(incDir, 'graphics.h'));
                fs.copyFileSync(wbh, path.join(incDir, 'winbgim.h'));
            }
            if (path.resolve(libDir) !== path.resolve(opts.libDir)) {
                fs.copyFileSync(lib, path.join(libDir, 'libbgi.a'));
            }
        }
        catch (e) {
            say('copy into ' + incDir + ' failed: ' + String(e));
            continue;
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgi-global-'));
        try {
            const srcPath = path.join(dir, 'global_probe.cpp');
            const outPath = path.join(dir, 'global_probe.exe');
            fs.writeFileSync(srcPath, GLOBAL_PROBE_SOURCE);
            const res = await runner(opts.compilerPath, [
                srcPath,
                '-o',
                outPath,
                '-lbgi',
                '-lgdi32',
                '-lcomdlg32',
                '-luuid',
                '-loleaut32',
                '-lole32'
            ], 60000);
            if (res.code === 0) {
                globalProbeOk = true;
                includeTarget = incDir;
                libTarget = libDir;
                say('probe compile WITHOUT -I/-L flags: OK (headers: ' + incDir + ')');
            }
            else {
                say('probe with ' + incDir + ' failed (exit ' + res.code + '): ' + res.stderr.trim().split(/\r?\n/).slice(-1)[0].slice(0, 200));
            }
        }
        catch (e) {
            say('probe crashed: ' + String(e));
        }
        finally {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            }
            catch {
                /* ignore */
            }
        }
    }
    /* 2. user PATH += <binDir> (registry, idempotent, REG_EXPAND_SZ kept) */
    let pathOk = false;
    let pathChanged = false;
    try {
        const q = await runner('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], 15000);
        const raw = q.code === 0 ? parseRegQueryPath(q.stdout) : null;
        const { next, changed } = appendPathEntry(raw, targets.binDir);
        if (!changed) {
            pathOk = true;
            say('user PATH already contains ' + targets.binDir);
        }
        else {
            const add = await runner('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', next, '/f'], 15000);
            pathOk = add.code === 0;
            pathChanged = pathOk;
            say(pathOk ? 'user PATH updated (+ ' + targets.binDir + ')' : 'reg add failed (exit ' + add.code + '): ' + add.stderr.trim().slice(0, 200));
        }
    }
    catch (e) {
        say('PATH update skipped: ' + String(e));
    }
    /* 3. best-effort WM_SETTINGCHANGE so freshly started apps see the new PATH */
    if (pathChanged) {
        const ps = "$sig='[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);';" +
            '$t=Add-Type -MemberDefinition $sig -Name GhrEnv -Namespace Win32 -PassThru;' +
            '[UIntPtr]$r=[UIntPtr]::Zero;' +
            "$t::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r)|Out-Null";
        try {
            const b = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 20000);
            say(b.code === 0 ? 'environment change broadcast sent' : 'broadcast failed (non-fatal, exit ' + b.code + ')');
        }
        catch (e) {
            say('broadcast skipped: ' + String(e));
        }
    }
    /* 4. readme with the universal command (best effort) */
    try {
        fs.writeFileSync(path.join(targets.toolchainRoot, 'graphics-h-anywhere.txt'), (0, runwrap_1.buildAnywhereReadme)(targets.binDir), 'utf8');
        say('readme written: ' + path.join(targets.toolchainRoot, 'graphics-h-anywhere.txt'));
    }
    catch (e) {
        say('readme skipped: ' + String(e));
    }
    return {
        globalProbeOk,
        pathOk,
        pathChanged,
        includeTarget,
        libTarget,
        universalCommand: (0, runwrap_1.universalCommandDoc)(),
        log
    };
}
//# sourceMappingURL=globalize.js.map