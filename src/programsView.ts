/**
 * programsView.ts — TreeDataProvider for the graphics.h sidebar (activity bar).
 *
 * Layout (top -> bottom, ordered by what a user needs first):
 *   ● Environment         — live status: Ready / Not ready / Checking…
 *   ⚡ Set up everything   — one-click fix, shown while the environment is
 *                            NOT ready (disappears once it is)
 *   ▸ Commands            — compile & run, setup, doctor, templates, guide
 *   ▸ Example Programs    — all bundled graphics.h sample programs
 *   ▸ Quick Templates     — minimal starting-point code (collapsed by default)
 *
 * Clicking a program fires graphics-h-runner.openProgram, which opens it
 * in the editor as filename.cpp. Clicking the environment row (or the fix)
 * runs the Setup Doctor / Full Setup respectively.
 */

import * as vscode from 'vscode';
import { COMMAND_META, LoadedProgram } from './programs';

export type TreeNode =
  | { kind: 'section'; id: string; label: string; icon: string; children: TreeNode[]; collapsed?: boolean }
  | { kind: 'command'; id: string; commandId: string; title: string; hint: string; icon: string }
  | { kind: 'program'; id: string; program: LoadedProgram }
  | { kind: 'status'; id: string };

/** Structural subset of doctor.ts's DoctorResult (keeps this module light). */
export interface ViewDoctorStatus {
  graphicsReady: boolean;
  bestLibrary: string | null;
  compilerCheck: { ok: boolean };
  libraryChecks: Array<{ name: string; ok: boolean }>;
}

export class ProgramsViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private doctorStatus: ViewDoctorStatus | undefined;

  constructor(private readonly programs: LoadedProgram[]) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Called by the extension whenever a doctor probe finishes (or resets). */
  setDoctorResult(res: ViewDoctorStatus | undefined): void {
    this.doctorStatus = res;
    this.refresh();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'status') {
      return this.statusItem();
    }

    if (node.kind === 'section') {
      const item = new vscode.TreeItem(
        node.label,
        node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = node.id;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = 'section';
      return item;
    }

    if (node.kind === 'command') {
      const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.description = node.hint;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = 'command';
      item.command = { command: node.commandId, title: node.title };
      return item;
    }

    const item = new vscode.TreeItem(node.program.title, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.program.filename;
    item.tooltip = new vscode.MarkdownString(
      `**${node.program.title}**  \n${node.program.description}  \n\n` +
      `_Click to open as_ \`${node.program.filename}\``
    );
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.contextValue = 'program';
    item.command = {
      command: 'graphics-h-runner.openProgram',
      title: 'Open Program',
      arguments: [node.program]
    };
    return item;
  }

  private statusItem(): vscode.TreeItem {
    const item = new vscode.TreeItem('Environment', vscode.TreeItemCollapsibleState.None);
    item.id = 'environment-status';
    item.command = { command: 'graphics-h-runner.doctor', title: 'Setup Doctor' };

    if (!this.doctorStatus) {
      item.description = 'checking…';
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      item.contextValue = 'status-checking';
      item.tooltip = new vscode.MarkdownString('The Setup Doctor is probing the compiler and graphics libraries…');
      return item;
    }

    const lib = this.doctorStatus.bestLibrary;
    if (this.doctorStatus.graphicsReady) {
      item.description = `Ready — ${lib}`;
      item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      item.contextValue = 'status-ready';
      item.tooltip = new vscode.MarkdownString(
        '**graphics.h is ready to use.**  \nCompiler OK, library: `' + (lib ?? '?') + '`.  \n\n' +
        '_Open an example below and press **Ctrl+Alt+R**._  \nClick to re-run the Setup Doctor.'
      );
      return item;
    }

    const reason = this.doctorStatus.compilerCheck.ok
      ? 'no graphics library found'
      : 'no working C++ compiler';
    item.description = `Not ready — ${reason}`;
    item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
    item.contextValue = 'status-not-ready';
    item.tooltip = new vscode.MarkdownString(
      `**graphics.h is NOT ready yet** (${reason}).  \n\n` +
      '_Click **“Set up everything”** below — it installs everything automatically, no admin rights._  \n' +
      'Click this row to see the detailed Setup Doctor report.'
    );
    return item;
  }

  getChildren(el?: TreeNode): TreeNode[] {
    if (!el) {
      const cmdNodes: TreeNode[] = COMMAND_META.map(
        (c): TreeNode => ({ kind: 'command', id: c.id, commandId: c.commandId, title: c.title, hint: c.hint, icon: c.icon })
      );

      const nodes: TreeNode[] = [{ kind: 'status', id: 'environment-status' }];

      /* one-click fix while the environment is broken — the single most
       * important action for a fresh-PC user */
      if (this.doctorStatus && !this.doctorStatus.graphicsReady) {
        nodes.push({
          kind: 'command',
          id: 'cta-setup-everything',
          commandId: 'graphics-h-runner.setupEverything',
          title: 'Set up everything (fix this)',
          hint: 'recommended',
          icon: 'rocket'
        });
      }

      const sampleNodes: TreeNode[] = this.programs
        .filter((p) => p.kind === 'sample')
        .map((p): TreeNode => ({ kind: 'program', id: 'prog-' + p.id, program: p }));
      const templateNodes: TreeNode[] = this.programs
        .filter((p) => p.kind === 'template')
        .map((p): TreeNode => ({ kind: 'program', id: 'prog-' + p.id, program: p }));

      nodes.push(
        { kind: 'section', id: 'sec-commands',  label: 'Commands',        icon: 'zap',           children: cmdNodes },
        { kind: 'section', id: 'sec-samples',   label: 'Example Programs', icon: 'folder-opened', children: sampleNodes },
        { kind: 'section', id: 'sec-templates', label: 'Quick Templates',  icon: 'folder',        children: templateNodes, collapsed: true }
      );
      return nodes;
    }
    if (el.kind === 'section') {
      return el.children;
    }
    return [];
  }
}
