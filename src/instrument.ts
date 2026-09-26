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
 * Initialize Sentry (no-op when already active or when VS Code telemetry is off).
 * Safe to call repeatedly — called inside activate(), never at module load:
 * the extension's module evaluation must be able to fail without taking the
 * whole panel down.
 */
export function initTelemetry(): void {
  if (telemetryActive || !telemetryAllowed()) {
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
