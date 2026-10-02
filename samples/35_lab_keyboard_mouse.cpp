/* 35_lab_keyboard_mouse.cpp — input: every interactive program you will
 * ever write is built from these four calls:
 *
 *   kbhit()                 did the user press a key?
 *   getch()                 give me that key (arrows arrive as TWO calls:
 *                           a 0/224 prefix, then 72=up 80=down 75=left 77=right)
 *   ismouseclick(kind)      did a mouse event of this kind happen?
 *   mousex(), mousey()      where is the pointer?
 *
 * Demo: arrows/WASD move a crosshair, holding the RIGHT mouse button
 * paints freehand, left-click drops a dot, ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>

using namespace std;

/* one place that reads a key and folds the two-call arrow protocol
 * into a single value - copy this helper into your own programs */
static int readKey()
{
    int key = getch();
    if (key == 0 || key == 224) {                /* extended key prefix */
        key = getch();                           /* the real arrow code  */
        switch (key) {
            case 72: return 1;                   /* up    */
            case 80: return 2;                   /* down  */
            case 75: return 3;                   /* left  */
            case 77: return 4;                   /* right */
        }
        return 0;
    }
    return key;                                  /* normal character     */
}

int main()
{
    cout << "=== Lab 4 - Keyboard & Mouse ===" << endl;
    cout << "Arrows / WASD: move the crosshair. Hold the RIGHT mouse" << endl;
    cout << "button: paint. Left-click: dot. ESC or Q: quit." << endl;

#ifdef _WIN32
    initwindow(800, 600, "Lab 4 - Keyboard & Mouse");
#else
    initwindow(800, 600);
#endif

    /* welcome artwork: strokes a mouse user could paint, so the screen
     * teaches even before the first input arrives */
    const int STROKE_COLORS[4] = { LIGHTGREEN, LIGHTCYAN, LIGHTRED, YELLOW };
    for (int s = 0; s < 4; s++) {
        setcolor(STROKE_COLORS[s]);
        int px = -1, py = -1;
        for (int x = 0; x <= 240; x += 4) {          /* a hand-drawn wave */
            int y = (int)(150 + s * 70 + 18 * sin(x * 0.035 + s * 1.1));
            if (px >= 0) { line(px + 60, py, x + 60, y); circle(x + 60, y, 2); }
            px = x; py = y;
        }
    }
    setfillstyle(SOLID_FILL, YELLOW);
    for (int i = 0; i < 12; i++) {                   /* left-click dots   */
        int dx = 420 + (i % 6) * 55, dy = 140 + (i / 6) * 90;
        bar(dx - 3, dy - 3, dx + 3, dy + 3);
    }
    setcolor(DARKGRAY);
    outtextxy(60, 88, (char*)"demo strokes + dots - painted with these very calls. Now make your own:");

    int cx = 400, cy = 300;                      /* crosshair position  */
    bool painting = false;                       /* pen down?           */
    int px = -1, py = -1;                        /* last paint point    */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);
    int dots = 0;

    for (;;) {
        /* ---- keyboard: poll, never block ---- */
        while (kbhit()) {
            int k = readKey();
            if (k == 27 || k == 'q' || k == 'Q') {
                cout << "Quit. Painted " << dots << " left-click dots." << endl;
                closegraph();
                return 0;
            }
            switch (k) {
                case 1: case 'w': case 'W': cy -= 10; break;
                case 2: case 's': case 'S': cy += 10; break;
                case 3: case 'a': case 'A': cx -= 10; break;
                case 4: case 'd': case 'D': cx += 10; break;
            }
            if (cx < 0) cx = 0;   if (cx > getmaxx()) cx = getmaxx();
            if (cy < 0) cy = 0;   if (cy > getmaxy()) cy = getmaxy();
        }

        /* ---- mouse: drain every queued event, react to each kind ---- */
        while (ismouseclick(WM_RBUTTONDOWN)) {   /* pen down   */
            clearmouseclick(WM_RBUTTONDOWN);
            painting = true;  px = -1;  py = -1;
        }
        while (ismouseclick(WM_RBUTTONUP)) {     /* pen up     */
            clearmouseclick(WM_RBUTTONUP);
            painting = false;
        }
        while (ismouseclick(WM_LBUTTONDOWN)) {   /* stamp a dot */
            clearmouseclick(WM_LBUTTONDOWN);
            setfillstyle(SOLID_FILL, YELLOW);
            bar(mousex() - 3, mousey() - 3, mousex() + 3, mousey() + 3);
            dots++;
        }
        if (painting) {                          /* freehand stroke    */
            int mx = mousex(), my = mousey();
            if (px >= 0) { setcolor(LIGHTGREEN); line(px, py, mx, my); }
            px = mx;  py = my;
        }

        /* ---- redraw the crosshair (erase, draw, erase...) ---- */
        static int ox = -1, oy = -1;
        if (ox >= 0) {
            setcolor(BLACK);
            line(ox - 14, oy, ox + 14, oy); line(ox, oy - 14, ox, oy + 14);
            circle(ox, oy, 9);
        }
        setcolor(LIGHTCYAN);
        line(cx - 14, cy, cx + 14, cy); line(cx, cy - 14, cx, cy + 14);
        circle(cx, cy, 9);
        ox = cx; oy = cy;

        setcolor(WHITE);
        outtextxy(8, 8, (char*)"arrows/WASD = move | hold RIGHT button = paint | left click = dot | ESC/Q = quit");

        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
        delay(12);
    }
    closegraph();
    return 0;
}
