/**
 * programsTreeModel.ts — pure data model for the graphics.h fallback
 * TreeView (no vscode import — unit-testable in plain node).
 *
 * The list view mirrors the webview panel: the same 8 actions and the same
 * 18 example programs, so a webview failure costs the user zero features.
 */

import { COMMAND_META, LoadedProgram } from './programs';

export interface TreeActionEntry {
  kind: 'action';
  id: string;
  label: string;
  hint: string;
  commandId: string;
}

export interface TreeProgramEntry {
  kind: 'program';
  id: string;
  label: string;
  description: string;
  filename: string;
  /** Command invoked on click, with the program id as the only argument. */
  runCommandId: string;
}

export interface TreeSectionEntry {
  kind: 'section';
  id: string;
  label: string;
}

export type TreeEntry = TreeSectionEntry | TreeActionEntry | TreeProgramEntry;

/** Node identity inside the tree: sections expand, leaves carry commands. */
export type TreeNode = TreeSectionEntry | TreeActionEntry | TreeProgramEntry;

/** Command id used for "click a program to run it" in the fallback tree. */
export const TREE_RUN_COMMAND = 'graphics-h-runner.runSample';

/**
 * Pure model: actions first, then every example program.
 */
export function buildTreeModel(
  programs: Array<Pick<LoadedProgram, 'id' | 'title' | 'description' | 'filename'>>,
  runCommandId: string = TREE_RUN_COMMAND
): TreeEntry[] {
  const entries: TreeEntry[] = [
    { kind: 'section', id: 'tree-section-actions', label: 'Actions' }
  ];
  for (const c of COMMAND_META) {
    entries.push({ kind: 'action', id: c.id, label: c.title, hint: c.hint, commandId: c.commandId });
  }
  entries.push({
    kind: 'section',
    id: 'tree-section-programs',
    label: `Example Programs (${programs.length})`
  });
  for (const p of programs) {
    entries.push({
      kind: 'program',
      id: p.id,
      label: p.title,
      description: p.description,
      filename: p.filename,
      runCommandId
    });
  }
  return entries;
}
