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

import * as vscode from 'vscode';

/** Result of the launch callback provided by extension.ts. */
export interface LaunchOutcome {
  ok: boolean;
  message: string;
}

export type LaunchFn = (
  sourceFile: string,
  output: (line: string) => void
) => Promise<LaunchOutcome>;

/** Minimal DAP adapter (inline implementation). */
class GraphicsRunAdapter implements vscode.DebugAdapter {
  private readonly messages = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this.messages.event;

  private seq = 1;
  private terminated = false;
  private active = false;

  constructor(private readonly launch: LaunchFn) {}

  dispose(): void {
    this.terminated = true;
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const msg = message as Record<string, unknown>;
    const type = msg.type as string;
    const command = msg.command as string;
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
          const args = (msg.arguments || {}) as Record<string, unknown>;
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
          this.respond(
            requestSeq,
            command,
            true,
            command === 'loadedSources' ? { sources: [] } : command === 'scopes' ? { scopes: [] } : command === 'variables' ? { variables: [] } : {}
          );
          break;

        default:
          this.respond(requestSeq, command, false, undefined, `'${command}' is not supported by the graphics.h run adapter.`);
          break;
      }
    }
  }

  private finishSession(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    if (this.active) {
      this.sendEvent('exited', { exitCode: 0 });
    }
    this.sendEvent('terminated', {});
  }

  private out(text: string): void {
    this.sendEvent('output', { output: text + '\n', category: 'console' });
  }

  private sendEvent(event: string, body: Record<string, unknown>): void {
    this.emit({ seq: 0, type: 'event', event, body });
  }

  private respond(requestSeq: number, command: string, success: boolean, body?: Record<string, unknown>, messageText?: string): void {
    const payload: Record<string, unknown> = { seq: 0, type: 'response', request_seq: requestSeq, success, command };
    if (body) {
      payload.body = body;
    }
    if (messageText) {
      payload.message = messageText;
    }
    this.emit(payload);
  }

  private emit(payload: Record<string, unknown>): void {
    payload.seq = this.seq++;
    this.messages.fire(payload as vscode.DebugProtocolMessage);
  }
}

function threadMain(): Record<string, unknown> {
  return { id: 1, name: 'graphics program' };
}

/** Resolve the target source file from launch args (falls back to the active editor). */
function pickSourceFile(args: Record<string, unknown>): string | undefined {
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
export function registerGraphicsHDebugger(
  context: vscode.ExtensionContext,
  launch: LaunchFn
): void {
  const provider: vscode.DebugConfigurationProvider = {
    provideDebugConfigurations(_folder: vscode.WorkspaceFolder | undefined): vscode.DebugConfiguration[] {
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
    resolveDebugConfiguration(_folder, config: vscode.DebugConfiguration): vscode.DebugConfiguration | null | undefined {
      if (config && config.type === 'graphics-h') {
        if (!config.program) {
          config.program = '${file}';
        }
        return config;
      }
      return null; /* not ours — let other debuggers handle it */
    }
  };

  const factory: vscode.DebugAdapterDescriptorFactory = {
    createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
      return new vscode.DebugAdapterInlineImplementation(new GraphicsRunAdapter(launch));
    }
  };

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('graphics-h', provider),
    vscode.debug.registerDebugAdapterDescriptorFactory('graphics-h', factory)
  );
}
