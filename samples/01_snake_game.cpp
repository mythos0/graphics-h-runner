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
 *   - Sound effects (short synthesized tones, toggle in the menu)
 *   - Double-buffered, flicker-free rendering on every platform
 *   - The window is RESIZABLE: drag its borders (SDL_bgi) and the board
 *     re-fits instantly, or pick S / M / L / XL sizes in the menu
 *   - Bigger, high-contrast text everywhere — readable on any display
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
 * BGI_SCREENSHOT=menu|difficulty|scores|help|game renders one screen,
 * presents it and exits 0 — used by the visual regression battery.
 * ==========================================================================
 */
#include <graphics.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cctype>
#include <ctime>
#include <cmath>

/* ==========================================================================
 * SECTION 1 — board geometry and tuning constants
 * --------------------------------------------------------------------------
 * The board is a COLS x ROWS grid. The window can be resized (drag its
 * borders on SDL_bgi, or pick a preset in the menu), so the PIXEL size
 * of a cell is COMPUTED every frame — see cellPx()/arenaX()/arenaY()
 * below. Nothing here depends on a fixed window size.
 * ========================================================================== */

/* window size presets, indexed by the winsize= value in the database */
struct WinSize { const char* label; int w, h; };
static const WinSize SIZES[4] = {
    { "S  640x480",  640, 480 },
    { "M  800x600",  800, 600 },
    { "L  960x640",  960, 640 },
    { "XL 1200x800", 1200, 800 }
};
static const int SIZE_DEFAULT = 2;              /* L 960x640          */

static const int COLS   = 32;          /* playfield = COLS x ROWS cells    */
static const int ROWS   = 21;
static const int HUD_H   = 64;         /* score bar above the playfield    */
static const int FOOT_H  = 36;         /* hint line below the playfield    */

static const int MAX_LEN  = COLS * ROWS + 1;   /* theoretical snake limit  */
static const int SNAKE_NAME_MAX = 10;        /* high-score name length           */
static const char* DB_FILENAME = "snake_scores.db";

/* ---- responsive layout -------------------------------------------------
 * cellPx() picks the biggest cell size that still fits the CURRENT
 * window; arenaX()/arenaY() centre the board in the space below the
 * HUD. Call them fresh every frame — they follow window resizes.     */
static int cellPx ( void )
{
    int cw = (getmaxx() + 1 - 24) / COLS;
    int ch = (getmaxy() + 1 - HUD_H - FOOT_H - 20) / ROWS;
    int c = cw < ch ? cw : ch;
    if (c < 12) { c = 12; }
    if (c > 30) { c = 30; }
    return c;
}
static int arenaX ( void ) { return (getmaxx() + 1 - COLS * cellPx()) / 2; }
static int arenaY ( void )
{
    return HUD_H + (getmaxy() + 1 - HUD_H - FOOT_H - ROWS * cellPx()) / 2;
}

/* font size helper: scales a base bitmap-font size with the window
 * height (base 2 stays >= 2), so text stays readable on any window */
static int fsz ( int base )
{
    int s = base * (getmaxy() + 240) / 640;
    if (s < base) { s = base; }
    if (s < 2)    { s = 2; }
    return s;
}

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
    "the snake wraps around walls",
    "walls are deadly",
    "walls are deadly, and fast"
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
    K_LETTER, K_DIGIT, K_PLUS, K_MINUS
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
        case 43:  return K_PLUS;           /* + resize   */
        case 45:  return K_MINUS;          /* - resize   */
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
 * SECTION 2b — tiny sound effects (optional, off switch in the menu)
 * --------------------------------------------------------------------------
 * playSfx() fires a short synthesized tone and returns AT ONCE, so the
 * game loop never stalls. The same five effects are built on both
 * platforms from one envelope table:
 *   - Windows: PlaySoundA() from winmm.dll, loaded at RUNTIME (no extra
 *     link flags needed) on pre-built in-memory WAV buffers
 *   - SDL_bgi (Linux/macOS): SDL_OpenAudioDevice() + SDL_QueueAudio()
 *     (SDL2 is already linked into every graphics.h program)
 * If the menu switch is OFF or a device is missing, everything is a
 * silent no-op. This section is a self-contained mini lesson in making
 * noise without any sound library.
 * ========================================================================== */

static bool soundOn = true;            /* menu toggle, stored in the db    */

enum { SFX_TICK = 0, SFX_EAT, SFX_BONUS, SFX_LEVEL, SFX_OVER, SFX_COUNT };

/* one effect = a frequency sweep (Hz) + duration (ms) + decay shape:
 *   0 steady blip, 1 fast decay, 2 rising swell, 3 long fade          */
struct SfxSpec { int f0, f1, ms, shape; };
static const SfxSpec SFX[SFX_COUNT] = {
    { 1250, 1150,  30, 0 },    /* menu tick: short high blip            */
    {  880,  620,  70, 1 },    /* eat: bright downward pop              */
    {  660, 1320, 170, 2 },    /* bonus apple: rising two-tone chime    */
    {  520, 1040, 180, 2 },    /* level up: rising fanfare-ish          */
    {  420,  100, 450, 3 }     /* game over: long falling tone          */
};

#define SFX_RATE 22050          /* samples per second, both platforms */

/* Synthesize one effect into a raw 16-bit mono sample buffer.
 * Square-ish wave (half sine + half square mix) with an envelope that
 * follows the effect's shape — retro and pleasant at low volume.     */
static int buildSfxSamples ( int id, signed short* out, int maxSamples )
{
    const SfxSpec& s = SFX[id];
    int n = s.ms * SFX_RATE / 1000;
    int i;
    if (n > maxSamples) { n = maxSamples; }
    for (i = 0; i < n; i++) {
        double t = (double) i / n;                     /* 0..1        */
        double f = s.f0 + (s.f1 - s.f0) * t;           /* sweep       */
        double phase = 2.0 * 3.14159265358979 * f * i / SFX_RATE;
        double wave = 0.65 * sin(phase) + 0.35 * ((sin(phase) >= 0.0) ? 0.8 : -0.8);
        double env;
        switch (s.shape) {
            case 1:  env = (1.0 - t) * (1.0 - t); break;          /* fast decay */
            case 2:  env = 0.25 + 0.75 * sin(3.14159265358979 * t); break;
            case 3:  env = (1.0 - t) * (1.0 - t) * (1.0 - t); break;
            default: env = (t < 0.15) ? t / 0.15 : 1.0 - (t - 0.15) / 0.85;
        }
        double v = wave * env * 0.42;                  /* master volume */
        out[i] = (signed short) (v * 32000);
    }
    return n;
}

#ifdef _WIN32

/* Windows: build WAV files in memory, hand them to PlaySoundA with
 * SND_ASYNC. LoadLibraryA at runtime means the compile line stays
 * exactly the same as for any other graphics.h program.              */
static unsigned char  sfxWav[SFX_COUNT][SFX_RATE];      /* 1 s cap, plenty */
static int            sfxWavLen[SFX_COUNT] = { 0 };
static int (WINAPI *sfxPlay)(const char*, void*, unsigned long) = NULL;

static void sfxWriteWav ( int id, int samples )
{
    unsigned char* w = sfxWav[id];
    int dataLen = samples * 2;
    int chunk = 16;
    /* 44-byte canonical PCM WAV header, 22050 Hz mono 16-bit */
    memcpy(w,      "RIFF", 4);
    w[4] = (36 + dataLen); w[5] = (36 + dataLen) >> 8;
    w[6] = (36 + dataLen) >> 16; w[7] = (36 + dataLen) >> 24;
    memcpy(w + 8,  "WAVEfmt ", 8);
    w[16] = chunk; w[17] = 0; w[18] = 0; w[19] = 0;
    w[20] = 1; w[21] = 0;                 /* PCM            */
    w[22] = 1; w[23] = 0;                 /* mono           */
    w[24] = (unsigned char)(SFX_RATE & 0xFF); w[25] = 0;   /* sample rate    */
    w[26] = (unsigned char)((SFX_RATE * 2) & 0xFF);
    w[27] = (unsigned char)(((SFX_RATE * 2) >> 8) & 0xFF);
    w[28] = 2; w[29] = 0;                 /* block align    */
    w[30] = 16; w[31] = 0;                /* bits           */
    memcpy(w + 36, "data", 4);
    w[40] = dataLen; w[41] = dataLen >> 8;
    w[42] = dataLen >> 16; w[43] = dataLen >> 24;
    sfxWavLen[id] = 44 + dataLen;
}

static void sfxInit ( void )
{
    int i;
    HMODULE mm = LoadLibraryA("winmm.dll");
    if (!mm) { return; }
    sfxPlay = (int (WINAPI *)(const char*, void*, unsigned long))
              GetProcAddress(mm, "PlaySoundA");
    if (!sfxPlay) { return; }
    for (i = 0; i < SFX_COUNT; i++) {
        int n = buildSfxSamples(i, (signed short*)(sfxWav[i] + 44),
                                sizeof(sfxWav[i]) - 44);
        sfxWriteWav(i, n);
    }
}

static void playSfx ( int id )
{
    /* 0x2003 = SND_ASYNC | SND_MEMORY | SND_NODEFAULT: fire, don't wait,
     * and a new effect simply replaces the previous one                */
    if (soundOn && sfxPlay) { sfxPlay((const char*) sfxWav[id], NULL, 0x2003); }
}

#else

/* SDL_bgi: queue pre-built sample buffers on an SDL audio device */
static SDL_AudioDeviceID sfxDev = 0;
static signed short sfxBuf[SFX_COUNT][SFX_RATE];
static int          sfxBufLen[SFX_COUNT] = { 0 };

static void sfxInit ( void )
{
    SDL_AudioSpec want, have;
    int i;
    memset(&want, 0, sizeof(want));
    want.freq = SFX_RATE;
    want.format = AUDIO_S16SYS;
    want.channels = 1;
    want.samples = 512;
    sfxDev = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
    if (!sfxDev) { return; }             /* no audio device: stay silent  */
    for (i = 0; i < SFX_COUNT; i++) {
        sfxBufLen[i] = buildSfxSamples(i, sfxBuf[i], SFX_RATE) * 2;
    }
    SDL_PauseAudioDevice(sfxDev, 0);     /* start playing queued data     */
}

static void playSfx ( int id )
{
    if (!soundOn || !sfxDev) { return; }
    SDL_ClearQueuedAudio(sfxDev);        /* latest effect wins            */
    SDL_QueueAudio(sfxDev, sfxBuf[id], sfxBufLen[id]);
}

#endif

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
    char name[SNAKE_NAME_MAX + 1];
    int  score;
    int  level;
    char when[20];        /* "YYYY-MM-DD HH:MM" */
};

struct GameDB {
    char name[SNAKE_NAME_MAX + 1];  /* last name used, offered again next time */
    int  gamesPlayed;
    int  applesEaten;
    int  count;               /* rows actually stored (0..5) */
    ScoreRow top[5];
    int  winSize;             /* window preset index into SIZES[]       */
    /* soundOn (SECTION 2b) is stored too — loaded right below */
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

    /* is that folder writable? (cheap append-open test) */
    FILE* f = fopen(probe, "ab");
    if (f) { fclose(f); }
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
    if (n == 0 || n > (size_t)SNAKE_NAME_MAX) { return; }
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
    strncpy(db.name, "PLAYER", SNAKE_NAME_MAX);
    db.name[SNAKE_NAME_MAX] = '\0';
    db.winSize = SIZE_DEFAULT;
    soundOn = true;

    FILE* f = fopen(dbPath, "r");
    if (!f) { return; }                       /* first run: clean defaults */

    char line[512];
    while (fgets(line, sizeof(line), f)) {
        for (char* c = line; *c; c++) { if (*c == '\n' || *c == '\r') { *c = '\0'; } }
        if (strncmp(line, "name=", 5) == 0) {
            strncpy(db.name, line + 5, SNAKE_NAME_MAX);
            db.name[SNAKE_NAME_MAX] = '\0';
        } else if (strncmp(line, "games=", 6) == 0) {
            db.gamesPlayed = atoi(line + 6);
            if (db.gamesPlayed < 0) { db.gamesPlayed = 0; }
        } else if (strncmp(line, "food=", 5) == 0) {
            db.applesEaten = atoi(line + 5);
            if (db.applesEaten < 0) { db.applesEaten = 0; }
        } else if (strncmp(line, "sound=", 6) == 0) {
            soundOn = (strncmp(line + 6, "ON", 2) == 0);
        } else if (strncmp(line, "winsize=", 8) == 0) {
            db.winSize = atoi(line + 8);
            if (db.winSize < 0 || db.winSize > 3) { db.winSize = SIZE_DEFAULT; }
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
    fprintf(f, "version=2\n");
    fprintf(f, "name=%s\n", db.name);
    fprintf(f, "games=%d\n", db.gamesPlayed);
    fprintf(f, "food=%d\n", db.applesEaten);
    fprintf(f, "sound=%s\n", soundOn ? "ON" : "OFF");
    fprintf(f, "winsize=%d\n", db.winSize);
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
    strncpy(row.name, name, SNAKE_NAME_MAX);
    row.name[SNAKE_NAME_MAX] = '\0';
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
        playSfx(SFX_OVER);
        return;
    }

    /* self collision — the tail cell is safe when it will move away */
    int last = g.growPending > 0 ? g.len : g.len - 1;
    for (int i = 0; i < last; i++) {
        if (g.bodyX[i] == hx && g.bodyY[i] == hy) { g.alive = false; playSfx(SFX_OVER); return; }
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
        playSfx(SFX_EAT);
        if (g.apples % 4 == 0) { spawnBonus(g); }         /* bonus appears */
        if (g.apples % 5 == 0) { levelUp(g); playSfx(SFX_LEVEL); }
    }

    /* yellow bonus apple eaten */
    if (g.bonusOn && hx == g.bonusX && hy == g.bonusY) {
        g.score += d.pointsPerApple * 5;
        g.growPending += 4;
        g.bonusOn = false;
        playSfx(SFX_BONUS);
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

/* Presents the frame that was just drawn. Every screen function calls
 * this at the end — combined with the double-buffered window setup in
 * main() it is what makes the game flicker-free on both platforms. */
static void present ( )
{
    swapbuffers();
}

static void cellPixel ( int cx, int cy, int& px, int& py )
{
    px = arenaX() + cx * cellPx();
    py = arenaY() + cy * cellPx();
}

/* one snake segment: a block with a 1px gap that gives the classic
 * segmented look. The head gets two eyes that face the travel
 * direction (dirX/dirY). */
static void drawSegment ( int cx, int cy, int color, bool head, int dirX, int dirY )
{
    int px, py;
    int cell = cellPx();
    cellPixel(cx, cy, px, py);
    setfillstyle(SOLID_FILL, color);
    bar(px + 1, py + 1, px + cell - 2, py + cell - 2);

    if (head) {
        int e = cell / 5;
        if (e < 3) { e = 3; }
        int face = cell / 5;
        int mx = px + cell / 2, my = py + cell / 2;
        int x1, y1, x2, y2;                    /* the two eye centres          */
        if (dirX != 0) {
            x1 = mx + dirX * face; y1 = my - cell / 4;
            x2 = mx + dirX * face; y2 = my + cell / 4;
        } else {
            x1 = mx - cell / 4; y1 = my + dirY * face;
            x2 = mx + cell / 4; y2 = my + dirY * face;
        }
        setfillstyle(SOLID_FILL, BLACK);
        bar(x1 - e / 2, y1 - e / 2, x1 - e / 2 + e, y1 - e / 2 + e);
        bar(x2 - e / 2, y2 - e / 2, x2 - e / 2 + e, y2 - e / 2 + e);
    }
}

static void drawApple ( int cx, int cy )
{
    int px, py;
    int cell = cellPx();
    cellPixel(cx, cy, px, py);
    int mx = px + cell / 2, my = py + cell / 2;
    int r = cell / 3;
    if (r < 6) { r = 6; }
    setfillstyle(SOLID_FILL, RED);
    fillellipse(mx, my + 1, r, r);
    setfillstyle(SOLID_FILL, GREEN);                 /* stem */
    bar(mx - 1, my - r - 4, mx + 1, my - r + 1);
    setcolor(WHITE);                                  /* shine */
    putpixel(mx - r / 3, my - r / 3, WHITE);
    putpixel(mx - r / 3 - 1, my - r / 3 + 1, WHITE);
}

static void drawBonus ( int cx, int cy, bool bright )
{
    int px, py;
    int cell = cellPx();
    cellPixel(cx, cy, px, py);
    int mx = px + cell / 2, my = py + cell / 2;
    int r = cell / 2 - 1;
    if (r < 8) { r = bright ? 10 : 8; }
    else if (bright) { r += 2; }
    int pts[8] = { mx, my - r, mx + r, my, mx, my + r, mx - r, my };
    setcolor(bright ? WHITE : YELLOW);
    setfillstyle(SOLID_FILL, YELLOW);
    fillpoly(4, pts);                                 /* filled diamond */
}

static void drawArenaFrame ( )
{
    int ax = arenaX(), ay = arenaY();
    int aw = COLS * cellPx(), ah = ROWS * cellPx();
    int cell = cellPx();
    /* playfield background + the dotted grid */
    setfillstyle(SOLID_FILL, BLACK);
    bar(ax, ay, ax + aw, ay + ah);
    setcolor(DARKGRAY);
    for (int cx = 1; cx < COLS; cx++) {
        for (int cy = 1; cy < ROWS; cy++) {
            putpixel(ax + cx * cell, ay + cy * cell, DARKGRAY);
        }
    }
    /* double border: bright inner frame, dim outer glow */
    setcolor(WHITE);
    setlinestyle(SOLID_LINE, 0, 2);
    rectangle(ax - 2, ay - 2, ax + aw + 2, ay + ah + 2);
    setcolor(DARKGRAY);
    rectangle(ax - 5, ay - 5, ax + aw + 5, ay + ah + 5);
    setlinestyle(SOLID_LINE, 0, 1);
}

static void drawHud ( const Game& g, const GameDB& db )
{
    char buf[64];
    int labelSize = fsz(2);
    int valueSize = fsz(3);
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, 0, getmaxx(), HUD_H);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy(18, 6,  (char*)"SCORE");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(YELLOW);
    snprintf(buf, sizeof(buf), "%d", g.score);
    outtextxy(18, 6 + textheight((char*)"SCORE") + 4, (char*)buf);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy((int)(getmaxx() * 0.26), 6,  (char*)"LEVEL");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(LIGHTCYAN);
    snprintf(buf, sizeof(buf), "%d", g.level);
    outtextxy((int)(getmaxx() * 0.26), 6 + textheight((char*)"LEVEL") + 4, (char*)buf);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy((int)(getmaxx() * 0.45), 6,  (char*)"LENGTH");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(LIGHTMAGENTA);
    snprintf(buf, sizeof(buf), "%d", g.len);
    outtextxy((int)(getmaxx() * 0.45), 6 + textheight((char*)"LENGTH") + 4, (char*)buf);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy((int)(getmaxx() * 0.62), 6,  (char*)"HI-SCORE");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(LIGHTGREEN);
    snprintf(buf, sizeof(buf), "%d", highScore(db));
    outtextxy((int)(getmaxx() * 0.62), 6 + textheight((char*)"HI-SCORE") + 4, (char*)buf);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY);
    outtextxy(getmaxx() - textwidth((char*)DIFFS[g.diff].label) - 18, 6,
              (char*)DIFFS[g.diff].label);

    /* bonus timer bar on the right, shrinking as it expires */
    if (g.bonusOn) {
        setfillstyle(SOLID_FILL, YELLOW);
        int w = 100 * g.bonusTimer / 40;
        if (w < 2) { w = 2; }
        bar(getmaxx() - 118, 34, getmaxx() - 118 + w, 42);
    }

    setcolor(DARKGRAY);
    setlinestyle(SOLID_LINE, 0, 2);
    line(0, HUD_H + 2, getmaxx(), HUD_H + 2);
    setlinestyle(SOLID_LINE, 0, 1);
}

static void drawFooterHint ( const char* hint )
{
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, arenaY() + ROWS * cellPx() + 8, getmaxx(), getmaxy());
    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
    setcolor(LIGHTGRAY);
    int w = textwidth((char*)hint);
    outtextxy((getmaxx() - w) / 2, arenaY() + ROWS * cellPx() + 12, (char*)hint);
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
        panel(getmaxx() / 2 - 190, getmaxy() / 2 - 74,
              getmaxx() / 2 + 190, getmaxy() / 2 + 74, YELLOW);
        textCentered(getmaxy() / 2 - 56, "PAUSED", YELLOW, GOTHIC_FONT, fsz(5));
        textCentered(getmaxy() / 2 + 16, "P / Space - resume", WHITE, DEFAULT_FONT, fsz(2));
        textCentered(getmaxy() / 2 + 38, "Q - back to the menu", WHITE, DEFAULT_FONT, fsz(2));
    }

    present();
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

static void drawMenuDeco ( int boxBottom )
{
    /* a little decorative snake chasing an apple under the menu panel
     * (pure pixel anchors — stays put at any window size) */
    int cell = 12;
    int y = boxBottom + 8;
    int x = getmaxx() / 2 - 110;
    if (y + cell + 8 > getmaxy() - 56) { return; }   /* no room: skip */
    for (int i = 0; i < 6; i++) {
        setfillstyle(SOLID_FILL, i == 5 ? LIGHTGREEN : GREEN);
        bar(x + i * cell, y, x + i * cell + cell - 2, y + cell - 2);
    }
    setfillstyle(SOLID_FILL, RED);
    fillellipse(x + 6 * cell + 16, y + cell / 2, 6, 6);
}

static void drawMenu ( int selection, int diff, const GameDB& db )
{
    char diffRow[64], sizeRow[64], soundRow[64];
    const char* ITEMS[7];
    int fontSize = fsz(3);
    int rowH = fontSize * 8 + 20;
    int boxItems = 7;
    int maxHalf = 0, barHalf, i;

    snprintf(diffRow, sizeof(diffRow), "Difficulty:  %s", DIFFS[diff].label);
    snprintf(sizeRow, sizeof(sizeRow), "Window:  %s", SIZES[db.winSize].label);
    snprintf(soundRow, sizeof(soundRow), "Sound:  %s", soundOn ? "ON" : "OFF");
    ITEMS[0] = "Start Game"; ITEMS[1] = diffRow; ITEMS[2] = sizeRow;
    ITEMS[3] = soundRow; ITEMS[4] = "High Scores"; ITEMS[5] = "Help";
    ITEMS[6] = "Quit";

    cleardevice();

    shadowCentered(26, "SNAKE", GREEN, GOTHIC_FONT, fsz(7));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(7));
    int boxTop = 20 + textheight((char*)"SNAKE") + 24;
    int boxH = boxItems * rowH + 20;
    if (boxTop + boxH > getmaxy() - 96) { boxTop = getmaxy() - 96 - boxH; }
    if (boxTop < 10) { boxTop = 10; }

    /* the selection bar wraps the widest row, but never the screen */
    for (i = 0; i < boxItems; i++) {
        int w = textwidth((char*)ITEMS[i]);
        if (w > maxHalf) { maxHalf = w; }
    }
    barHalf = maxHalf / 2 + 56;
    if (barHalf > getmaxx() / 2 - 28) { barHalf = getmaxx() / 2 - 28; }

    panel(getmaxx() / 2 - barHalf - 20, boxTop,
          getmaxx() / 2 + barHalf + 20, boxTop + boxH, DARKGRAY);

    for (i = 0; i < boxItems; i++) {
        int y = boxTop + 12 + i * rowH;
        bool sel = (i == selection);
        if (sel) {
            /* the three-way selection: bright bar + black text + white
             * underline. Any ONE of them surviving a platform quirk is
             * enough to show exactly which row is selected. */
            setfillstyle(SOLID_FILL, GREEN);
            bar(getmaxx() / 2 - barHalf, y - 6,
                getmaxx() / 2 + barHalf, y + fontSize * 8 + 6);
            setfillstyle(SOLID_FILL, WHITE);
            bar(getmaxx() / 2 - barHalf, y + fontSize * 8 + 6,
                getmaxx() / 2 + barHalf, y + fontSize * 8 + 9);
            setfillstyle(SOLID_FILL, BLACK);   /* bar() borrows the fill */
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        setcolor(sel ? BLACK : WHITE);
        int w = textwidth((char*)ITEMS[i]);
        outtextxy(getmaxx() / 2 - w / 2, y, (char*)ITEMS[i]);
        if (sel) {
            setcolor(BLACK);
            outtextxy(getmaxx() / 2 - barHalf + 10, y, (char*)">");
            outtextxy(getmaxx() / 2 + barHalf - 10
                      - textwidth((char*)"<"), y, (char*)"<");
        }
    }

    drawMenuDeco(boxTop + boxH);

    char hi[96];
    snprintf(hi, sizeof(hi), "hi-score %d   |   games played %d",
             highScore(db), db.gamesPlayed);
    textCentered(getmaxy() - 64, hi, LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40,
        "W/S choose   Enter select   <-/-> change   +/- size",
        DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

static void cycleDifficulty ( int& diff, int dir )
{
    diff = (diff + dir + DIFF_COUNT) % DIFF_COUNT;
}

static void drawDifficulty ( int selection )
{
    int fontSize = fsz(3);
    int hintSize = fsz(2);
    int rowH = fontSize * 8 + hintSize * 8 + 20;
    cleardevice();
    shadowCentered(64, "DIFFICULTY", LIGHTCYAN, GOTHIC_FONT, fsz(6));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(6));
    int boxTop = 56 + textheight((char*)"DIFFICULTY") + 30;
    int boxH = DIFF_COUNT * rowH + 24;
    if (boxTop + boxH > getmaxy() - 96) { boxTop = getmaxy() - 96 - boxH; }

    panel(getmaxx() / 2 - 280, boxTop, getmaxx() / 2 + 280, boxTop + boxH, DARKGRAY);

    for (int i = 0; i < DIFF_COUNT; i++) {
        int y = boxTop + 14 + i * rowH;
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, LIGHTCYAN);
            bar(getmaxx() / 2 - 260, y - 7,
                getmaxx() / 2 + 260, y + fontSize * 8 + hintSize * 8 + 7);
            setfillstyle(SOLID_FILL, WHITE);
            bar(getmaxx() / 2 - 260, y + fontSize * 8 + hintSize * 8 + 7,
                getmaxx() / 2 + 260, y + fontSize * 8 + hintSize * 8 + 10);
            setfillstyle(SOLID_FILL, BLACK);
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        setcolor(sel ? BLACK : WHITE);
        outtextxy(getmaxx() / 2 - 240, y, (char*)DIFFS[i].label);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, hintSize);
        setcolor(sel ? BLACK : LIGHTGRAY);
        outtextxy(getmaxx() / 2 - 240, y + fontSize * 8 + 2,
                  (char*)DIFF_HINTS[i]);
    }
    textCentered(getmaxy() - 64, "W/S choose   Enter play",
                 LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40, "Esc - back", DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

/* The window-size picker. Changing the size here (or pressing + / - in
 * the menu) re-creates the window; dragging the borders works too — the
 * whole layout recomputes itself from getmaxx()/getmaxy() every frame. */
static void drawWindowSizes ( int selection )
{
    int fontSize = fsz(3);
    int rowH = fontSize * 8 + 24;
    cleardevice();
    shadowCentered(64, "WINDOW SIZE", LIGHTGREEN, GOTHIC_FONT, fsz(6));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(6));
    int boxTop = 56 + textheight((char*)"WINDOW SIZE") + 30;
    int boxH = 4 * rowH + 24;
    if (boxTop + boxH > getmaxy() - 96) { boxTop = getmaxy() - 96 - boxH; }

    panel(getmaxx() / 2 - 280, boxTop, getmaxx() / 2 + 280, boxTop + boxH, DARKGRAY);

    static const char* HINTS[4] = {
        "big on any screen",
        "classic graphics.h size",
        "recommended - roomy",
        "for large displays"
    };

    for (int i = 0; i < 4; i++) {
        int y = boxTop + 16 + i * rowH;
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, LIGHTGREEN);
            bar(getmaxx() / 2 - 260, y - 7,
                getmaxx() / 2 + 260, y + fontSize * 8 + 7);
            setfillstyle(SOLID_FILL, WHITE);
            bar(getmaxx() / 2 - 260, y + fontSize * 8 + 7,
                getmaxx() / 2 + 260, y + fontSize * 8 + 10);
            setfillstyle(SOLID_FILL, BLACK);
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        setcolor(sel ? BLACK : WHITE);
        outtextxy(getmaxx() / 2 - 240, y, (char*)SIZES[i].label);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
        setcolor(sel ? BLACK : LIGHTGRAY);
        outtextxy(getmaxx() / 2 - 240 + textwidth((char*)SIZES[i].label) + 28,
                  y + (fontSize * 8 - 8) / 2 + 1, (char*)HINTS[i]);
    }
    textCentered(getmaxy() - 64,
                 "Enter - apply, or just drag the borders",
                 LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40, "W/S - choose   Esc - back", DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

static void drawHelp ( )
{
    cleardevice();
    shadowCentered(48, "HOW TO PLAY", YELLOW, GOTHIC_FONT, fsz(6));

    int l = 60, t = 60 + textheight((char*)"HOW TO PLAY") + 20, r = getmaxx() - 60;
    int b = getmaxy() - 96;
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
        { "Window size",    "drag the borders, or pick S/M/L/XL in the menu" },
        { "Sound",          "ON/OFF in the menu - effects on every event" },
        { "High scores",    "the top 5 are saved in snake_scores.db" }
    };
    int keySize = fsz(2);
    int rowStep = keySize * 8 + 12;
    int y = t + 20;
    int maxRows = (b - t - 36) / rowStep;
    for (size_t i = 0; i < sizeof(ROWS) / sizeof(ROWS[0]) && (int) i < maxRows; i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, keySize);
        setcolor(YELLOW);
        outtextxy(l + 28, y, (char*)ROWS[i].k);
        setcolor(WHITE);
        outtextxy(l + 260, y, (char*)ROWS[i].v);
        y += rowStep;
    }
    textCentered(getmaxy() - 64, "Esc / Enter / Q - back", LIGHTGRAY, DEFAULT_FONT, fsz(2));

    present();
}

static void drawScores ( const GameDB& db )
{
    cleardevice();
    shadowCentered(48, "HIGH SCORES", LIGHTGREEN, GOTHIC_FONT, fsz(6));

    int l = 70, t = 60 + textheight((char*)"HIGH SCORES") + 20;
    int r = getmaxx() - 70, b = getmaxy() - 118;
    panel(l, t, r, b, DARKGRAY);

    int fontSize = fsz(2);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
    setcolor(LIGHTGRAY);
    outtextxy(l + 28, t + 18, (char*)"#");
    outtextxy(l + 76, t + 18, (char*)"NAME");
    outtextxy(l + 250, t + 18, (char*)"SCORE");
    outtextxy(l + 370, t + 18, (char*)"LEVEL");
    outtextxy(l + 460, t + 18, (char*)"WHEN");

    int y = t + 18 + fontSize * 8 + 18;
    int rowStep = fontSize * 8 + 16;
    if (db.count == 0) {
        setcolor(DARKGRAY);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
        outtextxy(l + 28, y + 16, (char*)"no scores yet - play a game and claim the first rank!");
    }
    for (int i = 0; i < db.count; i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        setcolor(i == 0 ? YELLOW : WHITE);
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", i + 1);
        outtextxy(l + 28, y, (char*)buf);
        outtextxy(l + 76, y, (char*)db.top[i].name);
        snprintf(buf, sizeof(buf), "%d", db.top[i].score);
        outtextxy(l + 250, y, (char*)buf);
        snprintf(buf, sizeof(buf), "%d", db.top[i].level);
        outtextxy(l + 370, y, (char*)buf);
        setcolor(LIGHTGRAY);
        outtextxy(l + 460, y, (char*)db.top[i].when);
        y += rowStep;
    }

    char stats[96];
    snprintf(stats, sizeof(stats), "games played %d  |  apples eaten %d",
             db.gamesPlayed, db.applesEaten);
    textCentered(b + 16, stats, LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 64, "C C - clear the table (press C twice)", DARKGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40, "Esc - back", DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

/* Name entry after a top-5 score. Mutates nothing until Enter. */
static void drawNameEntry ( const char* name, int score, int rank )
{
    cleardevice();
    shadowCentered(96, "NEW HIGH SCORE!", YELLOW, GOTHIC_FONT, fsz(6));

    char buf[64];
    snprintf(buf, sizeof(buf), "rank #%d  |  %d points", rank, score);
    textCentered(96 + textheight((char*)"NEW HIGH SCORE!") + 22, buf, WHITE, DEFAULT_FONT, fsz(2));

    int l = getmaxx() / 2 - 280, t = 96 + textheight((char*)"NEW HIGH SCORE!") + 78;
    int r = getmaxx() / 2 + 280, b = t + 190;
    if (b > getmaxy() - 20) { b = getmaxy() - 20; t = b - 190; }
    panel(l, t, r, b, YELLOW);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
    setcolor(LIGHTGRAY);
    outtextxy(l + 30, t + 26, (char*)"type your name, then press Enter");

    /* the name itself, big, with a block cursor at the end */
    static int blink = 0;
    char shown[SNAKE_NAME_MAX + 3];
    snprintf(shown, sizeof(shown), "%s", name);
    if ((blink++ / 8) % 2 == 0) {
        int n = (int)strlen(name);
        if (n < SNAKE_NAME_MAX) { shown[n] = '_'; shown[n + 1] = '\0'; }
    }
    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(4));
    setcolor(YELLOW);
    outtextxy(l + 30, t + 84, (char*)shown);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
    setcolor(DARKGRAY);
    outtextxy(l + 30, b - 38, (char*)"letters, digits and spaces - Backspace deletes - Esc skips");

    present();
}

/* Game-over card. Returns the next action: 0 menu, 1 play again. */
static int drawGameOver ( const Game& g, const GameDB& db, bool newRecord, int rank )
{
    cleardevice();

    shadowCentered(104, "GAME OVER", RED, GOTHIC_FONT, fsz(7));

    if (newRecord) {
        char buf[64];
        snprintf(buf, sizeof(buf), "NEW HIGH SCORE - rank #%d!", rank);
        textCentered(104 + textheight((char*)"GAME OVER") + 24, buf, YELLOW, DEFAULT_FONT, fsz(2));
    }

    int l = getmaxx() / 2 - 210, t = 104 + textheight((char*)"GAME OVER") + 76;
    int r = getmaxx() / 2 + 210, b = t + 186;
    if (b > getmaxy() - 76) { b = getmaxy() - 76; t = b - 186; }
    panel(l, t, r, b, DARKGRAY);

    char buf[64];
    int labelSize = fsz(2);
    int valueSize = fsz(3);
    int rowStep = labelSize * 8 + 14;
    int y = t + 22;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy(l + 30, y, (char*)"score");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(YELLOW);
    snprintf(buf, sizeof(buf), "%d", g.score);
    outtextxy(r - 30 - textwidth((char*)buf), y - 4, (char*)buf);
    y += rowStep;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy(l + 30, y, (char*)"level");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(LIGHTCYAN);
    snprintf(buf, sizeof(buf), "%d", g.level);
    outtextxy(r - 30 - textwidth((char*)buf), y - 4, (char*)buf);
    y += rowStep;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy(l + 30, y, (char*)"apples");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(RED);
    snprintf(buf, sizeof(buf), "%d", g.apples);
    outtextxy(r - 30 - textwidth((char*)buf), y - 4, (char*)buf);
    y += rowStep;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY); outtextxy(l + 30, y, (char*)"best ever");
    settextstyle(DEFAULT_FONT, HORIZ_DIR, valueSize);
    setcolor(LIGHTGREEN);
    snprintf(buf, sizeof(buf), "%d", highScore(db));
    outtextxy(r - 30 - textwidth((char*)buf), y - 4, (char*)buf);

    textCentered(b + 18, "Enter / N - play again      Q / Esc - menu", WHITE, DEFAULT_FONT, fsz(2));
    textCentered(b + 40, DIFF_HINTS[g.diff], DARKGRAY, DEFAULT_FONT, fsz(2));

    present();

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
                char name[SNAKE_NAME_MAX + 1];
                strncpy(name, db.name, SNAKE_NAME_MAX); name[SNAKE_NAME_MAX] = '\0';
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
                        if (nameLen < SNAKE_NAME_MAX && !(nameLen == 0 && c == ' ')) {
                            name[nameLen++] = c; name[nameLen] = '\0';
                        }
                    }
                }
                if (nameLen == 0) { strncpy(name, "PLAYER", SNAKE_NAME_MAX); name[SNAKE_NAME_MAX] = '\0'; }
                strncpy(db.name, name, SNAKE_NAME_MAX); db.name[SNAKE_NAME_MAX] = '\0';
                insertScore(db, name, g.score, g.level);
            }
            db.gamesPlayed++;
            db.applesEaten += g.apples;
            saveDatabase(db);
            int next = drawGameOver(g, db, record, rank);
            return next == 1 ? 1 : 0;
        }

        drawGame(g, db);
        delay(g.tickDelay);
    }
}

/* ==========================================================================
 * SECTION 10 — main(): the little state machine that ties it all together
 * ========================================================================== */

/* Opens the game window. THE important platform difference: on Windows
 * (WinBGIm) the last initwindow argument true enables DOUBLE BUFFERING,
 * and swapbuffers() flips it. On SDL_bgi there are always several pages,
 * so setactivepage(1) moves drawing off-screen and swapbuffers() flips
 * between the two. Without this, every frame would flicker. */
static void openWindow ( const GameDB& db )
{
#ifdef _WIN32
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h,
               "SNAKE - graphics.h", 0, 0, true);
#else
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h);
    setactivepage(1);                  /* draw off-screen, flip on present */
#endif
}

/* Re-creates the window at a new preset size (menu row / + and - keys).
 * Every draw call computes its layout from getmaxx()/getmaxy() fresh, so
 * nothing else needs to change. On SDL_bgi the window is ALSO freely
 * resizable by dragging its borders — the board re-fits automatically. */
static void applyWindowSize ( const GameDB& db )
{
    closegraph();
    openWindow(db);
}

int main ( int argc, char* argv[] )
{
    /* battery hook: BGI_AUTOEXIT_MS=12000 -> play a 12 s demo and exit 0 */
    { const char* ae = getenv("BGI_AUTOEXIT_MS");
      if (ae) { demoExitMs = atol(ae); if (demoExitMs > 0) { demoMode = true; } } }

    srand((unsigned)time(NULL));
    resolveDbPath(argc > 0 ? argv[0] : "");

    GameDB db;
    loadDatabase(db);                 /* also restores sound + window size */

    openWindow(db);
    sfxInit();

    Game g;
    memset(&g, 0, sizeof(g));

    /* screenshot hook: BGI_SCREENSHOT=<screen> renders that one screen
     * (with a fresh demo game where one is needed), presents it and
     * exits 0 — the visual regression battery navigates nothing. */
    { const char* shot = getenv("BGI_SCREENSHOT");
      if (shot && shot[0]) {
          if (strcmp(shot, "difficulty") == 0)      { drawDifficulty(1); }
          else if (strcmp(shot, "scores") == 0)     { drawScores(db); }
          else if (strcmp(shot, "help") == 0)       { drawHelp(); }
          else if (strcmp(shot, "game") == 0)       { resetGame(g, DIFF_MEDIUM); drawGame(g, db); }
          else                                      { drawMenu(0, DIFF_MEDIUM, db); }
          delay(2500);   /* visible long enough for the battery grab */
          closegraph();
          return 0;
      } }

    int screen = 0;                   /* 0 menu, 1 difficulty, 2 scores, 3 help */
    int selection = 0;
    int diffSelection = DIFF_MEDIUM;
    int diff = DIFF_MEDIUM;

    demoStart = time(NULL);

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
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) {
                selection = (selection + 6) % 7; playSfx(SFX_TICK);
            }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) {
                selection = (selection + 1) % 7; playSfx(SFX_TICK);
            }
            if (k == K_PLUS || k == K_MINUS) {
                int dir = (k == K_PLUS) ? 1 : -1;
                db.winSize = (db.winSize + dir + 4) % 4;
                saveDatabase(db);
                applyWindowSize(db);
                playSfx(SFX_TICK);
            }
            if (selection == 1) {
                if (k == K_LEFT  || (k == K_LETTER && readKeyLetter == 'a')) {
                    cycleDifficulty(diff, -1); playSfx(SFX_TICK); saveDatabase(db);
                }
                if (k == K_RIGHT || (k == K_LETTER && readKeyLetter == 'd')) {
                    cycleDifficulty(diff, 1);  playSfx(SFX_TICK); saveDatabase(db);
                }
            }
            if (selection == 2) {
                if (k == K_LEFT  || (k == K_LETTER && readKeyLetter == 'a')) {
                    db.winSize = (db.winSize + 3) % 4;
                    saveDatabase(db); applyWindowSize(db); playSfx(SFX_TICK);
                }
                if (k == K_RIGHT || (k == K_LETTER && readKeyLetter == 'd')) {
                    db.winSize = (db.winSize + 1) % 4;
                    saveDatabase(db); applyWindowSize(db); playSfx(SFX_TICK);
                }
            }
            if (selection == 3) {
                if (k == K_LEFT  || k == K_RIGHT
                    || (k == K_LETTER && (readKeyLetter == 'a' || readKeyLetter == 'd'))) {
                    soundOn = !soundOn;
                    saveDatabase(db); playSfx(SFX_TICK);
                }
            }
            if (k == K_ESC) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                if (selection == 0) {
                    resetGame(g, diff);
                    int rc = playLoop(g, db);
                    if (rc == 1) { continue; }            /* play again */
                    if (rc == 2) { break; }               /* window closed */
                    selection = 0;
                } else if (selection == 1) {
                    diffSelection = diff;
                    screen = 1;                           /* difficulty picker */
                } else if (selection == 2) {
                    diffSelection = db.winSize;           /* reuse as picker  */
                    screen = 4;                           /* window size      */
                } else if (selection == 4) {
                    screen = 2;                           /* high scores */
                } else if (selection == 5) {
                    screen = 3;                           /* help */
                } else if (selection == 6) {
                    break;                                /* quit */
                }
            }
        } else if (screen == 1) {                         /* -- difficulty - */
            drawDifficulty(diffSelection);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { diffSelection = (diffSelection + DIFF_COUNT - 1) % DIFF_COUNT; playSfx(SFX_TICK); }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { diffSelection = (diffSelection + 1) % DIFF_COUNT; playSfx(SFX_TICK); }
            if (k == K_ENTER || k == K_SPACE) { diff = diffSelection; saveDatabase(db); screen = 0; selection = 0; }
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
        } else if (screen == 4) {                         /* -- window size - */
            drawWindowSizes(diffSelection);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { diffSelection = (diffSelection + 3) % 4; playSfx(SFX_TICK); }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { diffSelection = (diffSelection + 1) % 4; playSfx(SFX_TICK); }
            if (k == K_ENTER || k == K_SPACE) {
                if (diffSelection != db.winSize) {
                    db.winSize = diffSelection;
                    saveDatabase(db);
                    applyWindowSize(db);
                }
                screen = 0; selection = 2; playSfx(SFX_TICK);
            }
            if (k == K_ESC) { screen = 0; }
        }
    }

    closegraph();
    return 0;
}
