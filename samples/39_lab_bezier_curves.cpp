/* 39_lab_bezier_curves.cpp — cubic Bézier curves via the de Casteljau
 * construction, animated: watch lerp-of-lerps become the curve.
 *
 *   P0, P1, P2, P3 = the four control points (you click them!)
 *   every level lerps neighbouring points by the same t:
 *     A(t) = lerp(P0, P1, t)   B(t) = lerp(P1, P2, t)   C(t) = lerp(P2, P3, t)
 *     D(t) = lerp(A, B, t)     E(t) = lerp(B, C, t)
 *     point on the curve = lerp(D, E, t)
 *
 * Left-click moves the NEXT control point (then t-replay restarts).
 * The curve is traced point by point with the construction lines
 * shown at each step. R replays. ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>

using namespace std;

static int PX[4] = { 120, 260, 480, 700 };
static int PY[4] = { 450, 120, 520, 200 };

static int lerpi(int a, int b, float t) { return (int)(a + (b - a) * t); }

static void drawSetup()
{
    cleardevice();
    setcolor(WHITE);
    outtextxy(8, 8, (char*)"De Casteljau: left-click sets the NEXT control point | R = replay | ESC/Q = quit");

    /* control polygon */
    setcolor(DARKGRAY);
    for (int i = 0; i < 3; i++) line(PX[i], PY[i], PX[i + 1], PY[i + 1]);
    for (int i = 0; i < 4; i++) {                /* control points numbered */
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(PX[i], PY[i], 5, 5);
        char tag[3] = { (char)('0' + i), 0 };
        setcolor(WHITE);
        outtextxy(PX[i] + 8, PY[i] - 14, tag);
    }
}

int main()
{
    cout << "=== Lab 8 - Bezier Curves (de Casteljau) ===" << endl;
    cout << "Four control points. For each t in [0,1], lerp neighbouring" << endl;
    cout << "points repeatedly until ONE point remains - its path IS the" << endl;
    cout << "curve. Left-click re-places points one by one." << endl;

#ifdef _WIN32
    initwindow(820, 600, "Lab 8 - Bezier Curves");
#else
    initwindow(820, 600);
#endif

    int nextPoint = 0;
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);

    bool replay = true;
    while (true) {
        if (replay) {
            drawSetup();
            setlinestyle(0, 0, 1);
            /* trace the curve, showing the construction every 14 steps */
            float t = 0.0f;
            int step = 0;
            while (t <= 1.0f) {
                int ax = lerpi(PX[0], PX[1], t), ay = lerpi(PY[0], PY[1], t);
                int bx = lerpi(PX[1], PX[2], t), by = lerpi(PY[1], PY[2], t);
                int cx = lerpi(PX[2], PX[3], t), cy = lerpi(PY[2], PY[3], t);
                int dx = lerpi(ax, bx, t),      dy = lerpi(ay, by, t);
                int ex = lerpi(bx, cx, t),      ey = lerpi(by, cy, t);
                int fx = lerpi(dx, ex, t),      fy = lerpi(dy, ey, t);
                if (step % 14 == 0) {                  /* construction frame */
                    setcolor(LIGHTRED);   line(ax, ay, bx, by); line(bx, by, cx, cy);
                    setcolor(LIGHTGREEN); line(dx, dy, ex, ey);
                    setcolor(LIGHTCYAN);  fillellipse(fx, fy, 3, 3);
                }
                putpixel(fx, fy, WHITE);
                delay(18);
                t += 0.01f;
                step++;
                if (kbhit()) { int k = getch(); if (k == 27 || k == 'q' || k == 'Q') { closegraph(); return 0; } }
                if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
            }
            /* final curve on top, smooth */
            setcolor(WHITE);
            float t2 = 0.0f; int lx = PX[0], ly = PY[0];
            for (; t2 <= 1.0001f; t2 += 0.02f) {
                int ax = lerpi(PX[0], PX[1], t2), ay = lerpi(PY[0], PY[1], t2);
                int bx = lerpi(PX[1], PX[2], t2), by = lerpi(PY[1], PY[2], t2);
                int cx = lerpi(PX[2], PX[3], t2), cy = lerpi(PY[2], PY[3], t2);
                int dx = lerpi(ax, bx, t2),      dy = lerpi(ay, by, t2);
                int ex = lerpi(bx, cx, t2),      ey = lerpi(by, cy, t2);
                int fx = lerpi(dx, ex, t2),      fy = lerpi(dy, ey, t2);
                if (t2 > 0) line(lx, ly, fx, fy);
                lx = fx; ly = fy;
            }
            replay = false;
        }

        /* interactive: click to set control points, R to replay */
        if (ismouseclick(WM_LBUTTONDOWN)) {
            clearmouseclick(WM_LBUTTONDOWN);
            if (nextPoint > 3) { drawSetup(); }    /* restart the cycle */
            if (nextPoint <= 3) {
                PX[nextPoint] = mousex(); PY[nextPoint] = mousey();
                nextPoint++;
            }
            replay = true;
        }
        if (kbhit()) {
            int k = getch();
            if (k == 27 || k == 'q' || k == 'Q') break;
            if (k == 'r' || k == 'R') replay = true;
        }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
        delay(10);
    }

    cout << "Notice: the curve stays INSIDE the control polygon - that" << endl;
    cout << "convex-hull property is why Béziers are safe to edit." << endl;
    closegraph();
    return 0;
}
