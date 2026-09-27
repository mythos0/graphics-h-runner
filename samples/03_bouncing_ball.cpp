/* 03_bouncing_ball.cpp — classic delay()-based animation.
 * A red ball bounces inside a bordered court with ghost trails,
 * until you press a key.
 */
#include <graphics.h>
#include <cstdlib>
#include <ctime>

int main ( )
{
    initwindow(640, 480);

    int maxx = getmaxx(), maxy = getmaxy();
    int top = 28;                      /* court top edge (below the title) */

    /* the ball */
    int x = 120, y = 120, dx = 6, dy = 5, r = 26;

    /* v1.5.3: runs until YOU quit (press a key). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    while (!kbhit() && (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000)) {
        cleardevice();

        /* court frame + title (redrawn every frame) */
        setcolor(WHITE);
        rectangle(4, top, maxx - 5, maxy - 5);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(10, 6, (char*)"graphics.h bouncing ball - press any key to exit");

        /* ghost trails behind the ball */
        setcolor(DARKGRAY);
        circle(x - dx * 3, y - dy * 3, r);
        circle(x - dx * 6, y - dy * 6, r);

        /* the ball */
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, RED);
        fillellipse(x, y, r, r);

        delay(25);

        x += dx;
        y += dy;
        if (x < r + 8 || x > maxx - r - 8) {
            dx = -dx;
        }
        if (y < top + r + 4 || y > maxy - r - 8) {
            dy = -dy;
        }
    }

    closegraph();
    return 0;
}
