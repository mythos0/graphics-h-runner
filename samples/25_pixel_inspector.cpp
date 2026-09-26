/* 25_pixel_inspector.cpp — Pixel Inspector: move the mouse over the
 * window and the readout panel shows the exact pixel position, the
 * color name under the cursor and its classic VGA RGB value. Click a
 * pixel and the line
 *     X=.., Y=.., RGB=(.., .., ..), COLOR=NAME
 * is printed in the TERMINAL — copy it anywhere: that is your
 * coordinate, copied. Teaches the screen coordinate system hands-on.
 *   C = crosshair on/off   ESC = quit   closes itself after ~12 s
 */
#include <graphics.h>
#include <cstdio>

static const char *colorName(int i)
{
    static const char *names[16] = {
        "BLACK", "BLUE", "GREEN", "CYAN", "RED", "MAGENTA", "BROWN", "LIGHTGRAY",
        "DARKGRAY", "LIGHTBLUE", "LIGHTGREEN", "LIGHTCYAN", "LIGHTRED",
        "LIGHTMAGENTA", "YELLOW", "WHITE"
    };
    return (i >= 0 && i < 16) ? names[i] : "CUSTOM";
}

/* what the 16 color NAMES traditionally mean (classic VGA palette) */
static void vgaRgb(int i, int &r, int &g, int &b)
{
    static int tab[16][3] = {
        {0, 0, 0},     {0, 0, 255},   {0, 255, 0},   {0, 255, 255},
        {255, 0, 0},   {255, 0, 255}, {165, 42, 42}, {192, 192, 192},
        {128, 128, 128},{173, 216, 230},{144, 238, 144},{224, 255, 255},
        {255, 160, 160},{255, 160, 255},{255, 255, 0}, {255, 255, 255}
    };
    if (i >= 0 && i < 16) { r = tab[i][0]; g = tab[i][1]; b = tab[i][2]; }
    else { r = i & 0xFF; g = (i >> 8) & 0xFF; b = (i >> 16) & 0xFF; }
}

static void drawScene()
{
    static const char *names[16] = {
        "BLACK", "BLUE", "GREEN", "CYAN", "RED", "MAGENTA", "BROWN", "LIGHTGRAY",
        "DARKGRAY", "LIGHTBLUE", "LIGHTGREEN", "LIGHTCYAN", "LIGHTRED",
        "LIGHTMAGENTA", "YELLOW", "WHITE"
    };
    int W = getmaxx(), H = getmaxy();
    char b[64];

    setcolor(WHITE);
    outtextxy(12, 10, (char*)"Pixel Inspector - move the mouse over the scene, click to copy");

    /* 4x4 palette swatches, left half */
    for (int i = 0; i < 16; i++) {
        int cx = 20 + (i % 4) * 112, cy = 40 + (i / 4) * 92;
        setfillstyle(SOLID_FILL, i);
        bar(cx, cy, cx + 100, cy + 60);
        setcolor(LIGHTGRAY);
        rectangle(cx, cy, cx + 100, cy + 60);
        setcolor(WHITE);
        outtextxy(cx + 4, cy + 64, (char*)names[i]);
    }

    /* shapes, right half: every pixel here has a different color */
    setcolor(RED);       setfillstyle(SOLID_FILL, RED);       fillellipse(600, 120, 55, 55);
    setcolor(GREEN);     setfillstyle(SOLID_FILL, GREEN);     bar(680, 190, 780, 250);
    setcolor(CYAN);      setfillstyle(SOLID_FILL, CYAN);      fillellipse(600, 320, 90, 45);
    setcolor(YELLOW);    setfillstyle(SOLID_FILL, YELLOW);    pieslice(740, 330, 0, 120, 55);
    setcolor(WHITE);     line(490, 400, 790, 400);
    setcolor(MAGENTA);   setfillstyle(SOLID_FILL, MAGENTA);
    {
        int tri[8] = {500, 440, 570, 410, 590, 460, 500, 440};
        fillpoly(4, tri);
    }
    setcolor(WHITE);
    outtextxy(490, 30, (char*)"shapes: every pixel has a color");
}

static void drawCross(int mx, int my)
{
    int W = getmaxx(), H = getmaxy();
    setcolor(WHITE);
    for (int x = 0; x < W; x += 12) { line(x, my, x + 6, my); }
    for (int y = 0; y < H; y += 12) { line(mx, y, mx, y + 6); }
}

static void drawReadout(int W, int H, int mx, int my)
{
    char b[96];
    setfillstyle(SOLID_FILL, DARKGRAY);
    bar(0, H - 118, W, H);
    setcolor(WHITE);
    outtextxy(12, H - 110, (char*)"PIXEL INSPECTOR");
    if (mx >= 0) {
        int c = getpixel(mx, my);
        int r, g, bl;
        vgaRgb(c, r, g, bl);
        sprintf(b, "Mouse: (%d, %d)", mx, my);
        outtextxy(12, H - 92, b);
        sprintf(b, "RGB: %d, %d, %d", r, g, bl);
        outtextxy(12, H - 76, b);
        sprintf(b, "Color: %s", colorName(c));
        outtextxy(12, H - 60, b);
        setcolor(LIGHTGRAY);
        outtextxy(12, H - 40, (char*)"click = print X/Y/RGB to the terminal (copy it there)");
        outtextxy(12, H - 26, (char*)"C = crosshair   ESC = quit");
    } else {
        outtextxy(12, H - 92, (char*)"Mouse: (move the mouse over the window)");
        outtextxy(12, H - 76, (char*)"RGB: -");
        outtextxy(12, H - 60, (char*)"Color: -");
    }
    setcolor(LIGHTRED);
    rectangle(0, H - 118, W, H);
}

int main()
{
#ifdef _WIN32
    initwindow(800, 600, "Pixel Inspector");
#else
    initwindow(800, 600);
#endif
    int mx = -1, my = -1, pinx = -1, piny = -1;
    bool cross = true, redraw = true, pinned = false;

    for (int t = 0; t < 1200; t++) {     /* ~12 s self-exit */
        if (kbhit()) {
            int k = getch();
            if (k == 27) break;
            if (k == 'c' || k == 'C') { cross = !cross; redraw = true; }
        }
        if (ismouseclick(WM_MOUSEMOVE)) {
            int nx = -1, ny = -1;
            getmouseclick(WM_MOUSEMOVE, &nx, &ny);
            clearmouseclick(WM_MOUSEMOVE);
            if (nx >= 0 && ny >= 0 && (nx != mx || ny != my)) {
                mx = nx; my = ny; redraw = true;
            }
        }
        if (ismouseclick(WM_LBUTTONDOWN)) {
            int nx = -1, ny = -1;
            getmouseclick(WM_LBUTTONDOWN, &nx, &ny);
            clearmouseclick(WM_LBUTTONDOWN);
            if (nx >= 0 && ny >= 0 && ny < getmaxy() - 118) {
                pinx = nx; piny = ny; pinned = true; redraw = true;
                int c = getpixel(pinx, piny);
                int r, g, bl;
                vgaRgb(c, r, g, bl);
                printf("X=%d, Y=%d, RGB=(%d, %d, %d), COLOR=%s   <- copy this line\n",
                       pinx, piny, r, g, bl, colorName(c));
            }
        }
        if (redraw) {
            cleardevice();
            drawScene();
            if (cross && mx >= 0) drawCross(mx, my);
            drawReadout(getmaxx(), getmaxy(), mx, my);
            if (pinned) {
                setcolor(WHITE);
                circle(pinx, piny, 7);
                char b[48];
                sprintf(b, "pinned (%d,%d)", pinx, piny);
                outtextxy(pinx + 10, piny - 14, b);
            }
            redraw = false;
        }
        delay(10);
    }
    closegraph();
    return 0;
}
