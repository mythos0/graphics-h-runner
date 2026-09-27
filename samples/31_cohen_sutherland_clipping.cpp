/* 31_cohen_sutherland_clipping.cpp — Cohen-Sutherland Line Clipping
 * Lab: 12 random lines against a fixed clip window. The FULL line is
 * drawn dark gray, the VISIBLE (clipped) part bright yellow with white
 * endpoint dots, and the TERMINAL prints each line's 4-bit outcodes
 * (TBRL: Top-Bottom-Right-Left) and the verdict:
 * inside / outside / clipped. The 8 region codes are labeled around
 * the window.  R = regenerate lines   ESC = quit   ~12 s self-exit
 */
#include <graphics.h>
#include <cstdio>
#include <cstdlib>
#include <ctime>

static const int WX1 = 200, WY1 = 150, WX2 = 600, WY2 = 450;
static unsigned long seed = 12345;

static int rnd()
{
    seed = (seed * 1103515245UL + 12345UL) & 0x7FFFFFFFUL;
    return (int)(seed % 1000);
}

/* outcode: 8=Top 4=Bottom 2=Right 1=Left */
static int outCode(int x, int y)
{
    int c = 0;
    if (y < WY1) c |= 8; else if (y > WY2) c |= 4;
    if (x > WX2) c |= 2; else if (x < WX1) c |= 1;
    return c;
}

/* classic Cohen-Sutherland; returns 1 accept (x1..y2 clipped), 0 reject */
static int clipLine(int &x1, int &y1, int &x2, int &y2)
{
    int c1 = outCode(x1, y1), c2 = outCode(x2, y2);
    while (true) {
        if (c1 == 0 && c2 == 0) return 1;             /* trivially inside */
        if ((c1 & c2) != 0) return 0;                 /* trivially outside */
        int c = c1 ? c1 : c2;
        int x = 0, y = 0;
        if (c & 8)      { x = x1 + (x2 - x1) * (WY1 - y1) / (y2 - y1); y = WY1; }
        else if (c & 4) { x = x1 + (x2 - x1) * (WY2 - y1) / (y2 - y1); y = WY2; }
        else if (c & 2) { y = y1 + (y2 - y1) * (WX2 - x1) / (x2 - x1); x = WX2; }
        else            { y = y1 + (y2 - y1) * (WX1 - x1) / (x2 - x1); x = WX1; }
        if (c == c1) { x1 = x; y1 = y; c1 = outCode(x1, y1); }
        else         { x2 = x; y2 = y; c2 = outCode(x2, y2); }
    }
}

static void drawScene(int lines[12][4])
{
    char b[64];
    cleardevice();

    /* region code labels around the window */
    setcolor(DARKGRAY);
    outtextxy(WX1 - 52, WY1 - 14, (char*)"1001");
    outtextxy((WX1 + WX2) / 2 - 12, WY1 - 14, (char*)"1000");
    outtextxy(WX2 + 16, WY1 - 14, (char*)"1010");
    outtextxy(WX1 - 52, (WY1 + WY2) / 2 - 4, (char*)"0001");
    outtextxy(WX2 + 16, (WY1 + WY2) / 2 - 4, (char*)"0010");
    outtextxy(WX1 - 52, WY2 + 8, (char*)"0101");
    outtextxy((WX1 + WX2) / 2 - 12, WY2 + 8, (char*)"0100");
    outtextxy(WX2 + 16, WY2 + 8, (char*)"0110");

    /* the clip window */
    setcolor(WHITE);
    rectangle(WX1, WY1, WX2, WY2);
    outtextxy(WX1 + 6, WY1 + 6, (char*)"clip window");

    /* lines: full in dark gray, visible part in yellow */
    for (int i = 0; i < 12; i++) {
        int x1 = lines[i][0], y1 = lines[i][1], x2 = lines[i][2], y2 = lines[i][3];
        setcolor(DARKGRAY);
        line(x1, y1, x2, y2);
        int cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2;
        int ok = clipLine(cx1, cy1, cx2, cy2);
        int v1 = outCode(x1, y1), v2 = outCode(x2, y2);
        printf("line %2d: outcodes c1=%04d c2=%04d -> %s\n",
               i + 1, v1, v2, ok ? (v1 | v2 ? "clipped" : "inside") : "outside (rejected)");
        if (ok) {
            setcolor(YELLOW);
            line(cx1, cy1, cx2, cy2);
            setfillstyle(SOLID_FILL, WHITE);
            fillellipse(cx1, cy1, 2, 2);
            fillellipse(cx2, cy2, 2, 2);
        }
    }

    setcolor(LIGHTGRAY);
    outtextxy(10, 8, (char*)"Cohen-Sutherland Clipping Lab - gray = full lines, yellow = visible parts");
    outtextxy(10, getmaxy() - 26, (char*)"R = regenerate   ESC = quit");
}

int main()
{
#ifdef _WIN32
    initwindow(800, 600, "Cohen-Sutherland Clipping Lab");
#else
    initwindow(800, 600);
#endif
    static int lines[12][4];
    for (int i = 0; i < 12; i++) {
        lines[i][0] = rnd() % 800;
        lines[i][1] = rnd() % 600;
        lines[i][2] = rnd() % 800;
        lines[i][3] = rnd() % 600;
    }
    drawScene(lines);

    for (int t = 0; t < 1200; t++) {
        if (kbhit()) {
            int k = getch();
            if (k == 27) break;
            if (k == 'r' || k == 'R') {
                seed = (unsigned long)time(0) + 7;
                for (int i = 0; i < 12; i++) {
                    lines[i][0] = rnd() % 800;
                    lines[i][1] = rnd() % 600;
                    lines[i][2] = rnd() % 800;
                    lines[i][3] = rnd() % 600;
                }
                printf("--- regenerated ---\n");
                drawScene(lines);
            }
        }
        delay(10);
    }
    closegraph();
    return 0;
}
