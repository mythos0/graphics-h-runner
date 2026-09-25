/**
 * guide.ts — HTML content for the "Show Setup Guide" webview.
 */

export function guideHtml(platform: string): string {
  const winActive = platform === 'windows';
  const linuxActive = platform === 'linux';
  const macActive = platform === 'macos';

  const section = (title: string, body: string, active: boolean) => `
    <div class="card ${active ? 'active' : ''}">
      <h2>${title}${active ? ' <span class="you">← your platform</span>' : ''}</h2>
      ${body}
    </div>`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 16px 24px; color: var(--vscode-editor-foreground); line-height: 1.55; }
  h1 { font-size: 1.5em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
  h2 { font-size: 1.15em; margin-top: 0; }
  code, pre { font-family: Consolas, Menlo, monospace; font-size: 0.92em; }
  pre { background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px 18px; margin: 14px 0; opacity: 0.78; }
  .card.active { opacity: 1; border-color: var(--vscode-focusBorder); }
  .you { color: var(--vscode-textLink-foreground); font-size: 0.85em; }
  kbd { background: var(--vscode-keybindingLabel-background); border-radius: 3px; padding: 1px 5px; }
  a { color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
  <h1>graphics.h Setup Guide</h1>
  <p><strong>The fast path:</strong> run <strong>graphics.h: Full Setup — Install Everything (0 to running)</strong> from the
  Command Palette. It installs what it can automatically (WinBGIM / SDL_bgi — no admin rights needed, paths wired for you)
  and prints copy-paste commands for anything that needs your password. This page documents what it does.</p>
  <p>Under the hood the extension turns <code>g++</code> into a one-press graphics.h compiler: a C++ compiler plus a
  <em>BGI-compatible</em> graphics library. Press <kbd>Ctrl+Alt+R</kbd> in any <code>.cpp</code> file that includes
  <code>&lt;graphics.h&gt;</code> and watch the window appear.</p>

  ${section(
    '🪟 Windows — WinBGIM + MinGW-w64',
    `<p><strong>Fully automatic (recommended):</strong> run <strong>graphics.h: Full Setup</strong> from the Command Palette.
    On a fresh PC it now installs <em>everything</em> by itself — the MinGW-w64 g++ compiler (via winget, or a verified
    direct download as fallback) <em>and</em> WinBGIM — all per-user, no administrator rights, and it wires every path into
    the settings for you. If a compile ever reports a missing compiler, the extension offers this setup with one click.</p>
    <p>Manual route (only if you prefer it):</p>
    <ol>
      <li>Install <strong>MinGW-w64 g++</strong> — easiest via <a href="https://winlibs.com">winlibs.com</a> (unpack and add its <code>bin\\</code> to <code>PATH</code>) or <a href="https://www.msys2.org">MSYS2</a> (<code>pacman -S mingw-w64-ucrt-x86_64-gcc</code>).</li>
      <li>Install <strong>WinBGIM</strong>:
        <ul>
          <li>Copy <code>graphics.h</code> and <code>winbgim.h</code> into <code>&lt;MinGW&gt;\\include</code></li>
          <li>Copy <code>libbgi.a</code> into <code>&lt;MinGW&gt;\\lib</code></li>
        </ul>
      </li>
      <li>Verify in a terminal: <pre>g++ --version</pre></li>
      <li>In VS Code run <strong>graphics.h: Setup Doctor</strong> from the Command Palette — it must report <em>winbgim: OK</em>.</li>
    </ol>
    <p>The extension compiles with (fully statically linked — the .exe runs on any Windows 10/11):<pre>g++ main.cpp -o main.exe -static -lbgi -lgdi32 -lcomdlg32 -luuid -loleaut32 -lole32 -static-libgcc -static-libstdc++</pre></p>`,
    winActive
  )}

  ${section(
    '🐧 Linux — SDL_bgi (recommended) or libgraph',
    `<p><strong>Option A — SDL_bgi</strong> (modern, maintained, supports <code>initwindow</code>):</p>
    <ol>
      <li><pre>sudo apt install build-essential libsdl2-dev</pre></li>
      <li>Get SDL_bgi from <a href="https://sourceforge.net/projects/sdl-bgi/">sourceforge.net/projects/sdl-bgi</a> and build:<pre>tar zxvf SDL_bgi-*.tar.gz
cd SDL_bgi-*/src
make
sudo make install   # installs graphics.h + libSDL_bgi.so</pre></li>
      <li>If you install into a custom folder, add it under settings:
        <code>graphics-h-runner.extraIncludePaths</code> / <code>extraLibPaths</code>.</li>
    </ol>
    <p><strong>Option B — libgraph</strong> (classic college setup):</p>
    <pre>sudo apt install libsdl1.2-dev
# build libgraph 1.0.2 from sourceforge.net/projects/libgraph
./configure && make && sudo make install</pre>
    <p>Then set <code>graphics-h-runner.linuxLibrary</code> to <code>libgraph</code>.</p>
    <p>The extension compiles with:<pre>g++ main.cpp -o main -lSDL_bgi -lSDL2 -lm</pre></p>
    <p><em>Tip:</em> if your SDL_bgi 3.x shows a black window, set the environment variable
    <code>SDL_BGI_RATE=auto</code> or call <code>refresh()</code> after drawing — newer SDL_bgi defers screen updates in fast mode.</p>`,
    linuxActive
  )}

  ${section(
    ' macOS — SDL_bgi via Homebrew SDL2',
    `<ol>
      <li><pre>brew install sdl2</pre></li>
      <li>Build SDL_bgi from <a href="https://sourceforge.net/projects/sdl-bgi/">sourceforge.net/projects/sdl-bgi</a>:
        <pre>make
sudo make install</pre></li>
      <li>If headers land in a non-standard prefix, add it via <code>extraIncludePaths</code>/<code>extraLibPaths</code>.</li>
    </ol>`,
    macActive
  )}

  <h2>Using the extension</h2>
  <ul>
    <li><strong>Full Setup (0 → running)</strong> — Command Palette → <em>graphics.h: Full Setup</em>; installs WinBGIM/SDL_bgi automatically and guides the rest.</li>
    <li><strong>Compile &amp; Run</strong> — <kbd>Ctrl+Alt+R</kbd> or right-click in the editor.</li>
    <li><strong>Compile</strong> — <kbd>Ctrl+Alt+B</kbd>.</li>
    <li><strong>Setup Doctor</strong> — Command Palette → <em>graphics.h: Setup Doctor</em>; verifies compiler + libraries, offers <em>Fix automatically</em>.</li>
    <li><strong>Snippets</strong> — type <code>gfx-</code> in a .cpp file for ready-made templates.</li>
  </ul>
</body>
</html>`;

  return html;
}
