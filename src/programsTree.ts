/**
 * programsTree.ts — native TreeView fallback for the graphics.h panel.
 *
 * If the webview fails to load (VS Code "Could not register service worker:
 * InvalidStateError" race) the extension reveals this plain list view
 * instantly, so every action and all 18 example programs stay reachable.
 *
 * The tree model comes from programsTreeModel.ts (pure, unit-tested); the
 * provider below is a thin adapter that maps model entries to TreeItems.
 */

import * as vscode from 'vscode';
import { LoadedProgram } from './programs';
import {
  buildTreeModel,
  TreeEntry,
  TreeNode,
  TreeSectionEntry
} from './programsTreeModel';

export {
  buildTreeModel,
  TREE_RUN_COMMAND
} from './programsTreeModel';
export type {
  TreeActionEntry,
  TreeProgramEntry,
  TreeSectionEntry,
  TreeEntry,
  TreeNode
} from './programsTreeModel';

export class GhFallbackTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly entries: TreeEntry[];

  constructor(programs: LoadedProgram[]) {
    this.entries = buildTreeModel(programs);
  }

  getTreeItem(entry: TreeNode): vscode.TreeItem {
    if (entry.kind === 'section') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = entry.id;
      item.contextValue = 'ghr-section';
      return item;
    }
    if (entry.kind === 'action') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
      item.id = entry.id;
      item.description = entry.hint;
      item.tooltip = entry.label + ' — ' + entry.hint;
      item.command = { command: entry.commandId, title: entry.label };
      item.contextValue = 'ghr-action';
      return item;
    }
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.id = 'tree-program-' + entry.id;
    item.description = entry.description;
    item.tooltip = new vscode.MarkdownString(
      `**${entry.label}**  \n${entry.description}  \n\`${entry.filename}\`\n\nClick to open, compile and run.`
    );
    item.command = { command: entry.runCommandId, title: 'Run example program', arguments: [entry.id] };
    item.contextValue = 'ghr-program';
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.entries.filter((e): e is TreeSectionEntry => e.kind === 'section');
    }
    if (element.kind === 'section') {
      return this.entries.filter((e) => e.kind !== 'section');
    }
    return [];
  }
}
