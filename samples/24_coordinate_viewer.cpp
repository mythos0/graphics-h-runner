/* 24_coordinate_viewer.cpp — Coordinate Viewer: the graphics.h screen
 * coordinate system, live. Origin (0,0) is the TOP-LEFT corner, +x grows
 * right and +y grows DOWN — exactly what every BGI primitive uses.
 *   G = grid on/off      C = coordinate labels   O = origin marker
 *   A = axes on/off      S = snap to 10 px       click = plot a point
 *   R = reset toggles    ESC = quit
 * Clicked points are printed in the TERMINAL as (x, y). The demo point
 * (250,100) from the lecture sketch is always shown. Headless-friendly:
 * the window closes by itself after ~12 seconds.
 */
#include <graphics.h>
#include <cstdio>
#include <vector>

using namespace std;

static bool gGrid = true, gCoords = true, gOrigin = true, gAxes = true, gSnap = false;
static vector<int> ptx, pty;             /* plotted points */

static void drawScene()
{
    int W = getmaxx(), H = getmaxy();
    char b[64];
    cleardevice();

    if (gGrid) {
        setcolor(DARKGRAY);              /* minor grid: every 20 px */
        for (int x = 20; x < W; x += 20) line(x, 0, x, H);
        for (int y = 20; y < H; y += 20) line(0, y, W, y);
        setcolor(LIGHTGRAY);             /* major grid: every 100 px */
        for (int x = 100; x < W; x += 100) line(x, 0, x, H);
        for (int y = 100; y < H; y += 100) line(0, y, W, y);
    }
    if (gAxes) {                         /* the real BGI axes: top + left edges */
        setcolor(RED);
        line(0, 0, W, 0);
        line(0, 1, W, 1);
        setcolor(BLUE);
        line(0, 0, 0, H);
        line(1, 0, 1, H);
    }
    if (gCoords) {
        setcolor(WHITE);
        for (int x = 100; x < W; x += 100) {
            line(x, 0, x, 6);
            sprintf(b, "%d", x);
            outtextxy(x + 4, 4, b);
        }
        for (int y = 100; y < H; y += 100) {
            line(0, y, 6, y);
            sprintf(b, "%d", y);
            outtextxy(8, y + 2, b);
        }
    }
    if (gOrigin) {
        setcolor(YELLOW);
        circle(0, 0, 6);
        outtextxy(10, 22, (char*)"(0,0) origin");
    }

    /* the lecture-sketch point: (250,100) */
    setcolor(MAGENTA);
    setfillstyle(SOLID_FILL, MAGENTA);
    fillellipse(250, 100, 4, 4);
    outtextxy(258, 92, (char*)"(250,100)");

    /* everything the student clicked */
    setcolor(LIGHTCYAN);
    setfillstyle(SOLID_FILL, LIGHTCYAN);
    for (size_t i = 0; i < ptx.size(); i++) {
        fillellipse(ptx[i], pty[i], 3, 3);
        sprintf(b, "(%d,%d)", ptx[i], pty[i]);
        outtextxy(ptx[i] + 6, pty[i] - 8, b);
    }

    /* status bar with the five toggles */
    setfillstyle(SOLID_FILL, DARKGRAY);
    bar(0, H - 26, W, H);
    setcolor(WHITE);
    sprintf(b, "Grid:%s Coord:%s Origin:%s Axes:%s Snap:%s   G C O A S = toggle   click = plot   R = reset   ESC = quit",
            gGrid ? "ON" : "off", gCoords ? "ON" : "off", gOrigin ? "ON" : "off",
            gAxes ? "ON" : "off", gSnap ? "ON" : "off");
    outtextxy(8, H - 18, b);
}

int main()
{
#ifdef _WIN32
    initwindow(800, 600, "Coordinate Viewer");
#else
    initwindow(800, 600);
#endif
    drawScene();

    for (int t = 0; t < 1200; t++) {     /* ~12 s self-exit */
        if (kbhit()) {
            int k = getch();
            if (k == 27) break;          /* ESC */
            if (k == 'g' || k == 'G') gGrid = !gGrid;
            else if (k == 'c' || k == 'C') gCoords = !gCoords;
            else if (k == 'o' || k == 'O') gOrigin = !gOrigin;
            else if (k == 'a' || k == 'A') gAxes = !gAxes;
            else if (k == 's' || k == 'S') gSnap = !gSnap;
            else if (k == 'r' || k == 'R') { gGrid = gCoords = gOrigin = gAxes = true; gSnap = false; }
            else continue;
            printf("toggles: grid=%d coords=%d origin=%d axes=%d snap=%d\n",
                   (int)gGrid, (int)gCoords, (int)gOrigin, (int)gAxes, (int)gSnap);
            drawScene();
        }
        if (ismouseclick(WM_LBUTTONDOWN)) {
            int mx = 0, my = 0;
            getmouseclick(WM_LBUTTONDOWN, &mx, &my);
            clearmouseclick(WM_LBUTTONDOWN);
            if (mx >= 0 && my >= 0 && my < getmaxy() - 26) {
                if (gSnap) { mx = (mx / 10) * 10; my = (my / 10) * 10; }
                if (ptx.size() < 200) { ptx.push_back(mx); pty.push_back(my); }
                printf("plotted point: (%d, %d)%s\n", mx, my, gSnap ? "  (snapped to 10 px)" : "");
                drawScene();
            }
        }
        delay(10);
    }
    closegraph();
    return 0;
}
