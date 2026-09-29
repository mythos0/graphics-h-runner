"use strict";
/**
 * programsTreeModel.ts — pure data model for the graphics.h fallback
 * TreeViews (no vscode import — unit-testable in plain node).
 *
 * v1.5.15 SPLIT — the single mixed list ("Actions" header + programs in
 * one tree) became two SEPARATE tree views so each is easy to understand
 * at a glance:
 *
 *   graphics-h-runner.fallback          → "Actions (Recovery)"
 *     flat list of the panel's 8 commands, each with its hint.
 *   graphics-h-runner.fallbackPrograms  → "Example Programs (List)"
 *     sections for the example programs and the Computer Graphics Lab.
 *
 * The list views mirror the webview panel exactly, so a webview failure
 * costs the user zero features.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREE_RUN_COMMAND_PREFIX = exports.TREE_RUN_COMMAND = void 0;
exports.treeRunCommandId = treeRunCommandId;
exports.buildActionEntries = buildActionEntries;
exports.buildProgramEntries = buildProgramEntries;
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
 * Pure model for the ACTIONS view: the panel's commands as a flat list,
 * in the same order as the panel buttons (primary Compile & Run first).
 */
function buildActionEntries() {
    return programs_1.COMMAND_META.map((c) => ({
        kind: 'action',
        id: c.id,
        label: c.title,
        hint: c.hint,
        commandId: c.commandId
    }));
}
/**
 * Pure model for the EXAMPLE PROGRAMS view: a section header per group
 * (main examples, then the Computer Graphics Lab when present), each
 * followed by its program leaves.
 */
function buildProgramEntries(programs) {
    const entries = [];
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
            lab: false,
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
                lab: true,
                runCommandId: treeRunCommandId(p.id)
            });
        }
    }
    return entries;
}
//# sourceMappingURL=programsTreeModel.js.map