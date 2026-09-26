/* 29_midpoint_ellipse_lab.cpp — Midpoint Ellipse Lab on a coordinate
 * grid: region 1 (dx < dy) then region 2, four-way symmetry, decision
 * variables printed for the first steps of each region. Type the two
 * RADII in the TERMINAL (rx ry); EOF-safe demo values; any key or
 * ~12 s closes the window.
 *   - dark gray ellipse = ellipse() reference
 *   - yellow dots       = the midpoint algorithm points
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>

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

static void plot4(int cx, int cy, double x, double y, int color)
{
    int px = (int)(x + 0.5), py = (int)(y + 0.5);
    putpixel(cx + px, cy + py, color);
    putpixel(cx - px, cy + py, color);
    putpixel(cx + px, cy - py, color);
    putpixel(cx - px, cy - py, color);
}

int main()
{
    double rx, ry;

    cout << "=== Midpoint Ellipse Lab (region 1 + region 2) ===" << endl;
    cout << "Enter rx ry (e.g. 220 130): ";
    if (!(cin >> rx >> ry) || rx < 20 || ry < 20) {
        rx = 220; ry = 130;
        cout << "(no/invalid input - drawing demo radii " << rx << " " << ry << ")" << endl;
    }
    if (rx > 320) rx = 320;
    if (ry > 220) ry = 220;

    double rx2 = rx * rx, ry2 = ry * ry;

#ifdef _WIN32
    initwindow(800, 600, "Midpoint Ellipse Lab");
#else
    initwindow(800, 600);
#endif
    int cx = getmaxx() / 2, cy = getmaxy() / 2;
    drawGrid(cx, cy);

    setcolor(DARKGRAY);
    ellipse(cx, cy, 0, 360, (int)rx, (int)ry);   /* library reference */

    cout << "region 1 (slope > -1):" << endl;
    setcolor(YELLOW);
    double x = 0, y = ry;
    double dx = 2 * ry2 * x, dy = 2 * rx2 * y;
    double p1 = ry2 - rx2 * ry + 0.25 * rx2;
    long step = 0;
    while (dx < dy) {
        plot4(cx, cy, x, y, YELLOW);
        if (step < 60)
            cout << "  r1 step " << step << ": (" << x << ", " << y << ") p1=" << p1 << endl;
        if (p1 < 0) {
            x++; dx += 2 * ry2; p1 += dx + ry2;
        } else {
            x++; y--; dx += 2 * ry2; dy -= 2 * rx2; p1 += dx - dy + ry2;
        }
        step++;
    }
    cout << "region 2 begins at step " << step << " (" << x << ", " << y << ")" << endl;
    cout << "region 2 (slope <= -1):" << endl;

    double p2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    long r2 = 0;
    while (y >= 0) {
        plot4(cx, cy, x, y, YELLOW);
        if (r2 < 60)
            cout << "  r2 step " << r2 << ": (" << x << ", " << y << ") p2=" << p2 << endl;
        if (p2 > 0) {
            y--; dy -= 2 * rx2; p2 += rx2 - dy;
        } else {
            y--; x++; dx += 2 * ry2; dy -= 2 * rx2; p2 += dx - dy + rx2;
        }
        r2++;
    }

    setcolor(WHITE);
    outtextxy(cx + (int)rx - 40, cy + 8, (char*)"(cx+rx, cy)");
    outtextxy(cx + 6, cy - (int)ry - 6, (char*)"(cx, cy+ry)");
    outtextxy(10, 8, (char*)"Midpoint Ellipse Lab - dark = ellipse() reference, yellow = algorithm points");
    outtextxy(cx - 190, getmaxy() - 26, (char*)"Press any key in this window to close");
    cout << "Done - " << step << " region-1 + " << r2 << " region-2 steps, 4-way mirrored." << endl;

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) break;
        delay(10);
    }
    closegraph();
    return 0;
}
