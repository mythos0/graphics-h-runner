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

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Sentry from '@sentry/node';

const SENTRY_DSN =
  'https://5e2f72e37ba24ec0179a56fccc3bc973@o4512147759235072.ingest.us.sentry.io/4512147800195072';

/** true once Sentry.init() succeeded and the client is accepting events. */
let telemetryActive = false;

/** Install root of this extension (set in activate) — used for attribution. */
let extensionRoot = '';

/** False in Development/Test extension hosts — those are our own sandboxes
 *  (E2E test runs) and must never feed the production error inbox. */
let productionMode = true;

/** Read the extension version from package.json (runtime read — bundler-safe). */
function readExtensionVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (pkg && typeof pkg.version === 'string' && pkg.version) {
      return pkg.version;
    }
  } catch {
    /* fall through */
  }
  return '0.0.0';
}

/** VS Code-wide telemetry consent, fault-tolerant (unit-test stubs may lack `env`). */
function telemetryAllowed(): boolean {
  try {
    return vscode.env.isTelemetryEnabled === true;
  } catch {
    return false;
  }
}

/**
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

/**
 * v1.5.1 shipped "drop Canceled" but only matched the exception TYPE. VS Code
 * surfaces the same cancellation as type "Error" with value "Canceled: Canceled"
 * (seen as GRAPHICS-H-RUNNER-A/-6/-5, 53 events from v1.4.x clients). Match the
 * value/message pattern as well — an event is benign when EVERY exception value
 * (or, for message events, the message itself) is a cancellation.
 */
const CANCELED_PATTERN = /^cance[l]{1,2}ed\b/i;

export function isBenignCancellation(event: Sentry.Event): boolean {
  try {
    const values = event.exception?.values || [];
    if (values.length > 0) {
      return values.every(
        (v) => v.type === 'Canceled' || CANCELED_PATTERN.test(String(v.value || ''))
      );
    }
    if (typeof event.message === 'string') {
      return CANCELED_PATTERN.test(event.message);
    }
  } catch {
    /* filtering must never break delivery */
  }
  return false;
}

/** Recursively scrub strings inside breadcrumb/exception payloads. */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      clean[key] = scrubValue(val);
    }
    return clean;
  }
  return value;
}

/** Last-chance scrubber applied to every outgoing event. Never throws. */
function scrubEvent<E extends Sentry.Event>(event: E): E {
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
            /* defensive: some serialization paths use the camelCase form */
            const camel = (frame as { absPath?: unknown }).absPath;
            if (typeof camel === 'string') {
              (frame as { absPath: string }).absPath = scrubText(camel);
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
          crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
        }
      }
    }
    if (event.tags) {
      event.tags = scrubValue(event.tags) as Record<string, string>;
    }
  } catch {
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
function installNavigatorGuard(): void {
  const g = globalThis as Record<string, unknown>;
  try {
    void g.navigator; /* may throw the host's migration trap */
    if (typeof g.navigator !== 'undefined') {
      return; /* real navigator available — nothing to do */
    }
  } catch {
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
  } catch {
    /* could not override — the try/catch around Sentry.init keeps the
     * extension alive (telemetry simply stays off for this session) */
  }
}

/**
 * The bundled Sentry SDK's own uncaught-exception OBSERVER frame.
 *
 * The SDK handler is bundled into dist/extension.js, so on every uncaught
 * error in the shared host its frame — "Object.assign._errorHandler" —
 * appears INSIDE the reported stack (the host's error path runs through the
 * registered process handlers, including ours). Without excluding it, every
 * third-party crash in the host process looks "attributable" because the
 * observer that CAUGHT it lives in our bundle.
 *
 * Seen live (GRAPHICS-H-RUNNER-H, v1.5.16): "Oracle Java SE Language Server
 * not enabled" — thrown by the host for the Java extension, captured by our
 * observer; the ONLY frame in our files was that observer frame.
 *
 * The name is specific on purpose: our own code never defines or calls a
 * bare `_errorHandler` (grep'd), and real errors thrown by our code carry
 * our real function frames (throw site) in addition to — or instead of —
 * the observer.
 */
function isObserverFrame(funcName: string | undefined): boolean {
  if (typeof funcName !== 'string') {
    return false;
  }
  const fn = funcName.toLowerCase();
  return fn === '_errorhandler' || (fn.startsWith('object.assign.') && fn.includes('errorhandler'));
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
 * Observer frames (see isObserverFrame) never count — they are appended to
 * every stack our handler happens to catch. Events captured deliberately
 * through captureExtensionError() carry the `ghr.source: handled` tag and
 * always pass.
 *
 * Exported for unit tests (test/instrument-tests.js); the second parameter
 * overrides the module-level extensionRoot so tests need no VS Code context.
 */
export function isAttributableToUs(event: Sentry.Event, extensionRootOverride?: string): boolean {
  const values = event.exception?.values || [];
  for (const ex of values) {
    const tags = (event.tags || {}) as Record<string, string>;
    if (tags['ghr.source'] === 'handled') {
      return true;
    }
  }
  const frames: Array<{
    function?: string;
    filename?: string;
    abs_path?: string;
  }> = [];
  for (const ex of values) {
    for (const f of ex.stacktrace?.frames || []) {
      if (isObserverFrame(f.function)) {
        continue; /* the bundled observer — attribution-neutral */
      }
      frames.push({
        function: f.function || undefined,
        filename: f.filename || undefined,
        abs_path: f.abs_path || undefined
      });
    }
  }
  if (frames.length === 0) {
    return false; /* nothing to attribute — treat as host noise */
  }
  const needle = 'graphics-h-runner';
  for (const f of frames) {
    for (const p of [f.abs_path, f.filename, (f as { absPath?: unknown }).absPath]) {
      if (typeof p === 'string') {
        const norm = p.replace(/\\/g, '/').toLowerCase();
        /* v1.5.23: the bare "endsWith('/dist/extension.js')" clause was a LEAK
         * — Copilot's built-in bundle lives at the same suffix
         * (resources/app/extensions/copilot/dist/extension.js) and v10 host
         * crashes from it (GRAPHICS-H-RUNNER-J/Q/Y/W/V, 42 events) were
         * attributed to us. Only OUR install dir ("mythos0-labs.graphics-h-
         * runner") may satisfy the dist-suffix shortcut now. */
        if (norm.includes(needle)) {
          return true;
        }
        if (norm.endsWith('/dist/extension.js') && norm.includes('mythos0-labs')) {
          return true;
        }
      }
    }
  }
  const root0 = extensionRootOverride !== undefined ? extensionRootOverride : extensionRoot;
  if (root0) {
    const root = root0.replace(/\\/g, '/').toLowerCase();
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
 * True when the event references ANOTHER extension's install folder — seen
 * live: frame-less "Cannot find package 'prettier' imported from
 * .vscode\extensions\esbenp.prettier-vscode-..." unhandled rejections that
 * carry no frames to attribute (shared extension host, not our code).
 *
 * v1.5.23: also rejects VS Code BUILT-IN extension folders
 * (<install>\resources\app\extensions\<name>\ — copilot, github, git, …).
 * GRAPHICS-H-RUNNER-J/Q/Y/W/V/Z (41 events in 8 days) were exactly that:
 * Copilot's and GitHub's own crashes whose frames end in
 * "...\resources\app\extensions\copilot\dist\extension.js" — indistinguishable
 * from our bundle by suffix alone. Our code NEVER lives under
 * resources/app/extensions, so any such reference is foreign by definition.
 */
export function referencesOtherExtension(event: Sentry.Event): boolean {
  try {
    const paths: string[] = [];
    if (typeof event.message === 'string') {
      paths.push(event.message);
    }
    for (const ex of event.exception?.values || []) {
      if (typeof ex.value === 'string') {
        paths.push(ex.value);
      }
      for (const f of ex.stacktrace?.frames || []) {
        if (typeof f.filename === 'string') {
          paths.push(f.filename);
        }
        if (typeof f.abs_path === 'string') {
          paths.push(f.abs_path);
        }
        if (typeof (f as { absPath?: unknown }).absPath === 'string') {
          paths.push((f as { absPath: string }).absPath);
        }
      }
    }
    for (const p of paths) {
      /* user-installed extensions */
      const m = p.match(/\.vscode[/\\]+extensions[/\\]+([^/\\'"\s:]+)/i);
      if (m && !m[1].toLowerCase().startsWith('mythos0-labs.graphics-h-runner')) {
        return true;
      }
      /* VS Code built-ins (copilot, github, git, …) — ours never ships there */
      if (/resources[/\\]app[/\\]extensions[/\\]/i.test(p)) {
        return true;
      }
    }
  } catch {
    /* filtering must never break delivery */
  }
  return false;
}

/**
 * Initialize Sentry (no-op when already active or when VS Code telemetry is off).
 * Safe to call repeatedly — called inside activate(), never at module load:
 * the extension's module evaluation must be able to fail without taking the
 * whole panel down.
 */
export function initTelemetry(): void {
  if (telemetryActive || !productionMode || !telemetryAllowed()) {
    return;
  }
  installNavigatorGuard();
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: `graphics-h-runner@${readExtensionVersion()}`,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      /* v1.5.23: the SDK defaults server_name to os.hostname() — live events
       * shipped machine names ("DESKTOP-DIV8DM8", "Suhails-MacBook-Air.local").
       * A constant identifier keeps events attributable without that leak. */
      serverName: 'vscode-extension-host',

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
        /* v1.5.1: VS Code command cancellation (CancellationError) is pure user
         * noise, not an extension error — broadened in v1.5.23 to also match
         * the "type=Error, value=Canceled: Canceled" serialization. */
        if (isBenignCancellation(event)) {
          return null;
        }
        /* Anything NOT captured deliberately by our own code must belong to
         * this extension: no frames at all (frame-less module-loader
         * rejections), frames in another extension's folder, frames in a
         * VS Code built-in extension (copilot/github/git), or paths naming
         * another extension — all dropped. Handled captures (tag
         * ghr.source=handled) always pass. */
        const handled = ((event.tags || {}) as Record<string, string>)['ghr.source'] === 'handled';
        if (!handled && (referencesOtherExtension(event) || !isAttributableToUs(event))) {
          return null; /* another extension's / the host's own crash — not ours */
        }
        /* malformed / empty payload safety valve */
        if (!event.exception && typeof event.message !== 'string') {
          return null;
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
  } catch {
    /* telemetry must never break extension activation */
    telemetryActive = false;
  }
}

export function isTelemetryActive(): boolean {
  return telemetryActive;
}

/**
 * Record the extension's install root (attribution scope) and whether this is
 * a production run. Development (F5) and Test (@vscode/test-electron) hosts
 * are our own sandboxes — they must never send telemetry.
 */
export function setTelemetryContext(options: { extensionRoot: string; extensionMode: number | undefined }): void {
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
export function onTelemetryConsentChanged(enabled: boolean): void {
  if (enabled) {
    initTelemetry();
  } else if (telemetryActive) {
    telemetryActive = false; /* beforeSend gate drops anything still in flight */
    void Sentry.close(1000).catch(() => undefined); /* flush queued events, then stop */
  }
}

/* ------------------------------------------------------------------
 * v1.5.23 — session-level report dedupe + caps (inbox-spam hardening).
 *
 * Live data: "make-global probe failed" fired 38 times and "setup verify
 * not ready" 25 times in 11 days — the same handful of machines whose
 * environment legitimately cannot pass, re-reporting on EVERY Setup/Doctor
 * run. Sentry groups them, but the inbox still drowns. From now on each
 * distinct warning/error signature is reported ONCE per extension-host
 * session, with hard caps as a safety valve for pathological loops.
 * ------------------------------------------------------------------ */

const reportedWarnings = new Set<string>();
const reportedErrors = new Set<string>();
let warningsSent = 0;
let errorsSent = 0;
const MAX_WARNINGS_PER_SESSION = 10;
const MAX_ERRORS_PER_SESSION = 20;

/** Canonical signature for dedupe (first 120 chars is plenty for grouping). */
function eventSignature(parts: Array<string | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : ''))
    .join('|')
    .slice(0, 240);
}

/** Test/observability hook: has this warning signature already been reported? */
export function hasReportedWarning(message: string): boolean {
  return reportedWarnings.has(message.slice(0, 200));
}

/** Test hook: clear dedupe state (module state survives across suites). */
export function resetReportedStateForTests(): void {
  reportedWarnings.clear();
  reportedErrors.clear();
  warningsSent = 0;
  errorsSent = 0;
}

/** Test-only: flip the module's active flag without Sentry.init. Capture calls
 *  then exercise the real dedupe/cap logic while the SDK itself is a no-op
 *  (no client configured -> nothing is ever sent). NEVER call from production
 *  code. */
export function setTelemetryActiveForTests(active: boolean): void {
  telemetryActive = active;
}

/** Test/observability hook: has this error signature already been reported? */
export function hasReportedError(type: string, message: string, setupStep: string): boolean {
  return reportedErrors.has(
    eventSignature([String(type || ''), String(message || '').slice(0, 120), String(setupStep || '')])
  );
}

/** Capture an exception that our own code caught and handled (with context tags).
 *  v1.5.23: identical (type+message+step) errors report once per session,
 *  capped at MAX_ERRORS_PER_SESSION. */
export function captureExtensionError(error: unknown, tags?: Record<string, string>): void {
  if (!telemetryActive) {
    return;
  }
  try {
    const err = error as { name?: unknown; message?: unknown } | null;
    const sig = eventSignature([
      String((err && err.name) || typeof error),
      String((err && err.message) || error || '').slice(0, 120),
      tags && tags.setup_step ? tags.setup_step : ''
    ]);
    if (reportedErrors.has(sig) || errorsSent >= MAX_ERRORS_PER_SESSION) {
      return;
    }
    reportedErrors.add(sig);
    errorsSent++;
    Sentry.captureException(error, (scope) => {
      scope.setTag('ghr.source', 'handled'); /* attribution: ours by definition */
      if (tags) {
        for (const [key, value] of Object.entries(tags)) {
          scope.setTag(key, scrubText(value));
        }
      }
      return scope;
    });
  } catch {
    /* ignore */
  }
}

/** Capture a handled-but-notable condition at WARNING level (the webview
 *  fallback engaging is resilience working as designed — visibility without
 *  polluting the error inbox).
 *  v1.5.23: each distinct warning reports ONCE per session, capped at
 *  MAX_WARNINGS_PER_SESSION (the M/K/F trio alone was 81 events/11 days). */
export function captureExtensionWarning(message: string, tags?: Record<string, string>): void {
  const key = String(message || '').slice(0, 200);
  if (!telemetryActive || reportedWarnings.has(key) || warningsSent >= MAX_WARNINGS_PER_SESSION) {
    return;
  }
  try {
    reportedWarnings.add(key);
    warningsSent++;
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('ghr.source', 'handled');
      if (tags) {
        for (const [key, value] of Object.entries(tags)) {
          scope.setTag(key, scrubText(value));
        }
      }
      Sentry.captureMessage(message);
    });
  } catch {
    /* ignore */
  }
}

/** Record a breadcrumb (context shown on whatever error happens later). */
export function addExtensionBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (!telemetryActive) {
    return;
  }
  try {
    Sentry.addBreadcrumb({
      category,
      message: scrubText(message),
      level: 'info',
      timestamp: Date.now() / 1000,
      data: data ? (scrubValue(data) as Record<string, unknown>) : undefined
    });
  } catch {
    /* ignore */
  }
}

/** Attach stable runtime tags (VS Code version, host, …) to every future event. */
export function setRuntimeTags(tags: Record<string, string>): void {
  if (!telemetryActive) {
    return;
  }
  try {
    const scope = Sentry.getGlobalScope();
    for (const [key, value] of Object.entries(tags)) {
      scope.setTag(key, scrubText(value));
    }
  } catch {
    /* ignore */
  }
}

/** Flush queued events and shut the client down (used on extension deactivate). */
export async function flushTelemetry(timeoutMs = 2000): Promise<boolean> {
  if (!telemetryActive) {
    return false;
  }
  try {
    const ok = await Sentry.close(timeoutMs);
    telemetryActive = false;
    return ok;
  } catch {
    telemetryActive = false;
    return false;
  }
}

/* NOTE: no top-level init here. Even though this module is the first import
 * of the extension entry (instrument-first ordering), initialization happens
 * in activate() — a throw during module evaluation would prevent the panel/
 * tree/command registrations entirely (v1.4.0 regression on newer VS Code). */
