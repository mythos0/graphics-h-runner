"use strict";
/**
 * debugAdapter.ts — a minimal "run-only" debug adapter for the
 * `graphics-h` debug type.
 *
 * Why: pressing F5 (Run and Debug) with no launch.json shows a picker of
 * available debuggers. Registering the `graphics-h` type + a tiny inline
 * adapter makes "Run graphics.h program" appear there next to the C/C++
 * extension's own entries, and running it compiles & launches the
 * graphics window through the extension's normal pipeline.
 *
 * The adapter implements just enough DAP to survive a session:
 * initialize → launch (compile + spawn) → terminated. It does NOT do
 * real debugging (breakpoints/stepping) — breakpoints are accepted but
 * ignored.
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
exports.registerGraphicsHDebugger = registerGraphicsHDebugger;
const vscode = __importStar(require("vscode"));
/** Minimal DAP adapter (inline implementation). */
class GraphicsRunAdapter {
    constructor(launch) {
        this.launch = launch;
        this.messages = new vscode.EventEmitter();
        this.onDidSendMessage = this.messages.event;
        this.seq = 1;
        this.terminated = false;
        this.active = false;
    }
    dispose() {
        this.terminated = true;
    }
    handleMessage(message) {
        const msg = message;
        const type = msg.type;
        const command = msg.command;
        const requestSeq = typeof msg.seq === 'number' ? msg.seq : 0;
        if (type === 'request') {
            switch (command) {
                case 'initialize':
                    this.respond(requestSeq, command, true, {
                        supportsConfigurationDoneRequest: true,
                        supportsTerminateRequest: true,
                        supportTerminateDebuggee: true,
                        supportsRestartRequest: false
                    });
                    this.sendEvent('initialized', {});
                    break;
                case 'launch':
                case 'attach': {
                    const args = (msg.arguments || {});
                    const file = pickSourceFile(args);
                    if (!file) {
                        this.respond(requestSeq, command, false, undefined, 'Open the .cpp file you want to run, then start debugging again.');
                        this.sendEvent('terminated', {});
                        return;
                    }
                    this.active = true;
                    /* respond success right away; progress flows via output events */
                    this.respond(requestSeq, command, true, {});
                    this.out(`graphics.h Runner: launching ${file.split(/[\\/]/).pop()}`);
                    void this.launch(file, (line) => this.out(line)).then((res) => {
                        if (res.message) {
                            this.out(res.message);
                        }
                        if (!res.ok) {
                            this.out('graphics.h Runner: launch failed — see the graphics.h Runner output channel.');
                        }
                        this.finishSession();
                    });
                    break;
                }
                case 'configurationDone':
                case 'setBreakPoints':
                case 'setBreakpoints':
                case 'setExceptionBreakpoints':
                case 'threads':
                case 'terminate':
                case 'restart':
                    this.respond(requestSeq, command, true, command === 'threads' ? { threads: [threadMain()] } : {});
                    if (command === 'terminate') {
                        this.finishSession();
                    }
                    break;
                case 'stackTrace':
                    this.respond(requestSeq, command, true, { stackFrames: [], totalFrames: 0 });
                    break;
                case 'disconnect':
                    this.active = false;
                    this.respond(requestSeq, command, true, {});
                    this.finishSession();
                    break;
                case 'loadedSources':
                case 'scopes':
                case 'variables':
                case 'evaluate':
                    /* run-only adapter: nothing to inspect */
                    this.respond(requestSeq, command, true, command === 'loadedSources' ? { sources: [] } : command === 'scopes' ? { scopes: [] } : command === 'variables' ? { variables: [] } : {});
                    break;
                default:
                    this.respond(requestSeq, command, false, undefined, `'${command}' is not supported by the graphics.h run adapter.`);
                    break;
            }
        }
    }
    finishSession() {
        if (this.terminated) {
            return;
        }
        this.terminated = true;
        if (this.active) {
            this.sendEvent('exited', { exitCode: 0 });
        }
        this.sendEvent('terminated', {});
    }
    out(text) {
        this.sendEvent('output', { output: text + '\n', category: 'console' });
    }
    sendEvent(event, body) {
        this.emit({ seq: 0, type: 'event', event, body });
    }
    respond(requestSeq, command, success, body, messageText) {
        const payload = { seq: 0, type: 'response', request_seq: requestSeq, success, command };
        if (body) {
            payload.body = body;
        }
        if (messageText) {
            payload.message = messageText;
        }
        this.emit(payload);
    }
    emit(payload) {
        payload.seq = this.seq++;
        this.messages.fire(payload);
    }
}
function threadMain() {
    return { id: 1, name: 'graphics program' };
}
/** Resolve the target source file from launch args (falls back to the active editor). */
function pickSourceFile(args) {
    const program = typeof args.program === 'string' ? args.program : '';
    if (program && !program.includes('${') && /\.(cpp|cc|cxx|c)$/i.test(program)) {
        return program;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && /\.(cpp|cc|cxx|c)$/i.test(editor.document.fileName)) {
        return editor.document.fileName;
    }
    return undefined;
}
/**
 * Register the whole `graphics-h` debug experience:
 *  - configuration provider (puts "Run graphics.h program" into the F5 picker)
 *  - inline adapter factory (compiles & launches through `launch`)
 */
function registerGraphicsHDebugger(context, launch) {
    const provider = {
        provideDebugConfigurations(_folder) {
            return [
                {
                    type: 'graphics-h',
                    request: 'launch',
                    name: 'Run graphics.h program',
                    program: '${file}',
                    stopOthers: true
                }
            ];
        },
        resolveDebugConfiguration(_folder, config) {
            if (config && config.type === 'graphics-h') {
                if (!config.program) {
                    config.program = '${file}';
                }
                return config;
            }
            return null; /* not ours — let other debuggers handle it */
        }
    };
    const factory = {
        createDebugAdapterDescriptor() {
            return new vscode.DebugAdapterInlineImplementation(new GraphicsRunAdapter(launch));
        }
    };
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('graphics-h', provider), vscode.debug.registerDebugAdapterDescriptorFactory('graphics-h', factory));
}
//# sourceMappingURL=debugAdapter.js.map