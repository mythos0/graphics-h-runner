/**
 * audio.js — synthesized fireworks sounds for the graphics.h Runner
 * webview build of the Fireworks Simulator (engine: media/fireworks).
 *
 * The upstream engine streams its audio (lift / burst / burstSmall /
 * crackle / crackleSmall mp3s) from CodePen's S3 bucket. The extension's
 * webview CSP blocks every remote fetch, so v1.5.15 shipped the first
 * offline synth. v1.5.22 rebuilds it around what real firework recordings
 * actually contain — the v1.5.15 buffers were mono, bone-dry and had a
 * toy-like whistle, which is exactly why they read as "video game":
 *
 *   1. OPEN-AIR REVERB — a real shell detonates hundreds of meters up and
 *      the sound returns off terrain and buildings: a clean direct crack,
 *      a short pre-delay, discrete slap-back reflections, then a diffuse
 *      tail whose highs die first (air absorption). Every burst is now
 *      dry+wet through a ConvolverNode driven by a synthetic IR built from
 *      exactly that recipe. This one change adds the huge "BOOM…oom…m"
 *      tail the old buffers lacked.
 *   2. A REAL MORTAR BURST — two-stage attack (a 5 ms ultrasharp crack on
 *      top of a 45 ms high-passed crack body), broadband body whose
 *      brightness falls and that carries a decaying tremolo "rattle", a
 *      WAVESHAPED sub sweep (80→30 Hz through a soft saturator — the
 *      harmonics are what makes a sub boom feel like displaced air
 *      instead of a test tone) and a mid-band texture sweep.
 *   3. STEREO EVERYWHERE — buffers render to TWO channels; crackle pops
 *      are panned individually across the field (a real crackle cloud is
 *      wide and spatially random, not a centered click track).
 *   4. GROUNDED LIFT — the mortar thump is now two thumps (tube + echo),
 *      softly saturated, the gas hiss flutters like pressurized gas, and
 *      the old 720→1400 Hz sine "playground" whistle is demoted to a
 *      barely-there shimmer at 1/25th of its old level.
 *   5. POSITIONAL PLAYBACK (script.js side) — playSound() pans each event
 *      by the shell's x position, low-passes by burst height (high bursts
 *      are muffled by the air between you and them) and no longer maps
 *      small shells to up to 2× playback rate, which made bursts sound
 *      chipmunk-fast instead of smaller.
 *
 * Wiring contract (pinned by test/celebrate-tests.js):
 *   - script.js loads this file BEFORE script.js, so
 *     window.__ghrFireworksSynth exists when soundManager.preload() runs;
 *   - preload() renders the buffers from here instead of fetching;
 *   - playSound() keeps the engine's volume/rate/throttle behavior.
 *
 * All rendering is procedural, mono->stereo, deterministic per variant
 * (mulberry32 seeded per type+variant). Rendering happens during the
 * engine's loading screen; a failed render leaves that slot empty and
 * playSound() skips silently, so audio can never break the show.
 */
(function () {
        'use strict';

        /* Deterministic PRNG — same seed, same buffers, every session. */
        function mulberry32(seed) {
                var a = seed >>> 0;
                return function () {
                        a |= 0;
                        a = (a + 0x6d2b79f5) | 0;
                        var t = Math.imul(a ^ (a >>> 15), 1 | a);
                        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
        }

        function hashString(s) {
                var h = 2166136261;
                for (var i = 0; i < s.length; i++) {
                        h ^= s.charCodeAt(i);
                        h = Math.imul(h, 16777619);
                }
                return h >>> 0;
        }

        function noiseBuffer(oc, seconds, rand) {
                var len = Math.max(1, Math.floor(oc.sampleRate * seconds));
                var buf = oc.createBuffer(1, len, oc.sampleRate);
                var d = buf.getChannelData(0);
                for (var i = 0; i < len; i++) {
                        d[i] = rand() * 2 - 1;
                }
                return buf;
        }

        /* Soft saturation — a pure sine sub sweep sounds like a test tone;
         * through tanh(3x) it picks up the odd harmonics that make a boom
         * feel like a pressure wave. */
        function shaperCurve(k) {
                var n = 257;
                var curve = new Float32Array(n);
                var norm = Math.tanh(k);
                for (var i = 0; i < n; i++) {
                        var x = (i / (n - 1)) * 2 - 1;
                        curve[i] = Math.tanh(k * x) / norm;
                }
                return curve;
        }

        function saturator(oc, k) {
                var ws = oc.createWaveShaper();
                ws.curve = shaperCurve(k);
                ws.oversample = '2x';
                return ws;
        }

        /**
         * Synthetic open-air impulse response, stereo.
         *  - 18 ms pre-delay (the direct sound arrives first, dry);
         *  - five discrete early reflections 28–134 ms with slightly
         *    different left/right taps (slap-back off hills/buildings);
         *  - a diffuse exponential tail whose spectrum darkens over time
         *    (one-pole lowpass with a cutoff that falls along the tail —
         *    air absorbs highs first).
         * Peak-normalized so the wet send level stays predictable.
         */
        function makeIR(oc, seconds, rand) {
                var sr = oc.sampleRate;
                var len = Math.max(1, Math.floor(sr * seconds));
                var ir = oc.createBuffer(2, len, sr);
                var preDelay = Math.floor(0.018 * sr);
                var taps = [
                        { t: 0.028, g: 0.50 },
                        { t: 0.047, g: 0.42 },
                        { t: 0.073, g: 0.33 },
                        { t: 0.102, g: 0.26 },
                        { t: 0.134, g: 0.20 }
                ];
                var tailStart = Math.floor(0.055 * sr);
                var decay = 3.1 / seconds;      /* ~e^-3 across the IR */
                for (var ch = 0; ch < 2; ch++) {
                        var d = ir.getChannelData(ch);
                        /* early reflections (per-channel taps: width) */
                        for (var i = 0; i < taps.length; i++) {
                                var tap = taps[i];
                                var j = Math.floor((tap.t + (ch ? 0.006 : 0) * rand()) * sr);
                                if (j < len) d[j] += tap.g * (ch ? 0.85 : 1.1);
                        }
                        /* diffuse tail with falling cutoff */
                        var lp = 0;
                        var a = 0.38;
                        for (var n = tailStart; n < len; n++) {
                                var t = n / sr;
                                var env = Math.exp(-decay * (t - 0.055));
                                a = 0.38 - 0.30 * (t / seconds);   /* darkens over time */
                                lp += a * ((rand() * 2 - 1) - lp);
                                d[n] = lp * env * 0.8;
                        }
                }
                /* peak-normalize both channels */
                var peak = 0;
                for (ch = 0; ch < 2; ch++) {
                        d = ir.getChannelData(ch);
                        for (i = 0; i < len; i++) {
                                var abs = Math.abs(d[i]);
                                if (abs > peak) peak = abs;
                        }
                }
                if (peak > 0) {
                        var scale = 0.55 / peak;
                        for (ch = 0; ch < 2; ch++) {
                                d = ir.getChannelData(ch);
                                for (i = 0; i < len; i++) d[i] *= scale;
                        }
                }
                return ir;
        }

        /**
         * Dry+wet bus for one render. `wetSeconds` 0 disables the convolver
         * (mono-ish sources like the lift just get a whisper of room).
         */
        function busChain(oc, wetSeconds, wetLevel, rand) {
                var comp = oc.createDynamicsCompressor();
                comp.threshold.value = -14;
                comp.knee.value = 18;
                comp.ratio.value = 8;
                comp.attack.value = 0.002;
                comp.release.value = 0.18;
                var master = oc.createGain();
                master.gain.value = 0.85;
                comp.connect(master);
                master.connect(oc.destination);

                var dry = oc.createGain();
                dry.connect(comp);

                var wet = null;
                if (wetSeconds > 0 && oc.createConvolver) {
                        var conv = oc.createConvolver();
                        conv.buffer = makeIR(oc, wetSeconds, rand);
                        var wg = oc.createGain();
                        wg.gain.value = wetLevel;
                        conv.connect(wg);
                        wg.connect(comp);
                        wet = conv;
                }
                return { dry: dry, wet: wet };
        }

        /* One small noise pop (crackle grain). Two-stage micro transient:
         * a 1.5 ms full-band click + a short bandpassed snap body, panned
         * randomly across the stereo field. */
        function popSound(oc, out, scratch, rand, t, amp, centerFreq) {
                var g = oc.createGain();
                g.gain.setValueAtTime(Math.min(amp, 1), t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.006 + rand() * 0.008);
                var bp = oc.createBiquadFilter();
                bp.type = 'bandpass';
                bp.Q.value = 1.1;
                bp.frequency.value = centerFreq;
                var src = oc.createBufferSource();
                src.buffer = scratch;
                src.connect(bp);
                bp.connect(g);
                var last = g;
                if (oc.createStereoPanner) {
                        var p = oc.createStereoPanner();
                        /* decisive left/right placement — a real crackle cloud
                         * is wide, not a phantom-centered click track */
                        var side = rand() < 0.5 ? -1 : 1;
                        p.pan.value = side * (0.35 + rand() * 0.6);
                        last.connect(p);
                        last = p;
                }
                last.connect(out);
                src.start(t, rand() * 0.04, 0.025);
        }

        function renderLift(oc, bus, rand) {
                var t0 = 0.015;
                var out = bus.dry;

                /* mortar thump — tube fundamental, saturated so it has grit */
                var thump = oc.createOscillator();
                thump.type = 'sine';
                thump.frequency.setValueAtTime(105 + rand() * 12, t0);
                thump.frequency.exponentialRampToValueAtTime(46, t0 + 0.22);
                var thumpSat = saturator(oc, 2.2);
                var tg = oc.createGain();
                tg.gain.setValueAtTime(0.95, t0);
                tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
                thump.connect(thumpSat);
                thumpSat.connect(tg);
                tg.connect(out);
                thump.start(t0);
                thump.stop(t0 + 0.34);

                /* tube echo thump — the hollow double-knock of a real tube */
                var thump2 = oc.createOscillator();
                thump2.type = 'sine';
                thump2.frequency.setValueAtTime(58, t0 + 0.055);
                thump2.frequency.exponentialRampToValueAtTime(40, t0 + 0.24);
                var tg2 = oc.createGain();
                tg2.gain.setValueAtTime(0.4, t0 + 0.055);
                tg2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
                thump2.connect(tg2);
                tg2.connect(out);
                thump2.start(t0 + 0.055);
                thump2.stop(t0 + 0.3);

                /* pressurized lift gas hiss with a fluttering envelope */
                var hiss = oc.createBufferSource();
                hiss.buffer = noiseBuffer(oc, 1.5, rand);
                var hb = oc.createBiquadFilter();
                hb.type = 'bandpass';
                hb.Q.value = 0.75;
                hb.frequency.setValueAtTime(750, t0);
                hb.frequency.exponentialRampToValueAtTime(2300, t0 + 1.15);
                var hg = oc.createGain();
                hg.gain.setValueAtTime(0.0001, t0);
                hg.gain.exponentialRampToValueAtTime(0.42, t0 + 0.06);
                hg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.42);
                /* pressure flutter */
                var flut = oc.createOscillator();
                flut.frequency.value = 17;
                var flutGain = oc.createGain();
                flutGain.gain.value = 0.09;
                flut.connect(flutGain);
                flutGain.connect(hg.gain);
                hiss.connect(hb);
                hb.connect(hg);
                hg.connect(out);
                hiss.start(t0);
                hiss.stop(t0 + 1.5);
                flut.start(t0);
                flut.stop(t0 + 1.5);

                /* faint rocket shimmer — 1/25 of the old level, real lifts
                 * are mostly thump + hiss, not a whistle solo */
                var whistle = oc.createOscillator();
                whistle.type = 'sine';
                whistle.frequency.setValueAtTime(950, t0 + 0.15);
                whistle.frequency.exponentialRampToValueAtTime(1550, t0 + 0.95);
                var vib = oc.createOscillator();
                vib.frequency.value = 6.2;
                var vibGain = oc.createGain();
                vibGain.gain.value = 22;
                vib.connect(vibGain);
                vibGain.connect(whistle.frequency);
                var wg = oc.createGain();
                wg.gain.setValueAtTime(0.0001, t0 + 0.15);
                wg.gain.exponentialRampToValueAtTime(0.02, t0 + 0.35);
                wg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
                whistle.connect(wg);
                wg.connect(out);
                whistle.start(t0 + 0.15);
                whistle.stop(t0 + 1.05);
                vib.start(t0 + 0.15);
                vib.stop(t0 + 1.05);

                /* low rumble tail */
                var rumble = oc.createBufferSource();
                rumble.buffer = noiseBuffer(oc, 0.95, rand);
                var rb = oc.createBiquadFilter();
                rb.type = 'lowpass';
                rb.frequency.value = 140;
                var rg = oc.createGain();
                rg.gain.setValueAtTime(0.2, t0);
                rg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
                rumble.connect(rb);
                rb.connect(rg);
                rg.connect(out);
                rumble.start(t0);
                rumble.stop(t0 + 0.95);

                /* a whisper of open air on the lift too */
                if (bus.wet) {
                        var lw = oc.createGain();
                        lw.gain.value = 0.35;
                        tg.connect(lw);
                        tg2.connect(lw);
                        lw.connect(bus.wet);
                }
        }

        /* decaying tremolo "rattle" curve for the burst body — fast and deep
         * at first, slowing and flattening as the cloud expands */
        function rattleCurve(seconds) {
                var n = 220;
                var curve = new Float32Array(n);
                for (var i = 0; i < n; i++) {
                        var t = (i / (n - 1)) * seconds;
                        var f = 26 - 18 * (t / seconds);
                        var depth = 0.38 * (1 - t / seconds);
                        curve[i] = 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * f * t));
                }
                return curve;
        }

        function renderBurst(oc, bus, rand, small) {
                var t0 = 0.012;
                var dur = small ? 1.15 : 2.55;
                var out = bus.dry;

                /* stage 1 — the ultrasharp crack (dry, full-band) */
                var snap = oc.createBufferSource();
                snap.buffer = noiseBuffer(oc, 0.012, rand);
                var sg = oc.createGain();
                sg.gain.setValueAtTime(1.15, t0);
                sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.006);
                snap.connect(sg);
                sg.connect(out);
                snap.start(t0);

                /* stage 1b — 45 ms high-passed crack body (the "BANG") */
                var crack = oc.createBufferSource();
                crack.buffer = noiseBuffer(oc, 0.06, rand);
                var chp = oc.createBiquadFilter();
                chp.type = 'highpass';
                chp.frequency.value = small ? 900 : 700;
                var cg = oc.createGain();
                cg.gain.setValueAtTime(0.85, t0 + 0.002);
                cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
                crack.connect(chp);
                chp.connect(cg);
                cg.connect(out);
                crack.start(t0 + 0.002);

                /* stage 2 — broadband body, brightness falls, rattling AM */
                var body = oc.createBufferSource();
                body.buffer = noiseBuffer(oc, dur, rand);
                var lp = oc.createBiquadFilter();
                lp.type = 'lowpass';
                lp.Q.value = 0.6;
                lp.frequency.setValueAtTime(small ? 7200 : 9200, t0);
                lp.frequency.exponentialRampToValueAtTime(small ? 400 : 170, t0 + dur * 0.75);
                var bg = oc.createGain();
                bg.gain.setValueAtTime(small ? 0.8 : 0.95, t0);
                bg.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.88);
                var rattle = oc.createGain();
                rattle.gain.setValueAtTime(1, t0);
                rattle.gain.setValueCurveAtTime(
                        rattleCurve(small ? 0.55 : 1.25), t0, small ? 0.55 : 1.25);
                body.connect(lp);
                lp.connect(rattle);
                rattle.connect(bg);
                bg.connect(out);
                body.start(t0);
                body.stop(t0 + dur);

                /* stage 3 — the sub boom through a soft saturator */
                var boom = oc.createOscillator();
                boom.type = 'sine';
                boom.frequency.setValueAtTime(small ? 120 : 80, t0);
                boom.frequency.exponentialRampToValueAtTime(small ? 65 : 30, t0 + (small ? 0.32 : 0.85));
                var boomSat = saturator(oc, 2.8);
                var bog = oc.createGain();
                bog.gain.setValueAtTime(small ? 0.7 : 1.0, t0);
                bog.gain.exponentialRampToValueAtTime(0.001, t0 + (small ? 0.36 : 1.05));
                boom.connect(boomSat);
                boomSat.connect(bog);
                bog.connect(out);
                boom.start(t0);
                boom.stop(t0 + (small ? 0.42 : 1.12));

                /* stage 4 — mid-band texture sweeping down */
                var tex = oc.createBufferSource();
                tex.buffer = noiseBuffer(oc, small ? 0.7 : 1.55, rand);
                var bp = oc.createBiquadFilter();
                bp.type = 'bandpass';
                bp.Q.value = 1.0;
                bp.frequency.setValueAtTime(small ? 1100 : 850, t0);
                bp.frequency.exponentialRampToValueAtTime(small ? 380 : 210, t0 + (small ? 0.6 : 1.45));
                var tg3 = oc.createGain();
                tg3.gain.setValueAtTime(0.3, t0);
                tg3.gain.exponentialRampToValueAtTime(0.001, t0 + (small ? 0.65 : 1.55));
                tex.connect(bp);
                bp.connect(tg3);
                tg3.connect(out);
                tex.start(t0);
                tex.stop(t0 + (small ? 0.7 : 1.6));

                /* faint crackle tail behind big bursts */
                if (!small) {
                        var scratch = noiseBuffer(oc, 0.06, rand);
                        var t = 1.0 + rand() * 0.15;
                        while (t < dur - 0.05) {
                                popSound(oc, out, scratch, rand, t, 0.04 + rand() * 0.05, 2400 + rand() * 2400);
                                t += 0.03 + Math.pow(rand(), 1.4) * 0.18;
                        }
                }

                /* the sky: everything but the dry crack feeds the reverb */
                if (bus.wet) {
                        var w1 = oc.createGain();
                        w1.gain.value = 0.55;
                        bg.connect(w1);
                        w1.connect(bus.wet);
                        var w2 = oc.createGain();
                        w2.gain.value = 0.6;
                        bog.connect(w2);
                        w2.connect(bus.wet);
                        var w3 = oc.createGain();
                        w3.gain.value = 0.4;
                        cg.connect(w3);
                        w3.connect(bus.wet);
                        var w4 = oc.createGain();
                        w4.gain.value = 0.45;
                        tg3.connect(w4);
                        w4.connect(bus.wet);
                }
        }

        function renderCrackle(oc, bus, rand, small) {
                var out = bus.dry;
                var dur = small ? 1.8 : 3.2;
                var scratch = noiseBuffer(oc, 0.06, rand);
                var t = 0.015;
                var count = 0;
                var maxPops = small ? 150 : 380;
                while (t < dur - 0.05 && count < maxPops) {
                        var fall = 1 - t / dur;
                        var amp = (small ? 0.5 : 0.62) *
                                (0.15 + 0.85 * Math.pow(rand(), 1.4)) *
                                (0.25 + 0.75 * Math.pow(fall, 0.6));
                        var center = 2200 + rand() * 4600 * (small ? 1.15 : 1) * (0.55 + 0.45 * fall);
                        popSound(oc, out, scratch, rand, t, amp, center);
                        count++;
                        /* very dense at first (~150/s), sparse toward the tail */
                        t += 0.003 + Math.pow(rand(), 1.5) * (small ? 0.035 : 0.055) * (0.25 + 2.6 * (t / dur));
                }
                if (bus.wet) {
                        var cw = oc.createGain();
                        cw.gain.value = 0.3;
                        out.connect(cw);
                        cw.connect(bus.wet);
                }
        }

        var PLANS = {
                lift: {
                        count: 3,
                        seconds: 1.9,
                        wet: 1.0,
                        wetLevel: 0.16,
                        render: function (oc, bus, rand) {
                                renderLift(oc, bus, rand);
                        }
                },
                burst: {
                        count: 2,
                        seconds: 2.7,
                        wet: 2.3,
                        wetLevel: 1.0,
                        render: function (oc, bus, rand) {
                                renderBurst(oc, bus, rand, false);
                        }
                },
                burstSmall: {
                        count: 2,
                        seconds: 1.25,
                        wet: 1.1,
                        wetLevel: 0.8,
                        render: function (oc, bus, rand) {
                                renderBurst(oc, bus, rand, true);
                        }
                },
                crackle: {
                        count: 1,
                        seconds: 3.2,
                        wet: 1.6,
                        wetLevel: 0.5,
                        render: function (oc, bus, rand) {
                                renderCrackle(oc, bus, rand, false);
                        }
                },
                crackleSmall: {
                        count: 1,
                        seconds: 1.8,
                        wet: 1.0,
                        wetLevel: 0.4,
                        render: function (oc, bus, rand) {
                                renderCrackle(oc, bus, rand, true);
                        }
                }
        };

        function renderOne(type, spec, variantIndex, sampleRate) {
                var rand = mulberry32((hashString(type) ^ (0x9e3779b9 + variantIndex * 0x85ebca6b)) >>> 0);
                var oc = new OfflineAudioContext(2, Math.ceil(spec.seconds * sampleRate), sampleRate);
                var bus = busChain(oc, spec.wet, spec.wetLevel, rand);
                spec.render(oc, bus, rand);
                return oc.startRendering();
        }

        /**
         * Render every sound slot into `sources` (the soundManager.sources
         * object from script.js) using its live AudioContext's sample rate.
         * Resolves once every buffer is rendered; rejects only if rendering
         * itself fails (the engine's existing failure path keeps the show
         * running — playSound() skips slots without buffers).
         */
        window.__ghrFireworksSynth = function (sources, ctx) {
                var sampleRate = Math.min(Math.max((ctx && ctx.sampleRate) || 44100, 22050), 96000);
                var jobs = [];
                Object.keys(PLANS).forEach(function (type) {
                        var spec = PLANS[type];
                        var target = sources && sources[type];
                        if (!target) {
                                return;
                        }
                        target.buffers = [];
                        var assign = function (buf) {
                                target.buffers.push(buf);
                        };
                        for (var i = 0; i < spec.count; i++) {
                                jobs.push(renderOne(type, spec, i, sampleRate).then(assign));
                        }
                });
                return Promise.all(jobs).then(function () {
                        return undefined;
                });
        };
})();
