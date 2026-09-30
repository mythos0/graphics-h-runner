/* ==========================================================================
 * 01_snake_game.cpp — SNAKE, the graphics.h game showpiece
 * ==========================================================================
 * A complete, polished Snake game written with nothing but classic
 * graphics.h primitives — the single example program shipped with the
 * graphics.h Runner extension.
 *
 *   - Play with the ARROW KEYS or W A S D (both work everywhere)
 *   - Three difficulties (Easy wraps around the walls, Medium / Hard do
 *     not), timed yellow bonus apples worth five red apples
 *   - Level ups every five apples: the snake speeds up
 *   - Pause (P / Space), help screen, high-score table with statistics
 *   - A tiny file "database" (snake_scores.db, right next to the program)
 *     that keeps your name, the top-5 scores, games played and apples
 *     eaten — human-readable, saved after every game
 *
 * Everything here is beginner-readable on purpose: the file is organised
 * as a sequence of short commented sections you can study one at a time.
 *
 * PORTABILITY NOTES (the two things that differ between platforms):
 *   1. Extended keys: WinBGIm (Windows) delivers arrow keys as TWO getch()
 *      calls — a 0 or 224 prefix, then 72 / 80 / 75 / 77. SDL_bgi (Linux /
 *      macOS) returns the whole key in ONE call as an SDL keycode (the
 *      big 10737419xx numbers). readKey() below normalises both.
 *   2. Window close: SDL_bgi's getch() returns the QUIT constant when the
 *      window is closed; the #ifdef QUIT checks exit the game cleanly.
 *
 * Headless test batteries set BGI_AUTOEXIT_MS: the game then plays
 * itself with a small demo AI and exits cleanly (no scores are saved).
 * ==========================================================================
 */
#include <graphics.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cctype>
#include <ctime>

/* ==========================================================================
 * SECTION 1 — board geometry and tuning constants
 * ========================================================================== */

static const int WIN_W = 800;          /* window size in pixels            */
static const int WIN_H = 600;

static const int CELL   = 24;          /* one grid cell, pixels            */
static const int COLS   = 32;          /* playfield = COLS x ROWS cells    */
static const int ROWS   = 21;
static const int ARENA_X = 16;         /* top-left pixel of the playfield  */
static const int ARENA_Y = 72;
static const int ARENA_W = COLS * CELL;/* 768                              */
static const int ARENA_H = ROWS * CELL;/* 504                              */
static const int HUD_H   = 64;         /* score bar above the playfield    */

static const int MAX_LEN  = COLS * ROWS + 1;   /* theoretical snake limit  */
static const int NAME_LEN = 10;        /* high-score name length           */
static const char* DB_FILENAME = "snake_scores.db";

/* Difficulty table — indexed by the DIFF_* constants below. */
enum { DIFF_EASY = 0, DIFF_MEDIUM = 1, DIFF_HARD = 2, DIFF_COUNT = 3 };

struct Difficulty {
    const char* label;      /* shown in the menu                         */
    int  startDelayMs;      /* milliseconds per tick at level 1          */
    int  minDelayMs;        /* fastest the game ever gets                */
    int  stepMs;            /* delay removed on every level up           */
    int  pointsPerApple;    /* score for one red apple                   */
    bool wrapWalls;         /* true: out one side, in on the other       */
    int  startLength;       /* snake length at spawn                     */
};

static const Difficulty DIFFS[DIFF_COUNT] = {
    { "EASY",   150,  95, 4, 10, true,  4 },
    { "MEDIUM", 105,  60, 5, 15, false, 4 },
    { "HARD",    75,  45, 6, 25, false, 5 }
};

static const char* DIFF_HINTS[DIFF_COUNT] = {
    "Easy - the snake wraps around the walls",
    "Medium - walls are deadly",
    "Hard - walls are deadly, and fast"
};

/* ==========================================================================
 * SECTION 2 — platform-neutral key handling
 * --------------------------------------------------------------------------
 * readKey() waits for one key press and returns one of the K_* codes
 * below, no matter which graphics library is underneath. Letters land in
 * readKeyLetter (always lowercase), digits in the same variable.
 * ========================================================================== */

enum {
    K_NONE = 0, K_UP, K_DOWN, K_LEFT, K_RIGHT,
    K_ENTER, K_ESC, K_SPACE, K_BACKSPACE, K_QUIT,
    K_LETTER, K_DIGIT
};

static int readKeyLetter = 0;   /* set when readKey() returns K_LETTER/DIGIT */

static int readKey ( )
{
    int key = getch();

#ifdef QUIT
    /* SDL_bgi: the user closed the graphics window */
    if (key == QUIT) { return K_QUIT; }
#endif

    if (key == 0 || key == 224) {
        /* WinBGIm extended key: the real code follows in a second call */
        key = getch();
        switch (key) {
            case 72: return K_UP;
            case 80: return K_DOWN;
            case 75: return K_LEFT;
            case 77: return K_RIGHT;
        }
        return K_NONE;
    }

    switch (key) {
        /* SDL_bgi (SDL2 keycodes) — one call, whole key at once */
        case 1073741906: return K_UP;      /* SDLK_UP    = 0x40000052 */
        case 1073741905: return K_DOWN;    /* SDLK_DOWN  = 0x40000051 */
        case 1073741904: return K_LEFT;    /* SDLK_LEFT  = 0x40000050 */
        case 1073741903: return K_RIGHT;   /* SDLK_RIGHT = 0x4000004F */
        /* older SDL 1.2-style builds */
        case 273: return K_UP;
        case 274: return K_DOWN;
        case 276: return K_LEFT;
        case 275: return K_RIGHT;
        /* shared ASCII codes */
        case 13:  return K_ENTER;          /* Enter      */
        case 27:  return K_ESC;            /* Esc        */
        case 32:  return K_SPACE;          /* Space      */
        case 8:   return K_BACKSPACE;      /* Backspace  */
    }

    if (key >= 'A' && key <= 'Z') { key = tolower(key); }
    if (key >= 'a' && key <= 'z') { readKeyLetter = key; return K_LETTER; }
    if (key >= '0' && key <= '9') { readKeyLetter = key; return K_DIGIT; }
    return K_NONE;
}

/* Polled variant used during play: same codes, K_NONE when no key waits. */
static int pollKey ( )
{
    if (!kbhit()) { return K_NONE; }
    return readKey();
}

/* ==========================================================================
 * SECTION 3 — the tiny "database" (snake_scores.db)
 * --------------------------------------------------------------------------
 * A plain text file next to the program:
 *
 *     # graphics.h Snake Game save data
 *     version=1
 *     name=PLAYER
 *     games=3
 *     food=27
 *     rank=ANN|1250|7|2026-09-29 14:03
 *     ...up to five rank= lines, best first
 *
 * loadDatabase() tolerates a missing or corrupted file (you get clean
 * defaults); saveDatabase() writes a temp file first and renames it, so
 * a crash halfway through can never destroy the old table.
 * ========================================================================== */

struct ScoreRow {
    char name[NAME_LEN + 1];
    int  score;
    int  level;
    char when[20];        /* "YYYY-MM-DD HH:MM" */
};

struct GameDB {
    char name[NAME_LEN + 1];  /* last name used, offered again next time */
    int  gamesPlayed;
    int  applesEaten;
    int  count;               /* rows actually stored (0..5) */
    ScoreRow top[5];
};

/* Where is the database? Next to the executable when possible (that is
 * the folder VS Code runs the program from), otherwise the current
 * directory. The first writable candidate wins. */
static char dbPath[1024] = "";

static void resolveDbPath ( const char* argv0 )
{
    dbPath[0] = '\0';
    const char* dir = ".";

    if (argv0 && argv0[0]) {
        static char exeDir[1024];
        strncpy(exeDir, argv0, sizeof(exeDir) - 1);
        exeDir[sizeof(exeDir) - 1] = '\0';
        char* slash = strrchr(exeDir, '/');
        char* bslash = strrchr(exeDir, '\\');
        char* last = (slash && bslash) ? (slash > bslash ? slash : bslash)
                   : (slash ? slash : bslash);
        if (last && last != exeDir) {
            *last = '\0';                     /* exeDir = folder of the exe */
            dir = exeDir;
        }
    }

    static char probe[1280];
    snprintf(probe, sizeof(probe), "%s/%s", dir, DB_FILENAME);
    dbPath[0] = '\0';

    /* is that folder writable? (cheap append-open test; an empty probe
     * file created on the very first run is cleaned up again — the real
     * database is written after the first finished game) */
    FILE* t = fopen(probe, "rb");
    bool existed = (t != NULL);
    if (t) { fclose(t); }

    FILE* f = fopen(probe, "ab");
    if (f) { fclose(f); }
    if (!existed) { remove(probe); }
    strncpy(dbPath, probe, sizeof(dbPath) - 1);
    dbPath[sizeof(dbPath) - 1] = '\0';
}

static void parseRankLine ( GameDB& db, const char* line )
{
    /* rank=NAME|SCORE|LEVEL|WHEN */
    ScoreRow row;
    memset(&row, 0, sizeof(row));
    const char* p = strchr(line, '|');
    if (!p) { return; }
    size_t n = (size_t)(p - line);
    if (n == 0 || n > (size_t)NAME_LEN) { return; }
    memcpy(row.name, line, n);
    row.name[n] = '\0';
    row.score = atoi(p + 1);
    const char* p2 = strchr(p + 1, '|');
    if (!p2) { return; }
    row.level = atoi(p2 + 1);
    const char* p3 = strchr(p2 + 1, '|');
    if (!p3) { return; }
    strncpy(row.when, p3 + 1, sizeof(row.when) - 1);
    row.when[sizeof(row.when) - 1] = '\0';
    if (row.score <= 0) { return; }
    if (db.count < 5) { db.top[db.count++] = row; }
}

static void loadDatabase ( GameDB& db )
{
    memset(&db, 0, sizeof(db));
    strncpy(db.name, "PLAYER", NAME_LEN);
    db.name[NAME_LEN] = '\0';

    FILE* f = fopen(dbPath, "r");
    if (!f) { return; }                       /* first run: clean defaults */

    char line[512];
    while (fgets(line, sizeof(line), f)) {
        for (char* c = line; *c; c++) { if (*c == '\n' || *c == '\r') { *c = '\0'; } }
        if (strncmp(line, "name=", 5) == 0) {
            strncpy(db.name, line + 5, NAME_LEN);
            db.name[NAME_LEN] = '\0';
        } else if (strncmp(line, "games=", 6) == 0) {
            db.gamesPlayed = atoi(line + 6);
            if (db.gamesPlayed < 0) { db.gamesPlayed = 0; }
        } else if (strncmp(line, "food=", 5) == 0) {
            db.applesEaten = atoi(line + 5);
            if (db.applesEaten < 0) { db.applesEaten = 0; }
        } else if (strncmp(line, "rank=", 5) == 0) {
            parseRankLine(db, line + 5);
        }
        /* unknown lines (comments, future fields) are ignored */
    }
    fclose(f);

    /* keep the table sorted, best first */
    for (int i = 1; i < db.count; i++) {
        ScoreRow t = db.top[i];
        int j = i - 1;
        while (j >= 0 && db.top[j].score < t.score) { db.top[j + 1] = db.top[j]; j--; }
        db.top[j + 1] = t;
    }
    if (db.count > 5) { db.count = 5; }
}

static void saveDatabase ( const GameDB& db )
{
    if (!dbPath[0]) { return; }
    static char tmp[1280];
    snprintf(tmp, sizeof(tmp), "%s.tmp", dbPath);

    FILE* f = fopen(tmp, "w");
    if (!f) { return; }                       /* read-only folder: skip quietly */

    fprintf(f, "# graphics.h Snake Game save data\n");
    fprintf(f, "version=1\n");
    fprintf(f, "name=%s\n", db.name);
    fprintf(f, "games=%d\n", db.gamesPlayed);
    fprintf(f, "food=%d\n", db.applesEaten);
    for (int i = 0; i < db.count && i < 5; i++) {
        fprintf(f, "rank=%s|%d|%d|%s\n", db.top[i].name, db.top[i].score,
                db.top[i].level, db.top[i].when);
    }
    fclose(f);

    remove(dbPath);                           /* Windows needs this first */
    rename(tmp, dbPath);                      /* atomic-ish swap          */
}

static int highScore ( const GameDB& db )
{
    return db.count > 0 ? db.top[0].score : 0;
}

/* Does a score reach the top 5? Returns the rank (1..5) or 0. */
static int rankFor ( const GameDB& db, int score )
{
    if (score <= 0) { return 0; }
    for (int i = 0; i < 5; i++) {
        if (i >= db.count || score > db.top[i].score) { return i + 1; }
    }
    return 0;
}

static void insertScore ( GameDB& db, const char* name, int score, int level )
{
    ScoreRow row;
    memset(&row, 0, sizeof(row));
    strncpy(row.name, name, NAME_LEN);
    row.name[NAME_LEN] = '\0';
    row.score = score;
    row.level = level;

    time_t now = time(NULL);
    struct tm* lt = localtime(&now);
    if (lt) { strftime(row.when, sizeof(row.when), "%Y-%m-%d %H:%M", lt); }
    else      { strncpy(row.when, "-", sizeof(row.when) - 1); }

    int at = rankFor(db, score) - 1;
    if (at < 0) { return; }
    if (db.count < 5) { db.count++; }
    for (int i = db.count - 1; i > at; i--) { db.top[i] = db.top[i - 1]; }
    db.top[at] = row;
}

/* ==========================================================================
 * SECTION 4 — game state
 * ========================================================================== */

struct Game {
    int  bodyX[MAX_LEN];      /* body[0] is the head                     */
    int  bodyY[MAX_LEN];
    int  len;
    int  dirX, dirY;          /* current direction                       */
    int  nextX, nextY;        /* direction queued by the keyboard        */
    int  foodX, foodY;        /* red apple                               */
    bool bonusOn;             /* timed yellow bonus apple                */
    int  bonusX, bonusY;
    int  bonusTimer;          /* ticks left before the bonus expires     */
    int  growPending;         /* segments still to be added              */
    int  score, level, apples;
    int  tickDelay;           /* current milliseconds per tick           */
    bool paused;
    bool alive;
    int  diff;                /* DIFF_EASY / DIFF_MEDIUM / DIFF_HARD     */
};

static bool demoMode = false;      /* BGI_AUTOEXIT_MS battery mode        */
static long demoExitMs = 0;
static time_t demoStart = 0;

static bool cellFree ( const Game& g, int cx, int cy )
{
    if (cx == g.foodX && cy == g.foodY) { return false; }
    if (g.bonusOn && cx == g.bonusX && cy == g.bonusY) { return false; }
    for (int i = 0; i < g.len; i++) {
        if (g.bodyX[i] == cx && g.bodyY[i] == cy) { return false; }
    }
    return true;
}

static void spawnFood ( Game& g )
{
    for (int tries = 0; tries < 4000; tries++) {
        int cx = rand() % COLS;
        int cy = rand() % ROWS;
        if (cellFree(g, cx, cy)) { g.foodX = cx; g.foodY = cy; return; }
    }
    /* grid nearly full: linear scan fallback */
    for (int cy = 0; cy < ROWS; cy++) {
        for (int cx = 0; cx < COLS; cx++) {
            if (cellFree(g, cx, cy)) { g.foodX = cx; g.foodY = cy; return; }
        }
    }
}

static void spawnBonus ( Game& g )
{
    if (g.bonusOn) { return; }
    for (int tries = 0; tries < 4000; tries++) {
        int cx = rand() % COLS;
        int cy = rand() % ROWS;
        if (cellFree(g, cx, cy)) {
            g.bonusX = cx; g.bonusY = cy;
            g.bonusOn = true; g.bonusTimer = 40;
            return;
        }
    }
}

static void resetGame ( Game& g, int diff )
{
    memset(&g, 0, sizeof(g));
    g.diff = diff;
    g.len = DIFFS[diff].startLength;
    g.dirX = 1; g.dirY = 0;               /* start crawling to the right */
    g.nextX = 1; g.nextY = 0;
    for (int i = 0; i < g.len; i++) {     /* spawn left of the centre    */
        g.bodyX[i] = COLS / 4 - i;
        g.bodyY[i] = ROWS / 2;
    }
    g.tickDelay = DIFFS[diff].startDelayMs;
    g.level = 1;
    g.score = 0;
    g.apples = 0;
    g.paused = false;
    g.alive = true;
    g.bonusOn = false;
    spawnFood(g);
}

/* ==========================================================================
 * SECTION 5 — one game tick (movement, collisions, eating, level ups)
 * ========================================================================== */

static void levelUp ( Game& g )
{
    g.level++;
    const Difficulty& d = DIFFS[g.diff];
    if (g.tickDelay - d.stepMs >= d.minDelayMs) { g.tickDelay -= d.stepMs; }
    else                                        { g.tickDelay = d.minDelayMs; }
}

static void tick ( Game& g )
{
    if (!g.alive || g.paused) { return; }

    /* apply the queued direction (180-degree turns are ignored) */
    if (!(g.nextX == -g.dirX && g.nextY == -g.dirY)) {
        g.dirX = g.nextX; g.dirY = g.nextY;
    }

    int hx = g.bodyX[0] + g.dirX;
    int hy = g.bodyY[0] + g.dirY;

    /* walls: wrap on Easy, deadly otherwise */
    if (DIFFS[g.diff].wrapWalls) {
        if (hx < 0) { hx = COLS - 1; } else if (hx >= COLS) { hx = 0; }
        if (hy < 0) { hy = ROWS - 1; } else if (hy >= ROWS) { hy = 0; }
    } else if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) {
        g.alive = false;
        return;
    }

    /* self collision — the tail cell is safe when it will move away */
    int last = g.growPending > 0 ? g.len : g.len - 1;
    for (int i = 0; i < last; i++) {
        if (g.bodyX[i] == hx && g.bodyY[i] == hy) { g.alive = false; return; }
    }

    /* move: shift the body towards the tail, then plant the new head */
    for (int i = g.len - 1; i > 0; i--) {
        g.bodyX[i] = g.bodyX[i - 1];
        g.bodyY[i] = g.bodyY[i - 1];
    }
    g.bodyX[0] = hx; g.bodyY[0] = hy;

    if (g.growPending > 0 && g.len < MAX_LEN) {
        g.len++;
        g.bodyX[g.len - 1] = g.bodyX[g.len - 2];
        g.bodyY[g.len - 1] = g.bodyY[g.len - 2];
        g.growPending--;
    }

    const Difficulty& d = DIFFS[g.diff];

    /* red apple eaten */
    if (hx == g.foodX && hy == g.foodY) {
        g.apples++;
        g.score += d.pointsPerApple;
        g.growPending += 2;
        spawnFood(g);
        if (g.apples % 4 == 0) { spawnBonus(g); }         /* bonus appears */
        if (g.apples % 5 == 0) { levelUp(g); }            /* speed up      */
    }

    /* yellow bonus apple eaten */
    if (g.bonusOn && hx == g.bonusX && hy == g.bonusY) {
        g.score += d.pointsPerApple * 5;
        g.growPending += 4;
        g.bonusOn = false;
    }

    if (g.bonusOn && --g.bonusTimer <= 0) { g.bonusOn = false; }
}

/* ==========================================================================
 * SECTION 6 — drawing helpers (all classic graphics.h primitives)
 * ========================================================================== */

/* centred text in a given font/size */
static void textCentered ( int y, const char* s, int color, int font, int size )
{
    settextstyle(font, HORIZ_DIR, size);
    setcolor(color);
    int w = textwidth((char*)s);
    outtextxy((getmaxx() - w) / 2, y, (char*)s);
}

/* centred text with a drop shadow — used for big titles */
static void shadowCentered ( int y, const char* s, int color, int font, int size )
{
    settextstyle(font, HORIZ_DIR, size);
    int w = textwidth((char*)s);
    int x = (getmaxx() - w) / 2;
    setcolor(DARKGRAY);
    outtextxy(x + 3, y + 3, (char*)s);
    setcolor(color);
    outtextxy(x, y, (char*)s);
}

/* a filled panel with a border, used by every overlay screen */
static void panel ( int left, int top, int right, int bottom, int borderCol )
{
    setfillstyle(SOLID_FILL, BLACK);
    setcolor(borderCol);
    setlinestyle(SOLID_LINE, 0, 2);
    bar(left, top, right, bottom);
    rectangle(left, top, right, bottom);
    setlinestyle(SOLID_LINE, 0, 1);
    setcolor(DARKGRAY);                       /* inner accent line */
    rectangle(left + 4, top + 4, right - 4, bottom - 4);
}

static void cellPixel ( int cx, int cy, int& px, int& py )
{
    px = ARENA_X + cx * CELL;
    py = ARENA_Y + cy * CELL;
}

/* one snake segment: a block with a 1px gap that gives the classic
 * segmented look. The head gets two eyes that face the travel
 * direction (dirX/dirY). */
static void drawSegment ( int cx, int cy, int color, bool head, int dirX, int dirY )
{
    int px, py;
    cellPixel(cx, cy, px, py);
    setfillstyle(SOLID_FILL, color);
    bar(px + 1, py + 1, px + CELL - 2, py + CELL - 2);

    if (head) {
        int e = CELL / 5;
        if (e < 3) { e = 3; }
        int mx = px + CELL / 2, my = py + CELL / 2;
        int face = 5;                          /* eyes pushed towards the face */
        int x1, y1, x2, y2;                    /* the two eye centres          */
        if (dirX != 0) {
            x1 = mx + dirX * face; y1 = my - 6;
            x2 = mx + dirX * face; y2 = my + 6;
        } else {
            x1 = mx - 6; y1 = my + dirY * face;
            x2 = mx + 6; y2 = my + dirY * face;
        }
        setfillstyle(SOLID_FILL, BLACK);
        bar(x1 - e / 2, y1 - e / 2, x1 - e / 2 + e, y1 - e / 2 + e);
        bar(x2 - e / 2, y2 - e / 2, x2 - e / 2 + e, y2 - e / 2 + e);
    }
}

static void drawApple ( int cx, int cy )
{
    int px, py;
    cellPixel(cx, cy, px, py);
    int mx = px + CELL / 2, my = py + CELL / 2;
    setfillstyle(SOLID_FILL, RED);
    fillellipse(mx, my + 1, 8, 8);
    setfillstyle(SOLID_FILL, GREEN);                 /* stem */
    bar(mx - 1, my - 10, mx + 1, my - 6);
    setcolor(WHITE);                                  /* shine */
    putpixel(mx - 3, my - 2, WHITE);
    putpixel(mx - 4, my - 1, WHITE);
}

static void drawBonus ( int cx, int cy, bool bright )
{
    int px, py;
    cellPixel(cx, cy, px, py);
    int mx = px + CELL / 2, my = py + CELL / 2;
    int r = bright ? 10 : 8;
    int pts[8] = { mx, my - r, mx + r, my, mx, my + r, mx - r, my };
    setcolor(bright ? WHITE : YELLOW);
    setfillstyle(SOLID_FILL, YELLOW);
    fillpoly(4, pts);                                 /* filled diamond */
}

static void drawArenaFrame ( )
{
    /* playfield background + the dotted grid */
    setfillstyle(SOLID_FILL, BLACK);
    bar(ARENA_X, ARENA_Y, ARENA_X + ARENA_W, ARENA_Y + ARENA_H);
    for (int cx = 1; cx < COLS; cx++) {
        for (int cy = 1; cy < ROWS; cy++) {
            putpixel(ARENA_X + cx * CELL, ARENA_Y + cy * CELL, DARKGRAY);
        }
    }
    /* double border: bright inner frame, dim outer glow */
    setcolor(WHITE);
    setlinestyle(SOLID_LINE, 0, 2);
    rectangle(ARENA_X - 2, ARENA_Y - 2, ARENA_X + ARENA_W + 2, ARENA_Y + ARENA_H + 2);
    setcolor(DARKGRAY);
    rectangle(ARENA_X - 5, ARENA_Y - 5, ARENA_X + ARENA_W + 5, ARENA_Y + ARENA_H + 5);
    setlinestyle(SOLID_LINE, 0, 1);
}

static void drawHud ( const Game& g, const GameDB& db )
{
    char buf[64];
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, 0, getmaxx(), HUD_H);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);

    setcolor(LIGHTGRAY); outtextxy(18, 8,  (char*)"SCORE");
    setcolor(YELLOW);
    snprintf(buf, sizeof(buf), "%d", g.score);
    outtextxy(18, 28, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(170, 8,  (char*)"LEVEL");
    setcolor(LIGHTCYAN);
    snprintf(buf, sizeof(buf), "%d", g.level);
    outtextxy(170, 28, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(300, 8,  (char*)"LENGTH");
    setcolor(LIGHTMAGENTA);
    snprintf(buf, sizeof(buf), "%d", g.len);
    outtextxy(300, 28, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(450, 8,  (char*)"HI-SCORE");
    setcolor(LIGHTGREEN);
    snprintf(buf, sizeof(buf), "%d", highScore(db));
    outtextxy(450, 28, (char*)buf);

    setcolor(LIGHTGRAY);
    outtextxy(getmaxx() - textwidth((char*)DIFFS[g.diff].label) - 18, 8,
              (char*)DIFFS[g.diff].label);

    /* bonus timer bar on the right, shrinking as it expires */
    if (g.bonusOn) {
        setfillstyle(SOLID_FILL, YELLOW);
        int w = 90 * g.bonusTimer / 40;
        if (w < 2) { w = 2; }
        bar(getmaxx() - 108, 30, getmaxx() - 108 + w, 36);
    }

    setcolor(DARKGRAY);
    setlinestyle(SOLID_LINE, 0, 2);
    line(0, HUD_H + 2, getmaxx(), HUD_H + 2);
    setlinestyle(SOLID_LINE, 0, 1);
}

static void drawFooterHint ( const char* hint )
{
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, ARENA_Y + ARENA_H + 6, getmaxx(), getmaxy());
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    setcolor(LIGHTGRAY);
    int w = textwidth((char*)hint);
    outtextxy((getmaxx() - w) / 2, ARENA_Y + ARENA_H + 9, (char*)hint);
}

static void drawGame ( const Game& g, const GameDB& db )
{
    cleardevice();
    drawHud(g, db);
    drawArenaFrame();

    /* apple + bonus first, so the snake draws over them when adjacent */
    drawApple(g.foodX, g.foodY);
    if (g.bonusOn) { drawBonus(g.bonusX, g.bonusY, (g.bonusTimer / 4) % 2 == 0); }

    /* body: GREEN with a LIGHTGREEN highlight every third segment */
    for (int i = g.len - 1; i >= 1; i--) {
        drawSegment(g.bodyX[i], g.bodyY[i], (i % 3 == 0) ? LIGHTGREEN : GREEN, false, 0, 0);
    }
    drawSegment(g.bodyX[0], g.bodyY[0], LIGHTGREEN, true, g.dirX, g.dirY);

    if (g.paused) {
        panel(getmaxx() / 2 - 170, getmaxy() / 2 - 64,
              getmaxx() / 2 + 170, getmaxy() / 2 + 64, YELLOW);
        textCentered(getmaxy() / 2 - 44, "PAUSED", YELLOW, GOTHIC_FONT, 6);
        textCentered(getmaxy() / 2 + 14, "P / Space - resume", WHITE, DEFAULT_FONT, 1);
        textCentered(getmaxy() / 2 + 30, "Q - back to the menu", WHITE, DEFAULT_FONT, 1);
    }
}

/* ==========================================================================
 * SECTION 7 — the demo AI (test-battery mode)
 * --------------------------------------------------------------------------
 * With BGI_AUTOEXIT_MS set the game plays itself: every tick the AI
 * picks the safe direction that brings it closest to the apple. Deaths
 * simply restart the demo, and the whole program exits cleanly when the
 * time budget is over. Scores are never saved in this mode.
 * ========================================================================== */

static void aiSteer ( Game& g )
{
    static const int DX[4] = { 1, -1, 0, 0 };
    static const int DY[4] = { 0, 0, -1, 1 };
    int best = -1, bestDist = 1 << 30;

    for (int i = 0; i < 4; i++) {
        int nx = g.bodyX[0] + DX[i];
        int ny = g.bodyY[0] + DY[i];
        if (DX[i] == -g.dirX && DY[i] == -g.dirY) { continue; }  /* no U-turn */
        if (DIFFS[g.diff].wrapWalls) {
            if (nx < 0) { nx = COLS - 1; } else if (nx >= COLS) { nx = 0; }
            if (ny < 0) { ny = ROWS - 1; } else if (ny >= ROWS) { ny = 0; }
        } else if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
            continue;                                            /* wall     */
        }
        bool hitsBody = false;
        int last = g.growPending > 0 ? g.len : g.len - 1;
        for (int s = 0; s < last; s++) {
            if (g.bodyX[s] == nx && g.bodyY[s] == ny) { hitsBody = true; break; }
        }
        if (hitsBody) { continue; }

        int dx = nx - g.foodX, dy = ny - g.foodY;
        if (DIFFS[g.diff].wrapWalls) {                           /* wrapped  */
            if (dx >  COLS / 2) { dx -= COLS; }
            if (dx < -COLS / 2) { dx += COLS; }
            if (dy >  ROWS / 2) { dy -= ROWS; }
            if (dy < -ROWS / 2) { dy += ROWS; }
        }
        int dist = dx * dx + dy * dy;
        if (DX[i] == g.dirX && DY[i] == g.dirY) { dist -= 1; }   /* straight */
        if (dist < bestDist) { bestDist = dist; best = i; }
    }

    if (best >= 0) {
        g.nextX = DX[best];
        g.nextY = DY[best];
    }
    /* no safe move: keep going and die like a champ */
}

static bool demoTimeUp ( )
{
    return demoMode && (time(NULL) - demoStart) >= demoExitMs / 1000;
}

/* ==========================================================================
 * SECTION 8 — screens (menu, difficulty, help, scores, game over, name)
 * ========================================================================== */

static void drawMenuSnakeDeco ( )
{
    /* a little decorative snake chasing an apple under the menu panel
     * (cell row 16 sits nicely between the panel and the footer text) */
    for (int i = 0; i < 6; i++) {
        drawSegment(7 + i, 16, i == 5 ? LIGHTGREEN : GREEN, i == 5, 1, 0);
    }
    drawApple(16, 16);
}

static void drawMenu ( int selection, int diff, const GameDB& db )
{
    static const char* ITEMS[5] = {
        "Start Game", "Difficulty", "High Scores", "Help", "Quit"
    };

    cleardevice();

    shadowCentered(34, "SNAKE", GREEN, GOTHIC_FONT, 10);
    textCentered(176, "the graphics.h game", DARKGRAY, DEFAULT_FONT, 1);

    setcolor(DARKGRAY);
    line(220, 190, getmaxx() - 220, 190);

    int boxTop = 200, boxH = 5 * 44 + 16;
    panel(getmaxx() / 2 - 210, boxTop, getmaxx() / 2 + 210, boxTop + boxH, DARKGRAY);

    for (int i = 0; i < 5; i++) {
        int y = boxTop + 12 + i * 44;
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, GREEN);
            bar(getmaxx() / 2 - 190, y - 6, getmaxx() / 2 + 190, y + 26);
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
        setcolor(sel ? BLACK : WHITE);
        const char* label = ITEMS[i];
        char buf[48];
        if (i == 1) {                                 /* difficulty row   */
            snprintf(buf, sizeof(buf), "Difficulty:  %s", DIFFS[diff].label);
            label = buf;
        }
        int w = textwidth((char*)label);
        outtextxy((getmaxx() - w) / 2, y, (char*)label);
    }

    drawMenuSnakeDeco();

    char hi[64];
    snprintf(hi, sizeof(hi), "hi-score %d  |  games played %d", highScore(db), db.gamesPlayed);
    textCentered(getmaxy() - 64, hi, LIGHTGRAY, DEFAULT_FONT, 1);
    textCentered(getmaxy() - 44,
        "Up/Down or W/S - choose   Enter - select   Left/Right on Difficulty - change",
        DARKGRAY, DEFAULT_FONT, 1);
}

static void cycleDifficulty ( int& diff, int dir )
{
    diff = (diff + dir + DIFF_COUNT) % DIFF_COUNT;
}

static void drawDifficulty ( int selection )
{
    cleardevice();
    shadowCentered(80, "DIFFICULTY", LIGHTCYAN, GOTHIC_FONT, 7);

    int boxTop = 200;
    panel(getmaxx() / 2 - 260, boxTop, getmaxx() / 2 + 260, boxTop + 3 * 56 + 20, DARKGRAY);

    for (int i = 0; i < DIFF_COUNT; i++) {
        int y = boxTop + 16 + i * 56;
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, LIGHTCYAN);
            bar(getmaxx() / 2 - 240, y - 8, getmaxx() / 2 + 240, y + 30);
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
        setcolor(sel ? BLACK : WHITE);
        outtextxy(getmaxx() / 2 - 220, y, (char*)DIFFS[i].label);
        int lw = textwidth((char*)DIFFS[i].label);   /* measure in font 2! */
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(sel ? BLACK : LIGHTGRAY);
        outtextxy(getmaxx() / 2 - 220 + lw + 24, y + 8, (char*)DIFF_HINTS[i]);
    }
    textCentered(getmaxy() - 64, "Up/Down or W/S - choose   Enter - play", DARKGRAY, DEFAULT_FONT, 1);
    textCentered(getmaxy() - 44, "Esc - back", DARKGRAY, DEFAULT_FONT, 1);
}

static void drawHelp ( )
{
    cleardevice();
    shadowCentered(56, "HOW TO PLAY", YELLOW, GOTHIC_FONT, 7);

    int l = 90, t = 150, r = getmaxx() - 90, b = getmaxy() - 110;
    panel(l, t, r, b, DARKGRAY);

    struct Row { const char* k; const char* v; };
    static const Row ROWS[] = {
        { "Move",           "Arrow keys or W A S D" },
        { "Pause / resume", "P or Space"            },
        { "Back to menu",   "Q (while paused), Esc" },
        { "Red apple",      "points + 2 segments of growth" },
        { "Yellow bonus",   "5x points - it expires fast!" },
        { "Level up",       "every 5 apples the snake speeds up" },
        { "Walls",          "Easy wraps around; Medium and Hard are deadly" },
        { "High scores",    "the top 5 are saved in snake_scores.db" }
    };
    int y = t + 24;
    for (size_t i = 0; i < sizeof(ROWS) / sizeof(ROWS[0]); i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
        setcolor(YELLOW);
        outtextxy(l + 30, y, (char*)ROWS[i].k);
        setcolor(WHITE);
        outtextxy(l + 250, y, (char*)ROWS[i].v);
        y += 34;
    }
    textCentered(getmaxy() - 64, "Esc / Enter / Q - back", DARKGRAY, DEFAULT_FONT, 1);
}

static void drawScores ( const GameDB& db )
{
    cleardevice();
    shadowCentered(56, "HIGH SCORES", LIGHTGREEN, GOTHIC_FONT, 7);

    int l = 110, t = 150, r = getmaxx() - 110, b = getmaxy() - 130;
    panel(l, t, r, b, DARKGRAY);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    setcolor(LIGHTGRAY);
    outtextxy(l + 34, t + 20, (char*)"#");
    outtextxy(l + 80, t + 20, (char*)"NAME");
    outtextxy(l + 260, t + 20, (char*)"SCORE");
    outtextxy(l + 380, t + 20, (char*)"LEVEL");
    outtextxy(l + 480, t + 20, (char*)"WHEN");

    int y = t + 56;
    if (db.count == 0) {
        setcolor(DARKGRAY);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        outtextxy(l + 34, y + 20, (char*)"no scores yet - play a game and claim the first rank!");
    }
    for (int i = 0; i < db.count; i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
        setcolor(i == 0 ? YELLOW : WHITE);
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", i + 1);
        outtextxy(l + 34, y, (char*)buf);
        outtextxy(l + 80, y, (char*)db.top[i].name);
        snprintf(buf, sizeof(buf), "%d", db.top[i].score);
        outtextxy(l + 260, y, (char*)buf);
        snprintf(buf, sizeof(buf), "%d", db.top[i].level);
        outtextxy(l + 380, y, (char*)buf);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(LIGHTGRAY);
        outtextxy(l + 480, y + 8, (char*)db.top[i].when);
        y += 40;
    }

    char stats[96];
    snprintf(stats, sizeof(stats), "games played %d  |  apples eaten %d", db.gamesPlayed, db.applesEaten);
    textCentered(b + 18, stats, LIGHTGRAY, DEFAULT_FONT, 1);
    textCentered(getmaxy() - 64, "C C - clear the table (press C twice)", DARKGRAY, DEFAULT_FONT, 1);
    textCentered(getmaxy() - 44, "Esc - back", DARKGRAY, DEFAULT_FONT, 1);
}

/* Name entry after a top-5 score. Mutates nothing until Enter. */
static void drawNameEntry ( const char* name, int score, int rank )
{
    cleardevice();
    shadowCentered(120, "NEW HIGH SCORE!", YELLOW, GOTHIC_FONT, 7);

    char buf[64];
    snprintf(buf, sizeof(buf), "rank #%d  |  %d points", rank, score);
    textCentered(210, buf, WHITE, DEFAULT_FONT, 2);

    int l = getmaxx() / 2 - 260, t = 280, r = getmaxx() / 2 + 260, b = 470;
    panel(l, t, r, b, YELLOW);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    setcolor(LIGHTGRAY);
    outtextxy(l + 30, t + 30, (char*)"type your name, then press Enter");

    /* the name itself, big, with a block cursor at the end */
    static int blink = 0;
    char shown[NAME_LEN + 3];
    snprintf(shown, sizeof(shown), "%s", name);
    if ((blink++ / 8) % 2 == 0) {
        int n = (int)strlen(name);
        if (n < NAME_LEN) { shown[n] = '_'; shown[n + 1] = '\0'; }
    }
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 3);
    setcolor(YELLOW);
    outtextxy(l + 30, t + 90, (char*)shown);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
    setcolor(DARKGRAY);
    outtextxy(l + 30, b - 36, (char*)"letters, digits and spaces - Backspace deletes - Esc skips");
}

/* Game-over card. Returns the next action: 0 menu, 1 play again. */
static int drawGameOver ( const Game& g, const GameDB& db, bool newRecord, int rank )
{
    cleardevice();

    shadowCentered(130, "GAME OVER", RED, GOTHIC_FONT, 8);

    if (newRecord) {
        char buf[64];
        snprintf(buf, sizeof(buf), "NEW HIGH SCORE - rank #%d!", rank);
        textCentered(230, buf, YELLOW, DEFAULT_FONT, 2);
    }

    int l = getmaxx() / 2 - 200, t = 280, r = getmaxx() / 2 + 200, b = 460;
    panel(l, t, r, b, DARKGRAY);

    char buf[64];
    settextstyle(DEFAULT_FONT, HORIZ_DIR, 2);
    setcolor(LIGHTGRAY); outtextxy(l + 30, t + 26, (char*)"score");
    setcolor(YELLOW);
    snprintf(buf, sizeof(buf), "%d", g.score);
    outtextxy(r - 30 - textwidth((char*)buf), t + 26, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(l + 30, t + 60, (char*)"level");
    setcolor(LIGHTCYAN);
    snprintf(buf, sizeof(buf), "%d", g.level);
    outtextxy(r - 30 - textwidth((char*)buf), t + 60, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(l + 30, t + 94, (char*)"apples");
    setcolor(RED);
    snprintf(buf, sizeof(buf), "%d", g.apples);
    outtextxy(r - 30 - textwidth((char*)buf), t + 94, (char*)buf);

    setcolor(LIGHTGRAY); outtextxy(l + 30, t + 128, (char*)"best ever");
    setcolor(LIGHTGREEN);
    snprintf(buf, sizeof(buf), "%d", highScore(db));
    outtextxy(r - 30 - textwidth((char*)buf), t + 128, (char*)buf);

    textCentered(b + 22, "Enter / N - play again      Q / Esc - menu", WHITE, DEFAULT_FONT, 1);
    textCentered(b + 42, DIFF_HINTS[g.diff], DARKGRAY, DEFAULT_FONT, 1);

    while (true) {
        int k = readKey();
        if (k == K_QUIT) { return 0; }
        if (k == K_ENTER || (k == K_LETTER && readKeyLetter == 'n')) { return 1; }
        if (k == K_ESC || (k == K_LETTER && readKeyLetter == 'q'))   { return 0; }
        delay(10);
    }
}

/* ==========================================================================
 * SECTION 9 — the play loop
 * ========================================================================== */

/* returns: 0 = back to menu, 1 = play again, 2 = quit (window closed),
 *          3 = demo game died (restart the demo)                       */
static int playLoop ( Game& g, GameDB& db )
{
    while (true) {
        if (demoTimeUp()) { return 2; }

        /* drain every waiting key; the last direction queued wins */
        int k;
        while ((k = pollKey()) != K_NONE) {
            if (k == K_QUIT) { return 2; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { if (g.dirY != 1)  { g.nextX = 0;  g.nextY = -1; } }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { if (g.dirY != -1) { g.nextX = 0;  g.nextY = 1;  } }
            if (k == K_LEFT  || (k == K_LETTER && readKeyLetter == 'a')) { if (g.dirX != 1)  { g.nextX = -1; g.nextY = 0;  } }
            if (k == K_RIGHT || (k == K_LETTER && readKeyLetter == 'd')) { if (g.dirX != -1) { g.nextX = 1;  g.nextY = 0;  } }
            if (k == K_SPACE || (k == K_LETTER && readKeyLetter == 'p')) { g.paused = !g.paused; }
            if (k == K_ESC)  { g.paused = true; }
            if (g.paused) { break; }
        }

        /* paused: show the overlay, then wait (blocking reads are fine) */
        if (g.paused && g.alive) {
            drawGame(g, db);
            while (g.paused && g.alive) {
                int pk = readKey();
                if (pk == K_QUIT) { return 2; }
                if (pk == K_SPACE || pk == K_ENTER
                    || (pk == K_LETTER && readKeyLetter == 'p')) { g.paused = false; }
                else if (pk == K_ESC
                    || (pk == K_LETTER && readKeyLetter == 'q')) { return 0; }
            }
            drawGame(g, db);                       /* wipe the overlay */
        }

        if (demoMode) { aiSteer(g); }

        tick(g);

        if (!g.alive) {
            if (demoMode) { return 3; }            /* demo: restart */

            int rank = rankFor(db, g.score);
            bool record = rank > 0;
            if (record) {
                /* collect a name, insert into the top 5, save */
                char name[NAME_LEN + 1];
                strncpy(name, db.name, NAME_LEN); name[NAME_LEN] = '\0';
                int nameLen = (int)strlen(name);
                bool done = false;
                while (!done) {
                    drawNameEntry(name, g.score, rank);
                    int nk = readKey();
                    if (nk == K_QUIT) { return 2; }
                    if (nk == K_BACKSPACE) { if (nameLen > 0) { name[--nameLen] = '\0'; } }
                    else if (nk == K_ENTER || nk == K_ESC) { done = true; }
                    else if (nk == K_LETTER || nk == K_DIGIT || nk == K_SPACE) {
                        char c = (nk == K_SPACE) ? ' ' : (char)toupper(readKeyLetter);
                        if (nameLen < NAME_LEN && !(nameLen == 0 && c == ' ')) {
                            name[nameLen++] = c; name[nameLen] = '\0';
                        }
                    }
                }
                if (nameLen == 0) { strncpy(name, "PLAYER", NAME_LEN); name[NAME_LEN] = '\0'; }
                strncpy(db.name, name, NAME_LEN); db.name[NAME_LEN] = '\0';
                insertScore(db, name, g.score, g.level);
            }
            db.gamesPlayed++;
            db.applesEaten += g.apples;
            saveDatabase(db);
            int next = drawGameOver(g, db, record, rank);
            if (next == 1) {
                resetGame(g, g.diff);      /* "play again" - a fresh run of
                                            * the same playLoop, no menu trip */
                continue;
            }
            return 0;
        }

        drawGame(g, db);
        delay(g.tickDelay);
    }
}

/* ==========================================================================
 * SECTION 10 — main(): the little state machine that ties it all together
 * ========================================================================== */

int main ( int argc, char* argv[] )
{
    /* battery hook: BGI_AUTOEXIT_MS=12000 -> play a 12 s demo and exit 0 */
    { const char* ae = getenv("BGI_AUTOEXIT_MS");
      if (ae) { demoExitMs = atol(ae); if (demoExitMs > 0) { demoMode = true; } } }

    srand((unsigned)time(NULL));
    resolveDbPath(argc > 0 ? argv[0] : "");

    GameDB db;
    loadDatabase(db);                 /* reading is harmless in demo mode */

    initwindow(WIN_W, WIN_H);

    int screen = 0;                   /* 0 menu, 1 difficulty, 2 scores, 3 help */
    int selection = 0;
    int diffSelection = DIFF_MEDIUM;
    int diff = DIFF_MEDIUM;

    demoStart = time(NULL);

    Game g;
    while (true) {
        if (demoTimeUp()) { break; }

        if (demoMode) {
            /* straight into the game - the battery screenshots gameplay */
            resetGame(g, diff);
            int rc = playLoop(g, db);
            if (rc == 2) { break; }
            continue;                                     /* died: restart */
        }

        if (screen == 0) {                                /* ---- menu ---- */
            drawMenu(selection, diff, db);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { selection = (selection + 4) % 5; }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { selection = (selection + 1) % 5; }
            if (selection == 1) {
                if (k == K_LEFT  || (k == K_LETTER && readKeyLetter == 'a')) { cycleDifficulty(diff, -1); }
                if (k == K_RIGHT || (k == K_LETTER && readKeyLetter == 'd')) { cycleDifficulty(diff, 1);  }
            }
            if (k == K_ESC) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                if (selection == 0) {
                    resetGame(g, diff);
                    int rc = playLoop(g, db);
                    if (rc == 2) { break; }               /* window closed */
                    selection = 0;
                } else if (selection == 1) {
                    diffSelection = diff;
                    screen = 1;                           /* difficulty picker */
                } else if (selection == 2) {
                    screen = 2;                           /* high scores */
                } else if (selection == 3) {
                    screen = 3;                           /* help */
                } else if (selection == 4) {
                    break;                                /* quit */
                }
            }
        } else if (screen == 1) {                         /* -- difficulty - */
            drawDifficulty(diffSelection);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { diffSelection = (diffSelection + DIFF_COUNT - 1) % DIFF_COUNT; }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { diffSelection = (diffSelection + 1) % DIFF_COUNT; }
            if (k == K_ENTER || k == K_SPACE) { diff = diffSelection; screen = 0; selection = 0; }
            if (k == K_ESC) { screen = 0; }
        } else if (screen == 2) {                         /* -- high scores - */
            drawScores(db);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC || k == K_ENTER
                || (k == K_LETTER && readKeyLetter == 'q')) { screen = 0; }
            if (k == K_LETTER && readKeyLetter == 'c') {
                /* clear: needs C twice in a row (double-press confirm) */
                int k2 = readKey();
                if (k2 == K_LETTER && readKeyLetter == 'c') {
                    db.count = 0;
                    saveDatabase(db);
                }
            }
        } else if (screen == 3) {                         /* ---- help ----- */
            drawHelp();
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC || k == K_ENTER
                || (k == K_LETTER && (readKeyLetter == 'q' || readKeyLetter == 'h'))) { screen = 0; }
        }
    }

    closegraph();
    return 0;
}
