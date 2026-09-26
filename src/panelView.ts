/**
 * panelView.ts — WebviewViewProvider for the graphics.h activity-bar
 * panel (view id: graphics-h-runner.programs).
 *
 * Modern webpage-style panel: dark hero, live environment status, a big
 * primary action button and example program cards. All clicks flow back to
 * the extension through postMessage.
 *
 * Resilience: a liveness watchdog (webviewHealth.ts) pings the page after
 * every render. If the page never answers — the known VS Code "Could not
 * register service worker: InvalidStateError" race — the HTML is re-set once
 * to re-navigate the webview, and if it still stays dead the extension is
 * notified so it can reveal the native TreeView fallback instantly.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { buildPanelHtml, buildFallbackPanelHtml, PanelStatus } from './panelHtml';
import { COMMAND_META, LoadedProgram } from './programs';
import { WebviewHealth, WebviewEvent } from './webviewHealth';

/** Structural subset of doctor.ts's DoctorResult (keeps this module light). */
export interface ViewDoctorStatus {
  graphicsReady: boolean;
  bestLibrary: string | null;
  compilerCheck: { ok: boolean };
}

export type PanelClick =
  | { type: 'command'; command: string }
  | { type: 'runProgram'; id: string }
  | { type: 'openProgram'; id: string }
  | { type: 'pong' };

export interface PanelHooks {
  /** Lifecycle notifications from the liveness watchdog. */
  onWebviewEvent?(ev: WebviewEvent): void;
}

export class GhPanelProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = 'graphics-h-runner.programs';

  private view: vscode.WebviewView | undefined;
  private doctorStatus: ViewDoctorStatus | undefined;
  private busy = false;
  private busyLabel: string | null = null;
  private health: WebviewHealth | undefined;
  private fallbackActive = false;

  constructor(
    private readonly extensionRoot: string,
    private readonly version: string,
    private readonly programs: LoadedProgram[],
    private readonly onClick: (msg: PanelClick) => void,
    private readonly hooks: PanelHooks = {}
  ) {}

  setDoctorResult(res: ViewDoctorStatus | undefined): void {
    this.doctorStatus = res;
    this.postState();
  }

  setBusy(busy: boolean, label: string | null = null): void {
    this.busy = busy;
    this.busyLabel = label;
    this.postBusy();
  }

  /** Reveal the panel in the activity bar (used by "openExamplesFolder" etc.). */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${GhPanelProvider.VIEW_ID}.focus`);
  }

  /**
   * User-facing recovery: rebuild the full panel HTML, clear any fallback
   * state and restart the liveness watchdog (command: reloadPanel).
   */
  reloadPanel(): void {
    this.fallbackActive = false;
    this.health?.reset();
    if (this.view) {
      this.view.webview.html = this.renderHtml();
      this.health?.start();
    }
  }

  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };

    this.health = WebviewHealth.create({
      onEvent: (ev) => this.notify(ev),
      ping: () => {
        void view.webview
          .postMessage({ type: 'ping' })
          .then(
            () => undefined,
            () => undefined
          );
      },
      retry: () => {
        /* re-navigating the webview clears the service-worker race */
        this.fallbackActive = false;
        view.webview.html = this.renderHtml();
        this.health?.start();
      },
      fallback: () => {
        this.fallbackActive = true;
        view.webview.html = this.renderFallbackHtml();
      }
    });

    try {
      view.webview.html = this.renderHtml();
    } catch {
      /* html construction itself failed — go straight to the tree fallback */
      this.fallbackActive = true;
      view.webview.html = this.renderFallbackHtml();
      this.notify('fallback');
      return;
    }
    this.health.start();

    view.webview.onDidReceiveMessage((msg: PanelClick) => {
      try {
        if (msg && msg.type === 'pong') {
          this.health?.pong();
          return;
        }
        this.onClick(msg);
      } catch {
        /* never let a panel click crash the host */
      }
    });

    view.onDidChangeVisibility(() => {
      if (!this.health) {
        return;
      }
      if (view.visible) {
        /* resume watching — a healthy page answers the next ping in ~1s */
        if (!this.fallbackActive && this.health.getState() !== 'fallback') {
          this.health.start();
        }
      } else {
        this.health.stop();
      }
      if (view.visible) {
        this.postState();
      }
    });

    view.onDidDispose(() => {
      this.health?.dispose();
      this.health = undefined;
      if (this.view === view) {
        this.view = undefined;
      }
    });
  }

  private notify(ev: WebviewEvent): void {
    try {
      this.hooks.onWebviewEvent?.(ev);
    } catch {
      /* hooks must never crash the provider */
    }
  }

  private currentStatus(): PanelStatus {
    if (!this.doctorStatus) {
      return { state: 'checking', library: null, compilerOk: false, platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux', busy: this.busy, busyLabel: this.busyLabel };
    }
    return {
      state: this.doctorStatus.graphicsReady ? 'ready' : 'not-ready',
      library: this.doctorStatus.bestLibrary,
      compilerOk: this.doctorStatus.compilerCheck.ok,
      platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
      busy: this.busy,
      busyLabel: this.busyLabel
    };
  }

  private postState(): void {
    if (!this.view) {
      return;
    }
    /* full re-render: the HTML is cheap to rebuild and always consistent */
    this.view.webview.html = this.fallbackActive ? this.renderFallbackHtml() : this.renderHtml();
  }

  private postBusy(): void {
    if (!this.view || this.fallbackActive) {
      return;
    }
    if (!this.busy) {
      this.postState(); /* clear the spinner with a fresh render */
      return;
    }
    void this.view.webview
      .postMessage({ type: 'busy', busy: true, label: this.busyLabel })
      .then(
        () => undefined,
        () => undefined
      );
  }

  private renderHtml(): string {
    if (!this.view) {
      return '';
    }
    const nonce = randomBytes(12).toString('hex');
    return buildPanelHtml({
      programs: this.programs.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        emoji: p.emoji,
        filename: p.filename,
        tag: p.tag
      })),
      commands: COMMAND_META,
      status: this.currentStatus(),
      version: this.version,
      nonce,
      cspSource: this.view.webview.cspSource
    });
  }

  private renderFallbackHtml(): string {
    if (!this.view) {
      return '';
    }
    const nonce = randomBytes(12).toString('hex');
    return buildFallbackPanelHtml({
      version: this.version,
      nonce,
      cspSource: this.view.webview.cspSource,
      reason: 'The panel page failed to load in this VS Code window (service worker error).'
    });
  }
}
