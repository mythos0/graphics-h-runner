#!/usr/bin/env node
/**
 * cheat-dom-tests.js — v1.5.9 DOM-structure regression for the cheat sheet.
 *
 * The v1.5.8 release shipped a broken cheat sheet: ONE stray `</div>` in the
 * hand-written overlay closed `.cheat-body` after the third category, so the
 * remaining eight categories became stray children of `.cheat-sheet` (clipped
 * invisible by `overflow:hidden`) and the footer was pushed out of the card —
 * users saw ONLY "WinBGIM is the default on Windows; SDL_bgi … Press Esc to
 * close." Nothing validated the DOM STRUCTURE of the rendered page — the
 * existing suites checked strings, JS logic and wiring, not markup shape.
 *
 * This suite parses the RENDERED page with a dependency-free, browser-style
 * stack parser (mismatched-close detection = the exact v1.5.8 failure signal)
 * and pins the overlay structure, the full data content, the escaping and
 * the host-driven open wiring. The parser treats <script>/<style> as RAW
 * TEXT (skipping their contents without eating the closing tag), so JS
 * literals like `</span>` or `a < b` inside the panel script cannot fool it.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { buildPanelHtml, buildFallbackPanelHtml, CHEAT_SECTION_COUNT, CHEAT_ENTRY_COUNT } =
  require(path.join(ROOT, 'out', 'panelHtml'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(ROOT, 'out', 'programs'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  \u2705 ' + name);
  } catch (e) {
    failures++;
    console.log('  \u274c ' + name + ' -> ' + e.message);
  }
}

/* ---------------- browser-style stack parser ---------------- */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', '!doctype']);

function parse(src) {
  const stack = [{ tag: '#root', kids: [], attrs: '' }];
  const mismatches = [];
  const unclosed = [];
  let i = 0;
  let rawText = false; /* inside <script>/<style> content: no text nodes */

  const addText = (end, start) => {
    if (end > start) {
      stack[stack.length - 1].kids.push({ tag: '#text', attrs: '', kids: [], text: src.slice(start, end), at: start });
    }
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { break; }
    if (!rawText) { addText(lt, i); }
    const gt = src.indexOf('>', lt);
    if (gt === -1) { break; }
    const raw = src.slice(lt + 1, gt).trim();

    if (raw.startsWith('/')) {
      /* closing tag: find the nearest matching open (browser recovery) */
      const tag = raw.slice(1).trim().toLowerCase();
      let k = stack.length - 1;
      while (k >= 0 && stack[k].tag !== tag) { k--; }
      if (k < 0) {
        mismatches.push('</' + tag + '> with no open element @' + lt);
      } else {
        if (k !== stack.length - 1) {
          mismatches.push('</' + tag + '> closed ' + (stack.length - 1 - k) + ' unclosed element(s): '
            + stack.slice(k + 1).map((n) => n.tag).join(', ') + ' @' + lt);
        }
        stack.length = k;
      }
      rawText = false;
      i = gt + 1;
      continue;
    }

    if (raw.startsWith('!') || raw.startsWith('?')) { /* doctype/comment/pi */
      i = gt + 1;
      continue;
    }

    const m = raw.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    const tag = m ? m[1].toLowerCase() : '';
    if (!tag) { i = gt + 1; continue; }

    const selfClosed = /\/$/.test(raw);
    const node = { tag, kids: [], at: lt, attrs: raw };
    stack[stack.length - 1].kids.push(node);
    if (VOID.has(tag) || selfClosed) {
      i = gt + 1;
      continue;
    }
    stack.push(node);
    i = gt + 1;

    /* script/style are RAW TEXT in browsers: jump straight to the real
       closing tag (JS literals like `</span>` or `a < b` never parse) */
    if (tag === 'script' || tag === 'style') {
      const endRe = new RegExp('</' + tag + '\\s*>', 'gi');
      endRe.lastIndex = i;
      const end = endRe.exec(src);
      i = end ? end.index : src.length;
      rawText = true; /* cleared when the closing tag is processed */
    }
  }
  for (const n of stack) {
    if (n.tag !== '#root') { unclosed.push(n.tag + ' @' + n.at); }
  }
  const textRuns = [];
  const collect = (n) => { for (const k of n.kids) { if (k.tag === '#text') { textRuns.push(k); } else { collect(k); } } };
  collect(stack[0]);
  return { root: stack[0], mismatches, unclosed, textRuns };
}

function kidsOf(node, tag) {
  return node.kids.filter((k) => k.tag === tag);
}

/* ---------------- render the real page ---------------- */
const programs = loadProgramCatalog(ROOT).map((p) => ({
  id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag, lab: !!p.lab
}));
const html = buildPanelHtml({
  programs,
  commands: COMMAND_META,
  status: { state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null },
  version: '9.9.9',
  nonce: 'domtestnonce',
  logoUri: '',
  cspSource: 'https://*.vscode-cdn.net'
});
const P = parse(html);

console.log('cheat-dom-tests — rendered overlay structure + content\n');

/* ---------------- 1. whole-page balance ---------------- */
check('whole page parses with ZERO mismatched closing tags (the v1.5.8 bug signal)', () => {
  assert.deepStrictEqual(P.mismatches, [], 'mismatched closes: ' + P.mismatches.slice(0, 4).join(' | '));
});
check('whole page leaves NO element unclosed', () => {
  assert.deepStrictEqual(P.unclosed, [], 'unclosed: ' + P.unclosed.slice(0, 6).join(', '));
});
check('div opens == div closes across the whole page', () => {
  let opens = 0;
  const count = (n) => { for (const k of n.kids) { if (k.tag === 'div') { opens++; } count(k); } };
  count(P.root);
  const closes = (html.match(/<\/div>/g) || []).length;
  const opensStr = (html.match(/<div[\s>]/g) || []).length;
  assert.strictEqual(opens, closes, 'parsed opens ' + opens + ' != close tags ' + closes);
  assert.strictEqual(opensStr, closes, 'raw <div count ' + opensStr + ' != close tags ' + closes);
});

/* ---------------- 2. overlay skeleton ---------------- */
const htmlNode = P.root.kids.find((k) => k.tag === 'html');
const body = htmlNode ? htmlNode.kids.find((k) => k.tag === 'body') : undefined;
const overlay = body.kids.find((k) => k.attrs.includes('class="cheat-overlay"'));
check('overlay exists, is a direct child of <body>, and carries the dialog contract', () => {
  assert.ok(overlay, 'overlay div not found in body');
  assert.ok(overlay.attrs.includes('id="cheat-overlay"'), 'overlay id missing');
  assert.ok(overlay.attrs.includes('role="dialog"'), 'dialog role missing');
  assert.ok(overlay.attrs.includes('aria-modal="true"'), 'aria-modal missing');
});
const sheet = overlay ? overlay.kids.find((k) => k.tag === 'div') : undefined;
check('overlay has EXACTLY ONE element child: .cheat-sheet (nothing leaked beside it)', () => {
  assert.ok(sheet, 'sheet div missing');
  const elKids = overlay.kids.filter((k) => k.tag !== '#text');
  assert.strictEqual(elKids.length, 1, 'overlay element children: ' + elKids.map((k) => k.tag + ':' + k.attrs).join(' | '));
  assert.ok(sheet.attrs.includes('class="cheat-sheet"'), 'single child is not .cheat-sheet');
});
check('sheet children in order: head, search input, body, foot — foot is the LAST child INSIDE the sheet', () => {
  const elKids = sheet.kids.filter((k) => k.tag !== '#text');
  const kinds = elKids.map((k) => (k.tag === 'input' ? 'input' : k.attrs.includes('cheat-head') ? 'head'
    : k.attrs.includes('cheat-body') ? 'body' : k.attrs.includes('cheat-foot') ? 'foot' : k.tag));
  assert.deepStrictEqual(kinds, ['head', 'input', 'body', 'foot'], 'sheet child order: ' + kinds.join(','));
  const foot = elKids[elKids.length - 1];
  assert.ok(foot.attrs.includes('class="cheat-foot"'), 'last sheet child is not the footer');
  /* the smoking gun of the v1.5.8 bug: the footer escaped the card */
  const footInBody = body.kids.some((k) => k.attrs && k.attrs.includes && k.attrs.includes('class="cheat-foot"'));
  assert.ok(!footInBody, 'footer leaked out of the sheet into the page body');
});
const cheatBody = sheet.kids.filter((k) => k.tag !== '#text').find((k) => k.attrs.includes('class="cheat-body"'));
const cats = cheatBody.kids.filter((k) => k.tag === 'div' && k.attrs.includes('class="cheat-cat"'));
check('.cheat-body children are ONLY cheat-cat sections + the empty-state row', () => {
  const bad = cheatBody.kids.filter((k) => k.tag !== '#text' && !k.attrs.includes('class="cheat-cat"') && !k.attrs.includes('id="cheat-empty"'));
  assert.deepStrictEqual(bad, [], 'stray children inside cheat-body: ' + bad.map((k) => k.attrs).join(' | '));
});

/* ---------------- 3. content: every section, every entry ---------------- */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/* recover the data source from the compiled module: re-render one section
   template and compare against the parsed DOM */
check('category count matches CHEAT_SECTION_COUNT (11) and entries match CHEAT_ENTRY_COUNT', () => {
  assert.strictEqual(CHEAT_SECTION_COUNT, 11, 'section count constant drifted');
  assert.strictEqual(CHEAT_ENTRY_COUNT, 81, 'entry count drifted: ' + CHEAT_ENTRY_COUNT);
  assert.strictEqual(cats.length, CHEAT_SECTION_COUNT, 'rendered categories != data sections');
  const fns = (html.match(/class="cheat-fn"/g) || []).length;
  assert.strictEqual(fns, CHEAT_ENTRY_COUNT, 'rendered entries != data entries');
});
check('every category title renders verbatim (escaped) under its h4', () => {
  const srcTitles = [
    'Setup & lifecycle', 'Coordinates & current position', 'Pixels & lines',
    'Shapes & curves', 'Colors', 'Filling', 'Text', 'Keyboard input',
    'Mouse (WinBGIm / SDL_bgi)', 'Images & animation', 'Viewports & pages'
  ];
  assert.deepStrictEqual(srcTitles.length, CHEAT_SECTION_COUNT, 'title list drifted from data');
  cats.forEach((cat, idx) => {
    const h4 = cat.kids.find((k) => k.tag === 'h4');
    assert.ok(h4, 'category ' + idx + ' has no h4');
    const text = h4.kids.filter((k) => k.tag === '#text').map((k) => k.text).join('');
    assert.strictEqual(text, esc(srcTitles[idx]), 'title ' + idx + ' mismatch: ' + JSON.stringify(text));
  });
});
check('all cheat-fn rows are DIRECT children of their category (no stray nesting)', () => {
  for (const cat of cats) {
    const fns = cat.kids.filter((k) => k.tag === 'div');
    assert.ok(fns.length >= 1, 'category without entries');
    for (const fn of fns) {
      assert.ok(fn.attrs.includes('class="cheat-fn"'), 'non-entry div inside category: ' + fn.attrs);
      const code = fn.kids.find((k) => k.tag === 'code');
      const span = fn.kids.find((k) => k.tag === 'span');
      assert.ok(code && span, 'entry missing code/span pair');
      assert.strictEqual(fn.kids.filter((k) => k.tag !== '#text').length, 2, 'entry has extra elements');
    }
  }
});
check('v1.5.10: the sheet is a PURE function reference — extension content removed', () => {
  /* scope to the OVERLAY subtree: the panel page itself may legitimately
     mention shortcuts elsewhere (footer hint), the sheet must not */
  const grab = (n, out) => { for (const k of n.kids) { if (k.tag === '#text') { out.push(k.text); } else { grab(k, out); } } return out; };
  const overlayText = grab(overlay, []).join(' ');
  for (const gone of ['Run it here', 'Celebrations', 'Common pitfalls', 'The screen coordinate system',
    'Ctrl+Alt+R', 'Confetti on success', 'School Pride']) {
    assert.ok(!overlayText.includes(gone) && !overlayText.includes(esc(gone)), 'extension content still rendered: ' + gone);
  }
  /* every section must be FUNCTION docs: each category has entries and each
     entry signature looks like a call (no prose-only pseudo entries) */
  for (const cat of cats) {
    const h4 = cat.kids.find((k) => k.tag === 'h4');
    const fns = cat.kids.filter((k) => k.tag === 'div');
    assert.ok(fns.length >= 3, 'category ' + h4.kids[0].text + ' has too few entries');
  }
});
check('spot-checks: key signatures across all 11 function sections, escaped correctly', () => {
  const flat = cats.map((c) => c.kids.filter((k) => k.tag === 'div')).flat();
  const codeOf = (fn) => fn.kids.find((k) => k.tag === 'code').kids.filter((k) => k.tag === '#text').map((k) => k.text).join('');
  const codes = flat.map(codeOf);
  for (const want of ['initwindow(width, height, &quot;title&quot;)', 'initgraph(&amp;gd, &amp;gm, &quot;path&quot;)',
    'closegraph()', 'getmaxx() / getmaxy()', 'graphresult()', 'getdrivername()',
    'putpixel(x, y, color)', 'getpixel(x, y)', 'setlinestyle(style, pattern, thickness)',
    'setwritemode(COPY_PUT / XOR_PUT)', 'rectangle(l, t, r, b)', 'circle(x, y, radius)',
    'arc(x, y, start, end, radius)', 'pieslice(x, y, start, end, radius)', 'fillpoly(n, pts)',
    'bar3d(l, t, r, b, depth, topflag)', 'setcolor(c)', 'COLOR(r, g, b)',
    'setfillstyle(pattern, color)', 'floodfill(x, y, border)', 'outtextxy(x, y, &quot;text&quot;)',
    'settextstyle(font, dir, size)', 'textheight(&quot;t&quot;) / textwidth(&quot;t&quot;)',
    'getch()', 'Arrow keys via getch()', 'kbhit()', 'mousex() / mousey()',
    'ismouseclick(kind)', 'getmouseclick(kind, &amp;x, &amp;y)', 'imagesize(l, t, r, b)',
    'getimage(l, t, r, b, bitmap)', 'putimage(l, t, bitmap, verb)', 'delay(ms)', 'swapbuffers()',
    'setviewport(l, t, r, b, clip)', 'setactivepage(p)', 'setcurrentwindow(n)']) {
    assert.ok(codes.includes(want), 'missing entry: ' + want);
  }
  const descs = flat.map((fn) => fn.kids.find((k) => k.tag === 'span').kids.filter((k) => k.tag === '#text').map((k) => k.text).join(''));
  for (const want of ['72 UP, 80 DOWN, 75 LEFT, 77 RIGHT', 'COUNTERCLOCKWISE with 0 degrees at 3 o\u2019clock',
    '14 YELLOW, 15 WHITE', 'EMPTY_FILL, SOLID_FILL', 'malloc(imagesize(l,t,r,b))',
    'grOk (0) means success', 'Esc returns 27']) {
    assert.ok(descs.some((d) => d.includes(want)), 'missing description text: ' + want);
  }
});
check('empty-state row + footer text intact', () => {
  const elKids = cheatBody.kids.filter((k) => k.tag !== '#text');
  const empty = elKids.find((k) => k.attrs.includes('id="cheat-empty"'));
  assert.ok(empty, 'empty-state row missing');
  assert.ok(elKids[elKids.length - 1] === empty, 'empty-state must be the last body child');
  const foot = sheet.kids.filter((k) => k.tag !== '#text')[3];
  const footText = foot.kids.filter((k) => k.tag === '#text').map((k) => k.text).join('');
  assert.ok(footText.includes('Press'), 'footer hint drifted: ' + JSON.stringify(footText));
  /* v1.5.10: the WinBGIM/SDL_bgi library note was removed with the rest of
     the non-function content */
  assert.ok(!html.includes('WinBGIM is the default on Windows'), 'library note must be gone from the footer');
});
check('escaping discipline: no raw & < > in text runs, no undefined/[object Object]', () => {
  const badAmp = P.textRuns.filter((t) => /&(?!amp;|lt;|gt;|quot;|#39;|nbsp;)/.test(t.text));
  assert.deepStrictEqual(badAmp, [], 'raw & in text: ' + (badAmp[0] && badAmp[0].text.slice(0, 60)));
  const badTag = P.textRuns.filter((t) => /[<>]/.test(t.text));
  assert.deepStrictEqual(badTag, [], 'raw < or > in text: ' + (badTag[0] && badTag[0].text.slice(0, 60)));
  for (const bad of ['undefined', '[object Object]', 'NaN']) {
    const hit = P.textRuns.find((t) => t.text.includes(bad));
    assert.ok(!hit, 'suspicious text leak: ' + bad + ' near ' + (hit && hit.text.slice(0, 50)));
  }
});

/* ---------------- 4. the ? moved to the view title ---------------- */
check('the in-panel ? button is GONE (moved to the view title bar in v1.5.9)', () => {
  assert.ok(!html.includes('help-btn'), 'in-panel ? button still rendered');
  assert.ok(!html.includes('hero-row'), 'dead hero-row wrapper still rendered');
  assert.ok(html.includes('<h1>graphics.h Runner</h1>'), 'hero title broken');
  assert.ok(html.includes("m.type === 'cheat'"), 'page must open the sheet on the host message');
  assert.ok(html.includes('if (m.open) { openCheat(); } else { closeCheat(); }'), 'host-driven toggle missing');
});
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('package.json: programs view title carries EXACTLY the ? action (3 old icons removed)', () => {
  const cmd = pkg.contributes.commands.find((c) => c.command === 'graphics-h-runner.cheatSheet');
  assert.ok(cmd, 'cheatSheet command not contributed');
  assert.strictEqual(cmd.icon, '$(question)', '? icon missing');
  const items = (pkg.contributes.menus['view/title'] || []).filter(
    (i) => typeof i.when === 'string' && i.when.includes('graphics-h-runner.programs')
  );
  assert.strictEqual(items.length, 1, 'programs view title must carry exactly one action, got: '
    + items.map((i) => i.command).join(','));
  assert.strictEqual(items[0].command, 'graphics-h-runner.cheatSheet');
  for (const gone of ['setupEverything', 'doctor', 'fireworks', 'stopFireworks']) {
    const leaked = (pkg.contributes.menus['view/title'] || []).some(
      (i) => i.command === 'graphics-h-runner.' + gone && i.when.includes('graphics-h-runner.programs')
    );
    assert.ok(!leaked, 'old view-title icon still present: ' + gone);
  }
});

/* ---------------- 5. fallback page balance too ---------------- */
check('fallback recovery page also parses balanced', () => {
  const fb = buildFallbackPanelHtml({
    version: '9.9.9', nonce: 'fbnonce', cspSource: 'https://x',
    reason: 'Test reason <script>alert(1)</script>'
  });
  const F = parse(fb);
  assert.deepStrictEqual(F.mismatches, [], 'fallback mismatches: ' + F.mismatches.join(' | '));
  assert.deepStrictEqual(F.unclosed, [], 'fallback unclosed: ' + F.unclosed.join(', '));
  assert.ok(!F.textRuns.some((t) => t.text.includes('<script>alert')), 'reason not escaped');
});

console.log('\n' + (failures ? failures + ' FAILURES' : 'CHEAT DOM TESTS ALL PASS'));
process.exit(failures ? 1 : 0);
