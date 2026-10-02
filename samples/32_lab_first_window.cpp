/* 32_lab_first_window.cpp — START HERE: your very first graphics.h
 * program, narrated line by line. The window opens, then one family of
 * calls at a time appears with a caption:
 *
 *   1. a single pixel            — putpixel() is the atom of graphics
 *   2. lines                     — line() between two points
 *   3. rectangles + filled bars  — rectangle(), bar(), setfillstyle()
 *   4. circles                   — circle() centre + radius
 *   5. text                      — outtextxy() writes anywhere
 *
 * The terminal prints one paragraph per step. ESC (or Q) closes it.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>

using namespace std;

static void caption(int y, const char* text)
{
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, y, getmaxx(), y + 16);
    outtextxy(8, y + 4, (char*)text);
}

int main()
{
    cout << "=== Lab 1 - First Window ===" << endl;
    cout << "Every graphics.h program follows the same skeleton:" << endl;
    cout << "  initwindow()  opens a window" << endl;
    cout << "  ...drawing calls..." << endl;
    cout << "  getch()/delay()  let the picture stay on screen" << endl;
    cout << "  closegraph()  closes it" << endl;

#ifdef _WIN32
    initwindow(800, 600, "Lab 1 - First Window");   /* WinBGIm takes a title */
#else
    initwindow(800, 600);
#endif

    /* STEP 1 - one pixel. Everything on screen is made of these. */
    putpixel(400, 300, WHITE);
    caption(560, "STEP 1: putpixel(400, 300, WHITE) - one white dot");
    cout << endl << "STEP 1: putpixel(x, y, color) lights ONE pixel." << endl;
    delay(900);

    /* STEP 2 - lines. */
    setcolor(YELLOW);
    line(100, 150, 700, 150);
    caption(560, "STEP 2: line(x1, y1, x2, y2) - straight segments");
    cout << "STEP 2: line() joins two points. Y grows DOWNWARD here" << endl;
    cout << "        (0,0) is the TOP-LEFT corner, not the bottom-left." << endl;
    delay(900);

    /* STEP 3 - rectangles and a filled bar. */
    setcolor(GREEN);
    rectangle(120, 200, 320, 320);                 /* outline only   */
    setfillstyle(SOLID_FILL, BLUE);
    bar(480, 200, 680, 320);                       /* filled, no border */
    caption(560, "STEP 3: rectangle() = outline, bar() = filled box");
    cout << "STEP 3: rectangle() draws an outline; bar() draws a" << endl;
    cout << "        filled box using the current fill style." << endl;
    delay(900);

    /* STEP 4 - circles. */
    setcolor(RED);
    circle(400, 260, 60);                          /* centre + radius */
    setcolor(CYAN);
    circle(400, 260, 40);
    caption(560, "STEP 4: circle(x, y, radius) - two rings, one centre");
    cout << "STEP 4: circle() needs only a centre and a radius." << endl;
    delay(900);

    /* STEP 5 - text anywhere. */
    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(260, 60, (char*)"Hello, graphics.h!");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(250, 95, (char*)"That whole word is just colored pixels");
    caption(560, "STEP 5: outtextxy() + settextstyle() - text anywhere");
    cout << "STEP 5: outtextxy() writes text at any pixel." << endl;
    cout << "        settextstyle(font, direction, size) picks the look." << endl;
    cout << endl << "That is the whole skeleton - now change numbers and" << endl;
    cout << "re-run this file. ESC or Q in the window quits." << endl;

    /* v1.5.3 convention: the window stays open until YOU quit (ESC or Q).
     * The automated test battery sets BGI_AUTOEXIT_MS so runs still
     * finish by themselves there; real users never set it. */
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
