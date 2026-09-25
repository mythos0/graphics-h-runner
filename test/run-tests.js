#!/usr/bin/env node
/**
 * run-tests.js — full integration test for the graphics.h Runner extension.
 *
 * For every samples/*.cpp it reproduces the extension's exact pipeline:
 *   1. detect #include <graphics.h>        (out/detect.js)
 *   2. build the compile plan              (out/buildArgs.js — same code paths)
 *   3. compile with spawn (no shell)       (same as extension.ts)
 *   4. run the binary on a virtual display (Xvfb)
 *   5. screenshot at a per-sample moment   (ffmpeg x11grab)
 *   6. wait for clean self-exit, record exit code
 *   7. measure rendered content (PIL non-black fraction)
 *   8. also exercise the Setup Doctor probe (out/doctor.js)
 *
 * Results: console table + test/test-results.json + docs/screenshots/*.png
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const BUILD_DIR = path.join(ROOT, 'build');
const SHOTS_DIR = path.join(ROOT, 'docs', 'screenshots');
const RESULTS_PATH = path.join(__dirname, 'test-results.json');

const { buildCompilePlan, resolveLinuxLibrary } = require(path.join(ROOT, 'out', 'buildArgs'));
const { detectGraphicsInclude } = require(path.join(ROOT, 'out', 'detect'));
const { probeEnvironment } = require(path.join(ROOT, 'out', 'doctor'));

/* ---- sandbox toolchain (non-standard install -> extra paths, as a real
 * user with a custom prefix would configure through extension settings) ---- */
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

const DISPLAY = ':112';
const DISPLAY_NUM = '112';

/** Remove stale X11 socket files left behind by killed Xvfb instances.
 *  Without this, a fresh Xvfb may bind next to a dead socket file and
 *  clients can hang forever in the connection handshake. */
function cleanStaleSockets() {
  try {
    for (const f of fs.readdirSync('/tmp/.X11-unix')) {
      if (f === 'X' + DISPLAY_NUM) {
        fs.unlinkSync(path.join('/tmp/.X11-unix', f));
        console.log(`  removed stale socket /tmp/.X11-unix/${f}`);
      }
    }
  } catch {
    /* dir may not exist yet — fine */
  }
}
const SHOT_AT = {
  '01_hello_graphics.cpp': 1.4,
  '02_shapes_showcase.cpp': 1.6,
  '03_bouncing_ball.cpp': 1.2,
  '04_moving_car.cpp': 1.4,
  '05_tricolor_flag.cpp': 1.6,
  '06_fractal_tree.cpp': 8.0,
  '07_mandelbrot.cpp': 7.5,
  '08_mouse_paint.cpp': 2.0,
  '09_keyboard_paddle.cpp': 2.0
};
const TIMEOUT_MS = {
  '07_mandelbrot.cpp': 90000
};
const GRAB_SIZE = '800x600';

function sh(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = sh(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e) }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function analyzeShot(pngPath) {
  // PIL: fraction of sampled pixels that are not near-black + unique colors
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
    const out = execFileSync('python3', ['-c', py, pngPath], { encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    return { nonblack: -1, unique_colors: -1, error: String(e) };
  }
}

async function testDoctor() {
  const res = await probeEnvironment({
    platform: 'linux',
    compilerPath: 'g++',
    linuxLibrary: 'auto',
    extraIncludePaths: EXTRA_INCLUDES,
    extraLibPaths: EXTRA_LIBS
  });
  return res;
}

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const samples = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.cpp')).sort();
  console.log(`Found ${samples.length} sample programs\n`);

  /* ---- 0. Setup Doctor probe ---- */
  console.log('── Setup Doctor probe (out/doctor.js) ──');
  const doctor = await testDoctor();
  console.log(`  compiler : ${doctor.compilerCheck.ok ? 'OK' : 'FAIL'} (${doctor.compilerCheck.detail})`);
  for (const c of doctor.libraryChecks) {
    console.log(`  lib ${c.name.padEnd(9)}: ${c.ok ? 'OK' : 'as expected, missing'} `);
  }
  console.log(`  graphicsReady: ${doctor.graphicsReady}, best: ${doctor.bestLibrary}\n`);
  if (!doctor.graphicsReady) {
    console.error('Doctor reports environment not ready — aborting.');
    process.exit(1);
  }

  /* ---- 1. Start Xvfb (with retries — a previous Xvfb may still be
           shutting down and hold the display lock briefly) ---- */
  console.log('── Starting Xvfb on ' + DISPLAY + ' ──');
  let xvfb = null;
  let lastErr = '';
  let started = false;
  for (let attempt = 1; attempt <= 4 && !started; attempt++) {
    cleanStaleSockets();
    if (xvfb) {
      try { xvfb.kill('SIGKILL'); } catch { /* ignore */ }
      await sleep(1200);
      cleanStaleSockets();
    }
    xvfb = sh('Xvfb', [DISPLAY, '-screen', '0', '800x600x24', '-nolisten', 'tcp']);
    xvfb.stderr.on('data', (d) => { lastErr += d.toString(); });

    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      await sleep(200);
      if (xvfb.exitCode !== null) {
        break; // died
      }
      try {
        ready = fs.existsSync('/tmp/.X11-unix/X' + DISPLAY_NUM);
      } catch {
        ready = false;
      }
    }
    started = ready && xvfb.exitCode === null;
    if (!started) {
      console.log(`  attempt ${attempt}: Xvfb not ready (${lastErr.trim().split('\n').slice(-2).join(' | ') || 'no output'})`);
    }
  }
  if (!started) {
    console.error('Xvfb could not be started — aborting.');
    process.exit(1);
  }

  const health = await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab',
    '-video_size', GRAB_SIZE, '-i', DISPLAY, '-frames:v', '1', path.join(BUILD_DIR, 'health.png')]);
  if (health.code !== 0) {
    console.error('Xvfb health check failed — aborting.');
    xvfb.kill();
    process.exit(1);
  }
  console.log('  Xvfb ready (socket + grab health check passed)');

  const runEnv = {
    ...process.env,
    DISPLAY,
    SDL_VIDEODRIVER: 'x11',
    SDL_AUDIODRIVER: 'dummy',
    LD_LIBRARY_PATH:
      EXTRA_LIBS.join(':') + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '')
  };

  const results = [];
  let failures = 0;

  for (const sample of samples) {
    const srcPath = path.join(SAMPLES_DIR, sample);
    const rec = { sample, detected: false, library: null, compileOk: false, runOk: false, exitCode: null, shot: null, analysis: null, cmd: '' };
    const t0 = Date.now();
    console.log(`\n══ ${sample} ══`);

    /* 1. detection — exact extension logic */
    const source = fs.readFileSync(srcPath, 'utf8');
    rec.detected = detectGraphicsInclude(source);
    console.log(`  detect graphics.h : ${rec.detected}`);
    if (!rec.detected) {
      results.push(rec); failures++;
      continue;
    }

    /* 2. compile plan — exact extension logic */
    const outFile = path.join(BUILD_DIR, sample.replace(/\.cpp$/i, ''));
    const plan = buildCompilePlan(
      {
        platform: 'linux',
        linuxLibrary: 'auto',
        compilerPath: 'g++',
        sourceFile: srcPath,
        outFile,
        extraIncludePaths: EXTRA_INCLUDES,
        extraLibPaths: EXTRA_LIBS
      },
      true,
      { sdlBgiAvailable: true, libgraphAvailable: false }
    );
    rec.library = plan.library;
    rec.cmd = plan.commandLine;
    console.log(`  plan library      : ${plan.library}`);
    console.log(`  cmd               : ${plan.commandLine.replace(/\s+/g, ' ').slice(0, 150)}…`);

    /* 3. compile — spawn without shell, like the extension */
    const comp = await run(plan.compiler, plan.args);
    rec.compileOk = comp.code === 0;
    if (!rec.compileOk) {
      rec.error = comp.stderr.slice(-500);
      console.log(`  COMPILE FAILED (exit ${comp.code})`);
      console.log(comp.stderr.split('\n').slice(-6).join('\n'));
      results.push(rec); failures++;
      continue;
    }
    console.log(`  compile           : OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    /* 4-6. run + screenshot + wait for self-exit
     * NOTE: exit/error listeners MUST be attached immediately at spawn —
     * attaching them after the screenshot delay misses early exits
     * (the child becomes a reaped zombie and 'close' never fires). */
    const runP = sh(outFile, [], { env: runEnv });
    let runErr = '';
    runP.stderr.on('data', (d) => (runErr += d));
    const exited = new Promise((resolve) => {
      runP.on('error', () => resolve(-1));
      runP.on('close', (code) => resolve(code));
    });

    await sleep((SHOT_AT[sample] || 2.0) * 1000);
    const shotPath = path.join(SHOTS_DIR, sample.replace(/\.cpp$/i, '.png'));
    const grab = await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'x11grab', '-video_size', GRAB_SIZE, '-i', DISPLAY,
      '-frames:v', '1', shotPath
    ]);
    rec.shot = grab.code === 0 && fs.existsSync(shotPath) ? shotPath : null;
    console.log(`  screenshot        : ${rec.shot ? 'captured' : 'MISSING (grab exit ' + grab.code + ')'}`);

    const timeout = TIMEOUT_MS[sample] || 45000;
    const exitCode = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), timeout))
    ]);
    rec.exitCode = exitCode;
    rec.runOk = exitCode === 0;
    rec.stderrTail = runErr.split('\n').slice(-3).join(' ').slice(0, 200);
    console.log(`  exit code         : ${exitCode} ${rec.runOk ? '(clean self-exit)' : '(UNEXPECTED)'}`);

    /* 7. content analysis */
    if (rec.shot) {
      rec.analysis = analyzeShot(rec.shot);
      console.log(`  content           : non-black ${(rec.analysis.nonblack * 100).toFixed(1)}%, ${rec.analysis.unique_colors} colors`);
    }

    const ok = rec.detected && rec.compileOk && rec.runOk && rec.shot && rec.analysis &&
      (rec.analysis.nonblack > 0.002 || rec.analysis.unique_colors > 3);
    if (!ok) failures++;
    console.log(`  RESULT            : ${ok ? '✅ PASS' : '❌ FAIL'} (total ${(Date.now() - t0) / 1000 | 0}s)`);
    results.push(rec);
  }

  /* ---- 8. cleanup + summary ---- */
  xvfb.kill();

  fs.writeFileSync(RESULTS_PATH, JSON.stringify({ doctor: { graphicsReady: doctor.graphicsReady, bestLibrary: doctor.bestLibrary }, results }, null, 2));

  console.log('\n════════ SUMMARY ════════');
  for (const r of results) {
    const ok = r.detected && r.compileOk && r.runOk && r.shot && r.analysis &&
      (r.analysis.nonblack > 0.002 || r.analysis.unique_colors > 3);
    console.log(`  ${ok ? '✅' : '❌'} ${r.sample.padEnd(28)} lib=${String(r.library).padEnd(8)} compile=${r.compileOk ? 'ok' : 'FAIL'} exit=${r.exitCode} shot=${r.shot ? 'ok' : 'none'} content=${r.analysis ? (r.analysis.nonblack * 100).toFixed(1) + '%' : 'n/a'}`);
  }
  console.log(`\n${results.length - failures}/${results.length} passed. Results JSON: ${RESULTS_PATH}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS CRASH:', e);
  process.exit(1);
});
