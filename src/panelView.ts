/**
 * panelView.ts — WebviewViewProvider for the graphics.h activity-bar
 * panel (view id: graphics-h-runner.programs).
 *
 * Replaces the old plain TreeDataProvider with a modern webpage-style
 * panel: gradient hero, live environment status, action buttons and an
 * emoji card grid for all example programs. All clicks flow back to the
 * extension through postMessage.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { buildPanelHtml, PanelStatus } from './panelHtml';
import { COMMAND_META, LoadedProgram } from './programs';

/** Structural subset of doctor.ts's DoctorResult (keeps this module light). */
export interface ViewDoctorStatus {
  graphicsReady: boolean;
  bestLibrary: string | null;
  compilerCheck: { ok: boolean };
}

export type PanelClick =
  | { type: 'command'; command: string }
  | { type: 'runProgram'; id: string }
  | { type: 'openProgram'; id: string };

export class GhPanelProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = 'graphics-h-runner.programs';

  private view: vscode.WebviewView | undefined;
  private doctorStatus: ViewDoctorStatus | undefined;
  private busy = false;
  private busyLabel: string | null = null;

  constructor(
    private readonly extensionRoot: string,
    private readonly version: string,
    private readonly programs: LoadedProgram[],
    private readonly onClick: (msg: PanelClick) => void
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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderHtml();

    view.webview.onDidReceiveMessage((msg: PanelClick) => {
      try {
        this.onClick(msg);
      } catch {
        /* never let a panel click crash the host */
      }
    });

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.postState();
      }
    });
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
    this.view.webview.html = this.renderHtml();
  }

  private postBusy(): void {
    if (!this.view) {
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
}
