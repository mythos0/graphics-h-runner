/**
 * smoke-view.js — smoke-test the sidebar view logic without VS Code.
 *
 * Validates:
 *  1. loadProgramCatalog() loads all 9 samples + 5 templates with real source
 *  2. ProgramsViewProvider produces the expected tree:
 *     - environment status node on top (checking / ready / not-ready)
 *     - one-click "Set up everything" fix appears while NOT ready
 *     - 3 sections, first section = Commands with 7 command nodes
 *     - every command node carries a working command id
 *     - every program node fires graphics-h-runner.openProgram with filename.cpp
 *     - Quick Templates section is collapsed (less clutter)
 *  3. resolveProgramTarget() puts files under <ws>/graphics-h-programs/
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

/* minimal vscode stub — programsView only touches TreeItem/ThemeIcon/MarkdownString
   constructors and TreeItemCollapsibleState constants */
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') {
    return 'vscode-stub';
  }
  return realResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = {
  id: 'vscode-stub',
  filename: 'vscode-stub',
  loaded: true,
  exports: {
    TreeItem: class TreeItem {
      constructor(label, state) { this.label = label; this.collapsibleState = state; }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } },
    ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
    MarkdownString: class MarkdownString { constructor(v) { this.value = v; } },
    EventEmitter: class EventEmitter {
      constructor() { this.event = () => ({ dispose() {} }); }
      fire() {}
      dispose() {}
    }
  }
};

const root = path.join(__dirname, '..');
const { loadProgramCatalog, resolveProgramTarget } = require(path.join(root, 'out', 'programs'));
const { ProgramsViewProvider } = require(path.join(root, 'out', 'programsView'));

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    console.log('  FAIL  ' + name);
    failures++;
  }
}

console.log('== smoke: sidebar programs view ==');

// 1. catalog
const catalog = loadProgramCatalog(root);
check('catalog has 14 programs (9 samples + 5 templates)', catalog.length === 14);
const samples = catalog.filter((p) => p.kind === 'sample');
const templates = catalog.filter((p) => p.kind === 'template');
check('9 samples', samples.length === 9);
check('5 templates', templates.length === 5);
check('all samples have non-empty source', samples.every((p) => p.source.includes('#include <graphics.h>')));
check('all samples end with .cpp', samples.every((p) => /^[\w-]+\.cpp$/.test(p.filename)));

// 2. tree
const provider = new ProgramsViewProvider(catalog);
const top = provider.getChildren();
check('top level = status + 3 sections (no doctor result yet)', top.length === 4);
check('node 0 is the environment status node', top[0].kind === 'status');
const statusItem0 = provider.getTreeItem(top[0]);
check('status shows "checking…" before first doctor run', statusItem0.description === 'checking…');

check('section 1 is Commands', top[1].label === 'Commands');
check('section 2 is Example Programs', top[2].label === 'Example Programs');
check('section 3 is Quick Templates', top[3].label === 'Quick Templates');
check('Quick Templates section is collapsed by default', top[3].collapsed === true);

const cmdNodes = provider.getChildren(top[1]);
check('7 command nodes', cmdNodes.length === 7);
check('commands run on click (each tree item has command.command)',
  cmdNodes.every((n) => { const it = provider.getTreeItem(n); return it.command && it.command.command.startsWith('graphics-h-runner.'); }));
check('first command is Compile & Run with hint Ctrl+Alt+R',
  cmdNodes[0].title === 'Compile & Run' && cmdNodes[0].hint === 'Ctrl+Alt+R');
const expectedCmds = [
  'graphics-h-runner.compileAndRun', 'graphics-h-runner.setupEverything', 'graphics-h-runner.doctor',
  'graphics-h-runner.compile', 'graphics-h-runner.run',
  'graphics-h-runner.insertTemplate', 'graphics-h-runner.showGuide'
];
check('command ids match registered commands (setup-friendly order)',
  cmdNodes.every((n, i) => n.commandId === expectedCmds[i]));

const sampleNodes = provider.getChildren(top[2]);
check('9 sample nodes', sampleNodes.length === 9);
const sampleItems = sampleNodes.map((n) => provider.getTreeItem(n));
check('sample items open via openProgram with arguments',
  sampleItems.every((it) => it.command.command === 'graphics-h-runner.openProgram' && it.command.arguments.length === 1));
check('sample items show filename.cpp as description',
  sampleItems.every((it, i) => it.description === samples[i].filename));

const tplNodes = provider.getChildren(top[3]);
check('5 template nodes', tplNodes.length === 5);
check('template items also open via openProgram',
  tplNodes.every((n) => provider.getTreeItem(n).command.command === 'graphics-h-runner.openProgram'));

// 2b. status node reacts to doctor results
provider.setDoctorResult({
  graphicsReady: true, bestLibrary: 'winbgim',
  compilerCheck: { ok: true }, libraryChecks: [{ name: 'winbgim', ok: true }]
});
const topReady = provider.getChildren();
check('ready env: still status + 3 sections (no CTA)', topReady.length === 4);
const readyItem = provider.getTreeItem(topReady[0]);
check('ready env status says Ready — winbgim', /Ready — winbgim/.test(String(readyItem.description)));

provider.setDoctorResult({
  graphicsReady: false, bestLibrary: null,
  compilerCheck: { ok: false }, libraryChecks: [{ name: 'winbgim', ok: false }]
});
const topBad = provider.getChildren();
check('not-ready env: status + CTA + 3 sections', topBad.length === 5);
check('CTA is the setup-everything command',
  topBad[1].kind === 'command' && topBad[1].commandId === 'graphics-h-runner.setupEverything');
const badItem = provider.getTreeItem(topBad[0]);
check('not-ready status mentions the reason', /Not ready/.test(String(badItem.description)));

provider.setDoctorResult(undefined);
check('resetting doctor result restores checking state',
  provider.getTreeItem(provider.getChildren()[0]).description === 'checking…');
provider.setDoctorResult({
  graphicsReady: true, bestLibrary: 'winbgim',
  compilerCheck: { ok: true }, libraryChecks: [{ name: 'winbgim', ok: true }]
});

// getTreeItem sanity for one node of each kind
const cmdItem = provider.getTreeItem(cmdNodes[0]);
check('command tree item is clickable (has command)', !!cmdItem.command);
check('command tree item title is Compile & Run', cmdItem.label === 'Compile & Run');
const progItem = sampleItems[0];
check('program tree item opens the file (command + args)',
  progItem.command.command === 'graphics-h-runner.openProgram' && progItem.command.arguments[0].filename === '01_hello_graphics.cpp');
check('program tree item shows filename as description', progItem.description === '01_hello_graphics.cpp');

// 3. target resolution
const t1 = resolveProgramTarget('/tmp/ws', '01_hello_graphics.cpp');
check('target = <ws>/graphics-h-programs/filename.cpp',
  t1 === path.join('/tmp/ws', 'graphics-h-programs', '01_hello_graphics.cpp'));
check('no workspace -> undefined (untitled doc path)', resolveProgramTarget(undefined, 'x.cpp') === undefined);

// 4. package.json wiring
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check('package.json declares activitybar container', !!(pkg.contributes.viewsContainers.activitybar || []).find((c) => c.id === 'graphics-h-runner'));
check('activitybar icon file exists', fs.existsSync(path.join(root, pkg.contributes.viewsContainers.activitybar[0].icon)));
check('view graphics-h-runner.programs registered',
  (pkg.contributes.views['graphics-h-runner'] || []).some((v) => v.id === 'graphics-h-runner.programs'));
const titleBtns = (pkg.contributes.menus['view/title'] || []).filter((m) => m.when.includes('graphics-h-runner.programs'));
check('view/title has >= 4 top command buttons (icon commands)', titleBtns.length >= 4);
check('all title buttons reference valid commands',
  titleBtns.every((b) => pkg.contributes.commands.some((c) => c.command === b.command)));
check('onView activation event present', pkg.activationEvents.includes('onView:graphics-h-runner.programs'));
check('samples/ and media/ are NOT vscodeignored',
  !fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').match(/^\s*(samples|media)\*\*?\s*$/m));

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
