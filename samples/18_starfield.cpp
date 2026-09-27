/* 18_starfield.cpp — fly through a starfield at warp speed. Stars
 * streak outward from the center; a message appears at the end.
 * Runs until you press ESC or Q.
 */
#include <graphics.h>
#include <cstdlib>
#include <ctime>
#include <cmath>

#define NSTARS 90

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    int cx = 320, cy = 240;
    int sx[NSTARS], sy[NSTARS];
    double sa[NSTARS], sr[NSTARS], sv[NSTARS];

    for (int i = 0; i < NSTARS; i++) {
        sa[i] = ((rand() % 3600) / 1800.0) * 3.14159;
        sr[i] = 5 + rand() % 40;
        sv[i] = 0.6 + (rand() % 20) / 12.0;
    }

    /* v1.5.3: runs until YOU quit (ESC or Q). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    long tick = 0;

    while (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000) {
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
        setfillstyle(SOLID_FILL, BLACK);
        bar(0, 0, 640, 480);

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(DARKGRAY);
        outtextxy(220, 460, (char*)"graphics.h starfield - ESC or Q exits");

        for (int i = 0; i < NSTARS; i++) {
            int x1 = cx + (int)(sr[i] * cos(sa[i]));
            int y1 = cy + (int)(sr[i] * 0.8 * sin(sa[i]));
            double r2 = sr[i] + sv[i] * 6;
            int x2 = cx + (int)(r2 * cos(sa[i]));
            int y2 = cy + (int)(r2 * 0.8 * sin(sa[i]));

            /* color by speed: slow = dark, fast = white */
            if (sv[i] > 1.6) setcolor(WHITE);
            else if (sv[i] > 1.0) setcolor(LIGHTGRAY);
            else setcolor(DARKGRAY);

            line(x1, y1, x2, y2);

            sr[i] += sv[i] * 3.0;
            sv[i] += 0.015;

            /* star flew past the edge -> respawn near the center */
            if (x2 < 0 || x2 > 640 || y2 < 0 || y2 > 480) {
                sa[i] = ((rand() % 3600) / 1800.0) * 3.14159;
                sr[i] = 2 + rand() % 15;
                sv[i] = 0.6 + (rand() % 20) / 12.0;
            }
        }

        /* warp burst every 200 frames */
        if (tick % 200 == 199) {
            setcolor(CYAN);
            circle(cx, cy, 40);
            circle(cx, cy, 60);
        }

        delay(25);
        tick++;
    }
    closegraph();
    return 0;
}
