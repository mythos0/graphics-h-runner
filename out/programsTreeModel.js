"use strict";
/**
 * programsTreeModel.ts — pure data model for the graphics.h fallback
 * TreeView (no vscode import — unit-testable in plain node).
 *
 * The list view mirrors the webview panel: the same 8 actions and the same
 * 18 example programs, so a webview failure costs the user zero features.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREE_RUN_COMMAND = void 0;
exports.buildTreeModel = buildTreeModel;
const programs_1 = require("./programs");
/** Command id used for "click a program to run it" in the fallback tree. */
exports.TREE_RUN_COMMAND = 'graphics-h-runner.runSample';
/**
 * Pure model: actions first, then every example program.
 */
function buildTreeModel(programs, runCommandId = exports.TREE_RUN_COMMAND) {
    const entries = [
        { kind: 'section', id: 'tree-section-actions', label: 'Actions' }
    ];
    for (const c of programs_1.COMMAND_META) {
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
//# sourceMappingURL=programsTreeModel.js.map