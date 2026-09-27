/* 28_bresenham_circle_lab.cpp — Midpoint/Bresenham Circle Lab on a
 * coordinate grid: type the RADIUS in the TERMINAL and watch the
 * algorithm walk one octant with its decision variable d, mirroring
 * every point 8 ways (the circle symmetry trick).
 *   - dark gray circle = circle() reference
 *   - light cyan dots  = the 8-way mirrored algorithm points
 *   - step table (x, y, d) in the terminal
 * EOF-safe demo radius; any key or ~12 s closes the window.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>

using namespace std;

static void drawGrid(int cx, int cy)
{
    int W = getmaxx(), H = getmaxy();
    for (int x = cx % 25; x < W; x += 25)
        for (int y = cy % 25; y < H; y += 25)
            putpixel(x, y, DARKGRAY);
    setcolor(LIGHTGRAY);
    line(0, cy, W, cy);
    line(cx, 0, cx, H);
}

static void plot8(int cx, int cy, int x, int y, int color)
{
    putpixel(cx + x, cy + y, color);
    putpixel(cx - x, cy + y, color);
    putpixel(cx + x, cy - y, color);
    putpixel(cx - x, cy - y, color);
    putpixel(cx + y, cy + x, color);
    putpixel(cx - y, cy + x, color);
    putpixel(cx + y, cy - x, color);
    putpixel(cx - y, cy - x, color);
}

int main()
{
    int r;

    cout << "=== Bresenham / Midpoint Circle Lab ===" << endl;
    cout << "Enter radius (e.g. 150): ";
    if (!(cin >> r) || r < 10) {
        r = 150;
        cout << "(no/invalid input - drawing demo radius " << r << ")" << endl;
    }
    if (r > 260) r = 260;

#ifdef _WIN32
    initwindow(800, 600, "Bresenham Circle Lab");
#else
    initwindow(800, 600);
#endif
    int cx = getmaxx() / 2, cy = getmaxy() / 2;
    drawGrid(cx, cy);

    setcolor(DARKGRAY);
    circle(cx, cy, r);                     /* library reference */

    setcolor(GREEN);
    line(cx, cy, cx + r, cy);              /* radius line */
    putpixel(cx, cy, RED);
    putpixel(cx + 1, cy, RED);
    putpixel(cx, cy + 1, RED);

    cout << "octant walk (x, y, decision d):" << endl;
    setcolor(LIGHTCYAN);
    int x = 0, y = r, d = 3 - 2 * r, step = 0, printed = 0;
    while (x <= y) {
        plot8(cx, cy, x, y, LIGHTCYAN);
        if (printed < 100) {
            cout << "  step " << step << ": (x=" << x << ", y=" << y << ") d=" << d << endl;
            printed++;
        } else if (printed == 100) {
            cout << "  ... (more steps, see the window)" << endl;
            printed++;
        }
        if (d < 0) d += 4 * x + 6;
        else { d += 4 * (x - y) + 10; y--; }
        x++;
        step++;
        if (step % 12 == 0) delay(10);
    }

    char b[64];
    setcolor(WHITE);
    sprintf(b, "(cx+%d, cy) = east point", r);
    outtextxy(cx + r - 60, cy + 8, b);
    sprintf(b, "(cx, cy+%d) = north point", r);
    outtextxy(cx + 6, cy - r + 6, b);
    outtextxy(10, 8, (char*)"Bresenham Circle Lab - dark = circle() reference, cyan = algorithm points");
    outtextxy(cx - 190, getmaxy() - 26, (char*)"Press any key in this window to close");
    cout << "Done - " << step << " octant steps, 8-way mirrored." << endl;

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) break;
        delay(10);
    }
    closegraph();
    return 0;
}
