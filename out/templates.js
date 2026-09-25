"use strict";
/**
 * templates.ts — ready-to-insert graphics.h code templates.
 * Kept WinBGIM / SDL_bgi compatible (standard BGI API subset only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATES = void 0;
exports.TEMPLATES = [
    {
        label: 'Basic window + shapes',
        description: 'initwindow, shapes, colors, getch, closegraph',
        code: `#include <graphics.h>

int main ( )
{
    initwindow(640, 480);              // open a 640x480 graphics window

    setbkcolor(BLACK);
    cleardevice();

    // a filled red bar and a yellow circle
    setcolor(YELLOW);
    setfillstyle(SOLID_FILL, RED);
    bar(80, 80, 280, 200);
    circle(450, 140, 70);

    // some text
    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    outtextxy(200, 300, (char*)"Hello, graphics.h!");

    // wait for a keypress, then close
    getch();
    closegraph();
    return 0;
}
`
    },
    {
        label: 'Animation loop (bouncing ball)',
        description: 'classic delay()-based animation skeleton',
        code: `#include <graphics.h>

int main ( )
{
    initwindow(640, 480);

    int x = 100, y = 100, dx = 5, dy = 4, r = 20;
    int maxx = getmaxx(), maxy = getmaxy();

    while (!kbhit()) {                 // animate until a key is pressed
        cleardevice();

        setcolor(CYAN);
        setfillstyle(SOLID_FILL, CYAN);
        fillellipse(x, y, r, r);

        delay(20);                     // ~50 fps

        x += dx;  y += dy;
        if (x < r || x > maxx - r) dx = -dx;
        if (y < r || y > maxy - r) dy = -dy;
    }

    getch();
    closegraph();
    return 0;
}
`
    },
    {
        label: 'Mouse paint',
        description: 'ismouseclick / getmouseclick drawing loop',
        code: `#include <graphics.h>

int main ( )
{
    initwindow(640, 480);
    setbkcolor(WHITE);
    cleardevice();

    setcolor(BLACK);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(10, 10, (char*)"Left-click to paint, right-click to change color, any key to exit.");

    int color = RED;
    while (!kbhit()) {
        /* mousex()/mousey() are portable across WinBGIM and SDL_bgi */
        if (ismouseclick(WM_LBUTTONDOWN)) {
            int mx = mousex(), my = mousey();
            setfillstyle(SOLID_FILL, color);
            bar(mx - 4, my - 4, mx + 4, my + 4);
            clearmouseclick(WM_LBUTTONDOWN);
        }
        if (ismouseclick(WM_RBUTTONDOWN)) {
            color = (color % 15) + 1;  // cycle through the palette
            clearmouseclick(WM_RBUTTONDOWN);
        }
        delay(10);
    }

    closegraph();
    return 0;
}
`
    },
    {
        label: 'Keyboard control loop',
        description: 'kbhit + getch arrow-key movement skeleton',
        code: `#include <graphics.h>

int main ( )
{
    initwindow(640, 480);

    int x = 320, y = 240, step = 8;
    while (true) {
        cleardevice();

        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        fillellipse(x, y, 25, 25);

        setcolor(WHITE);
        outtextxy(10, 10, (char*)"Arrow keys to move, ESC to exit.");

        if (kbhit()) {
            int key = getch();
            if (key == 0 || key == 224) {      // extended key code
                key = getch();                 // actual arrow code
                if (key == 75 && x > 30) x -= step;   // left
                if (key == 77 && x < getmaxx() - 30) x += step; // right
                if (key == 72 && y > 30) y -= step;   // up
                if (key == 80 && y < getmaxy() - 30) y += step; // down
            } else if (key == 27) {            // ESC
                break;
            }
        }
        delay(20);
    }

    closegraph();
    return 0;
}
`
    },
    {
        label: 'Recursive fractal tree',
        description: 'recursion + line drawing showcase',
        code: `#include <graphics.h>
#include <cmath>

void drawTree (int x, int y, int len, double angle, int depth)
{
    if (depth == 0 || len < 2) {
        return;
    }
    int x2 = x + (int)(len * cos(angle));
    int y2 = y - (int)(len * sin(angle));

    setcolor(depth > 4 ? BROWN : GREEN);
    line(x, y, x2, y2);

    drawTree(x2, y2, (int)(len * 0.72), angle + 0.45, depth - 1);
    drawTree(x2, y2, (int)(len * 0.72), angle - 0.45, depth - 1);
}

int main ( )
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    cleardevice();

    drawTree(320, 460, 120, 1.5708, 10);   // grow from bottom center

    setcolor(WHITE);
    outtextxy(240, 20, (char*)"Fractal tree - graphics.h");
    getch();
    closegraph();
    return 0;
}
`
    }
];
//# sourceMappingURL=templates.js.map