/* 15_rainbow_spiral.cpp — a rainbow spiral that keeps growing while
 * rotating, drawn purely with putpixel(). Runs 10 seconds or until a
 * key is pressed.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    int cx = 320, cy = 240;
    time_t start = time(NULL);
    long tick = 0;

    /* 6 pure BGI colors instead of RGB mixing (portable across WinBGIM
     * and SDL_bgi) */
    int cols[6] = {RED, LIGHTRED, YELLOW, GREEN, CYAN, MAGENTA};

    while (!kbhit() && time(NULL) - start < 10) {
        /* draw one ring of the spiral per frame (persistent canvas) */
        for (int k = 0; k < 40; k++) {
            double t = (tick * 40 + k) * 0.045;
            double r = 4 + t * 3.2;
            if (r > 300) r = 300;
            double ang = t + tick * 0.05;
            int x = cx + (int)(r * cos(ang));
            int y = cy + (int)(r * 0.75 * sin(ang));
            setcolor(cols[(int)(t * 4) % 6]);
            putpixel(x, y, cols[(int)(t * 4) % 6]);
        }

        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(WHITE);
        outtextxy(200, 460, (char*)"graphics.h rainbow spiral - any key exits");
        setcolor(CYAN);
        bar(cx - 1, cy - 1, cx + 1, cy + 1);

        delay(20);
        tick++;

        /* restart the canvas after it saturates so motion continues */
        if (tick % 140 == 0) {
            cleardevice();
        }
    }
    closegraph();
    return 0;
}
