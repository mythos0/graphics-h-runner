"use strict";
/**
 * programsTreeModel.ts — pure data model for the graphics.h fallback
 * TreeView (no vscode import — unit-testable in plain node).
 *
 * The list view mirrors the webview panel: the same 8 actions and the same
 * 18 example programs, so a webview failure costs the user zero features.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREE_RUN_COMMAND_PREFIX = exports.TREE_RUN_COMMAND = void 0;
exports.treeRunCommandId = treeRunCommandId;
exports.buildTreeModel = buildTreeModel;
const programs_1 = require("./programs");
/** Generic "run an example program" command (palette + programmatic use;
 * takes the program id as its single argument). */
exports.TREE_RUN_COMMAND = 'graphics-h-runner.runSample';
/**
 * Per-node command ids for the fallback tree: TREE_RUN_COMMAND + '.' + id.
 *
 * v1.5.5 BUG FIX — TreeItem.command must NOT carry `arguments`. VS Code's
 * command converter caches argument-carrying tree commands under a
 * throwaway delegate id ("graphics-h-runner.runSample /N"); when the
 * extension host restarts (or the cache entry is disposed) while the tree
 * is still rendered, EVERY click fails with
 *   "Actual command not found, wanted to execute
 *    graphics-h-runner.runSample /2"
 * Static per-node ids involve no converter cache and survive every host
 * restart — the extension re-registers them all on activation.
 */
exports.TREE_RUN_COMMAND_PREFIX = 'graphics-h-runner.runSample.';
/** Static per-node command id for one example program. */
function treeRunCommandId(programId) {
    return exports.TREE_RUN_COMMAND_PREFIX + programId;
}
/**
 * Pure model: actions first, then every example program.
 */
function buildTreeModel(programs) {
    const entries = [
        { kind: 'section', id: 'tree-section-actions', label: 'Actions' }
    ];
    for (const c of programs_1.COMMAND_META) {
        entries.push({ kind: 'action', id: c.id, label: c.title, hint: c.hint, commandId: c.commandId });
    }
    const main = programs.filter((p) => !p.lab);
    const lab = programs.filter((p) => p.lab);
    entries.push({
        kind: 'section',
        id: 'tree-section-programs',
        label: `Example Programs (${main.length})`
    });
    for (const p of main) {
        entries.push({
            kind: 'program',
            id: p.id,
            label: p.title,
            description: p.description,
            filename: p.filename,
            runCommandId: treeRunCommandId(p.id)
        });
    }
    if (lab.length > 0) {
        entries.push({
            kind: 'section',
            id: 'tree-section-lab',
            label: `Computer Graphics Lab (${lab.length})`
        });
        for (const p of lab) {
            entries.push({
                kind: 'program',
                id: p.id,
                label: p.title,
                description: p.description,
                filename: p.filename,
                runCommandId: treeRunCommandId(p.id)
            });
        }
    }
    return entries;
}
//# sourceMappingURL=programsTreeModel.js.map