/**
 * settingsHealth.ts — repair the "Unable to write into user settings" crash
 * at the root (Sentry GRAPHICS-H-RUNNER-10, 2026-10-10).
 *
 * VS Code's own ConfigurationEditingService refuses EVERY global
 * configuration update — from any code path, not just ours — while the
 * user's settings.json contains a JSON syntax error, and answers with:
 *
 *   CodeExpectedError: Unable to write into user settings. Please open the
 *   user settings to correct errors/warnings in it and try again.
 *
 * v1.5.23 and earlier ran Complete Setup's `configuration.update(...,
 * ConfigurationTarget.Global)` calls with no guard around them, so a single
 * broken settings.json turned the whole setup into "Complete Setup failed"
 * (the error even landed in our Sentry inbox as GRAPHICS-H-RUNNER-10).
 *
 * This module is the pure, VS Code-free core of the fix:
 *   - analyzeJsonc(): a position-aware JSONC validation that accepts exactly
 *     what VS Code's settings.json editor accepts (comments, trailing
 *     commas, BOM) and reports the first real syntax error with 1-based
 *     line/column — so users see WHERE their file is broken.
 *   - repairJsonc(): conservative, verified auto-repairs for the classes a
 *     hand-edited settings.json actually breaks with (smart quotes pasted
 *     from chat/word processors, single quotes pasted from JS, doubled
 *     commas, missing commas between members, unclosed braces). Every fix
 *     only touches characters OUTSIDE real strings/comments and is kept
 *     only when the whole document then parses — the parsed VALUES of the
 *     user's settings are never altered.
 *   - classifySettingsWriteError(): recognizes VS Code's user/workspace
 *     settings-write refusal (the exact localized-independent phrase).
 *   - userSettingsCandidates(): where the user settings.json lives on every
 *     VS Code flavor and platform (stable/insiders/vscodium/portable).
 *
 * The extension wires these into a guarded write that repairs + retries +
 * degrades gracefully — a broken settings file can no longer crash Setup.
 */

'use strict';

/* ---------------- position-aware JSONC analysis ---------------- */

export interface JsonError {
  /** 1-based line number (matches VS Code's gutter). */
  line: number;
  /** 1-based column. */
  col: number;
  /** Short human explanation. */
  message: string;
}

export interface ParseStatus {
  ok: boolean;
  errors: JsonError[];
  /** The parsed value (undefined when !ok). */
  value?: unknown;
}

const SMART_QUOTES = new Set(['\u201C', '\u201D', '\u2018', '\u2019']);

/**
 * Minimal recursive-descent JSONC validator with VS Code's settings.json
 * tolerances: // and block comments, trailing commas, a leading BOM.
 * Returns the first syntax error with its 1-based line/column, or ok.
 */
export function analyzeJsonc(rawText: string): ParseStatus {
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1); /* BOM — VS Code strips it too */
  }
  const lineOf: number[] = [0]; /* index -> line (1-based via search) */
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      lineOf.push(i + 1);
    }
  }
  const errors: JsonError[] = [];
  const posOf = (index: number): { line: number; col: number } => {
    /* index of the first line start <= index */
    let lo = 0;
    let hi = lineOf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOf[mid] <= index) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo + 1, col: index - lineOf[lo] + 1 };
  };
  const err = (index: number, message: string): undefined => {
    const p = posOf(Math.min(index, Math.max(text.length - 1, 0)));
    errors.push({ line: p.line, col: p.col, message });
    return undefined; /* the parse functions propagate this as the error signal */
  };

  let i = 0;
  const n = text.length;

  const skipWs = (): void => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) {
        i++;
      }
      if (i + 1 < n && text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') {
          i++;
        }
        continue;
      }
      if (i + 1 < n && text[i] === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) {
          i = n; /* unterminated block comment — reported below */
          return;
        }
        i = end + 2;
        continue;
      }
      return;
    }
  };

  const parseString = (): string | undefined => {
    /* returns the parsed string, or undefined after recording an error */
    const quote = text[i];
    if (SMART_QUOTES.has(quote)) {
      const which = quote === '\u2018' || quote === '\u2019' ? 'single' : 'double';
      return err(i, `Smart/curly ${which} quote — use straight quotes (")`);
    }
    i++;
    let out = '';
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 >= n) {
          return err(i, 'Invalid escape: backslash at end of file');
        }
        const esc = text[i + 1];
        if ('"\\/bfnrt'.includes(esc)) {
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc;
          i += 2;
          continue;
        }
        if (esc === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return err(i, `Invalid \\u escape: ${hex.slice(0, 4) || '(empty)'}`);
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        return err(i, `Invalid escape character: \\${esc}`);
      }
      if (ch === quote) {
        i++;
        return out;
      }
      if (ch === '\n') {
        return err(i, 'Unterminated string (newline inside quotes)');
      }
      out += ch;
      i++;
    }
    return err(i, 'Unterminated string at end of file');
  };

  const parseValue = (): unknown | undefined => {
    skipWs();
    if (i >= n) {
      return err(i, 'Unexpected end of file — missing value');
    }
    const ch = text[i];
    if (ch === '"') {
      return parseString();
    }
    if (ch === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      skipWs();
      if (i < n && text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        skipWs();
        if (i >= n) {
          return err(i, 'Unexpected end of file — missing "}"');
        }
        if (text[i] !== '"') {
          const c = text[i];
          if (SMART_QUOTES.has(c)) {
            const which = c === '\u2018' || c === '\u2019' ? 'single' : 'double';
            return err(i, `Smart/curly ${which} quote — use straight quotes (")`);
          }
          return err(i, `Expected a quoted property name, found "${c === '\n' ? '\\n' : c}"`);
        }
        const key = parseString();
        if (key === undefined) {
          return undefined;
        }
        skipWs();
        if (i >= n || text[i] !== ':') {
          return err(i, i < n ? `Expected ":" after property "${key}"` : 'Unexpected end of file — missing ":"');
        }
        i++;
        const value = parseValue();
        if (value === undefined) {
          return undefined;
        }
        obj[key] = value;
        skipWs();
        if (i < n && text[i] === ',') {
          i++;
          skipWs();
          if (i < n && text[i] === '}') {
            i++; /* trailing comma — allowed like in VS Code */
            return obj;
          }
          continue;
        }
        if (i < n && text[i] === '}') {
          i++;
          return obj;
        }
        return err(i, i < n ? `Expected "," or "}" in object, found "${text[i]}"` : 'Unexpected end of file — missing "}"');
      }
    }
    if (ch === '[') {
      i++;
      const arr: unknown[] = [];
      skipWs();
      if (i < n && text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        const value = parseValue();
        if (value === undefined) {
          return undefined;
        }
        arr.push(value);
        skipWs();
        if (i < n && text[i] === ',') {
          i++;
          skipWs();
          if (i < n && text[i] === ']') {
            i++; /* trailing comma — allowed */
            return arr;
          }
          continue;
        }
        if (i < n && text[i] === ']') {
          i++;
          return arr;
        }
        return err(i, i < n ? `Expected "," or "]" in array, found "${text[i]}"` : 'Unexpected end of file — missing "]"');
      }
    }
    /* keywords and numbers */
    const rest = text.slice(i);
    const kw = /^(true|false|null)/.exec(rest);
    if (kw) {
      i += kw[0].length;
      return kw[0] === 'true' ? true : kw[0] === 'false' ? false : null;
    }
    const num = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (num && num[0].length > 0) {
      i += num[0].length;
      return Number(num[0]);
    }
    if (ch === "'") {
      return err(i, "Single-quoted value — strings must use straight double quotes (\")");
    }
    if (SMART_QUOTES.has(ch)) {
      const which = ch === '\u2018' || ch === '\u2019' ? 'single' : 'double';
      return err(i, `Smart/curly ${which} quote — use straight quotes (")`);
    }
    if (ch === '}') {
      return err(i, 'Unexpected "}"');
    }
    if (ch === ']') {
      return err(i, 'Unexpected "]"');
    }
    const bad = rest.split(/\s/, 1)[0] || ch;
    return err(i, `Unexpected token "${bad.slice(0, 20)}"`);
  };

  skipWs();
  if (i >= n) {
    return { ok: true, errors: [], value: undefined }; /* empty file — VS Code accepts */
  }
  const value = parseValue();
  if (value === undefined || errors.length > 0) {
    return { ok: false, errors };
  }
  if (value === null || typeof value !== 'object') {
    err(i, 'settings.json must contain an object { "setting": value } at the top level');
    return { ok: false, errors };
  }
  skipWs();
  if (i < n) {
    err(i, `Unexpected content after the JSON value ("${text.slice(i, i + 12).trim()}")`);
    return { ok: false, errors };
  }
  return { ok: true, errors: [], value };
}

/** Human, gutter-accurate description of the analysis errors. */
export function describeErrors(errors: JsonError[]): string {
  return errors
    .map((e) => `line ${e.line}, column ${e.col}: ${e.message}`)
    .join('; ');
}

/* ---------------- verified conservative repairs ---------------- */

export interface RepairResult {
  /** Repaired text (== original when nothing was safely fixable). */
  text: string;
  /** True when the returned text parses cleanly. */
  ok: boolean;
  /** Names of the fixes that were applied (in order). */
  applied: string[];
  /** Remaining errors when !ok (from the final analysis). */
  errors: JsonError[];
}

/**
 * Build a "mask" copy of the text where every character inside real
 * double-quoted strings and comments is replaced with a placeholder that is
 * NOT one of the structural characters we scan for. Length and line breaks
 * are preserved, so indexes stay valid against the original.
 *
 * Smart/single quotes inside valid strings or comments survive untouched:
 * they are legal content, and any repair that changed them could alter what
 * the user's settings MEAN.
 */
function buildMask(text: string): string {
  const out = new Array<string>(text.length);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      /* a real double-quoted string (escape-aware): the QUOTE DELIMITERS stay
       * structural (fixMissingCommas needs the closing quote to recognize a
       * line that ends with a string value); only the CONTENT is masked */
      out[i] = '"';
      i++;
      while (i < n) {
        const c = text[i];
        if (c === '\\' && i + 1 < n) {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (c === '"') {
          out[i] = '"';
          i++;
          break;
        }
        out[i] = c === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && i + 1 < n && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const block = text[i + 1] === '*';
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      if (block) {
        const end = text.indexOf('*/', i);
        const stop = end < 0 ? n : end;
        while (i < stop) {
          out[i] = text[i] === '\n' ? '\n' : ' ';
          i++;
        }
        if (end >= 0) {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
        }
      } else {
        while (i < n && text[i] !== '\n') {
          out[i] = ' ';
          i++;
        }
      }
      continue;
    }
    out[i] = ch;
    i++;
  }
  return out.join('');
}

/** Replace every structural (unmasked) smart quote with a straight one. */
function fixSmartQuotes(text: string): { text: string; hits: number } {
  const mask = buildMask(text);
  let hits = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SMART_QUOTES.has(ch) && mask[i] === ch) {
      /* structural smart quote (never inside a string/comment — those are
       * masked) — straighten it */
      out += ch === '\u2018' || ch === '\u2019' ? "'" : '"';
      hits++;
    } else {
      out += ch;
    }
  }
  return { text: out, hits };
}

/** Convert single-quoted property names/values outside strings+comments. */
function fixSingleQuotes(text: string): { text: string; hits: number } {
  const mask = buildMask(text);
  let hits = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && mask[i] === ch) {
      /* not inside a string/comment: this is a structural single quote */
      out += '"';
      hits++;
    } else {
      out += ch;
    }
  }
  return { text: out, hits };
}

/** Collapse doubled commas (",,") and ", }"-style empties are left alone. */
function fixDoubleCommas(text: string): { text: string; hits: number } {
  const mask = buildMask(text);
  let hits = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ',' && mask[i] === ',') {
      /* look ahead past whitespace for a second structural comma */
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (j < text.length && text[j] === ',' && mask[j] === ',') {
        /* drop this first comma; the second one stays */
        hits++;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, hits };
}

/**
 * Insert a missing comma between an object member / array element whose line
 * ends with a value and whose next non-empty line starts a new member
 * ("a": 1\n"b": 2 — the classic hand-edit omission). Only structural
 * positions qualify; verified by the caller via re-parse.
 */
function fixMissingCommas(text: string): { text: string; hits: number } {
  const mask = buildMask(text);
  const lines = text.split('\n');
  const outLines: string[] = [];
  let hits = 0;
  let offset = 0; /* running index of the current line start */
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let lineEnd = offset + line.length;
    /* last structural (non-space, non-comment) char of this line */
    let k = line.length - 1;
    let last = '';
    while (k >= 0) {
      const idx = offset + k;
      const ch = text[idx];
      if (/\s/.test(ch)) {
        k--;
        continue;
      }
      if (mask[idx] !== ch) {
        /* the line ends inside a string/comment — no structural value end
         * here, so no comma belongs at this line's end */
        last = '';
        break;
      }
      last = ch;
      lineEnd = idx;
      break;
    }
    if (last && last !== ',' && last !== ':' && last !== '{' && last !== '[' && last !== '/' && last !== '*') {
      /* find the next line that starts a new member/element: skip blank
       * lines and whole-line comments (a comment may legally sit between
       * two members — the comma still belongs after the value above) */
      let nl = li + 1;
      for (;;) {
        while (nl < lines.length && lines[nl].trim() === '') {
          nl++;
        }
        if (nl >= lines.length) {
          break;
        }
        let m = 0;
        while (m < lines[nl].length && /\s/.test(lines[nl][m])) {
          m++;
        }
        if (m >= lines[nl].length) {
          nl++;
          continue;
        }
        const nIdx = offsetOf(lines, nl) + m;
        const nCh = lines[nl][m];
        if (mask[nIdx] !== nCh) {
          /* the line opens with comment content — skip it and look on */
          nl++;
          continue;
        }
        if (nCh === '"' || nCh === '{' || nCh === '[') {
          /* append the comma right after the value — before a trailing
           * \r on CRLF files so the line ending survives the edit */
          if (line.endsWith('\r')) {
            outLines.push(line.slice(0, -1) + ',\r');
          } else {
            outLines.push(line.replace(/\s+$/, '') + ',');
          }
          hits++;
          offset += line.length + 1;
          break;
        }
        break; /* next line is a member continuation/closer — leave alone */
      }
      if (hits > 0 && outLines.length === li + 1) {
        continue; /* comma appended for this line — next input line */
      }
    }
    outLines.push(line);
    offset += line.length + 1;
  }
  return { text: outLines.join('\n'), hits };
}

function offsetOf(lines: string[], lineIndex: number): number {
  let o = 0;
  for (let i = 0; i < lineIndex; i++) {
    o += lines[i].length + 1;
  }
  return o;
}

/**
 * Append the missing closing braces/brackets the document ends without —
 * the classic "deleted one line too many" breakage.
 */
function fixUnclosedBraces(text: string): { text: string; hits: number } {
  const mask = buildMask(text);
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (mask[i] !== ch) {
      continue; /* inside string/comment */
    }
    if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      } else {
        /* mismatched closer — do not guess */
        return { text, hits: 0 };
      }
    }
  }
  if (stack.length === 0) {
    return { text, hits: 0 };
  }
  return { text: text + stack.reverse().join(''), hits: stack.length };
}

/**
 * Apply the conservative repair pipeline. Every fix only touches characters
 * outside real strings/comments and is a no-op on an already-valid document
 * (a valid file has no structural smart/single quotes, no ",,", no member
 * boundary without its comma, no unmatched brace), so the fixes can be
 * applied CUMULATIVELY — a file broken in several places at once (the
 * e2e's missing comma + doubled comma, say) heals in one pass. The gate is
 * the FULL parse of the final text: if it still does not parse, the
 * ORIGINAL text comes back unchanged so the caller never writes a file it
 * cannot vouch for.
 */
export function repairJsonc(originalText: string): RepairResult {
  const first = analyzeJsonc(originalText);
  if (first.ok) {
    return { text: originalText, ok: true, applied: [], errors: [] };
  }
  let text = originalText;
  const applied: string[] = [];
  const steps: Array<[string, (t: string) => { text: string; hits: number }]> = [
    ['smart-quotes', fixSmartQuotes],
    ['single-quotes', fixSingleQuotes],
    ['double-commas', fixDoubleCommas],
    ['missing-commas', fixMissingCommas],
    ['unclosed-braces', fixUnclosedBraces]
  ];
  for (const [name, fix] of steps) {
    const res = fix(text);
    if (res.hits > 0 && res.text !== text) {
      text = res.text;
      applied.push(name);
    }
  }
  const final = analyzeJsonc(text);
  return {
    text: final.ok ? text : originalText,
    ok: final.ok,
    applied: final.ok ? applied : [],
    errors: final.ok ? [] : final.errors.length > 0 ? final.errors : first.errors
  };
}

/* ---------------- VS Code error classification ---------------- */

export type SettingsWriteRefusal = 'user' | 'workspace';

/**
 * Recognize VS Code's ConfigurationEditingService refusal (the exact message
 * Sentry saw: "Unable to write into user settings. Please open the user
 * settings to correct errors/warnings in it and try again."). The wording is
 * stable across VS Code builds; we match the stable head of it.
 */
export function classifySettingsWriteError(error: unknown): SettingsWriteRefusal | undefined {
  const msg = String(
    error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)
      ? (error as { message?: unknown }).message
      : error || ''
  );
  if (/unable to write into user settings/i.test(msg)) {
    return 'user';
  }
  if (/unable to write into workspace settings/i.test(msg)) {
    return 'workspace';
  }
  return undefined;
}

/* ---------------- user settings.json locations ---------------- */

/**
 * Where the USER settings.json lives, across VS Code flavors and platforms.
 * Order: portable (when configured), stable, insiders, vscodium, OSS.
 * The caller picks the first path that exists.
 */
export function userSettingsCandidates(
  platform: 'win32' | 'darwin' | 'linux' | string,
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  const flavors =
    platform === 'win32'
      ? ['Code', 'Code - Insiders', 'VSCodium', 'Code - OSS']
      : platform === 'darwin'
        ? ['Code', 'Code - Insiders', 'VSCodium', 'Code - OSS']
        : ['Code', 'Code - Insiders', 'VSCodium', 'Code - OSS'];
  const out: string[] = [];
  if (env.VSCODE_PORTABLE) {
    out.push(...flavors.map((f) => `${env.VSCODE_PORTABLE}/data/user-data/${f}/User/settings.json`.replace(/\//g, pathSep(platform))));
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || (home ? `${home}/AppData/Roaming` : '');
    if (appData) {
      out.push(...flavors.map((f) => `${appData}\\${f}\\User\\settings.json`));
    }
  } else if (platform === 'darwin') {
    if (home) {
      out.push(...flavors.map((f) => `${home}/Library/Application Support/${f}/User/settings.json`));
    }
  } else if (home) {
    const configHome = env.XDG_CONFIG_HOME || `${home}/.config`;
    out.push(...flavors.map((f) => `${configHome}/${f}/User/settings.json`));
  }
  return out;
}

function pathSep(platform: string): string {
  return platform === 'win32' ? '\\' : '/';
}
