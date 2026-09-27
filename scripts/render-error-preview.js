#!/usr/bin/env node
/**
 * render-error-preview.js — build the v1.5.6 error overlay page exactly as
 * the extension ships it and screenshot it in a real Chromium via the
 * agent-browser CLI, so the design is verified before release.
 *
 * Usage: node scripts/render-error-preview.js <outPng> [width] [height]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const outPng = process.argv[2] || '/home/z/my-project/download/error-overlay-preview.png';
const W = process.argv[3] || '900';
const H = process.argv[4] || '640';

const {
  buildCelebrationHtml,
  CELEBRATION_DURATIONS_MS
} = require(path.join(ROOT, 'out', 'celebrate'));

/* realistic compiler output — the actual shapes from the user's log */
const errorLines = [
  'main.cpp:12:5: error: \u2018foo\u2019 was not declared in this scope',
  '24_coordinate_viewer.cpp:(.text+0xc): undefined reference to `getmaxx\u2019',
  'collect2.exe: error: ld returned 1 exit status'
];

const CSP = 'https://*.vscode-cdn.net';
const mediaRoot = path.join(ROOT, 'media');
const html = buildCelebrationHtml({
  kind: 'error',
  nonce: 'previewnonce',
  cspSource: CSP,
  confettiJsUri: 'file://' + path.join(mediaRoot, 'confetti.browser.js'),
  celebrateJsUri: 'file://' + path.join(mediaRoot, 'celebrate.js'),
  durationMs: CELEBRATION_DURATIONS_MS.error,
  errorLines
});

/* the page references the cspSource URLs for scripts; rewrite them to
 * file:// so a plain browser can load the same document */
const localHtml = html.split(CSP).join('file://' + mediaRoot);
const tmpHtml = '/tmp/ghr-error-preview.html';
fs.writeFileSync(tmpHtml, localHtml);
fs.writeFileSync('/tmp/ghr-error-preview-raw.html', html); /* for diff/debug */

console.log('html written:', tmpHtml);
console.log('screenshot ->', outPng);
execSync(
  `agent-browser navigate "file://${tmpHtml}" --viewport ${W}x${H} && ` +
    'agent-browser sleep 1200 && ' +
    `agent-browser screenshot "${outPng}" --viewport ${W}x${H} --full-page`,
  { stdio: 'inherit' }
);
console.log('done');
