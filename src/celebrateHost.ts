/**
 * celebrateHost.ts — the VS Code side of the celebration overlays (v1.5.5).
 *
 * Celebrator owns ONE WebviewPanel at a time (the "full VS Code screen"
 * overlay in the editor area). It:
 *   - shows confetti / error / school pride for their scheduled duration
 *     and closes itself;
 *   - shows the Fireworks Simulator and stays open until the user stops
 *     (overlay Stop button, Esc, the activity-bar button, the panel
 *     action button, or closing the tab);
 *   - reports every start/stop through hooks.onStateChange so the host
 *     can drive the `graphics-h-runner.fireworksRunning` context key and
 *     re-render the panel action button as Stop/Start;
 *   - never throws into the caller: every entry point swallows and logs
 *     (a celebration must never break a compile).
 */

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import * as path from 'path';
import {
  buildCelebrationHtml,
  buildFireworksHtml,
  CELEBRATION_DURATIONS_MS,
  CELEBRATION_VIEW_TYPE,
  celebrationMediaPaths,
  celebrationTitle,
  CelebrationKind,
  TimedCelebrationKind
} from './celebrate';

/** v1.5.6: extra payload — the error overlay carries compiler headers. */
export interface CelebrationPayload {
  errorLines?: string[];
}

export interface CelebratorHooks {
  /** Fired with the kind that started running, then undefined on stop. */
  onStateChange?(kind: CelebrationKind | undefined): void;
  /** Optional log sink (the extension's output channel). */
  onLog?(line: string): void;
}

export class Celebrator {
  private panel: vscode.WebviewPanel | undefined;
  private autoClose: NodeJS.Timeout | undefined;
  private current: CelebrationKind | undefined;

  constructor(
    private readonly extensionRoot: string,
    private readonly hooks: CelebratorHooks = {}
  ) {}

  /** The kind currently on screen, if any. */
  get running(): CelebrationKind | undefined {
    return this.current;
  }

  /**
   * Show an overlay. Any overlay already on screen is replaced. Timed
   * kinds auto-close after their scheduled duration (explicit durationMs
   * overrides it — used by tests); fireworks stays until stopped.
   * `payload` feeds the error overlay (compiler error headers in big type).
   */
  show(kind: CelebrationKind, durationMs?: number, payload?: CelebrationPayload): void {
    this.close();
    if (durationMs === undefined && kind !== 'fireworks') {
      durationMs = CELEBRATION_DURATIONS_MS[kind];
    }

    let panel: vscode.WebviewPanel;
    try {
      panel = vscode.window.createWebviewPanel(
        CELEBRATION_VIEW_TYPE,
        celebrationTitle(kind),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(path.join(this.extensionRoot, 'media'))]
        }
      );
    } catch (e) {
      this.hooks.onLog?.('[celebrate] could not open the overlay: ' + String(e));
      return;
    }

    const nonce = randomBytes(12).toString('hex');
    const cspSource = panel.webview.cspSource;
    const media = celebrationMediaPaths(this.extensionRoot);
    const uri = (fsPath: string): string => panel.webview.asWebviewUri(vscode.Uri.file(fsPath)).toString();

    try {
      panel.webview.html =
        kind === 'fireworks'
          ? buildFireworksHtml({
              nonce,
              cspSource,
              cssUri: uri(media.fireworksCss),
              fscreenJsUri: uri(media.fscreenJs),
              myMathJsUri: uri(media.myMathJs),
              stageJsUri: uri(media.stageJs),
              scriptJsUri: uri(media.scriptJs)
            })
          : buildCelebrationHtml({
              kind: kind as TimedCelebrationKind,
              nonce,
              cspSource,
              confettiJsUri: uri(media.confettiJs),
              celebrateJsUri: uri(media.celebrateJs),
              durationMs: durationMs || 0,
              errorLines: payload?.errorLines
            });
    } catch (e) {
      this.hooks.onLog?.('[celebrate] failed to build the overlay html: ' + String(e));
      panel.dispose();
      return;
    }

    panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg && msg.type === 'stop') {
        this.stop();
      }
    });

    panel.onDidDispose(() => {
      if (this.autoClose) {
        clearTimeout(this.autoClose);
        this.autoClose = undefined;
      }
      if (this.panel === panel) {
        this.panel = undefined;
      }
      if (this.current === kind) {
        this.current = undefined;
        this.hooks.onStateChange?.(undefined);
      }
    });

    this.panel = panel;
    this.current = kind;
    if (durationMs && durationMs > 0) {
      this.autoClose = setTimeout(() => this.stop(), durationMs);
    }
    this.hooks.onStateChange?.(kind);
    this.hooks.onLog?.(
      '[celebrate] ' + kind + (durationMs && durationMs > 0 ? ' (' + durationMs + ' ms)' : ' (until stopped)')
    );
  }

  /** Stop whatever is on screen (idempotent, safe when nothing runs). */
  stop(): void {
    this.close();
  }

  dispose(): void {
    this.close();
  }

  /** Single teardown path: clear the timer, dispose the panel; the
   * panel's onDidDispose performs the state notification. */
  private close(): void {
    if (this.autoClose) {
      clearTimeout(this.autoClose);
      this.autoClose = undefined;
    }
    const p = this.panel;
    this.panel = undefined;
    const was = this.current;
    this.current = undefined;
    if (p) {
      try {
        p.dispose();
      } catch {
        /* already gone */
      }
    }
    if (was) {
      this.hooks.onStateChange?.(undefined);
    }
  }
}
