/* 38_lab_scanline_fill.cpp — scanline polygon fill implemented BY HAND
 * (no floodfill, no bar): the algorithm real rasterizers use.
 *
 *   for every scanline y inside the polygon:
 *     1. intersect every edge with the horizontal line at y
 *     2. sort the intersection x values
 *     3. fill between pairs:  [x0..x1]  [x2..x3] ...
 *
 * The fill animates row by row so you can watch parity alternation do
 * the work, even for a self-overlapping polygon (the classic concave
 * star). ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>
#include <ctime>      /* time() — older MinGW flavors do not leak it */

using namespace std;

static const int N = 10;                         /* 5-point star = 10 coords */
static int PX[N] = { 400, 470, 700, 500, 560, 400, 240, 300, 100, 330 };
static int PY[N] = { 120, 320, 340, 470, 200, 90, 200, 470, 340, 320 };

int main()
{
    cout << "=== Lab 7 - Scanline Polygon Fill ===" << endl;
    cout << "For each row y: intersect all edges, sort the x's," << endl;
    cout << "fill between pairs. Watch parity handle the concave star." << endl;

#ifdef _WIN32
    initwindow(800, 600, "Lab 7 - Scanline Fill");
#else
    initwindow(800, 600);
#endif

    int ymin = PY[0], ymax = PY[0];
    for (int i = 1; i < N; i++) {
        if (PY[i] < ymin) ymin = PY[i];
        if (PY[i] > ymax) ymax = PY[i];
    }

    /* the outline stays visible under the fill */
    setcolor(WHITE);
    drawpoly(N / 2, PX);
    outtextxy(10, 8, (char*)"Scanline fill, one row per frame - white = outline, cyan = parity fills");

    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);

    for (int y = ymin; y <= ymax; y++) {
        float xs[N]; int hits = 0;
        for (int i = 0; i < N; i++) {            /* every edge (Pi -> Pi+1) */
            int j = (i + 1) % N;
            int y1 = PY[i], y2 = PY[j];
            if (y1 == y2) continue;              /* horizontal edge: skip   */
            if ((y >= (y1 < y2 ? y1 : y2)) && (y < (y1 < y2 ? y2 : y1))) {
                /* half-open rule: [min, max) - vertices counted once */
                float t = (float)(y - y1) / (float)(y2 - y1);
                xs[hits++] = PX[i] + t * (PX[j] - PX[i]);
            }
        }
        /* insertion sort - tiny arrays, simple is best */
        for (int a = 1; a < hits; a++) {
            float v = xs[a]; int b = a - 1;
            while (b >= 0 && xs[b] > v) { xs[b + 1] = xs[b]; b--; }
            xs[b + 1] = v;
        }
        for (int a = 0; a + 1 < hits; a += 2)    /* pairs -> fill spans */
            line((int)xs[a], y, (int)xs[a + 1], y);
        setcolor(CYAN);
        delay(22);
        setcolor(WHITE);                          /* restore outline color */
        if (kbhit()) { int k = getch(); if (k == 27 || k == 'q' || k == 'Q') { closegraph(); return 0; } }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
    }

    setcolor(YELLOW);
    outtextxy(10, 585, (char*)"Done - filled row by row. Press ESC (or Q) to close.");
    cout << "Filled " << ymax - ymin + 1 << " scanlines." << endl;
    cout << "The half-open [min,max) rule is why vertices do not" << endl;
    cout << "double-count where two edges meet." << endl;

    for (;;) {
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
        delay(10);
    }
    closegraph();
    return 0;
}
