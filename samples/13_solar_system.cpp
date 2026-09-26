/* 13_solar_system.cpp — the sun at the center with three orbiting
 * planets (one with its own moon), plus a comet on a wild path.
 * Runs 12 seconds or until a key is pressed.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);

    time_t start = time(NULL);
    long tick = 0;
    int cx = 320, cy = 240;

    /* pre-computed star field */
    int stars[40][2];
    for (int i = 0; i < 40; i++) {
        stars[i][0] = (i * 331) % 640;
        stars[i][1] = (i * 157) % 480;
    }

    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();

        for (int i = 0; i < 40; i++) {
            putpixel(stars[i][0], stars[i][1], WHITE);
        }

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(200, 460, (char*)"graphics.h solar system - any key exits");

        /* orbit rings */
        setcolor(DARKGRAY);
        circle(cx, cy, 90);
        circle(cx, cy, 150);
        circle(cx, cy, 205);

        /* the sun */
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(cx, cy, 34, 34);
        setcolor(LIGHTRED);
        setfillstyle(SOLID_FILL, LIGHTRED);
        fillellipse(cx, cy, 24, 24);

        /* planet 1: Mercury-ish, fast, gray */
        double a1 = tick * 0.06;
        int p1x = cx + (int)(90 * cos(a1));
        int p1y = cy + (int)(50 * sin(a1));
        setcolor(LIGHTGRAY);
        setfillstyle(SOLID_FILL, LIGHTGRAY);
        fillellipse(p1x, p1y, 7, 7);

        /* planet 2: blue with rings + a moon */
        double a2 = tick * 0.028 + 2.0;
        int p2x = cx + (int)(150 * cos(a2));
        int p2y = cy + (int)(84 * sin(a2));
        setcolor(CYAN);
        setfillstyle(SOLID_FILL, CYAN);
        fillellipse(p2x, p2y, 13, 13);
        setcolor(LIGHTCYAN);
        ellipse(p2x, p2y, 0, 360, 22, 6);   /* planetary ring */
        double m1 = tick * 0.11;
        setcolor(WHITE);
        setfillstyle(SOLID_FILL, WHITE);
        fillellipse(p2x + (int)(22 * cos(m1)), p2y + (int)(8 * sin(m1)), 4, 4);

        /* planet 3: red giant, slow */
        double a3 = tick * 0.015 + 4.4;
        int p3x = cx + (int)(205 * cos(a3));
        int p3y = cy + (int)(116 * sin(a3));
        setcolor(LIGHTRED);
        setfillstyle(SOLID_FILL, RED);
        fillellipse(p3x, p3y, 17, 17);
        setcolor(BROWN);
        fillellipse(p3x - 5, p3y - 4, 6, 4);   /* surface blotch */

        /* comet crossing the sky */
        double ca = tick * 0.045;
        int hx = (int)(80 + 480 * (0.5 + 0.5 * cos(ca)));
        int hy = (int)(60 + 40 * sin(ca * 2.3));
        setcolor(YELLOW);
        line(hx, hy, hx - 26, hy + 9);
        line(hx, hy, hx - 24, hy + 15);
        setfillstyle(SOLID_FILL, WHITE);
        fillellipse(hx, hy, 3, 3);

        delay(25);
        tick++;
    }
    closegraph();
    return 0;
}
