/* 04_moving_car.cpp — scrolling road scene with a moving car.
 * Demonstrates coordinated shape groups + animation. Runs until you press a key.
 */
#include <graphics.h>
#include <cstdlib>
#include <ctime>

static void drawCar (int x, int y)
{
    /* body */
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, RED);
    bar(x, y, x + 130, y + 30);

    /* cabin */
    setfillstyle(SOLID_FILL, LIGHTRED);
    bar(x + 30, y - 25, x + 95, y);

    /* windows */
    setfillstyle(SOLID_FILL, CYAN);
    bar(x + 38, y - 19, x + 60, y - 4);
    bar(x + 66, y - 19, x + 88, y - 4);

    /* wheels */
    setcolor(BLACK);
    setfillstyle(SOLID_FILL, DARKGRAY);
    fillellipse(x + 28, y + 34, 14, 14);
    fillellipse(x + 100, y + 34, 14, 14);
    setfillstyle(SOLID_FILL, LIGHTGRAY);
    fillellipse(x + 28, y + 34, 6, 6);
    fillellipse(x + 100, y + 34, 6, 6);
}

int main ( )
{
    initwindow(640, 480);

    int roadY = 340;
    int x = -160;
    int maxx = getmaxx();

    /* v1.5.3: runs until YOU quit (ESC or Q). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    while (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000) {
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
        cleardevice();

        setcolor(BLUE);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(20, 20, (char*)"graphics.h animation: moving car");

        /* road */
        setcolor(WHITE);
        setfillstyle(SOLID_FILL, DARKGRAY);
        bar(0, roadY, maxx, roadY + 60);

        /* dashes */
        for (int d = -80; d < maxx + 80; d += 60) {
            int dx = (d + x) % (maxx + 120);
            if (dx < 0) {
                dx += maxx + 120;
            }
            bar(dx, roadY + 28, dx + 30, roadY + 34);
        }

        drawCar(x % (maxx + 240) - 160, roadY - 60);

        delay(30);
        x += 6;
    }

    closegraph();
    return 0;
}
