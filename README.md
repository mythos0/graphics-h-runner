<p align="center">
  <img src="media/diu-logo.png" alt="Dhaka International University — Knowledge is Power" width="260"/>
</p>
<h3 align="center">Developed by the Department of CSE, <a href="https://www.diu.ac.bd/">Dhaka International University</a>, Bangladesh</h3>

---

# graphics.h Runner — One-Click Setup

**Compile and run C++ `graphics.h` (BGI / WinBGIm / SDL_bgi) programs in VS Code — with one keypress.**
One command prepares everything from zero: the compiler itself, the graphics library, the linker
flags and the native VS Code run integration. No admin rights required for the graphics library.

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

Press **`Ctrl+Alt+R`** — compiled with the right flags, the graphics window opens.

## Install

Extensions view → search **"graphics.h Runner"** → Install, or:

```bash
code --install-extension mythos0-labs.graphics-h-runner
```

## Quick start — from zero to a graphics window

1. Command Palette → **`graphics.h: Complete Run Setup`**.
2. It does the rest, per OS:
   - **Windows** — installs a MinGW-w64 g++ (winget, or a checksum-verified direct download),
     then installs WinBGIM and wires every path. Per-user, no admin rights.
   - **Linux** — prints one copy-paste command for the system packages, then downloads, patches,
     builds and installs SDL_bgi into a user prefix (no sudo needed for the library).
   - **macOS** — `xcode-select` / `brew install sdl2` guidance + the same user-prefix build.
3. When it says **graphics.h is ready**, open any `.cpp` with `<graphics.h>` and press `Ctrl+Alt+R`.

## What you get

- **One-click setup & self-repair** — compiler + graphics library installed and verified live;
  anything needing a password is handed to the terminal as a copy-paste command. If a compiler
  path goes stale or a library install breaks, the extension heals it and retries automatically.
- **Native VS Code run (F5 / Ctrl+Alt+N / Ctrl+Shift+B)** — the standard workflows use the same
  toolchain through the built-in `graphics-h` debug adapter, Code Runner and a default build task.
  All writes are merge-safe, and **uninstalling the extension restores your original settings**.
- **21 bundled programs** — the **Game Suite**: Snake (top-5 score database), 2-Player Football
  (hand-rasterized pitch, AI keepers, two halves) and the Nokia-style **Bounce** (six levels,
  springs, spikes, synthesized sounds) — plus the **Computer Graphics Lab**: a graded ladder from
  zero to advanced (First Window, Colors & Pixels, Shapes & Text, Keyboard & Mouse, Animation
  Loop, Sprites, Scanline Fill, Bézier Curves, Fractals, 3-D Wireframe Cube) alongside the
  classics (Coordinate Viewer, Pixel Inspector, DDA, Bresenham line & circle, Midpoint Ellipse,
  2D Transformations, Cohen–Sutherland Clipping). Every lab narrates its steps in the terminal.
- **Setup Doctor** — probes the compiler and every library candidate by actually compiling a
  `graphics.h` program, then reports exactly what is missing with a one-click fix.
- **Compiler errors in the Problems panel** — g++ output becomes clickable file:line diagnostics.
- **Terminal input & output** — `cin` / `scanf` / `getch()` work in the one persistent runner
  terminal; `Ctrl+Alt+S` stops the running program.
- **Activity-bar panel** — live Ready/Not-ready pill, full action grid incl. **Reset Setup**
  (reverts everything Setup changed at any time), all programs as one-click Run/Open cards, and
  a searchable **graphics.h cheat sheet** (81 entries) behind the **?** button.
- **Messy-settings healing** — quoted paths, env vars, `~`, directory-instead-of-exe paths,
  stale include/lib dirs: recognized and corrected on every run.
- **Snippets** — `gfxprog`, `gfx-anim`, `gfx-mouse`, `gfx-kbd`, `gfx-text`, `gfx-bar`.
- **Celebrations** (optional) — confetti on compile success, an error overlay with the first
  compiler messages on failure, and a bundled Fireworks Simulator (click-to-burst). No network
  requests; disable with `graphics-h-runner.celebrations.enabled`.

## Commands & keybindings

| Command | Key |
|---|---|
| Compile & Run | `Ctrl+Alt+R` |
| Compile | `Ctrl+Alt+B` |
| Stop Running Program | `Ctrl+Alt+S` |
| Run graphics.h program | `F5` |
| Run Last Build / Setup Doctor / Complete Run Setup / Reset Setup / Copy Compile Command | Command Palette |

## Settings

| Setting | Default |
|---|---|
| `graphics-h-runner.compilerPath` | `g++` |
| `graphics-h-runner.autoDetect` | `true` |
| `graphics-h-runner.linuxLibrary` | `auto` |
| `graphics-h-runner.extraIncludePaths` / `extraLibPaths` / `extraCompilerArgs` | `[]` |
| `graphics-h-runner.showStatusBarItem` | `true` |
| `graphics-h-runner.celebrations.enabled` | `true` |

## Troubleshooting

- **"could not run g++"** — run Complete Setup, or point `compilerPath` at your compiler.
- **Doctor says a probe failed** — click **Fix automatically**, or follow the printed fix.
- **Black window on a self-built SDL_bgi 3.x** — set `SDL_BGI_RATE=auto`, or re-run Complete
  Setup to get the patched build.
- **`undefined reference` to graphics symbols** — your compiler can't use the installed library
  (typical: legacy 32-bit MinGW.org g++); Complete Setup installs a compatible 64-bit one.

## Telemetry

Crash and error reports are collected through [Sentry](https://sentry.io) **only** when VS Code
telemetry is enabled. Never collected: your source code, file contents, compiler output, or
anything you type; user-identifying path segments are scrubbed before anything leaves your machine.

## License

[MIT](LICENSE) — © 2026 MYTHOS0
