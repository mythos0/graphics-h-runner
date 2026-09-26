"use strict";
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
exports.GhFallbackTreeProvider = exports.TREE_RUN_COMMAND = exports.buildTreeModel = void 0;
const vscode = __importStar(require("vscode"));
const programsTreeModel_1 = require("./programsTreeModel");
var programsTreeModel_2 = require("./programsTreeModel");
Object.defineProperty(exports, "buildTreeModel", { enumerable: true, get: function () { return programsTreeModel_2.buildTreeModel; } });
Object.defineProperty(exports, "TREE_RUN_COMMAND", { enumerable: true, get: function () { return programsTreeModel_2.TREE_RUN_COMMAND; } });
class GhFallbackTreeProvider {
    constructor(programs) {
        this.entries = (0, programsTreeModel_1.buildTreeModel)(programs);
    }
    getTreeItem(entry) {
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
        item.tooltip = new vscode.MarkdownString(`**${entry.label}**  \n${entry.description}  \n\`${entry.filename}\`\n\nClick to open, compile and run.`);
        item.command = { command: entry.runCommandId, title: 'Run example program', arguments: [entry.id] };
        item.contextValue = 'ghr-program';
        return item;
    }
    getChildren(element) {
        if (!element) {
            return this.entries.filter((e) => e.kind === 'section');
        }
        if (element.kind === 'section') {
            return this.entries.filter((e) => e.kind !== 'section');
        }
        return [];
    }
}
exports.GhFallbackTreeProvider = GhFallbackTreeProvider;
//# sourceMappingURL=programsTree.js.map