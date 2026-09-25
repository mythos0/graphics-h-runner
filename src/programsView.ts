/**
 * programsView.ts — TreeDataProvider for the graphics.h sidebar (activity bar).
 *
 * Layout (top -> bottom, so the commands are immediately visible):
 *   ▸ Commands            — one click runs the command (keys shown on the right)
 *   ▸ Example Programs    — all bundled graphics.h sample programs
 *   ▸ Quick Templates     — minimal starting-point code templates
 *
 * Clicking a program fires graphics-h-runner.openProgram, which opens it
 * in the editor as filename.cpp.
 */

import * as vscode from 'vscode';
import { COMMAND_META, LoadedProgram } from './programs';

export type TreeNode =
  | { kind: 'section'; id: string; label: string; icon: string; children: TreeNode[] }
  | { kind: 'command'; id: string; commandId: string; title: string; hint: string; icon: string }
  | { kind: 'program'; id: string; program: LoadedProgram };

export class ProgramsViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly programs: LoadedProgram[]) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
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

  getChildren(el?: TreeNode): TreeNode[] {
    if (!el) {
      const cmdNodes: TreeNode[] = COMMAND_META.map(
        (c): TreeNode => ({ kind: 'command', id: c.id, commandId: c.commandId, title: c.title, hint: c.hint, icon: c.icon })
      );
      const sampleNodes: TreeNode[] = this.programs
        .filter((p) => p.kind === 'sample')
        .map((p): TreeNode => ({ kind: 'program', id: 'prog-' + p.id, program: p }));
      const templateNodes: TreeNode[] = this.programs
        .filter((p) => p.kind === 'template')
        .map((p): TreeNode => ({ kind: 'program', id: 'prog-' + p.id, program: p }));

      return [
        { kind: 'section', id: 'sec-commands',  label: 'Commands',                          icon: 'zap',           children: cmdNodes },
        { kind: 'section', id: 'sec-samples',   label: 'Example Programs (graphics.h)',     icon: 'folder-opened', children: sampleNodes },
        { kind: 'section', id: 'sec-templates', label: 'Quick Templates',                   icon: 'folder-opened', children: templateNodes }
      ];
    }
    if (el.kind === 'section') {
      return el.children;
    }
    return [];
  }
}
