/* 09_keyboard_paddle.cpp — mini brick-breaker: the ball bounces, you keep
 * it alive with the LEFT / RIGHT arrow keys, and colored bricks at the top
 * disappear when hit. Headless-friendly: without input the paddle stays
 * put and the ball simply bounces on the floor (demo mode).
 * Runs at most 12 seconds, ESC quits.
 */
#include <graphics.h>
#include <cstdio>
#include <ctime>

#define BRICK_COLS 10
#define BRICK_ROWS 4

static int bricks[BRICK_ROWS][BRICK_COLS];
static const int brickColors[BRICK_ROWS] = { RED, LIGHTRED, YELLOW, GREEN };

static void drawBricks (int left, int top, int bw, int bh)
{
    for (int r = 0; r < BRICK_ROWS; r++) {
        for (int c = 0; c < BRICK_COLS; c++) {
            if (bricks[r][c]) {
                setcolor(brickColors[r]);
                setfillstyle(SOLID_FILL, brickColors[r]);
                bar(left + c * bw, top + r * bh,
                    left + c * bw + bw - 2, top + r * bh + bh - 2);
            }
        }
    }
}

int main ( )
{
    initwindow(640, 480);

    int maxx = getmaxx(), maxy = getmaxy();
    int paddleW = 110, paddleH = 14;
    int px = (maxx - paddleW) / 2, py = maxy - 40;

    int bx = maxx / 2, by = 200, dx = 5, dy = 4, r = 12;
    int score = 0;
    int brickLeft = 12, brickTop = 36;
    int bw = (maxx - 2 * brickLeft) / BRICK_COLS;
    int bh = 18;

    for (int row = 0; row < BRICK_ROWS; row++) {
        for (int col = 0; col < BRICK_COLS; col++) {
            bricks[row][col] = 1;
        }
    }

    time_t start = time(NULL);
    while (!kbhit() && time(NULL) - start < 12) {
        cleardevice();

        setcolor(WHITE);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(10, 10, (char*)"Arrow keys: move paddle   ESC: quit");

        char scoreText[32];
        sprintf(scoreText, "score: %d", score);
        outtextxy(520, 10, scoreText);

        drawBricks(brickLeft, brickTop, bw, bh);

        /* paddle */
        setcolor(YELLOW);
        setfillstyle(SOLID_FILL, YELLOW);
        bar(px, py, px + paddleW, py + paddleH);

        /* ball */
        setcolor(CYAN);
        setfillstyle(SOLID_FILL, CYAN);
        fillellipse(bx, by, r, r);

        delay(20);

        bx += dx;
        by += dy;
        if (bx < r || bx > maxx - r) {
            dx = -dx;
        }
        if (by < r + 30) {
            dy = -dy;
        }

        /* brick collisions (grid lookup) */
        int col = (bx - brickLeft) / bw;
        int row = (by - brickTop) / bh;
        if (row >= 0 && row < BRICK_ROWS && col >= 0 && col < BRICK_COLS && bricks[row][col]) {
            bricks[row][col] = 0;
            score += 10;
            dy = -dy;
        }

        /* bounce on the paddle */
        if (by > py - r && by < py + paddleH + r && bx > px - r && bx < px + paddleW + r) {
            dy = -dy;
        }
        /* bounce on the floor (demo mode) */
        if (by > maxy - r) {
            dy = -dy;
        }

        /* keyboard (extended codes arrive as two getch calls) */
        while (kbhit()) {
            int key = getch();
            if (key == 0 || key == 224) {
                key = getch();
                if (key == 75 && px > 0) {
                    px -= 30;
                }
                if (key == 77 && px < maxx - paddleW) {
                    px += 30;
                }
            } else if (key == 27) {
                closegraph();
                return 0;
            }
        }
    }

    closegraph();
    return 0;
}
