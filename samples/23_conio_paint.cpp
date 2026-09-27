/* 23_conio_paint.cpp — a conio.h drawing pad: kbhit() + getch() (the Turbo
 * C++ console functions) drive the cursor. Keys 1..8 pick the color,
 * SPACE toggles drawing, C clears the pad, ESC quits. Without any input
 * the pad draws a demo squiggle (headless-friendly); auto-exits after
 * 12 seconds.
 *
 * getch()/kbhit() come from <conio.h> on Windows (MinGW); on Linux/macOS
 * the graphics.h implementation (SDL_bgi) declares the same two functions.
 */
#include <graphics.h>
#include <cstdio>
#include <cmath>
#include <ctime>
#ifdef _WIN32
#include <conio.h>   /* MinGW: getch, kbhit */
#endif

static const int palette[8] = { WHITE, YELLOW, LIGHTRED, LIGHTGREEN,
                                LIGHTCYAN, LIGHTMAGENTA, LIGHTBLUE, BROWN };

int main ( )
{
#ifdef _WIN32
    initwindow(640, 480, "Conio Paint - kbhit/getch drawing pad");   /* WinBGIM: window title   */
#else
    initwindow(640, 480);              /* SDL_bgi: 2-arg form     */
#endif
    int mx = getmaxx(), my = getmaxy();
    const int padTop = 34, padBottom = my - 26;

    int x = mx / 2, y = (padTop + padBottom) / 2;
    int colorIdx = 1, drawing = 1, quit = 0;
    double t = 0.0;

    /* static frame: menu swatches + pad border */
    setfillstyle(SOLID_FILL, DARKGRAY);
    bar(0, 0, mx, padTop - 6);
    for (int i = 0; i < 8; i++) {
        setfillstyle(SOLID_FILL, palette[i]);
        bar(14 + i * 30, 6, 14 + i * 30 + 20, 22);
    }
    setcolor(LIGHTGRAY);
    rectangle(6, padTop - 2, mx - 6, padBottom + 2);

    time_t start = time(NULL);
    while (!quit && time(NULL) - start < 12) {
        int px = x, py = y;

        /* highlight the selected swatch (redrawn each frame, cheap) */
        setfillstyle(SOLID_FILL, DARKGRAY);
        bar(0, 0, mx, padTop - 6);
        for (int i = 0; i < 8; i++) {
            setfillstyle(SOLID_FILL, palette[i]);
            bar(14 + i * 30, 6, 14 + i * 30 + 20, 22);
            if (i == colorIdx) {
                setcolor(WHITE);
                rectangle(14 + i * 30 - 2, 4, 14 + i * 30 + 22, 24);
            }
        }
        setcolor(WHITE);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(mx - 320, 12, (char*)"1-8 color SPACE draw C clear ESC quit");

        /* conio keyboard drain */
        int anyKey = 0;
        while (kbhit()) {
            int k = getch();
            anyKey = 1;
            if (k == 27) { quit = 1; break; }
            if (k == ' ') { drawing = !drawing; }
            if (k == 'c' || k == 'C') {
                cleardevice();
                setcolor(LIGHTGRAY);
                rectangle(6, padTop - 2, mx - 6, padBottom + 2);
            }
            if (k >= '1' && k <= '8') { colorIdx = k - '1'; }
            if (k == 'a' || k == 'A') { x -= 8; }
            if (k == 'd' || k == 'D') { x += 8; }
            if (k == 'w' || k == 'W') { y -= 8; }
            if (k == 's' || k == 'S') { y += 8; }
        }
        if (quit) { break; }

        if (x < 12) x = 12;
        if (x > mx - 12) x = mx - 12;
        if (y < padTop + 8) y = padTop + 8;
        if (y > padBottom - 8) y = padBottom - 8;

        if (!anyKey) {
            /* demo mode: Lissajous squiggle paints the pad by itself */
            t += 1.0;
            x = (int)((mx / 2 - 60) + (mx / 2 - 120) * sin(t * 0.09));
            y = (int)(((padTop + padBottom) / 2)
                    + ((padBottom - padTop) / 2 - 24) * sin(t * 0.23 + 1.2));
            if ((int)t % 45 == 0) { colorIdx = (colorIdx + 1) % 8; }
        }

        if (drawing && (px != x || py != y)) {
            setcolor(palette[colorIdx]);
            line(px, py, x, y);
        }
        setcolor(palette[colorIdx]);
        setfillstyle(SOLID_FILL, palette[colorIdx]);
        fillellipse(x, y, 3, 3);

        char st[96];
        sprintf(st, "conio.h: kbhit()+getch()   x=%d y=%d   %s",
                x, y, drawing ? "drawing" : "moving");
        setcolor(DARKGRAY);
        bar(0, padBottom + 4, mx, my);
        setcolor(LIGHTGRAY);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(10, padBottom + 8, st);

        delay(35);
    }
    closegraph();
    return 0;
}
