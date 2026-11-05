/**
 * Sound for the landing demos, synthesized with the Web Audio API (no audio files).
 * Off until the visitor turns it on; the choice is remembered in this browser.
 */

const KEY = "gitterm:sound";
let on = false;
try {
  on = typeof window !== "undefined" && localStorage.getItem(KEY) === "on";
} catch {}

const listeners = new Set<() => void>();
export const sound = {
  get on() {
    return on;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  set(next: boolean) {
    on = next;
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {}
    if (next) init();
    else {
      stopAll();
      void ctx?.suspend().catch(() => {});
    }
    for (const fn of listeners) fn();
  },
};

let ctx: AudioContext | undefined;
let master: GainNode;
let noiseBuf: AudioBuffer;
let impulse: AudioBuffer;
const playing = new Set<() => void>();
const stopAll = () => {
  for (const stop of playing) stop();
};

// Browsers start audio only after a click or key press, so a choice remembered from a past
// visit waits for the first one.
if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown"])
    window.addEventListener(ev, () => on && init(), { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAll();
    else if (on && ctx) init();
  });
}

function init() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // A small room, from decaying noise
      const len = ctx.sampleRate * 1.8;
      impulse = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = impulse.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
      }
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {
    stopAll();
    void ctx?.close().catch(() => {});
    ctx = undefined;
  }
}

const r = (a: number, b: number) => a + Math.random() * (b - a);
// Where the windows sit: the sandbox on the left of the terminal, the preview and phone on the right
const SBX = -0.45;
const PV = 0.45;
// The dev server's beat, in seconds. The sandbox status dot pulses at the same rate (landing.css).
const BEAT = 0.5;
// Everything is in A major pentatonic, so sounds that overlap still agree
const SCALE = [
  220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.26, 739.99, 880, 987.77, 1108.73,
  1318.51, 1479.98, 1760,
];
const HIGH = SCALE.slice(10).map((f) => f * 2);
const G = (v = 0) => {
  const g = ctx!.createGain();
  g.gain.value = v;
  return g;
};
const F = (type: BiquadFilterType, f: number, q = 1) => {
  const b = ctx!.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
};
const P = (v: number) => {
  const p = ctx!.createStereoPanner();
  p.pan.value = v;
  return p;
};
// Percussive envelope: rise to the peak, then fall away
function hit(p: AudioParam, t: number, peak: number, attack: number, decay: number) {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function chain(...nodes: AudioNode[]) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
}

/** One demo's playback, cancelled independently on replay, scroll-away or unmount. */
export function createSfx(visible: () => boolean) {
  let out: GainNode;
  let verb: GainNode;
  let connected = false;
  let disposed = false;
  const sources = new Set<AudioScheduledSourceNode>();
  function stop() {
    for (const source of sources) source.stop();
    sources.clear();
    out?.disconnect();
    connected = false;
    verb?.disconnect();
    playing.delete(stop);
    lastKey = keyGap = 0;
  }
  function now() {
    if (disposed || !visible() || !on || !ctx || ctx.state !== "running" || document.hidden)
      return null;
    if (!connected) {
      out = G(1);
      out.connect(master);
      const conv = ctx.createConvolver();
      conv.buffer = impulse;
      verb = G(0.22);
      verb.connect(conv).connect(out);
      connected = true;
      playing.add(stop);
    }
    return ctx.currentTime + 0.01;
  }
  function track<T extends AudioScheduledSourceNode>(source: T) {
    sources.add(source);
    source.addEventListener("ended", () => sources.delete(source), { once: true });
    return source;
  }
  function N(t: number, dur: number) {
    const s = ctx!.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, r(0, 1.5));
    s.stop(t + dur);
    return track(s);
  }
  function O(type: OscillatorType, f: number, t: number, dur: number) {
    const o = ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(t);
    o.stop(t + dur);
    return track(o);
  }
  function bell(t: number, f: number, peak: number, len: number, dest: AudioNode = out) {
    for (const [m, a] of [
      [1, 1],
      [2, 0.15],
    ] as const) {
      const o = O("sine", f * m, t, len + 0.1);
      const g = G();
      o.connect(g);
      g.connect(dest);
      g.connect(verb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * a, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (m === 1 ? len : len / 3));
    }
  }

  /** A bus placed left/right to match the window the sound belongs to, with some room on it. */
  function voice(pan = 0, wet = 0) {
    const g = G(1);
    const p = P(pan);
    g.connect(p);
    p.connect(out);
    if (wet) {
      const s = G(wet);
      p.connect(s);
      s.connect(verb);
    }
    return g;
  }
  /** Struck wood: a sine with a bright, quick overtone and a tap of noise. */
  function marimba(t: number, f: number, peak: number, dest: AudioNode) {
    const g = G();
    chain(O("sine", f, t, 0.7), g, dest);
    hit(g.gain, t, peak, 0.002, 0.5);
    const g2 = G();
    chain(O("sine", f * 3.93, t, 0.15), g2, dest);
    hit(g2.gain, t, peak * 0.22, 0.001, 0.06);
    const c = G();
    chain(N(t, 0.02), F("bandpass", f * 2, 1.2), c, dest);
    hit(c.gain, t, peak * 0.5, 0.001, 0.006);
  }

  let lastKey = 0;
  let keyGap = 0;

  return {
    stop,
    dispose() {
      stop();
      disposed = true;
    },
    /** A soft, crisp key press. Typing faster than a person can is thinned out. */
    key(kind: "key" | "space" | "enter" = "key") {
      const t = now();
      if (t === null) return;
      if (kind !== "enter" && t - lastKey < keyGap) return;
      lastKey = t;
      keyGap = r(0.055, 0.095);
      const big = kind !== "key";
      const k = (big ? 0.8 : 1) * r(0.97, 1.03);
      const bus = F("lowpass", 4000, 0.5);
      chain(bus, P(big ? 0 : r(-0.12, 0.12)), out);
      // Faint switch tick
      const c = G();
      chain(N(t, 0.02), F("bandpass", 2700 * k, 0.6), c, bus);
      hit(c.gain, t, 0.045 * r(0.9, 1.1), 0.0008, 0.007);
      // Rounded keycap tock
      const o = O("sine", 470 * k * 1.5, t, 0.1);
      const og = G();
      o.frequency.exponentialRampToValueAtTime(470 * k, t + 0.012);
      chain(o, og, bus);
      hit(og.gain, t, 0.26 * r(0.92, 1.04), 0.002, big ? 0.05 : 0.034);
      // A little texture so it isn't a pure tone
      const n = G();
      chain(N(t, 0.05), F("lowpass", 700, 0.5), n, bus);
      hit(n.gain, t, 0.12, 0.002, 0.025);
      // Weight from the desk
      const l = O("sine", 140 * k, t, 0.12);
      const lg = G();
      chain(l, lg, bus);
      hit(lg.gain, t, big ? 0.16 : 0.11, 0.003, big ? 0.07 : 0.045);
    },

    /** Fans spinning up as memory fills. */
    fan(dur: number) {
      const t = now();
      if (t === null) return;
      const a = G();
      const bp = F("bandpass", 300, 0.6);
      chain(N(t, dur + 0.4), bp, a, out);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + dur);
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(0.008, t + 0.1);
      a.gain.exponentialRampToValueAtTime(0.22, t + dur);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
      const w = O("sawtooth", 160, t, dur + 0.4);
      const wg = G();
      w.frequency.setValueAtTime(160, t);
      w.frequency.exponentialRampToValueAtTime(720, t + dur);
      const vg = G(6);
      chain(O("sine", 9, t, dur + 0.4), vg);
      vg.connect(w.frequency);
      chain(w, F("lowpass", 1400, 2), wg, out);
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.linearRampToValueAtTime(0.002, t + 0.1);
      wg.gain.exponentialRampToValueAtTime(0.05, t + dur);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    },

    /**
     * The machine shaking: a wobbling motor hum and the chassis knocking on the desk.
     * Runs for up to `dur` seconds; call the returned function to cut it off.
     */
    rattle(dur: number): () => void {
      const t = now();
      if (t === null) return () => {};
      const bus = G(1);
      bus.connect(out);
      const mg = G();
      const wd = G(0.06);
      chain(O("sine", 7, t, dur), wd);
      wd.connect(mg.gain);
      chain(O("square", 48, t, dur), F("lowpass", 320, 1), mg, bus);
      mg.gain.setValueAtTime(0.0001, t);
      mg.gain.linearRampToValueAtTime(0.14, t + 0.15);
      mg.gain.setValueAtTime(0.14, t + dur - 0.1);
      mg.gain.linearRampToValueAtTime(0.0001, t + dur);
      for (let x = t; x < t + dur; x += r(0.028, 0.045)) {
        const g = G();
        chain(N(x, 0.03), F("bandpass", r(900, 2400), 2.5), g, P(r(-0.5, 0.5)), bus);
        hit(g.gain, x, r(0.08, 0.2), 0.001, r(0.008, 0.02));
      }
      return () => {
        if (!ctx) return;
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
      };
    },

    /** Power cut: a relay clack, everything spinning down, a final clunk, and sparks. */
    crash() {
      const t = now();
      if (t === null) return;
      const c = G();
      chain(N(t, 0.05), F("bandpass", 1800, 1), c, out);
      hit(c.gain, t, 0.5, 0.001, 0.03);
      for (const [m, peak] of [
        [1, 0.09],
        [1.5, 0.04],
      ] as const) {
        const o = O("sawtooth", 520 * m, t, 1.8);
        const f = F("lowpass", 3000, 1);
        const g = G();
        o.frequency.exponentialRampToValueAtTime(26 * m, t + 1.7);
        f.frequency.exponentialRampToValueAtTime(180, t + 1.7);
        chain(o, f, g, out);
        g.gain.setValueAtTime(peak, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
      }
      const k = t + 1.55;
      const o = O("sine", 90, k, 0.4);
      const g = G();
      o.frequency.exponentialRampToValueAtTime(34, k + 0.25);
      chain(o, g, out);
      hit(g.gain, k, 0.5, 0.004, 0.3);
      const th = G();
      chain(N(k, 0.15), F("lowpass", 260, 1), th, out);
      hit(th.gain, k, 0.5, 0.002, 0.1);

      // Sparks, densest at the start
      const s0 = t + 0.02;
      const dur = 1.5;
      for (let i = 0; i < 34; i++) {
        const x = s0 + Math.random() ** 1.8 * dur;
        const bursts = Math.random() < 0.35 ? Math.ceil(r(2, 6)) : 1;
        for (let j = 0; j < bursts; j++) {
          const y = x + j * r(0.004, 0.012);
          const sg = G();
          chain(N(y, 0.03), F("highpass", r(2500, 6000), 0.7), sg, P(r(-0.7, 0.7)), out);
          hit(sg.gain, y, r(0.08, 0.3) * (1 - ((x - s0) / dur) * 0.7), 0.0005, r(0.003, 0.014));
        }
      }
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 6);
      for (const d of [0.05, 0.45]) {
        const z = s0 + d;
        const sh = ctx!.createWaveShaper();
        const zg = G();
        sh.curve = curve;
        chain(O("sawtooth", 110, z, 0.12), sh, F("bandpass", 1400, 0.8), zg, out);
        zg.gain.setValueAtTime(0.0001, z);
        zg.gain.linearRampToValueAtTime(0.09, z + 0.005);
        for (let q = 0.01; q < 0.1; q += 0.018)
          zg.gain.setValueAtTime(Math.random() < 0.5 ? 0.0001 : 0.09, z + q);
        zg.gain.linearRampToValueAtTime(0.0001, z + 0.11);
      }
      const sz = G();
      chain(N(s0, dur), F("bandpass", 6500, 1.5), sz, out);
      sz.gain.setValueAtTime(0.03, s0);
      sz.gain.exponentialRampToValueAtTime(0.0001, s0 + dur);
    },

    /** The googly eyes wobbling. */
    boing() {
      const t = now();
      if (t === null) return;
      const o = O("sine", 260, t, 0.7);
      const g = G();
      const d = G(90);
      d.gain.exponentialRampToValueAtTime(4, t + 0.6);
      chain(O("sine", 16, t, 0.7), d);
      d.connect(o.frequency);
      o.frequency.setValueAtTime(240, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.08);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      chain(o, g, out);
      hit(g.gain, t, 0.22, 0.005, 0.6);
    },

    /** A window opening: quiet air, then one soft note. */
    windowOpen() {
      const t = now();
      if (t === null) return;
      const w = G();
      const bp = F("bandpass", 600, 0.8);
      bp.frequency.setValueAtTime(600, t);
      bp.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
      chain(N(t, 0.32), bp, w, out);
      w.gain.setValueAtTime(0.0001, t);
      w.gain.exponentialRampToValueAtTime(0.045, t + 0.1);
      w.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      bell(t + 0.1, 659.3, 0.035, 0.7);
    },

    /** A session appearing; each next one (n) is a step higher. */
    pop(n: number) {
      const t = now();
      if (t === null) return;
      const SCALE = [783.99, 880, 987.77, 1174.66, 1318.5];
      const f = SCALE[n % SCALE.length] ?? 880;
      const o = O("sine", f * 0.75, t, 0.15);
      const g = G();
      o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      o.connect(g);
      g.connect(out);
      g.connect(verb);
      hit(g.gain, t, 0.08, 0.003, 0.1);
      const c = G();
      chain(N(t, 0.02), F("highpass", 4000, 0.7), c, out);
      hit(c.gain, t, 0.05, 0.001, 0.006);
    },

    // ---------- The session at work ----------
    // Each kind of work has its own voice, and sits on the side of the window it belongs to:
    // the sandbox on the left, the preview and the phone on the right, your laptop in the middle.

    /** A tool call came back: one soft tick. */
    ok() {
      const t = now();
      if (t === null) return;
      const g = G();
      chain(O("sine", 1318.51, t, 0.2), g, voice(SBX * 0.6, 0.3));
      hit(g.gain, t, 0.014, 0.004, 0.16);
    },

    /** A sandbox boots somewhere else: a clean rising sweep that blooms into a chord. */
    boot(dur: number) {
      const t = now();
      if (t === null) return;
      const v = voice(SBX, 0.5);
      const o = O("sawtooth", 110, t, dur + 0.1);
      const lp = F("lowpass", 250, 4);
      const g = G();
      o.frequency.exponentialRampToValueAtTime(440, t + dur);
      lp.frequency.exponentialRampToValueAtTime(2600, t + dur);
      chain(o, lp, g, v);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.02, t + dur * 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      const a = G();
      const bp = F("bandpass", 400, 1.4);
      bp.frequency.exponentialRampToValueAtTime(4000, t + dur);
      chain(N(t, dur + 0.1), bp, a, v);
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(0.018, t + dur);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
      const b = t + dur;
      [220, 329.63, 440, 554.37].forEach((f, i) => bell(b + i * 0.09, f, 0.018, 1.8, v));
    },

    /** Files streaming over: sparkles that speed up as they go, from your laptop to the sandbox. */
    transfer(dur: number, dir: "up" | "down") {
      const t = now();
      if (t === null) return;
      const n = Math.round(dur * 9);
      const [p0, p1] = dir === "up" ? [0, SBX] : [SBX, 0];
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const x = t + dur * Math.sqrt(u);
        const w = dir === "up" ? u : 1 - u;
        const f = HIGH[Math.min(HIGH.length - 1, Math.floor(w * 5 + r(0, 4)))]!;
        const g = G();
        chain(O("sine", f / 2, x, 0.2), g, P(p0 + (p1 - p0) * u), out);
        hit(g.gain, x, r(0.008, 0.014), 0.005, 0.16);
      }
      const a = G();
      const bp = F("bandpass", dir === "up" ? 1500 : 5000, 2);
      bp.frequency.exponentialRampToValueAtTime(dir === "up" ? 5000 : 1500, t + dur);
      chain(N(t, dur), bp, a, P(p1), out);
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(0.006, t + dur * 0.7);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    },

    /** One plain line of terminal output. */
    tick(pan = SBX) {
      const t = now();
      if (t === null) return;
      const g = G();
      chain(N(t, 0.02), F("highpass", 3200, 0.7), g, P(pan), out);
      hit(g.gain, t, 0.018, 0.001, 0.008);
    },

    /** A passing test file: each next one (n) a step higher, so a test run plays a melody. */
    pass(n: number) {
      const t = now();
      if (t === null) return;
      marimba(t, SCALE[Math.min(n + 7, SCALE.length - 1)]!, 0.055, voice(SBX, 0.35));
    },

    /** A failing test: a low, sour bonk. */
    fail() {
      const t = now();
      if (t === null) return;
      const v = voice(SBX, 0.25);
      const lp = F("lowpass", 700, 1.5);
      const g = G();
      chain(lp, g, v);
      for (const f of [110, 116.54]) {
        const o = O("square", f, t, 0.4);
        o.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.3);
        o.connect(lp);
      }
      hit(g.gain, t, 0.06, 0.004, 0.32);
    },

    /** The suite's summary line: a phrase that resolves when everything passes. */
    verdict(passed: boolean) {
      const t = now();
      if (t === null) return;
      const v = voice(SBX * 0.7, 0.5);
      const notes = passed ? [880, 1108.73, 1318.51] : [659.26, 523.25];
      notes.forEach((f, i) => marimba(t + i * (passed ? 0.14 : 0.2), f, 0.05, v));
    },

    /** A dev server compiling: a soft zip, a little higher each time. */
    compile(n: number) {
      const t = now();
      if (t === null) return;
      const g = G();
      const o = O("sine", 330 + n * 110, t, 0.3);
      o.frequency.exponentialRampToValueAtTime(660 + n * 220, t + 0.18);
      chain(o, g, voice(SBX, 0.3));
      hit(g.gain, t, 0.02, 0.02, 0.24);
    },

    /** The dev server is up. */
    ready() {
      const t = now();
      if (t === null) return;
      const v = voice(SBX, 0.6);
      bell(t, 1318.51, 0.022, 1, v);
      bell(t + 0.16, 1760, 0.018, 1.2, v);
    },

    /**
     * A dev server running in the sandbox: a quiet beat, as if through a wall. `open()` lets
     * it through (the preview is on screen now); `stop()` fades it out.
     */
    server() {
      const t = now();
      const none = { open() {}, stop() {} };
      if (t === null) return none;
      const bus = G();
      const lp = F("lowpass", 520, 0.8);
      const p = P(SBX);
      chain(bus, lp, p, out);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(1, t + 1);
      const half = BEAT / 2;
      for (let k = 0; k * half < 24; k++) {
        const x = t + k * half;
        if (k % 2 === 0) {
          const o = O("sine", 120, x, 0.25);
          const g = G();
          o.frequency.exponentialRampToValueAtTime(42, x + 0.14);
          chain(o, g, bus);
          hit(g.gain, x, 0.2, 0.003, 0.2);
        } else {
          const g = G();
          chain(N(x, 0.04), F("highpass", 7000, 0.7), g, bus);
          hit(g.gain, x, k % 4 === 3 ? 0.03 : 0.018, 0.001, 0.025);
        }
        // A two-note bass line, one bar of four beats
        const step = k % 8;
        if (step === 0 || step === 3 || step === 6) {
          const g = G();
          chain(O("triangle", step === 6 ? 82.41 : 110, x, 0.3), g, bus);
          hit(g.gain, x, 0.07, 0.005, 0.22);
        }
      }
      return {
        open() {
          if (ctx) lp.frequency.setTargetAtTime(6000, ctx.currentTime, 0.5);
          if (ctx) p.pan.setTargetAtTime(0, ctx.currentTime, 0.6);
        },
        stop() {
          if (ctx) bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.35);
        },
      };
    },

    /** A preview URL goes live: a sonar ping out to the right, where its window opens. */
    ping() {
      const t = now();
      if (t === null) return;
      const v = voice(PV, 0.6);
      const d = ctx!.createDelay(1);
      d.delayTime.value = 0.21;
      const fb = G(0.25);
      const wet = G(0.6);
      chain(d, fb, d);
      chain(d, F("lowpass", 2400, 0.7), wet, v);
      const o = O("sine", 1318.51, t, 0.5);
      const g = G();
      o.connect(g);
      g.connect(v);
      g.connect(d);
      hit(g.gain, t, 0.035, 0.004, 0.5);
    },

    /** The agent reading a file on your laptop: a page turning. */
    page() {
      const t = now();
      if (t === null) return;
      const g = G();
      const bp = F("bandpass", 2200, 1);
      bp.frequency.exponentialRampToValueAtTime(5200, t + 0.12);
      chain(N(t, 0.16), bp, g, out);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    },

    /** The agent editing a file on your laptop: a quick, light flurry of keys. */
    scribble(dur: number) {
      const t = now();
      if (t === null) return;
      for (let x = t; x < t + dur; x += r(0.1, 0.18)) {
        const g = G();
        chain(N(x, 0.03), F("bandpass", r(1800, 3000), 1), g, P(r(-0.1, 0.1)), out);
        hit(g.gain, x, r(0.015, 0.025), 0.002, 0.018);
      }
    },

    /** The agent says something: a soft two-note bloop. */
    say() {
      const t = now();
      if (t === null) return;
      const v = voice(0, 0.4);
      for (const [d, f] of [
        [0, 440],
        [0.07, 659.26],
      ] as const) {
        const o = O("sine", f * 0.9, t + d, 0.15);
        const g = G();
        o.frequency.exponentialRampToValueAtTime(f, t + d + 0.03);
        chain(o, g, v);
        hit(g.gain, t + d, 0.035, 0.004, 0.09);
      }
    },

    /** One part of the session packed for the cloud: each a step higher, drifting right. */
    beam(n: number) {
      const t = now();
      if (t === null) return;
      const f = SCALE[Math.min(n * 2 + 2, SCALE.length - 1)]!;
      const p = P(-0.1);
      p.pan.linearRampToValueAtTime(PV, t + 0.5);
      p.connect(out);
      const o = O("sine", f * 0.5, t, 0.6);
      const g = G();
      o.frequency.exponentialRampToValueAtTime(f, t + 0.25);
      chain(o, g, p);
      hit(g.gain, t, 0.025, 0.04, 0.45);
      const s = G();
      chain(o, s, verb);
      hit(s.gain, t, 0.02, 0.04, 0.45);
    },

    /** The session leaves for the cloud: a slow, soft swell of air drifting right. */
    teleport() {
      const t = now();
      if (t === null) return;
      const a = G();
      const bp = F("bandpass", 300, 1.2);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
      chain(N(t, 1.8), bp, a, voice(PV, 0.4));
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(0.03, t + 0.9);
      a.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    },

    /** Work finished. */
    done() {
      const t = now();
      if (t === null) return;
      bell(t, 880, 0.03, 0.8);
      bell(t + 0.1, 1318.5, 0.03, 0.8);
    },
  };
}
