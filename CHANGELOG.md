# ChangeLog

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
