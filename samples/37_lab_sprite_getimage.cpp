/* 37_lab_sprite_getimage.cpp — sprites: moving a picture without
 * destroying the background. The trick from every 90s game:
 *
 *   imagesize()  how many bytes does a rectangle of screen take?
 *   malloc()     reserve that memory (yes, plain C memory)
 *   getimage()   copy the screen rectangle INTO your buffer
 *   putimage()   copy the buffer back to any position
 *
 * A UFO (drawn once into memory) flies over a starfield. The starfield
 * itself is saved once and stamped back each frame - no cleardevice,
 * no flicker, and the stars survive the flight. ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <ctime>
#include <cmath>

using namespace std;

static const int SW = 90, SH = 46;               /* UFO size */

int main()
{
    cout << "=== Lab 6 - Sprites (getimage/putimage) ===" << endl;
    cout << "getimage() copies a screen rectangle into memory;" << endl;
    cout << "putimage() stamps it anywhere. Save background, save" << endl;
    cout << "sprite, then each frame: background back, sprite on top." << endl;

#ifdef _WIN32
    initwindow(800, 500, "Lab 6 - Sprites");
#else
    initwindow(800, 500);
#endif

    /* 1. the BACKGROUND: a starfield, then saved to memory */
    for (int i = 0; i < 220; i++)
        putpixel(rand() % 800, rand() % 500,
                 (rand() % 3 == 0) ? WHITE : (rand() % 2 ? LIGHTGRAY : DARKGRAY));
    setcolor(GREEN);
    line(0, 470, 800, 470);                      /* a ground line  */
    rectangle(60, 430, 140, 470);                /* a little house */
    setfillstyle(SOLID_FILL, BROWN);
    bar(70, 440, 130, 468);

    unsigned bgSize = imagesize(0, 0, 800 - 1, 500 - 1);
    void* background = malloc(bgSize);
    getimage(0, 0, 800 - 1, 500 - 1, background);

    /* 2. the SPRITE: draw a UFO off to the side, then grab it */
    int sx = 5, sy = 5;                          /* parking corner  */
    setfillstyle(SOLID_FILL, LIGHTCYAN);
    fillellipse(sx + SW / 2, sy + 28, SW / 2 - 6, 12);   /* dome    */
    setfillstyle(SOLID_FILL, LIGHTGRAY);
    bar(sx, sy + 28, sx + SW, sy + SH - 6);              /* saucer  */
    for (int l = 0; l < 5; l++) {                        /* lights  */
        setfillstyle(SOLID_FILL, YELLOW);
        bar(sx + 10 + l * 16, sy + 32, sx + 18 + l * 16, sy + 38);
    }
    unsigned spSize = imagesize(sx, sy, sx + SW, sy + SH);
    void* ufo = malloc(spSize);
    getimage(sx, sy, sx + SW, sy + SH, ufo);

    /* erase the parking spot: one clean full repaint of the background */
    putimage(0, 0, background, COPY_PUT);

    cout << "Sprite is " << spSize << " bytes; background is " << bgSize
         << " bytes of RAM." << endl;

    /* 3. the FLIGHT: sine wave over the starfield */
    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);
    int x = -SW;
    while (true) {
        if (x > 800) x = -SW;                    /* loop the flight */
        int y = (int)(200 + 60 * sin(x * 0.02));
        putimage(0, 0, background, COPY_PUT);    /* stars come back */
        putimage(x, y, ufo, COPY_PUT);           /* sprite on top   */
        delay(35);
        x += 6;
        if (kbhit()) { int k = getch(); if (k == 27 || k == 'q' || k == 'Q') break; }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
    }

    free(ufo); free(background);
    cout << "Freed the sprite buffers - malloc/free is your job now." << endl;
    closegraph();
    return 0;
}
