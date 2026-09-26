#!/usr/bin/env node
/**
 * robust-tests.js — deep robustness battery for the graphics.h Runner
 * pipeline (goes far beyond run-tests.js):
 *
 *   [A] 10 complex fixtures compile + run + render (animation, math,
 *       image ops, viewports, text metrics, fill/stress, conio-poll)
 *   [B] terminal I/O correctness: piped stdin drives a chart program,
 *       stdout is verified; EOF fallback verified (demo mode)
 *   [C] crash surfacing: a SIGSEGV fixture must exit non-zero (never
 *       hang), and the display must stay healthy afterwards
 *   [D] stop/replace: kill a running program mid-flight (extension Stop
 *       semantics), immediately start another — no zombie windows
 *   [E] production diagnostics parser fed with REAL g++ error output
 *   [F] rapid re-run: 3 back-to-back replace cycles, X server health
 *
 * Exit code 0 only if every check passes. Results JSON: test/robust-results.json
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FX_DIR = path.join(ROOT, 'build', 'robust');
const BUILD_DIR = FX_DIR;
const SHOTS_DIR = path.join(ROOT, 'build', 'robust-shots');
const RESULTS_PATH = path.join(__dirname, 'robust-results.json');
const { FIXTURES } = require(path.join(__dirname, 'robust-fixtures'));

const { buildCompilePlan } = require(path.join(ROOT, 'out', 'buildArgs'));
const { detectGraphicsInclude } = require(path.join(ROOT, 'out', 'detect'));
const { parseCompilerOutput, capCompilerDiagnostics } = require(path.join(ROOT, 'out', 'diagnostics'));

const BGI = '/home/z/my-project/bgi-env';
const EXTRA_INCLUDES = [
  path.join(BGI, 'usr/include'),
  path.join(BGI, 'sysroot/usr/include'),
  path.join(BGI, 'sysroot/usr/include/x86_64-linux-gnu')
];
const EXTRA_LIBS = [
  path.join(BGI, 'usr/lib'),
  path.join(BGI, 'sysroot/usr/lib/x86_64-linux-gnu')
];

const DISPLAY = ':113';
const DISPLAY_NUM = '113';
const GRAB_SIZE = '800x600';

function cleanStaleSockets() {
  try {
    for (const f of fs.readdirSync('/tmp/.X11-unix')) {
      if (f === 'X' + DISPLAY_NUM) fs.unlinkSync(path.join('/tmp/.X11-unix', f));
    }
  } catch { /* fine */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ✅ ' + name);
  else { failures++; console.log('  ❌ ' + name + (detail ? ' -> ' + detail : '')); }
}

function analyzeShot(pngPath) {
  const py = `
from PIL import Image
import sys, json
im = Image.open(sys.argv[1]).convert('RGB')
w,h = im.size; px = im.load()
tot=0; nb=0; colors=set()
for x in range(0,w,3):
    for y in range(0,h,3):
        c = px[x,y]; tot+=1
        if sum(c) > 40: nb+=1
        colors.add(c)
print(json.dumps({"nonblack": round(nb/tot,4), "unique_colors": len(colors)}))
`;
  try {
    return JSON.parse(execFileSync('python3', ['-c', py, pngPath], { encoding: 'utf8' }).trim().split('\n').pop());
  } catch (e) {
    return { nonblack: -1, unique_colors: -1, error: String(e) };
  }
}

function grab(pngPath) {
  return new Promise((resolve) => {
    const p = sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab',
      '-video_size', GRAB_SIZE, '-i', DISPLAY, '-frames:v', '1', pngPath]);
    p.on('close', (c) => resolve(c === 0 && fs.existsSync(pngPath)));
    p.on('error', () => resolve(false));
  });
}

/** Grab at two moments and keep the richer frame — SDL window init under
 *  Xvfb can take >1s, so a single fixed-moment grab can miss the render. */
async function grabBest(tag) {
  const a = path.join(SHOTS_DIR, tag + '-a.png');
  const b = path.join(SHOTS_DIR, tag + '-b.png');
  await sleep(2200);
  await grab(a);
  await sleep(1800);
  await grab(b);
  const aa = fs.existsSync(a) ? analyzeShot(a) : null;
  const bb = fs.existsSync(b) ? analyzeShot(b) : null;
  const score = (x) => (x ? x.nonblack : -1);
  const best = score(bb) > score(aa) ? { png: b, analysis: bb } : { png: a, analysis: aa };
  return best.analysis && best.analysis.nonblack >= 0 ? best : { png: a, analysis: null };
}

function compile(fixtureName) {
  const srcPath = path.join(FX_DIR, fixtureName);
  const outFile = path.join(BUILD_DIR, fixtureName.replace(/\.cpp$/i, ''));
  const plan = buildCompilePlan(
    {
      platform: 'linux', linuxLibrary: 'auto', compilerPath: 'g++',
      sourceFile: srcPath, outFile,
      extraIncludePaths: EXTRA_INCLUDES, extraLibPaths: EXTRA_LIBS
    },
    true, { sdlBgiAvailable: true, libgraphAvailable: false }
  );
  return new Promise((resolve) => {
    const p = sh(plan.compiler, plan.args, { cwd: FX_DIR });
    let stderr = '', stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => resolve({ ok: false, stderr: String(e), plan, outFile }));
    p.on('close', (code) => resolve({ ok: code === 0, stderr, stdout, plan, outFile }));
  });
}

/** Run a built binary. stdin: null (inherit devnull) | string (piped then closed). */
function runBin(outFile, stdinText) {
  const env = {
    ...process.env, DISPLAY,
    SDL_VIDEODRIVER: 'x11', SDL_AUDIODRIVER: 'dummy',
    LD_LIBRARY_PATH: EXTRA_LIBS.join(':') + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '')
  };
  const p = spawn(outFile, [], { env, stdio: [stdinText != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d));
  p.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => {
    p.on('error', (e) => resolve({ code: -1, signal: null, err: String(e) }));
    p.on('close', (code, signal) => resolve({ code, signal }));
  });
  if (stdinText != null) {
    /* feed after a beat so the program's cin is already waiting, then EOF */
    setTimeout(() => { try { p.stdin.write(stdinText); p.stdin.end(); } catch { /* exited */ } }, 400);
  }
  return { proc: p, exited, getStdout: () => stdout, getStderr: () => stderr };
}

async function waitExit(exited, timeoutMs) {
  return Promise.race([
    exited,
    sleep(timeoutMs).then(() => ({ code: 'TIMEOUT', signal: null }))
  ]);
}

async function main() {
  fs.mkdirSync(FX_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const [name, src] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(FX_DIR, name), src);

  cleanStaleSockets();
  const xvfb = sh('Xvfb', [DISPLAY, '-screen', '0', '800x600x24', '-nolisten', 'tcp']);
  let xvfbReady = false;
  for (let i = 0; i < 25 && !xvfbReady; i++) {
    await sleep(200);
    xvfbReady = xvfb.exitCode === null && fs.existsSync('/tmp/.X11-unix/X' + DISPLAY_NUM);
  }
  if (!xvfbReady || !(await grab(path.join(SHOTS_DIR, 'health.png')))) {
    console.error('Xvfb failed to start — aborting robust battery.');
    process.exit(1);
  }
  console.log('Xvfb ' + DISPLAY + ' ready\n');

  const results = { A: {}, B: {}, C: {}, D: {}, E: {}, F: {} };
  const ORDER = ['rfx01_io_chart.cpp', 'rfx02_gravity_bounce.cpp', 'rfx03_conio_menu.cpp',
    'rfx04_julia_morph.cpp', 'rfx05_image_ops.cpp', 'rfx06_viewport_clip.cpp',
    'rfx07_text_matrix.cpp', 'rfx08_fill_stress.cpp', 'rfx09_stress_prims.cpp',
    'rfx10_key_echo.cpp'];

  /* ---------- [A] compile + run + render battery ---------- */
  console.log('── [A] complex fixture battery (compile + run + render) ──');
  for (const fx of ORDER) {
    const t0 = Date.now();
    const det = detectGraphicsInclude(FIXTURES[fx]);
    const c = await compile(fx);
    if (!det || !c.ok) {
      check(`${fx}: detect+compile`, false, `detect=${det} compileErr=${c.stderr.split('\n').slice(-4).join(' | ').slice(0, 300)}`);
      results.A[fx] = { ok: false }; continue;
    }
    const run = runBin(c.outFile, null);
    const shotInfo = await grabBest(fx.replace(/\.cpp$/i, ''));
    const analysis = shotInfo.analysis;
    const exit = await waitExit(run.exited, 60000);
    const rendered = analysis && (analysis.nonblack > 0.002 || analysis.unique_colors > 3);
    const ok = exit.code === 0 && rendered;
    check(`${fx}: exit=${exit.code} content=${analysis ? (analysis.nonblack * 100).toFixed(1) + '%' : 'n/a'}`,
      ok, `signal=${exit.signal} stderr=${run.getStderr().split('\n').slice(-2).join(' ').slice(0, 160)}`);
    results.A[fx] = { ok, exit: exit.code, analysis, secs: ((Date.now() - t0) / 1000).toFixed(1) };
  }

  /* ---------- [B] terminal I/O correctness ---------- */
  console.log('\n── [B] terminal I/O (piped stdin = what the pty delivers) ──');
  {
    const c = await compile('rfx01_io_chart.cpp');
    // B1: real input drives the chart
    let run = runBin(c.outFile, '3\n40 70 25\n');
    let exit = await waitExit(run.exited, 60000);
    const out1 = run.getStdout();
    check('rfx01 + input "3 / 40 70 25": consumed, chart drawn, clean exit',
      exit.code === 0 && out1.includes('BARS: 40 70 25') && out1.includes('chart window closed cleanly'),
      `exit=${exit.code} stdout=${JSON.stringify(out1.slice(-120))}`);
    results.B.interactive = { exit: exit.code, out: out1.slice(-200) };
    // B2: EOF-only stdin -> demo fallback, still clean
    run = runBin(c.outFile, null);
    exit = await waitExit(run.exited, 60000);
    const out2 = run.getStdout();
    check('rfx01 + EOF stdin: demo fallback, clean exit',
      exit.code === 0 && out2.includes('demo mode') && out2.includes('BARS: 20 35 50 65 80'),
      `exit=${exit.code} stdout=${JSON.stringify(out2.slice(-120))}`);
    results.B.eof = { exit: exit.code, out: out2.slice(-200) };
  }

  /* ---------- [C] crash surfacing ---------- */
  console.log('\n── [C] crash probe (SIGSEGV must surface, display must survive) ──');
  {
    const c = await compile('rfx11_crash.cpp');
    const run = runBin(c.outFile, null);
    const exit = await waitExit(run.exited, 20000);
    const crashed = exit.code === 'TIMEOUT' ? false : (exit.code !== 0 || exit.signal !== null);
    check('rfx11 SIGSEGV: non-zero exit / death signal (no hang)', crashed, `exit=${exit.code} signal=${exit.signal}`);
    results.C = { exit: exit.code, signal: exit.signal };
    // display still healthy afterwards
    const healthy = await grab(path.join(SHOTS_DIR, 'after-crash.png'));
    check('display healthy after a crashed program', healthy);
  }

  /* ---------- [D] stop/replace semantics ---------- */
  console.log('\n── [D] stop mid-flight + immediate replace (extension Stop flow) ──');
  {
    const c1 = await compile('rfx02_gravity_bounce.cpp');
    const c2 = await compile('rfx05_image_ops.cpp');
    const first = runBin(c1.outFile, null);
    await sleep(800);
    first.proc.kill('SIGKILL'); /* what a Stop does to the pty's root process */
    const firstExit = await waitExit(first.exited, 5000);
    check('first run killed mid-flight (signal delivered)', firstExit.signal === 'SIGKILL' || firstExit.code === -9 || firstExit.code !== 0,
      `exit=${firstExit.code} signal=${firstExit.signal}`);
    await sleep(150);
    const second = runBin(c2.outFile, null);
    await sleep(2000);
    const shot = path.join(SHOTS_DIR, 'replace-second.png');
    const gotShot = await grab(shot);
    const exit = await waitExit(second.exited, 60000);
    const analysis = gotShot ? analyzeShot(shot) : null;
    check('replacement run starts, renders and exits cleanly',
      exit.code === 0 && analysis && analysis.nonblack > 0.002,
      `exit=${exit.code} content=${analysis ? analysis.nonblack : 'n/a'}`);
    results.D = { first: firstExit.code ?? firstExit.signal, second: exit.code };
  }

  /* ---------- [E] production diagnostics parser on real g++ output ---------- */
  console.log('\n── [E] diagnostics: real g++ stderr -> Problems panel items ──');
  {
    const c = await compile('rfx12_broken.cpp');
    check('rfx12 broken fixture refuses to compile', !c.ok);
    const diags = capCompilerDiagnostics(parseCompilerOutput(c.stderr));
    check('parser produced actionable diagnostics (2 independent errors)', diags.length >= 2, 'count=' + diags.length);
    const onOurFile = diags.filter((d) => d.file && d.file.includes('rfx12_broken.cpp'));
    check('diagnostics point at the broken file with line numbers',
      onOurFile.length >= 2 && onOurFile.every((d) => typeof d.line === 'number' && d.line >= 5),
      JSON.stringify(diags.slice(0, 2)).slice(0, 200));
    const noise = diags.filter((d) => /collect2|ld returned|undefined reference to `main'/.test(d.message || ''));
    check('no linker/collect2 noise entries', noise.length === 0, JSON.stringify(noise.slice(0, 1)));
    results.E = { count: diags.length, first: diags[0] };
  }

  /* ---------- [F] rapid re-run (3 replace cycles) ---------- */
  console.log('\n── [F] rapid re-run: 3 back-to-back replace cycles ──');
  {
    const c = await compile('rfx02_gravity_bounce.cpp');
    let allKilled = true, lastExit = null;
    for (let i = 0; i < 3; i++) {
      const r = runBin(c.outFile, null);
      await sleep(600);
      r.proc.kill('SIGKILL');
      const e = await waitExit(r.exited, 5000);
      if (e.signal !== 'SIGKILL' && e.code === 'TIMEOUT') allKilled = false;
      lastExit = e.signal || e.code;
      await sleep(120);
    }
    check('3 cycles each died on kill (no stragglers)', allKilled, 'last=' + lastExit);
    const healthy = await grab(path.join(SHOTS_DIR, 'after-rapid.png'));
    check('display healthy after rapid cycling', healthy);
    results.F = { allKilled, last: lastExit };
  }

  xvfb.kill();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\n════════ ROBUST BATTERY: ${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURES ❌'} ════════`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ROBUST HARNESS CRASH:', e); process.exit(1); });
