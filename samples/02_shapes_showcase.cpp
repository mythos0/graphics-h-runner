/* 02_shapes_showcase.cpp — exercises the classic BGI drawing primitives:
 * bar, rectangle, circle, ellipse, line, floodfill, polygons, text styles
 * and the 16-color palette. Self-closes after 10 seconds or on keypress.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    /* filled shapes */
    setcolor(YELLOW);
    setfillstyle(SOLID_FILL, BLUE);
    bar(40, 60, 180, 160);

    setcolor(WHITE);
    setfillstyle(SOLID_FILL, RED);
    circle(300, 110, 60);
    floodfill(300, 110, WHITE);

    setcolor(CYAN);
    setfillstyle(SOLID_FILL, MAGENTA);
    fillellipse(540, 110, 80, 45);

    /* outline shapes */
    setcolor(GREEN);
    rectangle(40, 220, 200, 340);

    setcolor(LIGHTRED);
    ellipse(300, 280, 0, 360, 90, 60);

    setcolor(BROWN);
    line(420, 220, 600, 340);
    line(420, 340, 600, 220);

    /* polygon */
    setcolor(YELLOW);
    int tri[8] = {120, 380, 200, 460, 40, 460, 120, 380};
    drawpoly(4, tri);

    /* palette strip */
    for (int c = 0; c <= 15; c++) {
        setfillstyle(SOLID_FILL, c);
        bar(280 + c * 12, 400, 280 + c * 12 + 10, 440);
    }

    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(280, 350, (char*)"BGI shapes showcase");

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 10) {
        delay(40);
    }

    closegraph();
    return 0;
}
