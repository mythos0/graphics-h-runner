/* 07_mandelbrot.cpp — Mandelbrot set renderer with putpixel().
 * Renders progressively row by row (nice visual even mid-render),
 * holds the final image, then self-closes.
 */
#include <graphics.h>
#include <ctime>

int main ( )
{
    /* smaller window keeps putpixel rendering snappy on every platform */
    initwindow(400, 300);

    const int W = 400, H = 300;
    const int MAXITER = 60;

    for (int py = 0; py < H; py++) {
        for (int px = 0; px < W; px++) {
            double x0 = (px - W * 0.62) * 3.0 / W;   /* interesting crop */
            double y0 = (py - H / 2.0) * 2.6 / H;

            double x = 0, y = 0;
            int iter = 0;
            while (x * x + y * y <= 4 && iter < MAXITER) {
                double xt = x * x - y * y + x0;
                y = 2 * x * y + y0;
                x = xt;
                iter++;
            }

            if (iter >= MAXITER) {
                putpixel(px, py, BLACK);
            } else {
                int c = 1 + (iter * 15) / MAXITER;   /* map to 16-color palette */
                putpixel(px, py, c);
            }
        }
        delay(2);                                    /* show progress row by row */
    }

    setcolor(WHITE);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    outtextxy(10, 8, (char*)"Mandelbrot - graphics.h");

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 8) {
        delay(40);
    }

    closegraph();
    return 0;
}
