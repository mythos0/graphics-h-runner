/**
 * robust-fixtures.js — graphics.h test programs for robust-tests.js.
 *
 * Each fixture stresses a different production path:
 *   rfx01  terminal I/O (cin table -> bar chart, EOF-safe demo fallback)
 *   rfx02  physics animation (cleardevice erase, bounce, kbhit exit)
 *   rfx03  conio-style poll menu (kbhit/getch never blocks, autopilot)
 *   rfx04  math-heavy per-pixel rendering (Julia morph, 2 frames)
 *   rfx05  getimage/putimage ops (COPY/XOR/OR/AND/NOT) + sprite ride
 *   rfx06  viewport clipping (two panes, clearviewport, labels survive)
 *   rfx07  text styles/sizes matrix + long strings + metrics layout
 *   rfx08  fill patterns + floodfill nesting + bar3d/pieslice/sector
 *   rfx09  primitive stress (15k putpixel, 3k lines, 800 circles)
 *   rfx10  key echo pad (non-blocking input contract, q/ESC exit)
 *   rfx11  deliberate crash (SIGSEGV) — exit must surface as non-zero
 *   rfx12  compile-error source — stderr feeds the production diagnostics
 *
 * All self-exit (frames/time bound), all sandbox-safe (2-arg initwindow on
 * POSIX, 3-arg guarded for WinBGIM), no getimage background-restore erase
 * (SDL_bgi alpha blending makes it unable to erase — cleardevice instead).
 */

const HEADER = `#include <graphics.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>

static void win(const char* title) {
#ifdef _WIN32
    initwindow(640, 480, title);
#else
    (void)title;
    initwindow(640, 480);
#endif
}
`;

const FIXTURES = {
  'rfx01_io_chart.cpp': HEADER + `
#include <iostream>
using namespace std;

int main() {
    int n = 5;
    int v[8];
    cout << "=== graphics.h I/O chart ===" << endl;
    cout << "how many bars (1-8)? " << flush;
    if (!(cin >> n) || n < 1 || n > 8) {
        cout << "[no or invalid input - demo mode, 5 bars]" << endl;
        n = 5;
        for (int i = 0; i < n; i++) v[i] = 20 + 15 * i;
    } else {
        for (int i = 0; i < n; i++) {
            cout << "value " << (i + 1) << " (1-200)? " << flush;
            if (!(cin >> v[i]) || v[i] < 1 || v[i] > 200) {
                v[i] = 20 + 15 * i;
                cout << "[demo: " << v[i] << "]" << endl;
            }
        }
    }
    cout << "BARS:";
    for (int i = 0; i < n; i++) cout << ' ' << v[i];
    cout << endl;
    win("I/O chart");
    setcolor(WHITE);
    rectangle(40, 60, 600, 440);
    outtextxy(210, 30, "Terminal Input -> Bar Chart");
    int maxv = 1;
    for (int i = 0; i < n; i++) if (v[i] > maxv) maxv = v[i];
    int bw = 520 / n;
    for (int i = 0; i < n; i++) {
        int h = v[i] * 350 / maxv;
        setfillstyle(SOLID_FILL, 1 + (i % 14));
        bar(60 + i * bw, 430 - h, 60 + (i + 1) * bw - 8, 430);
        char lab[16];
        snprintf(lab, sizeof(lab), "%d", v[i]);
        outtextxy(66 + i * bw, 444, lab);
    }
    for (int t = 0; t < 60 && !kbhit(); t++) delay(100);
    closegraph();
    cout << "chart window closed cleanly" << endl;
    return 0;
}
`,

  'rfx02_gravity_bounce.cpp': HEADER + `
int main() {
    win("gravity");
    float x = 80, y = 60, vx = 4.2f, vy = 0;
    for (int frame = 0; frame < 380 && !kbhit(); frame++) {
        cleardevice();
        setcolor(LIGHTGRAY);
        rectangle(10, 10, 629, 469);
        setfillstyle(SOLID_FILL, COLOR(40, 40, 46));
        bar(11, 450, 628, 468);
        vy += 0.35f; x += vx; y += vy;
        if (x < 30)  { x = 30;  vx = -vx; }
        if (x > 609) { x = 609; vx = -vx; }
        if (y > 428) { y = 428; vy = -vy * 0.82f; }
        if (y < 30)  { y = 30;  vy = 0.5f; }
        setfillstyle(SOLID_FILL, COLOR(70, 60, 55));
        fillellipse((int)x, 444, 15, 4);
        setfillstyle(SOLID_FILL, RED);
        fillellipse((int)x, (int)y, 18, 18);
        setfillstyle(SOLID_FILL, WHITE);
        fillellipse((int)x - 6, (int)y - 6, 4, 4);
        delay(16);
    }
    closegraph();
    return 0;
}
`,

  'rfx03_conio_menu.cpp': HEADER + `
int main() {
    win("conio menu");
    int mode = 1;
    char msg[80];
    for (int frame = 0; frame < 420 && !kbhit(); frame++) {
        if (frame % 120 == 119) mode = mode % 3 + 1; /* autopilot */
        cleardevice();
        setcolor(CYAN);
        outtextxy(200, 16, "kbhit/getch menu - never blocks");
        if (mode == 1) {
            for (int i = 0; i < 6; i++) circle(320, 240, 30 + i * 28);
            snprintf(msg, sizeof(msg), "mode 1: rings (frame %d)", frame);
        } else if (mode == 2) {
            for (int i = 0; i < 8; i++) {
                setfillstyle(i % 12 + 1, 2 + i);
                bar3d(60 + i * 66, 420 - i * 38, 110 + i * 66, 420, 8, 1);
            }
            snprintf(msg, sizeof(msg), "mode 2: bars (frame %d)", frame);
        } else {
            for (int i = 0; i < 14; i++) {
                setcolor(1 + i % 14);
                line(40, 40 + i * 28, 599, 439 - i * 28);
            }
            snprintf(msg, sizeof(msg), "mode 3: weave (frame %d)", frame);
        }
        setcolor(YELLOW);
        outtextxy(210, 458, msg);
        delay(16);
    }
    /* drain pending keys without blocking; ESC quits early */
    while (kbhit()) { if (getch() == 27) break; }
    closegraph();
    return 0;
}
`,

  'rfx04_julia_morph.cpp': HEADER + `
int main() {
    win("julia morph");
    const int W = 200, H = 150;
    for (int f = 0; f < 2 && !kbhit(); f++) {
        double cr = -0.72 + 0.12 * f, ci = 0.24 - 0.06 * f;
        for (int py = 0; py < H; py++) {
            for (int px = 0; px < W; px++) {
                double zx = (px - W / 2.0) * 0.016;
                double zy = (py - H / 2.0) * 0.016;
                int it = 0;
                while (zx * zx + zy * zy < 4.0 && it < 24) {
                    double t = zx * zx - zy * zy + cr;
                    zy = 2.0 * zx * zy + ci;
                    zx = t;
                    it++;
                }
                int x0 = 120 + px * 2, y0 = 90 + py * 2;
                if (it >= 24) setfillstyle(SOLID_FILL, WHITE);
                else setfillstyle(SOLID_FILL, COLOR(it * 10, 60 - it * 2, 150 - it * 6));
                bar(x0, y0, x0 + 1, y0 + 1);
            }
            /* periodic present so the frame builds up progressively */
            if (py % 25 == 24) delay(10);
        }
        setcolor(YELLOW);
        outtextxy(180, 460, f == 0 ? "Julia frame 1/2" : "Julia frame 2/2");
        delay(500);
    }
    /* keep the finished frame on screen long enough to be seen */
    for (int t = 0; t < 50 && !kbhit(); t++) delay(100);
    closegraph();
    return 0;
}
`,

  'rfx05_image_ops.cpp': HEADER + `
int main() {
    win("image ops");
    /* build the sprite in a scratch corner, then capture it */
    setfillstyle(SOLID_FILL, CYAN);
    bar(0, 0, 39, 39);
    setfillstyle(SOLID_FILL, RED);
    bar(8, 8, 31, 31);
    setfillstyle(SOLID_FILL, YELLOW);
    bar(14, 14, 25, 25);
    int sz = imagesize(0, 0, 39, 39);
    void* sprite = sz > 0 ? malloc((size_t)sz) : 0;
    if (sprite) getimage(0, 0, 39, 39, sprite);
    cleardevice();
    /* starfield backdrop, redrawn every frame (SDL_bgi-safe erase) */
    int sx[60], sy[60];
    for (int i = 0; i < 60; i++) { sx[i] = (i * 97 + 13) % 620 + 10; sy[i] = (i * 53 + 29) % 420 + 20; }
    float px = 40, py = 200;
    for (int frame = 0; frame < 240 && !kbhit(); frame++) {
        cleardevice();
        setcolor(WHITE);
        for (int i = 0; i < 60; i++) putpixel(sx[i], sy[i], WHITE);
        setcolor(GREEN);
        rectangle(5, 5, 634, 474);
        if (sprite) putimage((int)px, (int)py, sprite, COPY_PUT);
        px += 2.2f; py = 200 + 60 * sin(frame * 0.05f);
        if (px > 590) px = 40;
        delay(16);
    }
    /* one-shot exercise of every putimages verb over a live scene */
    cleardevice();
    setfillstyle(SOLID_FILL, DARKGRAY);
    bar(150, 150, 470, 330);
    setcolor(WHITE);
    outtextxy(180, 120, "COPY / XOR / OR / AND / NOT");
    if (sprite) {
        putimage(170, 170, sprite, COPY_PUT);
        putimage(230, 170, sprite, XOR_PUT);
        putimage(290, 170, sprite, OR_PUT);
        putimage(350, 170, sprite, AND_PUT);
        putimage(410, 170, sprite, NOT_PUT);
    }
    delay(1200);
    free(sprite);
    closegraph();
    return 0;
}
`,

  'rfx06_viewport_clip.cpp': HEADER + `
int main() {
    win("viewports");
    for (int frame = 0; frame < 200 && !kbhit(); frame++) {
        cleardevice();
        /* left pane: shapes drawn past the edge must clip */
        setviewport(20, 40, 300, 440, 1);
        clearviewport();
        setcolor(YELLOW);
        for (int i = 0; i < 8; i++) circle(150 + i * 22, 240, 90);
        setcolor(RED);
        bar(140 - frame % 100, 230, 160, 250);
        /* right pane */
        setviewport(320, 40, 620, 440, 1);
        clearviewport();
        setcolor(GREEN);
        for (int i = 0; i < 6; i++) rectangle(150 - i * 30, 240 - i * 30, 150 + i * 30, 240 + i * 30);
        /* full-screen restore: labels must survive clearviewport calls */
        setviewport(0, 0, 639, 479, 1);
        setcolor(WHITE);
        outtextxy(110, 16, "clipped pane");
        outtextxy(400, 16, "nested squares");
        setcolor(CYAN);
        outtextxy(230, 458, "setviewport clip=1 - shapes never leak");
        delay(20);
    }
    closegraph();
    return 0;
}
`,

  'rfx07_text_matrix.cpp': HEADER + `
int main() {
    win("text matrix");
    cleardevice();
    /* SDL_bgi text metrics take char* (non-const) — copy into buffers */
    char long1[64];
    strcpy(long1, "The quick brown fox jumps over the lazy dog 0123456789");
    char xbuf[2] = "X";
    int y = 14;
    struct { int font; const char* name; } row[5] = {
        { DEFAULT_FONT, "DEFAULT" }, { TRIPLEX_FONT, "TRIPLEX" },
        { SMALL_FONT, "SMALL" }, { SANS_SERIF_FONT, "SANS" }, { GOTHIC_FONT, "GOTHIC" }
    };
    for (int i = 0; i < 5; i++) {
        for (int size = 1; size <= 2; size++) {
            settextstyle(row[i].font, HORIZ_DIR, size);
            setcolor(1 + (i * 2 + size) % 14);
            char buf[80];
            snprintf(buf, sizeof(buf), "%s %d", row[i].name, size);
            outtextxy(12, y, buf);
            y += textheight(xbuf) + 8;
        }
    }
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    setcolor(WHITE);
    outtextxy(12, y + 6, long1);
    int w = textwidth(long1);
    setcolor(RED);
    line(12, y + 22, 12 + w, y + 22);
    char meta[80];
    snprintf(meta, sizeof(meta), "width=%d px", w);
    outtextxy(12, y + 30, meta);
    for (int t = 0; t < 60 && !kbhit(); t++) delay(100);
    closegraph();
    return 0;
}
`,

  'rfx08_fill_stress.cpp': HEADER + `
int main() {
    win("fill stress");
    cleardevice();
    int patterns[12] = { EMPTY_FILL, SOLID_FILL, LINE_FILL, LTSLASH_FILL, SLASH_FILL,
                         BKSLASH_FILL, LTBKSLASH_FILL, HATCH_FILL, XHATCH_FILL,
                         INTERLEAVE_FILL, WIDE_DOT_FILL, CLOSE_DOT_FILL };
    for (int i = 0; i < 12; i++) {
        int x = 20 + (i % 4) * 155, y = 30 + (i / 4) * 145;
        setfillstyle(patterns[i], 1 + i % 14);
        if (i % 3 == 0)      bar(x, y, x + 130, y + 110);
        else if (i % 3 == 1) { setcolor(WHITE); pieslice(x + 65, y + 55, 0, 300, 52); }
        else                 { setcolor(WHITE); rectangle(x, y, x + 130, y + 110); floodfill(x + 65, y + 55, WHITE); }
    }
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, BLUE);
    bar3d(30, 400, 150, 460, 14, 1);
    sector(300, 430, 20, 250, 70, 45);
    ellipse(480, 430, 0, 360, 90, 42);
    floodfill(485, 435, WHITE);
    for (int t = 0; t < 60 && !kbhit(); t++) delay(100);
    closegraph();
    return 0;
}
`,

  'rfx09_stress_prims.cpp': HEADER + `
#include <ctime>

int main() {
    win("stress");
    clock_t start = clock();
    for (int i = 0; i < 15000; i++) {
        putpixel((i * 733) % 640, (i * 379) % 480, 1 + i % 14);
        if (i % 3000 == 0) delay(1);
    }
    for (int i = 0; i < 3000; i++) {
        setcolor(1 + i % 14);
        line((i * 173) % 640, (i * 97) % 480, (i * 331) % 640, (i * 211) % 480);
        if (i % 750 == 0) delay(1);
    }
    for (int i = 0; i < 800; i++) {
        setcolor(1 + i % 14);
        circle((i * 149) % 640, (i * 83) % 480, 4 + i % 40);
        if (i % 200 == 0) delay(1);
    }
    double secs = (double)(clock() - start) / CLOCKS_PER_SEC;
    char msg[80];
    snprintf(msg, sizeof(msg), "18800 primitives in %.1fs", secs);
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, BLACK);
    bar(180, 452, 470, 470);
    outtextxy(190, 456, msg);
    for (int t = 0; t < 40 && !kbhit(); t++) delay(100);
    closegraph();
    printf("stress ok: %s\\n", msg);
    return 0;
}
`,

  'rfx10_key_echo.cpp': HEADER + `
int main() {
    win("key echo");
    char typed[64] = "";
    int n = 0, quit = 0;
    for (int frame = 0; frame < 480 && !quit && !kbhit(); frame++) {
        /* non-blocking input contract: getch only after kbhit says go */
        while (kbhit() && n < 60) {
            int c = getch();
            if (c == 'q' || c == 27) { quit = 1; break; }
            if (c >= 32 && c < 127) typed[n++] = (char)c, typed[n] = 0;
        }
        cleardevice();
        setcolor(WHITE);
        rectangle(10, 10, 629, 469);
        setcolor(CYAN);
        outtextxy(150, 24, "type keys - q or ESC quits - 8s idle demo");
        setcolor(YELLOW);
        outtextxy(40, 120, typed);
        setcolor(GREEN);
        char st[80];
        snprintf(st, sizeof(st), "chars=%d frame=%d", n, frame);
        outtextxy(40, 150, st);
        /* heartbeat so idle demo still renders */
        setfillstyle(SOLID_FILL, 1 + frame % 14);
        bar(270 + (frame % 60) * 1, 300, 310 + (frame % 60) * 1, 340);
        delay(16);
    }
    closegraph();
    printf("key echo done: %s\\n", typed);
    return 0;
}
`,

  'rfx11_crash.cpp': HEADER + `
int main() {
    win("crash probe");
    setcolor(WHITE);
    outtextxy(40, 40, "crash probe: dereferencing null in 300ms");
    delay(300);
    volatile int* p = (volatile int*)0;
    *p = 1; /* SIGSEGV — must surface as a non-zero exit, never a hang */
    closegraph();
    return 0;
}
`,

  'rfx12_broken.cpp': `#include <graphics.h>
#include <cstdio>

int main() {
    win("broken")
    undeclared_function(1, 2);
    outtextxy(10, 10, "never compiles");
    return also_missing + 1;
}
`
};

module.exports = { FIXTURES };
