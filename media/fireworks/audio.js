/**
 * audio.js — synthesized fireworks sounds for the graphics.h Runner
 * webview build of the Fireworks Simulator (engine: media/fireworks).
 *
 * The upstream engine streams its audio (lift / burst / burstSmall /
 * crackle / crackleSmall mp3s) from CodePen's S3 bucket. The extension's
 * webview CSP blocks every remote fetch, so the sound toggle used to stay
 * silent (v1.5.5 note: "runs silent-by-default exactly like
 * upstream-without-network").
 *
 * This file renders the SAME five sound slots entirely offline with the
 * WebAudio API and hands the engine real AudioBuffers:
 *
 *   - script.js loads this file BEFORE script.js, so
 *     window.__ghrFireworksSynth exists when soundManager.preload() runs;
 *   - preload() renders the buffers from here instead of fetching
 *     (documented branch at the top of preload);
 *   - playSound() then behaves exactly as upstream — volume scaling,
 *     playback-rate variance, per-type throttling, random variant choice.
 *
 * Sound design (procedural, mono, deterministic per variant — mulberry32
 * seeded per type+variant, so the buffers are reproducible):
 *
 *   lift         1.7 s — mortar launch: 95→42 Hz sub thump, pressurized
 *                        hiss through a 650→2600 Hz band-pass sweep, faint
 *                        vibrato rocket whistle, low rumble tail.
 *   burst        2.4 s — full explosion: 22 ms full-band attack transient,
 *                        broadband body through a lowpass falling 9.5 kHz→
 *                        160 Hz, 72→36 Hz sub boom, mid-band texture sweep
 *                        and a faint crackle tail.
 *   burstSmall   1.1 s — the same explosion, shorter and brighter.
 *   crackle      3.0 s — dense cluster of high-passed noise pops; density
 *                        and brightness decay over the tail.
 *   crackleSmall 1.6 s — a shorter, lighter crackle cluster.
 *
 * Every render sums into a gentle compressor + 0.9 master gain so layered
 * voices never clip. Rendering happens during the engine's loading screen;
 * a failed render leaves that slot empty and playSound() skips silently
 * (the v1.5.5 guard), so audio can never break the show.
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

	/* Shared output chain: glue compressor + headroom so stacked voices
	 * (sub boom + body + tail) sum without clipping. */
	function busChain(oc) {
		var comp = oc.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.knee.value = 18;
		comp.ratio.value = 8;
		comp.attack.value = 0.002;
		comp.release.value = 0.18;
		var master = oc.createGain();
		master.gain.value = 0.9;
		comp.connect(master);
		master.connect(oc.destination);
		return comp;
	}

	/* One small noise pop (crackle grain / burst tail). */
	function popSound(oc, out, scratch, rand, t, amp, hpFreq) {
		var src = oc.createBufferSource();
		src.buffer = scratch;
		var hp = oc.createBiquadFilter();
		hp.type = 'highpass';
		hp.frequency.value = hpFreq;
		var g = oc.createGain();
		g.gain.setValueAtTime(Math.min(amp, 1), t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 0.004 + rand() * 0.005);
		src.connect(hp);
		hp.connect(g);
		g.connect(out);
		src.start(t, rand() * 0.05, 0.03);
	}

	function renderLift(oc, out, rand) {
		var t0 = 0.015;

		/* deep mortar thump */
		var thump = oc.createOscillator();
		thump.type = 'sine';
		thump.frequency.setValueAtTime(95 + rand() * 14, t0);
		thump.frequency.exponentialRampToValueAtTime(42, t0 + 0.3);
		var tg = oc.createGain();
		tg.gain.setValueAtTime(0.95, t0);
		tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
		thump.connect(tg);
		tg.connect(out);
		thump.start(t0);
		thump.stop(t0 + 0.42);

		/* pressurized lift gas hiss, brightening as the shell climbs */
		var hiss = oc.createBufferSource();
		hiss.buffer = noiseBuffer(oc, 1.55, rand);
		var hb = oc.createBiquadFilter();
		hb.type = 'bandpass';
		hb.Q.value = 0.85;
		hb.frequency.setValueAtTime(650, t0);
		hb.frequency.exponentialRampToValueAtTime(2600, t0 + 1.15);
		var hg = oc.createGain();
		hg.gain.setValueAtTime(0.0001, t0);
		hg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.07);
		hg.gain.exponentialRampToValueAtTime(0.28, t0 + 0.6);
		hg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.5);
		hiss.connect(hb);
		hb.connect(hg);
		hg.connect(out);
		hiss.start(t0);
		hiss.stop(t0 + 1.55);

		/* faint whistling rocket tone with slow vibrato */
		var whistle = oc.createOscillator();
		whistle.type = 'sine';
		whistle.frequency.setValueAtTime(720, t0 + 0.18);
		whistle.frequency.exponentialRampToValueAtTime(1400, t0 + 1.25);
		var vib = oc.createOscillator();
		vib.frequency.value = 5.5 + rand() * 2;
		var vibGain = oc.createGain();
		vibGain.gain.value = 30;
		vib.connect(vibGain);
		vibGain.connect(whistle.frequency);
		var wg = oc.createGain();
		wg.gain.setValueAtTime(0.0001, t0 + 0.18);
		wg.gain.exponentialRampToValueAtTime(0.05, t0 + 0.4);
		wg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.35);
		whistle.connect(wg);
		wg.connect(out);
		whistle.start(t0 + 0.18);
		whistle.stop(t0 + 1.4);
		vib.start(t0 + 0.18);
		vib.stop(t0 + 1.4);

		/* low rumble tail */
		var rumble = oc.createBufferSource();
		rumble.buffer = noiseBuffer(oc, 1.0, rand);
		var rb = oc.createBiquadFilter();
		rb.type = 'lowpass';
		rb.frequency.value = 150;
		var rg = oc.createGain();
		rg.gain.setValueAtTime(0.22, t0);
		rg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.95);
		rumble.connect(rb);
		rb.connect(rg);
		rg.connect(out);
		rumble.start(t0);
		rumble.stop(t0 + 1.0);
	}

	function renderBurst(oc, out, rand, small) {
		var t0 = 0.012;
		var dur = small ? 1.05 : 2.35;

		/* attack transient — the initial full-band snap */
		var snap = oc.createBufferSource();
		snap.buffer = noiseBuffer(oc, 0.03, rand);
		var sg = oc.createGain();
		sg.gain.setValueAtTime(1.0, t0);
		sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.022);
		snap.connect(sg);
		sg.connect(out);
		snap.start(t0);

		/* main body — broadband noise through a falling lowpass */
		var body = oc.createBufferSource();
		body.buffer = noiseBuffer(oc, dur, rand);
		var lp = oc.createBiquadFilter();
		lp.type = 'lowpass';
		lp.Q.value = 0.6;
		lp.frequency.setValueAtTime(small ? 7200 : 9500, t0);
		lp.frequency.exponentialRampToValueAtTime(small ? 340 : 160, t0 + dur * 0.7);
		var bg = oc.createGain();
		bg.gain.setValueAtTime(small ? 0.78 : 0.92, t0);
		bg.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.92);
		body.connect(lp);
		lp.connect(bg);
		bg.connect(out);
		body.start(t0);
		body.stop(t0 + dur);

		/* sub boom — the chest hit */
		var boom = oc.createOscillator();
		boom.type = 'sine';
		boom.frequency.setValueAtTime(small ? 95 : 72, t0);
		boom.frequency.exponentialRampToValueAtTime(small ? 55 : 36, t0 + (small ? 0.3 : 0.7));
		var bog = oc.createGain();
		bog.gain.setValueAtTime(small ? 0.62 : 0.88, t0);
		bog.gain.exponentialRampToValueAtTime(0.001, t0 + (small ? 0.34 : 0.78));
		boom.connect(bog);
		bog.connect(out);
		boom.start(t0);
		boom.stop(t0 + (small ? 0.4 : 0.85));

		if (!small) {
			/* mid-band body texture, sweeping down with the body */
			var tex = oc.createBufferSource();
			tex.buffer = noiseBuffer(oc, dur, rand);
			var bp = oc.createBiquadFilter();
			bp.type = 'bandpass';
			bp.Q.value = 1.1;
			bp.frequency.setValueAtTime(850, t0);
			bp.frequency.exponentialRampToValueAtTime(220, t0 + 1.5);
			var tg2 = oc.createGain();
			tg2.gain.setValueAtTime(0.32, t0);
			tg2.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
			tex.connect(bp);
			bp.connect(tg2);
			tg2.connect(out);
			tex.start(t0);
			tex.stop(t0 + 1.7);

			/* faint crackle tail */
			var scratch = noiseBuffer(oc, 0.09, rand);
			var t = 0.95 + rand() * 0.15;
			while (t < dur - 0.06) {
				popSound(oc, out, scratch, rand, t, 0.05 + rand() * 0.06, 2400 + rand() * 2200);
				t += 0.02 + Math.pow(rand(), 1.4) * 0.16;
			}
		}
	}

	function renderCrackle(oc, out, rand, small) {
		var dur = small ? 1.6 : 3.0;
		var scratch = noiseBuffer(oc, 0.09, rand);
		var t = 0.015;
		var count = 0;
		var maxPops = small ? 70 : 130;
		while (t < dur - 0.05 && count < maxPops) {
			var fall = 1 - t / dur;
			var amp = (small ? 0.5 : 0.62) * (0.25 + 0.75 * Math.pow(fall, 0.6)) * (0.35 + rand() * 0.65);
			var hp = 2600 + rand() * 2400 * (small ? 1.15 : 1) * (0.55 + 0.45 * fall);
			popSound(oc, out, scratch, rand, t, amp, hp);
			count++;
			/* very dense at first, sparser toward the tail */
			t += 0.004 + Math.pow(rand(), 1.6) * (small ? 0.075 : 0.11) * (0.3 + 2.8 * (t / dur));
		}
	}

	var PLANS = {
		lift: {
			count: 3,
			seconds: 1.7,
			render: function (oc, out, rand) {
				renderLift(oc, out, rand);
			}
		},
		burst: {
			count: 2,
			seconds: 2.4,
			render: function (oc, out, rand) {
				renderBurst(oc, out, rand, false);
			}
		},
		burstSmall: {
			count: 2,
			seconds: 1.1,
			render: function (oc, out, rand) {
				renderBurst(oc, out, rand, true);
			}
		},
		crackle: {
			count: 1,
			seconds: 3.0,
			render: function (oc, out, rand) {
				renderCrackle(oc, out, rand, false);
			}
		},
		crackleSmall: {
			count: 1,
			seconds: 1.6,
			render: function (oc, out, rand) {
				renderCrackle(oc, out, rand, true);
			}
		}
	};

	function renderOne(type, spec, variantIndex, sampleRate) {
		var rand = mulberry32((hashString(type) ^ (0x9e3779b9 + variantIndex * 0x85ebca6b)) >>> 0);
		var oc = new OfflineAudioContext(1, Math.ceil(spec.seconds * sampleRate), sampleRate);
		var out = busChain(oc);
		spec.render(oc, out, rand);
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
