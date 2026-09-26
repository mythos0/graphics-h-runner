"use strict";
/**
 * instrument.ts — automatic error collection for graphics.h Runner (Sentry JS SDK, Node).
 *
 * This file follows the Sentry "instrument-first" pattern for Node.js: it is the very
 * first import of the extension entry (extension.ts), so the SDK is initialized before
 * any other extension code runs and its global handlers can catch everything.
 *
 * VS Code specifics handled here (this is a shared extension-host process, not a server):
 *  - Consent: nothing is ever captured unless VS Code telemetry is enabled
 *    (`telemetry.telemetryLevel != 'off'`, surfaced as `vscode.env.isTelemetryEnabled`).
 *    Toggling the VS Code telemetry setting at runtime enables/disables collection live.
 *  - Safety: the OnUncaughtException integration is configured with
 *    `exitEvenIfOtherHandlersAreRegistered: false` so a crash is captured while the
 *    extension host (and every other extension) keeps running.
 *  - Privacy: user-identifying path segments (home dir, /home/<user>, C:\Users\<user>)
 *    are scrubbed from messages, exception values, frame paths, breadcrumbs and tags
 *    in `beforeSend` before anything leaves the machine.
 *
 * Base signals (Sentry recommended defaults): error monitoring + tracing.
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
exports.initTelemetry = initTelemetry;
exports.isTelemetryActive = isTelemetryActive;
exports.setTelemetryContext = setTelemetryContext;
exports.onTelemetryConsentChanged = onTelemetryConsentChanged;
exports.captureExtensionError = captureExtensionError;
exports.addExtensionBreadcrumb = addExtensionBreadcrumb;
exports.setRuntimeTags = setRuntimeTags;
exports.flushTelemetry = flushTelemetry;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const Sentry = __importStar(require("@sentry/node"));
const SENTRY_DSN = 'https://5e2f72e37ba24ec0179a56fccc3bc973@o4512147759235072.ingest.us.sentry.io/4512147800195072';
/** true once Sentry.init() succeeded and the client is accepting events. */
let telemetryActive = false;
/** Install root of this extension (set in activate) — used for attribution. */
let extensionRoot = '';
/** False in Development/Test extension hosts — those are our own sandboxes
 *  (E2E test runs) and must never feed the production error inbox. */
let productionMode = true;
/** Read the extension version from package.json (runtime read — bundler-safe). */
function readExtensionVersion() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
        const pkg = JSON.parse(raw);
        if (pkg && typeof pkg.version === 'string' && pkg.version) {
            return pkg.version;
        }
    }
    catch {
        /* fall through */
    }
    return '0.0.0';
}
/** VS Code-wide telemetry consent, fault-tolerant (unit-test stubs may lack `env`). */
function telemetryAllowed() {
    try {
        return vscode.env.isTelemetryEnabled === true;
    }
    catch {
        return false;
    }
}
/** Replace user-identifying path segments with `~` (works on both separators). */
function scrubText(value) {
    let out = String(value);
    try {
        const home = os.homedir();
        if (home && home.length > 3) {
            out = out.split(home).join('~');
        }
    }
    catch {
        /* ignore */
    }
    out = out.replace(/([A-Za-z]:\\Users\\)[^\\/:*?"<>|\s]+/g, '$1~');
    out = out.replace(/(\/home\/)[^/\s]+/g, '$1~');
    return out;
}
/** Recursively scrub strings inside breadcrumb/exception payloads. */
function scrubValue(value) {
    if (typeof value === 'string') {
        return scrubText(value);
    }
    if (Array.isArray(value)) {
        return value.map(scrubValue);
    }
    if (value && typeof value === 'object') {
        const clean = {};
        for (const [key, val] of Object.entries(value)) {
            clean[key] = scrubValue(val);
        }
        return clean;
    }
    return value;
}
/** Last-chance scrubber applied to every outgoing event. Never throws. */
function scrubEvent(event) {
    try {
        if (typeof event.message === 'string') {
            event.message = scrubText(event.message);
        }
        const values = event.exception?.values;
        if (values) {
            for (const ex of values) {
                if (typeof ex.value === 'string') {
                    ex.value = scrubText(ex.value);
                }
                const frames = ex.stacktrace?.frames;
                if (frames) {
                    for (const frame of frames) {
                        if (typeof frame.filename === 'string') {
                            frame.filename = scrubText(frame.filename);
                        }
                        if (typeof frame.abs_path === 'string') {
                            frame.abs_path = scrubText(frame.abs_path);
                        }
                    }
                }
            }
        }
        if (event.breadcrumbs) {
            for (const crumb of event.breadcrumbs) {
                if (typeof crumb.message === 'string') {
                    crumb.message = scrubText(crumb.message);
                }
                if (crumb.data) {
                    crumb.data = scrubValue(crumb.data);
                }
            }
        }
        if (event.tags) {
            event.tags = scrubValue(event.tags);
        }
    }
    catch {
        /* scrubbing must never break delivery */
    }
    return event;
}
/**
 * VS Code's extension host (engines ^1.80 profile on newer VS Code) traps
 * reads of the new `navigator` global with a PendingMigrationError. The
 * Sentry SDK reads `navigator` while setting up its integrations, which
 * would crash the extension's module load on those hosts (seen as
 * "There is no data provider registered..." because activation never
 * finishes). Probe it safely and, when trapped, replace it with a benign
 * stub so the SDK keeps working.
 */
function installNavigatorGuard() {
    const g = globalThis;
    try {
        void g.navigator; /* may throw the host's migration trap */
        if (typeof g.navigator !== 'undefined') {
            return; /* real navigator available — nothing to do */
        }
    }
    catch {
        /* trapped getter — fall through and replace it */
    }
    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                userAgent: 'VSCode-Extension-Host',
                language: 'en-US',
                platform: process.platform,
                hardwareConcurrency: 2
            },
            configurable: true,
            writable: true
        });
    }
    catch {
        /* could not override — the try/catch around Sentry.init keeps the
         * extension alive (telemetry simply stays off for this session) */
    }
}
/**
 * VS Code's extension host is a SHARED process: every installed extension and
 * the workbench itself run inside it. Our OnUncaughtException integration is a
 * process-wide last-resort handler, so without filtering it captures crashes
 * from prettier, Roo Cline, VS Code search, E2E test hosts, etc. — noise that
 * drowns real signals (seen live: 5/5 inbox issues were other components).
 *
 * An event is attributable to this extension when any exception frame lives in
 * an extension folder whose name contains the extension id ("graphics-h-runner",
 * true for installed `~/.vscode/extensions/mythos0-labs.graphics-h-runner-x/`
 * on all platforms and for dev/E2E checkouts) or in our bundled dist output.
 * Events captured deliberately through captureExtensionError() carry the
 * `ghr.source: handled` tag and always pass.
 */
function isAttributableToUs(event) {
    const values = event.exception?.values || [];
    for (const ex of values) {
        const tags = (event.tags || {});
        if (tags['ghr.source'] === 'handled') {
            return true;
        }
    }
    const frames = [];
    for (const ex of values) {
        for (const f of ex.stacktrace?.frames || []) {
            frames.push({ filename: f.filename || undefined, abs_path: f.abs_path || undefined });
        }
    }
    if (frames.length === 0) {
        return false; /* nothing to attribute — treat as host noise */
    }
    const needle = 'graphics-h-runner';
    for (const f of frames) {
        for (const p of [f.abs_path, f.filename]) {
            if (typeof p === 'string') {
                const norm = p.replace(/\\/g, '/').toLowerCase();
                if (norm.includes(needle) || norm.endsWith('/dist/extension.js')) {
                    return true;
                }
            }
        }
    }
    if (extensionRoot) {
        const root = extensionRoot.replace(/\\/g, '/').toLowerCase();
        for (const f of frames) {
            for (const p of [f.abs_path, f.filename]) {
                if (typeof p === 'string' && p.replace(/\\/g, '/').toLowerCase().startsWith(root)) {
                    return true;
                }
            }
        }
    }
    return false;
}
/**
 * Initialize Sentry (no-op when already active or when VS Code telemetry is off).
 * Safe to call repeatedly — called inside activate(), never at module load:
 * the extension's module evaluation must be able to fail without taking the
 * whole panel down.
 */
function initTelemetry() {
    if (telemetryActive || !productionMode || !telemetryAllowed()) {
        return;
    }
    installNavigatorGuard();
    try {
        Sentry.init({
            dsn: SENTRY_DSN,
            release: `graphics-h-runner@${readExtensionVersion()}`,
            environment: process.env.SENTRY_ENVIRONMENT || 'production',
            /* Skill-recommended Node defaults: tracing on (0.1 in production). */
            tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
            includeLocalVariables: true,
            integrations: [
                /* Extension host shares its process with every other extension and has its
                 * own uncaughtException handlers: capture the crash, then let VS Code
                 * continue — never terminate the host (default behaviour in SDK v10.75). */
                Sentry.onUncaughtExceptionIntegration({
                    exitEvenIfOtherHandlersAreRegistered: false
                })
            ],
            beforeSend: (event) => {
                /* Consent may flip between init and send — enforce it at the wire. */
                if (!telemetryAllowed()) {
                    return null;
                }
                /* Auto-captured process-wide crashes must belong to this extension.
                 * Handled captures (tag ghr.source=handled) always pass. */
                const isAuto = (event.exception?.values || []).some((ex) => String(ex.mechanism?.type || '').startsWith('auto.node'));
                if (isAuto && !isAttributableToUs(event)) {
                    return null; /* another extension's / the host's own crash — not ours */
                }
                return scrubEvent(event);
            },
            initialScope: {
                tags: {
                    'os.name': process.platform,
                    'os.arch': process.arch,
                    'runtime.node': process.version
                }
            }
        });
        telemetryActive = true;
    }
    catch {
        /* telemetry must never break extension activation */
        telemetryActive = false;
    }
}
function isTelemetryActive() {
    return telemetryActive;
}
/**
 * Record the extension's install root (attribution scope) and whether this is
 * a production run. Development (F5) and Test (@vscode/test-electron) hosts
 * are our own sandboxes — they must never send telemetry.
 */
function setTelemetryContext(options) {
    extensionRoot = options.extensionRoot || '';
    /* vscode.ExtensionMode.Production === 1; accept undefined (older hosts) as
     * production so consent-gated collection keeps working there. */
    productionMode = options.extensionMode === undefined || options.extensionMode === 1;
    if (!productionMode && telemetryActive) {
        telemetryActive = false;
        void Sentry.close(500).catch(() => undefined);
    }
}
/** React to `vscode.env.onDidChangeTelemetryEnabled` (live enable/disable). */
function onTelemetryConsentChanged(enabled) {
    if (enabled) {
        initTelemetry();
    }
    else if (telemetryActive) {
        telemetryActive = false; /* beforeSend gate drops anything still in flight */
        void Sentry.close(1000).catch(() => undefined); /* flush queued events, then stop */
    }
}
/** Capture an exception that our own code caught and handled (with context tags). */
function captureExtensionError(error, tags) {
    if (!telemetryActive) {
        return;
    }
    try {
        Sentry.captureException(error, (scope) => {
            scope.setTag('ghr.source', 'handled'); /* attribution: ours by definition */
            if (tags) {
                for (const [key, value] of Object.entries(tags)) {
                    scope.setTag(key, scrubText(value));
                }
            }
            return scope;
        });
    }
    catch {
        /* ignore */
    }
}
/** Record a breadcrumb (context shown on whatever error happens later). */
function addExtensionBreadcrumb(category, message, data) {
    if (!telemetryActive) {
        return;
    }
    try {
        Sentry.addBreadcrumb({
            category,
            message: scrubText(message),
            level: 'info',
            timestamp: Date.now() / 1000,
            data: data ? scrubValue(data) : undefined
        });
    }
    catch {
        /* ignore */
    }
}
/** Attach stable runtime tags (VS Code version, host, …) to every future event. */
function setRuntimeTags(tags) {
    if (!telemetryActive) {
        return;
    }
    try {
        const scope = Sentry.getGlobalScope();
        for (const [key, value] of Object.entries(tags)) {
            scope.setTag(key, scrubText(value));
        }
    }
    catch {
        /* ignore */
    }
}
/** Flush queued events and shut the client down (used on extension deactivate). */
async function flushTelemetry(timeoutMs = 2000) {
    if (!telemetryActive) {
        return false;
    }
    try {
        const ok = await Sentry.close(timeoutMs);
        telemetryActive = false;
        return ok;
    }
    catch {
        telemetryActive = false;
        return false;
    }
}
/* NOTE: no top-level init here. Even though this module is the first import
 * of the extension entry (instrument-first ordering), initialization happens
 * in activate() — a throw during module evaluation would prevent the panel/
 * tree/command registrations entirely (v1.4.0 regression on newer VS Code). */
//# sourceMappingURL=instrument.js.map