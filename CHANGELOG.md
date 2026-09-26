# ChangeLog

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
