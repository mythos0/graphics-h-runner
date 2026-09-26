/* 27_bresenham_line_lab.cpp — Bresenham Line Lab on a coordinate grid:
 * the pure-integer algorithm (no floats, no rounding) with the error /
 * decision variable printed for every step. Same layout as the DDA lab
 * so both algorithms can be compared directly:
 *   - green line   = line() reference
 *   - yellow dots  = the Bresenham points
 * Enter x1 y1 x2 y2 in the TERMINAL (any slope, all octants); EOF-safe
 * demo line; any key or ~12 s closes the window.
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
    outtextxy(10, 8, (char*)"Bresenham Line Lab - green = line() reference, yellow = Bresenham points");
}

int main()
{
    int x1, y1, x2, y2;

    cout << "=== Bresenham Line Lab (integer algorithm) ===" << endl;
    cout << "Enter x1 y1 x2 y2 (math coords, e.g. -200 -100 250 120): ";
    if (!(cin >> x1 >> y1 >> x2 >> y2)) {
        x1 = -220; y1 = -120; x2 = 240; y2 = 150;
        cout << "(no input received - drawing demo line "
             << x1 << " " << y1 << " " << x2 << " " << y2 << ")" << endl;
    }

    int sx = x1 < x2 ? 1 : -1;
    int sy = y1 < y2 ? 1 : -1;
    int dx = (x2 - x1) * sx;      /* |dx| */
    int dy = (y1 - y2) * sy;      /* -|dy| */
    int err = dx + dy;            /* decision variable */

    cout << "Bresenham loop (all-integer): sx=" << sx << " sy=" << sy
         << " dx=" << dx << " dy=" << dy << " err0=" << err << endl;
    cout << "step table (x, y, err):" << endl;

#ifdef _WIN32
    initwindow(800, 600, "Bresenham Line Lab");
#else
    initwindow(800, 600);
#endif
    int cx = getmaxx() / 2, cy = getmaxy() / 2;
    drawGrid(cx, cy);

    setcolor(GREEN);
    line(cx + x1, cy - y1, cx + x2, cy - y2);

    setcolor(YELLOW);
    int x = x1, y = y1, step = 0, printed = 0;
    while (true) {
        int px = cx + x, py = cy - y;
        putpixel(px, py, YELLOW);
        if (printed < 400) {
            cout << "  step " << step << ": (" << x << ", " << y << ") err=" << err << endl;
            printed++;
        } else if (printed == 400) {
            cout << "  ... (more steps, see the window)" << endl;
            printed++;
        }
        if (x == x2 && y == y2) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
        step++;
        if (step > 4000) break;   /* safety net */
        if (step % 40 == 0) delay(6);
    }

    setcolor(WHITE);
    outtextxy(cx + x1 - 20, cy - y1 - 18, (char*)"(x1,y1)");
    outtextxy(cx + x2 + 6, cy - y2 - 18, (char*)"(x2,y2)");
    outtextxy(cx - 190, getmaxy() - 26, (char*)"Press any key in this window to close");
    cout << "Done - " << step + 1 << " Bresenham points, zero floating point." << endl;

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) break;
        delay(10);
    }
    closegraph();
    return 0;
}
