/* 14_aquarium.cpp — three fish swim back and forth above swaying
 * seaweed while bubbles rise to the surface. Runs 12 seconds or until
 * a key is pressed.
 */
#include <graphics.h>
#include <cstdlib>
#include <cmath>
#include <ctime>

static void drawFish (int x, int y, int color, int dir, int tailSwing)
{
    setcolor(color);
    setfillstyle(SOLID_FILL, color);
    fillellipse(x, y, 18, 10);
    /* tail triangle */
    int tx = x - dir * 18;
    line(tx, y, tx - dir * 10, y - 7 + tailSwing);
    line(tx, y, tx - dir * 10, y + 7 + tailSwing);
    line(tx - dir * 10, y - 7 + tailSwing, tx - dir * 10, y + 7 + tailSwing);
    /* eye */
    setcolor(BLACK);
    setfillstyle(SOLID_FILL, WHITE);
    fillellipse(x + dir * 8, y - 3, 3, 3);
    setfillstyle(SOLID_FILL, BLACK);
    fillellipse(x + dir * 9, y - 3, 1, 1);
}

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLUE);
    cleardevice();

    int maxx = getmaxx(), maxy = getmaxy();
    int floorY = maxy - 50;

    /* three fish with different speeds, lanes and colors */
    int fx[3] = {100, 400, 250};
    int fy[3] = {140, 240, 330};
    int fdx[3] = {4, -3, 5};
    int fcol[3] = {YELLOW, LIGHTRED, LIGHTGREEN};

    /* bubbles: x, y, rise speed */
    int bx[8], by[8], bs[8];
    for (int i = 0; i < 8; i++) {
        bx[i] = 40 + i * 75;
        by[i] = 200 + (i * 47) % 200;
        bs[i] = 2 + i % 3;
    }

    time_t start = time(NULL);
    long tick = 0;

    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(12, 8, (char*)"graphics.h aquarium - press any key to exit");

        /* sandy floor + seaweed */
        setcolor(BROWN);
        setfillstyle(SOLID_FILL, BROWN);
        bar(0, floorY, maxx, maxy);
        for (int s = 0; s < 6; s++) {
            int baseX = 50 + s * 105;
            setcolor(GREEN);
            for (int seg = 0; seg < 5; seg++) {
                int sway = (int)(6 * sin(tick * 0.08 + s + seg * 0.7));
                line(baseX, floorY - seg * 14,
                     baseX + sway, floorY - (seg + 1) * 14);
            }
        }

        /* bubbles */
        for (int i = 0; i < 8; i++) {
            setcolor(LIGHTCYAN);
            circle(bx[i], by[i], 3 + i % 3);
            by[i] -= bs[i];
            if (by[i] < 40) {
                by[i] = floorY - 10;
                bx[i] = rand() % maxx;  /* rand needs cstdlib? use i-based reset */
            }
        }

        /* fish */
        for (int i = 0; i < 3; i++) {
            int tail = (int)(4 * sin(tick * 0.3 + i));
            drawFish(fx[i], fy[i] + (int)(8 * sin(tick * 0.05 + i * 2)), fcol[i],
                     fdx[i] > 0 ? 1 : -1, tail);
            fx[i] += fdx[i];
            if (fx[i] < 30 || fx[i] > maxx - 30) {
                fdx[i] = -fdx[i];
                fx[i] += fdx[i] * 2;
            }
        }

        delay(30);
        tick++;
    }
    closegraph();
    return 0;
}
