/* 08_mouse_paint.cpp — left-click paints, right-click changes color,
 * any key exits. A welcome pattern is pre-drawn so the canvas is never
 * empty; runs at most 12 seconds.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(WHITE);
    cleardevice();

    setcolor(BLACK);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(10, 8, (char*)"Left-click: paint   Right-click: color   Key: exit");

    setcolor(LIGHTGRAY);
    line(0, 26, 640, 26);

    /* pre-drawn welcome pattern */
    int colors[8] = {RED, YELLOW, GREEN, CYAN, BLUE, MAGENTA, LIGHTRED, BROWN};
    for (int i = 0; i < 40; i++) {
        setcolor(colors[i % 8]);
        setfillstyle(SOLID_FILL, colors[(i + 3) % 8]);
        int cx = 80 + (i % 8) * 62;
        int cy = 120 + (i / 8) * 80;
        circle(cx, cy, 24);
        floodfill(cx, cy, colors[i % 8]);
    }

    setcolor(RED);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(200, 440, (char*)"mouse paint demo");

    int color = RED;
    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 12) {
        /* mousex()/mousey() work on both WinBGIM and SDL_bgi, unlike
         * getmouseclick() whose signature differs between them */
        if (ismouseclick(WM_LBUTTONDOWN)) {
            int mx = mousex(), my = mousey();
            setcolor(color);
            setfillstyle(SOLID_FILL, color);
            bar(mx - 5, my - 5, mx + 5, my + 5);
            clearmouseclick(WM_LBUTTONDOWN);
        }
        if (ismouseclick(WM_RBUTTONDOWN)) {
            color = (color % 15) + 1;      /* cycle through the palette */
            clearmouseclick(WM_RBUTTONDOWN);
        }
        delay(10);
    }

    closegraph();
    return 0;
}
