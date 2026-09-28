"use strict";
/**
 * panelHtml.ts — HTML/CSS for the graphics.h Runner activity-bar panel.
 *
 * Design language (v1.4.4): a flat, dark, professional control page —
 * no blueish/purple gradients, one green accent reserved for the primary
 * action, every other button in the same neutral style. The 1st action
 * button (Compile & Run) is the hero: big, full-width and alone on its row;
 * the remaining actions sit below it in a 2-per-row grid. The actions block
 * shares the header row with the title / status-pill+version-chip row and
 * uses the empty space beside them (the environment status card sits in the
 * same header, under the identity block); example programs run full width
 * below, and narrow activity bars stack naturally. Pure function,
 * unit-testable: no vscode import.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHEAT_ENTRY_COUNT = exports.CHEAT_SECTION_COUNT = void 0;
exports.buildPanelHtml = buildPanelHtml;
exports.buildFallbackPanelHtml = buildFallbackPanelHtml;
function esc(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** JSON safe for embedding in a <script> block (no </script>, <, U+2028…).
 *  Same discipline as celebrate.ts — the celebration config is built
 *  internally, but the escaping is contract-tested anyway. */
function jsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
/** v1.5.6: the in-panel celebration boot block — config + the confetti
 *  library + the controller, all nonce'd. The config is baked only when a
 *  celebration is active; the library + controller load whenever the host
 *  passes the media URIs (they no-op without a config). */
function celebrationBoot(opts) {
    const parts = [];
    if (opts.celebration) {
        parts.push(`<script nonce="${esc(opts.nonce)}">window.__GHR_CELEBRATE__ = ${jsonForScript(opts.celebration)};</script>`);
    }
    if (opts.confettiJsUri && opts.celebratePanelJsUri) {
        parts.push(`<script nonce="${esc(opts.nonce)}" src="${esc(opts.confettiJsUri)}"></script>`);
        parts.push(`<script nonce="${esc(opts.nonce)}" src="${esc(opts.celebratePanelJsUri)}"></script>`);
    }
    return parts.join('\n');
}
function statusPill(status) {
    if (status.state === 'ready') {
        return `<span class="pill pill-ok" id="env-pill"><span class="dot"></span>Ready — ${esc(status.library || 'graphics')}</span>`;
    }
    if (status.state === 'checking') {
        return `<span class="pill pill-wait" id="env-pill"><span class="dot dot-spin"></span>Checking environment…</span>`;
    }
    return `<span class="pill pill-bad" id="env-pill"><span class="dot"></span>Not ready${status.compilerOk ? ' — no graphics library' : ' — no C++ compiler'}</span>`;
}
function envCard(status) {
    if (status.state === 'not-ready') {
        return `
    <div class="card env-card" id="env-card">
      <div class="env-main">
        <div class="env-title">⚠️ Environment needs setup</div>
        <div class="env-sub">${status.compilerOk
            ? 'A C++ compiler was found, but the graphics library is missing. One click installs WinBGIM / SDL_bgi for you.'
            : 'No working C++ compiler found. One click installs the compiler + graphics library automatically — no admin rights needed.'}</div>
      </div>
      <button class="btn btn-accent btn-lg" data-cmd="graphics-h-runner.setupEverything" id="env-cta">🚀 Complete Run Setup</button>
    </div>`;
    }
    if (status.state === 'checking') {
        return `
    <div class="card env-card" id="env-card">
      <div class="env-main">
        <div class="env-title">🔎 Probing your PC…</div>
        <div class="env-sub">The Setup Doctor is looking for a compiler and graphics libraries.</div>
      </div>
    </div>`;
    }
    /* Ready state renders NOTHING: the green pill + version chip already
     * carry the "you are good to go" message, and the extra card only
     * pushed the actions down (removed on user request, v1.4.7). */
    return '';
}
function actionButtons(commands, fireworksRunning) {
    return commands
        .map((c) => {
        /* v1.5.5: the Fireworks Simulator button is the one festive button
         * (animated gradient) and flips to the red Stop state while the
         * show runs — data-cmd stays the toggle command either way. */
        const festive = c.variant === 'festive';
        const cls = c.primary
            ? 'btn-accent btn-hero'
            : festive
                ? fireworksRunning
                    ? 'btn-festive btn-festive-stop'
                    : 'btn-festive'
                : '';
        const title = festive && fireworksRunning ? 'Stop Fireworks' : c.title;
        const hint = festive && fireworksRunning ? 'show running — click to stop' : c.hint;
        const icon = festive && fireworksRunning ? '\u23f9' : c.icon;
        return `<button class="btn${cls ? ' ' + cls : ''}" data-cmd="${esc(c.commandId)}" id="${esc(c.id)}" title="${esc(title)}">
           <span class="btn-ico">${icon}</span>
           <span class="btn-body"><span class="btn-title">${esc(title)}</span><span class="btn-hint">${esc(hint)}</span></span>
         </button>`;
    })
        .join('\n        ');
}
function programCards(programs) {
    return programs
        .map((p) => `<div class="prog" id="prog-${esc(p.id)}">
           <div class="prog-emoji">${p.emoji}</div>
           <div class="prog-body">
             <div class="prog-title">${esc(p.title)} <span class="tag tag-${esc(p.tag)}">${esc(p.tag)}</span></div>
             <div class="prog-desc">${esc(p.description)}</div>
             <div class="prog-file">${esc(p.filename)}</div>
           </div>
           <div class="prog-actions">
             <button class="mini-btn" data-run="${esc(p.id)}" title="Open + compile + run">▶ Run</button>
             <button class="mini-btn" data-open="${esc(p.id)}" title="Open the source code">Open</button>
           </div>
         </div>`)
        .join('\n        ');
}
const CHEAT_SECTIONS = [
    {
        title: 'The screen coordinate system',
        entries: [
            {
                sig: '(0,0) = the TOP-LEFT corner',
                desc: '+x grows right, +y grows DOWN. getmaxx()/getmaxy() are the last drawable pixels. The Coordinate Viewer lab program shows this live.'
            }
        ]
    },
    {
        title: 'Run it here',
        entries: [
            {
                sig: 'Ctrl+Alt+R  (or F5)',
                desc: 'Compile & run the open .cpp — the compiler and graphics library are installed automatically on first run.'
            },
            {
                sig: 'ESC or Q (in the window)',
                desc: 'Programs run until YOU quit them — the graphics window and the terminal (with all output) stay open. Random keystrokes never stop a program. Ctrl+Alt+S force-stops.'
            },
            {
                sig: 'Ctrl+Alt+B',
                desc: 'Compile only; compiler errors land in the Problems panel.'
            },
            {
                sig: 'Ctrl+Alt+S',
                desc: 'Stop the running graphics program (Ctrl+C) — the runner terminal stays open with all output, ready for the next run.'
            }
        ]
    },
    {
        title: 'Celebrations',
        entries: [
            {
                sig: '\ud83c\udf89 Confetti on success',
                desc: 'Every successful compilation rains a confetti burst over THIS panel (canvas-confetti, Realistic Look) — no extra tab opens, and the panel stays clickable while the particles fall.'
            },
            {
                sig: '\u274c Error overlay',
                desc: 'When a compile stops on errors, a full-screen error overlay shows a giant shaking \u2717 and the compiler\u2019s first error messages in big type \u2014 click or press Esc to dismiss.'
            },
            {
                sig: '\ud83c\udf92 School Pride',
                desc: 'The first time the graphics.h panel opens in a session, a 5-second School Pride show fires across this panel (once per session).'
            },
            {
                sig: '\ud83c\udf86 Fireworks Simulator',
                desc: 'The festive action button launches a full-screen fireworks show — click it again (or Esc, or the red Stop button) to stop.'
            }
        ]
    },
    {
        title: 'Setup & lifecycle',
        entries: [
            {
                sig: 'initwindow(width, height, "title")',
                desc: 'WinBGIM: open a graphics window (title optional; also 2 args on SDL_bgi).'
            },
            {
                sig: 'initgraph(&gd, &gm, "path")',
                desc: 'Classic Turbo C++ style startup; detectgraph() picks a driver.'
            },
            { sig: 'closegraph()', desc: 'Close the window and shut the graphics system down.' },
            { sig: 'cleardevice()', desc: 'Erase the whole window (fill with the background color).' },
            { sig: 'getmaxx() / getmaxy()', desc: 'Last drawable pixel in x / y.' },
            { sig: 'delay(ms)', desc: 'Pause milliseconds — the heartbeat of every animation loop.' }
        ]
    },
    {
        title: 'Lines & shapes',
        entries: [
            { sig: 'putpixel(x, y, color)', desc: 'Color exactly one pixel (see getpixel below).' },
            { sig: 'line(x1, y1, x2, y2)', desc: 'Straight line between two points.' },
            {
                sig: 'lineto(x, y) / linerel(dx, dy)',
                desc: 'Line from the current position (absolute / relative).'
            },
            {
                sig: 'moveto(x, y) / moverel(dx, dy)',
                desc: 'Move the current position without drawing.'
            },
            { sig: 'rectangle(left, top, right, bottom)', desc: 'Outline rectangle.' },
            { sig: 'bar(left, top, right, bottom)', desc: 'Filled bar in the current fill style (no outline).' },
            {
                sig: 'bar3d(l, t, r, b, depth, topflag)',
                desc: '3-D bar; topflag=1 draws the top face.'
            },
            { sig: 'circle(x, y, radius)', desc: 'Circle outline.' },
            {
                sig: 'arc(x, y, start, end, radius)',
                desc: "Arc; angles in degrees, 0° at 3 o'clock, counter-clockwise."
            },
            {
                sig: 'ellipse(x, y, start, end, xrad, yrad)',
                desc: 'Elliptical arc; 0..360 for the full outline.'
            },
            { sig: 'fillellipse(x, y, xrad, yrad)', desc: 'Filled ellipse.' },
            { sig: 'pieslice(x, y, start, end, radius)', desc: 'Filled circular wedge.' },
            { sig: 'sector(x, y, start, end, xrad, yrad)', desc: 'Filled elliptical wedge.' },
            {
                sig: 'drawpoly(n, pts) / fillpoly(n, pts)',
                desc: 'Polygon outline / filled; pts is int[2n], repeat the first point to close.'
            }
        ]
    },
    {
        title: 'Colors & filling',
        entries: [
            {
                sig: 'BLACK=0 BLUE GREEN CYAN RED MAGENTA BROWN LIGHTGRAY DARKGRAY LIGHTBLUE LIGHTGREEN LIGHTCYAN LIGHTRED LIGHTMAGENTA YELLOW WHITE=15',
                desc: 'The 16 standard color constants (0..15) shared by every BGI implementation.'
            },
            { sig: 'setcolor(c) / setbkcolor(c)', desc: 'Current drawing color / background color.' },
            {
                sig: 'setfillstyle(pattern, color)',
                desc: 'Fill used by bar, fillpoly, pieslice, floodfill…'
            },
            {
                sig: 'floodfill(x, y, border)',
                desc: 'Flood-fill the region around (x,y) until the border color is met.'
            },
            {
                sig: 'getpixel(x, y)',
                desc: 'Color value of one pixel — the heart of a Pixel Inspector.'
            },
            { sig: 'COLOR(r, g, b)', desc: '24-bit color macro (WinBGIM / SDL_bgi extension).' },
            {
                sig: 'SOLID_FILL LINE_FILL SLASH_FILL BKSLASH_FILL HATCH_FILL XHATCH_FILL INTERLEAVE_FILL WIDE_DOT_FILL CLOSE_DOT_FILL EMPTY_FILL',
                desc: 'setfillstyle() pattern constants.'
            }
        ]
    },
    {
        title: 'Text',
        entries: [
            {
                sig: 'outtextxy(x, y, "text")',
                desc: 'Print a string at a pixel position (use a char buffer for numbers).'
            },
            {
                sig: 'settextstyle(font, dir, size)',
                desc: 'DEFAULT_FONT, TRIPLEX_FONT, SMALL_FONT, SANS_SERIF_FONT, GOTHIC_FONT; HORIZ_DIR / VERT_DIR.'
            },
            {
                sig: 'settextjustify(h, v)',
                desc: 'How x,y anchor the string (LEFT_TEXT, CENTER_TEXT, …).'
            },
            {
                sig: 'textheight("t") / textwidth("t")',
                desc: 'Pixel metrics of a string in the current font.'
            }
        ]
    },
    {
        title: 'Keyboard',
        entries: [
            {
                sig: 'getch()',
                desc: 'Wait for one key — keep the window open at the end of main().'
            },
            {
                sig: 'kbhit()',
                desc: 'True when a key is waiting: the non-blocking poll for animation loops.'
            },
            {
                sig: '0 / 224, then 72 80 75 77',
                desc: 'Arrow keys send a prefix (0 or 224), then UP=72 DOWN=80 LEFT=75 RIGHT=77.'
            },
            {
                sig: 'getch() == 27',
                desc: '27 is the Esc key code — the classic "quit on Esc" check; this extension\u2019s samples quit ONLY on Esc or Q.'
            }
        ]
    },
    {
        title: 'Mouse (WinBGIM / SDL_bgi)',
        entries: [
            { sig: 'ismouseclick(kind)', desc: 'True when that mouse event is queued.' },
            {
                sig: 'getmouseclick(kind, &x, &y)',
                desc: 'Pop the event and read the pixel position.'
            },
            {
                sig: 'clearmouseclick(kind)',
                desc: 'Drop queued events you do not handle.'
            },
            {
                sig: 'WM_MOUSEMOVE WM_LBUTTONDOWN WM_LBUTTONUP WM_RBUTTONDOWN WM_RBUTTONUP',
                desc: 'The mouse event kinds.'
            },
            {
                sig: 'getpixel(x, y)',
                desc: 'Pair the mouse position with a color — instant Pixel Inspector.'
            }
        ]
    },
    {
        title: 'Animation & images',
        entries: [
            {
                sig: 'imagesize(l, t, r, b)',
                desc: 'Bytes needed to snapshot a rectangle.'
            },
            {
                sig: 'getimage(l, t, r, b, bitmap)',
                desc: 'Snapshot a rectangle into a buffer.'
            },
            {
                sig: 'putimage(l, t, bitmap, verb)',
                desc: 'Stamp it back: COPY_PUT, XOR_PUT, AND_PUT, OR_PUT, NOT_PUT — the classic sprite trick.'
            },
            {
                sig: 'setactivepage(p) / setvisualpage(p)',
                desc: 'Double buffering where pages are supported.'
            }
        ]
    },
    {
        title: 'Viewport',
        entries: [
            {
                sig: 'setviewport(l, t, r, b, clip)',
                desc: 'Draw inside a sub-window; coordinates become relative to it.'
            },
            { sig: 'clearviewport()', desc: 'Erase only the current viewport.' }
        ]
    },
    {
        title: 'Common pitfalls',
        entries: [
            {
                sig: 'setfillstyle(...) BEFORE bar(...)',
                desc: 'Fills are STATE: bar/fillpoly/pieslice paint with the LAST setfillstyle — set the pattern and color before the draw call, not after.'
            },
            {
                sig: 'char buf[16]; sprintf(buf, "%d", n); outtextxy(x, y, buf);',
                desc: 'outtextxy takes a char*, never an int — format numbers into a buffer first (and keep the buffer in scope).'
            },
            {
                sig: 'getch() at the end of main()',
                desc: 'Without it the window closes the instant the program finishes — no key, no window, no output to check.'
            },
            {
                sig: 'cleardevice() → draw → delay(20)',
                desc: 'The animation loop rhythm: erase, redraw, breathe. Skipping the small delay makes frames flicker or never appear.'
            },
            {
                sig: 'putpixel is SLOW',
                desc: 'Never paint big areas pixel-by-pixel — use bar, fillpoly or putimage. Thousands of putpixel calls per frame will freeze the window.'
            }
        ]
    }
];
exports.CHEAT_SECTION_COUNT = CHEAT_SECTIONS.length;
exports.CHEAT_ENTRY_COUNT = CHEAT_SECTIONS.reduce((n, s) => n + s.entries.length, 0);
/**
 * v1.5.9: render the cheat sheet from CHEAT_SECTIONS. The only divs in the
 * whole overlay are emitted by the three templates here — the category
 * wrapper (`cheat-cat`), the entry row (`cheat-fn`) and the static shell —
 * each with its closing tag in the SAME template literal. All content goes
 * through esc(), so no entry can inject markup. Structure is balanced by
 * construction (the v1.5.8 stray-`</div>` bug class is impossible here).
 */
function cheatSheetHtml() {
    const sections = CHEAT_SECTIONS.map((sec) => '        <div class="cheat-cat">\n' +
        `          <h4>${esc(sec.title)}</h4>\n` +
        sec.entries
            .map((e) => `          <div class="cheat-fn"><code>${esc(e.sig)}</code><span>${esc(e.desc)}</span></div>`)
            .join('\n') +
        '\n        </div>').join('\n');
    return [
        '  <div class="cheat-overlay" id="cheat-overlay" role="dialog" aria-modal="true" aria-label="graphics.h cheat sheet">',
        '    <div class="cheat-sheet">',
        '      <div class="cheat-head">',
        '        <h3>graphics.h Cheat Sheet</h3>',
        '        <button class="cheat-close" id="cheat-close" type="button" title="Close (Esc)" aria-label="Close the cheat sheet">×</button>',
        '      </div>',
        '      <input class="cheat-q" id="cheat-q" type="text" placeholder="Search functions… try circle, mouse, fill, text" autocomplete="off">',
        '      <div class="cheat-body" id="cheat-body">',
        sections,
        '        <div id="cheat-empty">No functions match your search.</div>',
        '      </div>',
        '      <div class="cheat-foot">WinBGIM is the default on Windows; SDL_bgi on Linux/macOS. Press <span class="kbd">Esc</span> to close.</div>',
        '    </div>',
        '  </div>'
    ].join('\n');
}
function buildPanelHtml(opts) {
    const { commands, status, version, nonce, cspSource, logoUri } = opts;
    const fireworksRunning = !!opts.fireworksRunning;
    /* two sections: the classic catalog first, the Computer Graphics Lab
       (coordinate viewer, algorithm labs, pixel inspector) below it */
    const programs = opts.programs.filter((p) => !p.lab);
    const labPrograms = opts.programs.filter((p) => p.lab);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
<title>graphics.h Runner</title>
<style>
  :root {
    --bg:#0f1115;
    --card:rgba(255,255,255,.05); --card-line:rgba(255,255,255,.09);
    --txt:#e9ebef; --txt-dim:#9aa1ad;
    --grn1:#10b981; --grn2:#059669; --grn1h:#34d399; --grn2h:#10b981;
    --ok:#34d399; --bad:#f87171; --wait:#fbbf24;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  /* fixed-height page: header + actions stay put, only the programs list
     scrolls (inside its own container, like a second tab below the actions) */
  body {
    font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
    background:var(--bg);
    color:var(--txt); padding:14px 12px 14px;
    height:100vh; display:flex; flex-direction:column; overflow:hidden;
  }
  .hero { padding:2px 2px 6px; }
  .hero h1 { font-size:19px; letter-spacing:.3px; color:#f3f5f8; }
  /* university badge: on the exact right side of the footer — the footer
     is a flex row (credit text left, badge right, vertically centred
     against the whole text block) */
  .foot-brand { display:flex; align-items:center; flex:0 0 auto; }
  .diu-logo { height:32px; width:auto; max-width:150px; object-fit:contain;
    border-radius:5px; box-shadow:0 1px 5px rgba(0,0,0,.45); }
  @media (max-width: 360px) {
    .diu-logo { height:26px; max-width:120px; }
  }
  .pill { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600;
    padding:5px 13px; border-radius:999px; border:1px solid; }
  .pill-ok   { color:var(--ok);   border-color:rgba(52,211,153,.4);  background:rgba(52,211,153,.09); }
  .pill-bad  { color:var(--bad);  border-color:rgba(248,113,113,.4); background:rgba(248,113,113,.09); }
  .pill-wait { color:var(--wait); border-color:rgba(251,191,36,.4);  background:rgba(251,191,36,.09); }
  .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  .dot-spin { animation:pulse 1s infinite alternate; }
  @keyframes pulse { from {opacity:.35} to {opacity:1} }
  /* status row: the Ready/Not-ready pill with the version chip beside it */
  .status-row { display:flex; align-items:center; gap:8px; margin-top:10px; flex-wrap:wrap; }

  .card { background:var(--card); border:1px solid var(--card-line); border-radius:12px; padding:13px; margin-top:12px; }
  .env-card { display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-color:rgba(248,113,113,.35); }
  .env-card.env-ok { border-color:rgba(52,211,153,.35); }
  .env-main { flex:1 1 180px; }
  .env-title { font-size:13.5px; font-weight:700; }
  .env-sub { font-size:11.5px; color:var(--txt-dim); margin-top:4px; line-height:1.45; }

  /* buttons: one uniform neutral style; the green accent is reserved for the
     primary action only (1st action button + the setup call-to-action) */
  .btn { display:flex; align-items:center; gap:10px; width:100%; text-align:left;
    background:var(--card); border:1px solid var(--card-line); color:var(--txt);
    border-radius:10px; padding:9px 11px; cursor:pointer; transition:.15s; }
  .btn:hover { background:rgba(255,255,255,.09); border-color:rgba(255,255,255,.2); transform:translateY(-1px); }
  .btn:active { transform:translateY(0); }
  .btn-ico { font-size:15px; width:26px; height:26px; flex:0 0 26px; display:inline-flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.07); border-radius:7px; }
  .btn-body { display:flex; flex-direction:column; min-width:0; }
  .btn-title { font-size:12.5px; font-weight:600; }
  .btn-hint { font-size:10.5px; color:var(--txt-dim); }
  .btn-accent { background:linear-gradient(135deg, var(--grn1), var(--grn2)); border-color:transparent; }
  .btn-accent:hover { background:linear-gradient(135deg, var(--grn1h), var(--grn2h)); border-color:transparent; }
  .btn-accent .btn-ico { background:rgba(255,255,255,.18); }
  .btn-accent .btn-hint { color:rgba(255,255,255,.8); }
  .btn-lg { width:auto; padding:10px 16px; font-size:13px; font-weight:700; border-radius:10px; }
  /* the 1st action (Compile & Run) is the hero: alone on its row, full
     width, larger type and icon, soft green glow — responsive to the pane */
  .btn-hero { grid-column: 1 / -1; padding:14px 16px; gap:12px; border-radius:12px;
    box-shadow:0 8px 22px rgba(16,185,129,.22); }
  .btn-hero:hover { box-shadow:0 10px 26px rgba(16,185,129,.32); }
  .btn-hero .btn-ico { width:30px; height:30px; flex:0 0 30px; font-size:17px; border-radius:9px; }
  .btn-hero .btn-title { font-size:14.5px; font-weight:800; letter-spacing:.2px; }
  .btn-hero .btn-hint { font-size:11px; }

  /* v1.5.5: the Fireworks Simulator action button — deliberately festive
     (animated violet->pink->amber gradient), the one non-neutral button
     beside the green hero; flips to solid red while the show runs */
  .btn-festive { color:#fff; border-color:transparent;
    background:linear-gradient(120deg, #4c1d95, #7c3aed 30%, #db2777 65%, #f59e0b);
    background-size:220% 220%; animation:festive-shift 3.5s ease infinite; }
  .btn-festive:hover { border-color:rgba(255,255,255,.4); }
  .btn-festive .btn-ico { background:rgba(255,255,255,.2); }
  .btn-festive .btn-hint { color:rgba(255,255,255,.85); }
  @keyframes festive-shift { 0%,100% { background-position:0% 50%; } 50% { background-position:100% 50%; } }
  .btn-festive-stop { background:linear-gradient(135deg, #ef4444, #b91c1c); animation:none; }
  .btn-festive-stop:hover { background:linear-gradient(135deg, #f87171, #dc2626); }



  /* header layout: the action buttons live in the same header row as the
     title / status-pill row and fill the empty space beside
     them; on a narrow sidebar they wrap below the title block */
  .header { display:flex; flex-direction:column; flex:0 0 auto; }
  .header-actions { margin-top:6px; }
  /* secondary actions: 2 per row under the hero button (kept even on narrow
     panes; only very narrow sidebars collapse to one column) */
  .stack { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
  @media (max-width: 299px) {
    .stack { grid-template-columns:1fr; }
  }
  @media (min-width: 620px) {
    .header { flex-direction:row; align-items:flex-start; gap:16px; }
    .hero { flex:1 1 250px; min-width:0; }
    .header-actions { flex:0 0 360px; margin-top:0; }
  }

  /* programs zone: the section bar is the toggle; the list scrolls inside */
  .programs-zone { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
  #programs, #lab-programs { flex:1 1 auto; min-height:0; overflow-y:auto;
    overscroll-behavior:contain; margin:0 -2px; padding:0 2px; }
  #programs.collapsed, #lab-programs.collapsed { display:none; }
  .sec-toggle { cursor:pointer; user-select:none; border-radius:8px; padding:2px; }
  .sec-toggle:hover h2, .sec-toggle:hover .count { color:var(--txt); }
  .chev { font-size:9px; color:var(--txt-dim); display:inline-block; margin-left:6px; transition:transform .12s; }
  .chev-open { transform:rotate(90deg); }
  #programs::-webkit-scrollbar, #lab-programs::-webkit-scrollbar { width:8px; }
  #programs::-webkit-scrollbar-thumb, #lab-programs::-webkit-scrollbar-thumb { background:rgba(255,255,255,.14); border-radius:4px; }
  #programs::-webkit-scrollbar-thumb:hover, #lab-programs::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.26); }
  #programs::-webkit-scrollbar-track, #lab-programs::-webkit-scrollbar-track { background:transparent; }

  .sec { display:flex; align-items:baseline; justify-content:space-between; margin:14px 2px 0; }
  .sec-tight { margin:0 2px 7px; }
  .sec h2 { font-size:11px; text-transform:uppercase; letter-spacing:1.6px; color:var(--txt-dim); font-weight:700; }
  .sec .count { font-size:10.5px; color:var(--txt-dim); }

  .prog { display:flex; gap:10px; align-items:center; background:var(--card);
    border:1px solid var(--card-line); border-radius:11px; padding:9px 10px; margin-top:8px; transition:.15s; }
  .prog:hover { border-color:rgba(255,255,255,.22); background:rgba(255,255,255,.08); transform:translateY(-1px); }
  .prog-emoji { font-size:20px; width:38px; height:38px; flex:0 0 38px; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.06); border-radius:9px; }
  .prog-body { flex:1; min-width:0; }
  .prog-title { font-size:12.5px; font-weight:650; }
  .prog-desc { font-size:10.8px; color:var(--txt-dim); margin-top:2px; }
  .prog-file { font-size:9.5px; color:rgba(154,161,173,.65); margin-top:3px; font-family:Consolas, monospace; }
  .tag { font-size:8.5px; text-transform:uppercase; letter-spacing:.8px; padding:1.5px 7px; border-radius:999px; vertical-align:2px; }
  .tag-fun { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-classic { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-math { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .tag-interactive { background:rgba(255,255,255,.09); color:#c3c9d4; }
  .prog-actions { display:flex; flex-direction:column; gap:5px; }
  .mini-btn { font-size:11px; font-weight:600; color:var(--txt); background:rgba(255,255,255,.08);
    border:1px solid var(--card-line); border-radius:8px; padding:4px 10px; cursor:pointer; transition:.15s; white-space:nowrap; }
  .mini-btn:hover { background:rgba(255,255,255,.15); }

  .foot { display:flex; align-items:center; justify-content:space-between; gap:12px;
    font-size:10.5px; color:var(--txt-dim); margin-top:auto; line-height:1.7;
    border-top:1px solid var(--card-line); padding-top:10px; flex:0 0 auto; }
  .foot b { color:var(--txt); }
  .foot .credit { flex:1 1 auto; min-width:0; }
  .kbd { background:rgba(255,255,255,.09); border:1px solid var(--card-line); border-radius:5px; padding:1px 6px; font-size:10px; }
  .chip { display:inline-block; font-size:10px; color:var(--txt-dim); border:1px solid var(--card-line); border-radius:999px; padding:2px 10px; margin:0 3px; }

  /* v1.5.9: the "?" cheat-sheet button moved OUT of the panel header to
     the view TITLE bar (package.json view/title + the
     graphics-h-runner.cheatSheet command) — the activity-bar view header
     now carries exactly one icon, and the panel page opens the sheet on
     the host's {type:'cheat', open:true} message instead of a local
     button (the open/close/search logic below is unchanged). */
  /* lab tag gets the ready-green tint — every lab program is verified */
  .tag-lab { background:rgba(52,211,153,.14); color:#8fe3c4; }
  .sec-gap { height:6px; flex:0 0 auto; }

  /* cheat sheet overlay: fixed backdrop + scrollable reference card.
     Pure client-side — no host round-trip, Esc or backdrop closes. */
  .cheat-overlay { position:fixed; inset:0; background:rgba(5,8,12,.72);
    display:none; z-index:80; padding:12px; }
  .cheat-overlay.open { display:flex; align-items:flex-start; justify-content:center; }
  .cheat-sheet { width:100%; max-width:560px; max-height:100%; display:flex; flex-direction:column;
    background:#141821; border:1px solid var(--card-line); border-radius:12px;
    box-shadow:0 18px 50px rgba(0,0,0,.55); overflow:hidden; }
  .cheat-head { display:flex; align-items:center; gap:8px; padding:11px 12px;
    border-bottom:1px solid var(--card-line); flex:0 0 auto; }
  .cheat-head h3 { font-size:13.5px; color:#f3f5f8; flex:1 1 auto; }
  .cheat-close { width:24px; height:24px; flex:0 0 24px; border-radius:7px;
    border:1px solid var(--card-line); background:rgba(255,255,255,.07);
    color:var(--txt-dim); font-size:13px; cursor:pointer; line-height:1; }
  .cheat-close:hover { color:var(--txt); background:rgba(255,255,255,.15); }
  .cheat-q { margin:10px 12px 0; padding:8px 10px; font-size:12px; color:var(--txt);
    background:rgba(255,255,255,.06); border:1px solid var(--card-line);
    border-radius:8px; outline:none; width:calc(100% - 24px); }
  .cheat-q:focus { border-color:rgba(255,255,255,.25); }
  .cheat-q::placeholder { color:var(--txt-dim); }
  .cheat-body { overflow-y:auto; padding:10px 12px 14px; flex:1 1 auto; }
  .cheat-cat { margin-top:10px; }
  .cheat-cat h4 { font-size:10px; text-transform:uppercase; letter-spacing:1.4px;
    color:var(--txt-dim); margin-bottom:6px; }
  .cheat-fn { padding:6px 8px; border:1px solid var(--card-line); border-radius:8px;
    margin-bottom:5px; background:rgba(255,255,255,.03); }
  .cheat-fn code { display:block; font-family:Consolas, monospace; font-size:11px;
    color:var(--ok); }
  .cheat-fn span { display:block; font-size:10.8px; color:var(--txt-dim);
    margin-top:2px; line-height:1.4; }
  #cheat-empty { display:none; font-size:11.5px; color:var(--txt-dim); padding:10px 2px; }
  .cheat-foot { flex:0 0 auto; border-top:1px solid var(--card-line); padding:8px 12px;
    font-size:10px; color:var(--txt-dim); }
  .cheat-foot .kbd { margin:0 2px; }

  /* narrow activity-bar sidebar: stack card actions inline */
  @media (max-width: 360px) {
    body { padding:10px 9px 12px; }
    .prog { flex-wrap:wrap; }
    .prog-body { flex:1 1 calc(100% - 110px); }
    .prog-actions { flex-direction:row; width:100%; justify-content:flex-end; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="hero">
      <h1>graphics.h Runner</h1>
      <div class="status-row">${statusPill(status)}<span class="chip">v${esc(version)}</span></div>
      ${envCard(status)}
    </div>

    <div class="header-actions">
      <div class="sec sec-tight"><h2>Actions</h2></div>
      <div class="stack">
        ${actionButtons(commands, fireworksRunning)}
      </div>
    </div>
  </div>

  <div class="programs-zone">
    <div class="sec sec-toggle" id="programs-sec" role="button" tabindex="0" aria-expanded="false"
         title="Show / hide the example programs">
      <h2>Example Programs<span class="chev" id="programs-chev">▶</span></h2>
      <span class="count" id="programs-count">${programs.length} programs · tap to expand</span>
    </div>
    <div id="programs" class="collapsed">
      ${programCards(programs)}
    </div>

    <div class="sec-gap"></div>
    <div class="sec sec-toggle" id="lab-sec" role="button" tabindex="0" aria-expanded="false"
         title="Show / hide the Computer Graphics Lab programs">
      <h2>Computer Graphics Lab<span class="chev" id="lab-chev">▶</span></h2>
      <span class="count" id="lab-count">${labPrograms.length} lab programs · tap to expand</span>
    </div>
    <div id="lab-programs" class="collapsed">
      ${programCards(labPrograms)}
    </div>
  </div>

  <div class="foot">
    <div class="credit"><b>Powered by Department of CSE, Dhaka International University, Bangladesh.</b></div>
    ${logoUri ? `<div class="foot-brand"><img class="diu-logo" src="${esc(logoUri)}" alt="Daffodil International University — Department of CSE" title="Powered by the Department of CSE, Dhaka International University"></div>` : ''}
  </div>

${cheatSheetHtml()}
<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
    /* liveness: the page answers as soon as its script executes — a dead
       webview (service-worker race) never answers, which the extension
       detects and recovers from (retry render / list-view fallback) */
    vscode.postMessage({ type: 'pong' });
    /* Example Programs: collapsed by default; the choice is remembered
       across panel re-renders via the webview's persisted state */
    var progSec = document.getElementById('programs-sec');
    var progList = document.getElementById('programs');
    var progChev = document.getElementById('programs-chev');
    var progCount = document.getElementById('programs-count');
    function programsOpen() {
      try { return !!(vscode.getState() && vscode.getState().programsOpen); }
      catch (e) { return false; }
    }
    function applyProgramsState() {
      var open = programsOpen();
      if (progList) { progList.classList.toggle('collapsed', !open); }
      if (progChev) { progChev.className = open ? 'chev chev-open' : 'chev'; }
      if (progCount && progCount.textContent) {
        progCount.textContent = progCount.textContent
          .replace(/ · (tap to expand|click Run or Open)$/,
                   open ? ' · click Run or Open' : ' · tap to expand');
      }
      if (progSec) { progSec.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    }
    function togglePrograms() {
      try { var st = vscode.getState() || {}; st.programsOpen = !programsOpen(); vscode.setState(st); } catch (e) {}
      applyProgramsState();
    }
    if (progSec) {
      progSec.addEventListener('click', togglePrograms);
      progSec.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); togglePrograms(); }
      });
    }
    applyProgramsState();

    /* Computer Graphics Lab: its own toggle, its own persisted state.
       Both toggles MERGE into the saved state object so they never
       wipe each other (vscode.setState replaces the whole state). */
    var labSec = document.getElementById('lab-sec');
    var labList = document.getElementById('lab-programs');
    var labChev = document.getElementById('lab-chev');
    var labCount = document.getElementById('lab-count');
    function labOpen() {
      try { return !!(vscode.getState() && vscode.getState().labOpen); }
      catch (e) { return false; }
    }
    function applyLabState() {
      var open = labOpen();
      if (labList) { labList.classList.toggle('collapsed', !open); }
      if (labChev) { labChev.className = open ? 'chev chev-open' : 'chev'; }
      if (labCount && labCount.textContent) {
        labCount.textContent = labCount.textContent
          .replace(/ \u00b7 (tap to expand|click Run or Open)$/,
                   open ? ' \u00b7 click Run or Open' : ' \u00b7 tap to expand');
      }
      if (labSec) { labSec.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    }
    function toggleLab() {
      try { var st = vscode.getState() || {}; st.labOpen = !labOpen(); vscode.setState(st); } catch (e) {}
      applyLabState();
    }
    if (labSec) {
      labSec.addEventListener('click', toggleLab);
      labSec.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleLab(); }
      });
    }
    applyLabState();

    /* graphics.h cheat sheet: opens from the ? button in the VIEW TITLE
       bar (the host sends {type:'cheat', open:true}), searchable, Esc /
       backdrop / × closes it. The open state is persisted and reported
       to the host (v1.5.8) so re-renders never destroy it. */
    var cheatOv = document.getElementById('cheat-overlay');
    /* v1.5.8: the sheet's open state is part of the persisted webview
       state (merged, never wiping the section toggles) AND reported to
       the host — while it is open the host DEFERS full re-renders, so a
       doctor/busy/celebration update can no longer swap the page out
       from under the reading user (the "? click does nothing" report:
       the sheet opened and was instantly destroyed by a re-render). */
    function cheatStateOpen() {
      try { return !!(vscode.getState() && vscode.getState().cheatOpen); } catch (e) { return false; }
    }
    function setCheatState(open) {
      try { var st = vscode.getState() || {}; st.cheatOpen = !!open; vscode.setState(st); } catch (e) {}
      try { vscode.postMessage({ type: 'cheat', open: !!open }); } catch (e) {}
    }
    function filterCheat(raw) {
      var qv = String(raw || '').toLowerCase();
      var fns = document.querySelectorAll('.cheat-fn');
      var hits = 0;
      for (var i = 0; i < fns.length; i++) {
        var show = !qv || fns[i].textContent.toLowerCase().indexOf(qv) !== -1;
        fns[i].style.display = show ? '' : 'none';
        if (show) { hits++; }
      }
      var cats = document.querySelectorAll('.cheat-cat');
      for (var j = 0; j < cats.length; j++) {
        var kids = cats[j].querySelectorAll('.cheat-fn');
        var any = false;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].style.display !== 'none') { any = true; break; }
        }
        cats[j].style.display = any ? '' : 'none';
      }
      var empty = document.getElementById('cheat-empty');
      /* v1.5.9 fix: '' falls back to the stylesheet's display:none — the
         empty-state row could never appear in 1.5.8; force block here */
      if (empty) { empty.style.display = hits ? 'none' : 'block'; }
    }
    function openCheat() {
      if (!cheatOv) { return; }
      cheatOv.classList.add('open');
      var q = document.getElementById('cheat-q');
      if (q) { q.value = ''; filterCheat(''); }
      var body = document.getElementById('cheat-body');
      if (body) { body.scrollTop = 0; }
      setCheatState(true);
    }
    function closeCheat() {
      if (!cheatOv) { return; }
      cheatOv.classList.remove('open');
      setCheatState(false);
    }
    var cheatClose = document.getElementById('cheat-close');
    if (cheatClose) { cheatClose.addEventListener('click', closeCheat); }
    if (cheatOv) {
      cheatOv.addEventListener('click', function (ev) { if (ev.target === cheatOv) { closeCheat(); } });
    }
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeCheat(); } });
    var cheatQ = document.getElementById('cheat-q');
    if (cheatQ) { cheatQ.addEventListener('input', function () { filterCheat(cheatQ.value); }); }
    /* v1.5.8: a fresh page (re-render, retry, reload) reopens the sheet
       from the persisted state — the sheet survives every re-render */
    if (cheatStateOpen()) { openCheat(); }
    /* always re-sync the host on boot so a stale in-flight report from
       the previous page can never park re-renders forever */
    try { vscode.postMessage({ type: 'cheat', open: cheatStateOpen() }); } catch (e) {}
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.dataset) {
          if (el.dataset.cmd) { vscode.postMessage({ type: 'command', command: el.dataset.cmd }); return; }
          if (el.dataset.run)  { vscode.postMessage({ type: 'runProgram', id: el.dataset.run }); return; }
          if (el.dataset.open) { vscode.postMessage({ type: 'openProgram', id: el.dataset.open }); return; }
        }
        el = el.parentElement;
      }
    });
    window.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.type === 'ping') { vscode.postMessage({ type: 'pong' }); return; }
      /* v1.5.9: the ? in the view TITLE bar opens/closes the sheet — the
         host drives the page because the in-panel button is gone */
      if (m.type === 'cheat') { if (m.open) { openCheat(); } else { closeCheat(); } return; }
      if (m.type === 'busy' && m.busy) {
        var pill = document.getElementById('env-pill');
        if (pill) {
          pill.className = 'pill pill-wait';
          pill.innerHTML = '<span class="dot dot-spin"></span>' + (m.label ? String(m.label).replace(/</g, '&lt;') : 'Working…');
        }
      }
      /* busy=false -> the extension re-renders the whole panel HTML */
    });
  })();
</script>
${celebrationBoot(opts)}
</body>
</html>`;
}
/**
 * Static recovery page shown inside the webview when the panel page itself
 * could not load (service-worker race). Deliberately tiny and dependency-
 * free: it still carries the liveness pong and a Retry button, and points
 * the user at the native list view that the extension reveals beside it.
 */
function buildFallbackPanelHtml(opts) {
    const { version, nonce, cspSource, reason } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>graphics.h Runner</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
    background:#0f1115; color:#e9ebef; padding:16px 14px; }
  h1 { font-size:17px; color:#f3f5f8; }
  .card { background:rgba(255,255,255,.05); border:1px solid rgba(248,113,113,.35);
    border-radius:12px; padding:14px; margin-top:12px; }
  .card p { font-size:12px; color:#9aa1ad; line-height:1.6; }
  .card b { color:#e9ebef; }
  button { margin-top:12px; width:100%; padding:11px 14px; font-size:13px; font-weight:700;
    color:#fff; background:linear-gradient(135deg, #10b981, #059669); border:0;
    border-radius:10px; cursor:pointer; }
  .hint { font-size:11px; color:#9aa1ad; margin-top:12px; line-height:1.6; }
  .kbd { background:rgba(255,255,255,.09); border:1px solid rgba(255,255,255,.09);
    border-radius:5px; padding:1px 6px; font-size:10px; }
  .ver { font-size:10px; color:#9aa1ad; margin-top:14px; }
</style>
</head>
<body>
  <h1>graphics.h Runner</h1>
  <div class="card">
    <p><b>The panel could not load.</b></p>
    <p>${esc(reason)} Your example programs and actions are still available in the
    <b>graphics.h Programs (List)</b> view that was just opened.</p>
    <button data-cmd="graphics-h-runner.reloadPanel">Retry panel</button>
  </div>
  <p class="hint">You can also reload later from the Command Palette:
  <span class="kbd">graphics.h: Reload Panel</span>. In a .cpp file,
  <span class="kbd">Ctrl+Alt+R</span> keeps working regardless of this panel.</p>
  <p class="ver">v${esc(version)} · fallback view active</p>
<script nonce="${nonce}">
  (function () {
    var vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'pong' });
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.cmd) { vscode.postMessage({ type: 'command', command: el.dataset.cmd }); return; }
        el = el.parentElement;
      }
    });
  })();
</script>
</body>
</html>`;
}
//# sourceMappingURL=panelHtml.js.map