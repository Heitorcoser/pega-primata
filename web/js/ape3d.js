// Babuínos da Estação Zero: modelo procedural + animação procedural.
// Anatomia de babuíno: focinho longo, sobrancelha pesada, juba nos ombros, braços longos,
// anda de quatro apoiado nos nós dos dedos (IK de 2 ossos em cada membro, pés plantados).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ materiais
const matCache = new Map();
function furTexture(base, tip) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const b = new THREE.Color(base), t = new THREE.Color(tip);
  g.fillStyle = '#' + b.getHexString(); g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 1800; k++) { // fios de pelo
    const mix = Math.random();
    const col = b.clone().lerp(t, mix * mix).multiplyScalar(0.75 + Math.random() * 0.4);
    g.strokeStyle = '#' + col.getHexString();
    g.globalAlpha = 0.5 + Math.random() * 0.5;
    g.lineWidth = 0.6 + Math.random() * 1.2;
    const x = Math.random() * 128, y = Math.random() * 128, len = 4 + Math.random() * 9;
    const a = Math.PI / 2 + (Math.random() - 0.5) * 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// pelo com brilho na borda (rim light) — dá a sensação "fofa" do pelo contra a luz
function furMat(base, tip, rim) {
  const tex = furTexture(base, tip);
  // a própria textura de fios vira relevo (bump): o pelo deixa de parecer plástico liso
  const m = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.2, color: 0x6e6e6e, roughness: 1, metalness: 0 });
  const rimColor = new THREE.Color(rim);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: rimColor };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += rimColor * pow(rimF, 3.0) * 0.22;`);
  };
  return m;
}
function materials(v) {
  if (matCache.has(v.kind)) return matCache.get(v.kind);
  const m = {
    fur: furMat(v.fur, v.furTip, v.furTip),
    mane: furMat(v.mane, v.furTip, v.furTip),
    skin: new THREE.MeshStandardMaterial({ color: v.skin, roughness: 0.85 }),
    muzzle: new THREE.MeshStandardMaterial({ color: v.muzzle, roughness: 0.8 }),
    cheek: new THREE.MeshStandardMaterial({ color: v.cheek || v.muzzle, roughness: 0.6 }),
    nose: new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.7 }),
    socket: new THREE.MeshBasicMaterial({ color: 0x050303 }),
    eye: new THREE.MeshBasicMaterial({ color: v.eyes }),
    teeth: new THREE.MeshStandardMaterial({ color: 0xe8dfc4, roughness: 0.35 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x4a1212, roughness: 0.6 }),
    nail: new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: 0.5 }),
  };
  matCache.set(v.kind, m);
  return m;
}

const glowCache = new Map();
function glowMaterial(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(255,255,230,1)`); grd.addColorStop(0.18, `rgba(${rgb},0.95)`); grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  glowCache.set(color, m);
  return m;
}

const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const segGeo = (r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1); g.translate(0, 0.5, 0); return g; };
const coneGeo = new THREE.ConeGeometry(1, 1, 6);

function blob(mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(sphereGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

// ------------------------------------------------------------------ junção de malhas
function mergeGeos(parts) {
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let ov = 0, oi = 0;
  for (const [g, m] of parts) {
    nm.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let k = 0; k < P.count; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(m); pos[(ov + k) * 3] = v.x; pos[(ov + k) * 3 + 1] = v.y; pos[(ov + k) * 3 + 2] = v.z;
      v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor[(ov + k) * 3] = v.x; nor[(ov + k) * 3 + 1] = v.y; nor[(ov + k) * 3 + 2] = v.z;
      if (U) { uv[(ov + k) * 2] = U.getX(k); uv[(ov + k) * 2 + 1] = U.getY(k); }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.getX(k) + ov;
    else for (let k = 0; k < P.count; k++) idx[oi + k] = ov + k;
    ov += P.count; oi += g.index ? g.index.count : P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// junta os filhos (tufos) na própria malha; filhos de outro material viram 1 malha por material
function bakeChildren(mesh) {
  const byMat = new Map();
  for (const c of [...mesh.children]) {
    if (!c.isMesh) continue;
    c.updateMatrix();
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push([c.geometry, c.matrix.clone()]);
    mesh.remove(c);
  }
  for (const [mat, parts] of byMat) {
    if (mat === mesh.material) mesh.geometry = mergeGeos([[mesh.geometry, new THREE.Matrix4()], ...parts]);
    else mesh.add(new THREE.Mesh(mergeGeos(parts), mat));
  }
}
// junta todas as malhas estáticas de um grupo (no espaço do grupo), exceto as listadas
function bakeGroup(group, keep) {
  const byMat = new Map();
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const victims = [];
  group.traverse((o) => {
    if (o === group || !o.isMesh) return;
    for (let p = o; p && p !== group; p = p.parent) if (keep.includes(p)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push([o.geometry, m]);
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  // remove grupos intermediários que ficaram vazios
  for (const c of [...group.children]) if (!c.isMesh && !c.isSprite && !keep.includes(c) && c.children.length === 0) group.remove(c);
  for (const [mat, parts] of byMat) group.add(new THREE.Mesh(mergeGeos(parts), mat));
}

// IK de 2 ossos: raiz A, alvo C, comprimentos l1/l2, vetor "polo" (para onde dobra)
const _ikd = new THREE.Vector3();
function solveIK(A, C, l1, l2, pole, outB, outC) {
  const d = _ikd.copy(C).sub(A);
  let len = d.length();
  const maxL = (l1 + l2) * 0.999, minL = Math.abs(l1 - l2) + 0.01;
  len = Math.min(maxL, Math.max(minL, len));
  d.normalize();
  outC.copy(A).addScaledVector(d, len);
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  outB.copy(A).addScaledVector(d, a).addScaledVector(p, h);
}

function placeSeg(mesh, a, b) {
  const dir = _d.copy(b).sub(a);
  const len = dir.length();
  mesh.position.copy(a);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
  mesh.scale.set(1, Math.max(len, 1e-3), 1);
}
const _d = new THREE.Vector3();

const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// ------------------------------------------------------------------ modelo
export class Ape {
  constructor(variant) {
    this.v = variant;
    const M = materials(variant);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.root.scale.setScalar(variant.scale || 1);

    // tronco: peito fundo e comprido, cintura fina, quadril menor
    this.hips = blob(M.fur, 0.165, 0.17, 0.19);
    this.chest = blob(M.fur, 0.24, 0.27, 0.3);
    this.belly = new THREE.Mesh(segGeo(0.15, 0.21), M.fur);
    this.mane = [blob(M.mane, 0.23, 0.19, 0.24), blob(M.mane, 0.16, 0.19, 0.2), blob(M.mane, 0.16, 0.19, 0.2), blob(M.mane, 0.19, 0.17, 0.17)];
    this.neck = new THREE.Mesh(segGeo(0.13, 0.1), M.mane);
    this.body.add(this.hips, this.chest, this.belly, this.neck, ...this.mane);
    // tufos de pelo: quebram o contorno "de bola" e dão a cara de pelagem desgrenhada
    const tufts = (parent, mat, n, len, back) => {
      for (let k = 0; k < n; k++) {
        const u = Math.random() * Math.PI * 2, w = Math.acos(1 - Math.random() * 1.6); // mais no topo/costas
        const dir = new THREE.Vector3(Math.sin(w) * Math.cos(u), Math.cos(w), Math.sin(w) * Math.sin(u) - back * 0.6).normalize();
        const t = new THREE.Mesh(coneGeo, mat);
        t.position.copy(dir).multiplyScalar(0.85);
        const out = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, -0.35, -back * 1.4)).normalize(); // penteado para trás
        t.quaternion.setFromUnitVectors(UP, out);
        const l = len * (0.6 + Math.random() * 0.7);
        t.scale.set(l * 0.28, l, l * 0.28);
        parent.add(t);
      }
    };
    for (const m of this.mane) tufts(m, M.mane, 11, 1.0, 0.9);
    tufts(this.chest, M.fur, 7, 0.8, 1.0);
    tufts(this.hips, M.fur, 4, 0.6, 0.8);

    // cabeça (frente = +z)
    this.head = new THREE.Group();
    const H = this.head;
    const cranium = blob(M.fur, 0.135, 0.12, 0.15, 0, 0.035, -0.04);   // crânio baixo e comprido
    tufts(cranium, M.mane, 10, 0.55, 0.9);
    H.add(cranium);
    H.add(blob(M.fur, 0.125, 0.045, 0.06, 0, 0.07, 0.09));              // sobrancelha pesada
    H.add(blob(M.skin, 0.085, 0.055, 0.05, 0, 0.02, 0.105));            // máscara de pele em volta dos olhos
    // focinho longo e afunilado de pele escura (babuíno), com a ponta arredondada
    const snoutGeo = new THREE.CylinderGeometry(0.046, 0.07, 0.24, 16, 1);
    snoutGeo.rotateX(Math.PI / 2);
    const snout = new THREE.Mesh(snoutGeo, M.muzzle);
    snout.scale.set(1, 0.82, 1);
    snout.position.set(0, -0.035, 0.22);
    snout.rotation.x = 0.16;
    H.add(snout);
    H.add(blob(M.muzzle, 0.042, 0.033, 0.03, 0, -0.05, 0.335));        // ponta do focinho
    H.add(blob(M.fur, 0.06, 0.022, 0.12, 0, 0.0, 0.2));                 // pelo no dorso do focinho
    H.add(blob(M.nose, 0.034, 0.02, 0.012, 0, -0.038, 0.368));         // ponta do nariz
    for (const sx of [-1, 1]) H.add(blob(M.socket, 0.006, 0.004, 0.004, sx * 0.013, -0.03, 0.378)); // narinas
    if (variant.cheek) { // mandril: sulcos azuis nas laterais do focinho + faixa vermelha
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const r = blob(M.cheek, 0.012, 0.035, 0.1, sx * (0.058 + k * 0.006), -0.03 - k * 0.012, 0.21);
          r.rotation.x = 0.14;
          H.add(r);
        }
      }
      H.add(blob(M.muzzle, 0.03, 0.02, 0.15, 0, 0.012, 0.22));
    }
    this.eyeGlows = [];
    for (const sx of [-1, 1]) {
      H.add(blob(M.socket, 0.026, 0.02, 0.016, sx * 0.042, 0.028, 0.142)); // órbita funda sob a sobrancelha
      H.add(blob(M.eye, 0.012, 0.011, 0.008, sx * 0.042, 0.027, 0.152));
      // brilho dos olhos: no escuro do corredor, você vê os olhos antes do corpo
      const glow = new THREE.Sprite(glowMaterial(variant.eyes));
      glow.position.set(sx * 0.042, 0.027, 0.16);
      glow.scale.setScalar(0.07);
      H.add(glow);
      this.eyeGlows.push(glow);
      H.add(blob(M.skin, 0.022, 0.038, 0.012, sx * 0.125, 0.04, -0.05));   // orelha pequena
      const cheek = blob(M.mane, 0.07, 0.1, 0.11, sx * 0.1, -0.05, 0.03); // costeleta
      tufts(cheek, M.mane, 6, 0.6, 0.8);
      H.add(cheek);
    }
    // dentes de cima: caninos longos + fileira, com gengiva
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(coneGeo, M.teeth);
      c.scale.set(0.011, 0.065, 0.011);
      c.rotation.x = Math.PI;
      c.position.set(sx * 0.03, -0.084, 0.29);
      H.add(c);
      for (let k = 0; k < 3; k++) { // pré-molares para trás
        const t = new THREE.Mesh(coneGeo, M.teeth);
        t.scale.set(0.008, 0.025, 0.008);
        t.rotation.x = Math.PI;
        t.position.set(sx * (0.036 + k * 0.004), -0.072, 0.25 - k * 0.035);
        H.add(t);
      }
    }
    for (let k = 0; k < 4; k++) { // incisivos
      const t = new THREE.Mesh(coneGeo, M.teeth);
      t.scale.set(0.007, 0.022, 0.007);
      t.rotation.x = Math.PI;
      t.position.set(-0.015 + k * 0.01, -0.074, 0.318);
      H.add(t);
    }
    H.add(blob(M.mouth, 0.045, 0.012, 0.11, 0, -0.064, 0.22)); // gengiva
    H.add(blob(M.mouth, 0.045, 0.025, 0.12, 0, -0.075, 0.2));
    // mandíbula articulada
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.07, 0.06);
    this.jaw.add(blob(M.muzzle, 0.05, 0.028, 0.15, 0, -0.012, 0.14));
    const beard = blob(M.mane, 0.07, 0.045, 0.1, 0, -0.035, 0.06);
    tufts(beard, M.mane, 5, 0.6, -0.2);
    this.jaw.add(beard);
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(coneGeo, M.teeth);
      c.scale.set(0.009, 0.045, 0.009);
      c.position.set(sx * 0.03, 0.022, 0.23);
      this.jaw.add(c);
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(coneGeo, M.teeth);
        t.scale.set(0.007, 0.02, 0.007);
        t.position.set(sx * (0.032 + k * 0.003), 0.012, 0.19 - k * 0.035);
        this.jaw.add(t);
      }
    }
    this.jaw.add(blob(M.mouth, 0.04, 0.012, 0.11, 0, 0.004, 0.15)); // gengiva de baixo / língua
    H.add(this.jaw);
    this.body.add(H);

    // membros
    const limb = (r0, r1, r2, r3) => ({ upper: new THREE.Mesh(segGeo(r0, r1), M.fur), lower: new THREE.Mesh(segGeo(r1 * 0.95, r2), M.fur), joint: blob(M.fur, r1, r1, r1), end: null, r3 });
    this.arms = [limb(0.085, 0.07, 0.055), limb(0.085, 0.07, 0.055)];
    this.legs = [limb(0.095, 0.075, 0.055), limb(0.095, 0.075, 0.055)];
    for (const a of this.arms) {
      // mão em punho (anda nos nós dos dedos)
      const hand = new THREE.Group();
      // (o +Y local da mão segue o antebraço, do cotovelo para o punho)
      hand.add(blob(M.skin, 0.055, 0.045, 0.07, 0, 0.04, 0.01));
      for (let k = 0; k < 4; k++) hand.add(blob(M.skin, 0.016, 0.018, 0.02, -0.036 + k * 0.024, 0.075, 0.04));
      hand.add(blob(M.fur, 0.058, 0.05, 0.06, 0, 0.005, 0));
      a.end = hand;
      this.body.add(a.upper, a.lower, a.joint, hand);
    }
    for (const l of this.legs) {
      const foot = new THREE.Group();
      foot.add(blob(M.skin, 0.05, 0.035, 0.11, 0, -0.04, 0.06));
      for (let k = 0; k < 4; k++) foot.add(blob(M.nail, 0.012, 0.01, 0.016, -0.03 + k * 0.02, -0.055, 0.165));
      l.end = foot;
      this.body.add(l.upper, l.lower, l.joint, foot);
    }
    this.tail = [new THREE.Mesh(segGeo(0.05, 0.04), M.fur), new THREE.Mesh(segGeo(0.04, 0.03), M.fur), new THREE.Mesh(segGeo(0.03, 0.015), M.fur)];
    this.body.add(...this.tail);

    // desempenho: une as peças que não se mexem entre si (tufos, cabeça, mãos, pés)
    for (const m of [this.chest, this.hips, ...this.mane]) bakeChildren(m);
    bakeGroup(this.jaw, []);
    bakeGroup(this.head, [this.jaw, ...this.eyeGlows]);
    for (const l of [...this.arms, ...this.legs]) bakeGroup(l.end, []);
    this.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

    // estado da animação
    this.phase = Math.random();
    this.run = 0;
    this.move = 0;
    this.rear = 0;
    this.jawOpen = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.time = Math.random() * 10;
    this.swing = [false, false, false, false];
    this.onStep = null; // (posiçãoMundo, força) => som de passo
    this._tmp = { A: v3(), B: v3(), C: v3(), P: v3(), T: v3() };
    this._inv = new THREE.Quaternion();
    this._lookLocal = v3();
  }

  // speed (m/s), state (STATE da IA), look (Vector3 no mundo ou null)
  update(dt, speed, state, look) {
    const s = this.v.scale || 1;
    this.time += dt;
    const sp = speed / s;
    this.move = smooth(this.move, Math.min(1, sp / 0.5), 6, dt);
    this.run = smooth(this.run, THREE.MathUtils.smoothstep(sp, 1.8, 3.0), 4, dt);
    const rearTarget = state === 4 || state === 5 ? 1 : 0; // wait / attack
    this.rear = smooth(this.rear, rearTarget, state === 5 ? 10 : 4, dt);
    const run = this.run, mv = this.move * (1 - this.rear), rear = this.rear;

    const stride = THREE.MathUtils.lerp(0.75, 1.55, run);
    const duty = THREE.MathUtils.lerp(0.62, 0.42, run);
    this.phase = (this.phase + (sp / stride) * dt) % 1;
    const ph = this.phase;

    // postura: corrida = mais baixo e esticado; empinado = em pé nas patas de trás
    const bob = Math.sin(ph * Math.PI * 4) * (0.02 + 0.035 * run) * mv;
    const breath = Math.sin(this.time * (2 + run * 3)) * 0.012;
    const hips = v3(0, 0.6 - 0.04 * run + bob * 0.7, -0.28);
    const chest = v3(0, 0.84 - 0.08 * run + bob, 0.22 + 0.05 * run);
    hips.lerp(v3(0, 0.6, -0.2), rear);
    chest.lerp(v3(0, 1.3, 0.0), rear);
    this.hips.position.copy(hips);
    this.chest.position.copy(chest);
    this.chest.scale.set(0.29 * (1 + breath), 0.27 * (1 + breath), 0.26);
    placeSeg(this.belly, hips, chest);
    // juba sobre os ombros e nuca
    this.mane[0].position.copy(chest).add(v3(0, 0.1, -0.02));
    this.mane[1].position.copy(chest).add(v3(-0.17, 0.06, 0.02));
    this.mane[2].position.copy(chest).add(v3(0.17, 0.06, 0.02));
    this.mane[3].position.copy(chest).add(v3(0, 0.12, 0.14));
    const neckBase = v3().copy(chest).add(v3(0, 0.1, 0.16 - 0.1 * rear));
    const headPos = v3().copy(neckBase).add(v3(0, 0.1 + 0.05 * rear, 0.17 - 0.08 * rear));
    placeSeg(this.neck, neckBase, headPos);
    this.head.position.copy(headPos);
    this.body.rotation.z = Math.sin(ph * Math.PI * 2) * 0.03 * mv;

    // cabeça olha para o alvo (limites de pescoço)
    let yawT = 0, pitchT = -0.12 - 0.15 * run;
    if (look) {
      this.root.updateMatrixWorld();
      const hp = this.head.getWorldPosition(this._tmp.T);
      this._inv.copy(this.root.quaternion).invert();
      const L = this._lookLocal.copy(look).sub(hp).applyQuaternion(this._inv);
      yawT = Math.atan2(L.x, L.z);
      pitchT = Math.atan2(L.y, Math.hypot(L.x, L.z));
    }
    if (state === 3) yawT += Math.sin(this.time * 2.2) * 0.9; // procurando: olha para os lados
    yawT = THREE.MathUtils.clamp(yawT, -1.1, 1.1);
    pitchT = THREE.MathUtils.clamp(pitchT, -0.7, 0.75);
    this.headYaw = smooth(this.headYaw, yawT, 6, dt);
    this.headPitch = smooth(this.headPitch, pitchT, 6, dt);
    this.head.rotation.set(-this.headPitch, this.headYaw, Math.sin(this.time * 1.3) * 0.04, 'YXZ');

    // mandíbula: rosna na perseguição, escancara no ataque
    const jawT = state === 5 ? 0.8 : state === 4 ? 0.45 + Math.sin(this.time * 7) * 0.15 : state === 1 ? 0.28 + Math.sin(this.time * 9) * 0.12 : 0.05 + breath * 2;
    this.jawOpen = smooth(this.jawOpen, jawT, 10, dt);
    this.jaw.rotation.x = this.jawOpen * 0.7;
    const angry = state === 1 || state === 4 || state === 5;
    for (const g of this.eyeGlows) g.scale.setScalar(angry ? 0.085 + Math.sin(this.time * 12) * 0.012 : 0.06);

    // membros: alvo dos pés pela marcha (sequência lateral andando, galope correndo)
    const offWalk = [0, 0.5, 0.75, 0.25], offRun = [0, 0.12, 0.55, 0.67];
    const lift = THREE.MathUtils.lerp(0.1, 0.2, run);
    const T = this._tmp;
    const limbs = [
      { L: this.arms[0], side: -1, front: true, k: 0 }, { L: this.arms[1], side: 1, front: true, k: 1 },
      { L: this.legs[0], side: -1, front: false, k: 2 }, { L: this.legs[1], side: 1, front: false, k: 3 },
    ];
    for (const { L, side, front, k } of limbs) {
      const off = THREE.MathUtils.lerp(offWalk[k], offRun[k], run);
      const p = (ph + off) % 1;
      const neutral = front ? v3(side * 0.3, 0, 0.44 + 0.08 * run) : v3(side * 0.17, 0, -0.32);
      let fz, fy = 0;
      const stance = p < duty;
      if (stance) fz = (0.5 - p / duty) * stride * duty;
      else { const q = (p - duty) / (1 - duty); fz = (-0.5 + q) * stride * duty; fy = Math.sin(q * Math.PI) * lift; }
      const foot = v3(neutral.x, neutral.y + fy * mv, neutral.z + fz * mv);
      // som de passo quando a pata toca o chão
      if (this.swing[k] && stance && mv > 0.3 && this.onStep) { this.root.updateMatrixWorld(); this.onStep(this.root.localToWorld(foot.clone()), run, front); }
      this.swing[k] = !stance;

      if (front) {
        const shoulder = v3().copy(chest).add(v3(side * 0.24, 0.03, 0.04));
        // empinado: braços para cima/frente, golpeando
        const swipe = Math.sin(this.time * (state === 5 ? 14 : 5) + side) * 0.12;
        const up = v3(side * 0.34, 1.42 + swipe, 0.4 + (state === 5 ? 0.15 : 0));
        foot.lerp(up, rear);
        const wrist = v3().copy(foot).add(v3(0, 0.08, 0));
        const pole = v3(side * 0.35, -0.2 * rear, -1 + rear * 0.6);
        solveIK(shoulder, wrist, 0.42, 0.4, pole, T.B, T.C);
        placeSeg(L.upper, shoulder, T.B);
        placeSeg(L.lower, T.B, T.C);
        L.joint.position.copy(T.B);
        L.end.position.copy(T.C);
        L.end.quaternion.copy(L.lower.quaternion);
      } else {
        const hip = v3().copy(hips).add(v3(side * 0.15, -0.04, 0));
        const ankle = v3().copy(foot).add(v3(0, 0.07, 0));
        solveIK(hip, ankle, 0.34, 0.32, v3(side * 0.25, 0.1, 1), T.B, T.C);
        placeSeg(L.upper, hip, T.B);
        placeSeg(L.lower, T.B, T.C);
        L.joint.position.copy(T.B);
        L.end.position.copy(T.C);
        L.end.rotation.set(0, 0, 0);
      }
    }

    // cauda de babuíno: sobe e cai em arco, balançando
    const tb = v3().copy(hips).add(v3(0, 0.05, -0.16));
    const sw = Math.sin(this.time * 2 + ph * 6) * 0.06;
    const t1 = v3(sw, 0.2 - 0.1 * rear, -0.12).add(tb);
    const t2 = v3(sw * 2, 0.08, -0.16).add(t1);
    const t3 = v3(sw * 3, -0.2, -0.06).add(t2);
    placeSeg(this.tail[0], tb, t1); placeSeg(this.tail[1], t1, t2); placeSeg(this.tail[2], t2, t3);
  }
}
