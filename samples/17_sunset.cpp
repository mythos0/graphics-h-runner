/* 17_sunset.cpp — the sun slowly sinks into the sea, the sky changes
 * from day to dusk, stars come out and the moon rises with a
 * lighthouse blinking on the shore. Runs 14 seconds or until a key.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);

    int maxx = getmaxx();
    int horizon = 300;

    time_t start = time(NULL);
    long tick = 0;

    while (!kbhit() && time(NULL) - start < 14) {
        cleardevice();

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(12, 8, (char*)"graphics.h sunset - press any key to exit");

        /* progress 0 -> 1 across the run */
        double p = tick / 420.0;
        if (p > 1.0) p = 1.0;

        /* sky bands: lighten to dark as the sun sets */
        int bandH = horizon / 6;
        int shades[6] = {BLUE, BLUE, CYAN, CYAN, LIGHTCYAN, LIGHTCYAN};
        for (int b = 0; b < 6; b++) {
            /* top bands darken first */
            if ((double)b / 6.0 < p * 1.4) {
                setfillstyle(SOLID_FILL, DARKGRAY);
                setcolor(DARKGRAY);
            } else {
                setfillstyle(SOLID_FILL, shades[b]);
                setcolor(shades[b]);
            }
            bar(0, b * bandH + 24, maxx, (b + 1) * bandH + 24);
        }

        /* stars appear as night falls */
        if (p > 0.45) {
            for (int i = 0; i < 30; i++) {
                int sy = 30 + (i * 53) % (horizon - 80);
                if ((double)sy / horizon < p) {
                    setcolor(WHITE);
                    putpixel((i * 149 + 23) % maxx, sy, WHITE);
                    putpixel((i * 149 + 24) % maxx, sy, WHITE);
                }
            }
        }

        /* moon rises in the second half */
        if (p > 0.55) {
            double mp = (p - 0.55) / 0.45;
            int mx = 520, my = (int)(240 - 150 * mp);
            setcolor(WHITE);
            setfillstyle(SOLID_FILL, WHITE);
            fillellipse(mx, my, 22, 22);
            setcolor(DARKGRAY);
            fillellipse(mx - 6, my - 4, 5, 5);
            fillellipse(mx + 7, my + 6, 4, 4);
        }

        /* the sun: sinks from y=120 to below the horizon */
        int sunY = 120 + (int)(240 * p);
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(160, sunY, 38, 38);
        setcolor(LIGHTRED);
        setfillstyle(SOLID_FILL, LIGHTRED);
        fillellipse(160, sunY, 28, 28);

        /* sea + shimmering reflection */
        setcolor(BLUE);
        setfillstyle(SOLID_FILL, BLUE);
        bar(0, horizon, maxx, 480);
        for (int w = 0; w < 14; w++) {
            int wy = horizon + 12 + w * 12;
            int wobble = (int)(8 * sin(tick * 0.1 + w));
            setcolor(CYAN);
            line(60 + wobble + w * 6, wy, 180 - w * 4 + wobble, wy);
        }

        /* shore + lighthouse with blinking lamp */
        setcolor(GREEN);
        setfillstyle(SOLID_FILL, GREEN);
        bar(430, horizon - 10, 640, horizon);
        setcolor(WHITE);
        setfillstyle(SOLID_FILL, WHITE);
        bar(470, horizon - 90, 494, horizon - 8);
        setfillstyle(SOLID_FILL, RED);
        bar(468, horizon - 102, 496, horizon - 90);
        if (tick % 30 < 15) {
            setcolor(YELLOW);
            setfillstyle(SOLID_FILL, YELLOW);
            fillellipse(482, horizon - 96, 6, 6);
            line(482, horizon - 96, 560, horizon - 130);
            line(482, horizon - 96, 560, horizon - 60);
        }

        delay(33);
        tick++;
    }
    closegraph();
    return 0;
}
