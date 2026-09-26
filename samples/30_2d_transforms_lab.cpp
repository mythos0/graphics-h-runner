/* 30_2d_transforms_lab.cpp — 2D Transformations Lab: a house drawn
 * with drawpoly() and transformed with real 2-D homogeneous matrices.
 *   T = translate by (120, -60)
 *   R = rotate 45 degrees around the pivot (marked with a cross)
 *   S = scale by (1.5, 0.8) relative to the pivot
 *   X = reset to the original shape
 * The original house stays as a dotted gray outline; the transformed
 * copy is solid cyan. The active matrix is printed in the TERMINAL
 * every time. Any key or ~12 s closes the window.
 */
#include <graphics.h>
#include <cstdio>
#include <cmath>

using namespace std;

static const int ORIG[12] = {80, 240, 240, 240, 240, 350, 160, 410, 80, 350, 80, 240};
static const int PIVOT[2] = {160, 320};   /* rotation / scale pivot */
static int cur[12];

static void resetHouse()
{
    for (int i = 0; i < 12; i++) cur[i] = ORIG[i];
}

static void drawGrid()
{
    int W = getmaxx(), H = getmaxy();
    for (int x = 25; x < W; x += 25)
        for (int y = 25; y < H; y += 25)
            putpixel(x, y, DARKGRAY);
    setcolor(LIGHTGRAY);
    line(0, 320, W, 320);
    line(160, 0, 160, H);
}

static void drawAll()
{
    char b[80];
    cleardevice();
    drawGrid();

    /* pivot cross */
    setcolor(RED);
    line(PIVOT[0] - 8, PIVOT[1], PIVOT[0] + 8, PIVOT[1]);
    line(PIVOT[0], PIVOT[1] - 8, PIVOT[0], PIVOT[1] + 8);
    outtextxy(PIVOT[0] + 10, PIVOT[1] + 8, (char*)"pivot");

    /* original as dotted outline */
    setcolor(LIGHTGRAY);
    setlinestyle(DOTTED_LINE, 0, NORM_WIDTH);
    drawpoly(6, (int*)ORIG);

    /* transformed copy solid + filled */
    setcolor(CYAN);
    setlinestyle(SOLID_LINE, 0, THICK_WIDTH);
    drawpoly(6, cur);
    setfillstyle(SOLID_FILL, DARKGRAY);
    fillpoly(5, cur);
    setlinestyle(SOLID_LINE, 0, NORM_WIDTH);

    setcolor(WHITE);
    outtextxy(10, 8, (char*)"2D Transformations Lab - gray dotted = original, cyan = transformed");
    setcolor(YELLOW);
    outtextxy(10, getmaxy() - 26,
              (char*)"T translate   R rotate 45   S scale   X reset   ESC quit");
    setfillstyle(SOLID_FILL, DARKGRAY);
    setcolor(WHITE);
    sprintf(b, "active matrix: house corners now at (%d,%d) and (%d,%d)", cur[0], cur[1], cur[2], cur[3]);
    outtextxy(10, 24, b);
}

static void printMat(const char *name, double a, double b, double c,
                     double d, double e, double f)
{
    printf("%s\n", name);
    printf("  [ %8.4f %8.4f %8.4f ]\n", a, b, c);
    printf("  [ %8.4f %8.4f %8.4f ]\n", d, e, f);
    printf("  [ %8.4f %8.4f %8.4f ]\n\n", 0.0, 0.0, 1.0);
}

static void applyTransform(double a, double b, double c, double d, double e, double f)
{
    for (int i = 0; i < 12; i += 2) {
        double x = cur[i], y = cur[i + 1];
        cur[i]     = (int)(a * x + b * y + c + 0.5);
        cur[i + 1] = (int)(d * x + e * y + f + 0.5);
    }
}

int main()
{
#ifdef _WIN32
    initwindow(800, 600, "2D Transformations Lab");
#else
    initwindow(800, 600);
#endif
    resetHouse();

    /* opening move: one translate so both shapes are visible */
    applyTransform(1, 0, 120, 0, 1, -60);
    printMat("Translate by (120, -60):", 1, 0, 120, 0, 1, -60);
    drawAll();

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) {
            int k = getch();
            if (k == 27) break;
            if (k == 't' || k == 'T') {
                for (int i = 0; i < 12; i += 2) { cur[i] += 40; cur[i + 1] -= 20; }
                printMat("Translate by (40, -20):", 1, 0, 40, 0, 1, -20);
                drawAll();
            } else if (k == 'r' || k == 'R') {
                double a = 0.70710678, s = 0.70710678;
                for (int i = 0; i < 12; i += 2) {
                    double x = cur[i] - PIVOT[0], y = cur[i + 1] - PIVOT[1];
                    cur[i]     = (int)(PIVOT[0] + a * x + s * y + 0.5);
                    cur[i + 1] = (int)(PIVOT[1] - s * x + a * y + 0.5);
                }
                printMat("Rotate 45 deg around pivot (160, 320):", a, s, PIVOT[0], -s, a, PIVOT[1]);
                drawAll();
            } else if (k == 's' || k == 'S') {
                for (int i = 0; i < 12; i += 2) {
                    double x = cur[i] - PIVOT[0], y = cur[i + 1] - PIVOT[1];
                    cur[i]     = (int)(PIVOT[0] + 1.5 * x + 0.5);
                    cur[i + 1] = (int)(PIVOT[1] + 0.8 * y + 0.5);
                }
                printMat("Scale by (1.5, 0.8) around pivot:",
                         1.5, 0, PIVOT[0] * (1 - 1.5), 0, 0.8, PIVOT[1] * (1 - 0.8));
                drawAll();
            } else if (k == 'x' || k == 'X') {
                resetHouse();
                printf("Reset to the original shape.\n\n");
                drawAll();
            }
        }
        delay(10);
    }
    closegraph();
    return 0;
}
