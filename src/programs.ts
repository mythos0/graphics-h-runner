/**
 * programs.ts — catalog of the example programs shipped with the
 * extension (samples/*.cpp inside the .vsix) plus the command list
 * shown in the graphics.h webview panel.
 *
 * Clicking a program card opens it in the editor as a real
 * filename.cpp (created under <workspace>/graphics-h-programs/ when a
 * folder is open, or as an untitled document otherwise); the card's
 * Run button opens AND compiles AND runs it in one click.
 */

import * as fs from 'fs';
import * as path from 'path';

export type ProgramKind = 'sample';

export interface ProgramMeta {
  id: string;
  kind: ProgramKind;
  filename: string;
  title: string;
  description: string;
  emoji: string;
  tag: 'classic' | 'fun' | 'interactive' | 'math' | 'lab';
  /** v1.5.0: true for the Computer Graphics Lab section. */
  lab?: boolean;
}

export interface LoadedProgram extends ProgramMeta {
  source: string;
}

/** Pure helper: where should a program file live inside a workspace? */
export function resolveProgramTarget(
  workspaceFolder: string | undefined,
  filename: string
): string | undefined {
  if (!workspaceFolder) {
    return undefined;
  }
  return path.join(workspaceFolder, 'graphics-h-programs', filename);
}

const SAMPLE_META: ProgramMeta[] = [
  /* v1.5.16: the example section is now a GAME SUITE, exactly as the
   * user asked — the old teaching programs were removed and three
   * complete games took their place, each a full showpiece:
   *   1. Snake            — the classic, with a save database
   *   2. 2-Player Football — street-rules derby, pitch drawn with
   *                          hand-written putpixel algorithms only
   *   3. Bounce           — the rubber-ball classic with sounds */
  { id: 'snake',    kind: 'sample', filename: '01_snake_game.cpp',    title: 'Snake',              description: 'The classic — WASD/arrows, bonus apples, top-5 score database', emoji: '🐍', tag: 'fun' },
  { id: 'football', kind: 'sample', filename: '02_football_game.cpp', title: '2-Player Football',  description: 'Street-rules derby for two — field drawn without a single built-in shape call', emoji: '⚽', tag: 'fun' },
  { id: 'bounce',   kind: 'sample', filename: '03_bounce_game.cpp',   title: 'Bounce',             description: 'The rubber-ball classic — charge jumps, rings, springs, six levels, sounds', emoji: '🔴', tag: 'fun' }
];


export interface CommandMeta {
  id: string;
  commandId: string;
  title: string;
  hint: string;
  icon: string;
  primary?: boolean;
  /** v1.5.5: the Fireworks Simulator button gets its own festive design. */
  variant?: 'festive';
}

/** Commands rendered as action buttons in the webview panel. */
export const COMMAND_META: CommandMeta[] = [
  { id: 'cmd-compileAndRun', commandId: 'graphics-h-runner.compileAndRun',       title: 'Compile & Run',            hint: 'Ctrl+Alt+R',        icon: '▶',  primary: true },
  { id: 'cmd-setup',         commandId: 'graphics-h-runner.setupEverything',     title: 'Complete Run Setup',       hint: 'installs everything', icon: '🚀' },
  { id: 'cmd-doctor',        commandId: 'graphics-h-runner.doctor',              title: 'Setup Doctor',             hint: 'check environment',  icon: '🩺' },
  { id: 'cmd-compile',       commandId: 'graphics-h-runner.compile',             title: 'Compile',                  hint: 'Ctrl+Alt+B',        icon: '🛠' },
  { id: 'cmd-run',           commandId: 'graphics-h-runner.run',                 title: 'Run Last Build',           hint: 'opens a terminal',   icon: '🎬' },
  { id: 'cmd-stop',          commandId: 'graphics-h-runner.stopProgram',         title: 'Stop Running Program',     hint: 'kills the window',   icon: '⏹' },
  { id: 'cmd-copycmd',       commandId: 'graphics-h-runner.copyCompileCommand',  title: 'Copy Compile Command',     hint: 'exact g++ line',     icon: '📋' },
  /* v1.5.5: the Fireworks Simulator (festive design; the SAME button
   * stops the show while it runs — toggle handled by the command). */
  { id: 'cmd-fireworks',     commandId: 'graphics-h-runner.fireworks',           title: 'Fireworks Simulator',      hint: 'full-screen show',   icon: '🎆', variant: 'festive' }
];

/** Load the full catalog: sample sources from disk. */
export function loadProgramCatalog(extensionRoot: string): LoadedProgram[] {
  const out: LoadedProgram[] = [];

  for (const meta of SAMPLE_META) {
    const file = path.join(extensionRoot, 'samples', meta.filename);
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue; /* sample not bundled — skip silently */
    }
    out.push({ ...meta, source });
  }

  return out;
}
