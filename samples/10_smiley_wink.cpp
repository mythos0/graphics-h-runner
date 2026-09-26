/* 10_smiley_wink.cpp — a giant smiley that bobs around, winks at you
 * every few seconds and blows a heart. Runs 10 seconds or until a key.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);

    time_t start = time(NULL);
    int cx = 320, cy = 240;
    int blinkFrame = -1;          /* frame counter of the current wink */
    long tick = 0;

    while (!kbhit() && time(NULL) - start < 10) {
        cleardevice();
        setbkcolor(BLACK);

        /* gentle bobbing motion */
        int bob = (int)(6 * sin(tick * 0.09));
        int y = cy + bob;

        /* background hearts every 2.5 s */
        if (tick % 150 < 40) {
            int hy = 120 - (int)(tick % 150) * 2;
            setcolor(LIGHTRED);
            setfillstyle(SOLID_FILL, LIGHTRED);
            fillellipse(90, hy, 9, 9);
            fillellipse(108, hy, 9, 9);
            bar(85, hy - 2, 113, hy + 10);
            fillellipse(540, 380 - hy + 60, 7, 7);
            fillellipse(554, 380 - hy + 60, 7, 7);
            bar(536, 380 - hy + 58, 558, 380 - hy + 68);
        }

        /* face */
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(cx, y, 150, 150);

        /* eyes (one winks on a cycle) */
        setcolor(BLACK);
        setfillstyle(SOLID_FILL, BLACK);
        bool winking = (tick % 120) < 14;
        if (winking) {
            setlinestyle(SOLID_LINE, 0, 3);
            line(cx - 70, y - 45, cx - 30, y - 45);   /* closed left eye */
            setlinestyle(SOLID_LINE, 0, 1);
        } else {
            fillellipse(cx - 50, y - 45, 14, 20);     /* open left eye */
        }
        fillellipse(cx + 50, y - 45, 14, 20);         /* right eye */

        /* cheeks */
        setcolor(LIGHTRED);
        setfillstyle(SOLID_FILL, LIGHTRED);
        fillellipse(cx - 95, y + 15, 20, 12);
        fillellipse(cx + 95, y + 15, 20, 12);

        /* smile */
        setcolor(BLACK);
        setlinestyle(SOLID_LINE, 0, 3);
        arc(cx, y + 10, 200, 340, 80);
        setlinestyle(SOLID_LINE, 0, 1);

        setcolor(WHITE);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(190, 455, (char*)"graphics.h smiley - press any key to exit");

        delay(30);
        tick++;
        if (winking && blinkFrame < 0) blinkFrame = 0;
        if (blinkFrame >= 0 && !winking) blinkFrame = -1;
    }
    closegraph();
    return 0;
}
