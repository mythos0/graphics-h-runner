/* 11_bouncing_balls.cpp — seven colorful balls bounce around the screen
 * with trails, squishing off walls. Runs 10 seconds or until a key.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    initwindow(640, 480);

    const int N = 7;
    int x[N], y[N], dx[N], dy[N], r[N], c[N];
    int colors[7] = {RED, LIGHTGREEN, CYAN, YELLOW, MAGENTA, WHITE, LIGHTRED};

    for (int i = 0; i < N; i++) {
        x[i]  = 80 + i * 70;
        y[i]  = 100 + (i % 3) * 110;
        dx[i] = 4 + i;
        dy[i] = 5 - (i % 3);
        if (dy[i] == 0) dy[i] = 3;
        r[i]  = 16 + (i % 3) * 8;
        c[i]  = colors[i];
    }

    time_t start = time(NULL);
    int maxx = getmaxx(), maxy = getmaxy();

    while (!kbhit() && time(NULL) - start < 10) {
        /* trailing effect: dark translucent-ish overlay */
        setfillstyle(SOLID_FILL, BLACK);
        bar(0, 0, maxx, maxy);

        setcolor(DARKGRAY);
        rectangle(2, 2, maxx - 3, maxy - 3);
        setcolor(WHITE);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(12, 8, (char*)"graphics.h bouncing balls - press any key to exit");

        for (int i = 0; i < N; i++) {
            /* ghost trail */
            setcolor(c[i]);
            circle(x[i] - dx[i] * 2, y[i] - dy[i] * 2, r[i] - 3);
            circle(x[i] - dx[i] * 4, y[i] - dy[i] * 4, r[i] - 6);

            setcolor(c[i]);
            setfillstyle(SOLID_FILL, c[i]);
            fillellipse(x[i], y[i], r[i], r[i]);

            /* highlight spot */
            setcolor(WHITE);
            fillellipse(x[i] - r[i] / 3, y[i] - r[i] / 3, r[i] / 5, r[i] / 5);

            x[i] += dx[i];
            y[i] += dy[i];
            if (x[i] - r[i] < 4 || x[i] + r[i] > maxx - 4) {
                dx[i] = -dx[i];
                x[i] += dx[i] * 2;
            }
            if (y[i] - r[i] < 22 || y[i] + r[i] > maxy - 4) {
                dy[i] = -dy[i];
                y[i] += dy[i] * 2;
            }
        }
        delay(20);
    }
    closegraph();
    return 0;
}
