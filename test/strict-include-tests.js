#!/usr/bin/env node
/**
 * strict-include-tests.js — shipped samples must declare every standard
 * header they use. NEVER rely on a transitive declaration.
 *
 * Why this gate exists (real field bug, user report against 1.5.20):
 * 32_lab_first_window.cpp used time() without #include <ctime>. It
 * compiled in our battery because modern mingw-w64's <iostream> chain
 * transitively pulls <time.h> (via <cwchar>) AND glibc leaks even more —
 * but the user's stricter/older MinGW failed with
 *   error: 'time' was not declared in this scope
 * Classroom compilers (TDM-GCC, nuwen, MinGW.org, older mingw-w64) are
 * all stricter than our GCC 14 test toolchain, so every sample that
 * leans on a transitive declaration is a time bomb.
 *
 * The check: strip comments/strings, find symbol usage from each standard
 * header group, require at least one matching #include per group.
 * Symbols appearing only in comments/strings are ignored.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLES = path.join(__dirname, '..', 'samples');

/* symbol regex -> any one of these includes satisfies the group */
const GROUPS = [
  [/\btime\s*\(|\btime_t\b|\bclock\s*\(|\bCLOCKS_PER_SEC\b|\bdifftime\s*\(|\blocaltime\s*\(|\bgmtime\s*\(/,
   ['ctime', 'time.h']],
  [/\brand\s*\(|\bsrand\s*\(|\batoi\s*\(|\batol\s*\(|\bstrtol\s*\(|\babort\s*\(|\bgetenv\s*\(|\bsystem\s*\(/,
   ['cstdlib', 'stdlib.h']],
  [/\bsqrt\s*\(|\bpow\s*\(|\bsin\s*\(|\bcos\s*\(|\btan\s*\(|\batan\s*\(|\batan2\s*\(|\basin\s*\(|\bacos\s*\(|\bfabs\s*\(|\bfmod\s*\(|\bfloor\s*\(|\bceil\s*\(|\bround\s*\(|\blog\s*\(|\blog10\s*\(|\bexp\s*\(/,
   ['cmath', 'math.h']],
  [/\bstrlen\s*\(|\bstrcmp\s*\(|\bstrncmp\s*\(|\bstrcpy\s*\(|\bstrncpy\s*\(|\bstrcat\s*\(|\bmemcpy\s*\(|\bmemset\s*\(|\bstrchr\s*\(|\bstrstr\s*\(/,
   ['cstring', 'string.h']],
  [/\bprintf\s*\(|\bsprintf\s*\(|\bsnprintf\s*\(|\bfprintf\s*\(|\bsscanf\s*\(|\bfgets\s*\(|\bfputs\s*\(|\bputs\s*\(/,
   ['cstdio', 'stdio.h']],
  [/\bisspace\s*\(|\bisdigit\s*\(|\bisalpha\s*\(|\btolower\s*\(|\btoupper\s*\(|\bisalnum\s*\(/,
   ['cctype', 'ctype.h']],
  [/\bINT_MAX\b|\bINT_MIN\b|\bUSHRT_MAX\b|\bUINT_MAX\b|\bLONG_MAX\b|\bSHRT_MAX\b/,
   ['climits', 'limits.h']],
  [/\bRAND_MAX\b|\bEXIT_SUCCESS\b|\bEXIT_FAILURE\b/,
   ['cstdlib', 'stdlib.h']],
  [/\bstd::vector\b|\bvector\s*</,
   ['vector']],
  [/\bstd::string\b/,
   ['string']],
  [/\bstd::sort\b|\bstd::max\b|\bstd::min\b/,
   ['algorithm', 'cstdlib', 'cmath']]
];

/* remove comments and string/char literals so prose never triggers a group */
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function main() {
  const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.cpp')).sort();
  const failures = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SAMPLES, f), 'utf8');
    const code = stripNoise(raw);
    const incs = new Set();
    for (const m of raw.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)) incs.add(m[1].trim());
    for (const [pat, need] of GROUPS) {
      const m = code.match(pat);
      if (!m) continue;
      if (!need.some((h) => incs.has(h))) {
        failures.push(`${f}: uses '${m[0].trim()}' but includes none of {${need.join(', ')}} (has: ${[...incs].join(', ')})`);
      }
    }
  }
  console.log(`strict-include-tests: ${files.length - failures.length}/${files.length} samples declare every standard header they use`);
  if (failures.length) {
    for (const f of failures) console.error('  FAIL ' + f);
    console.error('strict-include-tests: FAILED — a sample relies on a transitive standard include; add the header explicitly (older/stricter MinGW flavors do not leak declarations).');
    process.exitCode = 1;
  }
}

main();
