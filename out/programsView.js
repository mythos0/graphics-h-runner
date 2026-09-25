"use strict";
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
exports.ProgramsViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const programs_1 = require("./programs");
class ProgramsViewProvider {
    constructor(programs) {
        this.programs = programs;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(node) {
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
        item.tooltip = new vscode.MarkdownString(`**${node.program.title}**  \n${node.program.description}  \n\n` +
            `_Click to open as_ \`${node.program.filename}\``);
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.contextValue = 'program';
        item.command = {
            command: 'graphics-h-runner.openProgram',
            title: 'Open Program',
            arguments: [node.program]
        };
        return item;
    }
    getChildren(el) {
        if (!el) {
            const cmdNodes = programs_1.COMMAND_META.map((c) => ({ kind: 'command', id: c.id, commandId: c.commandId, title: c.title, hint: c.hint, icon: c.icon }));
            const sampleNodes = this.programs
                .filter((p) => p.kind === 'sample')
                .map((p) => ({ kind: 'program', id: 'prog-' + p.id, program: p }));
            const templateNodes = this.programs
                .filter((p) => p.kind === 'template')
                .map((p) => ({ kind: 'program', id: 'prog-' + p.id, program: p }));
            return [
                { kind: 'section', id: 'sec-commands', label: 'Commands', icon: 'zap', children: cmdNodes },
                { kind: 'section', id: 'sec-samples', label: 'Example Programs (graphics.h)', icon: 'folder-opened', children: sampleNodes },
                { kind: 'section', id: 'sec-templates', label: 'Quick Templates', icon: 'folder-opened', children: templateNodes }
            ];
        }
        if (el.kind === 'section') {
            return el.children;
        }
        return [];
    }
}
exports.ProgramsViewProvider = ProgramsViewProvider;
//# sourceMappingURL=programsView.js.map