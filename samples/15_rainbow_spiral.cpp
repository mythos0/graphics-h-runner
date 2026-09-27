/* 15_rainbow_spiral.cpp — a rainbow spiral that keeps growing while
 * rotating, drawn purely with putpixel(). Runs until you press
 * a key.
 */
#include <graphics.h>
#include <cstdlib>
#include <cmath>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    int cx = 320, cy = 240;
    /* v1.5.3: runs until YOU quit (ESC or Q). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    long tick = 0;

    /* 6 pure BGI colors instead of RGB mixing (portable across WinBGIM
     * and SDL_bgi) */
    int cols[6] = {RED, LIGHTRED, YELLOW, GREEN, CYAN, MAGENTA};

    while (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000) {
        if (kbhit()) { int quitKey = getch(); if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break; }
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
        outtextxy(200, 460, (char*)"graphics.h rainbow spiral - ESC or Q exits");
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
