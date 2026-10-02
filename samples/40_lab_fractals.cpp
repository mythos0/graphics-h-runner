/* 40_lab_fractals.cpp — recursion you can SEE: two classic fractals,
 * drawn with nothing but line() and a function that calls itself.
 *
 *   Koch snowflake  — replace the middle third of every segment with
 *                     two sides of a triangle, repeat on the results
 *   Sierpinski triangle — a triangle is three half-size triangles
 *
 * Keys:  + / -  recursion depth (Koch 0..5, Sierpinski 0..7)
 *        TAB    switch fractal          R  redraw
 *        ESC or Q quit
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cstdio>
#include <cmath>

using namespace std;

static int g_depth = 0;                          /* current recursion depth */
static bool g_koch = true;                        /* koch or sierpinski?    */
static const double PI = 3.14159265358979323846;

/* ---- Koch: recursive segment rewriting ---- */
static void kochLine(double x1, double y1, double x2, double y2, int depth)
{
    if (depth == 0) { line((int)x1, (int)y1, (int)x2, (int)y2); return; }
    double dx = (x2 - x1) / 3.0, dy = (y2 - y1) / 3.0;
    double xa = x1 + dx,        ya = y1 + dy;            /* 1/3 point     */
    double xb = x1 + 2.0 * dx,  yb = y1 + 2.0 * dy;      /* 2/3 point     */
    /* the peak: rotate the middle third by -60 degrees */
    double px = xa + (xb - xa) * cos(-PI / 3) - (yb - ya) * sin(-PI / 3);
    double py = ya + (xb - xa) * sin(-PI / 3) + (yb - ya) * cos(-PI / 3);
    kochLine(x1, y1, xa, ya, depth - 1);
    kochLine(xa, ya, px, py, depth - 1);
    kochLine(px, py, xb, yb, depth - 1);
    kochLine(xb, yb, x2, y2, depth - 1);
}

static void drawKoch()
{
    /* the snowflake = the SAME rewrite applied to a triangle's 3 sides,
     * traced A(top) -> B(bottom-left) -> C(bottom-right) -> A */
    double ax = 400, ay = 120;
    double bx = 280, by = 328;
    double cx = 520, cy = 328;
    kochLine(ax, ay, bx, by, g_depth);
    kochLine(bx, by, cx, cy, g_depth);
    kochLine(cx, cy, ax, ay, g_depth);
}

/* ---- Sierpinski: recursive corner-midpoint triangles ---- */
static void sierpinski(int x1, int y1, int x2, int y2, int x3, int y3, int depth)
{
    if (depth == 0) {
        line(x1, y1, x2, y2); line(x2, y2, x3, y3); line(x3, y3, x1, y1);
        return;
    }
    int mx12 = (x1 + x2) / 2, my12 = (y1 + y2) / 2;
    int mx23 = (x2 + x3) / 2, my23 = (y2 + y3) / 2;
    int mx31 = (x3 + x1) / 2, my31 = (y3 + y1) / 2;
    sierpinski(x1, y1, mx12, my12, mx31, my31, depth - 1);   /* corner 1 */
    sierpinski(mx12, my12, x2, y2, mx23, my23, depth - 1);   /* corner 2 */
    sierpinski(mx31, my31, mx23, my23, x3, y3, depth - 1);   /* corner 3 */
}

static void redraw()
{
    cleardevice();
    setcolor(WHITE);
    char msg[96];
    if (g_koch) sprintf(msg, "KOCH SNOWFLAKE  depth %d  (+/- depth, TAB fractal, ESC quit)", g_depth);
    else        sprintf(msg, "SIERPINSKI TRIANGLE  depth %d  (+/- depth, TAB fractal, ESC quit)", g_depth);
    outtextxy(10, 8, msg);
    setcolor(LIGHTCYAN);
    if (g_koch) drawKoch();
    else sierpinski(400, 100, 200, 440, 600, 440, g_depth);
}

int main()
{
    cout << "=== Lab 9 - Fractals (Recursion) ===" << endl;
    cout << "One function calling itself on smaller pieces = a fractal." << endl;
    cout << "Press + / - to change depth, TAB to switch fractal." << endl;

#ifdef _WIN32
    initwindow(800, 560, "Lab 9 - Fractals");
#else
    initwindow(800, 560);
#endif

    redraw();
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);

    for (;;) {
        if (kbhit()) {
            int prefix = getch();
            int key = (prefix == 0 || prefix == 224) ? getch() : prefix;
            if (key == 27 || key == 'q' || key == 'Q') break;
            bool changed = false;
            if (key == '+') {
                int maxd = g_koch ? 5 : 7;
                if (g_depth < maxd) { g_depth++; changed = true; }
            } else if (key == '-') {
                if (g_depth > 0) { g_depth--; changed = true; }
            } else if (key == 9) {                       /* TAB */
                g_koch = !g_koch; g_depth = 0; changed = true;
            }
            if (changed) {
                redraw();
                cout << (g_koch ? "Koch" : "Sierpinski") << " depth " << g_depth << endl;
            }
        }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
        delay(10);
    }

    cout << "Koch at depth d has 3 * 4^d segments: recursion EXPLODES" << endl;
    cout << "linear cost into exponential detail. That is the lesson." << endl;
    closegraph();
    return 0;
}
