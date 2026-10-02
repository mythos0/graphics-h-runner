/**
 * programsTree.ts — native TreeView fallback for the graphics.h panel.
 *
 * If the webview fails to load (VS Code "Could not register service worker:
 * InvalidStateError" race) the extension reveals two plain list views
 * instantly, so every action and all example programs stay reachable.
 *
 * v1.5.15 — the single mixed tree became TWO SEPARATE views (user: "keep
 * them separate and easy to understand"):
 *
 *   GhActionsTreeProvider   → view "Actions (Recovery)":
 *     the panel's commands as a flat, icon-labelled list.
 *   GhProgramsTreeProvider  → view "Example Programs (List)":
 *     sections for the examples and the Computer Graphics Lab; clicking a
 *     program opens, compiles and runs it in one step.
 *
 * The tree models come from programsTreeModel.ts (pure, unit-tested); the
 * providers below are thin adapters that map model entries to TreeItems.
 *
 * v1.5.5: program items invoke STATIC per-node command ids
 * (graphics-h-runner.runSample.<id>) — never TreeItem.command arguments,
 * which break across extension-host restarts.
 */

import * as vscode from 'vscode';
import { LoadedProgram } from './programs';
import {
  buildActionEntries,
  buildProgramEntries,
  TreeActionEntry,
  TreeEntry,
  TreeProgramEntry,
  TreeSectionEntry,
  TreeNode
} from './programsTreeModel';

export {
  buildActionEntries,
  buildProgramEntries,
  TREE_RUN_COMMAND
} from './programsTreeModel';
export type {
  TreeActionEntry,
  TreeProgramEntry,
  TreeSectionEntry,
  TreeEntry,
  TreeNode
} from './programsTreeModel';

/** Native codicon per panel action (the tree renders native icons, not emoji). */
const ACTION_ICONS: Record<string, string> = {
  'graphics-h-runner.compileAndRun': 'play',
  'graphics-h-runner.setupEverything': 'rocket',
  'graphics-h-runner.doctor': 'pulse',
  'graphics-h-runner.compile': 'tools',
  'graphics-h-runner.run': 'terminal',
  'graphics-h-runner.stopProgram': 'debug-stop',
  'graphics-h-runner.copyCompileCommand': 'copy',
  'graphics-h-runner.fireworks': 'sparkle'
};

/** Build the TreeItem for one panel action (shared by both providers). */
function buildActionItem(entry: TreeActionEntry): vscode.TreeItem {
  const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
  item.id = entry.id;
  item.description = entry.hint;
  item.tooltip = new vscode.MarkdownString(
    `**${entry.label}** — ${entry.hint}\n\nRuns the same command as the matching panel button.`
  );
  item.command = { command: entry.commandId, title: entry.label };
  item.iconPath = new vscode.ThemeIcon(ACTION_ICONS[entry.commandId] || 'circle-large-outline');
  item.contextValue = 'ghr-action';
  return item;
}

/** Actions (Recovery) view: the panel commands, one flat labelled list. */
export class GhActionsTreeProvider implements vscode.TreeDataProvider<TreeActionEntry> {
  private readonly entries: TreeActionEntry[];

  constructor() {
    this.entries = buildActionEntries();
  }

  getTreeItem(entry: TreeActionEntry): vscode.TreeItem {
    return buildActionItem(entry);
  }

  getChildren(): TreeActionEntry[] {
    return this.entries;
  }
}

/** Example Programs (List) view: grouped sections of runnable programs. */
export class GhProgramsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly entries: TreeEntry[];

  constructor(programs: LoadedProgram[]) {
    this.entries = buildProgramEntries(programs);
  }

  getTreeItem(entry: TreeNode): vscode.TreeItem {
    if (entry.kind === 'section') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = entry.id;
      item.contextValue = 'ghr-section';
      item.iconPath = new vscode.ThemeIcon(
        entry.id === 'tree-section-lab' ? 'mortar-board' : 'library'
      );
      return item;
    }
    if (entry.kind === 'action') {
      /* Actions never appear in the programs view's model; this branch only
       * keeps the provider total over the TreeNode union. */
      return buildActionItem(entry);
    }
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.id = 'tree-program-' + entry.id;
    item.description = entry.description;
    item.tooltip = new vscode.MarkdownString(
      `**${entry.label}**  \n${entry.description}  \n\`${entry.filename}\`\n\nClick to open, compile and run.`
    );
    /* v1.5.5: NO `arguments` here — VS Code caches argument-carrying tree
     * commands under a throwaway id, and after a host restart every click
     * fails with "Actual command not found, wanted to execute
     * graphics-h-runner.runSample /N". Each program has its own static
     * command id instead (registered on every activation). */
    item.command = { command: entry.runCommandId, title: 'Run example program' };
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.contextValue = 'ghr-program';
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.entries.filter((e): e is TreeSectionEntry => e.kind === 'section');
    }
    if (element.kind === 'section') {
      const labSection = element.id === 'tree-section-lab';
      return this.entries.filter(
        (e): e is TreeProgramEntry => e.kind === 'program' && e.lab === labSection
      );
    }
    return [];
  }
}
