# ChangeLog

## 1.5.0 — 2026-09-27

The Computer Graphics Lab release: a dedicated lab section for the classic
course algorithms, a searchable graphics.h cheat sheet, and a renamed,
self-describing extension.

### Added
- **Computer Graphics Lab section** (below Example Programs) with 8 new
  screenshot-verified programs — **31 examples total**:
  - **Coordinate Viewer** — the screen coordinate system live: grid,
    axes, origin marker, coordinate labels every 100 px and a 10-px snap;
    toggle each feature with `G C O A S`, click to plot points (printed
    in the terminal), the lecture point `(250,100)` always shown.
  - **Pixel Inspector** — move the mouse to read any pixel's `X`, `Y`,
    color name and classic VGA `RGB`; clicking prints a copy-ready
    `X=.., Y=.., RGB=(..), COLOR=..` line in the terminal.
  - **DDA Line Lab** — every DDA step plotted on a grid with the
    `line()` reference underneath and the full step table in the terminal.
  - **Bresenham Line Lab** — the all-integer algorithm (all octants)
    with the decision-variable table.
  - **Bresenham Circle Lab** — midpoint circle, 8-way symmetry, step
    table, `circle()` reference.
  - **Midpoint Ellipse Lab** — region 1 / region 2 in 4 quadrants.
  - **2D Transformations Lab** — translate / rotate / scale a house with
    real 2-D matrices (printed to the terminal on every keypress).
  - **Cohen-Sutherland Clipping Lab** — outcodes (TBRL), verdicts and
    clipped segments against a clip window.
- **"?" cheat-sheet button** beside the panel title: a searchable
  graphics.h reference (setup & lifecycle, shapes, colors & filling,
  text, keyboard, mouse, animation, viewport) with Esc / backdrop close.
- The fallback list view mirrors the lab as its own section.

### Changed
- **Extension renamed** on the Marketplace to **"graphics.h Runner.
  One-click Setup"**; the activity-bar view title is now **"Graphics.h
  CPP Program Runner One-click setup"** (was "graphics.h Runner" +
  "graphics.h Programs").
- Both panel section toggles now share the webview state safely
  (toggling one no longer resets the other after a re-render).

## 1.4.9 — 2026-09-27

Panel polish per user feedback, two production fixes from a new deep
robustness battery, and cleaner header space.

### Changed
- **Version chip moved beside the Ready pill** — the pill row now reads
  `Ready — winbgim  v1.4.9` instead of stacking the chip below it.
- **"Open Examples Folder" action button removed from the panel** — the grid
  is a clean 2×3 and the freed row goes to the Example Programs section
  (more room for expansion + scrolling). The command itself remains available
  from the Command Palette.
- **Footer cleaned up**: the "Inside a .cpp file just press Ctrl+Alt+R…" and
  "errors are reported automatically…" lines are gone (the shortcut stays on
  the Compile & Run button), and the **DIU badge now sits on the exact right
  side of the footer text**, vertically centred.
- **Platform chip ("Windows · WinBGIM") removed from the top** — the library
  is already visible in the Ready pill.

### Fixed
- **Status bar no longer lies while compiling**: a plain Compile (or a failed
  rebuild) while a graphics program is running used to flip the indicator
  back to "idle" even though the program's terminal was still alive; the
  RUNNING indicator is now preserved (and Stop / Ctrl+Alt+S keep working).
- **Turbo C++ textbook code with `const char*` strings now compiles on
  Linux/macOS**: SDL_bgi declares `outtextxy`/`outtext`/`textheight`/
  `textwidth`/`initgraph`/… with non-const `char*` parameters, so any
  indirect const string (ternary, const variable) was a hard compile error.
  Auto-setup now const-corrects the installed header (12 read-only text
  APIs) after the build — the library binary is unchanged.

### Added
- **Robustness battery** (`test/robust-tests.js`, 24 checks): complex
  fixtures (Julia-set math, gravity animation, conio-style poll menu,
  getimage/putimage verbs, viewport clipping, text-metrics layout, fill
  patterns, an 18,800-primitive stress test), terminal-I/O correctness with
  piped stdin + EOF fallback, crash surfacing (SIGSEGV exits non-zero, never
  hangs, display stays healthy), stop-mid-flight + immediate replace, the
  production diagnostics parser fed with real g++ output, and rapid re-run
  cycling.

## 1.4.8 — 2026-09-26

### Fixed
- **The DIU badge was not wired into the live panel in 1.4.7** (the wiring
  change sat in a patch batch that failed halfway; the badge showed in test
  previews, which pass the logo URI explicitly, but the real panel never
  received it). The panel provider now serves `media/diu-logo.png` as a
  webview resource and passes it to the page; `localResourceRoots` is scoped
  to `media/` again. 1.4.7 shipped everything else in this release note.

## 1.4.7 — 2026-09-26

Panel redesign per user feedback, Turbo C++ / conio.h examples, compiler
diagnostics in the Problems panel, and a quieter Sentry error inbox.

### Added
- **Turbo C++ & conio.h example pack (WinBGIM stays the default library; 23
  examples total)**: "Turbo C++ Graphics Tour" (bar3d, pieslice, sector,
  floodfill, fill patterns, dashed lines), "Viewport & Clipping"
  (setviewport/clearviewport with two clipped panes), "Sprite Animation"
  (getimage/putimage rocket over a starfield), and "Conio Keyboard Paint"
  (a conio.h kbhit/getch drawing pad with a menu bar). Every sample compiles
  on WinBGIM (Windows) and SDL_bgi (Linux/macOS) and auto-exits.
- **Compiler errors in the Problems panel**: g++ output is parsed into
  clickable file:line diagnostics (errors, warnings, notes) with inline
  squiggles; a clean build clears them.
- **Status bar now tracks the run**: `Compiling…` while the toolchain runs,
  and a click-to-STOP indicator while a graphics program is running; back to
  the environment indicator when idle.
- **Ctrl+Alt+S** stops the running graphics program from anywhere.
- The "Open Examples Folder" hint and every count now follow the real
  catalog size automatically.

### Changed
- **Panel, per user feedback**: the ready-state "Everything is ready" card is
  gone (the green pill + chips carry the ready message); Example Programs are
  **collapsed by default** — tap the section header to expand, and the list
  **scrolls inside its own container** like a second tab below the actions,
  so the action buttons stay put; the choice is remembered across re-renders.
  The **DIU badge** now sits in the empty top-right corner of the title row
  (responsive: smaller but never stretched on narrow sidebars), and the
  footer credit stays pinned to the bottom.

### Fixed
- **Sentry inbox noise**: user-code compile errors are no longer reported as
  telemetry errors (they are the normal edit-compile loop — now visible in
  the Problems panel instead; the first error lines ride along as
  breadcrumbs), the webview-fallback event is downgraded to a warning
  (resilience working as designed), and uncaught crashes/rejections from
  OTHER extensions in the shared host (e.g. frame-less "Cannot find package
  'prettier'" rejections) are dropped even when they carry no frames.
- Sprite-animation sample: background "restore" via a captured bitmap cannot
  erase on SDL_bgi (transparent alpha in the captured bitmap) — the sample
  now erases with cleardevice() + opaque primitive redraws, the portable
  pattern; also fixed the missing initial draw that left an orphaned sprite
  in the classic XOR variant, and viewport labels that clearviewport()
  wiped each frame.

## 1.4.6 — 2026-09-26

Terminal-launch fix for every Windows setup plus a new DDA line-drawing
example with live terminal I/O.

### Fixed
- **"The terminal process failed to launch: Path to shell executable
  \"cmd.exe\" does not exist"** — v1.4.5 pinned the Windows runner terminal
  to a bare `cmd.exe`, which some VS Code setups cannot resolve. The compiled
  program is now spawned **directly as the terminal's process** — no shell is
  involved at all, so there is nothing to resolve or quote. The program keeps
  its real console (stdin input + visible output) and the graphics window
  opens as usual. Running a new program now replaces the previous runner
  terminal, and the terminal takes focus so prompts can be answered
  immediately.
- **Fireworks sample could crash the window** (intermittent SIGSEGV on some
  machines): its particle arrays were read before initialization, feeding a
  garbage color index into the palette. All arrays are now zero-initialized;
  20 consecutive runs verified crash-free.

### Added
- **New example: "DDA Line (Terminal Input)"** (19 examples total): type two
  endpoints in the terminal, the program prints dx/dy/steps, the increment
  values and **every generated DDA point**, and plots the line pixel by
  pixel in a graphics window with math-style axes (y grows upward from the
  window centre). Falls back to a demo line when stdin is closed, so it
  self-exits everywhere. Useful alongside the classic direct-equation
  approach — which divides by zero for vertical lines and hardcodes the
  screen centre; the DDA example avoids both pitfalls.

## 1.4.5 — 2026-09-26

Programs now run in the VS Code integrated terminal so console input and
output work exactly as students expect.

### Fixed
- **Programs could not take input or show output** on Windows: the compiled
  .exe was launched detached with its standard streams discarded, so
  `cin`/`scanf`/`getch()` had nothing to read and `printf`/`cout` output was
  invisible. Programs that mix graphics with console I/O (e.g. asking for a
  choice with `cin >>`, printing scores with `cout`) now work properly.
- Removed a leftover dead source file (`programsView.ts`) that broke strict
  recompiles from a clean checkout.

### Changed
- **Run in terminal**: the compiled program now runs inside the VS Code
  integrated terminal. The graphics window opens as before, and the terminal
  provides a real console — type input, see output, and press any key for
  `getch()`-style pauses. On Windows the runner terminal is pinned to
  `cmd.exe` (identical behavior on every machine regardless of the user's
  default shell profile) and the compiler's bin directory is prepended to the
  terminal PATH so non-statically-linked executables still find their runtime
  DLLs. **Stop** disposes the runner terminal, closing the graphics program.

## 1.4.4 — 2026-09-26

Production-hardening release: a broken example, a panel layout refresh and
automatic recovery from a VS Code webview loading failure.

### Fixed
- **Fireworks sample failed to compile on Windows** ("'cos' was not declared
  in this scope" on MinGW 6.3): `12_fireworks.cpp` now includes `<cmath>`
  so `cos()`/`sin()` are always declared. All 18 examples re-verified
  end to end (compile → run on a virtual display → screenshot → clean
  self-exit): 18/18 PASS.
- **"Could not register service worker: InvalidStateError"** — the webview
  panel now watches its own liveness: the page answers a ping as soon as it
  loads, a dead page is re-rendered once automatically (which clears the
  service-worker race), and if it still cannot load the extension
  **instantly reveals a native "graphics.h Programs (List)" tree view**
  with the same 8 actions and all 18 example programs, plus a small
  recovery page with a "Retry panel" button. Nothing is lost when the
  webview breaks — and `Ctrl+Alt+R` keeps working regardless.

### Changed
- **Action buttons layout**: the 1st button (Compile & Run) is now the
  hero — big, full-width and alone on its row with a soft green glow;
  the other 7 actions sit below it in a tidy 2-per-row grid. The panel
  keeps its flat dark theme with the single green accent.

### Notes
- Sentry noise fixed at the source: telemetry is suppressed outside
  production, and auto-captured errors not attributable to this extension
  are dropped, so shared-extension-host crashes (e.g. other extensions or
  host shutdown) no longer land in our inbox.

## 1.4.3 — 2026-09-26

One more panel tweak, requested right after 1.4.2:

### Changed
- **Footer credit added back by popular demand**: the bottom of the
  graphics.h panel now closes with
  "Powered by Department of CSE, Dhaka International University,
  Bangladesh." — the hero stays clean (no logo, no credit line up top).

## 1.4.2 — 2026-09-26

Panel polish in the activity bar, requested by users:

### Changed
- **Cleaner hero**: the logo image and the university credit line were
  removed from the top of the graphics.h panel (and from the footer).
  The panel now opens straight with the title, the environment status
  pill and the platform/version chips.
- **Every action button has its own color**: Compile & Run (violet),
  Complete Run Setup (amber), Setup Doctor (emerald), Compile (blue),
  Run Last Build (cyan), Stop Running Program (rose), Copy Compile
  Command (fuchsia) and Open Examples Folder (lime). The environment
  card's "Complete Run Setup" call-to-action uses the same amber so the
  two entry points to setup read as one.
- **Attribution wording**: the Marketplace/README credit now reads
  "Powered by Department of CSE, Dhaka International University,
  Bangladesh" (previously "Made by …").

### Notes
- The university attribution stays on the Marketplace page and in the
  README; it is only removed from the in-editor activity bar panel.
- All 18 example programs were re-verified end to end (compile → run on
  a virtual display → screenshot → clean self-exit): 18/18 PASS.

## 1.4.1 — 2026-09-26

Fixes the empty activity-bar panel reported on v1.4.0
("There is no data provider registered that can provide view data").
Two independent root causes, both fixed and now covered by a real
VS Code activation test:

### Fixed
- **The panel view is now declared `"type": "webview"`** in the manifest.
  v1.4.0 registered a `WebviewViewProvider` but the view declaration lacked
  the webview type, so VS Code created a tree pane instead — and a tree pane
  without a `TreeDataProvider` shows exactly that error.
- **Sentry's module-load initialization no longer runs at module load.**
  On newer VS Code hosts (with extensions targeting older `engines`), reading
  the `navigator` global raises a migration-trap error; the Sentry SDK touches
  `navigator` while setting up, which could crash the extension's module
  evaluation before anything registered — same visible symptom, empty panel.
  Initialization now happens inside `activate()`, and a navigator guard
  replaces the trapped global with a benign stub so automatic error
  collection keeps working on those hosts.

### Added
- **Real extension-host verification**: the test suite now launches an actual
  VS Code instance (`@vscode/test-electron`), activates the extension, focuses
  the panel, runs the Setup Doctor and scans the workbench logs for the
  data-provider error — v1.4.0 would have failed this test.

## 1.4.0 — 2026-09-26

The activity-bar panel becomes a real webpage, F5 runs graphics programs, the
command list gets leaner, and 9 new fun examples join the catalog — 18 in total.

### Added
- **Modern webpage-style panel (Activity Bar)** — the plain black-and-white
  tree view is replaced by a styled webview: gradient hero with the DIU logo
  and "made by Department of CSE, Dhaka International University, Bangladesh"
  credit, a live environment card (Ready / Not ready / Checking with a
  one-click **Complete Run Setup** call-to-action while anything is missing),
  a 2-column action grid, and an emoji card for every example program with
  **▶ Run** (open + compile + launch in one click) and **Open** buttons.
  Responsive layout adapts to narrow sidebars; looks identical in light &
  dark themes.
- **Run and Debug integration (F5)** — a `graphics-h` debug type with a
  minimal run-only adapter: pressing **F5** offers **"Run graphics.h program"**
  next to the other debuggers, and launching it compiles the active file and
  opens the graphics window through the normal pipeline (progress, output and
  setup offers included).
- **Run button dropdown** — Compile & Run and Compile now appear in the
  editor's **▶ run button menu** right beside the C/C++ extension's
  "Run C++ File" entry (for `.cpp`/`.c` files).
- **9 new fun example programs** (18 total): Winking Smiley 😊, Bouncing
  Balls 🎱, Fireworks Show 🎆, Solar System 🪐, Aquarium 🐠, Rainbow Spiral
  🌈, Helicopter 🚁, Sunset Scene 🌅, Warp Starfield ✨ — all auto-exiting,
  keyboard-dismissible, and portable across WinBGIM and SDL_bgi.
- **Stop Running Program** (`graphics-h-runner.stopProgram`) — kills the
  graphics window of the last launched program (process-tree `taskkill` on
  Windows, runner-terminal dispose fallback elsewhere).
- **Copy Compile Command** (`graphics-h-runner.copyCompileCommand`) — copies
  the exact compiler command line for the active file to the clipboard —
  handy for labs, terminals and reports.
- **Open Examples Folder** (`graphics-h-runner.openExamplesFolder`) — copies
  all 18 examples into `graphics-h-programs/` in the workspace and reveals
  the folder (or offers to open an examples workspace when no folder is open).
- Panel buttons show a live "Compiling…" pill while a build is running.

### Changed
- **"Full Setup (0 to running)" is renamed to
  "Complete graphics.h Run Setup"** (command id unchanged:
  `graphics-h-runner.setupEverything`); all user-facing copy updated.
- The sidebar catalog now ships **18 example programs**; program cards carry
  `classic` / `fun` / `math` / `interactive` tags.

### Removed
- **Insert Code Template** command and the 5 quick templates (the 18 samples
  cover the same ground; snippets remain).
- **Show Setup Guide** command and the in-editor guide webview (the Setup
  Doctor + Complete Setup remain the guided paths).

### Fixed
- **Fireworks sample crash (SDL_bgi)** — calling `putpixel()` right after a
  per-frame `cleardevice()` races with SDL_bgi's surface flip and can kill
  the graphics window (intermittent SIGSEGV in `putpixel` inside
  libSDL_bgi.so, reproduced ~1 in 3 runs and backtrace-verified). The sample
  now draws stars/particles with `bar()` filled rects — 8/8 clean runs and
  18/18 screenshot-verified samples after the fix.

## 1.3.0 — 2026-09-25

Automatic error collection via Sentry, so setup/compile failures on any PC are
reported and diagnosable without asking users to copy-paste logs.

### Added
- **Automatic error collection (Sentry JS SDK, `@sentry/node`)**: uncaught
  exceptions and unhandled rejections from the extension are captured
  automatically and grouped into Sentry issues with stack traces, breadcrumbs
  and context tags (OS, architecture, VS Code version, graphics library mode).
- **Breadcrumbs on every key flow** — doctor results, compile starts/results,
  program runs, each Full Setup step, and every command invocation appear in the
  trail leading up to an error.
- **Setup failures are reported even when handled** — winget, direct compiler
  download, WinBGIM and SDL_bgi step failures inside Full Setup are captured
  with a `setup_step` tag, so fresh-PC problems surface without a bug report.
- **Privacy-first by design**:
  - respects VS Code's telemetry consent — nothing is captured unless
    `telemetry.telemetryLevel` is not `off` (`vscode.env.isTelemetryEnabled`);
    toggling the VS Code setting enables/disables collection live;
  - user-identifying path segments (`C:\Users\<name>`, `/home/<name>`, home
    directory) are scrubbed from messages, stack frames, breadcrumbs and tags
    before anything leaves the machine;
  - no source code, file contents, or compiler output are ever sent.
- **Extension-host safety**: the uncaught-exception handler is configured with
  `exitEvenIfOtherHandlersAreRegistered: false` — errors are captured while the
  shared extension host (and every other extension) keeps running.
- Events are flushed on extension shutdown; queued events survive deactivation.
- The extension now ships as a **single esbuild bundle** (`dist/extension.js`,
  unminified so stack frames stay readable) with the SDK included — install size
  and load behaviour stay lean.

### Verified
- End-to-end delivery confirmed from the real instrumented app: genuine
  uncaught-exception and unhandled-rejection triggers both reached Sentry
  (transport flush = true), and the process survived the uncaught exception.

## 1.2.0 — 2026-09-25

Robustness across every kind of PC (fresh / half-setup / messy settings) and a
friendlier Activity Bar.

### Added
- **Environment status row** at the top of the graphics.h sidebar: live
  *Ready — library* / *Not ready — reason* / *Checking…* state (kept in sync by
  the Setup Doctor), plus a one-click **“Set up everything (fix this)”** button
  that appears exactly while the environment is broken.
- **Full Setup rocket button** in the sidebar title bar — the most important
  action for a fresh PC is now always one click away.
- **Compiler fast-path discovery**: Full Setup first checks the whole PC for an
  existing working `g++.exe` (winget packages/shims, MinGW/MSYS2/TDM-GCC roots,
  Code::Blocks & Dev-C++ bundles, every `PATH` entry) and skips the download
  entirely when one is found — half-setup PCs are fixed in seconds.
- Compiler discovery also scans **PATH entries** (catches installers that
  edited PATH after VS Code was already running) and student-common IDE
  compiler bundles.
- **Untitled-document flow**: running an example opened without a workspace
  folder now offers a Save dialog and continues compiling, instead of failing
  with “open a .cpp file”.
- `.c` files get the same keybindings (`Ctrl+Alt+R` / `Ctrl+Alt+B`) and editor
  context-menu entries as `.cpp`.
- New robustness suite `test/pc-states-tests.js` — 51 checks covering fresh,
  half-setup and messy-settings PC states.

### Fixed
- **Windows `-4058` spawn failures** (`spawn g++ ENOENT` variants) are now
  classified as “no compiler” on every runtime path, so users always get the
  one-click setup dialog instead of a raw compile error.
- **Messy settings are healed on read**: quotes, double-quotes (“copy as path”),
  single quotes, `%ENV%` / `$VAR` / `${VAR}` / `~` expansion, trailing
  slashes/backslashes, directory-instead-of-exe compiler paths, missing `.exe`
  suffixes, and case-duplicate path lists all resolve to a working value.
- **Stale include/lib paths** (deleted toolchain folders, wiped globalStorage)
  are pruned automatically during Full Setup so diagnostics stay truthful.
- Setup no longer attempts the SDL_bgi build while the compiler is still
  missing on Linux/macOS (it used to fail noisily before the terminal step).
- The direct-download fallback is now **idempotent** (re-uses an already
  extracted toolchain instead of re-downloading 274 MB), tries the built-in
  `tar.exe` first (much faster than `Expand-Archive` on large archives), and
  deletes the zip after successful extraction to free disk space.
- Setup Doctor now shows the detected compiler version and the *normalized*
  path in its report, making broken settings obvious.
- Windows: compiled programs are launched **directly (detached)** instead of
  through the integrated terminal — immune to PowerShell/cmd/Git Bash quoting
  differences, with terminal fallback if launching fails.
- Status bar text is now human-readable (`✓ graphics.h`) instead of the cryptic
  `✓ BGI`; Quick Templates section in the sidebar starts collapsed.

## 1.1.0 — 2026-09-25

Zero-touch Windows setup — the compiler is now installed automatically too.

### Added
- **Fully automatic Windows compiler install**: Full Setup now runs the WinLibs
  MinGW-w64 (UCRT) winget package itself — a per-user, portable install with no
  administrator rights — then discovers the new `g++.exe`, verifies it runs, and
  wires it into `graphics-h-runner.compilerPath` automatically.
- **Direct-download fallback** (when winget is missing): the WinLibs UCRT zip is
  downloaded with live progress, verified against the official sha256 checksum,
  extracted with the built-in PowerShell `Expand-Archive`, and wired up — still
  no admin rights.
- **One-click recovery**: compiling with no compiler no longer fails with a raw
  `spawn g++ ENOENT`; the extension now explains the problem and offers
  **"Set up everything (recommended)"** right in the dialog.
- Compiler discovery also finds existing installs (winget packages/shims,
  C:\MinGW, C:\msys64\{ucrt64,mingw64}, C:\TDM-GCC-64) and prefers 64-bit
  toolchains automatically.

### Fixed
- Windows builds are now **fully statically linked** (`-static` in addition to
  `-static-libgcc -static-libstdc++`), so compiled `.exe` files run on any
  Windows 10/11 PC without missing-DLL errors.
- Setup Doctor's Windows fix text now points to the automatic setup instead of
  manual PATH editing.

## 1.0.1 — 2026-09-25

Marketplace branding update.

### Fixed
- **Store logo visibility** — the old icon's background (`#312e81`) was identical to the
  marketplace banner color, so the icon blended invisibly into the listing header. The new
  icon uses a brighter indigo→purple gradient plus a white inner ring that stays visible on
  any background, and the gallery banner is now light (`#e0e7ff`) for full contrast.

### Added
- **Attribution** — the extension page now opens with the official
  **Dhaka International University** logo and
  *"Made by Department of CSE, Dhaka International University, Bangladesh"*.
- Publisher author metadata updated to the department.

## 1.0.0 — 2026-09-25

Initial release.

### Features
- **Full Setup (0 → running)** — one command bootstraps everything:
  - *Windows*: installs MinGW-w64 g++ via winget (manual WinLibs fallback), downloads WinBGIM (`graphics.h`, `winbgim.h`, `libbgi.a`) into the extension folder and wires the paths into settings — no copying into MinGW, no admin rights.
  - *Linux*: guides `build-essential` / `libsdl2-dev` through the terminal (password prompts work there), then downloads, patches and builds SDL_bgi into a **user prefix** automatically — no `sudo` for the library — and wires include/lib paths + rpath into settings.
  - *macOS*: `xcode-select` / Homebrew guidance, then the same automatic user-prefix SDL_bgi build.
  - Finishes with a live verification probe and a "press Ctrl+Alt+R" confirmation.
- **Setup Doctor** — probes the compiler and every candidate graphics library by actually compiling a `graphics.h` probe; prints copy-paste fixes; offers **Fix automatically**; reports via the status bar.
- **Compile & Run** (`Ctrl+Alt+R`), **Compile** (`Ctrl+Alt+B`), **Run Last Build** — Command Palette, editor context menu and keybindings.
- **Auto-detection** of `#include <graphics.h>` — BGI linker flags applied automatically; non-graphics files still build as plain C++.
- **Per-OS linker recipes**
  - Windows: WinBGIM → `-lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32` (+ optional static linking)
  - Linux: SDL_bgi → `-lSDL_bgi -lSDL2 -lm` or libgraph → `-lgraph`
  - macOS: SDL_bgi via Homebrew SDL2
  - Custom library prefixes get matching `-Wl,-rpath` automatically.
- **Status bar indicator** — `BGI: ready / missing / ?` at a glance, clickable to re-run the doctor.
- **Snippets** — `gfxprog`, `gfx-anim`, `gfx-mouse`, `gfx-kbd`, `gfx-text`, `gfx-bar`.
- **Insert Code Template** — 5 ready-made programs (basic window, animation, mouse paint, keyboard control, fractal tree).
- **Show Setup Guide** — in-editor webview with per-OS walkthroughs.
- **graphics.h sidebar (Activity Bar)** — dedicated Activity Bar icon opening the "graphics.h Programs" panel:
  - **Commands section on top** (with keybinding hints) plus title-bar buttons for Compile & Run / Compile / Setup Doctor / Setup Guide;
  - **Example Programs** — all 9 bundled graphics.h samples, listed with friendly names;
  - **Quick Templates** — the 5 minimal templates;
  - clicking any entry opens it in the editor as a real `filename.cpp` (created under `graphics-h-programs/` in your workspace, or as an untitled document when no folder is open).

### Quality
- 9-sample integration suite (shapes, animation, flag, fractal tree, Mandelbrot, mouse paint, keyboard game, hello) compiles with the extension's exact flags, runs under a virtual display and is screenshot-verified — 9/9 passing.
- Setup engine tested end-to-end: fresh download → patch → build → user-prefix install → compile → verified render.
- Sidebar smoke tests (`test/view-tests.js`): catalog integrity, bundled sources byte-identical to the samples, package.json view wiring, click-to-open path resolution.
- Fixed during testing: a **frame-tearing bug** in the SDL_bgi build produced by the Setup Engine — the library presented the window after every drawing primitive, so frames could appear mid-draw (verified via timed screenshots); presentation is now event-driven, one full-frame present per `delay()` / `kbhit()` / `getch()` call.
- Enriched samples `03_bouncing_ball` (bordered court + trails), `06_fractal_tree` (sun, ground, colored leaves) and `09_keyboard_paddle` (brick-breaker with score) for clearer screenshot evidence.
