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

/** Replace user-identifying path segments with `~` (works on both separators). */
function scrubText(value: string): string {
  let out = String(value);
  try {
    const home = os.homedir();
    if (home && home.length > 3) {
      out = out.split(home).join('~');
    }
  } catch {
    /* ignore */
  }
  out = out.replace(/([A-Za-z]:\\Users\\)[^\\/:*?"<>|\s]+/g, '$1~');
  out = out.replace(/(\/home\/)[^/\s]+/g, '$1~');
  return out;
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
function isAttributableToUs(event: Sentry.Event): boolean {
  const values = event.exception?.values || [];
  for (const ex of values) {
    const tags = (event.tags || {}) as Record<string, string>;
    if (tags['ghr.source'] === 'handled') {
      return true;
    }
  }
  const frames: Array<{ filename?: string; abs_path?: string }> = [];
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
 * True when the event references ANOTHER extension's install folder — seen
 * live: frame-less "Cannot find package 'prettier' imported from
 * .vscode\extensions\esbenp.prettier-vscode-..." unhandled rejections that
 * carry no frames to attribute (shared extension host, not our code).
 */
function referencesOtherExtension(event: Sentry.Event): boolean {
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
      }
    }
    for (const p of paths) {
      const m = p.match(/\.vscode[/\\]+extensions[/\\]+([^/\\'"\s:]+)/i);
      if (m && !m[1].toLowerCase().startsWith('mythos0-labs.graphics-h-runner')) {
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
        /* Anything NOT captured deliberately by our own code must belong to
         * this extension: no frames at all (frame-less module-loader
         * rejections), frames in another extension's folder, or paths naming
         * another extension — all dropped. Handled captures (tag
         * ghr.source=handled) always pass. */
        const handled = ((event.tags || {}) as Record<string, string>)['ghr.source'] === 'handled';
        if (!handled && (referencesOtherExtension(event) || !isAttributableToUs(event))) {
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

/** Capture an exception that our own code caught and handled (with context tags). */
export function captureExtensionError(error: unknown, tags?: Record<string, string>): void {
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
  } catch {
    /* ignore */
  }
}

/** Capture a handled-but-notable condition at WARNING level (the webview
 *  fallback engaging is resilience working as designed — visibility without
 *  polluting the error inbox). */
export function captureExtensionWarning(message: string, tags?: Record<string, string>): void {
  if (!telemetryActive) {
    return;
  }
  try {
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
