/* 06_fractal_tree.cpp — recursive binary fractal tree with colored leaves.
 * The tree "grows" one recursion level at a time over a sunlit scene,
 * then holds the final picture and self-closes.
 */
#include <graphics.h>
#include <cmath>
#include <ctime>

static void branch (int x, int y, int len, double angle, int depth)
{
    if (depth == 0 || len < 2) {
        return;
    }
    int x2 = x + (int)(len * cos(angle));
    int y2 = y - (int)(len * sin(angle));

    if (depth > 7) {
        /* trunk: brown and 2 px thick */
        setcolor(BROWN);
        line(x, y, x2, y2);
        line(x, y + 1, x2, y2 + 1);
    } else if (depth > 2) {
        /* branches: green */
        setcolor(GREEN);
        line(x, y, x2, y2);
    } else {
        /* twig tips: colored leaf dots */
        static const int leaf[6] = { LIGHTRED, YELLOW, CYAN, MAGENTA, WHITE, LIGHTGREEN };
        setcolor(leaf[(x * 7 + y * 13) % 6]);
        fillellipse(x2, y2, 2, 2);
        return;
    }

    branch(x2, y2, (int)(len * 0.72), angle + 0.45, depth - 1);
    branch(x2, y2, (int)(len * 0.72), angle - 0.45, depth - 1);
}

static void scene (int depth)
{
    cleardevice();

    /* sun + ground line */
    setcolor(YELLOW);
    setfillstyle(SOLID_FILL, YELLOW);
    fillellipse(560, 60, 28, 28);
    setcolor(LIGHTBLUE);
    line(0, 462, 639, 462);

    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(200, 20, (char*)"graphics.h fractal tree");

    branch(320, 462, 110, 1.5708, depth);
}

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    /* animate the growth: depth 1..10 */
    for (int depth = 1; depth <= 10; depth++) {
        scene(depth);
        delay(600);
    }

    /* hold the final tree */
    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 8) {
        delay(40);
    }

    closegraph();
    return 0;
}
