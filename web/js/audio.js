// Sons procedurais (Web Audio) — nenhum arquivo de áudio necessário.
let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

function noiseBuffer() {
  const len = Math.floor(ctx.sampleRate * 0.25);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let noise = null;

const TAP = {
  grass: { f: 900, q: 0.8, dur: 0.07, tone: 0 },
  stone: { f: 2200, q: 2.5, dur: 0.06, tone: 520 },
  wood: { f: 700, q: 4, dur: 0.09, tone: 260 },
  leaves: { f: 3500, q: 0.6, dur: 0.12, tone: 0 },
  ice: { f: 5000, q: 6, dur: 0.1, tone: 1400 },
};

export function playTap(surfaceName = 'grass', volume = 0.5) {
  if (!ctx) return;
  noise ??= noiseBuffer();
  const s = TAP[surfaceName] || TAP.grass;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = s.f; bp.Q.value = s.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + s.dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t); src.stop(t + s.dur + 0.02);
  if (s.tone) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(s.tone * (0.9 + Math.random() * 0.2), t);
    o.frequency.exponentialRampToValueAtTime(s.tone * 0.6, t + s.dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(volume * 0.25, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + s.dur);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + s.dur + 0.02);
  }
}

function beep(freqs, dur = 0.12, type = 'square', vol = 0.18) {
  if (!ctx) return;
  let t = ctx.currentTime;
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur);
    t += dur * 0.8;
  }
}

export const sfx = {
  tagged: () => beep([880, 440, 220], 0.14, 'sawtooth', 0.22),
  tagOther: () => beep([660, 990], 0.1, 'square', 0.16),
  roundStart: () => beep([523, 659, 784], 0.12, 'triangle', 0.25),
  roundEnd: () => beep([784, 659, 523, 392], 0.15, 'triangle', 0.25),
  button: () => beep([1200], 0.05, 'square', 0.12),
};
