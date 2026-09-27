"use strict";
/**
 * depsAudit.ts — post-compile dependency audit for Windows executables.
 *
 * The classic silent killer on student PCs: a compiled .exe that needs a
 * MinGW runtime DLL (libstdc++-6.dll, libgcc_s_seh-1.dll,
 * libwinpthread-1.dll, zlib1.dll, ...) which exists only inside the
 * compiler folder. Windows kills the process with exit code -1073741515
 * (0xC0000135 STATUS_DLL_NOT_FOUND) before main() runs a single line. The
 * extension statically links by default (buildArgs.ts), so this audit is a
 * SAFETY NET: after every successful Windows build it reports the DLLs the
 * exe actually imports, so the problem surfaces AT COMPILE TIME with an
 * actionable message instead of at run time with a hex code.
 *
 * v1.5.2: the audit parses the REAL PE import table (standard + delay-load
 * descriptors) instead of string-scanning the binary. A string scan
 * reported false positives on fully static builds — statically linked
 * MinGW runtime objects legitimately contain strings such as
 * "libgcc_s_dw2-1.dll" or "libgcj-16.dll" in their own code/data, but the
 * loader never imports them. Only names the loader must resolve are
 * audited now; if the file is not a parseable PE the audit stays SILENT
 * (never break the build flow, never guess).
 *
 * Pure module: no vscode imports, unit-testable in plain Node.
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
exports.RUNTIME_DLL_PATTERNS = void 0;
exports.parsePeImports = parsePeImports;
exports.auditExeBuffer = auditExeBuffer;
exports.auditWindowsExe = auditWindowsExe;
exports.buildAuditMessage = buildAuditMessage;
const fs = __importStar(require("fs"));
/** DLLs that ship with every Windows 10/11 installation. */
const WINDOWS_SYSTEM_DLLS = new Set([
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
function isApiSet(name) {
    return /^api-ms-win-/i.test(name) || /^ext-ms-/i.test(name);
}
/**
 * MinGW / MSVC runtime DLLs that are NOT guaranteed to exist on a student
 * PC. If one of these shows up in the import table, the exe will fail to
 * launch with 0xC0000135 on machines without the compiler in PATH.
 */
exports.RUNTIME_DLL_PATTERNS = [
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
/** RVA -> file offset via the section table; 0 when unmappable. */
function rvaToOffset(sections, rva) {
    for (const s of sections) {
        const span = Math.max(s.vsize, s.rawsize);
        if (rva >= s.va && rva < s.va + span) {
            const delta = rva - s.va;
            if (s.rawsize === 0 || delta >= s.rawsize) {
                return 0; /* virtual-only tail (BSS-like): no file bytes */
            }
            return s.raw + delta;
        }
    }
    return 0;
}
function readAscii(buf, off, max = 260) {
    if (off <= 0 || off >= buf.length)
        return '';
    let end = off;
    while (end < buf.length && end - off < max && buf[end] !== 0)
        end++;
    return buf.toString('ascii', off, end);
}
function plausibleModuleName(name) {
    return (name.length > 0 &&
        name.length <= 128 &&
        name.indexOf('.') > 0 &&
        /^[a-z0-9_+\-.]+\.[a-z0-9_+\-]+$/.test(name));
}
/**
 * Parse every DLL the Windows loader must resolve (standard import table +
 * delay-load descriptors) out of a PE image. Lowercase, unique, sorted.
 *
 * Returns null when the buffer is not a parseable PE image. Callers must
 * stay silent in that case — guessing from raw strings is what produced
 * the v1.5.1 false positives (e.g. "libgcj-16.dll" inside a static exe).
 */
function parsePeImports(buf) {
    /* --- DOS header --- */
    if (buf.length < 0x40 || buf.toString('ascii', 0, 2) !== 'MZ')
        return null;
    const eLfanew = buf.readUInt32LE(0x3c);
    if (eLfanew <= 0 || eLfanew + 24 > buf.length)
        return null;
    if (buf.toString('ascii', eLfanew, eLfanew + 4) !== 'PE\x00\x00')
        return null;
    /* --- COFF header --- */
    const coff = eLfanew + 4;
    const numSections = buf.readUInt16LE(coff + 2);
    const sizeOfOptional = buf.readUInt16LE(coff + 16);
    if (sizeOfOptional === 0)
        return null;
    const opt = coff + 20;
    if (opt + sizeOfOptional > buf.length)
        return null;
    /* --- optional header: magic, image base, data directories --- */
    const magic = buf.readUInt16LE(opt);
    let dataDirOffset;
    let imageBase;
    if (magic === 0x20b) {
        /* PE32+ */
        imageBase = Number(buf.readBigUInt64LE(opt + 24));
        dataDirOffset = opt + 112;
    }
    else if (magic === 0x10b) {
        /* PE32 */
        imageBase = buf.readUInt32LE(opt + 28);
        dataDirOffset = opt + 96;
    }
    else {
        return null;
    }
    const numDirs = buf.readUInt32LE(dataDirOffset - 4);
    /* --- section table --- */
    const secTab = opt + sizeOfOptional;
    if (numSections > 96 || secTab + numSections * 40 > buf.length)
        return null;
    const sections = [];
    for (let i = 0; i < numSections; i++) {
        const s = secTab + i * 40;
        sections.push({
            vsize: buf.readUInt32LE(s + 8),
            va: buf.readUInt32LE(s + 12),
            rawsize: buf.readUInt32LE(s + 16),
            raw: buf.readUInt32LE(s + 20)
        });
    }
    const toOff = (rva) => rvaToOffset(sections, rva);
    const fromVaOrRva = (value, rvaBound) => {
        if (rvaBound)
            return value;
        if (imageBase > 0 && value >= imageBase && value - imageBase <= 0xffffffff) {
            return value - imageBase;
        }
        return 0;
    };
    const names = new Set();
    /* --- standard imports: data directory index 1 --- */
    if (numDirs >= 2) {
        const impRva = buf.readUInt32LE(dataDirOffset + 1 * 8);
        if (impRva !== 0) {
            const base = toOff(impRva);
            if (base === 0)
                return null; /* import dir unreadable -> cannot audit */
            for (let i = 0; i < 8192; i++) {
                const d = base + i * 20;
                if (d + 20 > buf.length)
                    break;
                const originalFirstThunk = buf.readUInt32LE(d);
                const nameRva = buf.readUInt32LE(d + 12);
                if (originalFirstThunk === 0 && nameRva === 0)
                    break; /* terminator */
                if (nameRva === 0)
                    continue;
                const name = readAscii(buf, toOff(nameRva)).toLowerCase();
                if (plausibleModuleName(name))
                    names.add(name);
            }
        }
    }
    /* --- delay-load imports: data directory index 13 --- */
    if (numDirs >= 14) {
        const delayRva = buf.readUInt32LE(dataDirOffset + 13 * 8);
        if (delayRva !== 0) {
            const base = toOff(delayRva);
            if (base !== 0) {
                for (let i = 0; i < 4096; i++) {
                    const d = base + i * 32;
                    if (d + 32 > buf.length)
                        break;
                    const grAttrs = buf.readUInt32LE(d);
                    const szName = buf.readUInt32LE(d + 4);
                    if (szName === 0)
                        break; /* terminator */
                    const rva = fromVaOrRva(szName, (grAttrs & 1) !== 0);
                    if (rva === 0)
                        continue;
                    const name = readAscii(buf, toOff(rva)).toLowerCase();
                    if (plausibleModuleName(name))
                        names.add(name);
                }
            }
            /* an unreadable delay dir is not fatal: delay-load DLLs are
             * resolved lazily and do not kill the process at launch */
        }
    }
    return Array.from(names).sort();
}
function auditExeBuffer(buf) {
    const imports = parsePeImports(buf) ?? [];
    const missing = imports.filter((n) => {
        if (WINDOWS_SYSTEM_DLLS.has(n) || isApiSet(n))
            return false;
        return /\.(dll|drv)$/i.test(n);
    });
    return { bytes: buf.length, imports, missing, ok: missing.length === 0 };
}
/**
 * Audit a compiled Windows exe. Returns null when the file cannot be read
 * (audit must never break the build flow).
 */
function auditWindowsExe(exePath) {
    try {
        const st = fs.statSync(exePath);
        if (!st.isFile() || st.size < 0x40 || st.size > 96 * 1024 * 1024) {
            return null;
        }
        return auditExeBuffer(fs.readFileSync(exePath));
    }
    catch {
        return null;
    }
}
/** Human-readable, actionable warning text for a failed audit. */
function buildAuditMessage(res, exeName) {
    return (exeName + ' imports ' + res.missing.join(', ') +
        ', which are NOT part of Windows. On PCs without MinGW in PATH the program ' +
        'fails to launch with exit code -1073741515 (0xc0000135 DLL not found). ' +
        'Fix: keep "graphics-h-runner.staticLinkWindows" enabled (adds -static) and ' +
        'rebuild — or copy the DLL(s) from the compiler bin folder next to the .exe.');
}
//# sourceMappingURL=depsAudit.js.map