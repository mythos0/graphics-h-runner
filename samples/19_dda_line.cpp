/* 19_dda_line.cpp — DDA (Digital Differential Analyzer) line drawing:
 * type the two endpoints in the TERMINAL, the program prints the DDA
 * step table (dx, dy, steps, increments and every generated point) and
 * plots the line pixel by pixel in the graphics window. Y grows upward
 * from the window centre, like in math class. Headless-friendly: with
 * stdin closed or empty, a demo line is drawn instead.
 * The window closes on any key, or by itself after ~12 seconds.
 */
#include <graphics.h>
#include <iostream>
#include <cmath>
#include <cstdlib>

using namespace std;

static int iround (float v)
{
    return (int)(v + (v >= 0 ? 0.5f : -0.5f));
}

int main ( )
{
    int x1, y1, x2, y2;

    cout << "=== DDA Line Drawing Algorithm ===" << endl;
    cout << "Enter x1 y1 x2 y2 (math coords, e.g. -200 100 250 -80): ";
    if (!(cin >> x1 >> y1 >> x2 >> y2)) {
        /* stdin closed or empty (headless demo): fall back to a sample line */
        x1 = -220; y1 = -120; x2 = 240; y2 = 150;
        cout << "(no input received - drawing demo line "
             << x1 << " " << y1 << " " << x2 << " " << y2 << ")" << endl;
    }

    int dx = x2 - x1;
    int dy = y2 - y1;
    int steps = abs(dx) > abs(dy) ? abs(dx) : abs(dy);
    if (steps < 1) steps = 1;    /* same point -> still plot one pixel */

    float xInc = (float)dx / (float)steps;
    float yInc = (float)dy / (float)steps;

    cout << "dx = " << dx << ", dy = " << dy << ", steps = " << steps << endl;
    cout << "xIncrement = " << xInc << ", yIncrement = " << yInc << endl;
    cout << "Generated points:" << endl;

    initwindow(800, 600);

    int cx = getmaxx() / 2;      /* screen centre = math origin */
    int cy = getmaxy() / 2;

    /* light axes through the centre for orientation */
    setcolor(LIGHTGRAY);
    line(0, cy, getmaxx(), cy);
    line(cx, 0, cx, getmaxy());
    outtextxy(cx - 150, 10, (char*)"DDA Line Drawing Algorithm");

    float x = (float)x1;
    float y = (float)y1;
    setcolor(YELLOW);
    for (int i = 0; i <= steps; i++) {
        int px = cx + iround(x);
        int py = cy - iround(y);
        cout << "  step " << i << ": (" << iround(x) << ", " << iround(y) << ")" << endl;
        putpixel(px, py, YELLOW);
        if (steps <= 300) delay(10);
        x += xInc;
        y += yInc;
    }

    outtextxy(cx - 190, getmaxy() - 30, (char*)"Press any key in this window to close");
    cout << "Done - line drawn with " << steps + 1 << " points." << endl;
    cout << "Press any key in the graphics window to close..." << endl;

    /* wait up to ~12 s for a key, then close (headless-friendly self-exit) */
    for (int t = 0; t < 1200; t++) {
        if (kbhit()) break;
        delay(10);
    }
    closegraph();
    return 0;
}
