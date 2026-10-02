/* ==========================================================================
 * 03_bounce_game.cpp — BOUNCE, the classic rubber-ball adventure
 * ==========================================================================
 * The beloved old-phone classic, rebuilt with classic graphics.h and made
 * to feel just right:
 *
 *   - A red ball with eyes that squashes, stretches and ROLLS
 *   - HOLD the jump key to charge, release to bounce — the longer the
 *     charge, the higher the flight (the signature mechanic)
 *   - Collect every ring to open the exit door; diamonds are bonus
 *   - Spikes pop the ball; springs fling it sky-high; moving platforms
 *     carry it across the gaps
 *   - Six handcrafted levels, three lives, a camera that follows
 *   - PROPER sounds: bounces ring with pitch by impact, rings chime,
 *     diamonds sparkle, springs boing, the door plays a little jingle,
 *     deaths fall — all synthesized live, no sound files anywhere
 *   - Controls: LEFT/RIGHT or A/D to roll, UP / W / SPACE to charge,
 *     Esc pauses. Menus use Enter.
 *   - Double-buffered, flicker-free; the window is RESIZABLE (drag the
 *     borders on SDL_bgi, or pick S/M/L/XL in the menu, +/- anywhere)
 *   - A tiny file "database" (bounce_scores.db) remembers sound and
 *     window settings, the highest level you unlocked and the diamonds
 *     you banked across runs
 *
 * PORTABILITY NOTES (same treatment as the other games in this suite):
 *   1. Held keys come from key STATE: SDL_GetKeyboardState on SDL_bgi,
 *      GetAsyncKeyState (user32.dll, loaded at runtime) on Windows.
 *   2. Menus use classic kbhit()/getch() events; readKey() normalises
 *      both platforms; the QUIT constant exits cleanly on window close.
 *
 * Headless test batteries set BGI_AUTOEXIT_MS: a small demo AI then
 * plays the first level and the program exits cleanly (nothing saved).
 * BGI_SCREENSHOT=menu|game renders one prepared screen and exits 0.
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
 * ========================================================================== */

static const int TILE = 40;            /* one map tile, world pixels      */
static const double GRAVITY    = 0.42;
static const double RUN_ACCEL  = 0.5;
static const double AIR_ACCEL  = 0.3;
static const double RUN_MAX    = 4.2;
static const double GROUND_FRICTION = 0.92;
static const double RESTITUTION = 0.45;      /* uncharged landing bounce   */
static const double JUMP_MIN   = 7.5;
static const double JUMP_PER_CHARGE = 0.2;
static const int    CHARGE_MAX = 32;
static const double BALL_R     = 13.0;
static const int    LIVES_MAX  = 3;
static const int    LEVEL_COUNT = 6;

/* window size presets, indexed by the winsize= value in the database */
struct WinSize { const char* label; int w, h; };
static const WinSize SIZES[4] = {
    { "S  640x480",  640, 480 },
    { "M  800x600",  800, 600 },
    { "L  960x640",  960, 640 },
    { "XL 1200x800", 1200, 800 }
};
static const int SIZE_DEFAULT = 2;              /* L 960x640          */

static const int HUD_H = 52;           /* status bar above the level      */

/* font size helper: scales a base bitmap-font size with window height */
static int fsz ( int base )
{
    int s = base * (getmaxy() + 240) / 640;
    if (s < base) { s = base; }
    if (s < 2)    { s = 2; }
    return s;
}

/* ==========================================================================
 * SECTION 2 — platform-neutral key handling
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
    if (key == QUIT) { return K_QUIT; }   /* SDL_bgi: window closed */
#endif

    if (key == 0 || key == 224) {
        key = getch();                    /* WinBGIm extended-key prefix */
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
        case 1073741906: return K_UP;
        case 1073741905: return K_DOWN;
        case 1073741904: return K_LEFT;
        case 1073741903: return K_RIGHT;
        /* older SDL 1.2-style builds */
        case 273: return K_UP;
        case 274: return K_DOWN;
        case 276: return K_LEFT;
        case 275: return K_RIGHT;
        /* shared ASCII codes */
        case 13:  return K_ENTER;
        case 27:  return K_ESC;
        case 32:  return K_SPACE;
        case 8:   return K_BACKSPACE;
        case 43:  return K_PLUS;
        case 45:  return K_MINUS;
    }

    if (key >= 'A' && key <= 'Z') { key = tolower(key); }
    if (key >= 'a' && key <= 'z') { readKeyLetter = key; return K_LETTER; }
    if (key >= '0' && key <= '9') { readKeyLetter = key; return K_DIGIT; }
    return K_NONE;
}

static int pollKey ( )
{
    if (!kbhit()) { return K_NONE; }
    return readKey();
}

/* ---- key STATE for the running game -------------------------------------*/
#ifdef _WIN32

#define KH_LEFT   0
#define KH_RIGHT  1
#define KH_JUMP   2

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
    static const int VK[3] = { 0x25, 0x27, 0x20 };  /* left, right, space */
    return (khGetAsync(VK[code]) & 0x8000) != 0;
}

#else

#include <SDL2/SDL.h>

#define KH_LEFT   0
#define KH_RIGHT  1
#define KH_JUMP   2

static const Uint8* khState = NULL;

static void keyHeldInit ( void )
{
    khState = SDL_GetKeyboardState(NULL);
}

static int keyHeld ( int code )
{
    if (!khState) { return 0; }
    /* left: arrow or A; right: arrow or D; jump: Space, Up or W */
    switch (code) {
        case KH_LEFT:  return (khState[SDL_SCANCODE_LEFT]
                               || khState[SDL_SCANCODE_A]) != 0;
        case KH_RIGHT: return (khState[SDL_SCANCODE_RIGHT]
                               || khState[SDL_SCANCODE_D]) != 0;
        default:       return (khState[SDL_SCANCODE_SPACE]
                               || khState[SDL_SCANCODE_UP]
                               || khState[SDL_SCANCODE_W]) != 0;
    }
}

#endif

/* ==========================================================================
 * SECTION 3 — the sound engine: tiny sequencer, big personality
 * --------------------------------------------------------------------------
 * The same fire-and-forget design as the other games in this suite, with
 * one upgrade: every effect is a short SEQUENCE of up to four swept
 * notes, which is what makes jingles (the door chime, the diamond
 * sparkle) possible without any sound files.
 *   - Windows: PlaySoundA() from winmm.dll, loaded at runtime
 *   - SDL_bgi: SDL_OpenAudioDevice() + SDL_QueueAudio()
 * ========================================================================== */

static bool soundOn = true;

#define SFX_RATE 22050
#define SFX_MAXSEG 4

struct SfxSeg  { int f0, f1, ms, shape; };   /* sweep + envelope per note */
struct SfxSpec { int nseg; SfxSeg seg[SFX_MAXSEG]; };

/* envelope shapes: 0 steady, 1 fast decay, 2 swell, 3 long fade */
enum { SFX_TICK, SFX_BOUNCE, SFX_BOUNCE_BIG, SFX_RING, SFX_DIAMOND,
       SFX_SPRING, SFX_DEATH, SFX_DOOR, SFX_GAMEOVER, SFX_VICTORY,
       SFX_CHARGE, SFX_COUNT };

static const SfxSpec SFX[SFX_COUNT] = {
    /* menu tick: one short blip */
    { 1, { { 1250, 1150,  30, 0 } } },
    /* soft landing: low knock */
    { 1, { {  240,  170,  55, 1 } } },
    /* big landing / charge release: deeper + louder feel */
    { 1, { {  170,  100,  80, 1 } } },
    /* ring: bright two-note chime */
    { 2, { {  880,  880,  60, 1 }, { 1318, 1318,  90, 1 } } },
    /* diamond: rising sparkle arpeggio */
    { 3, { { 1046, 1046,  55, 1 }, { 1318, 1318,  55, 1 },
           { 1568, 1568, 110, 1 } } },
    /* spring: big rising boing */
    { 1, { {  180,  900, 220, 2 } } },
    /* death: sad falling sweep */
    { 2, { {  600,  300, 140, 1 }, {  300,   90, 260, 3 } } },
    /* door: the little victory jingle */
    { 4, { {  523,  523,  90, 1 }, {  659,  659,  90, 1 },
           {  784,  784,  90, 1 }, { 1046, 1046, 200, 2 } } },
    /* game over: slow descend */
    { 3, { {  392,  392, 160, 1 }, {  330,  330, 160, 1 },
           {  262,  262, 300, 3 } } },
    /* victory (all levels): fanfare */
    { 4, { {  523,  523, 120, 1 }, {  659,  659, 120, 1 },
           {  784,  784, 120, 1 }, { 1046, 1046, 320, 2 } } },
    /* charge tick: the compressed-ball squeak */
    { 1, { {  300,  340,  24, 1 } } }
};

static int buildSfxSamples ( int id, signed short* out, int maxSamples )
{
    const SfxSpec& spec = SFX[id];
    int total = 0, s;
    for (s = 0; s < spec.nseg && total < maxSamples; s++) {
        const SfxSeg& sg = spec.seg[s];
        int n = sg.ms * SFX_RATE / 1000;
        if (total + n > maxSamples) { n = maxSamples - total; }
        for (int i = 0; i < n; i++) {
            double t = (double) i / n;
            double f = sg.f0 + (sg.f1 - sg.f0) * t;
            double phase = 2 * 3.14159265358979 * f * (total + i) / SFX_RATE;
            double wave = 0.65 * sin(phase)
                        + 0.35 * ((sin(phase) >= 0.0) ? 0.8 : -0.8);
            double env;
            switch (sg.shape) {
                case 1:  env = (1.0 - t) * (1.0 - t); break;
                case 2:  env = 0.25 + 0.75 * sin(3.14159265358979 * t); break;
                case 3:  env = (1.0 - t) * (1.0 - t) * (1.0 - t); break;
                default: env = (t < 0.12) ? t / 0.12
                                          : 1.0 - (t - 0.12) / 0.88;
            }
            out[total + i] = (signed short)(wave * env * 0.42 * 32000);
        }
        total += n;
    }
    return total;
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
 * SECTION 4 — the tiny "database" (bounce_scores.db)
 * ========================================================================== */

static const char* DB_FILENAME = "bounce_scores.db";

struct BounceDB {
    int  unlocked;            /* highest level index reachable (0..5) */
    int  diamonds;            /* banked across all runs               */
    int  winSize;             /* window preset index into SIZES[]     */
};

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
        if (last && last != exeDir) { *last = '\0'; dir = exeDir; }
    }
    static char probe[1280];
    snprintf(probe, sizeof(probe), "%s/%s", dir, DB_FILENAME);
    FILE* f = fopen(probe, "ab");
    if (f) { fclose(f); }
    strncpy(dbPath, probe, sizeof(dbPath) - 1);
    dbPath[sizeof(dbPath) - 1] = '\0';
}

static void loadDatabase ( BounceDB& db )
{
    memset(&db, 0, sizeof(db));
    db.winSize = SIZE_DEFAULT;
    soundOn = true;

    FILE* f = fopen(dbPath, "r");
    if (!f) { return; }
    char line[512];
    while (fgets(line, sizeof(line), f)) {
        for (char* c = line; *c; c++) { if (*c == '\n' || *c == '\r') { *c = '\0'; } }
        if (strncmp(line, "unlocked=", 9) == 0) {
            db.unlocked = atoi(line + 9);
            if (db.unlocked < 0) { db.unlocked = 0; }
            if (db.unlocked >= LEVEL_COUNT) { db.unlocked = LEVEL_COUNT - 1; }
        } else if (strncmp(line, "diamonds=", 9) == 0) {
            db.diamonds = atoi(line + 9);
            if (db.diamonds < 0) { db.diamonds = 0; }
        } else if (strncmp(line, "winsize=", 8) == 0) {
            db.winSize = atoi(line + 8);
            if (db.winSize < 0 || db.winSize > 3) { db.winSize = SIZE_DEFAULT; }
        } else if (strncmp(line, "sound=", 6) == 0) {
            soundOn = (strncmp(line + 6, "ON", 2) == 0);
        }
    }
    fclose(f);
}

static void saveDatabase ( const BounceDB& db )
{
    if (!dbPath[0]) { return; }
    static char tmp[1280];
    snprintf(tmp, sizeof(tmp), "%s.tmp", dbPath);
    FILE* f = fopen(tmp, "w");
    if (!f) { return; }
    fprintf(f, "# graphics.h Bounce save data\n");
    fprintf(f, "version=1\n");
    fprintf(f, "sound=%s\n", soundOn ? "ON" : "OFF");
    fprintf(f, "winsize=%d\n", db.winSize);
    fprintf(f, "unlocked=%d\n", db.unlocked);
    fprintf(f, "diamonds=%d\n", db.diamonds);
    fclose(f);
    remove(dbPath);
    rename(tmp, dbPath);
}

/* ==========================================================================
 * SECTION 5 — the six handcrafted levels
 * --------------------------------------------------------------------------
 * One character per tile:
 *   '#' solid block   'S' spikes (deadly)   'J' spring
 *   'R' ring          'D' diamond bonus     'E' exit door
 *   '@' ball start    'M' moving platform   '.' empty air
 * Short rows are padded with air automatically, so a stray typo can
 * never change the geometry.
 * ========================================================================== */

static const char* const LEVELS[LEVEL_COUNT][13] = {
    { /* 1 — first steps: roll, charge, collect */
      "................................",
      "................................",
      "................................",
      "................................",
      "................................",
      ".........R.R....................",
      "........#####...................",
      "................................",
      "..............R..........R.R...",
      "..............####......#####..",
      "...R............................",
      ".@......S..........D..........E",
      "################################"
    },
    { /* 2 — springs teach the big jump */
      "....................................",
      ".......................D............",
      ".....................#####..........",
      "..............R.....................",
      ".............###........R.R.R......",
      "....................................",
      ".......R....###.....................",
      "....................................",
      "..R.........####....####............",
      ".###................................",
      "......................S.......S.....",
      ".@................................E.",
      "####################################"
    },
    { /* 3 — riding the movers over the gaps */
      "......................................",
      "......................................",
      ".....................R.R..............",
      "....................#####.............",
      "..........D...........................",
      "........####......M.......####........",
      "......................................",
      "...R...............R...............R..",
      "..####..........#####............####.",
      "......................................",
      "..........S..................S........",
      ".@.................................E..",
      "######......############......########"
    },
    { /* 4 — the spike corridor: timing is everything */
      "........................................",
      "........................................",
      "...........R.......R.......R...........",
      "..........###.....###.....###..........",
      "........................................",
      "......D................................",
      ".....###...M...........................",
      "........................................",
      "..R..........................R........",
      ".####...............########......####.",
      "........................................",
      ".@...S...S...S.................D.....E.",
      "########################################"
    },
    { /* 5 — the spring tower: straight up, then the long glide */
      "..................R.R.R................",
      ".................#######...............",
      "......................D................",
      "............R..####....................",
      "...........########....................",
      "......R...................R...........",
      ".....####...............####...........",
      "......................................",
      "..R..............J..................R.",
      ".####............##..............####..",
      "..........S....................S.......",
      ".@..................................E..",
      "########################################"
    },
    { /* 6 — the grand finale: everything at once */
      "..........................................",
      "..............R...........D..............",
      ".............###.........#####...........",
      "......................................R..",
      ".......R...........M..............#####..",
      "......###.................................",
      "..........................................",
      "..R........R..........R..........R.......",
      ".####....####......####........####.......",
      "..........................................",
      ".......S........S...........S............",
      ".@.....................................E..",
      "############.....############....#########"
    }
};

struct Mover {
    double x, y;              /* current top-left, world pixels       */
    double x0, x1;            /* horizontal patrol range              */
    double vx;
    double dx;                /* carried movement for riders          */
};

static char levelGrid[13][64];         /* the working copy (rings get
                                        * eaten as they are collected) */
static int  levelW, levelH;
static int  ringsTotal, ringsGot;
static int  diamondsGot;
static Mover movers[8];
static int  moverCount;
static double doorX_ = 0, doorY_ = 0;  /* the exit door, world pixels  */

static char tileAtPx ( double px, double py )
{
    int tx = (int)(px / TILE), ty = (int)(py / TILE);
    if (tx < 0 || tx >= levelW || ty < 0 || ty >= levelH) { return '.'; }
    return levelGrid[ty][tx];
}

static bool solidAtPx ( double px, double py )
{
    char t = tileAtPx(px, py);
    if (t == '#') { return true; }
    if (t == 'M') { return true; }
    return false;
}

static void loadLevel ( int idx, double& startX, double& startY )
{
    memset(levelGrid, '.', sizeof(levelGrid));
    levelH = 13;
    levelW = 0;
    ringsTotal = ringsGot = 0;
    diamondsGot = 0;
    moverCount = 0;

    for (int y = 0; y < 13; y++) {
        int len = (int) strlen(LEVELS[idx][y]);
        if (len > levelW) { levelW = len; }
    }
    if (levelW > 64) { levelW = 64; }

    startX = 1.5 * TILE;
    startY = 11 * TILE;

    for (int y = 0; y < 13; y++) {
        for (int x = 0; x < levelW; x++) {
            char c = LEVELS[idx][y][x];
            if (c == '\0') { c = '.'; }
            if (c == 'R') { ringsTotal++; }
            if (c == '@') { startX = x * TILE + TILE / 2.0;
                            startY = y * TILE + TILE / 2.0; c = '.'; }
            if (c == 'E') { /* door position, stored as empty air */ }
            if (c == 'M') {
                if (moverCount < 8) {
                    Mover& mv = movers[moverCount++];
                    mv.x = x * TILE;
                    mv.y = y * TILE;
                    mv.x0 = mv.x - TILE * 1.5;
                    mv.x1 = mv.x + TILE * 1.5;
                    mv.vx = 0.9;
                    mv.dx = 0;
                }
                c = '.';                    /* movers live in the list */
            }
            levelGrid[y][x] = c;
        }
    }
    /* remember the door tile (kept OUT of the grid: drawn specially) */
    for (int y = 0; y < 13; y++) {
        for (int x = 0; x < levelW; x++) {
            if (LEVELS[idx][y][x] == 'E') {
                doorX_ = x * TILE; doorY_ = y * TILE;
            }
        }
    }
}

/* ==========================================================================
 * SECTION 6 — the ball: physics, charging, collisions, fate
 * ========================================================================== */

struct Ball {
    double x, y, vx, vy;
    bool   grounded;
    int    charge;             /* ticks compressed while holding jump */
    bool   wasHeld;            /* jump key edge detection             */
    double squash;             /* 0..1 visual squash factor           */
    int    face;               /* -1 / +1, where the eyes look        */
};

static Ball ball;
static int  lives;
static int  deathTimer;             /* ticks left of the pop animation   */
static int  completeTimer;          /* door flag / LEVEL CLEAR! timer    */
static bool gameoverSfxDone = false;
static bool demoMode = false;       /* BGI_AUTOEXIT_MS battery mode      */
static bool playPaused = false;     /* v1.5.16: Esc/P pause during play  */
static int  camX, camY;             /* camera top-left in world pixels   */

static void placeBall ( double x, double y )
{
    ball.x = x; ball.y = y;
    ball.vx = ball.vy = 0;
    ball.grounded = false;
    ball.charge = 0;
    ball.wasHeld = false;
    ball.squash = 0;
    ball.face = 1;
}

static void killBall ( )
{
    if (deathTimer > 0) { return; }
    deathTimer = 60;
    playSfx(SFX_DEATH);
}

/* helper: is the ball's body box overlapping a solid at (px,py)? */
static bool bodySolid ( double px, double py )
{
    double r = BALL_R;
    return solidAtPx(px - r + 1, py - r + 1) || solidAtPx(px + r - 1, py - r + 1)
        || solidAtPx(px - r + 1, py + r - 1) || solidAtPx(px + r - 1, py + r - 1);
}

static void tickBall ( )
{
    bool jumpHeld = keyHeld(KH_JUMP) != 0;
    bool leftHeld = keyHeld(KH_LEFT) != 0;
    bool rightHeld = keyHeld(KH_RIGHT) != 0;

    /* roll */
    if (leftHeld)  { ball.vx -= ball.grounded ? RUN_ACCEL : AIR_ACCEL; ball.face = -1; }
    if (rightHeld) { ball.vx += ball.grounded ? RUN_ACCEL : AIR_ACCEL; ball.face = 1; }
    if (ball.vx > RUN_MAX)  { ball.vx = RUN_MAX; }
    if (ball.vx < -RUN_MAX) { ball.vx = -RUN_MAX; }

    /* charge while grounded and holding; release fires the bounce */
    if (ball.grounded && jumpHeld) {
        if (ball.charge == 0 || ball.charge % 10 == 0) { playSfx(SFX_CHARGE); }
        if (ball.charge < CHARGE_MAX) { ball.charge++; }
        ball.squash = 0.5 * ball.charge / CHARGE_MAX;
    }
    if (ball.wasHeld && !jumpHeld && ball.grounded && ball.charge > 0) {
        ball.vy = -(JUMP_MIN + ball.charge * JUMP_PER_CHARGE);
        ball.grounded = false;
        playSfx(ball.charge > CHARGE_MAX / 2 ? SFX_BOUNCE_BIG : SFX_BOUNCE);
        ball.charge = 0;
        ball.squash = -0.35;             /* stretch on launch */
    }
    if (!jumpHeld) { ball.charge = 0; }
    ball.wasHeld = jumpHeld;

    /* gravity + motion, X then Y with tile resolution */
    ball.vy += GRAVITY;
    if (ball.vy > 15) { ball.vy = 15; }

    /* X axis */
    ball.x += ball.vx;
    if (bodySolid(ball.x, ball.y)) {
        /* pushed into a wall: back off and stop */
        double step = ball.vx > 0 ? -1.0 : 1.0;
        while (bodySolid(ball.x, ball.y)) { ball.x += step; }
        ball.vx = 0;
    }
    /* world bounds */
    if (ball.x < BALL_R)           { ball.x = BALL_R; ball.vx = 0; }
    if (ball.x > levelW * TILE - BALL_R) {
        ball.x = levelW * TILE - BALL_R; ball.vx = 0;
    }

    /* Y axis */
    ball.y += ball.vy;
    ball.grounded = false;
    if (bodySolid(ball.x, ball.y)) {
        if (ball.vy > 0) {
            /* landing */
            double step = -1.0;
            while (bodySolid(ball.x, ball.y)) { ball.y += step; }
            if (jumpHeld) {
                /* stay compressed: the charge continues on the ground */
                ball.vy = 0;
                ball.grounded = true;
            } else if (ball.vy > 5.5) {
                /* the rubber-ball reflex: bounce back at 45% */
                ball.vy = -ball.vy * RESTITUTION;
                ball.squash = 0.4;
                playSfx(ball.vy < -6 ? SFX_BOUNCE_BIG : SFX_BOUNCE);
            } else {
                ball.vy = 0;
                ball.grounded = true;
            }
        } else {
            double step = 1.0;
            while (bodySolid(ball.x, ball.y)) { ball.y += step; }
            ball.vy = 0;
        }
    } else if (ball.vy == 0 && !jumpHeld) {
        /* walked off an edge? */
        ball.grounded = false;
    }

    /* ground friction while rolling */
    if (ball.grounded) { ball.vx *= GROUND_FRICTION; }

    /* squash recovery */
    if (ball.squash > 0) { ball.squash -= 0.04; if (ball.squash < 0) { ball.squash = 0; } }
    if (ball.squash < 0) { ball.squash += 0.04; if (ball.squash > 0) { ball.squash = 0; } }

    /* springs: touching one from above flings the ball sky-high */
    if (tileAtPx(ball.x, ball.y + BALL_R) == 'J' && ball.vy >= 0) {
        ball.vy = -13.5;
        ball.grounded = false;
        ball.squash = -0.4;
        playSfx(SFX_SPRING);
    }

    /* spikes: a smaller hitbox, they are only deadly point-first */
    double sx = ball.x, sy = ball.y + BALL_R * 0.5;
    if (tileAtPx(sx, sy) == 'S' || tileAtPx(ball.x - BALL_R * 0.6, sy) == 'S'
        || tileAtPx(ball.x + BALL_R * 0.6, sy) == 'S') {
        killBall();
    }

    /* fell out of the world */
    if (ball.y > 13 * TILE + 80) { killBall(); }

    /* rings and diamonds: circle-pick with a generous radius */
    double pick = BALL_R + 10;
    int tx0 = (int)((ball.x - pick) / TILE), tx1 = (int)((ball.x + pick) / TILE);
    int ty0 = (int)((ball.y - pick) / TILE), ty1 = (int)((ball.y + pick) / TILE);
    for (int ty = ty0; ty <= ty1; ty++) {
        for (int tx = tx0; tx <= tx1; tx++) {
            if (tx < 0 || tx >= levelW || ty < 0 || ty >= levelH) { continue; }
            char c = levelGrid[ty][tx];
            if (c != 'R' && c != 'D') { continue; }
            double cx = tx * TILE + TILE / 2.0, cy = ty * TILE + TILE / 2.0;
            double dx = ball.x - cx, dy = ball.y - cy;
            if (dx * dx + dy * dy < pick * pick) {
                if (c == 'R') {
                    levelGrid[ty][tx] = '.';
                    ringsGot++;
                    playSfx(SFX_RING);
                } else {
                    levelGrid[ty][tx] = '.';
                    diamondsGot++;
                    playSfx(SFX_DIAMOND);
                }
            }
        }
    }

    /* movers: patrol and carry a standing ball */
    for (int i = 0; i < moverCount; i++) {
        Mover& mv = movers[i];
        mv.dx = 0;
        mv.x += mv.vx;
        if (mv.x < mv.x0) { mv.x = mv.x0; mv.vx = 0.9; }
        if (mv.x > mv.x1) { mv.x = mv.x1; mv.vx = -0.9; }
        mv.dx = mv.vx;
        /* riding: ball just above the platform top and overlapping it */
        if (ball.vy >= 0
            && ball.x > mv.x - BALL_R && ball.x < mv.x + 2 * TILE + BALL_R
            && ball.y + BALL_R >= mv.y - 3 && ball.y + BALL_R <= mv.y + 8) {
            ball.y = mv.y - BALL_R;
            ball.vy = 0;
            ball.grounded = true;
            ball.x += mv.dx;
        }
    }

    /* door: opens when every ring is collected */
    double dx = ball.x - (doorX_ + TILE / 2.0);
    double dy = ball.y - (doorY_ + TILE / 2.0);
    if (completeTimer == 0 && ringsGot >= ringsTotal
        && dx * dx + dy * dy < 28 * 28) {
        completeTimer = 1;             /* the state machine takes over */
    }

    /* camera follows with a soft window */
    int wantX = (int)(ball.x - (getmaxx() + 1) / 2);
    int wantY = (int)(ball.y - (getmaxy() + 1 - HUD_H) / 2);
    int maxX = levelW * TILE - (getmaxx() + 1);
    int maxY = 13 * TILE - (getmaxy() + 1 - HUD_H);
    if (wantX < 0) { wantX = 0; }
    if (wantX > maxX && maxX > 0) { wantX = maxX; }
    if (maxX <= 0) { wantX = (levelW * TILE - (getmaxx() + 1)) / 2; }
    if (wantY < 0) { wantY = 0; }
    if (wantY > maxY && maxY > 0) { wantY = maxY; }
    if (maxY <= 0) { wantY = 0; }
    camX = wantX;
    camY = wantY;
}

/* ---- the demo AI (test-battery mode) ------------------------------------*/

static int demoJumpCooldown = 0;

static void demoDrive ( )
{
    /* roll right and hop constantly — the classic never stops bouncing.
     * When a spike or a gap is close ahead, jump early and harder.     */
    if (demoJumpCooldown > 0) { demoJumpCooldown--; }

    bool hazardAhead = false;
    char a1 = tileAtPx(ball.x + 2.4 * TILE, ball.y + BALL_R * 0.5);
    char a2 = tileAtPx(ball.x + 3.4 * TILE, ball.y + BALL_R * 0.5);
    char gnd = tileAtPx(ball.x + 2.6 * TILE, ball.y + BALL_R + 8);
    if (a1 == 'S' || a2 == 'S') { hazardAhead = true; }
    if (gnd == '.' || gnd == 'S') { hazardAhead = true; }

    if (ball.grounded && demoJumpCooldown == 0) {
        int power = hazardAhead ? 24 : 12;
        ball.vy = -(JUMP_MIN + power * JUMP_PER_CHARGE);
        ball.grounded = false;
        ball.squash = -0.3;
        playSfx(power > 16 ? SFX_BOUNCE_BIG : SFX_BOUNCE);
        demoJumpCooldown = hazardAhead ? 26 : 20;
    }
    if (!keyHeld(KH_LEFT)) { ball.vx += RUN_ACCEL * 0.8; }
    if (ball.vx > RUN_MAX) { ball.vx = RUN_MAX; }
    ball.face = 1;
}

/* ==========================================================================
 * SECTION 7 — rendering: the classic look, drawn with plain primitives
 * --------------------------------------------------------------------------
 * Unlike the football sample (which deliberately draws everything with
 * hand-written putpixel algorithms), this game uses the standard
 * shape calls — bar, circle, fillellipse — the way a real platformer
 * would. It is also much faster on Windows, where putpixel is slow.
 * ========================================================================== */

/* world -> screen: camera + HUD offset */
static int SX ( double wx ) { return (int)(wx) - camX; }
static int SY ( double wy ) { return (int)(wy) - camY + HUD_H; }

/* defined later in this section, needed by the HUD earlier */
static void textCenteredH ( int y, const char* s, int color, int font, int size );
static void px_like_rect ( int x1, int y1, int x2, int y2, int c );

static void drawBackground ( )
{
    cleardevice();
    /* a calm night sky with a hint of parallax stars */
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, HUD_H, getmaxx(), getmaxy());
    setcolor(DARKGRAY);
    for (int i = 0; i < 40; i++) {
        int x = (int)(((long)i * 971 + camX / 3) % (getmaxx() + 1));
        int y = HUD_H + (int)(((long)i * 613 + camY / 4) % (getmaxy() - HUD_H));
        putpixel(x, y, DARKGRAY);
        if (i % 5 == 0) { putpixel(x + 1, y, DARKGRAY); }
    }
}

static void drawTiles ( )
{
    int tx0 = camX / TILE - 1, tx1 = (camX + getmaxx() + 1) / TILE + 1;
    int ty0 = camY / TILE - 1, ty1 = (camY + getmaxy() + 1) / TILE + 1;
    if (tx0 < 0) { tx0 = 0; }
    if (ty0 < 0) { ty0 = 0; }
    if (tx1 > levelW) { tx1 = levelW; }
    if (ty1 > levelH) { ty1 = levelH; }

    for (int ty = ty0; ty < ty1; ty++) {
        for (int tx = tx0; tx < tx1; tx++) {
            char c = levelGrid[ty][tx];
            int x = SX(tx * TILE), y = SY(ty * TILE);
            if (c == '#') {
                /* block: earth core, grassy top, shading */
                setfillstyle(SOLID_FILL, BROWN);
                bar(x, y, x + TILE - 1, y + TILE - 1);
                setfillstyle(SOLID_FILL, GREEN);
                bar(x, y, x + TILE - 1, y + 7);
                setcolor(DARKGRAY);
                line(x, y + TILE - 1, x + TILE - 1, y + TILE - 1);
                line(x + TILE - 1, y, x + TILE - 1, y + TILE - 1);
            } else if (c == 'S') {
                /* spikes: three red triangles on a dark base */
                setfillstyle(SOLID_FILL, DARKGRAY);
                bar(x, y + TILE - 8, x + TILE - 1, y + TILE - 1);
                setfillstyle(SOLID_FILL, LIGHTRED);
                for (int s = 0; s < 3; s++) {
                    int bx = x + 2 + s * 12;
                    int pts[6] = { bx, y + TILE - 8, bx + 5, y + 8,
                                   bx + 10, y + TILE - 8 };
                    fillpoly(3, pts);
                }
            } else if (c == 'J') {
                /* spring: compressed coil on a base */
                setfillstyle(SOLID_FILL, DARKGRAY);
                bar(x + 4, y + TILE - 6, x + TILE - 5, y + TILE - 1);
                setcolor(LIGHTCYAN);
                for (int s = 0; s < 4; s++) {
                    line(x + 6, y + TILE - 8 - s * 6,
                         x + TILE - 7, y + TILE - 12 - s * 6);
                }
                setfillstyle(SOLID_FILL, CYAN);
                bar(x + 3, y + TILE - 34, x + TILE - 4, y + TILE - 28);
            } else if (c == 'R') {
                /* ring: golden circle with a shine */
                int cx = x + TILE / 2, cy = y + TILE / 2;
                setcolor(YELLOW);
                setlinestyle(SOLID_LINE, 0, 3);
                circle(cx, cy, 11);
                setlinestyle(SOLID_LINE, 0, 1);
                setcolor(WHITE);
                circle(cx, cy, 11);
                putpixel(cx - 4, cy - 6, WHITE);
            } else if (c == 'D') {
                /* diamond: cyan gem */
                int cx = x + TILE / 2, cy = y + TILE / 2;
                int pts[8] = { cx, cy - 12, cx + 10, cy, cx, cy + 12,
                               cx - 10, cy };
                setfillstyle(SOLID_FILL, CYAN);
                fillpoly(4, pts);
                setcolor(WHITE);
                line(cx, cy - 12, cx - 10, cy);
            }
        }
    }

    /* moving platforms */
    for (int i = 0; i < moverCount; i++) {
        int x = SX(movers[i].x), y = SY(movers[i].y);
        setfillstyle(SOLID_FILL, LIGHTGRAY);
        bar(x, y, x + 2 * TILE - 1, y + 12);
        setcolor(DARKGRAY);
        rectangle(x, y, x + 2 * TILE - 1, y + 12);
        for (int s = 0; s < 4; s++) {
            putpixel(x + 8 + s * 20, y + 6, DARKGRAY);
        }
    }

    /* the exit door: locked while rings remain */
    int dx = SX(doorX_), dy = SY(doorY_);
    bool open = (ringsGot >= ringsTotal);
    setfillstyle(SOLID_FILL, open ? YELLOW : DARKGRAY);
    bar(dx + 4, dy + 4, dx + TILE - 5, dy + TILE - 1);
    setcolor(open ? YELLOW : LIGHTGRAY);
    rectangle(dx + 4, dy + 4, dx + TILE - 5, dy + TILE - 1);
    setcolor(BLACK);
    rectangle(dx + 9, dy + 9, dx + TILE - 10, dy + TILE - 6);
    if (!open) {
        setfillstyle(SOLID_FILL, RED);
        fillellipse(dx + TILE / 2, dy + TILE / 2 + 2, 4, 4);
    } else {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, 1);
        setcolor(BLACK);
        outtextxy(dx + 12, dy + 14, (char*)"GO");
    }
}

static void drawBall ( )
{
    if (deathTimer > 0) { return; }        /* popped: nothing to draw */
    int cx = SX(ball.x), cy = SY(ball.y);
    int r = (int) BALL_R;
    int rx = r + (int)(ball.squash * 6);
    int ry = r - (int)(ball.squash * 8);
    if (rx < 6) { rx = 6; }
    if (ry < 6) { ry = 6; }

    /* body */
    setfillstyle(SOLID_FILL, LIGHTRED);
    fillellipse(cx, cy, rx, ry);
    setcolor(RED);
    circle(cx, cy, rx > ry ? rx : ry);
    /* shine */
    setfillstyle(SOLID_FILL, WHITE);
    fillellipse(cx - rx / 3, cy - ry / 2, 3, 2);

    /* the eyes: whites + pupils that look where the ball goes */
    int eyeY = cy - ry / 4;
    int exOff = ball.face * 3;
    setfillstyle(SOLID_FILL, WHITE);
    fillellipse(cx - 5 + exOff, eyeY, 4, 4);
    fillellipse(cx + 5 + exOff, eyeY, 4, 4);
    setfillstyle(SOLID_FILL, BLACK);
    int pupilY = eyeY + (ball.vy > 2 ? 2 : (ball.vy < -2 ? -1 : 0));
    fillellipse(cx - 5 + exOff * 2, pupilY, 2, 2);
    fillellipse(cx + 5 + exOff * 2, pupilY, 2, 2);
}

/* the pop animation: red shards flying apart */
static void drawDeath ( )
{
    int cx = SX(ball.x), cy = SY(ball.y);
    int t = 60 - deathTimer;
    for (int i = 0; i < 10; i++) {
        double a = 6.283185 * i / 10;
        int d = 4 + t * 2;
        setfillstyle(SOLID_FILL, LIGHTRED);
        fillellipse(cx + (int)(cos(a) * d), cy + (int)(sin(a) * d) + t,
                    3, 3);
    }
    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
    setcolor(WHITE);
    outtextxy(cx - 40, cy - 40, (char*)"POP!");
}

static void drawHud ( int levelIdx, int livesLeft )
{
    char buf[64];
    setfillstyle(SOLID_FILL, BLACK);
    bar(0, 0, getmaxx(), HUD_H);

    settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));

    setcolor(LIGHTGRAY);
    outtextxy(16, 8, (char*)"LEVEL");
    snprintf(buf, sizeof(buf), "%d/%d", levelIdx + 1, LEVEL_COUNT);
    setcolor(WHITE);
    outtextxy(16 + 90, 8, buf);

    setcolor(LIGHTGRAY);
    outtextxy(200, 8, (char*)"RINGS");
    snprintf(buf, sizeof(buf), "%d/%d", ringsGot, ringsTotal);
    setcolor(YELLOW);
    outtextxy(200 + 90, 8, buf);

    setcolor(LIGHTGRAY);
    outtextxy(400, 8, (char*)"DIAMONDS");
    snprintf(buf, sizeof(buf), "%d", diamondsGot);
    setcolor(CYAN);
    outtextxy(400 + 150, 8, buf);

    /* lives as little balls */
    setcolor(LIGHTGRAY);
    outtextxy(getmaxx() - 190, 8, (char*)"LIVES");
    for (int i = 0; i < livesLeft; i++) {
        setfillstyle(SOLID_FILL, LIGHTRED);
        fillellipse(getmaxx() - 110 + i * 24, 16, 8, 8);
        setcolor(RED);
        circle(getmaxx() - 110 + i * 24, 16, 8);
    }

    /* the charge meter: how compressed the ball is right now */
    if (ball.charge > 0) {
        int bw = 120;
        int fill = bw * ball.charge / CHARGE_MAX;
        px_like_rect(16, HUD_H - 10, 16 + bw, HUD_H - 4, DARKGRAY);
        if (fill > 2) {
            px_like_rect(17, HUD_H - 9, 16 + fill, HUD_H - 5,
                         ball.charge > CHARGE_MAX * 2 / 3 ? LIGHTRED : YELLOW);
        }
    }

    setcolor(DARKGRAY);
    line(0, HUD_H, getmaxx(), HUD_H);
}

/* thin labelled wrapper so the HUD does not depend on bar() naming */
static void px_like_rect ( int x1, int y1, int x2, int y2, int c )
{
    setfillstyle(SOLID_FILL, c);
    bar(x1, y1, x2, y2);
}

static void present ( ) { swapbuffers(); }

static void drawPlayScreen ( int levelIdx, int livesLeft )
{
    drawBackground();
    drawTiles();
    drawBall();
    if (deathTimer > 0) { drawDeath(); }
    drawHud(levelIdx, livesLeft);

    if (completeTimer > 0) {
        textCenteredH(getmaxy() / 2 - 60, "LEVEL CLEAR!", YELLOW, GOTHIC_FONT, fsz(6));
        char buf[64];
        snprintf(buf, sizeof(buf), "diamonds this run: %d", diamondsGot);
        textCenteredH(getmaxy() / 2 + 20, buf, WHITE, DEFAULT_FONT, fsz(2));
    }
    if (playPaused) {
        /* v1.5.16: real pause overlay (Esc first pauses, Esc again quits) */
        int l = getmaxx() / 2 - 190, t = getmaxy() / 2 - 70;
        int r = getmaxx() / 2 + 190, b = getmaxy() / 2 + 70;
        setfillstyle(SOLID_FILL, BLACK); bar(l, t, r, b);
        setcolor(YELLOW);   rectangle(l, t, r, b);
        setcolor(DARKGRAY); rectangle(l + 4, t + 4, r - 4, b - 4);
        textCenteredH(getmaxy() / 2 - 34, "PAUSED", YELLOW, GOTHIC_FONT, fsz(4));
        textCenteredH(getmaxy() / 2 + 22, "P - resume", WHITE, DEFAULT_FONT, fsz(2));
        textCenteredH(getmaxy() / 2 + 44, "Esc - quit to the menu", WHITE, DEFAULT_FONT, fsz(2));
    }
    present();
}

/* ==========================================================================
 * SECTION 8 — screens: menu, level select, help, game over, victory
 * ========================================================================== */

static void textCenteredH ( int y, const char* s, int color, int font, int size )
{
    settextstyle(font, HORIZ_DIR, size);
    setcolor(color);
    int w = textwidth((char*)s);
    outtextxy((getmaxx() - w) / 2, y, (char*)s);
}

static void shadowCenteredH ( int y, const char* s, int color, int font, int size )
{
    settextstyle(font, HORIZ_DIR, size);
    int w = textwidth((char*)s);
    int x = (getmaxx() - w) / 2;
    setcolor(DARKGRAY);
    outtextxy(x + 3, y + 3, (char*)s);
    setcolor(color);
    outtextxy(x, y, (char*)s);
}

static void drawMenu ( int selection, const BounceDB& db )
{
    char sndRow[48];
    const char* ITEMS[5];
    int fontSize = fsz(3);
    int rowH = fontSize * 8 + 20;

    snprintf(sndRow, sizeof(sndRow), "Sound:  %s", soundOn ? "ON" : "OFF");
    ITEMS[0] = "Start Game"; ITEMS[1] = "Level Select"; ITEMS[2] = "Help";
    ITEMS[3] = sndRow; ITEMS[4] = "Quit";

    cleardevice();

    shadowCenteredH(30, "BOUNCE", LIGHTRED, GOTHIC_FONT, fsz(8));

    settextstyle(GOTHIC_FONT, HORIZ_DIR, fsz(8));
    int boxTop = 24 + textheight((char*)"BOUNCE") + 26;
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

    setfillstyle(SOLID_FILL, BLACK);
    bar(getmaxx() / 2 - barHalf - 20, boxTop,
        getmaxx() / 2 + barHalf + 20, boxTop + boxH);
    setcolor(DARKGRAY);
    rectangle(getmaxx() / 2 - barHalf - 20, boxTop,
              getmaxx() / 2 + barHalf + 20, boxTop + boxH);

    for (int i = 0; i < 5; i++) {
        int y = boxTop + 12 + i * rowH;
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, GREEN);
            bar(getmaxx() / 2 - barHalf, y - 6,
                getmaxx() / 2 + barHalf, y + fontSize * 8 + 6);
            setfillstyle(SOLID_FILL, WHITE);
            bar(getmaxx() / 2 - barHalf, y + fontSize * 8 + 6,
                getmaxx() / 2 + barHalf, y + fontSize * 8 + 9);
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

    char stats[96];
    snprintf(stats, sizeof(stats),
             "unlocked level %d/%d   |   diamonds banked %d",
             db.unlocked + 1, LEVEL_COUNT, db.diamonds);
    textCenteredH(getmaxy() - 64, stats, LIGHTGRAY, DEFAULT_FONT, fsz(2));
    textCenteredH(getmaxy() - 40,
        "W/S choose   Enter select   +/- window size",
        DARKGRAY, DEFAULT_FONT, fsz(2));

    present();
}

static void drawLevelSelect ( int selection, const BounceDB& db )
{
    cleardevice();
    shadowCenteredH(48, "SELECT LEVEL", LIGHTCYAN, GOTHIC_FONT, fsz(6));

    int cols = 3;
    int cellW = 130, cellH = 90;
    int gx = getmaxx() / 2 - (cols * cellW) / 2;
    int gy = 48 + textheight((char*)"SELECT LEVEL") + 40;

    for (int i = 0; i < LEVEL_COUNT; i++) {
        int cx = gx + (i % cols) * cellW;
        int cy = gy + (i / cols) * cellH;
        bool unlocked = (i <= db.unlocked);
        bool sel = (i == selection);
        if (sel) {
            setfillstyle(SOLID_FILL, GREEN);
            bar(cx + 2, cy + 2, cx + cellW - 2, cy + cellH - 2);
        }
        setfillstyle(SOLID_FILL, unlocked ? (sel ? BLACK : BLUE) : BLACK);
        bar(cx + 6, cy + 6, cx + cellW - 6, cy + cellH - 6);
        setcolor(sel ? BLACK : (unlocked ? CYAN : DARKGRAY));
        rectangle(cx + 6, cy + 6, cx + cellW - 6, cy + cellH - 6);

        char num[8];
        snprintf(num, sizeof(num), "%d", i + 1);
        settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(4));
        setcolor(sel ? BLACK : (unlocked ? WHITE : DARKGRAY));
        int w = textwidth(num);
        outtextxy(cx + cellW / 2 - w / 2, cy + 16, num);
        if (!unlocked) {
            setcolor(DARKGRAY);
            settextstyle(DEFAULT_FONT, HORIZ_DIR, fsz(2));
            w = textwidth((char*)"LOCKED");
            outtextxy(cx + cellW / 2 - w / 2, cy + cellH - 32, (char*)"LOCKED");
        }
    }

    textCenteredH(getmaxy() - 64, "W/S/A/D choose   Enter play   Esc back",
                  LIGHTGRAY, DEFAULT_FONT, fsz(2));
    present();
}

static void drawHelp ( )
{
    cleardevice();
    shadowCenteredH(48, "HOW TO PLAY", YELLOW, GOTHIC_FONT, fsz(6));

    int l = 60, t = 48 + textheight((char*)"HOW TO PLAY") + 24;
    int b = getmaxy() - 96;
    setfillstyle(SOLID_FILL, BLACK);
    bar(l, t, getmaxx() - l, b);
    setcolor(DARKGRAY);
    rectangle(l, t, getmaxx() - l, b);

    struct Row { const char* k; const char* v; };
    static const Row ROWS[] = {
        { "Roll",         "LEFT / RIGHT or A / D" },
        { "Bounce",       "HOLD Up / W / Space, then release" },
        { "Big bounce",   "the longer the hold, the higher the flight" },
        { "Rings",        "collect every ring to open the door" },
        { "Diamonds",     "bonus sparkle - banked across runs" },
        { "Spikes",       "they pop the ball - do not touch" },
        { "Springs",      "touch one to fly sky-high" },
        { "Movers",       "grey platforms carry you across gaps" },
        { "Pause",        "Esc pauses, Esc again quits" }
    };
    int keySize = fsz(2);
    int rowStep = keySize * 8 + 12;
    int y = t + 20;
    int maxRows = (b - t - 36) / rowStep;
    for (int i = 0; i < 9 && i < maxRows; i++) {
        settextstyle(DEFAULT_FONT, HORIZ_DIR, keySize);
        setcolor(YELLOW);
        outtextxy(l + 26, y, (char*)ROWS[i].k);
        setcolor(WHITE);
        outtextxy(l + 250, y, (char*)ROWS[i].v);
        y += rowStep;
    }
    textCenteredH(getmaxy() - 64, "Esc - back", LIGHTGRAY, DEFAULT_FONT, fsz(2));
    present();
}

static void drawGameOverScreen ( int levelIdx, int diamondsRun )
{
    cleardevice();
    shadowCenteredH(110, "GAME OVER", RED, GOTHIC_FONT, fsz(7));
    char buf[80];
    snprintf(buf, sizeof(buf), "the run ended on level %d with %d diamonds",
             levelIdx + 1, diamondsRun);
    textCenteredH(getmaxy() / 2 + 10, buf, WHITE, DEFAULT_FONT, fsz(2));
    textCenteredH(getmaxy() / 2 + 50, "Enter - try again      Esc - menu",
                  LIGHTGRAY, DEFAULT_FONT, fsz(2));
    present();
}

static void drawVictoryScreen ( int diamondsRun )
{
    cleardevice();
    shadowCenteredH(110, "YOU CLEARED EVERYTHING!", YELLOW, GOTHIC_FONT, fsz(5));
    char buf[80];
    snprintf(buf, sizeof(buf), "all six levels, %d diamonds collected", diamondsRun);
    textCenteredH(getmaxy() / 2 + 10, buf, WHITE, DEFAULT_FONT, fsz(2));
    /* fireworks-ish celebration */
    for (int i = 0; i < 60; i++) {
        int x = (int)(((long)i * 1103515245 + 12345) % (unsigned)(getmaxx() + 1));
        int y = HUD_H + (int)(((long)i * 69069) % (unsigned)(getmaxy() - HUD_H));
        putpixel(x, y, (i % 3 == 0) ? YELLOW : (i % 3 == 1) ? LIGHTRED : CYAN);
    }
    textCenteredH(getmaxy() / 2 + 50, "Enter - menu", LIGHTGRAY, DEFAULT_FONT, fsz(2));
    present();
}

/* ==========================================================================
 * SECTION 9 — main(): menu, run flow, screenshot hook
 * ========================================================================== */

/* Opens the game window (double-buffered on both platforms — see the
 * other games in this suite for the platform notes). */
static void openWindow ( const BounceDB& db )
{
#ifdef _WIN32
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h,
               "BOUNCE - graphics.h", 0, 0, true);
#else
    initwindow(SIZES[db.winSize].w, SIZES[db.winSize].h);
    setactivepage(1);
#endif
}

static void applyWindowSize ( const BounceDB& db )
{
    closegraph();
    openWindow(db);
}

static void startLevel ( int idx, double sx, double sy )
{
    loadLevel(idx, sx, sy);
    placeBall(sx, sy);
    deathTimer = 0;
    completeTimer = 0;
    camX = 0;
    camY = 0;
}

int main ( int argc, char* argv[] )
{
    /* battery hook: BGI_AUTOEXIT_MS -> demo AI plays and exits cleanly */
    { const char* ae = getenv("BGI_AUTOEXIT_MS");
      if (ae) { if (atol(ae) > 0) { demoMode = true; } } }
    long demoExitMs = 0;
    { const char* ae = getenv("BGI_AUTOEXIT_MS");
      if (ae) { demoExitMs = atol(ae); } }
    time_t demoStart = time(NULL);

    srand((unsigned)time(NULL));
    resolveDbPath(argc > 0 ? argv[0] : "");

    BounceDB db;
    loadDatabase(db);

    openWindow(db);
    keyHeldInit();
    sfxInit();

    int screen = 0;         /* 0 menu, 1 levels, 2 help, 3 play,
                               4 game over, 5 victory */
    int selection = 0;
    int levelSel = db.unlocked;
    int levelIdx = 0;
    int diamondsRun = 0;
    double sx = 0, sy = 0;
    lives = LIVES_MAX;

    /* screenshot hook: render one prepared screen, exit 0 */
    { const char* shot = getenv("BGI_SCREENSHOT");
      if (shot && shot[0]) {
          startLevel(0, sx, sy);
          if (strcmp(shot, "game") == 0) {
              for (int i = 0; i < 90; i++) { demoDrive(); tickBall(); }
              drawPlayScreen(0, LIVES_MAX);
          } else {
              drawMenu(0, db);
          }
          delay(2500);
          closegraph();
          return 0;
      } }

    while (true) {
        if (demoMode && (time(NULL) - demoStart) >= demoExitMs / 1000) { break; }

        if (demoMode) {
            /* attract mode: the AI rolls and bounces through level 1 */
            demoDrive();
            tickBall();
            if (deathTimer > 0) {
                deathTimer--;
                if (deathTimer == 0) { startLevel(0, sx, sy); }
            }
            if (completeTimer > 0) { startLevel(0, sx, sy); }
            drawPlayScreen(0, LIVES_MAX);
            delay(14);
            continue;
        }

        if (screen == 0) {
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
            if (selection == 3) {
                if (k == K_LEFT  || k == K_RIGHT
                    || (k == K_LETTER && (readKeyLetter == 'a' || readKeyLetter == 'd'))) {
                    soundOn = !soundOn; saveDatabase(db); playSfx(SFX_TICK);
                }
            }
            if (k == K_ESC) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                if (selection == 0) {
                    levelIdx = 0;
                    diamondsRun = 0;
                    lives = LIVES_MAX;
                    playPaused = false;
                    startLevel(levelIdx, sx, sy);
                    screen = 3;
                } else if (selection == 1) {
                    levelSel = db.unlocked;
                    screen = 1;
                } else if (selection == 2) {
                    screen = 2;
                } else if (selection == 3) {
                    soundOn = !soundOn; saveDatabase(db); playSfx(SFX_TICK);
                } else if (selection == 4) {
                    break;
                }
            }
        } else if (screen == 1) {
            drawLevelSelect(levelSel, db);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_LEFT  || (k == K_LETTER && readKeyLetter == 'a')) { if (levelSel > 0) { levelSel--; playSfx(SFX_TICK); } }
            if (k == K_RIGHT || (k == K_LETTER && readKeyLetter == 'd')) { if (levelSel < LEVEL_COUNT - 1 && levelSel < db.unlocked) { levelSel++; playSfx(SFX_TICK); } }
            if (k == K_UP    || (k == K_LETTER && readKeyLetter == 'w')) { if (levelSel > 2) { levelSel -= 3; playSfx(SFX_TICK); } }
            if (k == K_DOWN  || (k == K_LETTER && readKeyLetter == 's')) { if (levelSel + 3 < LEVEL_COUNT && levelSel + 3 <= db.unlocked) { levelSel += 3; playSfx(SFX_TICK); } }
            if (k == K_ESC) { screen = 0; }
            if ((k == K_ENTER || k == K_SPACE) && levelSel <= db.unlocked) {
                levelIdx = levelSel;
                diamondsRun = 0;
                lives = LIVES_MAX;
                playPaused = false;
                startLevel(levelIdx, sx, sy);
                screen = 3;
            }
        } else if (screen == 2) {
            drawHelp();
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC || k == K_ENTER
                || (k == K_LETTER && (readKeyLetter == 'q' || readKeyLetter == 'h'))) {
                screen = 0;
            }
        } else if (screen == 3) {
            int k = pollKey();
            if (k == K_QUIT) { break; }
            if (k == K_ESC) {
                /* v1.5.16: first Esc pauses, a second Esc quits to the
                 * menu (matches the help screen, which always promised a
                 * pause that did not exist) */
                if (playPaused) { playPaused = false; screen = 0; continue; }
                playPaused = true;
            }
            if (k == K_LETTER && readKeyLetter == 'p') { playPaused = !playPaused; }
            if (k == K_PLUS || k == K_MINUS) {
                int dir = (k == K_PLUS) ? 1 : -1;
                db.winSize = (db.winSize + dir + 4) % 4;
                saveDatabase(db);
                applyWindowSize(db);
            }

            if (!playPaused) {
                tickBall();

                if (deathTimer > 0) {
                    deathTimer--;
                    if (deathTimer == 0) {
                        lives--;
                        if (lives <= 0) {
                            screen = 4;            /* game over */
                            gameoverSfxDone = false;
                        } else {
                            startLevel(levelIdx, sx, sy);
                        }
                    }
                } else if (completeTimer == 1) {
                    /* the door just swallowed the ball: bank the progress,
                     * show LEVEL CLEAR!, then move on                      */
                    completeTimer = 70;
                    diamondsRun += diamondsGot;
                    db.diamonds += diamondsGot;
                    if (levelIdx + 1 > db.unlocked && levelIdx + 1 < LEVEL_COUNT) {
                        db.unlocked = levelIdx + 1;
                    }
                    saveDatabase(db);
                    playSfx(SFX_DOOR);
                } else if (completeTimer > 1) {
                    completeTimer--;
                    if (completeTimer <= 1) {
                        completeTimer = 0;
                        levelIdx++;
                        if (levelIdx >= LEVEL_COUNT) {
                            screen = 5;            /* victory */
                            playSfx(SFX_VICTORY);
                        } else {
                            startLevel(levelIdx, sx, sy);
                        }
                    }
                }
            }

            drawPlayScreen(levelIdx, lives);
            delay(14);
        } else if (screen == 4) {
            drawGameOverScreen(levelIdx, diamondsRun);
            if (!gameoverSfxDone) { playSfx(SFX_GAMEOVER); gameoverSfxDone = true; }
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ENTER || k == K_SPACE) {
                levelIdx = 0;
                diamondsRun = 0;
                lives = LIVES_MAX;
                playPaused = false;
                startLevel(levelIdx, sx, sy);
                screen = 3;
            }
            if (k == K_ESC || (k == K_LETTER && readKeyLetter == 'q')) {
                screen = 0;
            }
        } else if (screen == 5) {
            drawVictoryScreen(diamondsRun);
            int k = readKey();
            if (k == K_QUIT) { break; }
            if (k == K_ENTER || k == K_ESC
                || (k == K_LETTER && readKeyLetter == 'q')) {
                screen = 0;
            }
        }
    }

    closegraph();
    return 0;
}
