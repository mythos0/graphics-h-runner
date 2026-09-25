/**
 * detect.ts — detect whether a C/C++ source includes graphics.h.
 * Pure module: no vscode imports, so it can be unit-tested in plain Node.
 */

/**
 * Matches  #include <graphics.h>,  #include "graphics.h",
 *          #include <SDL_bgi.h>-style paths ending in graphics.h,
 * with optional whitespace around the '#'.
 */
const GRAPHICS_INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]*[<"][^<">]*graphics\.h[>"]/m;

export function detectGraphicsInclude(source: string): boolean {
  return GRAPHICS_INCLUDE_RE.test(source);
}

/** Returns the matched include line (trimmed) or null. Useful for diagnostics. */
export function findGraphicsIncludeLine(source: string): string | null {
  const m = source.match(GRAPHICS_INCLUDE_RE);
  return m ? m[0].trim() : null;
}
