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
  function bell(t: number, f: number, peak: number, len: number) {
    for (const [m, a] of [
      [1, 1],
      [2, 0.15],
    ] as const) {
      const o = O("sine", f * m, t, len + 0.1);
      const g = G();
      o.connect(g);
      g.connect(out);
      g.connect(verb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * a, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (m === 1 ? len : len / 3));
    }
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

    /** Work finished. */
    done() {
      const t = now();
      if (t === null) return;
      bell(t, 880, 0.03, 0.8);
      bell(t + 0.1, 1318.5, 0.03, 0.8);
    },
  };
}
