/* 33_lab_colors_pixels.cpp — colors & pixels: the 16 standard BGI
 * colors with their names, every fill pattern, and a hand-plotted RGB
 * gradient made of putpixel() calls. After this lab "color" stops being
 * a mystery: it is just a number passed to setcolor()/setfillstyle().
 * ESC (or Q) closes it.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <ctime>      /* time() — older MinGW flavors do not leak it */

using namespace std;

static const char* COLOR_NAMES[16] = {
    "BLACK", "BLUE", "GREEN", "CYAN", "RED", "MAGENTA", "BROWN", "LIGHTGRAY",
    "DARKGRAY", "LIGHTBLUE", "LIGHTGREEN", "LIGHTCYAN", "LIGHTRED",
    "LIGHTMAGENTA", "YELLOW", "WHITE"
};

int main()
{
    cout << "=== Lab 2 - Colors & Pixels ===" << endl;
    cout << "graphics.h starts you with 16 named colors (0..15)." << endl;
    cout << "setcolor(c) chooses the pen, setfillstyle(pattern, c)" << endl;
    cout << "chooses what filled shapes are painted with." << endl;

#ifdef _WIN32
    initwindow(820, 620, "Lab 2 - Colors & Pixels");
#else
    initwindow(820, 620);
#endif

    /* PART 1 - the 16 standard colors, named. */
    setbkcolor(BLACK);
    cleardevice();
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(10, 8, (char*)"PART 1: the 16 standard colors - setcolor(c), c = 0..15");
    for (int c = 0; c < 16; c++) {
        int col = 4 + (c % 4) * 100;               /* 4 columns  */
        int row = 40 + (c / 4) * 55;               /* 4 rows     */
        setfillstyle(SOLID_FILL, c);
        bar(col, row, col + 80, row + 36);
        setcolor(WHITE);
        outtextxy(col, row + 40, (char*)COLOR_NAMES[c]);
    }
    cout << endl << "PART 1: swatches 0..15 drawn - DARKGRAY(8) is dimmer" << endl;
    cout << "        than LIGHTGRAY(7); YELLOW(14) pops on black." << endl;
    delay(2600);

    /* PART 2 - fill patterns. */
    cleardevice();
    outtextxy(10, 8, (char*)"PART 2: setfillstyle() patterns (0..12) - all painted RED");
    for (int p = 0; p <= 12; p++) {
        int col = 10 + (p % 7) * 115;
        int row = 40 + (p / 7) * 80;
        setfillstyle(p, RED);
        bar(col, row, col + 100, row + 55);
    }
    cout << "PART 2: EMPTY_FILL, SOLID_FILL, LINE_FILL, LTSLASH_FILL," << endl;
    cout << "        SLASH_FILL, BKSLASH_FILL, LTBKSLASH_FILL, HATCH_FILL," << endl;
    cout << "        XHATCH_FILL, INTERLEAVE_FILL, WIDE_DOT_FILL," << endl;
    cout << "        CLOSE_DOT_FILL, USER_FILL - 13 patterns total." << endl;
    delay(2600);

    /* PART 3 - an RGB gradient plotted pixel by pixel. COLOR(r,g,b)
     * mixes any of ~16 million colors (WinBGIm + SDL_bgi extension). */
    cleardevice();
    outtextxy(10, 8, (char*)"PART 3: putpixel + COLOR(r,g,b) - a gradient drawn dot by dot");
    for (int x = 0; x < 800; x++) {
        int r = x * 255 / 800;
        for (int y = 40; y < 340; y++) {
            int g = (y - 40) * 255 / 300;
            putpixel(x, y, COLOR(r, g, 128));
        }
    }
    outtextxy(10, 350, (char*)"Top-left is COLOR(0,0,128), bottom-right COLOR(255,255,128)");
    cout << "PART 3: two nested loops + putpixel = a smooth gradient." << endl;
    cout << "        COLOR(red, green, blue), each 0..255." << endl;
    delay(2000);

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
