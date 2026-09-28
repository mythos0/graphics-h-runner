# Changelog

All notable changes to this extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.14] — 2026-09-28

Documentation and listing refresh.

### Changed
- Rewritten documentation: the README now contains a complete feature list, a six-way run reference, the full command and settings tables, per-platform details and the complete 31-program test results.
- This changelog was rewritten in a standard, user-focused format.
- Clarified naming: the extension display name is now "graphics.h Runner — One-Click Setup" and the activity-bar view is titled "graphics.h Runner".
- More precise descriptions for the Celebrations and Clean-exit settings.

## [1.5.13] — 2026-09-28

Clean exit — uninstalling the extension restores every setting that Complete Run Setup changed.

### Added
- **Automatic restore on uninstall.** Before Complete Run Setup (or the native-run command) changes anything, the extension records the original values of every setting it may write — the toolchain paths, the Code Runner executor and related options, and the workspace's `settings.json`, `launch.json` and `tasks.json`. Uninstalling the extension puts all of them back automatically. The first snapshot is preserved as the true "before" state, so re-running the setup never overwrites it.
- **Surgical restore.** Only what the extension actually wrote is reverted: your own settings, your own launch configurations and build tasks, and executors for other languages are never touched. A setting that did not exist before is removed again; a file that was not valid configuration markup is restored byte-exact; files the setup created are deleted only once nothing user-owned remains in them.
- **`graphics.h: Restore Original Settings`** performs the same restore on demand, behind a confirmation. This also covers the one case VS Code cannot handle automatically: uninstalling while VS Code is closed.
- The Setup Doctor now reports whether a snapshot is armed, when it was taken and what it contains.
- New setting `graphics-h-runner.restoreSettingsOnUninstall` (default: enabled) to keep the setup in place after uninstalling if you prefer.

### Notes
- The Windows "make global" step copies library files into the compiler folders and edits the user PATH. That is system state outside VS Code's settings and is intentionally not modified by the automatic restore; the Setup Doctor makes it visible.

## [1.5.12] — 2026-09-28

Native VS Code run integration — the standard run paths now use the same toolchain as the extension.

### Added
- **F5 runs graphics.h programs.** Complete Run Setup writes a launch configuration using the extension's built-in debug adapter: pressing F5 on a C++ file compiles it with the same flags as Ctrl+Alt+R — graphics.h auto-detection included — and opens the graphics window. No additional debugger extension is required.
- **Ctrl+Alt+N (Code Runner) uses the same compiler and flags**, and runs in the terminal so `cin` / `scanf` / `getch()` input works. Plain C++ files without `graphics.h` run through the same configuration.
- **Ctrl+Shift+B builds with the same flags** through a default build task that routes compiler errors into the Problems panel. If you already have your own default build task, it stays the default.
- **IntelliSense alignment**: `C_Cpp.default.compilerPath` points at the compiler the setup validated.
- New command **`graphics.h: Enable native VS Code run`** applies the wiring to any workspace at any time.

### Fixed
- Every configuration write is merge-safe and idempotent: existing launch configurations, tasks and settings are preserved, re-running never duplicates entries, and an unparseable file is backed up before being rebuilt.

## [1.5.11] — 2026-09-28

Setup reliability.

### Fixed
- Corrupt library downloads can no longer poison the setup: every downloaded file is validated before it is written to disk (a truncated transfer, an HTML error page or an antivirus-mangled binary now fails immediately with the exact reason), followed by one clean automatic re-download.
- The link verification runs immediately after the library install instead of several steps later, and its failures are classified into specific, actionable advice (32-bit toolchain, corrupt library, missing include paths).
- Fixed "Channel has been closed" errors that could appear as unhandled rejections when VS Code reloaded the window or shut down while work was in flight.
- Setup verification failures are now reported to error telemetry with diagnostic details; all diagnostics are scrubbed of user-identifying paths.

## [1.5.10] — 2026-09-28

The cheat sheet becomes a pure `graphics.h` function reference.

### Changed
- The cheat sheet now contains only detailed function documentation: 81 entries in 11 sections covering the whole practical BGI surface — setup and lifecycle, coordinates, pixels and lines, shapes and curves, colors, filling, text, keyboard, mouse, images and animation, viewports and pages — with parameter meanings, angle and color conventions, fill patterns, fonts, extended-key codes and classic usage patterns for every function. General extension content was removed, and the useful notes were folded into the function entries they belong to.

## [1.5.9] — 2026-09-28

Cheat sheet reliability and a cleaner view title bar.

### Fixed
- A stray markup tag could leave the cheat sheet showing nothing but its footer line. The sheet is now generated from a structured data source with balanced markup by construction, so this class of bug cannot recur, and the "no search results" hint displays correctly.
### Changed
- The view title bar now shows a single **?** button that opens and toggles the cheat sheet; the panel header itself carries no buttons.

## [1.5.8] — 2026-09-28

Fireworks showpiece and cheat-sheet resilience.

### Added
- The Fireworks Show example is now a shell-based simulation: up to six rockets that lean as they climb and drop spark trails, exploding near their apex into peony, ring, willow and crackle bursts over a city skyline with twinkling stars and a moon. Written with portable primitives, so the same source runs on the Windows and Linux/macOS graphics libraries.
### Fixed
- The ? cheat sheet survives panel re-renders: its open state is persisted across page rebuilds, the panel stops swapping the page while you are reading the sheet, and recovery flows still take priority over the gate.

## [1.5.7] — 2026-09-28

Celebrations refinements.

### Changed
- Success confetti and the first-open show of each session now play inside the graphics.h panel itself — no editor tab opens and the panel stays fully interactive.
- The compile-error overlay and the Fireworks Simulator keep their full-screen presentation.

## [1.5.6] — 2026-09-27

Works on any PC.

### Fixed
- The setup can no longer declare a compiler "ready" that cannot build graphics.h programs. The verification now compiles **and links** a real graphics program; 32-bit compilers that cannot use the bundled 64-bit graphics library are detected up front and replaced with a compatible 64-bit MinGW-w64 toolchain automatically — with the reason explained in the setup summary.
- The "make global" step resolves the compiler through the OS and validates it before writing anything; when it cannot, the step is skipped with a clear message instead of writing to wrong folders.
- Linker errors about unresolved graphics functions now explain the cause in one line and offer one-click Complete Run Setup instead of a wall of linker errors.
### Changed
- A failed build shows a brief full-screen error overlay with the first compiler messages in large type (click or Esc to dismiss), replacing the snowfall animation.

## [1.5.5] — 2026-09-27

Celebrations and a definitive fix for the fallback list view.

### Fixed
- Program clicks in the fallback list view keep working after extension-host restarts. Each program now has its own static command registration instead of cached dynamic command arguments, which removes the failure mode entirely.
### Added
- **Confetti** on every successful compilation, **snowfall** for three seconds on compile errors, and a **School Pride** show the first time the panel opens each session.
- **Fireworks Simulator** action button: a full-screen simulation with a complete settings menu (shell type and size, quality, sky lighting, auto-launch, finale mode), stoppable from the same button, the view title bar, or Esc.
- New setting `graphics-h-runner.celebrations.enabled` (default: enabled) gates the automatic effects; the Fireworks Simulator button always works.
### Security
- All overlay pages run under a strict content-security policy with nonce'd scripts and zero network requests; the bundled confetti engine renders on the main thread where the policy requires it.

## [1.5.4] — 2026-09-27

Predictable program lifecycle.

### Fixed
- Programs quit only when you quit them: stray keystrokes (typed while compiling or after a run) no longer stop a running program. ESC — or Q — quits, as printed in each window.
- The terminal no longer closes itself after a run; the pause wrapper that caused it was removed entirely.
### Changed
- One persistent "graphics.h Runner" terminal is created once and reused for every run; its output history stays available until you close it. Stop (Ctrl+Alt+S) interrupts the program and lands back at the prompt of the same terminal, ready for the next run.

## [1.5.3] — 2026-09-27

Classroom-driven usability.

### Changed
- Programs run until you quit them; the automated-demo self-exit timers were removed from all samples.
- The terminal stays open with all output after a program finishes.
### Added
- Stale-binary protection: Run recompiles automatically when the source file is newer than the compiled binary, so editing a program and pressing Run never shows the previous version.
- The runner terminal is named after the running program, so several terminals are easy to tell apart.

## [1.5.2] — 2026-09-27

Correctness.

### Fixed
- The two mouse lab programs failed to compile on Windows: the WinBGIm header declares `getmouseclick` with reference arguments while SDL_bgi uses pointers. Both samples now compile against both libraries.
- The Windows dependency audit no longer warns about missing DLLs on fully static builds: it now reads the executable's real import table instead of scanning raw byte strings, so only DLLs the Windows loader must resolve are reported.

## [1.5.1] — 2026-09-27

Production hardening and global setup.

### Fixed
- Plain C++ programs no longer fail to start with exit code -1073741515 (missing runtime DLL): every Windows build is now fully statically linked and imports only DLLs that ship with Windows itself.
- Plain console programs pause after finishing so their output can be read before the terminal closes.
- The run environment includes the compiler's bin directory, so even a non-statically-linked executable finds its runtime libraries.
- Benign command cancellations are no longer reported as errors.
### Added
- **Global setup** (Windows): the graphics library is copied into the compiler toolchain's own include/lib folders and the compiler's bin directory is appended to your user PATH, verified by a compile that uses no extension settings — so graphics.h then compiles in **any** terminal or IDE without this extension. The Setup Doctor proves it with a "global (no flags)" check. Linux/macOS instructions for a system-wide SDL_bgi are printed as well.

## [1.5.0] — 2026-09-27

Computer Graphics Lab and cheat sheet.

### Added
- **Computer Graphics Lab** — eight screenshot-verified lab programs covering the classic course algorithms: Coordinate Viewer (grid, axes, origin, snap), Pixel Inspector (mouse x/y + color readout), DDA Line, Bresenham Line, Bresenham Circle, Midpoint Ellipse, 2D Transformations and Cohen–Sutherland Clipping — 31 examples in total. Each lab prints its algorithm's step table in the terminal.
- **Cheat sheet** — a searchable graphics.h reference behind the **?** button in the panel, closing with Esc or a backdrop click.
### Changed
- The extension and its views are renamed to describe the one-click setup more clearly.

## [1.4.9] — 2026-09-27

Panel polish and deep robustness work.

### Changed
- The version chip sits beside the Ready status pill; the Open Examples Folder button left the panel grid (the command remains available); the footer was cleaned up with the university badge on the right.
### Fixed
- The status bar indicator no longer resets to idle while a program is still running — the running state and the Stop control remain available.
- Turbo C++ textbook code with `const char*` strings now compiles on Linux/macOS: the installed SDL_bgi header is const-corrected for read-only text APIs after the build.

## [1.4.8] — 2026-09-26

### Fixed
- The university badge was not served to the live panel in 1.4.7; it now displays correctly.

## [1.4.7] — 2026-09-26

Turbo C++ examples and Problems-panel integration.

### Added
- Turbo C++ & conio.h example pack: a graphics tour (`bar3d`, `pieslice`, `sector`, `floodfill`, fill patterns, dashed lines), viewport clipping, sprite animation (`getimage`/`putimage`) and a `conio.h` keyboard drawing pad.
- Compiler errors appear as clickable file:line diagnostics in the Problems panel with inline squiggles; a clean build clears them.
- The status bar shows *Compiling…* and a click-to-stop control while a program runs; **Ctrl+Alt+S** stops the running program from anywhere.
### Changed
- The panel's Example Programs section is collapsed by default and scrolls inside its own container, so the action buttons stay put; the university badge sits in the title row.
### Fixed
- Error reporting is quieter: user compile errors are not telemetry errors (they are visible in the Problems panel), and crashes from other extensions sharing the host are ignored.
- Sprite-animation sample fixed for portable erase/redraw on SDL_bgi.

## [1.4.6] — 2026-09-26

Terminal launch fix and a new DDA example.

### Fixed
- "The terminal process failed to launch: Path to shell executable cmd.exe does not exist": the compiled program is now spawned directly as the terminal's root process — no shell is involved — so console input and output work on every Windows setup; behavior is identical on Linux/macOS.
- The fireworks sample no longer crashes intermittently (its particle arrays are now initialized).
### Added
- New example **DDA Line (Terminal Input)**: type two endpoints in the terminal and the program prints the DDA step table and plots every generated point in a graphics window with math-style axes.

## [1.4.5] — 2026-09-26

Terminal input and output.

### Fixed
- Programs could not take input or show output on Windows: the executable was launched detached with its standard streams discarded. Programs now run in the integrated terminal with a real console — `cin` / `scanf` / `getch()` input and `printf` / `cout` output work — while the graphics window opens as before.

## [1.4.4] — 2026-09-26

Panel self-recovery.

### Fixed
- The panel now watches its own loading health: a page that fails to load is re-rendered once automatically (clearing the webview service-worker race), and if it still cannot load, a native list view with the same actions and all example programs appears instantly, with a retry page for the full panel. Ctrl+Alt+R keeps working regardless.
- The fireworks sample failed to compile on Windows (missing `<cmath>` include).
### Changed
- Compile & Run is the large primary button; the remaining actions follow in a tidy two-per-row grid.

## [1.4.3] — 2026-09-26

### Changed
- The panel footer closes with the university credit line.

## [1.4.2] — 2026-09-26

Panel polish.

### Changed
- Cleaner panel header: the logo and credit line moved out of the hero, which now opens straight with the title and status pill.
- Each action button received its own distinct color, with matching styling for the setup call-to-action.
- The attribution wording was updated to "Powered by Department of CSE, Dhaka International University, Bangladesh".

## [1.4.1] — 2026-09-26

Fix for the empty activity-bar panel.

### Fixed
- Fixed "There is no data provider registered that can provide view data" (an empty panel) reported on 1.4.0. Two independent causes: the panel view was not declared as a webview in the manifest, and the telemetry SDK touched a restricted global at module load on some hosts. Both are fixed and covered by real-host activation tests.

## [1.4.0] — 2026-09-26

Webview panel, F5 support and nine new examples.

### Added
- **Webpage-style activity-bar panel** with a live environment card (Ready / Not ready with a one-click fix), an action grid, and program cards with one-click **Run** and **Open** buttons; responsive for narrow sidebars.
- **Run and Debug integration (F5)**: "Run graphics.h program" compiles and launches the active file through a built-in run-only debug adapter.
- Compile & Run / Compile entries in the editor's run-button dropdown beside "Run C++ File".
- **Nine new example programs** (smiley, bouncing balls, fireworks, solar system, aquarium, rainbow spiral, helicopter, sunset, starfield) — 18 in total.
- **Stop Running Program** and **Copy Compile Command** commands; Open Examples Folder copies the catalog into the workspace.
### Removed
- Insert Code Template and Show Setup Guide commands — superseded by the example catalog, the Setup Doctor and Complete Setup.
### Fixed
- The fireworks sample no longer races the SDL_bgi surface flip (it draws with filled primitives instead of per-pixel writes).

## [1.3.0] — 2026-09-25

Automatic error reporting.

### Added
- Crash and error reporting through Sentry that respects VS Code's telemetry consent: uncaught exceptions and unhandled rejections are captured with stack traces, breadcrumbs and environment tags, so setup failures on any machine can be diagnosed without a bug report. User-identifying path segments are scrubbed before anything leaves the machine; no source code, file contents or compiler output is ever sent.
- Breadcrumbs on the key flows (doctor results, compiles, runs, every setup step).
- Setup step failures are reported even when handled, with a step tag.
- The extension ships as a single bundle with the SDK included.

## [1.2.0] — 2026-09-25

Robustness across every kind of PC.

### Added
- Live environment status at the top of the sidebar with a one-click fix button while anything is missing, and a rocket button for Full Setup in the title bar.
- Compiler fast-path discovery: existing g++ installations (MinGW/MSYS2/TDM-GCC roots, Code::Blocks and Dev-C++ bundles, PATH entries) are found and used before any download.
- Untitled documents offer a Save dialog instead of failing.
- `.c` files get the same keybindings and context-menu entries as `.cpp`.
### Fixed
- Windows spawn failures (-4058) are classified as "no compiler" on every path, so the one-click setup dialog always appears.
- Messy settings are healed on read: quotes, environment variables, `~`, trailing slashes, directory-instead-of-executable paths, missing `.exe` suffixes and stale include/lib directories.
- Setup no longer attempts the library build while the compiler is still missing; the direct-download fallback is idempotent, faster and cleans up the archive after extraction.
- Human-readable status bar text (`✓ graphics.h`).

## [1.1.0] — 2026-09-25

Zero-touch Windows compiler install.

### Added
- Fully automatic MinGW-w64 install via winget — per-user, portable, no administrator rights — with discovery of the new compiler and automatic wiring into the settings. When winget is missing, the WinLibs UCRT archive is downloaded directly with live progress and verified against the official sha256 checksum.
- Existing compiler installs are discovered (winget packages and shims, common MinGW/MSYS2/TDM-GCC folders) and 64-bit toolchains are preferred.
- Compiling with no compiler offers one-click recovery instead of a raw error.
### Fixed
- Windows builds are fully statically linked, so compiled `.exe` files run on any Windows 10/11 PC without missing-DLL errors.

## [1.0.1] — 2026-09-25

Branding.

### Fixed
- New store icon with a bright gradient and inner ring, plus a light banner color, so the icon stays visible on the listing page.
### Added
- University attribution on the extension page.

## [1.0.0] — 2026-09-25

Initial release.

### Added
- **Complete Run Setup (0 → running)** — one command bootstraps everything: the compiler itself on Windows (winget, with a manual WinLibs fallback), the graphics library per platform (WinBGIm on Windows; SDL_bgi built into a user prefix on Linux/macOS — no `sudo` required), the settings wiring and a live verification probe.
- **Setup Doctor** — probes the compiler and every candidate graphics library by actually compiling a graphics.h program; prints copy-paste fixes and offers automatic repair.
- **Compile & Run / Compile / Run Last Build** with per-OS linker recipes (WinBGIm flags with optional static linking; SDL_bgi or libgraph on Linux/macOS; automatic rpath for custom prefixes) and `#include <graphics.h>` auto-detection.
- Status bar indicator, snippets, code templates, an in-editor setup guide, and the graphics.h sidebar with nine example programs.
- The produced SDL_bgi build presents frames event-driven (one full-frame present per `delay()`/`kbhit()`/`getch()`), fixing a frame-tearing issue found during the screenshot-verified test pipeline.
