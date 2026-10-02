/* 41_lab_3d_wireframe_cube.cpp — the advanced finale: real 3-D. Eight
 * points float in space; every frame they are rotated and projected to
 * the screen BY HAND — the exact math behind every 3-D game engine:
 *
 *   1. ROTATE  yaw (around Y) and pitch (around X) matrices
 *   2. PROJECT perspective: screen_x = x * f / (z + distance)
 *                           (things twice as far look half as big)
 *   3. DRAW    the 12 edges between the projected corners
 *
 * Keys: arrows spin (left/right yaw, up/down pitch), + / - zoom,
 * SPACE toggles auto-spin. ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>
#include <ctime>      /* time() — older MinGW flavors do not leak it */

using namespace std;

/* the 8 corners of a cube, centred at the origin, side 2 */
static const double CUBE[8][3] = {
    { -1, -1, -1 }, { 1, -1, -1 }, { 1, 1, -1 }, { -1, 1, -1 },
    { -1, -1,  1 }, { 1, -1,  1 }, { 1, 1,  1 }, { -1, 1,  1 }
};
/* the 12 edges as index pairs into CUBE */
static const int EDGES[12][2] = {
    { 0, 1 }, { 1, 2 }, { 2, 3 }, { 3, 0 },        /* back face  */
    { 4, 5 }, { 5, 6 }, { 6, 7 }, { 7, 4 },        /* front face */
    { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 }         /* the joins  */
};

int main()
{
    cout << "=== Lab 10 - 3D Wireframe Cube ===" << endl;
    cout << "ROTATE (yaw/pitch matrices) -> PROJECT (x*f/(z+d)) -> DRAW" << endl;
    cout << "(12 edges). Arrows spin, +/- zoom, SPACE auto-spin." << endl;

#ifdef _WIN32
    initwindow(800, 600, "Lab 10 - 3D Wireframe Cube");
#else
    initwindow(800, 600);
#endif

    double yaw = 0.6, pitch = 0.35;              /* radians          */
    double zoom = 320.0;                         /* focal scale      */
    double dist = 4.2;                           /* camera distance  */
    bool autoSpin = true;

    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);

    while (true) {
        if (autoSpin) yaw += 0.02;

        /* 1+2. rotate every corner and project it */
        double sx[8], sy[8]; double szdepth[8];
        double cy = cos(yaw), sy_ = sin(yaw);
        double cp = cos(pitch), sp = sin(pitch);
        for (int i = 0; i < 8; i++) {
            double x = CUBE[i][0], y = CUBE[i][1], z = CUBE[i][2];
            double x1 =  x * cy + z * sy_;       /* yaw around Y */
            double z1 = -x * sy_ + z * cy;
            double y2 =  y * cp - z1 * sp;       /* pitch around X */
            double z2 =  y * sp + z1 * cp;
            double zz = z2 + dist;               /* push it in front of the camera */
            sx[i] = 400 + x1 * zoom / zz;        /* 3. perspective divide */
            sy[i] = 300 - y2 * zoom / zz;        /* screen Y grows DOWN   */
            szdepth[i] = zz;
        }

        /* 3. draw */
        cleardevice();
        setcolor(WHITE);
        outtextxy(8, 8, (char*)"arrows spin | +/- zoom | SPACE auto-spin | ESC/Q quit");
        for (int e = 0; e < 12; e++) {
            int a = EDGES[e][0], b = EDGES[e][1];
            /* depth cue: nearer edges brighter and thicker */
            double near1 = 2.0 - (szdepth[a] + szdepth[b]) / 2.0 + dist;
            int col = near1 > 1.0 ? WHITE : (near1 > 0.6 ? LIGHTGRAY : DARKGRAY);
            setcolor(col);
            line((int)sx[a], (int)sy[a], (int)sx[b], (int)sy[b]);
        }
        setcolor(YELLOW);
        /* frontmost face corners get dots - helps read the spin */
        for (int i = 0; i < 8; i++)
            if (szdepth[i] < dist) fillellipse((int)sx[i], (int)sy[i], 2, 2);

        delay(28);

        /* input */
        if (kbhit()) {
            int prefix = getch();
            int key = (prefix == 0 || prefix == 224) ? getch() : prefix;
            if (key == 27 || key == 'q' || key == 'Q') break;
            switch (key) {
                case 72: pitch -= 0.1; autoSpin = false; break;  /* up    */
                case 80: pitch += 0.1; autoSpin = false; break;  /* down  */
                case 75: yaw   -= 0.1; autoSpin = false; break;  /* left  */
                case 77: yaw   += 0.1; autoSpin = false; break;  /* right */
                case '+': if (zoom < 700) zoom += 30; break;
                case '-': if (zoom > 120) zoom -= 30; break;
                case ' ': autoSpin = !autoSpin; break;
            }
        }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
    }

    cout << "That divide by (z + distance) is THE camera. Quaternions," << endl;
    cout << "shaders, GPUs - they all grow from these two matrices." << endl;
    closegraph();
    return 0;
}
