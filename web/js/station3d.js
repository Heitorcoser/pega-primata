// Monta o visual 3D + colisores de um andar da Estação Zero a partir dos dados de station.js.
// Geometria estática unida por material (poucas chamadas de desenho = roda bem no Quest).
import * as THREE from 'three';
import { WALL_H, WALL_T, MEZZ_H } from './shared/station.js';
import { FLOORS } from './shared/levels.js';

// ------------------------------------------------------------------ texturas (geradas)
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function noise(g, s, n, a, b, alpha = 1) {
  for (let k = 0; k < n; k++) {
    const v = a + Math.random() * (b - a);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const r = 1 + Math.random() * 2.5;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    wall: canvasTex(256, (g, s) => {
      g.fillStyle = '#d9dcdf'; g.fillRect(0, 0, s, s);
      noise(g, s, 2500, 190, 235);
      g.fillStyle = 'rgba(60,64,70,0.55)'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s); // juntas dos painéis
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 3, s, 2); g.fillRect(3, 0, 2, s);
      g.fillStyle = 'rgba(70,74,80,0.7)';
      for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
      const grd = g.createLinearGradient(0, s * 0.72, 0, s); // sujeira perto do chão
      grd.addColorStop(0, 'rgba(40,36,30,0)'); grd.addColorStop(1, 'rgba(40,36,30,0.35)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }),
    floor: canvasTex(256, (g, s) => {
      g.fillStyle = '#5b5f63'; g.fillRect(0, 0, s, s);
      noise(g, s, 3000, 70, 120);
      g.strokeStyle = 'rgba(25,27,30,0.8)'; g.lineWidth = 3;
      for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * s / 2, 0); g.lineTo(k * s / 2, s); g.moveTo(0, k * s / 2); g.lineTo(s, k * s / 2); g.stroke(); }
      for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(20,18,15,0.12)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 30, 0, 7); g.fill(); }
    }),
    ceiling: canvasTex(128, (g, s) => {
      g.fillStyle = '#2a2d31'; g.fillRect(0, 0, s, s);
      noise(g, s, 600, 30, 60);
      g.strokeStyle = '#17191c'; g.lineWidth = 3; g.strokeRect(1, 1, s - 2, s - 2);
    }),
    metal: canvasTex(128, (g, s) => {
      g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y++) { const v = 140 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(0, y, s, 1); }
      noise(g, s, 300, 90, 120, 0.5);
    }),
    crate: canvasTex(256, (g, s) => {
      g.fillStyle = '#b86b2a'; g.fillRect(0, 0, s, s);
      noise(g, s, 1500, 120, 190, 0.35);
      g.strokeStyle = '#6e3c14'; g.lineWidth = 18; g.strokeRect(9, 9, s - 18, s - 18);
      g.lineWidth = 12; g.beginPath(); g.moveTo(18, 18); g.lineTo(s - 18, s - 18); g.stroke();
      g.fillStyle = 'rgba(30,20,10,0.75)'; g.font = 'bold 42px monospace'; g.textAlign = 'center';
      g.fillText('BIO-7', s / 2, s / 2 + 70);
    }),
    hazard: canvasTex(128, (g, s) => {
      g.fillStyle = '#f2c230'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#1c1c1c';
      for (let k = -s; k < s * 2; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 16, 0); g.lineTo(k + 16 - s, s); g.lineTo(k - s, s); g.fill(); }
    }),
    grate: canvasTex(128, (g, s) => {
      g.fillStyle = '#3c4146'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#6d747b'; g.lineWidth = 4;
      for (let k = 0; k <= s; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, s); g.moveTo(0, k); g.lineTo(s, k); g.stroke(); }
    }),
    screen: canvasTex(256, (g, s) => {
      g.fillStyle = '#04121c'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#3cf0c8'; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x < s; x += 4) g.lineTo(x, s * 0.35 + Math.sin(x / 13) * 20 + Math.random() * 12);
      g.stroke();
      g.fillStyle = '#7fd6ff'; g.font = '16px monospace';
      ['AMOSTRA 7B ........ OK', 'CONTENCAO ...... FALHA', 'TEMP -4.2C', 'SUJEITOS: 3 SOLTOS'].forEach((t, k) => g.fillText(t, 12, s * 0.62 + k * 22));
    }, false),
    led: canvasTex(64, (g, s) => {
      g.fillStyle = '#111417'; g.fillRect(0, 0, s, s);
      for (let y = 4; y < s; y += 8) for (let x = 4; x < s; x += 12) { g.fillStyle = Math.random() < 0.5 ? '#2bff7a' : Math.random() < 0.5 ? '#ff4430' : '#1a1d20'; g.fillRect(x, y, 4, 3); }
    }),
  };
  return TEX;
}

function signTexture(lines, color = '#ffffff', bg = 'rgba(10,14,18,0.92)') {
  return canvasTex(256, (g, s) => {
    g.fillStyle = bg; g.fillRect(0, s * 0.25, s, s * 0.5);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(6, s * 0.25 + 6, s - 12, s * 0.5 - 12);
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 34px system-ui, sans-serif'; g.fillText(lines[0], s / 2, s / 2 - (lines[1] ? 16 : 0));
    if (lines[1]) { g.font = '22px system-ui, sans-serif'; g.fillText(lines[1], s / 2, s / 2 + 22); }
  }, false);
}

// ------------------------------------------------------------------ geometria unida
function boxGeo(sx, sy, sz, tile = 1.5) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
  }
  return g;
}
class Batch {
  constructor() { this.parts = []; }
  add(geo, m) { this.parts.push([geo, m.clone()]); }
  mesh(material) {
    if (!this.parts.length) return null;
    let nv = 0, ni = 0;
    for (const [g] of this.parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let ov = 0, oi = 0;
    for (const [g, m] of this.parts) {
      nm.getNormalMatrix(m);
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (let k = 0; k < P.count; k++) {
        v.fromBufferAttribute(P, k).applyMatrix4(m); pos.set([v.x, v.y, v.z], (ov + k) * 3);
        v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (ov + k) * 3);
        if (U) uv.set([U.getX(k), U.getY(k)], (ov + k) * 2);
      }
      if (g.index) for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.getX(k) + ov;
      else for (let k = 0; k < P.count; k++) idx[oi + k] = ov + k;
      ov += P.count; oi += g.index ? g.index.count : P.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return new THREE.Mesh(out, material);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const mat4 = (x, y, z, rotY = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), _s);

// ------------------------------------------------------------------ montagem do andar
export function buildStation(scene, physics, st, floorIndex) {
  const T = textures();
  const theme = FLOORS[Math.min(floorIndex, FLOORS.length - 1)];
  const accent = new THREE.Color(theme.accent);
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];
  const M = (o) => { disposables.push(o); return o; };

  const mats = {
    wall: M(new THREE.MeshLambertMaterial({ map: T.wall, color: theme.wallTint })),
    floor: M(new THREE.MeshLambertMaterial({ map: T.floor })),
    ceiling: M(new THREE.MeshLambertMaterial({ map: T.ceiling })),
    metal: M(new THREE.MeshLambertMaterial({ map: T.metal, color: 0xb8bec4 })),
    dark: M(new THREE.MeshLambertMaterial({ map: T.metal, color: 0x4a5056 })),
    white: M(new THREE.MeshLambertMaterial({ color: 0xe9eef0 })),
    crate: M(new THREE.MeshLambertMaterial({ map: T.crate })),
    hazard: M(new THREE.MeshLambertMaterial({ map: T.hazard })),
    grate: M(new THREE.MeshLambertMaterial({ map: T.grate })),
    accent: M(new THREE.MeshBasicMaterial({ color: accent })),
    panel: M(new THREE.MeshBasicMaterial({ color: 0xe8f1ff })),
    broken: M(new THREE.MeshBasicMaterial({ color: 0x1a1c1f })),
    screen: M(new THREE.MeshBasicMaterial({ map: T.screen })),
    led: M(new THREE.MeshBasicMaterial({ map: T.led })),
    glass: M(new THREE.MeshLambertMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, depthWrite: false })),
    liquid: M(new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.7), transparent: true, opacity: 0.55, depthWrite: false })),
    barrel: M(new THREE.MeshLambertMaterial({ map: T.metal, color: 0x2f6fb0 })),
    barrel2: M(new THREE.MeshLambertMaterial({ map: T.metal, color: 0xc2a12a })),
    pipe: M(new THREE.MeshLambertMaterial({ color: 0x7c6a58 })),
    specimen: M(new THREE.MeshLambertMaterial({ color: 0x2a2220 })),
  };
  const B = Object.fromEntries(Object.keys(mats).map((k) => [k, new Batch()]));
  const surf = { metal: { name: 'metal' }, wood: { name: 'wood' }, floor: { name: 'metal' }, glass: { name: 'ice' } };

  const box = (batch, m, sx, sy, sz, tile) => B[batch].add(boxGeo(sx, sy, sz, tile), m);
  const collider = (m, sx, sy, sz, s = surf.metal) => {
    _m.copy(m).decompose(_p, _q, _s.set(1, 1, 1));
    const c = physics.addBox(_p.clone(), new THREE.Vector3(sx / 2, sy / 2, sz / 2), _q.clone(), s);
    _s.set(1, 1, 1);
    return c;
  };
  const local = (base, x, y, z, rotY = 0) => new THREE.Matrix4().multiplyMatrices(base, mat4(x, y, z, rotY));
  const cyl = (batch, m, r, h, seg = 14) => B[batch].add(new THREE.CylinderGeometry(r, r, h, seg), m);

  // chão e teto
  const SX = st.W * st.CELL + 2, SZ = st.H * st.CELL + 2;
  box('floor', mat4(0, -0.25, 0), SX, 0.5, SZ, 2);
  collider(mat4(0, -0.25, 0), SX, 0.5, SZ, surf.floor);
  box('ceiling', mat4(0, WALL_H + 0.25, 0), SX, 0.5, SZ, 3);
  collider(mat4(0, WALL_H + 0.25, 0), SX, 0.5, SZ);

  // paredes + faixa de luz no rodapé + canos no alto
  const rnd = (() => { let s = st.seed ^ 0x5bd1e995; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  for (const w of st.walls) {
    const horiz = w.dir === 'h';
    const len = horiz ? w.x2 - w.x1 : w.z2 - w.z1;
    const cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2;
    const rot = horiz ? 0 : Math.PI / 2;
    const m = mat4(cx, WALL_H / 2, cz, rot);
    box('wall', m, len + WALL_T, WALL_H, WALL_T, 1.5);
    collider(m, len + WALL_T, WALL_H, WALL_T);
    for (const side of [-1, 1]) {
      const off = WALL_T / 2 + 0.012;
      box('accent', local(m, 0, 0.06, side * off), len - WALL_T, 0.035, 0.02);
      box('dark', local(m, 0, 0.012, side * (WALL_T / 2 + 0.02)), len - WALL_T, 0.11, 0.04);
      if (rnd() < 0.35 && len > 2) cyl('pipe', local(m, 0, WALL_H - 0.32 - rnd() * 0.2, side * (WALL_T / 2 + 0.1)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), 0.055, len - 0.4, 8);
    }
  }

  // luzes do teto
  const flickers = [];
  for (const L of st.lights) {
    const m = mat4(L.x, WALL_H - 0.012, L.z);
    if (L.kind === 'flicker') {
      const mat = M(mats.panel.clone());
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.02, 0.5), mat);
      mesh.position.set(L.x, WALL_H - 0.012, L.z);
      group.add(mesh);
      disposables.push(mesh.geometry);
      flickers.push({ mat, t: rnd() * 10 });
    } else {
      box(L.kind === 'broken' ? 'broken' : L.kind === 'elevator' ? 'accent' : 'panel', m, 1.3, 0.02, 0.5);
    }
    box('dark', mat4(L.x, WALL_H - 0.003, L.z), 1.42, 0.02, 0.62);
  }

  // ---------------------------------------------------------------- objetos
  const tall = [];
  for (const o of st.props) {
    const base = mat4(o.x, 0, o.z, o.rotY);
    switch (o.type) {
      case 'crate': {
        box('crate', local(base, 0, o.h / 2, 0), o.w, o.h, o.d, 1);
        if (o.safe) box('hazard', local(base, 0, o.h + 0.01, 0), o.w * 0.98, 0.02, o.d * 0.98, 0.5);
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d, surf.wood);
        break;
      }
      case 'barrel': {
        cyl(rnd() < 0.5 ? 'barrel' : 'barrel2', local(base, 0, o.h / 2, 0), o.w / 2, o.h);
        cyl('dark', local(base, 0, o.h * 0.3, 0), o.w / 2 + 0.012, 0.04);
        cyl('dark', local(base, 0, o.h * 0.7, 0), o.w / 2 + 0.012, 0.04);
        collider(local(base, 0, o.h / 2, 0), o.w * 0.9, o.h, o.d * 0.9);
        break;
      }
      case 'locker': {
        box('dark', local(base, 0, o.h / 2, 0), o.w, o.h, o.d, 0.8);
        for (let k = 0; k < 3; k++) {
          const x = -o.w / 2 + o.w / 6 + (k * o.w) / 3;
          box('metal', local(base, x, o.h / 2, o.d / 2 + 0.005), o.w / 3 - 0.04, o.h - 0.1, 0.01, 0.8);
          box('broken', local(base, x, o.h * 0.82, o.d / 2 + 0.012), 0.18, 0.06, 0.01);
        }
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d);
        break;
      }
      case 'shelf': {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metal', local(base, sx * (o.w / 2 - 0.03), o.h / 2, sz * (o.d / 2 - 0.03)), 0.05, o.h, 0.05);
        for (let k = 0; k < 4; k++) {
          const y = 0.15 + (k * (o.h - 0.15)) / 3;
          box(k === 3 && o.safe ? 'hazard' : 'metal', local(base, 0, y, 0), o.w, 0.04, o.d, 0.6);
          if (k < 3) for (let n = 0; n < 4; n++) { // frascos e caixas
            const x = -o.w / 2 + 0.2 + n * (o.w - 0.4) / 3;
            if (rnd() < 0.5) cyl('liquid', local(base, x, y + 0.13, (rnd() - 0.5) * 0.2), 0.05, 0.22, 8);
            else box(rnd() < 0.5 ? 'white' : 'crate', local(base, x, y + 0.1, 0), 0.22, 0.18, 0.3, 0.5);
          }
        }
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d);
        break;
      }
      case 'tank': {
        cyl('dark', local(base, 0, 0.15, 0), o.w / 2, 0.3, 16);
        cyl('dark', local(base, 0, o.h - 0.1, 0), o.w / 2, 0.2, 16);
        cyl('liquid', local(base, 0, 1.0, 0), o.w / 2 - 0.06, 1.35, 16);
        cyl('glass', local(base, 0, 1.0, 0), o.w / 2 - 0.02, 1.4, 16);
        box('hazard', local(base, 0, o.h + 0.005, 0), o.w * 0.7, 0.02, o.w * 0.7, 0.5);
        // espécime encolhido lá dentro
        B.specimen.add(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 1.25, 0.9), local(base, 0, 0.95, 0));
        B.specimen.add(new THREE.SphereGeometry(0.11, 10, 8), local(base, 0, 1.25, 0.06));
        B.specimen.add(new THREE.SphereGeometry(0.05, 6, 6).scale(1, 2.4, 1), local(base, 0.14, 0.9, 0.08));
        B.specimen.add(new THREE.SphereGeometry(0.05, 6, 6).scale(1, 2.4, 1), local(base, -0.14, 0.9, 0.08));
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d, surf.glass);
        tall.push(o);
        break;
      }
      case 'rack': {
        box('dark', local(base, 0, o.h / 2, 0), o.w, o.h, o.d, 0.8);
        box('led', local(base, 0, o.h / 2, o.d / 2 + 0.006), o.w - 0.1, o.h - 0.2, 0.01, 0.5);
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d);
        break;
      }
      case 'console': {
        box('dark', local(base, 0, 0.45, 0), o.w, 0.9, o.d, 0.8);
        const tilt = new THREE.Matrix4().makeRotationX(-0.55);
        box('dark', local(base, 0, 1.0, 0.02).multiply(tilt), o.w, 0.04, 0.42);
        box('screen', local(base, 0, 1.02, 0.02).multiply(tilt), o.w - 0.1, 0.01, 0.36);
        box('dark', local(base, 0, 1.25, -o.d / 2 + 0.05), o.w * 0.8, 0.5, 0.06);
        box('screen', local(base, 0, 1.25, -o.d / 2 + 0.085), o.w * 0.75, 0.44, 0.01);
        collider(local(base, 0, 0.55, 0), o.w, 1.1, o.d);
        break;
      }
      case 'table': {
        box('white', local(base, 0, o.h - 0.03, 0), o.w, 0.06, o.d, 1);
        box('accent', local(base, 0, o.h - 0.06, o.d / 2 - 0.01), o.w * 0.96, 0.015, 0.015);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metal', local(base, sx * (o.w / 2 - 0.06), (o.h - 0.06) / 2, sz * (o.d / 2 - 0.06)), 0.05, o.h - 0.06, 0.05);
        box('metal', local(base, 0, 0.25, 0), o.w - 0.1, 0.03, o.d - 0.1, 0.8);
        // equipamentos: microscópio, béqueres, monitor
        const x0 = -o.w / 2 + 0.3;
        cyl('dark', local(base, x0, o.h + 0.02, 0), 0.09, 0.04);
        cyl('dark', local(base, x0, o.h + 0.17, -0.05), 0.025, 0.3, 8);
        box('dark', local(base, x0, o.h + 0.3, 0.02), 0.06, 0.06, 0.16);
        for (let n = 0; n < 3; n++) {
          const x = -0.1 + n * 0.16;
          cyl('glass', local(base, x, o.h + 0.09, 0.12), 0.045, 0.18, 10);
          cyl('liquid', local(base, x, o.h + 0.05, 0.12), 0.04, 0.09, 10);
        }
        box('dark', local(base, o.w / 2 - 0.35, o.h + 0.2, -0.15), 0.42, 0.28, 0.04);
        box('screen', local(base, o.w / 2 - 0.35, o.h + 0.2, -0.128), 0.38, 0.24, 0.005);
        box('dark', local(base, o.w / 2 - 0.35, o.h + 0.03, -0.15), 0.12, 0.06, 0.1);
        collider(local(base, 0, o.h / 2, 0), o.w, o.h, o.d);
        break;
      }
      case 'stairs': {
        // sobe no sentido +z local; degraus maciços
        const n = 7, rise = o.h / n, run = o.d / n;
        for (let k = 0; k < n; k++) {
          const hgt = rise * (k + 1);
          const z = -o.d / 2 + run * (k + 0.5);
          box('grate', local(base, 0, hgt / 2, z), o.w, hgt, run, 0.6);
          box('hazard', local(base, 0, hgt + 0.005, z - run / 2 + 0.04), o.w, 0.012, 0.07, 0.3);
          collider(local(base, 0, hgt / 2, z), o.w, hgt, run);
        }
        for (const sx of [-1, 1]) { // corrimão
          const rail = local(base, sx * (o.w / 2 + 0.03), o.h / 2 + 0.9, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(o.h, o.d)));
          box('metal', rail, 0.04, 0.04, Math.hypot(o.h, o.d));
        }
        break;
      }
      case 'mezz': {
        const y = o.h;
        box('grate', local(base, 0, y - 0.075, 0), o.w, 0.15, o.d, 0.6);
        collider(local(base, 0, y - 0.075, 0), o.w, 0.15, o.d);
        box('hazard', local(base, 0, y - 0.075, o.d / 2 + 0.005), o.w, 0.15, 0.01, 0.4);
        // grade de proteção na frente (abertura do lado da escada)
        const railLen = o.w - 1.1;
        const rx = -0.55;
        box('metal', local(base, rx, y + 0.95, o.d / 2 - 0.03), railLen, 0.05, 0.05);
        collider(local(base, rx, y + 0.95, o.d / 2 - 0.03), railLen, 0.05, 0.05);
        box('metal', local(base, rx, y + 0.5, o.d / 2 - 0.03), railLen, 0.03, 0.03);
        for (let k = 0; k <= 5; k++) box('metal', local(base, rx - railLen / 2 + (k * railLen) / 5, y + 0.48, o.d / 2 - 0.03), 0.04, 0.95, 0.04);
        for (const sx of [-1, 1]) box('dark', local(base, sx * (o.w / 2 - 0.15), (y - 0.15) / 2, o.d / 2 - 0.1), 0.12, y - 0.15, 0.12);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- elevadores
  const elevParts = {};
  for (const which of ['start', 'exit']) {
    const r = which === 'start' ? st.startRect : st.exitRect;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
    const doorZ = which === 'start' ? r.z0 : r.z1;      // linha da porta
    const backZ = which === 'start' ? r.z1 : r.z0;
    const inward = which === 'start' ? 1 : -1;           // do lado da porta para dentro
    box('grate', mat4(cx, 0.01, cz), w - 0.35, 0.02, d - 0.35, 0.6);
    box('hazard', mat4(cx, 0.015, doorZ + inward * 0.25), w - 0.35, 0.02, 0.3, 0.4);
    box('dark', mat4(cx, WALL_H - 0.35, doorZ), w, 0.5, 0.36);          // viga da porta
    box('hazard', mat4(cx, WALL_H - 0.35, doorZ - inward * 0.185), w, 0.3, 0.01, 0.4);
    for (const sx of [-1, 1]) box('dark', mat4(cx + sx * (w / 2 - 0.12), WALL_H / 2, doorZ), 0.24, WALL_H, 0.4);
    // corrimãos nas laterais e no fundo
    for (const sx of [-1, 1]) box('metal', mat4(cx + sx * (w / 2 - 0.22), 0.95, cz), 0.05, 0.05, d - 0.6);
    box('metal', mat4(cx, 0.95, backZ - inward * 0.22), w - 0.6, 0.05, 0.05);
    // painel de botões
    box('dark', mat4(cx + w / 2 - 0.25, 1.35, doorZ + inward * 0.5, Math.PI / 2), 0.35, 0.6, 0.06);
    elevParts[which] = { cx, cz, w, d, doorZ, backZ, inward, r };
  }
  // placa do andar dentro do elevador de saída + portas que abrem
  const ex = elevParts.exit;
  const nextFloorName = FLOORS[floorIndex + 1]?.name || 'SUPERFÍCIE';
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), M(new THREE.MeshBasicMaterial({ map: M(signTexture([`▲ ${nextFloorName.toUpperCase()}`, 'ELEVADOR DE SAÍDA'], '#ff5a4a')), transparent: true })));
  exitSign.position.set(ex.cx, WALL_H - 0.9, ex.doorZ + 0.21);
  group.add(exitSign);
  const startSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), M(new THREE.MeshBasicMaterial({ map: M(signTexture(['ZONA SEGURA', `ANDAR ${floorIndex + 1} · ${theme.name.toUpperCase()}`], '#' + accent.getHexString())), transparent: true })));
  const sp = elevParts.start;
  startSign.position.set(sp.cx, WALL_H - 0.9, sp.doorZ - 0.21);
  startSign.rotation.y = Math.PI;
  group.add(startSign);

  const doorMat = M(new THREE.MeshLambertMaterial({ map: T.metal, color: 0x8b939b }));
  const doors = [];
  const doorColliders = [];
  for (const sx of [-1, 1]) {
    const dw = ex.w / 2 - 0.12;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(dw, WALL_H - 0.6, 0.12), doorMat);
    disposables.push(mesh.geometry);
    const closedX = ex.cx + sx * (dw / 2);
    mesh.position.set(closedX, (WALL_H - 0.6) / 2, ex.doorZ);
    group.add(mesh);
    doors.push({ mesh, closedX, openX: closedX + sx * (dw - 0.1), sx });
    const c = physics.addBox(new THREE.Vector3(closedX, (WALL_H - 0.6) / 2, ex.doorZ), new THREE.Vector3(dw / 2, (WALL_H - 0.6) / 2, 0.08), null, surf.metal);
    doorColliders.push(c);
  }
  // listra de status acima da porta (vermelha = trancada, verde = aberta)
  const statusMat = M(new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  const status = new THREE.Mesh(new THREE.BoxGeometry(ex.w - 0.6, 0.08, 0.04), statusMat);
  disposables.push(status.geometry);
  status.position.set(ex.cx, WALL_H - 0.66, ex.doorZ + 0.2);
  group.add(status);

  // placas dos laboratórios (penduradas no teto)
  for (const room of st.rooms) {
    const tex = M(signTexture([room.name, theme.name.toUpperCase()], '#' + accent.getHexString()));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), M(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })));
    sign.position.set(room.cx, WALL_H - 0.7, room.cz + (room.mezz ? 0.9 : 0));
    group.add(sign);
    box('metal', mat4(room.cx - 0.4, WALL_H - 0.25, room.cz + (room.mezz ? 0.9 : 0)), 0.02, 0.5, 0.02);
    box('metal', mat4(room.cx + 0.4, WALL_H - 0.25, room.cz + (room.mezz ? 0.9 : 0)), 0.02, 0.5, 0.02);
  }

  for (const [k, b] of Object.entries(B)) {
    const mesh = b.mesh(mats[k]);
    if (mesh) { mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh); disposables.push(mesh.geometry); }
  }

  // ---------------------------------------------------------------- luzes
  const lights = [];
  for (const P of st.pointLights) {
    const color = P.kind === 'start' ? accent : P.kind === 'exit' ? new THREE.Color(0xff3020) : P.kind === 'alarm' ? new THREE.Color(0xff2010) : new THREE.Color(0xb8d4ff);
    const intensity = P.kind === 'lab' ? 7 : P.kind === 'alarm' ? 5 : 9;
    const L = new THREE.PointLight(color, intensity, P.kind === 'lab' ? 11 : 9, 1.6);
    L.position.set(P.x, WALL_H - 0.5, P.z);
    group.add(L);
    lights.push({ L, P, base: intensity, t: rnd() * 10 });
  }

  // ---------------------------------------------------------------- amostras
  const sampleMeshes = new Map();
  const vialGlass = M(new THREE.MeshLambertMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.35, depthWrite: false }));
  const vialLiquid = M(new THREE.MeshBasicMaterial({ color: 0x38c8ff }));
  const haloTex = M(canvasTex(64, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(120,220,255,0.9)'); grd.addColorStop(1, 'rgba(120,220,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }, false));
  for (const s of st.samples) {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12), vialGlass);
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.13, 12), vialLiquid);
    liquid.position.y = -0.03;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), mats.dark);
    cap.position.y = 0.12;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.set(0.7, 0.7, 1);
    g.add(glass, liquid, cap, halo);
    g.position.set(s.x, s.y + 0.1, s.z);
    g.userData.baseY = s.y + 0.1;
    group.add(g);
    disposables.push(glass.geometry, liquid.geometry, cap.geometry, halo.material);
    sampleMeshes.set(s.id, g);
  }

  let exitOpen = false, doorT = 0, time = 0;
  return {
    group,
    sampleMeshes,
    boardPos: new THREE.Vector3(sp.cx + 0.6, 0, sp.backZ - 0.22),
    npcPos: new THREE.Vector3(sp.cx - sp.w / 2 + 0.75, 0, sp.doorZ + 0.75),
    setExitOpen(v) {
      exitOpen = v;
      statusMat.color.set(v ? 0x2bff7a : 0xff2a1a);
      const L = lights.find((l) => l.P.kind === 'exit');
      if (L) L.L.color.set(v ? 0x2bff7a : 0xff3020);
    },
    collectSample(id) {
      const g = sampleMeshes.get(id);
      if (g) g.visible = false;
    },
    update(dt) {
      time += dt;
      doorT += (exitOpen ? 1 : -1) * dt / 1.6;
      doorT = Math.max(0, Math.min(1, doorT));
      const e = doorT * doorT * (3 - 2 * doorT);
      for (const d of doors) d.mesh.position.x = d.closedX + (d.openX - d.closedX) * e;
      for (const c of doorColliders) c.enabled = doorT < 0.6;
      for (const f of flickers) {
        f.t -= dt;
        if (f.t < 0) f.t = Math.random() < 0.15 ? 0.05 + Math.random() * 0.1 : 0.4 + Math.random() * 2.5;
        f.mat.color.setScalar(f.t < 0.15 ? 0.08 : 0.92);
      }
      for (const l of lights) {
        if (l.P.kind === 'alarm') l.L.intensity = l.base * (0.25 + 0.75 * Math.max(0, Math.sin(time * 3.2 + l.t)));
        else if (l.P.flicker) { l.t -= dt; if (l.t < 0) l.t = Math.random() < 0.2 ? 0.06 : 0.3 + Math.random() * 3; l.L.intensity = l.t < 0.1 ? l.base * 0.1 : l.base; }
      }
      for (const g of sampleMeshes.values()) {
        if (!g.visible) continue;
        g.rotation.y += dt * 1.6;
        g.position.y = g.userData.baseY + Math.sin(time * 2.4) * 0.03;
      }
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose?.();
    },
  };
}
