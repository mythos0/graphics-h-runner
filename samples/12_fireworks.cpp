/* 12_fireworks.cpp — rockets launch from the ground, explode into
 * colorful particle showers above a city skyline. Runs 12 seconds or
 * until a key is pressed.
 */
#include <graphics.h>
#include <cstdlib>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);

    const int MAXP = 120;
    /* NOTE: every particle array MUST be zero-initialized — drawing a
     * "particle" from an uninitialized slot feeds a garbage color index
     * into setfillstyle(), which crashes the SDL_bgi palette read. */
    int px[MAXP] = {0}, py[MAXP] = {0}, pvx[MAXP] = {0}, pvy[MAXP] = {0}, pc[MAXP] = {0};
    int alive[MAXP] = {0};
    int rocketX = -1, rocketY = -1, rocketV = 0, targetY = 0;
    bool rocketFlying = false;
    int flashX = -1, flashY = -1, flashAge = 0;   /* bright burst center */
    long tick = 0;
    int colors[6] = {RED, YELLOW, GREEN, CYAN, MAGENTA, WHITE};

    time_t start = time(NULL);
    int ground = getmaxy() - 60;
    int maxx = getmaxx();
    int maxy = getmaxy();

    /* NOTE: this sample deliberately avoids putpixel() — per-frame putpixel
     * right after cleardevice() races with SDL_bgi's surface flip and can
     * crash the window. Filled-shape calls like bar() are safe every frame. */

    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();
        /* static stars (same pattern every frame, drawn crash-safely) */
        for (int i = 0; i < 40; i++) {
            int sx = (i * 137) % maxx;
            int sy = (i * 61) % (ground - 120);
            setfillstyle(SOLID_FILL, DARKGRAY);
            bar(sx, sy, sx + 1, sy + 1);
        }

        /* city skyline */
        for (int b = 0; b < maxx; b += 42) {
            int h = 40 + ((b * 7) % 55);
            setcolor(BLUE);
            setfillstyle(SOLID_FILL, BLUE);
            bar(b, ground - h, b + 38, ground);
            setcolor(YELLOW);
            for (int w = 0; w < 4; w++)
                bar(b + 5 + (w % 2) * 16, ground - h + 8 + (w / 2) * 16,
                    b + 12 + (w % 2) * 16, ground - h + 15 + (w / 2) * 16);
        }
        setcolor(LIGHTGRAY);
        line(0, ground, maxx, ground);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(12, 8, (char*)"graphics.h fireworks - press any key to exit");

        /* launch a new rocket every ~40 ticks */
        if (!rocketFlying && tick % 40 == 0) {
            rocketX = 60 + rand() % (maxx - 120);
            rocketY = ground;
            targetY = 70 + rand() % 120;
            rocketV = 14;
            rocketFlying = true;
        }
        if (rocketFlying) {
            setcolor(YELLOW);
            setfillstyle(SOLID_FILL, YELLOW);
            bar(rocketX - 2, rocketY - 8, rocketX + 2, rocketY + 4);
            setcolor(RED);
            line(rocketX, rocketY + 5, rocketX, rocketY + 16);
            rocketY -= rocketV;
            if (rocketY <= targetY) {
                /* explode: fill the particle pool */
                int col = colors[rand() % 6];
                for (int i = 0; i < MAXP; i++) {
                    int a = rand() % 360;
                    int s = 2 + rand() % 6;
                    px[i] = rocketX; py[i] = rocketY;
                    pvx[i] = (int)(s * cos(a * 3.14159 / 180.0));
                    pvy[i] = (int)(s * sin(a * 3.14159 / 180.0));
                    pc[i] = col;
                    alive[i] = 18 + rand() % 10;
                }
                flashX = rocketX;
                flashY = rocketY;
                flashAge = 6;
                rocketFlying = false;
            }
        }

        /* bright flash right after the explosion */
        if (flashAge > 0) {
            setcolor(WHITE);
            setfillstyle(SOLID_FILL, YELLOW);
            fillellipse(flashX, flashY, 3 + flashAge * 2, 3 + flashAge * 2);
            flashAge--;
        }

        /* particles (kept strictly on-screen; drawn as 2x2 filled rects —
         * putpixel right after cleardevice() can crash SDL_bgi) */
        for (int i = 0; i < MAXP; i++) {
            if (alive[i] <= 0) continue;
            px[i] += pvx[i];
            py[i] += pvy[i];
            pvy[i] += 1;              /* gravity */
            alive[i]--;
            if (px[i] < 0 || px[i] + 2 >= maxx || py[i] < 0 || py[i] + 2 >= maxy) {
                alive[i] = 0;
                continue;
            }
            setcolor(pc[i]);
            setfillstyle(SOLID_FILL, pc[i]);
            bar(px[i], py[i], px[i] + 2, py[i] + 2);
        }

        delay(30);
        tick++;
    }
    closegraph();
    return 0;
}
