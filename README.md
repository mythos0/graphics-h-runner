# graphics.h Runner — BGI C++ Graphics Toolkit for VS Code

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#per-os-setup)
[![Tests](https://img.shields.io/badge/sample%20tests-9%2F%209%20passing-brightgreen.svg)](#tested--verified)

**Compile & run C++ programs that use `graphics.h` (BGI / WinBGIM / SDL_bgi) with one keypress.**
One command sets up the whole toolchain from zero — compiler guidance, graphics library
download/build/patch/install — no admin rights needed for the graphics library, no manual
flag memorizing, ever.

```cpp
#include <graphics.h>

int main ( ) {
    initwindow(640, 480);
    setcolor(YELLOW);
    setfillstyle(SOLID_FILL, RED);
    bar(80, 80, 280, 200);
    outtextxy(200, 300, (char*)"Hello, graphics.h!");
    getch();
    closegraph();
    return 0;
}
```

Press **`Ctrl+Alt+R`** → compiled with the right linker flags → graphics window opens.

---

## Features

| Feature | What it does |
|---|---|
| **⚡ Full Setup (0 → running)** | One command bootstraps everything: installs WinBGIM/SDL_bgi **automatically** (download → patch → build → install into a user folder → paths wired into settings). System packages that need a password are handed to the terminal as copy-paste commands, then everything is re-verified live. |
| **🧭 graphics.h sidebar (Activity Bar)** | A dedicated icon in the Activity Bar opens the **graphics.h Programs** panel: all commands at the top (with their keybindings), all 9 example programs and 5 quick templates below — **click one and it opens in the editor as `filename.cpp`**, ready to run. |
| **🩺 Setup Doctor** | Probes your compiler and *every* candidate graphics library by actually compiling a `graphics.h` probe. Reports exactly what is missing with per-OS fixes, and offers **Fix automatically**. |
| **🔍 graphics.h auto-detect** | When `#include <graphics.h>` is present, BGI linker flags are applied automatically. Files without it still compile as plain C++. |
| **▶️ Compile & Run** | `Ctrl+Alt+R` (compile & run), `Ctrl+Alt+B` (compile), plus **Run Last Build** — all in the Command Palette, the editor context menu, and keybindings. |
| **🧰 Per-OS linker recipes** | Windows (WinBGIM): `-lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32` + static linking. Linux (SDL_bgi): `-lSDL_bgi -lSDL2 -lm`, or libgraph: `-lgraph`. macOS: SDL_bgi via Homebrew SDL2. Custom library prefixes get matching `-Wl,-rpath` automatically. |
| **📊 Status bar indicator** | `✓ BGI` / `⚠ BGI` / `? BGI` at a glance. Click to run the Setup Doctor. |
| **✂️ Snippets** | `gfxprog`, `gfx-anim`, `gfx-mouse`, `gfx-kbd`, `gfx-text`, `gfx-bar`. |
| **📄 Code templates** | 5 insertable programs: basic window, animation loop, mouse paint, keyboard control, fractal tree. |
| **📖 Setup Guide** | In-editor webview with per-OS walkthroughs. |

## Install

**From the VS Code Marketplace (recommended):** search for **"graphics.h Runner"** in the
Extensions view (`Ctrl+Shift+X`), or from the command line:

```bash
code --install-extension mythos0-labs.graphics-h-runner
```

**From a GitHub release:** download `graphics-h-runner-1.0.0.vsix` from
[Releases](../../releases), then in VS Code: `Extensions view → ⋯ → Install from VSIX…`
(or `code --install-extension graphics-h-runner-1.0.0.vsix`).

**From source:**

```bash
git clone https://github.com/mythos0/graphics-h-runner.git
cd graphics-h-runner
npm install && npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension graphics-h-runner-*.vsix
```

## From zero to running (60 seconds)

1. Open the Command Palette → **`graphics.h: Full Setup — Install Everything (0 to running)`**.
2. Watch it work:
   - **Windows** — installs MinGW-w64 g++ via `winget` (manual WinLibs fallback provided), then
     downloads `graphics.h`, `winbgim.h`, `libbgi.a` into the extension folder and wires the paths.
     No copying into MinGW directories, no admin rights.
   - **Linux** — prints one copy-paste command for the system packages (`build-essential`,
     `libsdl2-dev` — password prompts work in the terminal), then **automatically** downloads,
     patches (two known upstream header fixes + screen-presentation fix), builds and installs
     SDL_bgi into `~/.graphics-h-runner/` — **no sudo needed for the library** — and wires
     include/lib/rpath into the extension settings.
   - **macOS** — `xcode-select` / `brew install sdl2` guidance, then the same automatic
     user-prefix SDL_bgi build.
3. When it says **VERIFIED: graphics.h is ready**, open any `.cpp` with `<graphics.h>` and press
   `Ctrl+Alt+R`.

## Commands & keybindings

| Command | Key | Description |
|---|---|---|
| `graphics.h: Compile & Run` | `Ctrl+Alt+R` | Compile (with BGI flags when needed) and run |
| `graphics.h: Compile` | `Ctrl+Alt+B` | Compile only |
| `graphics.h: Run Last Build` | — | Run the previously built binary |
| `graphics.h: Setup Doctor` | — | Probe compiler + libraries, offer fixes |
| `graphics.h: Full Setup` | — | The 0 → running bootstrap |
| `graphics.h: Insert Code Template` | — | 5 ready-made program templates |
| `graphics.h: Show Setup Guide` | — | In-editor setup walkthrough |
| `graphics.h: Open Example Program` | — | Open any bundled sample/template as `filename.cpp` (sidebar) |

### Sidebar

The **graphics.h Runner** icon in the Activity Bar shows, from top to bottom:

1. **Commands** — Compile & Run (`Ctrl+Alt+R`), Compile (`Ctrl+Alt+B`), Run Last Build, Setup Doctor,
   Full Setup, Insert Code Template, Show Setup Guide. One click runs the command; title-bar
   buttons (▶ ▦ ✓ 📖) mirror the four most-used ones.
2. **Example Programs (graphics.h)** — all 9 bundled samples. Clicking one creates
   `graphics-h-programs/<name>.cpp` in your workspace (if not already there) and opens it.
3. **Quick Templates** — the 5 minimal starting-point templates, opened the same way.

## Extension settings

| Setting | Default | Description |
|---|---|---|
| `graphics-h-runner.compilerPath` | `g++` | Compiler executable (full path for MinGW if not on PATH) |
| `graphics-h-runner.autoDetect` | `true` | Apply BGI flags only when `graphics.h` is detected |
| `graphics-h-runner.linuxLibrary` | `auto` | `auto` / `sdl_bgi` / `libgraph` |
| `graphics-h-runner.staticLinkWindows` | `true` | `-static-libgcc -static-libstdc++` on Windows |
| `graphics-h-runner.extraIncludePaths` | `[]` | Extra `-I` dirs (auto-managed by Full Setup) |
| `graphics-h-runner.extraLibPaths` | `[]` | Extra `-L` dirs (auto-managed by Full Setup) |
| `graphics-h-runner.extraCompilerArgs` | `[]` | e.g. `["-std=c++17", "-Wall"]` |
| `graphics-h-runner.showStatusBarItem` | `true` | Show the BGI status indicator |

## Tested & verified

Every sample below was compiled with the extension's exact flag-building code
(`out/buildArgs.js`), executed on a virtual display (Xvfb) and **screenshot-verified** by an
automated pipeline (`test/run-tests.js`, results in `test/test-results.json`):

| Sample | Verdict | Rendered content |
|---|---|---|
| `01_hello_graphics.cpp` | ✅ PASS (clean self-exit, exit 0) | shapes + text |
| `02_shapes_showcase.cpp` | ✅ PASS | bars, circles, ellipses, flood fill, 16-color palette |
| `03_bouncing_ball.cpp` | ✅ PASS | animated ball with trail |
| `04_moving_car.cpp` | ✅ PASS | scrolling road scene |
| `05_tricolor_flag.cpp` | ✅ PASS | flag with sun emblem (52% coverage) |
| `06_fractal_tree.cpp` | ✅ PASS | recursive fractal tree |
| `07_mandelbrot.cpp` | ✅ PASS | full Mandelbrot set, 120k putpixels |
| `08_mouse_paint.cpp` | ✅ PASS | mouse painting + color cycling |
| `09_keyboard_paddle.cpp` | ✅ PASS | paddle game with keyboard control |

Screenshots: [`docs/screenshots/`](docs/screenshots/) — e.g. the Mandelbrot render:

![Mandelbrot rendered by graphics.h Runner](docs/screenshots/07_mandelbrot.png)

![Brick-breaker sample rendered by graphics.h Runner](docs/screenshots/09_keyboard_paddle.png)

A **frame-tearing bug in the bundled SDL_bgi presentation path** was found by the screenshot
analyzer during testing (frames captured mid-draw showed bricks without the paddle/ball) and
fixed in the library build the Setup Engine produces: presentation is now event-driven — one
full-frame present per `delay()`/`kbhit()`/`getch()` call instead of one per drawing primitive.

The **setup engine** is tested end-to-end as well: fresh SDL_bgi download → patch → build →
user-prefix install → compile → verified render, plus WinBGIM asset validation
(`scripts/test_setup_engine.js` in the dev workspace).

## Per-OS setup (what Full Setup automates)

### Windows
1. **Compiler** — WinLibs MinGW-w64 via `winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT`
   or manually from [winlibs.com](https://winlibs.com/). Verify with `g++ --version`.
2. **WinBGIM** — Full Setup downloads it into the extension folder automatically. Manual route:
   copy `graphics.h` + `winbgim.h` into `<MinGW>\include` and `libbgi.a` into `<MinGW>\lib`.
3. The extension compiles with:
   `g++ main.cpp -o main.exe -lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32 -static-libgcc -static-libstdc++`

### Linux
1. `sudo apt install build-essential libsdl2-dev` (or `dnf`/`pacman` equivalents — Full Setup
   detects your package manager).
2. **SDL_bgi** — Full Setup downloads it, applies the compatibility patches, builds and installs
   it into `~/.graphics-h-runner/usr/` automatically (no sudo). Manual route: build from
   [sourceforge.net/projects/sdl-bgi](https://sourceforge.net/projects/sdl-bgi/) with
   `make && sudo make install`.
3. The extension compiles with: `g++ main.cpp -o main -lSDL_bgi -lSDL2 -lm`
4. *Tip:* if your own SDL_bgi 3.x build shows a black window, that is the upstream "fast mode"
   presentation quirk — set `SDL_BGI_RATE=auto` or call `refresh()` after drawing. Full
   Setup's build has this fixed automatically.

### macOS
1. `xcode-select --install` then `brew install sdl2`.
2. SDL_bgi — same automatic user-prefix build as Linux.

## Troubleshooting

- **"could not run g++"** — install a compiler (see per-OS above) or set
  `graphics-h-runner.compilerPath` to its full path.
- **Doctor says a library probe failed** — read the printed fix, or click **Fix automatically**.
- **Compiled but the window is black on a self-installed SDL_bgi 3.x** — set
  `SDL_BGI_RATE=auto`, or re-run Full Setup so the patched build is installed for you.
- **Windows: `winget` missing** — use the WinLibs manual download shown by Full Setup.

## Publishing notes (for maintainers)

Publishing is fully automated from GitHub:

- **Tag a release** — push a `vX.Y.Z` tag → [`.github/workflows/release.yml`](.github/workflows/release.yml)
  runs smoke tests, packages the .vsix, publishes to the VS Code Marketplace and creates a GitHub
  Release with the asset.
- **Bump the version on main** — [`.github/workflows/auto-publish.yml`](.github/workflows/auto-publish.yml)
  detects the `package.json` version change on every push to `main`, and if it changed: builds,
  publishes to the Marketplace, tags `vX.Y.Z` and creates the GitHub Release automatically.
- Both need one repository secret: **`VSCE_PAT`** — an Azure DevOps PAT with
  *Organization: all accessible organizations* and *Scopes: Marketplace → Manage*
  (create at dev.azure.com → User settings → Personal access tokens).
- Marketplace listing page: <https://marketplace.visualstudio.com/items?itemName=mythos0-labs.graphics-h-runner>
- OpenVSX (optional): `npx ovsx publish --pat $OPEN_VSX_TOKEN`.

## License

[MIT](LICENSE) — © 2026 MYTHOS0
