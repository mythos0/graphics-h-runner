/* 16_helicopter.cpp — a helicopter flies across a night skyline with a
 * spinning rotor, blinking searchlight and parallax clouds.
 * Runs 12 seconds or until a key is pressed.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);

    int maxx = getmaxx(), maxy = getmaxy();
    int ground = maxy - 50;

    time_t start = time(NULL);
    long tick = 0;

    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(12, 8, (char*)"graphics.h helicopter - press any key to exit");

        /* stars */
        for (int i = 0; i < 25; i++)
            putpixel((i * 211 + 17) % maxx, (i * 97 + 31) % 200, LIGHTGRAY);

        /* skyline (static, drawn every frame) */
        for (int b = 0; b < maxx; b += 48) {
            int h = 60 + ((b * 13) % 90);
            setcolor(DARKGRAY);
            setfillstyle(SOLID_FILL, DARKGRAY);
            bar(b, ground - h, b + 44, ground);
            setcolor(YELLOW);
            for (int w = 0; w < 6; w++)
                if ((w + b) % 3 != 0)
                    bar(b + 6 + (w % 2) * 18, ground - h + 10 + (w / 2) * 18,
                        b + 13 + (w % 2) * 18, ground - h + 17 + (w / 2) * 18);
        }
        setcolor(BLUE);
        setfillstyle(SOLID_FILL, BLUE);
        bar(0, ground, maxx, maxy);

        /* clouds drifting (parallax) */
        int cloudX = (int)(maxx - (tick * 2) % (maxx + 200));
        setcolor(LIGHTGRAY);
        ellipse(cloudX, 110, 0, 360, 42, 12);
        ellipse(cloudX + 30, 116, 0, 360, 30, 10);

        /* helicopter position: smooth left-right sweep */
        double a = tick * 0.02;
        int hx = 320 + (int)(220 * cos(a));
        int hy = 190 + (int)(28 * sin(a * 2));

        /* searchlight beam */
        int beam = (tick % 20 < 12) ? 1 : 0;
        if (beam) {
            setcolor(YELLOW);
            line(hx, hy + 16, hx - 60, ground);
            line(hx + 10, hy + 16, hx - 44, ground);
        }

        /* body */
        setcolor(LIGHTGREEN);
        setfillstyle(SOLID_FILL, GREEN);
        fillellipse(hx, hy, 34, 15);
        setcolor(WHITE);
        setfillstyle(SOLID_FILL, LIGHTCYAN);
        fillellipse(hx + 14, hy - 2, 12, 9);           /* cockpit glass */

        /* tail boom + rotor */
        setcolor(LIGHTGREEN);
        line(hx - 34, hy, hx - 62, hy - 8);
        setfillstyle(SOLID_FILL, LIGHTGREEN);
        bar(hx - 70, hy - 14, hx - 56, hy - 4);        /* tail fin */
        setcolor(WHITE);
        int rotor = (tick % 2 == 0) ? 26 : -26;
        line(hx - 4, hy - 18, hx + rotor, hy - 30);
        line(hx - 4, hy - 18, hx - rotor, hy - 30);
        bar(hx - 6, hy - 20, hx + 2, hy - 16);
        line(hx - 34, hy + 14, hx - 20, hy + 20);      /* skids */
        line(hx + 18, hy + 14, hx + 32, hy + 20);
        line(hx - 36, hy + 20, hx + 34, hy + 20);

        delay(30);
        tick++;
    }
    closegraph();
    return 0;
}
