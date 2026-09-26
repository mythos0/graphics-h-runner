/* 21_viewport_bounce.cpp — setviewport() clipping the Turbo C++ way:
 * two independent panes, each with its own ball, both clipped to their
 * viewport rectangle. Runs at most 12 seconds; any key quits.
 */
#include <graphics.h>
#include <cstdio>
#include <ctime>

struct Ball { int x, y, dx, dy, r, color; };

int main ( )
{
#ifdef _WIN32
    initwindow(640, 480, "Viewport && Clipping");   /* WinBGIM: window title   */
#else
    initwindow(640, 480);              /* SDL_bgi: 2-arg form     */
#endif
    int mx = getmaxx(), my = getmaxy();

    Ball a = { 160, 160,  4, 3, 18, LIGHTGREEN };
    Ball b = { 480, 360, -5, 4, 24, LIGHTRED  };

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();
        setcolor(DARKGRAY);
        line(mx / 2, 0, mx / 2, my);
        line(0, my / 2, mx, my / 2);
        /* pane 1: top-left quadrant */
        setviewport(1, 1, mx / 2 - 1, my / 2 - 1, 1);
        clearviewport();
        setcolor(a.color);
        setfillstyle(SOLID_FILL, a.color);
        fillellipse(a.x, a.y, a.r, a.r);
        a.x += a.dx;
        a.y += a.dy;
        if (a.x < a.r + 2 || a.x > mx / 2 - 1 - a.r) { a.dx = -a.dx; a.x += 2 * a.dx; }
        if (a.y < a.r + 22 || a.y > my / 2 - 1 - a.r) { a.dy = -a.dy; a.y += 2 * a.dy; }

        /* pane 2: bottom-right quadrant */
        setviewport(mx / 2 + 1, my / 2 + 1, mx - 1, my - 1, 1);
        clearviewport();
        setcolor(b.color);
        setfillstyle(SOLID_FILL, b.color);
        fillellipse(b.x - mx / 2 - 1, b.y - my / 2 - 1, b.r, b.r);
        b.x += b.dx;
        b.y += b.dy;
        if (b.x - mx / 2 - 1 < b.r || b.x - mx / 2 - 1 > mx / 2 - 2 - b.r) { b.dx = -b.dx; b.x += 2 * b.dx; }
        if (b.y - my / 2 - 1 < b.r || b.y - my / 2 - 1 > my / 2 - 2 - b.r) { b.dy = -b.dy; b.y += 2 * b.dy; }

        /* restore the full window, frame the panes, label them (labels live
         * in the FULL window so clearviewport() can never wipe them) */
        setviewport(0, 0, mx, my, 1);
        setcolor(WHITE);
        rectangle(0, 0, mx - 1, my - 1);
        setcolor(LIGHTGRAY);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(8, 8, (char*)"viewport 1 - clipped");
        outtextxy(mx / 2 + 8, my / 2 + 8, (char*)"viewport 2 - clipped");
        delay(40);
    }
    closegraph();
    return 0;
}
