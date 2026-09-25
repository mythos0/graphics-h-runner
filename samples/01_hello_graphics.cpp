/* 01_hello_graphics.cpp — minimal graphics.h program.
 * Compile & run it with the "graphics.h Runner" extension (Ctrl+Alt+R).
 * Self-closes after 8 seconds or on any keypress.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    initwindow(560, 380);

    setbkcolor(BLACK);
    cleardevice();

    setcolor(YELLOW);
    setfillstyle(SOLID_FILL, RED);
    bar(60, 60, 240, 180);

    setcolor(WHITE);
    circle(420, 120, 70);

    setcolor(CYAN);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(150, 260, (char*)"Hello, graphics.h!");

    setcolor(GREEN);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(150, 300, (char*)"Compiled & run by graphics.h Runner");

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 8) {
        delay(50);
    }

    closegraph();
    return 0;
}
