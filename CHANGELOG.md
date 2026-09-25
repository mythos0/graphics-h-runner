# ChangeLog

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
