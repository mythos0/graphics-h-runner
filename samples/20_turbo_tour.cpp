/* 20_turbo_tour.cpp — the classic Turbo C++ BGI toolkit on one screen:
 * bar3d, pieslice, sector, arc + ellipse, dashed lines, floodfill, every
 * popular fill pattern and growing text sizes. Runs at most 12 seconds;
 * any key quits.
 */
#include <graphics.h>
#include <cstdio>
#include <ctime>

int main ( )
{
#ifdef _WIN32
    initwindow(640, 480, "Turbo C++ Graphics Tour");   /* WinBGIM: window title   */
#else
    initwindow(640, 480);              /* SDL_bgi: 2-arg form     */
#endif

    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    setcolor(YELLOW);
    outtextxy(150, 12, (char*)"Turbo C++ Graphics Tour");

    /* --- bar3d: three 3-D bars --- */
    setfillstyle(SOLID_FILL, LIGHTBLUE);
    bar3d(40, 220, 90, 380, 12, 1);
    setfillstyle(SOLID_FILL, LIGHTGREEN);
    bar3d(105, 260, 155, 380, 12, 1);
    setfillstyle(SOLID_FILL, LIGHTRED);
    bar3d(170, 300, 220, 380, 12, 1);
    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(48, 395, (char*)"bar3d");

    /* --- pieslice + sector --- */
    setfillstyle(SOLID_FILL, MAGENTA);
    pieslice(330, 300, 0, 120, 70);
    setfillstyle(SOLID_FILL, CYAN);
    sector(330, 300, 180, 300, 70, 50);
    setcolor(WHITE);
    outtextxy(295, 395, (char*)"pieslice / sector");

    /* --- arc + ellipse + line styles --- */
    setcolor(YELLOW);
    arc(520, 290, 0, 180, 60);
    setcolor(GREEN);
    ellipse(520, 300, 0, 360, 60, 25);
    setlinestyle(DASHED_LINE, 0, THICK_WIDTH);
    setcolor(LIGHTRED);
    rectangle(460, 240, 580, 340);
    setlinestyle(SOLID_LINE, 0, NORM_WIDTH);
    setcolor(WHITE);
    outtextxy(470, 395, (char*)"arc / ellipse / dashed");

    /* --- fill pattern sampler --- */
    const int patterns[6] = { EMPTY_FILL, HATCH_FILL, XHATCH_FILL,
                              SLASH_FILL, CLOSE_DOT_FILL, WIDE_DOT_FILL };
    for (int i = 0; i < 6; i++) {
        setfillstyle(patterns[i], WHITE);
        bar(40 + i * 92, 430, 40 + i * 92 + 70, 462);
        rectangle(40 + i * 92, 430, 40 + i * 92 + 70, 462);
    }

    /* --- floodfill --- */
    setcolor(LIGHTCYAN);
    circle(590, 60, 25);
    setfillstyle(SOLID_FILL, LIGHTCYAN);
    floodfill(590, 60, LIGHTCYAN);

    /* --- growing text --- */
    for (int s = 1; s <= 3; s++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, s);
        setcolor(s == 1 ? WHITE : s == 2 ? LIGHTGREEN : LIGHTMAGENTA);
        outtextxy(40, 60 + s * 26, (char*)"Knowledge is Power");
    }

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 12) {
        delay(50);
    }
    closegraph();
    return 0;
}
