/* Minimal windows.h stub — lets the REAL WinBGIm headers (and WinBGIm
 * programs) be syntax-checked with plain g++ on Linux. Types/constants only;
 * nothing links. Values mirror winuser.h. */
#ifndef STUB_WINDOWS_H
#define STUB_WINDOWS_H
#include <cstddef>
#ifdef __cplusplus
extern "C" {
#endif
typedef void* HWND;
typedef void* HDC;
typedef void* HBITMAP;
typedef void* HINSTANCE;
typedef void* HANDLE;
typedef void* LPVOID;
typedef unsigned long DWORD;
typedef unsigned long ULONG;
typedef long LONG;
typedef int BOOL;
typedef unsigned int UINT;
typedef unsigned short WORD;
typedef unsigned char BYTE;
typedef unsigned long long WPARAM;
typedef long long LPARAM;
typedef long long LRESULT;
typedef const char* LPCSTR;
typedef const char* LPCTSTR;
typedef char* LPSTR;
#define WM_MOUSEMOVE    0x0200
#define WM_LBUTTONDOWN  0x0201
#define WM_LBUTTONUP    0x0202
#define WM_RBUTTONDOWN  0x0203
#define WM_RBUTTONUP    0x0204
#define WM_MBUTTONDOWN  0x0207
#define WM_MBUTTONUP    0x0208
#define WM_KEYDOWN      0x0100
#define WM_KEYUP        0x0101
#define WM_CHAR         0x0102

/* v1.5.16: runtime-loaded sound support (LoadLibraryA/GetProcAddress in
 * the samples' sound engine) — declarations only, nothing links. */
typedef void* HMODULE;
typedef void* FARPROC;
#define WINAPI
#define SND_ASYNC      0x0001
#define SND_NODEFAULT  0x0002
#define SND_MEMORY     0x0004
BOOL WINAPI PlaySoundA (LPCSTR pszSound, HMODULE hmod, DWORD fdwSound);
HMODULE WINAPI LoadLibraryA (LPCSTR lpLibFileName);
FARPROC WINAPI GetProcAddress (HMODULE hModule, LPCSTR lpProcName);
#ifdef __cplusplus
}
#endif
#endif /* STUB_WINDOWS_H */
