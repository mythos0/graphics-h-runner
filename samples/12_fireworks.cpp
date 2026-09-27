/* 12_fireworks.cpp — a proper fireworks simulation over a night city:
 * a pool of shells, each with a gravity-driven rocket that leaves a
 * spark trail, then explodes near its apex into one of four burst
 * types — peony (sphere), ring, willow (long golden droop) and
 * crackle (white flicker finale). Particles fly with velocity,
 * air drag, gravity, shimmer and fade; the sky twinkles; the burst
 * lights up the skyline below.
 *
 * Portability: uses only classic BGI primitives (bar / line /
 * fillellipse) on the standard 16-color palette, so the SAME source
 * compiles and runs against WinBGIm on Windows and SDL_bgi on
 * Linux/macOS. NOTE: no putpixel() — per-frame putpixel right after
 * cleardevice() races with SDL_bgi's surface flip and can crash the
 * window; filled-shape calls like bar()/fillellipse() are safe.
 *
 * Runs until YOU quit it (ESC or Q). The automated test battery sets
 * BGI_AUTOEXIT_MS so runs still finish by themselves there; real
 * users never set it.
 */
#include <graphics.h>
#include <cstdlib>
#include <cmath>
#include <ctime>

/* ---------------- tunables ---------------- */
#define MAX_SHELLS 6        /* simultaneous shells in the sky        */
#define MAX_PARTS  84       /* particles per shell burst             */
#define FRAME_MS   30       /* ~33 fps                               */
#define ROCKET_G   0.18f    /* rocket gravity  (px per tick^2)       */
#define PART_G     0.12f    /* particle gravity                      */
#define DRAG       0.985f   /* air drag multiplier on velocity       */

/* burst types */
enum { PEONY = 0, RING = 1, WILLOW = 2, CRACKLE = 3, TYPE_COUNT = 4 };

struct Particle {
    float x, y;             /* position this tick                    */
    float ox, oy;           /* position last tick (streak tail)      */
    float vx, vy;           /* velocity                              */
    int   life;             /* ticks left before it burns out        */
    int   col;              /* BGI palette color                     */
    bool  alive;
};

struct Shell {
    bool  active;
    int   phase;            /* 0 = rocket rising, 1 = burst          */
    float x, y;             /* rocket position / burst center        */
    float ox, oy;           /* rocket previous position (trail)      */
    float vx, vy;           /* rocket velocity                       */
    int   type;             /* PEONY / RING / WILLOW / CRACKLE       */
    int   col;              /* burst color                           */
    int   flash;            /* sky flash ticks after the burst       */
    int   fuse;             /* ticks until this slot launches        */
    Particle p[MAX_PARTS];
};

static Shell shells[MAX_SHELLS] = {0};

/* the classic 16-color palette has plenty of firework hues */
static const int BURST_COLORS[] = {
    YELLOW, LIGHTRED, RED, LIGHTCYAN, CYAN,
    LIGHTMAGENTA, MAGENTA, LIGHTGREEN, GREEN, WHITE
};
static const int NCOLORS = (int)(sizeof(BURST_COLORS) / sizeof(BURST_COLORS[0]));

/* launch a rocket from the ground into an empty shell slot */
static void launchShell(Shell &s, int groundY, int maxX, int tick)
{
    s.active = true;
    s.phase  = 0;
    s.x = 60.0f + (float)(rand() % (maxX - 120));
    s.y = (float)groundY;
    s.ox = s.x; s.oy = s.y;
    s.vx = ((rand() % 100) - 50) / 40.0f;            /* slight lean   */
    s.vy = -(9.5f + (rand() % 30) / 10.0f);          /* 9.5 .. 12.4   */
    s.type = rand() % TYPE_COUNT;
    s.col  = BURST_COLORS[rand() % NCOLORS];
    s.flash = 0;
    s.fuse = 0;
    for (int i = 0; i < MAX_PARTS; i++) s.p[i].alive = false;
    (void)tick;
}

/* explode the shell at its current position */
static void burstShell(Shell &s)
{
    s.phase = 1;
    s.flash = 7;
    int n = MAX_PARTS;
    for (int i = 0; i < n; i++) {
        Particle &q = s.p[i];
        q.ox = q.x = s.x;
        q.oy = q.y = s.y;
        q.alive = true;
        int angleDeg;
        float speed;
        if (s.type == RING) {
            /* perfect ring: evenly spaced angles, one speed */
            angleDeg = (i * 360) / n + (rand() % 5 - 2);
            speed = 4.6f;
            q.life = 38 + rand() % 8;
        } else if (s.type == WILLOW) {
            /* willow: slow droop, long-lived golden strands */
            angleDeg = rand() % 360;
            speed = 1.6f + (rand() % 20) / 10.0f;
            q.life = 68 + rand() % 18;
            q.col = YELLOW;                          /* gold rain     */
        } else if (s.type == CRACKLE) {
            angleDeg = rand() % 360;
            speed = 2.2f + (rand() % 40) / 10.0f;
            q.life = 44 + rand() % 10;
        } else {                                     /* PEONY         */
            angleDeg = rand() % 360;
            speed = 2.4f + (rand() % 32) / 10.0f;
            q.life = 36 + rand() % 14;
        }
        float a = angleDeg * 3.14159265f / 180.0f;
        q.vx = speed * cosf(a);
        q.vy = speed * sinf(a);
        q.col = (s.type == WILLOW) ? YELLOW : s.col;
    }
}

static void stepShell(Shell &s, int maxX, int maxy, int groundY, int tick)
{
    if (!s.active) return;

    if (s.phase == 0) {                              /* rocket rising */
        s.ox = s.x; s.oy = s.y;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += ROCKET_G;
        /* trail sparks fall behind the rocket */
        if (rand() % 2 == 0) {
            int tx = (int)s.x + (rand() % 5 - 2);
            int ty = (int)s.y + 6 + rand() % 6;
            if (tx > 0 && tx < maxX - 2 && ty > 0 && ty < maxy - 2) {
                setcolor(DARKGRAY);
                setfillstyle(SOLID_FILL, DARKGRAY);
                bar(tx, ty, tx + 1, ty + 1);
            }
        }
        /* burst near apex: rocket slowed down enough */
        if (s.vy >= -1.8f || s.y <= 40) burstShell(s);
        return;
    }

    /* phase 1: particles fly */
    if (s.flash > 0) s.flash--;
    for (int i = 0; i < MAX_PARTS; i++) {
        Particle &q = s.p[i];
        if (!q.alive) continue;
        q.ox = q.x; q.oy = q.y;
        q.vx *= DRAG;
        q.vy = q.vy * DRAG + ((s.type == WILLOW) ? 0.06f : PART_G);
        q.x += q.vx;
        q.y += q.vy;
        q.life--;
        if (q.life <= 0 || q.x < -4 || q.x > maxX + 4 || q.y > groundY + 20) {
            q.alive = false;
            continue;
        }
        /* pick the draw color: shimmer, then fade to embers */
        int c = q.col;
        if (s.type == CRACKLE && q.life < 12) {
            c = ((tick + i) % 2 == 0) ? WHITE : q.col;   /* flicker  */
        } else if (q.life < 10) {
            c = DARKGRAY;                                /* ember    */
        } else if ((tick + i) % 7 == 0) {
            c = WHITE;                                   /* shimmer  */
        }
        /* motion streak from the previous position = the "tail" */
        setcolor(c);
        line((int)q.ox, (int)q.oy, (int)q.x, (int)q.y);
        if (q.life > 10) {
            setfillstyle(SOLID_FILL, c);
            fillellipse((int)q.x, (int)q.y, 1, 1);
        }
    }
}

static void drawShellRocket(Shell &s)
{
    if (!s.active || s.phase != 0) return;
    int x = (int)s.x, y = (int)s.y;
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, YELLOW);
    bar(x - 1, y - 4, x + 1, y + 2);                 /* bright head   */
    setcolor(LIGHTRED);
    line(x, y + 3, x, y + 9);                        /* exhaust       */
}

static void drawShellFlash(Shell &s, int groundY)
{
    if (!s.active || s.phase != 1 || s.flash <= 0) return;
    int r = (7 - s.flash) * 3 + 6;
    setcolor(WHITE);
    setfillstyle(SOLID_FILL, YELLOW);
    fillellipse((int)s.x, (int)s.y, r / 2, r / 2);
    /* the burst lights up the skyline below it */
    setcolor(LIGHTBLUE);
    setfillstyle(SOLID_FILL, LIGHTBLUE);
    fillellipse((int)s.x, groundY - 6, 26, 4);
}

int main()
{
    initwindow(640, 480);
    setbkcolor(BLACK);
    srand((unsigned)time(NULL));

    const int maxX = getmaxx();
    const int maxy = getmaxy();
    const int groundY = maxy - 60;

    long autoexitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS"); if (ae) autoexitMs = atol(ae); }
    time_t start = time(NULL);

    long tick = 0;
    bool running = true;
    while (running) {
        if (autoexitMs > 0 && time(NULL) - start >= autoexitMs / 1000) break;
        if (kbhit()) {
            int quitKey = getch();
            if (quitKey == 27 || quitKey == 'q' || quitKey == 'Q') break;
        }

        cleardevice();

        /* --- twinkling starfield (deterministic scatter) --- */
        for (int i = 0; i < 70; i++) {
            int sx = (i * 97 + 13) % maxX;
            int sy = (i * 53 + 7) % (groundY - 140);
            int c = ((tick / 6 + i) % 5 == 0) ? WHITE : DARKGRAY;
            setfillstyle(SOLID_FILL, c);
            bar(sx, sy, sx + 1, sy + 1);
        }

        /* --- moon with craters --- */
        setcolor(LIGHTGRAY);
        setfillstyle(SOLID_FILL, LIGHTGRAY);
        fillellipse(maxX - 70, 62, 22, 22);
        setfillstyle(SOLID_FILL, DARKGRAY);
        fillellipse(maxX - 76, 56, 4, 4);            /* craters       */
        fillellipse(maxX - 63, 68, 3, 3);
        fillellipse(maxX - 70, 72, 2, 2);

        /* --- city skyline with lit windows --- */
        for (int b = 0; b < maxX; b += 42) {
            int h = 40 + ((b * 7) % 55);
            setcolor(BLUE);
            setfillstyle(SOLID_FILL, BLUE);
            bar(b, groundY - h, b + 38, groundY);
            setcolor(YELLOW);
            setfillstyle(SOLID_FILL, YELLOW);    /* bar() fills with the FILL style */
            for (int w = 0; w < 4; w++)
                if (((b / 42) * 4 + w + (int)(tick / 40)) % 5 != 0)
                    bar(b + 5 + (w % 2) * 16, groundY - h + 8 + (w / 2) * 16,
                        b + 12 + (w % 2) * 16, groundY - h + 15 + (w / 2) * 16);
        }
        setcolor(LIGHTGRAY);
        line(0, groundY, maxX, groundY);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(LIGHTGRAY);
        outtextxy(12, 8, (char*)"graphics.h fireworks - ESC or Q to quit");

        /* --- stagger the launches, keep a few shells in the air --- */
        int activeCount = 0;
        for (int i = 0; i < MAX_SHELLS; i++) if (shells[i].active) activeCount++;
        if (activeCount < 4 && tick % 26 == 0) {
            for (int i = 0; i < MAX_SHELLS; i++) {
                if (!shells[i].active) { launchShell(shells[i], groundY, maxX, tick); break; }
            }
        }

        /* --- physics + drawing --- */
        for (int i = 0; i < MAX_SHELLS; i++) {
            stepShell(shells[i], maxX, maxy, groundY, (int)tick);
            drawShellRocket(shells[i]);
        }
        for (int i = 0; i < MAX_SHELLS; i++) drawShellFlash(shells[i], groundY);

        delay(FRAME_MS);
        tick++;
    }
    closegraph();
    return 0;
}
