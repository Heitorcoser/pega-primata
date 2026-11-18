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
  metal: { f: 3200, q: 5, dur: 0.09, tone: 900 },
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

// ------------------------------------------------------------------ áudio 3D / terror
export function setListener(pos, fwd) {
  if (!ctx) return;
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
    L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(pos.x, pos.y, pos.z);
    L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }
}
function panner(pos) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 1.5;
  p.maxDistance = 30;
  p.rolloffFactor = 1.3;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(master);
  return p;
}
// som posicionado no mundo: passos, rosnados, gritos
export function playAt(kind, pos, vol = 1) {
  if (!ctx) return;
  noise ??= noiseBuffer();
  const t = ctx.currentTime;
  const out = panner(pos);
  if (kind === 'step') {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + Math.random() * 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(g).connect(out); src.start(t); src.stop(t + 0.14);
  } else if (kind === 'growl' || kind === 'screech') {
    const dur = kind === 'growl' ? 0.9 : 0.7;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const base = kind === 'growl' ? 70 + Math.random() * 25 : 420 + Math.random() * 120;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(kind === 'growl' ? base * 0.8 : base * 2.1, t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = kind === 'growl' ? 28 : 46;
    const lfoG = ctx.createGain(); lfoG.gain.value = base * 0.18;
    lfo.connect(lfoG).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'growl' ? 380 : 1800; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = kind === 'growl' ? 500 : 2600; nf.Q.value = 2;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    n.connect(nf).connect(ng).connect(g);
    o.connect(f).connect(g).connect(out);
    o.start(t); lfo.start(t); n.start(t);
    o.stop(t + dur); lfo.stop(t + dur); n.stop(t + dur);
  }
}

let ambient = null;
export function startAmbient() {
  if (!ctx || ambient) return;
  noise ??= noiseBuffer();
  const g = ctx.createGain(); g.gain.value = 0.07; g.connect(master);
  for (const f of [48, 48.7, 96.3]) { // zumbido elétrico da estação
    const o = ctx.createOscillator(); o.frequency.value = f; o.type = f > 90 ? 'triangle' : 'sine';
    const og = ctx.createGain(); og.gain.value = f > 90 ? 0.25 : 0.6;
    o.connect(og).connect(g); o.start();
  }
  const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 300;
  const ng = ctx.createGain(); ng.gain.value = 0.5;
  n.connect(nf).connect(ng).connect(g); n.start();
  ambient = g;
}

// coração acelerado enquanto um monstro está atrás de você (0 = calmo, 1 = colado)
let heartLevel = 0, heartNext = 0;
export function setHeart(level) { heartLevel = level; }
export function audioTick() {
  if (!ctx || heartLevel <= 0.01) return;
  const t = ctx.currentTime;
  if (t < heartNext) return;
  heartNext = t + (1.0 - heartLevel * 0.55);
  for (const [dt, f] of [[0, 62], [0.16, 54]]) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t + dt); g.gain.exponentialRampToValueAtTime(0.5 * heartLevel + 0.15, t + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.16);
    o.connect(g).connect(master); o.start(t + dt); o.stop(t + dt + 0.2);
  }
}

export function jumpscare() {
  if (!ctx) return;
  noise ??= noiseBuffer();
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
  shaper.curve = curve;
  shaper.connect(g).connect(master);
  for (const f of [180, 247, 333]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 2.2, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 1);
    o.connect(shaper); o.start(t); o.stop(t + 1.1);
  }
  const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
  const ng = ctx.createGain(); ng.gain.value = 0.6;
  n.connect(ng).connect(shaper); n.start(t); n.stop(t + 1.1);
}

export const sfx = {
  pickup: () => beep([880, 1175, 1568], 0.09, 'sine', 0.22),
  elevatorOpen: () => beep([660, 880], 0.35, 'sine', 0.25),
  countdown: () => beep([990], 0.08, 'square', 0.12),
  floorUp: () => beep([392, 523, 659, 784, 1047], 0.13, 'triangle', 0.25),
  tagged: () => beep([880, 440, 220], 0.14, 'sawtooth', 0.22),
  tagOther: () => beep([660, 990], 0.1, 'square', 0.16),
  roundStart: () => beep([523, 659, 784], 0.12, 'triangle', 0.25),
  roundEnd: () => beep([784, 659, 523, 392], 0.15, 'triangle', 0.25),
  button: () => beep([1200], 0.05, 'square', 0.12),
};
