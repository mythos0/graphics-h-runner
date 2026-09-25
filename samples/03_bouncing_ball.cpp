/* 03_bouncing_ball.cpp — classic delay()-based animation.
 * A red ball bounces inside a bordered court with ghost trails,
 * for 10 seconds or until a key is pressed.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    initwindow(640, 480);

    int maxx = getmaxx(), maxy = getmaxy();
    int top = 28;                      /* court top edge (below the title) */

    /* the ball */
    int x = 120, y = 120, dx = 6, dy = 5, r = 26;

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 10) {
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
