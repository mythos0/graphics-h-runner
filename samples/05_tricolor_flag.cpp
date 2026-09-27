/* 05_tricolor_flag.cpp — the classic "draw a flag" college exercise.
 * Three stripes, a pole, a decorative sun and a caption.
 * Stays open until you press a key.
 */
#include <graphics.h>
#include <cstdlib>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(600, 420);
    setbkcolor(WHITE);
    cleardevice();

    int px = 70, py = 40;              /* flag top-left on the pole */

    /* pole */
    setcolor(BROWN);
    setfillstyle(SOLID_FILL, BROWN);
    bar(px - 8, py, px, 380);

    /* stripes */
    setfillstyle(SOLID_FILL, LIGHTRED);
    bar(px, py, px + 360, py + 60);

    setfillstyle(SOLID_FILL, WHITE);
    bar(px, py + 60, px + 360, py + 120);
    setcolor(LIGHTGRAY);
    rectangle(px, py + 60, px + 360, py + 120);

    setfillstyle(SOLID_FILL, GREEN);
    bar(px, py + 120, px + 360, py + 180);

    /* emblem: sun with rays on the middle stripe */
    int cx = px + 180, cy = py + 90;
    setcolor(RED);
    setfillstyle(SOLID_FILL, YELLOW);
    fillellipse(cx, cy, 30, 30);
    for (int a = 0; a < 12; a++) {
        double ang = a * 3.14159 / 6;
        int x2 = cx + (int)(36 * cos(ang));
        int y2 = cy - (int)(36 * sin(ang));
        int x3 = cx + (int)(50 * cos(ang));
        int y3 = cy - (int)(50 * sin(ang));
        line(x2, y2, x3, y3);
    }

    /* caption */
    setcolor(BLUE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(210, 330, (char*)"BGI FLAG");

    /* v1.5.3: runs until YOU quit (ESC or Q). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    while (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000) {
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
        delay(40);
    }

    closegraph();
    return 0;
}
