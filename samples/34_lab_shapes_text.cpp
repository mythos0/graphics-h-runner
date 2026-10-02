/* 34_lab_shapes_text.cpp — the whole shape kit in one labeled scene:
 * line, rectangle, circle, ellipse, arc, pieslice, sector, bar, bar3d,
 * drawpoly + floodfill, then every BGI text font. Every figure carries
 * the exact call that drew it, so this file doubles as a poster you can
 * keep beside you while learning. ESC (or Q) closes it.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>

using namespace std;

static void label(int x, int y, const char* text)
{
    setcolor(WHITE);
    outtextxy(x, y, (char*)text);
}

int main()
{
    cout << "=== Lab 3 - Shapes & Text ===" << endl;
    cout << "One scene, every primitive, each labeled with its call." << endl;

#ifdef _WIN32
    initwindow(860, 640, "Lab 3 - Shapes & Text");
#else
    initwindow(860, 640);
#endif

    /* --- row 1: the line family --- */
    setcolor(YELLOW);
    line(30, 70, 180, 70);                       label(60, 78,  "line()");
    arc(260, 70, 0, 180, 50);                    label(232, 90, "arc()");
    ellipse(430, 70, 0, 360, 70, 30);            label(392, 110, "ellipse()");
    setcolor(CYAN);
    rectangle(560, 40, 700, 100);                label(600, 108, "rectangle()");

    /* --- row 2: the filled family --- */
    setfillstyle(SOLID_FILL, GREEN);
    bar(30, 150, 180, 210);                      label(80, 218, "bar()");
    setfillstyle(SOLID_FILL, MAGENTA);
    bar3d(230, 150, 330, 210, 25, 1);            label(248, 240, "bar3d()");
    setfillstyle(SOLID_FILL, RED);
    pieslice(450, 180, 0, 120, 55);              label(415, 245, "pieslice()");
    setfillstyle(SOLID_FILL, BROWN);
    sector(650, 180, 180, 300, 60, 35);          label(615, 225, "sector()");

    /* --- row 3: polygon + floodfill --- */
    int poly[10] = { 60, 300, 130, 280, 200, 300, 170, 370, 90, 370 };
    setcolor(LIGHTCYAN);
    drawpoly(5, poly);                           /* 5 points = closed shape */
    label(80, 380, "drawpoly()");
    setfillstyle(SOLID_FILL, LIGHTGREEN);
    floodfill(130, 320, LIGHTCYAN);              /* spill from inside,   */
                                                 /* stops at the border  */
    setcolor(LIGHTRED);
    circle(400, 330, 55);
    setfillstyle(SOLID_FILL, YELLOW);
    floodfill(400, 330, LIGHTRED);
    label(370, 395, "circle + floodfill");

    cout << "Row 1: line, arc, ellipse, rectangle (outlines)." << endl;
    cout << "Row 2: bar, bar3d, pieslice, sector (filled, angle-based ones" << endl;
    cout << "       count degrees COUNTERCLOCKWISE from 3 o'clock)." << endl;
    cout << "Row 3: drawpoly + floodfill(point inside, border color)." << endl;
    delay(2500);

    /* --- the five BGI fonts --- */
    cleardevice();
    outtextxy(10, 10, (char*)"settextstyle(font, HORIZ_DIR, size):");
    const char* fonts[] = { "DEFAULT_FONT  8x8 bitmap", "TRIPLEX_FONT  stroke, elegant",
                            "SMALL_FONT    stroke, tiny",   "SANS_SERIF_FONT  stroke, clean",
                            "GOTHIC_FONT  stroke, gothic" };
    for (int f = 0; f < 5; f++) {
        settextstyle(f, HORIZ_DIR, f == 0 ? 2 : 3);
        setcolor(f + 1);
        outtextxy(40, 60 + f * 80, (char*)fonts[f]);
    }
    settextstyle(TRIPLEX_FONT, HORIZ_DIR, 4);
    setusercharsize(2, 1, 2, 1);                 /* scale stroke fonts 4x */
    setcolor(WHITE);
    outtextxy(430, 320, (char*)"setusercharsize!");

    cout << "Page 2: all 5 fonts; setusercharsize() scales stroke fonts" << endl;
    cout << "        beyond their built-in sizes (bitmaps cannot)." << endl;

    /* v1.5.3 convention: the window stays open until YOU quit (ESC or Q). */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);
    for (;;) {
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
        delay(10);
    }
    closegraph();
    return 0;
}
