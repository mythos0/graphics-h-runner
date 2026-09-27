/* 26_dda_lab.cpp — DDA Line Lab on a coordinate grid: type the two
 * endpoints in the TERMINAL, then watch every DDA step appear pixel by
 * pixel. The library's own line() is drawn underneath as the reference:
 *   - green line   = line() reference (what the library draws)
 *   - yellow dots  = the points YOUR DDA loop generates
 *   - step table (dx, dy, steps, increments, every point) in the terminal
 * EOF-safe demo line when no input arrives; any key or ~12 s closes.
 */
#include <graphics.h>
#include <iostream>
#include <cmath>
#include <cstdlib>

using namespace std;

static int iround(float v)
{
    return (int)(v + (v >= 0 ? 0.5f : -0.5f));
}

static void drawGrid(int cx, int cy)
{
    int W = getmaxx(), H = getmaxy();
    for (int x = cx % 25; x < W; x += 25)
        for (int y = cy % 25; y < H; y += 25)
            putpixel(x, y, DARKGRAY);          /* grid intersections */
    setcolor(LIGHTGRAY);
    line(0, cy, W, cy);                        /* math axes through centre */
    line(cx, 0, cx, H);
    outtextxy(10, 8, (char*)"DDA Line Lab - green = line() reference, yellow = DDA points");
}

int main()
{
    int x1, y1, x2, y2;

    cout << "=== DDA Line Lab (grid + step table) ===" << endl;
    cout << "Enter x1 y1 x2 y2 (math coords, e.g. -200 100 250 -80): ";
    if (!(cin >> x1 >> y1 >> x2 >> y2)) {
        x1 = -220; y1 = -120; x2 = 240; y2 = 150;
        cout << "(no input received - drawing demo line "
             << x1 << " " << y1 << " " << x2 << " " << y2 << ")" << endl;
    }

    int dx = x2 - x1;
    int dy = y2 - y1;
    int steps = abs(dx) > abs(dy) ? abs(dx) : abs(dy);
    if (steps < 1) steps = 1;

    float xInc = (float)dx / (float)steps;
    float yInc = (float)dy / (float)steps;

    cout << "dx = " << dx << ", dy = " << dy << ", steps = " << steps << endl;
    cout << "xIncrement = " << xInc << ", yIncrement = " << yInc << endl;
    cout << "Generated points:" << endl;

#ifdef _WIN32
    initwindow(800, 600, "DDA Line Lab");
#else
    initwindow(800, 600);
#endif
    int cx = getmaxx() / 2, cy = getmaxy() / 2;
    drawGrid(cx, cy);

    /* reference line underneath */
    setcolor(GREEN);
    line(cx + x1, cy - y1, cx + x2, cy - y2);

    float x = (float)x1;
    float y = (float)y1;
    setcolor(YELLOW);
    int printed = 0;
    for (int i = 0; i <= steps; i++) {
        int px = cx + iround(x);
        int py = cy - iround(y);
        if (printed < 400) {
            cout << "  step " << i << ": (" << iround(x) << ", " << iround(y) << ")" << endl;
            printed++;
        } else if (printed == 400) {
            cout << "  ... (" << steps - 400 << " more steps, see the window)" << endl;
            printed++;
        }
        putpixel(px, py, YELLOW);
        if (steps <= 300) delay(12);
        x += xInc;
        y += yInc;
    }

    setcolor(WHITE);
    outtextxy(cx + x1 - 20, cy - y1 - 18, (char*)"(x1,y1)");
    outtextxy(cx + x2 + 6, cy - y2 - 18, (char*)"(x2,y2)");
    outtextxy(cx - 190, getmaxy() - 26, (char*)"Press any key in this window to close");
    cout << "Done - " << steps + 1 << " DDA points over the line() reference." << endl;

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) break;
        delay(10);
    }
    closegraph();
    return 0;
}
