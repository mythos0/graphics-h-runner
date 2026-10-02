/* ==========================================================================
 * 02_football_game.cpp — 2-PLAYER FOOTBALL, the graphics.h showpiece
 * ==========================================================================
 * A complete top-down football (soccer) match for two players on one
 * keyboard, written with classic graphics.h — with ONE special twist:
 *
 *   THE PITCH IS DRAWN WITHOUT A SINGLE BUILT-IN SHAPE FUNCTION.
 *   No rectangle(), no circle(), no bar(), no line(), no fillellipse().
 *   Every line, circle, disc and net on the field comes from the small
 *   hand-written primitives in SECTION 5 — a DDA-flavoured Bresenham
 *   line, the midpoint circle with 8-way symmetry, scanline-filled
 *   discs — all built from nothing but putpixel(). Read SECTION 5 to
 *   learn how the classics really work.
 *
 *   - Player 1 (REDS,    light red):  W A S D to run,  SPACE to kick
 *   - Player 2 (SKYBLUES, cyan):      Arrow keys to run, ENTER to kick
 *   - Tap the kick key for a pass, HOLD it to charge a heavy shot
 *   - Two AI goalkeepers keep the score honest; they catch and throw
 *   - Street-rules bounces: the ball rebounds off the boards, the posts
 *     clank, and the nets swallow goals
 *   - Real match flow: kickoff countdown, two halves with side swap,
 *     goal celebrations, half time, full time with shots + possession
 *   - Sound effects (short synthesized tones, toggle in the menu)
 *   - Double-buffered, flicker-free rendering on every platform
 *   - The window is RESIZABLE: drag its borders (SDL_bgi), or pick
 *     S / M / L / XL in the menu (+ / - works anywhere)
 *   - A tiny file "database" (football_scores.db) remembers the derby:
 *     wins and goals for both clubs, plus sound and window settings
 *
 * PORTABILITY NOTES:
 *   1. Held keys: a running player needs KEY STATE, not key events.
 *      keyHeld() reads the keyboard directly on both platforms:
 *      GetAsyncKeyState() on Windows (user32.dll, loaded at runtime so
 *      the compile line never changes) and SDL_GetKeyboardState() on
 *      SDL_bgi. Menus still use the classic kbhit()/getch() events.
 *   2. Extended keys / window close: same treatment as 01_snake_game.cpp
 *      (readKey() normalises both platforms; QUIT exits cleanly).
 *
 * Headless test batteries set BGI_AUTOEXIT_MS: both players are then
 * driven by a small demo AI and the program exits cleanly (nothing is
 * saved). BGI_SCREENSHOT=menu|controls|game|goal|fulltime renders one
 * screen, presents it and exits 0 — the visual regression battery.
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
 * SECTION 1 — world geometry and tuning constants
 * --------------------------------------------------------------------------
 * The match is played in a fixed WORLD of PITCH_W x PITCH_H units —
 * exactly a real pitch's proportions (105 m x 68 m, one unit = 10 cm).
 * The window only chooses the VIEW SCALE, so a resize never moves the
 * ball. All speeds below are world units per tick (~70 ticks/second).
 * ========================================================================== */

static const int PITCH_W = 1050;       /* touchline to touchline          */
static const int PITCH_H = 680;        /* goal line to goal line          */
static const int GOAL_HALF = 80;       /* half the goal mouth width       */
static const int GOAL_DEPTH = 26;      /* how far the net reaches back    */
static const int PEN_D  = 165;         /* penalty area depth              */
static const int PEN_HALF = 201;       /* penalty area half width         */
static const int SIX_D  = 55;          /* six-yard box depth              */
static const int SIX_HALF = 92;        /* six-yard box half width         */
static const int CIRC_R = 91;          /* centre circle radius            */
static const int PEN_SPOT = 110;       /* penalty spot from goal line     */

static const double BALL_R      = 7.0;
static const double PL_R        = 14.0;
static const double GK_R        = 15.0;
static const double PL_ACCEL    = 1.05;
static const double PL_MAX      = 3.6;
static const double PL_FRICTION = 0.855;
static const double BALL_FRICTION = 0.988;
static const double NET_FRICTION  = 0.70;
static const double WALL_BOUNCE   = 0.72;
static const double KICK_MIN    = 7.0;
static const double KICK_MAX    = 13.5;
static const double KICK_CHARGE = 0.16;   /* extra power per charge tick  */
static const int    CHARGE_MAX  = 26;

/* window size presets, indexed by the winsize= value in the database */
struct WinSize { const char* label; int w, h; };
static const WinSize SIZES[4] = {
    { "S  640x480",  640, 480 },
    { "M  800x600",  800, 600 },
    { "L  960x640",  960, 640 },
    { "XL 1200x800", 1200, 800 }
};
static const int SIZE_DEFAULT = 2;              /* L 960x640          */

static const int HUD_H = 56;           /* score bar above the pitch       */

/* ---- responsive view ---------------------------------------------------
 * pitchScale() fits the whole pitch (plus net depth) into the space
 * below the HUD; pitchX()/pitchY() centre it. Call fresh every frame. */
static double pitchScale ( void )
{
    double sw = (getmaxx() + 1 - 26.0) / (PITCH_W + 2.0 * GOAL_DEPTH + 10);
    double sh = (getmaxy() + 1 - HUD_H - 12.0) / (PITCH_H + 10.0);
    double s = sw < sh ? sw : sh;
    if (s < 0.30) { s = 0.30; }
    if (s > 1.10) { s = 1.10; }
    return s;
}
static int pitchX ( void )
{
    return (getmaxx() + 1
            - (int)((PITCH_W + 2.0 * GOAL_DEPTH) * pitchScale())) / 2;
}
static int pitchY ( void ) { return HUD_H + 4; }

/* font size helper: scales a base bitmap-font size with the window
 * height (always >= 2), so text stays readable on any window */
static int fsz ( int base )
{
    int s = base * (getmaxy() + 240) / 640;
    if (s < base) { s = base; }
    if (s < 2)    { s = 2; }
    return s;
}

/* ==========================================================================
 * SECTION 2 — platform-neutral key handling
 * --------------------------------------------------------------------------
 * readKey()/pollKey() (events, for menus and discrete actions) work
 * exactly like in 01_snake_game.cpp. The match itself uses keyHeld()
 * below — key STATE, because held keys never generate new events.
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
        case 1073741906: return K_UP;      /* SDLK_UP    */
        case 1073741905: return K_DOWN;    /* SDLK_DOWN  */
        case 1073741904: return K_LEFT;    /* SDLK_LEFT  */
        case 1073741903: return K_RIGHT;   /* SDLK_RIGHT */
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

/* Polled variant used between frames: K_NONE when no key waits. */
static int pollKey ( )
{
    if (!kbhit()) { return K_NONE; }
    return readKey();
}

/* ---- key STATE for the running match -----------------------------------
 * keyHeld(code) is true while the key is physically held down:
 *   - SDL_bgi: SDL_GetKeyboardState — SDL2 is already linked
 *   - Windows: GetAsyncKeyState from user32.dll, loaded at runtime so
 *     the compile line stays identical to every other graphics.h file */
#ifdef _WIN32

#define KH_W      0
#define KH_A      1
#define KH_S      2
#define KH_D      3
#define KH_UP     4
#define KH_DOWN   5
#define KH_LEFT   6
#define KH_RIGHT  7
#define KH_SPACE  8
#define KH_ENTER  9

typedef unsigned short KH_SHORT;
static KH_SHORT (WINAPI *khGetAsync)(int) = NULL;

static void keyHeldInit ( void )
{
    HMODULE u32 = LoadLibraryA("user32.dll");
    if (!u32) { return; }
    khGetAsync = (KH_SHORT (WINAPI *)(int))
                 GetProcAddress(u32, "GetAsyncKeyState");
}

static int keyHeld ( int code )
{
    if (!khGetAsync) { return 0; }
    static const int VK[10] = { 0x57, 0x41, 0x53, 0x44, 0x26, 0x28, 0x25,
                                0x27, 0x20, 0x0D };
    return (khGetAsync(VK[code]) & 0x8000) != 0;
}

#else

#include <SDL2/SDL.h>

#define KH_W      0
#define KH_A      1
#define KH_S      2
#define KH_D      3
#define KH_UP     4
#define KH_DOWN   5
#define KH_LEFT   6
#define KH_RIGHT  7
#define KH_SPACE  8
#define KH_ENTER  9

static const Uint8* khState = NULL;

static void keyHeldInit ( void )
{
    khState = SDL_GetKeyboardState(NULL);
}

static int keyHeld ( int code )
{
    if (!khState) { return 0; }
    static const SDL_Scancode SC[10] = {
        SDL_SCANCODE_W, SDL_SCANCODE_A, SDL_SCANCODE_S, SDL_SCANCODE_D,
        SDL_SCANCODE_UP, SDL_SCANCODE_DOWN, SDL_SCANCODE_LEFT,
        SDL_SCANCODE_RIGHT, SDL_SCANCODE_SPACE, SDL_SCANCODE_RETURN
    };
    return khState[SC[code]] != 0;
}

#endif

/* ==========================================================================
 * SECTION 3 — tiny sound effects (optional, off switch in the menu)
 * --------------------------------------------------------------------------
 * The same design as 01_snake_game.cpp: five-plus short synthesized
 * tones, built once from an envelope table, played fire-and-forget —
 * PlaySoundA() from winmm.dll on Windows (runtime loaded), SDL audio
 * queues on SDL_bgi. Silent no-op when off or unavailable.
 * ========================================================================== */

static bool soundOn = true;

enum { SFX_TICK = 0, SFX_PASS, SFX_SHOT, SFX_BOUNCE, SFX_POST,
       SFX_GOAL, SFX_WHISTLE, SFX_CATCH, SFX_COUNT };

/* one effect = a frequency sweep (Hz) + duration (ms) + decay shape:
 *   0 steady blip, 1 fast decay, 2 rising swell, 3 long fade,
 *   4 double-trill (whistle)                                     */
struct SfxSpec { int f0, f1, ms, shape; };
static const SfxSpec SFX[SFX_COUNT] = {
    { 1250, 1150,  30, 0 },    /* menu tick                             */
    {  700,  500,  55, 1 },    /* soft pass: low thump                  */
    {  480,  260,  90, 1 },    /* heavy shot: big thump                 */
    {  900,  700,  40, 1 },    /* board bounce: hollow knock            */
    { 1900, 1400, 120, 3 },    /* post: metallic clank                  */
    {  620, 1240, 340, 2 },    /* goal: rising fanfare                  */
    { 2100, 1700, 260, 4 },    /* whistle: referee trill                */
    {  420,  330,  70, 1 }     /* keeper catch: gloves thud             */
};

#define SFX_RATE 22050

static int buildSfxSamples ( int id, signed short* out, int maxSamples )
{
    const SfxSpec& s = SFX[id];
    int n = s.ms * SFX_RATE / 1000;
    int i;
    if (n > maxSamples) { n = maxSamples; }
    for (i = 0; i < n; i++) {
        double t = (double) i / n;
        double f, wave, env;
        if (s.shape == 4) {
            /* referee whistle: two fast trills, then a long note */
            f = s.f0;
            double trill = sin(2 * 3.14159265358979 * 38 * i / SFX_RATE);
            wave = 0.8 * sin(2 * 3.14159265358979 * f * i / SFX_RATE)
                 + 0.2 * (trill > 0.0 ? 0.9 : -0.9);
            env = (t < 0.08) ? t / 0.08 : (t > 0.85 ? (1.0 - t) / 0.15 : 1.0);
        } else {
            f = s.f0 + (s.f1 - s.f0) * t;
            double phase = 2 * 3.14159265358979 * f * i / SFX_RATE;
            wave = 0.65 * sin(phase)
                 + 0.35 * ((sin(phase) >= 0.0) ? 0.8 : -0.8);
            switch (s.shape) {
                case 1:  env = (1.0 - t) * (1.0 - t); break;
                case 2:  env = 0.25 + 0.75 * sin(3.14159265358979 * t); break;
                case 3:  env = (1.0 - t) * (1.0 - t) * (1.0 - t); break;
                default: env = (t < 0.15) ? t / 0.15
                                          : 1.0 - (t - 0.15) / 0.85;
            }
        }
        double v = wave * env * 0.42;
        out[i] = (signed short) (v * 32000);
    }
    return n;
}

#ifdef _WIN32

static unsigned char  sfxWav[SFX_COUNT][SFX_RATE];
static int            sfxWavLen[SFX_COUNT] = { 0 };
static int (WINAPI *sfxPlay)(const char*, void*, unsigned long) = NULL;

static void sfxWriteWav ( int id, int samples )
{
    unsigned char* w = sfxWav[id];
    int dataLen = samples * 2;
    memcpy(w,      "RIFF", 4);
    w[4] = (unsigned char)((36 + dataLen) & 0xFF);
    w[5] = (unsigned char)(((36 + dataLen) >> 8) & 0xFF);
    w[6] = (unsigned char)(((36 + dataLen) >> 16) & 0xFF);
    w[7] = (unsigned char)(((36 + dataLen) >> 24) & 0xFF);
    memcpy(w + 8,  "WAVEfmt ", 8);
    w[16] = 16; w[17] = 0; w[18] = 0; w[19] = 0;
    w[20] = 1; w[21] = 0;                 /* PCM            */
    w[22] = 1; w[23] = 0;                 /* mono           */
    w[24] = (unsigned char)(SFX_RATE & 0xFF); w[25] = 0;
    w[26] = (unsigned char)((SFX_RATE * 2) & 0xFF);
    w[27] = (unsigned char)(((SFX_RATE * 2) >> 8) & 0xFF);
    w[28] = 2; w[29] = 0;                 /* block align    */
    w[30] = 16; w[31] = 0;                /* bits           */
    memcpy(w + 36, "data", 4);
    w[40] = (unsigned char)(dataLen & 0xFF);
    w[41] = (unsigned char)((dataLen >> 8) & 0xFF);
    w[42] = (unsigned char)((dataLen >> 16) & 0xFF);
    w[43] = (unsigned char)((dataLen >> 24) & 0xFF);
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
    if (soundOn && sfxPlay) { sfxPlay((const char*) sfxWav[id], NULL, 0x2003); }
}

#else

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
    if (!sfxDev) { return; }
    for (i = 0; i < SFX_COUNT; i++) {
        sfxBufLen[i] = buildSfxSamples(i, sfxBuf[i], SFX_RATE) * 2;
    }
    SDL_PauseAudioDevice(sfxDev, 0);
}

static void playSfx ( int id )
{
    if (!soundOn || !sfxDev) { return; }
    SDL_ClearQueuedAudio(sfxDev);
    SDL_QueueAudio(sfxDev, sfxBuf[id], sfxBufLen[id]);
}

#endif

/* ==========================================================================
 * SECTION 4 — the tiny "database" (football_scores.db)
 * --------------------------------------------------------------------------
 * A plain text file next to the program that remembers the derby:
 *
 *     # graphics.h 2-Player Football save data
 *     version=1
 *     sound=ON
 *     winsize=2
 *     wins1=3            REDS club wins
 *     wins2=2            SKYBLUES club wins
 *     goals1=11          total goals scored by the REDS
 *     goals2=9           total goals scored by the SKYBLUES
 *     biggest=4|1        biggest win margin|which club
 *
 * loadDatabase() tolerates a missing or corrupted file; saveDatabase()
 * writes a temp file first and renames it, so a crash can never destroy
 * the old table.
 * ========================================================================== */

static const char* DB_FILENAME = "football_scores.db";

struct MatchDB {
    int  wins1, wins2;        /* derby wins per club                  */
    int  goals1, goals2;      /* total goals per club                 */
    int  bigMargin;           /* biggest win margin ever              */
    int  bigClub;             /* 1 or 2 — who owns that record        */
    int  winSize;             /* window preset index into SIZES[]     */
};

/* Where is the database? Next to the executable when possible (that is
 * the folder VS Code runs the program from), otherwise the current
 * directory. */
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
            *last = '\0';
            dir = exeDir;
        }
    }

    static char probe[1280];
    snprintf(probe, sizeof(probe), "%s/%s", dir, DB_FILENAME);
    dbPath[0] = '\0';
    FILE* f = fopen(probe, "ab");
    if (f) { fclose(f); }
    strncpy(dbPath, probe, sizeof(dbPath) - 1);
    dbPath[sizeof(dbPath) - 1] = '\0';
}

static int dbValue ( const char* line, const char* key )
{
    size_t n = strlen(key);
    if (strncmp(line, key, n) != 0) { return -1; }
    return atoi(line + n);
}

static void loadDatabase ( MatchDB& db )
{
    memset(&db, 0, sizeof(db));
    db.winSize = SIZE_DEFAULT;
    soundOn = true;

    FILE* f = fopen(dbPath, "r");
    if (!f) { return; }                       /* first run: clean defaults */

    char line[512];
    while (fgets(line, sizeof(line), f)) {
        for (char* c = line; *c; c++) { if (*c == '\n' || *c == '\r') { *c = '\0'; } }
        int v;
        if ((v = dbValue(line, "wins1="))  >= 0) { db.wins1 = v; }
        else if ((v = dbValue(line, "wins2="))  >= 0) { db.wins2 = v; }
        else if ((v = dbValue(line, "goals1=")) >= 0) { db.goals1 = v; }
        else if ((v = dbValue(line, "goals2=")) >= 0) { db.goals2 = v; }
        else if ((v = dbValue(line, "biggest=")) >= 0) {
            const char* bar = strchr(line, '|');
            db.bigMargin = v;
            db.bigClub = bar ? atoi(bar + 1) : 1;
        }
        else if ((v = dbValue(line, "winsize=")) >= 0) {
            db.winSize = (v >= 0 && v <= 3) ? v : SIZE_DEFAULT;
        }
        else if (strncmp(line, "sound=", 6) == 0) {
            soundOn = (strncmp(line + 6, "ON", 2) == 0);
        }
        /* unknown lines (comments, future fields) are ignored */
    }
    fclose(f);
}

static void saveDatabase ( const MatchDB& db )
{
    if (!dbPath[0]) { return; }
    static char tmp[1280];
    snprintf(tmp, sizeof(tmp), "%s.tmp", dbPath);

    FILE* f = fopen(tmp, "w");
    if (!f) { return; }                       /* read-only folder: skip */

    fprintf(f, "# graphics.h 2-Player Football save data\n");
    fprintf(f, "version=1\n");
    fprintf(f, "sound=%s\n", soundOn ? "ON" : "OFF");
    fprintf(f, "winsize=%d\n", db.winSize);
    fprintf(f, "wins1=%d\n", db.wins1);
    fprintf(f, "wins2=%d\n", db.wins2);
    fprintf(f, "goals1=%d\n", db.goals1);
    fprintf(f, "goals2=%d\n", db.goals2);
    fprintf(f, "biggest=%d|%d\n", db.bigMargin, db.bigClub);
    fclose(f);

    remove(dbPath);                           /* Windows needs this first */
    rename(tmp, dbPath);                      /* atomic-ish swap          */
}

/* ==========================================================================
 * SECTION 5 — hand-written drawing primitives (putpixel ONLY)
 * --------------------------------------------------------------------------
 * THE TEACHING SECTION. The whole pitch is rendered without a single
 * built-in shape call — no rectangle(), no circle(), no bar(), no
 * line(). Everything below is built from putpixel() alone:
 *
 *   px_hline / px_vline   axis-aligned runs — the two easy cases
 *   px_line               Bresenham's algorithm, integer only, all
 *                         octants, error term carried in one variable
 *   px_circle             the MIDPOINT circle: one decision variable,
 *                         eight-way symmetry (x,y) -> 8 pixels
 *   px_disc               filled circle: midpoint walk + horizontal
 *                         spans, no per-pixel distance test
 *   px_rect / px_rect_fill  outlines and spans
 *   px_ring_thick / px_line_thick   multi-pass strokes for the chalk
 *   px_net                the goal netting, a crosshatch of px_line
 *
 * They clip themselves against the window, so drawing near the edges
 * is always safe.
 * ========================================================================== */

static void px_put ( int x, int y, int c )
{
    if (x >= 0 && x <= getmaxx() && y >= 0 && y <= getmaxy()) {
        putpixel(x, y, c);
    }
}

static void px_hline ( int x1, int x2, int y, int c )
{
    int x, step = (x1 <= x2) ? 1 : -1;
    for (x = x1; x != x2 + step; x += step) { px_put(x, y, c); }
}

static void px_vline ( int x, int y1, int y2, int c )
{
    int y, step = (y1 <= y2) ? 1 : -1;
    for (y = y1; y != y2 + step; y += step) { px_put(x, y, c); }
}

/* Bresenham's line algorithm — the classic integer DDA: while walking
 * from one end to the other, an error term decides when to step in y
 * (or x). Works in every octant, no floats, no multiplications. */
static void px_line ( int x1, int y1, int x2, int y2, int c )
{
    int dx = x2 > x1 ? x2 - x1 : x1 - x2;
    int dy = y2 > y1 ? y2 - y1 : y1 - y2;
    int sx = x1 < x2 ? 1 : -1;
    int sy = y1 < y2 ? 1 : -1;
    int err = (dx > dy ? dx : -dy) / 2;

    for (;;) {
        px_put(x1, y1, c);
        if (x1 == x2 && y1 == y2) { break; }
        int e2 = err;
        if (e2 > -dx) { err -= dy; x1 += sx; }
        if (e2 <  dy) { err += dx; y1 += sy; }
    }
}

/* The MIDPOINT circle algorithm. Starting at (r,0) it walks clockwise,
 * keeping one decision variable d. If d > 0 the mid-point lies outside
 * the true circle, so take the flatter step and correct d with the
 * circle equation's second difference. Each computed pixel is mirrored
 * across all eight octants — 8 pixels per step. */
static void px_circle ( int cx, int cy, int r, int c )
{
    if (r < 0) { return; }
    int x = r, y = 0;
    int d = 1 - r;
    while (x >= y) {
        px_put(cx + x, cy + y, c);
        px_put(cx + y, cy + x, c);
        px_put(cx - y, cy + x, c);
        px_put(cx - x, cy + y, c);
        px_put(cx - x, cy - y, c);
        px_put(cx - y, cy - x, c);
        px_put(cx + y, cy - x, c);
        px_put(cx + x, cy - y, c);
        if (d < 0) {
            d += 2 * y + 3;
        } else {
            d += 2 * (y - x) + 5;
            x--;
        }
        y++;
    }
}

/* Filled circle: same midpoint walk, but every step fills the FULL
 * horizontal span (from -x to +x) for the top and bottom arcs — no
 * per-pixel inside test, so it stays fast even for big discs. */
static void px_disc ( int cx, int cy, int r, int c )
{
    if (r < 0) { return; }
    int x = r, y = 0;
    int d = 1 - r;
    while (x >= y) {
        px_hline(cx - x, cx + x, cy + y, c);
        px_hline(cx - x, cx + x, cy - y, c);
        if (x != y) {
            px_hline(cx - y, cx + y, cy + x, c);
            px_hline(cx - y, cx + y, cy - x, c);
        }
        if (d < 0) {
            d += 2 * y + 3;
        } else {
            d += 2 * (y - x) + 5;
            x--;
        }
        y++;
    }
}

static void px_rect ( int x1, int y1, int x2, int y2, int c )
{
    px_hline(x1, x2, y1, c);
    px_hline(x1, x2, y2, c);
    px_vline(x1, y1, y2, c);
    px_vline(x2, y1, y2, c);
}

static void px_rect_fill ( int x1, int y1, int x2, int y2, int c )
{
    int y, step = (y1 <= y2) ? 1 : -1;
    for (y = y1; y != y2 + step; y += step) { px_hline(x1, x2, y, c); }
}

/* thicker strokes: redraw the primitive shifted by one pixel */
static void px_line_thick ( int x1, int y1, int x2, int y2, int c, int t )
{
    int i;
    for (i = 0; i < t; i++) {
        px_line(x1, y1 + i, x2, y2 + i, c);
        if (i > 0) { px_line(x1, y1 - i, x2, y2 - i, c); }
    }
}

static void px_circle_thick ( int cx, int cy, int r, int c, int t )
{
    int i;
    for (i = 0; i < t; i++) { px_circle(cx, cy, r + i, c); }
}

/* the goal netting: a crosshatch of thin diagonal lines inside the box */
static void px_net ( int x1, int y1, int x2, int y2, int step, int c )
{
    int x, y;
    if (x1 > x2) { int t = x1; x1 = x2; x2 = t; }
    if (y1 > y2) { int t = y1; y1 = y2; y2 = t; }
    for (x = x1 - (y2 - y1); x < x2; x += step) {
        for (y = y1; y <= y2; y++) {
            int xx = x + (y - y1);
            if (xx >= x1 && xx <= x2) { px_put(xx, y, c); }
        }
    }
    for (x = x1; x < x2 + (y2 - y1); x += step) {
        for (y = y1; y <= y2; y++) {
            int xx = x - (y - y1);
            if (xx >= x1 && xx <= x2) { px_put(xx, y, c); }
        }
    }
}

/* ==========================================================================
 * SECTION 6 — entities, physics and the laws of the (street) game
 * ========================================================================== */

struct Player {
    double x, y;              /* world position                       */
    double vx, vy;            /* velocity, units per tick             */
    double faceX, faceY;      /* last run direction (kick direction)  */
    int    charge;            /* kick charge ticks while kick is held */
    bool   kicking;           /* kick key held (charging)             */
};

struct Ball {
    double x, y, vx, vy;
    bool   inNetL, inNetR;    /* fully behind a goal line             */
};

struct Keeper {
    double x, y;
    double vx, vy;
    int    holdTimer;         /* ticks left holding a caught ball     */
    double homeX;             /* goal line it guards (world)          */
    int    side;              /* 0 = left goal, 1 = right goal        */
};

struct Match {
    Ball    ball;
    Player  p[2];             /* [0] REDS (attacks right), [1] SKYBLUES */
    Keeper  gk[2];
    int     score1, score2;   /* this match                            */
    int     shots1, shots2;
    long    poss1, poss2;     /* possession ticks per half             */
    int     half;             /* 1 or 2                                */
    long    clock;            /* ticks played in the current half      */
    long    halfTicks;        /* length of one half in ticks           */
    int     attack1;          /* +1: REDS attack right, -1: swapped    */
    int     scorer;           /* 1/2 for the goal banner, 0 none       */
    int     countdown;        /* kickoff countdown ticks               */
    int     goalBanner;       /* ticks left of the goal celebration    */
    int     halfBanner;       /* ticks left of the half-time banner    */
    bool    paused;
};

static const int HALF_SECONDS[3] = { 45, 90, 150 };
static int matchLength = 1;              /* index into HALF_SECONDS      */
static const char* LENGTH_LABELS[3] =
    { "Short (2x45s)", "Normal (2x90s)", "Long (2x150s)" };

static bool demoMode = false;            /* BGI_AUTOEXIT_MS battery mode */
static long demoExitMs = 0;
static time_t demoStart = 0;

static bool demoTimeUp ( )
{
    return demoMode && (time(NULL) - demoStart) >= demoExitMs / 1000;
}

/* ---- placement --------------------------------------------------------- */

static void placePlayers ( Match& m )
{
    /* kickoff formation: strikers on their half's centre line, keepers
     * on the goal their team defends (ends swap at half time)         */
    double midX = PITCH_W / 2.0, midY = PITCH_H / 2.0;
    m.p[0].x = midX - 120; m.p[0].y = midY;
    m.p[1].x = midX + 120; m.p[1].y = midY;

    int redsGoal = (m.attack1 == 1) ? 0 : 1;      /* 0 = left goal       */
    m.gk[0].homeX = (redsGoal == 0) ? 22 : PITCH_W - 22;
    m.gk[0].side  = redsGoal;
    m.gk[0].x = m.gk[0].homeX;
    m.gk[0].y = midY;
    m.gk[1].homeX = (redsGoal == 0) ? PITCH_W - 22 : 22;
    m.gk[1].side  = 1 - redsGoal;
    m.gk[1].x = m.gk[1].homeX;
    m.gk[1].y = midY;

    for (int i = 0; i < 2; i++) {
        m.p[i].vx = m.p[i].vy = 0;
        m.p[i].faceX = (i == 0) ? 1 : -1;
        m.p[i].faceY = 0;
        m.p[i].charge = 0;
        m.p[i].kicking = false;
    }
    m.gk[0].vx = m.gk[0].vy = 0;
    m.gk[1].vx = m.gk[1].vy = 0;
    m.gk[0].holdTimer = m.gk[1].holdTimer = 0;
}

static void resetKickoff ( Match& m )
{
    m.ball.x = PITCH_W / 2.0;
    m.ball.y = PITCH_H / 2.0;
    m.ball.vx = m.ball.vy = 0;
    m.ball.inNetL = m.ball.inNetR = false;
    placePlayers(m);
    m.scorer = 0;
    m.countdown = 150;               /* ~2.2 s of 3-2-1-GO             */
}

static void resetMatch ( Match& m )
{
    m.score1 = m.score2 = 0;
    m.shots1 = m.shots2 = 0;
    m.poss1 = m.poss2 = 0;
    m.half = 1;
    m.clock = 0;
    m.attack1 = 1;                   /* REDS attack right in half 1    */
    m.halfTicks = (long) HALF_SECONDS[matchLength] * 70;
    m.goalBanner = 0;
    m.halfBanner = 0;
    m.paused = false;
    resetKickoff(m);
}

/* ---- the goalkeeper brain ---------------------------------------------- */

static void tickKeeper ( Match& m, Keeper& gk )
{
    const Ball& b = m.ball;
    double goalY = PITCH_H / 2.0;
    double targetY = goalY;
    double targetX = gk.homeX;

    if (gk.holdTimer > 0) {
        gk.holdTimer--;
        if (gk.holdTimer == 0) {
            /* throw the ball back into play, up the middle-ish */
            int side = gk.side;
            double dirX = (side == 0) ? 1.0 : -1.0;
            m.ball.x = gk.x + dirX * 30;
            m.ball.y = gk.y;
            m.ball.vx = dirX * (7.0 + rand() % 4);
            m.ball.vy = (rand() % 7 - 3) * 0.6;
            playSfx(SFX_PASS);
        }
    } else {
        /* track the ball's y, but never wander far off the line; step
         * out a little when the ball threatens the six-yard box       */
        targetY = b.y;
        if (targetY < goalY - GOAL_HALF - 34) { targetY = goalY - GOAL_HALF - 34; }
        if (targetY > goalY + GOAL_HALF + 34) { targetY = goalY + GOAL_HALF + 34; }
        if (gk.side == 0 && b.x < PEN_D + 40 && b.x >= 0) {
            targetX = gk.homeX + 26;
        }
        if (gk.side == 1 && b.x > PITCH_W - PEN_D - 40 && b.x <= PITCH_W) {
            targetX = gk.homeX - 26;
        }

        double dx = targetX - gk.x;
        double dy = targetY - gk.y;
        double len = sqrt(dx * dx + dy * dy);
        if (len > 1.0) {
            double sp = 3.0;
            if (len < sp) { sp = len; }
            gk.vx = dx / len * sp;
            gk.vy = dy / len * sp;
            gk.x += gk.vx;
            gk.y += gk.vy;
        }

        /* catch: the ball is close and slow-ish enough to hold */
        double bx = b.x - gk.x, by = b.y - gk.y;
        double bd = sqrt(bx * bx + by * by);
        double bs = sqrt(b.vx * b.vx + b.vy * b.vy);
        if (bd < GK_R + BALL_R + 4.0 && bs < 12.5 && m.countdown == 0) {
            bool ownGoalRisk = (gk.side == 0) ? (b.x < PEN_D)
                                              : (b.x > PITCH_W - PEN_D);
            if (ownGoalRisk) {
                gk.holdTimer = 40;
                m.ball.vx = m.ball.vy = 0;
                m.ball.x = gk.x;
                m.ball.y = gk.y;
                playSfx(SFX_CATCH);
            }
        }
    }

    if (gk.y < goalY - GOAL_HALF - 40) { gk.y = goalY - GOAL_HALF - 40; }
    if (gk.y > goalY + GOAL_HALF + 40) { gk.y = goalY + GOAL_HALF + 40; }
    if (gk.x < 8) { gk.x = 8; }
    if (gk.x > PITCH_W - 8) { gk.x = PITCH_W - 8; }
}

/* ---- human input (key STATE) and player physics ------------------------ */

/* key layout per player: P1 = W/A/S/D + Space, P2 = arrows + Enter */
static const int P1_KEYS[5] = { KH_W, KH_S, KH_A, KH_D, KH_SPACE };
static const int P2_KEYS[5] = { KH_UP, KH_DOWN, KH_LEFT, KH_RIGHT, KH_ENTER };

static void tickPlayer ( Match& m, Player& pl, const int keys[5] )
{
    double ax = 0, ay = 0;
    if (keyHeld(keys[2])) { ax -= 1; }           /* left  */
    if (keyHeld(keys[3])) { ax += 1; }           /* right */
    if (keyHeld(keys[0])) { ay -= 1; }           /* up    */
    if (keyHeld(keys[1])) { ay += 1; }           /* down  */

    double len = sqrt(ax * ax + ay * ay);
    if (len > 0.0) {
        pl.vx += ax / len * PL_ACCEL;
        pl.vy += ay / len * PL_ACCEL;
        pl.faceX = ax / len;
        pl.faceY = ay / len;
    }

    /* soft speed cap + ground friction: crisp starts, no drifting */
    double sp = sqrt(pl.vx * pl.vx + pl.vy * pl.vy);
    if (sp > PL_MAX) { pl.vx = pl.vx / sp * PL_MAX; pl.vy = pl.vy / sp * PL_MAX; }
    pl.vx *= PL_FRICTION;
    pl.vy *= PL_FRICTION;
    pl.x += pl.vx;
    pl.y += pl.vy;

    /* players are kept on the pitch (street rules: the boards hold you) */
    if (pl.x < PL_R)          { pl.x = PL_R; }
    if (pl.x > PITCH_W - PL_R) { pl.x = PITCH_W - PL_R; }
    if (pl.y < PL_R)          { pl.y = PL_R; }
    if (pl.y > PITCH_H - PL_R) { pl.y = PITCH_H - PL_R; }

    /* kick key: hold to charge, release to strike (if the ball is in
     * reach). faceX/faceY at release time decide the direction.       */
    bool held = keyHeld(keys[4]) != 0;
    if (held) {
        if (pl.charge < CHARGE_MAX) { pl.charge++; }
        pl.kicking = true;
    } else if (pl.kicking) {
        pl.kicking = false;
        double power = KICK_MIN + pl.charge * KICK_CHARGE;
        pl.charge = 0;
        double bx = m.ball.x - pl.x, by = m.ball.y - pl.y;
        double bd = sqrt(bx * bx + by * by);
        if (bd < PL_R + BALL_R + 9.0) {
            double shotX = pl.faceX, shotY = pl.faceY;
            /* nudge the shot toward where the ball actually sits, so
             * close-range taps feel natural in any direction        */
            if (bd > 1.0) {
                shotX = shotX * 0.65 + bx / bd * 0.35;
                shotY = shotY * 0.65 + by / bd * 0.35;
                double sl = sqrt(shotX * shotX + shotY * shotY);
                shotX /= sl; shotY /= sl;
            }
            m.ball.vx = shotX * power + pl.vx * 0.45;
            m.ball.vy = shotY * power + pl.vy * 0.45;
            playSfx(power > KICK_MIN + CHARGE_MAX * KICK_CHARGE * 0.55
                    ? SFX_SHOT : SFX_PASS);
            if (power > 9.5) {
                /* a shot on its way to the opponent goal counts */
                if (&pl == &m.p[0]) { m.shots1++; }
                else                { m.shots2++; }
            }
        }
    }
}

/* ---- ball physics, walls, posts, nets, goals ---------------------------- */

static bool inGoalMouthR ( const Ball& b );   /* defined right below */

static void bounceBall ( Ball& b, double nx, double ny )
{
    double dot = b.vx * nx + b.vy * ny;
    b.vx -= 2.0 * dot * nx;
    b.vy -= 2.0 * dot * ny;
    b.vx *= WALL_BOUNCE;
    b.vy *= WALL_BOUNCE;
}

static void tickBall ( Match& m )
{
    Ball& b = m.ball;
    bool inGoalMouthL = b.y > PITCH_H / 2.0 - GOAL_HALF
                     && b.y < PITCH_H / 2.0 + GOAL_HALF;
    double midY = PITCH_H / 2.0;

    /* already in a net? heavy drag + net walls, wait for the whistle */
    if (b.inNetL || b.inNetR) {
        b.vx *= NET_FRICTION;
        b.vy *= NET_FRICTION;
        b.x += b.vx;
        b.y += b.vy;
        return;
    }

    b.x += b.vx;
    b.y += b.vy;
    b.vx *= BALL_FRICTION;
    b.vy *= BALL_FRICTION;

    /* touchlines (top/bottom boards) always bounce */
    if (b.y < BALL_R)         { b.y = BALL_R;         bounceBall(b, 0, 1); playSfx(SFX_BOUNCE); }
    if (b.y > PITCH_H - BALL_R) { b.y = PITCH_H - BALL_R; bounceBall(b, 0, -1); playSfx(SFX_BOUNCE); }

    /* goal lines: bounce everywhere EXCEPT the open goal mouths */
    if (b.x < BALL_R && !inGoalMouthL) {
        b.x = BALL_R; bounceBall(b, 1, 0); playSfx(SFX_BOUNCE);
    }
    if (b.x > PITCH_W - BALL_R && !inGoalMouthR(b)) {
        b.x = PITCH_W - BALL_R; bounceBall(b, -1, 0); playSfx(SFX_BOUNCE);
    }

    /* goal detection: the whole ball over the whole line, in the mouth.
     * The team attacking THAT goal scores: attack1 = +1 means the REDS
     * attack right, so a ball in the LEFT net belongs to the SKYBLUES */
    if (inGoalMouthL && b.x < -BALL_R * 0.5) {
        b.inNetL = true;
        m.scorer = (m.attack1 == 1) ? 2 : 1;
        if (m.scorer == 1) { m.score1++; } else { m.score2++; }
        m.goalBanner = 130;
        playSfx(SFX_GOAL);
        return;
    }
    if (inGoalMouthR(b) && b.x > PITCH_W + BALL_R * 0.5) {
        b.inNetR = true;
        m.scorer = (m.attack1 == 1) ? 1 : 2;
        if (m.scorer == 1) { m.score1++; } else { m.score2++; }
        m.goalBanner = 130;
        playSfx(SFX_GOAL);
        return;
    }

    /* inside a net region (behind the line, in the mouth): keep it in */
    if (inGoalMouthL && b.x < 0) {
        b.x = 0; bounceBall(b, 1, 0);
    }
    if (inGoalMouthR(b) && b.x > PITCH_W) {
        b.x = PITCH_W; bounceBall(b, -1, 0);
    }

    /* the posts: four discs at the mouth corners — classic clank */
    const double POST[4][2] = {
        { 0.0, midY - GOAL_HALF }, { 0.0, midY + GOAL_HALF },
        { PITCH_W, midY - GOAL_HALF }, { PITCH_W, midY + GOAL_HALF }
    };
    for (int i = 0; i < 4; i++) {
        double dx = b.x - POST[i][0], dy = b.y - POST[i][1];
        double d = sqrt(dx * dx + dy * dy);
        if (d < BALL_R + 3.0 && d > 0.01) {
            double nx = dx / d, ny = dy / d;
            b.x = POST[i][0] + nx * (BALL_R + 3.0);
            b.y = POST[i][1] + ny * (BALL_R + 3.0);
            bounceBall(b, nx, ny);
            playSfx(SFX_POST);
        }
    }
}

static bool inGoalMouthR ( const Ball& b )
{
    return b.y > PITCH_H / 2.0 - GOAL_HALF && b.y < PITCH_H / 2.0 + GOAL_HALF;
}

/* ---- player/ball and player/player contacts ---------------------------- */

static void tickContacts ( Match& m )
{
    /* dribble + shoulder-to-shoulder ball contact: a moving player who
     * overlaps the ball nudges it along; a fast ball bounces off       */
    for (int i = 0; i < 2; i++) {
        Player& pl = m.p[i];
        Ball& b = m.ball;
        double dx = b.x - pl.x, dy = b.y - pl.y;
        double d = sqrt(dx * dx + dy * dy);
        double minD = PL_R + BALL_R;
        if (d < minD && d > 0.01) {
            double nx = dx / d, ny = dy / d;
            b.x = pl.x + nx * minD;
            b.y = pl.y + ny * minD;
            double plSpeed = sqrt(pl.vx * pl.vx + pl.vy * pl.vy);
            double dot = b.vx * nx + b.vy * ny;      /* ball moving INTO player? */
            if (dot < 0) {                            /* reflect the ball */
                b.vx -= 1.55 * dot * nx;
                b.vy -= 1.55 * dot * ny;
            }
            /* dribble push: carry a bit of the player's momentum */
            b.vx += pl.vx * 0.55 + nx * 0.35;
            b.vy += pl.vy * 0.55 + ny * 0.35;
            (void) plSpeed;
        }
    }

    /* keepers physically block the ball even when they cannot catch it */
    for (int i = 0; i < 2; i++) {
        Keeper& gk = m.gk[i];
        Ball& b = m.ball;
        if (gk.holdTimer > 0) { continue; }
        double dx = b.x - gk.x, dy = b.y - gk.y;
        double d = sqrt(dx * dx + dy * dy);
        double minD = GK_R + BALL_R;
        if (d < minD && d > 0.01) {
            double nx = dx / d, ny = dy / d;
            b.x = gk.x + nx * minD;
            b.y = gk.y + ny * minD;
            double dot = b.vx * nx + b.vy * ny;
            if (dot < 0) {
                b.vx -= 1.6 * dot * nx;
                b.vy -= 1.6 * dot * ny;
            }
        }
    }

    /* shoulder charge between the two strikers: push apart, share speed */
    {
        Player& a = m.p[0];
        Player& c = m.p[1];
        double dx = c.x - a.x, dy = c.y - a.y;
        double d = sqrt(dx * dx + dy * dy);
        double minD = PL_R * 2.0;
        if (d < minD && d > 0.01) {
            double nx = dx / d, ny = dy / d;
            double push = (minD - d) / 2.0;
            a.x -= nx * push; a.y -= ny * push;
            c.x += nx * push; c.y += ny * push;
            double rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rel < 0) {
                a.vx += nx * rel * 0.5; a.vy += ny * rel * 0.5;
                c.vx -= nx * rel * 0.5; c.vy -= ny * rel * 0.5;
            }
        }
    }
}

/* ---- one tick of play (input + physics + clock) ------------------------- */

static void tickMatch ( Match& m )
{
    if (m.halfBanner > 0) {
        m.halfBanner--;
        return;                        /* frozen under the banner      */
    }

    if (m.countdown > 0) {
        int prev = m.countdown;
        m.countdown--;
        if (prev != m.countdown && (prev % 50 == 0 || prev == 150 || prev == 100)) {
            playSfx(SFX_TICK);
        }
        if (m.countdown == 0) { playSfx(SFX_WHISTLE); }
        tickKeeper(m, m.gk[0]);
        tickKeeper(m, m.gk[1]);
        return;
    }

    if (m.goalBanner > 0) {
        m.goalBanner--;
        if (m.goalBanner == 0) { resetKickoff(m); }
        return;
    }

    tickPlayer(m, m.p[0], P1_KEYS);
    tickPlayer(m, m.p[1], P2_KEYS);
    tickBall(m);
    tickContacts(m);
    tickKeeper(m, m.gk[0]);
    tickKeeper(m, m.gk[1]);

    /* possession: which half does the ball live in? */
    if (m.ball.x < PITCH_W / 2.0) { m.poss1++; } else { m.poss2++; }

    m.clock++;
    if (m.clock >= m.halfTicks) {
        if (m.half == 1) {
            m.half = 2;
            m.clock = 0;
            m.attack1 = -m.attack1;        /* swap ends at half time     */
            resetKickoff(m);
            m.halfBanner = 130;            /* freeze under the banner    */
            playSfx(SFX_WHISTLE);
        }
        /* half 2 expiry is handled by the state machine (full time)   */
    }
}

/* ---- the demo AI (test-battery mode): both humans replaced -------------- */

static void aiDrive ( Match& m, Player& pl, int goalDir, const int keys[5] )
{
    /* chases the ball; when close and roughly facing the opponent goal,
     * holds the kick key briefly for a shot. Drives keyHeld() by
     * faking nothing: the AI sets velocities directly instead.        */
    (void) keys;
    Ball& b = m.ball;
    double dx = b.x - pl.x, dy = b.y - pl.y;
    double d = sqrt(dx * dx + dy * dy);

    if (d > 1.0) {
        pl.vx += dx / d * PL_ACCEL;
        pl.vy += dy / d * PL_ACCEL;
        pl.faceX = dx / d; pl.faceY = dy / d;
    }

    if (d < 24.0) {
        /* shoot toward the opponent's goal centre */
        double tx = (goalDir > 0) ? PITCH_W : 0.0;
        double ty = PITCH_H / 2.0 + (rand() % 61 - 30);
        double sx = tx - pl.x, sy = ty - pl.y;
        double sl = sqrt(sx * sx + sy * sy);
        if (sl > 1.0) {
            double power = 10.0 + rand() % 4;
            m.ball.vx = sx / sl * power;
            m.ball.vy = sy / sl * power;
            playSfx(SFX_SHOT);
        }
    }

    double sp = sqrt(pl.vx * pl.vx + pl.vy * pl.vy);
    if (sp > PL_MAX) { pl.vx = pl.vx / sp * PL_MAX; pl.vy = pl.vy / sp * PL_MAX; }
    pl.vx *= PL_FRICTION;
    pl.vy *= PL_FRICTION;
    pl.x += pl.vx;
    pl.y += pl.vy;
    if (pl.x < PL_R)           { pl.x = PL_R; }
    if (pl.x > PITCH_W - PL_R) { pl.x = PITCH_W - PL_R; }
    if (pl.y < PL_R)           { pl.y = PL_R; }
    if (pl.y > PITCH_H - PL_R) { pl.y = PITCH_H - PL_R; }
}

static void tickMatchDemo ( Match& m )
{
    if (m.countdown > 0) {
        m.countdown = (m.countdown > 3) ? m.countdown - 3 : 0;
        return;
    }
    if (m.goalBanner > 0) {
        m.goalBanner--;
        if (m.goalBanner == 0) { resetKickoff(m); }
        return;
    }
    aiDrive(m, m.p[0], m.attack1, P1_KEYS);
    aiDrive(m, m.p[1], -m.attack1, P2_KEYS);
    tickBall(m);
    tickContacts(m);
    tickKeeper(m, m.gk[0]);
    tickKeeper(m, m.gk[1]);
    m.clock += 4;                      /* demo clock runs faster */
    if (m.clock >= m.halfTicks) {
        if (m.half == 1) {
            m.half = 2; m.clock = 0; m.attack1 = -m.attack1;
            resetKickoff(m);
        } else {
            resetMatch(m);             /* demo: roll straight into a new match */
        }
    }
}

/* ==========================================================================
 * SECTION 7 — rendering: a night match under floodlights
 * --------------------------------------------------------------------------
 * Everything on the pitch is drawn with the SECTION 5 primitives only;
 * outtextxy() is used for text (a font, not a shape). The world-to-
 * pixel helpers below are the only place that knows the view scale.
 * ========================================================================== */

static int WX ( double wx ) { return pitchX() + (int)(wx * pitchScale()); }
static int WY ( double wy ) { return pitchY() + (int)(wy * pitchScale()); }
static int WS ( double v )  { int s = (int)(v * pitchScale()); return s < 1 ? 1 : s; }

/* text helpers live in SECTION 8 but the overlays need them earlier */
static void textCentered ( int y, const char* s, int color, int font, int size );
static void shadowCentered ( int y, const char* s, int color, int font, int size );

/* a parametric arc — the midpoint circle's cousin for PARTIAL circles
 * (penalty D's, corner kicks). Pure math + putpixel, no built-ins. */
static void px_arc ( int cx, int cy, int r, double a0, double a1, int c )
{
    if (r <= 0) { return; }
    double span = a1 - a0;
    int steps = (int)(r * (span > 0 ? span : -span) / 2) + 8;
    for (int i = 0; i <= steps; i++) {
        double a = a0 + span * i / steps;
        px_put(cx + (int)(r * cos(a) + 0.5), cy + (int)(r * sin(a) + 0.5), c);
    }
}

static void drawField ( )
{
    const int MID_Y = WY(PITCH_H / 2.0);

    /* boundary boards (thick, the ball bounces off them) */
    px_line_thick(WX(0),  WY(0),      WX(PITCH_W), WY(0),      WHITE, 2);
    px_line_thick(WX(0),  WY(PITCH_H), WX(PITCH_W), WY(PITCH_H), WHITE, 2);
    px_line_thick(WX(0),  WY(0),      WX(0),  WY(PITCH_H), WHITE, 2);
    px_line_thick(WX(PITCH_W), WY(0), WX(PITCH_W), WY(PITCH_H), WHITE, 2);

    /* halfway line + centre circle + centre spot */
    px_line_thick(WX(PITCH_W / 2.0), WY(0), WX(PITCH_W / 2.0), WY(PITCH_H), LIGHTGRAY, 1);
    px_circle_thick(WX(PITCH_W / 2.0), MID_Y, WS(CIRC_R), LIGHTGRAY, 1);
    px_disc(WX(PITCH_W / 2.0), MID_Y, 3, WHITE);

    /* penalty areas */
    px_line_thick(WX(0), WY(PITCH_H/2.0 - PEN_HALF), WX(PEN_D), WY(PITCH_H/2.0 - PEN_HALF), LIGHTGRAY, 1);
    px_line_thick(WX(0), WY(PITCH_H/2.0 + PEN_HALF), WX(PEN_D), WY(PITCH_H/2.0 + PEN_HALF), LIGHTGRAY, 1);
    px_line_thick(WX(PEN_D), WY(PITCH_H/2.0 - PEN_HALF), WX(PEN_D), WY(PITCH_H/2.0 + PEN_HALF), LIGHTGRAY, 1);
    px_line_thick(WX(PITCH_W), WY(PITCH_H/2.0 - PEN_HALF), WX(PITCH_W - PEN_D), WY(PITCH_H/2.0 - PEN_HALF), LIGHTGRAY, 1);
    px_line_thick(WX(PITCH_W), WY(PITCH_H/2.0 + PEN_HALF), WX(PITCH_W - PEN_D), WY(PITCH_H/2.0 + PEN_HALF), LIGHTGRAY, 1);
    px_line_thick(WX(PITCH_W - PEN_D), WY(PITCH_H/2.0 - PEN_HALF), WX(PITCH_W - PEN_D), WY(PITCH_H/2.0 + PEN_HALF), LIGHTGRAY, 1);

    /* six-yard boxes */
    px_rect(WX(0), WY(PITCH_H/2.0 - SIX_HALF), WX(SIX_D), WY(PITCH_H/2.0 + SIX_HALF), LIGHTGRAY);
    px_rect(WX(PITCH_W), WY(PITCH_H/2.0 - SIX_HALF), WX(PITCH_W - SIX_D), WY(PITCH_H/2.0 + SIX_HALF), LIGHTGRAY);

    /* penalty spots */
    px_disc(WX(PEN_SPOT), MID_Y, 3, WHITE);
    px_disc(WX(PITCH_W - PEN_SPOT), MID_Y, 3, WHITE);

    /* the penalty D's: the part of the centre-style arc OUTSIDE the box */
    double cosClip = (PEN_D - PEN_SPOT) / (double) CIRC_R;
    double aHalf = acos(cosClip > 1.0 ? 1.0 : cosClip);
    px_arc(WX(PEN_SPOT), MID_Y, WS(CIRC_R), aHalf, 2 * 3.14159265358979 - aHalf, LIGHTGRAY);
    px_arc(WX(PITCH_W - PEN_SPOT), MID_Y, WS(CIRC_R),
           3.14159265358979 - aHalf, 3.14159265358979 + aHalf, LIGHTGRAY);

    /* corner arcs */
    px_arc(WX(0), WY(0), WS(10), 0.0, 1.5707963267948966, LIGHTGRAY);
    px_arc(WX(PITCH_W), WY(0), WS(10), 1.5707963267948966, 3.14159265358979, LIGHTGRAY);
    px_arc(WX(PITCH_W), WY(PITCH_H), WS(10), 3.14159265358979, 4.71238898038469, LIGHTGRAY);
    px_arc(WX(0), WY(PITCH_H), WS(10), 4.71238898038469, 6.283185307179586, LIGHTGRAY);

    /* goals: frame + netting + posts (drawn OUTSIDE the goal lines) */
    int gl = WS(GOAL_DEPTH);
    px_net(WX(0) - gl, WY(PITCH_H/2.0 - GOAL_HALF), WX(0), WY(PITCH_H/2.0 + GOAL_HALF), 4, DARKGRAY);
    px_net(WX(PITCH_W), WY(PITCH_H/2.0 - GOAL_HALF), WX(PITCH_W) + gl, WY(PITCH_H/2.0 + GOAL_HALF), 4, DARKGRAY);
    px_rect(WX(0) - gl, WY(PITCH_H/2.0 - GOAL_HALF), WX(0), WY(PITCH_H/2.0 + GOAL_HALF), WHITE);
    px_rect(WX(PITCH_W), WY(PITCH_H/2.0 - GOAL_HALF), WX(PITCH_W) + gl, WY(PITCH_H/2.0 + GOAL_HALF), WHITE);
    px_disc(WX(0), WY(PITCH_H/2.0 - GOAL_HALF), 3, YELLOW);
    px_disc(WX(0), WY(PITCH_H/2.0 + GOAL_HALF), 3, YELLOW);
    px_disc(WX(PITCH_W), WY(PITCH_H/2.0 - GOAL_HALF), 3, YELLOW);
    px_disc(WX(PITCH_W), WY(PITCH_H/2.0 + GOAL_HALF), 3, YELLOW);
}

static void drawPlayer ( const Player& pl, int body, bool keeper )
{
    int cx = WX(pl.x), cy = WY(pl.y), r = WS(PL_R);
    if (keeper) { r = WS(GK_R); }
    px_disc(cx, cy, r, body);
    px_circle_thick(cx, cy, r, WHITE, 1);
    if (keeper) {
        /* keepers wear the white ring of authority */
        px_circle_thick(cx, cy, r - 3, WHITE, 1);
    }
    /* facing nub — where a kick would send the ball */
    px_disc(cx + (int)(pl.faceX * (r - 3)), cy + (int)(pl.faceY * (r - 3)),
            WS(3.0), WHITE);
    /* kick charge bar above the player while charging */
    if (pl.kicking && pl.charge > 0) {
        int bw = WS(26.0);
        int fill = bw * pl.charge / CHARGE_MAX;
        px_rect(cx - bw / 2, cy - r - 8, cx + bw / 2, cy - r - 5, DARKGRAY);
        if (fill > 0) {
            px_rect_fill(cx - bw / 2 + 1, cy - r - 7,
                         cx - bw / 2 + fill - 1, cy - r - 6,
                         pl.charge > CHARGE_MAX * 2 / 3 ? RED : YELLOW);
        }
    }
}

/* keepers reuse the same body, drawn from their own struct */
static void drawPlayer ( const Keeper& gk, int body, bool keeper )
{
    Player view;
    view.x = gk.x; view.y = gk.y;
    view.vx = gk.vx; view.vy = gk.vy;
    view.faceX = (gk.side == 0) ? 1.0 : -1.0;
    view.faceY = 0.0;
    view.charge = 0;
    view.kicking = false;
    drawPlayer(view, body, keeper);
}

static void drawBall ( const Ball& b )
{
    int cx = WX(b.x), cy = WY(b.y), r = WS(BALL_R);
    if (r < 3) { r = 3; }
    px_disc(cx, cy, r, WHITE);
    px_circle(cx, cy, r, DARKGRAY);
    /* the classic pentagon hint: three dark dots */
    px_disc(cx, cy, r / 3, DARKGRAY);
    px_disc(cx - r / 2, cy + r / 3, r / 4 > 0 ? r / 4 : 1, DARKGRAY);
    px_disc(cx + r / 2, cy + r / 3, r / 4 > 0 ? r / 4 : 1, DARKGRAY);
}

static void drawHud ( const Match& m )
{
    char buf[80];
    int labelSize = fsz(2);
    int bigSize = fsz(3);

    snprintf(buf, sizeof(buf), "REDS %d : %d SKYBLUES", m.score1, m.score2);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, bigSize);
    setcolor(WHITE);
    int w = textwidth(buf);
    outtextxy((getmaxx() - w) / 2, 6, buf);

    /* the running clock: 90 display minutes across two halves */
    int displayMin = (int)((m.half - 1) * 45 + 45L * m.clock / m.halfTicks);
    if (displayMin > 90) { displayMin = 90; }
    snprintf(buf, sizeof(buf), "H%d  %d'", m.half, displayMin);
    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGREEN);
    outtextxy(18, 8, buf);

    snprintf(buf, sizeof(buf), "shots %d/%d", m.shots1, m.shots2);
    setcolor(LIGHTGRAY);
    outtextxy(getmaxx() - textwidth(buf) - 18, 8, buf);

    px_hline(0, getmaxx(), HUD_H - 2, DARKGRAY);
}

static void drawGoalBanner ( const Match& m )
{
    static const char* TEAM[3] = { "", "REDS", "SKYBLUES" };
    int col = (m.scorer == 1) ? LIGHTRED : CYAN;
    shadowCentered(getmaxy() / 2 - 90, "G O A L !", col, GOTHIC_FONT, fsz(7));
    char buf[64];
    snprintf(buf, sizeof(buf), "%s strike!", TEAM[m.scorer]);
    textCentered(getmaxy() / 2 + 30, buf, WHITE, DEFAULT_FONT, fsz(3));

    /* celebration confetti — deterministic pixel rain, no built-ins */
    for (int i = 0; i < 70; i++) {
        int seed = i * 37 + m.goalBanner * 13;
        int x = (int)((seed * 2654435761u) % (unsigned)(getmaxx() + 1));
        int y = (int)((seed * 40503u) % (unsigned)(getmaxy() / 2));
        px_disc(x, y, 2, (i % 3 == 0) ? YELLOW : (i % 3 == 1) ? col : WHITE);
    }
    textCentered(getmaxy() / 2 + 66, "kickoff in a moment...", DARKGRAY,
                 DEFAULT_FONT, fsz(2));
}

static void drawCountdown ( const Match& m )
{
    char big[8];
    int n = (m.countdown + 49) / 50;          /* 150..101 -> 3 etc        */
    if (n > 3) { n = 3; }
    if (n <= 0) { n = 1; }
    snprintf(big, sizeof(big), "%d", n);
    shadowCentered(getmaxy() / 2 - 70, big, YELLOW, GOTHIC_FONT, fsz(9));
    textCentered(getmaxy() / 2 + 40, "kickoff...", LIGHTGRAY, DEFAULT_FONT, fsz(2));
}

static void drawHalfBanner ( const Match& m )
{
    shadowCentered(getmaxy() / 2 - 80, "HALF TIME", LIGHTCYAN, GOTHIC_FONT, fsz(6));
    char buf[80];
    snprintf(buf, sizeof(buf), "REDS %d : %d SKYBLUES - ends swap sides",
             m.score1, m.score2);
    textCentered(getmaxy() / 2 + 26, buf, WHITE, DEFAULT_FONT, fsz(2));
}

static void drawPauseOverlay ( const Match& m )
{
    (void) m;
    int l = getmaxx() / 2 - 180, t = getmaxy() / 2 - 70;
    int r = getmaxx() / 2 + 180, b = getmaxy() / 2 + 70;
    px_rect_fill(l, t, r, b, BLACK);
    px_rect(l, t, r, b, YELLOW);
    px_rect(l + 4, t + 4, r - 4, b - 4, DARKGRAY);
    textCentered(getmaxy() / 2 - 44, "PAUSED", YELLOW, GOTHIC_FONT, fsz(4));
    textCentered(getmaxy() / 2 + 16, "P - resume", WHITE, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() / 2 + 38, "Esc - back to the menu", WHITE, DEFAULT_FONT, fsz(2));
}

static void present ( )
{
    swapbuffers();
}

/* one full frame of the match, whatever phase it is in */
static void drawMatchFrame ( const Match& m )
{
    cleardevice();
    drawField();
    drawPlayer(m.gk[0], GREEN, true);
    drawPlayer(m.gk[1], MAGENTA, true);
    drawPlayer(m.p[0], LIGHTRED, false);
    drawPlayer(m.p[1], CYAN, false);
    drawBall(m.ball);
    drawHud(m);

    if (m.halfBanner > 0) {
        drawHalfBanner(m);
    } else if (m.goalBanner > 0 && m.scorer != 0) {
        drawGoalBanner(m);
    } else if (m.countdown > 0) {
        drawCountdown(m);
    }
    if (m.paused) {
        drawPauseOverlay(m);
    }
    present();
}

/* ==========================================================================
 * SECTION 8 — screens: menu, controls, sizes, full time
 * ========================================================================== */

static void textCentered ( int y, const char* s, int color, int font, int size )
{
    settextstyle(font, HORIZ_DIR, size);
    setcolor(color);
    int w = textwidth((char*)s);
    outtextxy((getmaxx() - w) / 2, y, (char*)s);
}

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

/* the selection row: bright bar + black text + white underline — any
 * ONE of them is enough to show which row is selected, on any platform */
static void drawSelRow ( int cx, int barHalf, int y, int textH,
                         bool sel, const char* label, int font, int size )
{
    if (sel) {
        px_rect_fill(cx - barHalf, y - 5, cx + barHalf, y + textH + 5, GREEN);
        px_rect_fill(cx - barHalf, y + textH + 5, cx + barHalf, y + textH + 8, WHITE);
    }
    settextstyle(font, HORIZ_DIR, size);
    setcolor(sel ? BLACK : WHITE);
    int w = textwidth((char*)label);
    outtextxy(cx - w / 2, y, (char*)label);
    if (sel) {
        setcolor(BLACK);
        outtextxy(cx - barHalf + 8, y, (char*)">");
        outtextxy(cx + barHalf - 8 - textwidth((char*)"<"), y, (char*)"<");
    }
}

static void drawMenu ( int selection, const MatchDB& db )
{
    char lenRow[64], soundRow[64];
    const char* ITEMS[5];
    int fontSize = fsz(3);
    int rowH = fontSize * 8 + 20;

    snprintf(lenRow, sizeof(lenRow), "Length:  %s", LENGTH_LABELS[matchLength]);
    snprintf(soundRow, sizeof(soundRow), "Sound:  %s", soundOn ? "ON" : "OFF");
    ITEMS[0] = "Start Match"; ITEMS[1] = lenRow; ITEMS[2] = "Controls";
    ITEMS[3] = soundRow; ITEMS[4] = "Quit";

    cleardevice();

    shadowCentered(26, "2-PLAYER FOOTBALL", CYAN, GOTHIC_FONT, fsz(5));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(5));
    int boxTop = 20 + textheight((char*)"2-PLAYER FOOTBALL") + 22;
    int boxH = 5 * rowH + 20;
    if (boxTop + boxH > getmaxy() - 96) { boxTop = getmaxy() - 96 - boxH; }
    if (boxTop < 10) { boxTop = 10; }

    int maxHalf = 0;
    for (int i = 0; i < 5; i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        int w = textwidth((char*)ITEMS[i]);
        if (w > maxHalf) { maxHalf = w; }
    }
    int barHalf = maxHalf / 2 + 56;
    if (barHalf > getmaxx() / 2 - 28) { barHalf = getmaxx() / 2 - 28; }

    /* a chalk panel drawn with OUR primitives only */
    px_rect_fill(getmaxx() / 2 - barHalf - 20, boxTop,
                 getmaxx() / 2 + barHalf + 20, boxTop + boxH, BLACK);
    px_rect(getmaxx() / 2 - barHalf - 20, boxTop,
            getmaxx() / 2 + barHalf + 20, boxTop + boxH, DARKGRAY);

    for (int i = 0; i < 5; i++) {
        drawSelRow(getmaxx() / 2, barHalf, boxTop + 12 + i * rowH,
                   fontSize * 8, i == selection, ITEMS[i], DEFAULT_FONT, fontSize);
    }

    char derby[96];
    snprintf(derby, sizeof(derby),
             "the derby so far:  REDS %d - %d SKYBLUES   (biggest win by %d)",
             db.wins1, db.wins2, db.bigMargin > 0 ? db.bigClub : 0);
    textCentered(getmaxy() - 64, derby, LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40,
        "W/S choose   Enter select   +/- window size",
        DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

static void drawControls ( )
{
    cleardevice();
    shadowCentered(40, "CONTROLS", YELLOW, GOTHIC_FONT, fsz(5));

    int colY = 40 + textheight((char*)"CONTROLS") + 34;
    int fontSize = fsz(2);
    int rowStep = fontSize * 8 + 12;

    struct Row { const char* k; const char* v; };
    static const Row P1R[] = {
        { "Run",      "W A S D" },
        { "Kick",     "SPACE" },
        { "Tap kick", "short pass" },
        { "Hold kick", "charged shot" }
    };
    static const Row P2R[] = {
        { "Run",      "ARROW KEYS" },
        { "Kick",     "ENTER" },
        { "Tap kick", "short pass" },
        { "Hold kick", "charged shot" }
    };
    static const Row RULES[] = {
        { "Scoring",  "ball fully over the goal line" },
        { "Boards",   "street rules - the ball bounces" },
        { "Keepers",  "AI - they catch and throw" },
        { "Match",    "two halves, ends swap, 90' clock" },
        { "Pause",    "P pauses - Esc quits to the menu" }
    };

    int l = 60, r = getmaxx() - 60;
    int bottom = getmaxy() - 96;
    int y = colY;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
    /* column layout measured from the REAL text width so long keys like
       "Hold kick" never collide with the values beside them (the fixed
       offsets overlapped at fsz(2)) */
    int keyW = textwidth((char*)"Hold kick") + 16;
    int p1KeyX = l + 20;
    int p1ValX = p1KeyX + keyW;
    int p2KeyX = p1ValX + textwidth((char*)"charged shot") + 40;
    int p2ValX = p2KeyX + keyW;

    setcolor(LIGHTRED);  outtextxy(p1KeyX, y, (char*)"PLAYER 1 - REDS");
    setcolor(CYAN);      outtextxy(p2KeyX, y, (char*)"PLAYER 2 - SKYBLUES");
    y += rowStep + 6;
    for (int i = 0; i < 4; i++) {
        setcolor(YELLOW);   outtextxy(p1KeyX, y, (char*)P1R[i].k);
        setcolor(WHITE);    outtextxy(p1ValX, y, (char*)P1R[i].v);
        setcolor(YELLOW);   outtextxy(p2KeyX, y, (char*)P2R[i].k);
        setcolor(WHITE);    outtextxy(p2ValX, y, (char*)P2R[i].v);
        y += rowStep;
    }

    y += 10;
    for (int i = 0; i < 5 && y < bottom; i++) {
        setcolor(YELLOW);   outtextxy(p1KeyX, y, (char*)RULES[i].k);
        setcolor(WHITE);    outtextxy(p1ValX, y, (char*)RULES[i].v);
        y += rowStep;
    }

    textCentered(getmaxy() - 64, "Esc - back", DARKGRAY, DEFAULT_FONT, fsz(2));
    present();
}

static void drawSizes ( int selection )
{
    int fontSize = fsz(3);
    int rowH = fontSize * 8 + 24;
    cleardevice();
    shadowCentered(64, "WINDOW SIZE", LIGHTGREEN, GOTHIC_FONT, fsz(6));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(6));
    int boxTop = 56 + textheight((char*)"WINDOW SIZE") + 30;
    int boxH = 4 * rowH + 24;
    if (boxTop + boxH > getmaxy() - 96) { boxTop = getmaxy() - 96 - boxH; }

    px_rect_fill(getmaxx() / 2 - 290, boxTop, getmaxx() / 2 + 290,
                 boxTop + boxH, BLACK);
    px_rect(getmaxx() / 2 - 290, boxTop, getmaxx() / 2 + 290, boxTop + boxH, DARKGRAY);

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
            px_rect_fill(getmaxx() / 2 - 270, y - 6, getmaxx() / 2 + 270,
                         y + fontSize * 8 + 9, LIGHTGREEN);
        }
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fontSize);
        setcolor(sel ? BLACK : WHITE);
        outtextxy(getmaxx() / 2 - 250, y, (char*)SIZES[i].label);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
        setcolor(sel ? BLACK : LIGHTGRAY);
        outtextxy(getmaxx() / 2 - 250 + textwidth((char*)SIZES[i].label) + 28,
                  y + (fontSize * 8 - 8) / 2 + 1, (char*)HINTS[i]);
    }
    textCentered(getmaxy() - 64, "Enter - apply, or just drag the borders",
                 LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCentered(getmaxy() - 40, "W/S - choose   Esc - back", DARKGRAY, DEFAULT_FONT, fsz(2));
    present();
}

static void drawFulltime ( const Match& m, const MatchDB& db )
{
    cleardevice();

    const char* verdict;
    int vcol;
    if (m.score1 > m.score2)      { verdict = "REDS WIN!";   vcol = LIGHTRED; }
    else if (m.score2 > m.score1) { verdict = "SKYBLUES WIN!"; vcol = CYAN; }
    else                          { verdict = "A DRAW";       vcol = YELLOW; }

    shadowCentered(90, "FULL TIME", WHITE, GOTHIC_FONT, fsz(6));
    shadowCentered(90 + textheight((char*)"FULL TIME") + 34, verdict, vcol, GOTHIC_FONT, fsz(5));

    int l = getmaxx() / 2 - 250, t = 90 + textheight((char*)"FULL TIME") + 110;
    int r = getmaxx() / 2 + 250, b = t + 168;
    if (b > getmaxy() - 90) { b = getmaxy() - 90; t = b - 168; }

    px_rect_fill(l, t, r, b, BLACK);
    px_rect(l, t, r, b, DARKGRAY);

    char buf[96];
    int labelSize = fsz(2);
    int y = t + 18;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(3));
    setcolor(WHITE);
    snprintf(buf, sizeof(buf), "REDS %d : %d SKYBLUES", m.score1, m.score2);
    outtextxy((getmaxx() - textwidth(buf)) / 2, y, buf);
    y += labelSize * 8 + 22;

    settextstyle(DEFAULT_FONT, HORIZ_DIR, labelSize);
    setcolor(LIGHTGRAY);
    snprintf(buf, sizeof(buf), "shots        %d : %d", m.shots1, m.shots2);
    outtextxy(l + 36, y, buf);
    y += labelSize * 8 + 10;

    long poss = m.poss1 + m.poss2;
    if (poss <= 0) { poss = 1; }
    snprintf(buf, sizeof(buf), "possession   %d%% : %d%%",
             (int)(m.poss1 * 100 / poss), (int)(m.poss2 * 100 / poss));
    outtextxy(l + 36, y, buf);
    y += labelSize * 8 + 10;

    snprintf(buf, sizeof(buf), "derby        REDS %d - %d SKYBLUES wins",
             db.wins1, db.wins2);
    outtextxy(l + 36, y, buf);

    textCentered(b + 20, "Enter - rematch      Esc - menu", WHITE, DEFAULT_FONT, fsz(2));
    present();
}

/* ==========================================================================
 * SECTION 9 — the state machine
 * ========================================================================== */

enum { S_MENU = 0, S_CONTROLS, S_SIZES, S_MATCH, S_FULLTIME };

/* Opens the game window. Platform difference that matters: on Windows
 * (WinBGIm) the last initwindow argument true enables DOUBLE BUFFERING
 * (swapbuffers flips it); on SDL_bgi setactivepage(1) moves drawing
 * off-screen and swapbuffers flips pages. Without this, flicker. */
static void openWindow ( const MatchDB& db )
{
#ifdef _WIN32
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h,
               "2-PLAYER FOOTBALL - graphics.h", 0, 0, true);
#else
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h);
    setactivepage(1);
#endif
}

/* apply a window preset change (menu row / + and - keys) */
static void applyWindowSize ( const MatchDB& db )
{
    closegraph();
    openWindow(db);
}

/* update the derby bookkeeping after a full-time whistle */
static void recordResult ( MatchDB& db, const Match& m )
{
    db.goals1 += m.score1;
    db.goals2 += m.score2;
    if (m.score1 > m.score2) {
        db.wins1++;
        if (m.score1 - m.score2 > db.bigMargin) {
            db.bigMargin = m.score1 - m.score2;
            db.bigClub = 1;
        }
    } else if (m.score2 > m.score1) {
        db.wins2++;
        if (m.score2 - m.score1 > db.bigMargin) {
            db.bigMargin = m.score2 - m.score1;
            db.bigClub = 2;
        }
    }
    saveDatabase(db);
}

/* ==========================================================================
 * SECTION 10 — main(): menu <-> match, the screenshot hook, the lot
 * ========================================================================== */

int main ( int argc, char* argv[] )
{
    /* battery hook: BGI_AUTOEXIT_MS -> both players become demo AIs and
     * the program exits cleanly when the budget is over */
    { const char* ae = getenv("BGI_AUTOEXIT_MS");
      if (ae) { demoExitMs = atol(ae); if (demoExitMs > 0) { demoMode = true; } } }

    srand((unsigned)time(NULL));
    resolveDbPath(argc > 0 ? argv[0] : "");

    MatchDB db;
    loadDatabase(db);

    openWindow(db);
    keyHeldInit();
    sfxInit();

    Match m;
    memset(&m, 0, sizeof(m));

    /* screenshot hook: BGI_SCREENSHOT=<screen> renders one prepared
     * screen, presents it and exits 0 — the visual battery navigates
     * nothing. 'game' runs a few demo ticks first so the pitch is busy */
    { const char* shot = getenv("BGI_SCREENSHOT");
      if (shot && shot[0]) {
          resetMatch(m);
          if (strcmp(shot, "controls") == 0)      { drawControls(); }
          else if (strcmp(shot, "game") == 0)     {
              for (int i = 0; i < 120; i++) { tickMatchDemo(m); }
              drawMatchFrame(m);
          }
          else if (strcmp(shot, "goal") == 0)     {
              m.scorer = 1; m.score1 = 1; m.goalBanner = 60;
              m.ball.x = 30; m.ball.y = PITCH_H / 2.0; m.ball.inNetL = true;
              drawMatchFrame(m);
          }
          else if (strcmp(shot, "fulltime") == 0) {
              m.score1 = 2; m.score2 = 1; m.half = 2;
              m.clock = m.halfTicks;
              m.shots1 = 7; m.shots2 = 4;
              m.poss1 = 4200; m.poss2 = 3800;
              drawFulltime(m, db);
          }
          else                                    { drawMenu(0, db); }
          delay(2500);   /* visible long enough for the battery grab */
          closegraph();
          return 0;
      } }

    int screen = S_MENU;
    int selection = 0;
    int sizeSelection = db.winSize;

    demoStart = time(NULL);

    while (true) {
        if (demoTimeUp()) { break; }

        if (demoMode) {
            /* attract mode: straight into an endless AI-vs-AI match */
            if (m.halfTicks == 0) { resetMatch(m); }
            tickMatchDemo(m);
            drawMatchFrame(m);
            delay(14);
            continue;
        }

        if (screen == S_MENU) {
            drawMenu(selection, db);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) {
                selection = (selection + 4) % 5; playSfx(SFX_TICK);
            }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) {
                selection = (selection + 1) % 5; playSfx(SFX_TICK);
            }
            if (k == K_PLUS || k == K_MINUS) {
                int dir = (k == K_PLUS) ? 1 : -1;
                db.winSize = (db.winSize + dir + 4) % 4;
                saveDatabase(db);
                applyWindowSize(db);
                playSfx(SFX_TICK);
            }
            if (selection == 1) {
                if (k == K_LEFT  || k == K_RIGHT
                    || (k == K_LETTER && (readKeyLetter == 'a' || readKeyLetter == 'd'))) {
                    matchLength = (matchLength + 1) % 3; playSfx(SFX_TICK);
                }
            }
            if (selection == 3) {
                if (k == K_LEFT  || k == K_RIGHT
                    || (k == K_LETTER && (readKeyLetter == 'a' || readKeyLetter == 'd'))) {
                    soundOn = !soundOn; saveDatabase(db); playSfx(SFX_TICK);
                }
            }
            if (k == K_ESC) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                if (selection == 0) {
                    resetMatch(m);
                    screen = S_MATCH;
                } else if (selection == 1) {
                    matchLength = (matchLength + 1) % 3; playSfx(SFX_TICK);
                } else if (selection == 2) {
                    screen = S_CONTROLS;
                } else if (selection == 3) {
                    soundOn = !soundOn; saveDatabase(db); playSfx(SFX_TICK);
                } else if (selection == 4) {
                    break;
                }
            }
        } else if (screen == S_CONTROLS) {
            drawControls();
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC || k == K_ENTER
                || (k == K_LETTER && (readKeyLetter == 'q' || readKeyLetter == 'c'))) {
                screen = S_MENU;
            }
        } else if (screen == S_SIZES) {
            drawSizes(sizeSelection);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { sizeSelection = (sizeSelection + 3) % 4; playSfx(SFX_TICK); }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { sizeSelection = (sizeSelection + 1) % 4; playSfx(SFX_TICK); }
            if (k == K_ENTER || k == K_SPACE) {
                if (sizeSelection != db.winSize) {
                    db.winSize = sizeSelection;
                    saveDatabase(db);
                    applyWindowSize(db);
                }
                screen = S_MENU; playSfx(SFX_TICK);
            }
            if (k == K_ESC) { screen = S_MENU; }
        } else if (screen == S_MATCH) {
            /* discrete keys first: pause / quit / window resize */
            int k = pollKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC) { screen = S_MENU; continue; }
            if (k == K_LETTER && readKeyLetter == 'p') { m.paused = !m.paused; }
            if (k == K_PLUS || k == K_MINUS) {
                int dir = (k == K_PLUS) ? 1 : -1;
                db.winSize = (db.winSize + dir + 4) % 4;
                saveDatabase(db);
                applyWindowSize(db);
            }

            if (!m.paused) { tickMatch(m); }

            /* full time? */
            if (m.half == 2 && m.clock >= m.halfTicks && m.goalBanner == 0) {
                playSfx(SFX_WHISTLE);
                recordResult(db, m);
                screen = S_FULLTIME;
                continue;
            }

            drawMatchFrame(m);
            delay(14);
        } else if (screen == S_FULLTIME) {
            drawFulltime(m, db);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                resetMatch(m);
                screen = S_MATCH;
            }
            if (k == K_ESC || (k == K_LETTER && readKeyLetter == 'q')) {
                screen = S_MENU;
            }
        }
    }

    closegraph();
    return 0;
}
