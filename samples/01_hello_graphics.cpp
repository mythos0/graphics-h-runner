/* 01_hello_graphics.cpp — minimal graphics.h program.
 * Compile & run it with the "graphics.h Runner" extension (Ctrl+Alt+R).
 * Stays open until you press any key.
 */
#include <graphics.h>
#include <cstdlib>
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

    /* v1.5.3: runs until YOU quit (press a key). The automated test
     * battery sets BGI_AUTOEXIT_MS so runs still finish by themselves
     * there; real users never set it. */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);
    while (!kbhit() && (autoexitMs <= 0 || time(NULL) - start < autoexitMs / 1000)) {
        delay(50);
    }

    closegraph();
    return 0;
}
