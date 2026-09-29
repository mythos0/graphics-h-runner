"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GhProgramsTreeProvider = exports.GhActionsTreeProvider = exports.TREE_RUN_COMMAND = exports.buildProgramEntries = exports.buildActionEntries = void 0;
const vscode = __importStar(require("vscode"));
const programsTreeModel_1 = require("./programsTreeModel");
var programsTreeModel_2 = require("./programsTreeModel");
Object.defineProperty(exports, "buildActionEntries", { enumerable: true, get: function () { return programsTreeModel_2.buildActionEntries; } });
Object.defineProperty(exports, "buildProgramEntries", { enumerable: true, get: function () { return programsTreeModel_2.buildProgramEntries; } });
Object.defineProperty(exports, "TREE_RUN_COMMAND", { enumerable: true, get: function () { return programsTreeModel_2.TREE_RUN_COMMAND; } });
/** Native codicon per panel action (the tree renders native icons, not emoji). */
const ACTION_ICONS = {
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
function buildActionItem(entry) {
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.id = entry.id;
    item.description = entry.hint;
    item.tooltip = new vscode.MarkdownString(`**${entry.label}** — ${entry.hint}\n\nRuns the same command as the matching panel button.`);
    item.command = { command: entry.commandId, title: entry.label };
    item.iconPath = new vscode.ThemeIcon(ACTION_ICONS[entry.commandId] || 'circle-large-outline');
    item.contextValue = 'ghr-action';
    return item;
}
/** Actions (Recovery) view: the panel commands, one flat labelled list. */
class GhActionsTreeProvider {
    constructor() {
        this.entries = (0, programsTreeModel_1.buildActionEntries)();
    }
    getTreeItem(entry) {
        return buildActionItem(entry);
    }
    getChildren() {
        return this.entries;
    }
}
exports.GhActionsTreeProvider = GhActionsTreeProvider;
/** Example Programs (List) view: grouped sections of runnable programs. */
class GhProgramsTreeProvider {
    constructor(programs) {
        this.entries = (0, programsTreeModel_1.buildProgramEntries)(programs);
    }
    getTreeItem(entry) {
        if (entry.kind === 'section') {
            const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.Expanded);
            item.id = entry.id;
            item.contextValue = 'ghr-section';
            item.iconPath = new vscode.ThemeIcon(entry.id === 'tree-section-lab' ? 'mortar-board' : 'library');
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
        item.tooltip = new vscode.MarkdownString(`**${entry.label}**  \n${entry.description}  \n\`${entry.filename}\`\n\nClick to open, compile and run.`);
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
    getChildren(element) {
        if (!element) {
            return this.entries.filter((e) => e.kind === 'section');
        }
        if (element.kind === 'section') {
            const labSection = element.id === 'tree-section-lab';
            return this.entries.filter((e) => e.kind === 'program' && e.lab === labSection);
        }
        return [];
    }
}
exports.GhProgramsTreeProvider = GhProgramsTreeProvider;
//# sourceMappingURL=programsTree.js.map