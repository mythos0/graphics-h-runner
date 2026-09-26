#!/usr/bin/env node
/**
 * render-panel-preview.js — renders the built panel HTML to standalone
 * HTML files (ready/not-ready states) with a vscode-api stub so the
 * panel script runs in a normal browser. Output: build/preview-*.html
 */
const fs = require('fs');
const path = require('path');
const { buildPanelHtml } = require(path.join(__dirname, '..', 'out', 'panelHtml'));
const { loadProgramCatalog, COMMAND_META } = require(path.join(__dirname, '..', 'out', 'programs'));

const ROOT = path.join(__dirname, '..');
const programs = loadProgramCatalog(ROOT).map((p) => ({
  id: p.id, title: p.title, description: p.description, emoji: p.emoji, filename: p.filename, tag: p.tag
}));

const STUB_N = `<script nonce="previewnonce">function acquireVsCodeApi(){var s={};return {postMessage:function(){},getState:function(){return s;},setState:function(v){s=v;}};}</script>`;

function make(status, name) {
  let html = buildPanelHtml({
    programs,
    commands: COMMAND_META,
    status,
    version: '1.4.0',
    nonce: 'previewnonce',
    logoUri: 'https://raw.githubusercontent.com/mythos0/graphics-h-runner/main/media/diu-logo.png',
    cspSource: 'https://file+.vscode-resource.vscode-cdn.net'
  });
  html = html.replace('<script nonce="previewnonce">', STUB_N + '<script nonce="previewnonce">');
  const out = path.join(ROOT, 'build', name);
  fs.writeFileSync(out, html);
  console.log('wrote', out, html.length, 'bytes');
}

make({ state: 'ready', library: 'SDL_bgi', compilerOk: true, platform: 'linux', busy: false, busyLabel: null }, 'preview-ready.html');
make({ state: 'not-ready', library: null, compilerOk: false, platform: 'windows', busy: false, busyLabel: null }, 'preview-notready.html');
