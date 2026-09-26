/* 22_sprite_ride.cpp — the classic Turbo C++ sprite technique: grab a
 * rocket with getimage(), then animate it with COPY_PUT putimage() over a
 * starfield that is repainted every frame. Erasing uses cleardevice() +
 * opaque primitive redraws, which is the portable pattern on WinBGIM and
 * SDL_bgi alike (background "restore" bitmaps copied from the initial
 * transparent surface do not erase on SDL_bgi). Runs at most 12 seconds;
 * any key quits.
 */
#include <graphics.h>
#include <cstdlib>
#include <cstdio>
#include <ctime>

#define SW 46   /* sprite width  */
#define SH 60   /* sprite height */

int main ( )
{
#ifdef _WIN32
    initwindow(640, 480, "Sprite Animation - getimage/putimage");   /* WinBGIM: window title   */
#else
    initwindow(640, 480);              /* SDL_bgi: 2-arg form     */
#endif
    int mx = getmaxx(), my = getmaxy();

    /* draw the rocket once on a black cell, then grab it as a sprite */
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, 0, SW + 1, SH + 1);
    setfillstyle(SOLID_FILL, YELLOW);
    setcolor(YELLOW);
    fillellipse(SW / 2, 14, 10, 14);          /* nose   */
    setfillstyle(SOLID_FILL, LIGHTRED);
    bar(SW / 2 - 7, 14, SW / 2 + 7, 44);      /* body   */
    setfillstyle(SOLID_FILL, CYAN);
    bar(SW / 2 - 14, 40, SW / 2 - 7, 56);     /* fin L  */
    bar(SW / 2 + 7, 40, SW / 2 + 14, 56);     /* fin R  */
    setfillstyle(SOLID_FILL, WHITE);
    fillellipse(SW / 2, 26, 4, 4);            /* window */

    unsigned sz = imagesize(0, 0, SW + 1, SH + 1);
    void *sprite = malloc(sz);
    if (!sprite) { closegraph(); return 1; }
    getimage(0, 0, SW + 1, SH + 1, sprite);
    putimage(0, 0, sprite, COPY_PUT);         /* parked: sprite preview */

    /* starfield: precomputed so the frame loop can repaint it quickly */
    int sx[220], sy[220], sc[220];
    srand(42);
    int n = 0;
    while (n < 220) {
        int px = 2 + rand() % (mx - 4);
        int py = 2 + rand() % (my - 4);
        if (px < SW + 8 && py < SH + 8) continue;   /* keep the preview clean */
        sx[n] = px;
        sy[n] = py;
        sc[n] = (py % 3 == 0) ? WHITE : (py % 3 == 1) ? LIGHTGRAY : DARKGRAY;
        n++;
    }

    int x = 40, y = my / 2 - SH / 2;
    int dx = 5, dy = 3;
    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 12) {
        /* erase: cleardevice() fills with OPAQUE background black, which
         * erases properly on every BGI implementation */
        cleardevice();
        for (int i = 0; i < 220; i++) {
            putpixel(sx[i], sy[i], sc[i]);
        }
        putimage(0, 0, sprite, COPY_PUT);   /* parked: sprite preview */
        x += dx;
        y += dy;
        if (x < 4 || x > mx - SW - 4) { dx = -dx; x += 2 * dx; }
        if (y < 4 || y > my - SH - 4) { dy = -dy; y += 2 * dy; }
        putimage(x, y, sprite, COPY_PUT);   /* the flying rocket */
        delay(40);
    }
    free(sprite);
    closegraph();
    return 0;
}
