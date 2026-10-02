/* 36_lab_animation_loop.cpp — THE animation loop: the skeleton behind
 * every game and moving scene in this extension. A ball flies across
 * the screen while the terminal narrates the four moves every frame:
 *
 *   1. erase   (cleardevice, or paint the background back)
 *   2. update  (physics: position += velocity)
 *   3. draw    (the whole scene, from scratch)
 *   4. delay   (frame pacing - this sets your FPS)
 *
 * Ghost trails show where previous frames were. ESC (or Q) quits.
 */
#include <graphics.h>
#include <iostream>
#include <cstdlib>
#include <cmath>

using namespace std;

int main()
{
    cout << "=== Lab 5 - Animation Loop ===" << endl;
    cout << "Every frame: ERASE -> UPDATE -> DRAW -> DELAY." << endl;
    cout << "delay(ms) sets the frame budget: 30ms ~ 33 FPS." << endl;
    cout << "For flicker-free production loops use double buffering" << endl;
    cout << "(draw off-screen, then swapbuffers() - see the cheat sheet)." << endl;

#ifdef _WIN32
    initwindow(800, 600, "Lab 5 - Animation Loop");
#else
    initwindow(800, 600);
#endif

    float x = 100, y = 150;                      /* position           */
    float vx = 4.5f, vy = 3.2f;                  /* velocity per frame */
    const int R = 18;

    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t begun = time(NULL);
    int frames = 0;

    while (true) {
        /* 1. ERASE - wipe the previous frame */
        cleardevice();

        /* 2. UPDATE - the physics tick */
        x += vx;
        y += vy;
        if (x < R || x > getmaxx() - R) { vx = -vx; x += vx; }
        if (y < R + 30 || y > getmaxy() - R) { vy = -vy; y += vy; }

        /* 3. DRAW - the scene for THIS frame */
        setcolor(WHITE);
        outtextxy(8, 8, (char*)"ERASE -> UPDATE -> DRAW -> DELAY, every frame | ESC/Q quits");
        /* ghost trail: dimmer dots at earlier positions */
        for (int t = 1; t <= 6; t++) {
            float f = t * 2.2f;
            putpixel((int)(x - vx * f), (int)(y - vy * f), DARKGRAY);
        }
        setfillstyle(SOLID_FILL, RED);
        setcolor(YELLOW);
        fillellipse((int)x, (int)y, R, R);
        /* a floor line for the ball to bounce above */
        setcolor(GREEN);
        line(0, getmaxy() - R, getmaxx(), getmaxy() - R);

        /* 4. DELAY - pace the loop */
        delay(30);
        frames++;

        if (kbhit()) { int k = getch(); if (k == 27 || k == 'q' || k == 'Q') break; }
        if (autoexitMs > 0 && (long)(time(NULL) - begun) * 1000 >= autoexitMs) break;
    }

    cout << "Ran " << frames << " frames. Notice: NO memory of the past -" << endl;
    cout << "each frame is drawn from nothing. State lives in YOUR" << endl;
    cout << "variables (x, y, vx, vy), never on the screen." << endl;
    closegraph();
    return 0;
}
