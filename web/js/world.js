// Mapa original "Ruínas do Cipó": templo em degraus, pilares, plataformas, árvores e gelo.
// Gerado com semente fixa para todos os jogadores verem o mesmo mapa.
import * as THREE from 'three';

export const SURFACES = {
  grass: { name: 'grass', color: 0x5d9b3a },
  stone: { name: 'stone', color: 0xa39c8e },
  darkstone: { name: 'stone', color: 0x7b766c },
  moss: { name: 'stone', color: 0x7f9a5a },
  wood: { name: 'wood', color: 0x8a5a34 },
  leaves: { name: 'leaves', color: 0x3c7a2e },
  ice: { name: 'ice', color: 0xbfe8f7, slip: 0.8 },
};

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoiseTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e8e8';
  g.fillRect(0, 0, 128, 128);
  const r = mulberry32(7);
  for (let i = 0; i < 1400; i++) {
    const v = 180 + Math.floor(r() * 75);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const s = 1 + r() * 4;
    g.fillRect(r() * 128, r() * 128, s, s);
  }
  g.strokeStyle = 'rgba(120,120,120,0.35)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// BoxGeometry com UV em escala de mundo (textura não estica)
function boxGeo(sx, sy, sz, tile = 1.5) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

export function buildWorld(scene, physics) {
  const rand = mulberry32(1337);
  const tex = makeNoiseTexture();
  const matCache = new Map();
  const mat = (color) => {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color, map: tex }));
    return matCache.get(color);
  };
  const shade = (hex, amt) => new THREE.Color(hex).offsetHSL(0, 0, amt).getHex();
  const root = new THREE.Group();
  scene.add(root);

  const euler = new THREE.Euler();
  function box(x, y, z, sx, sy, sz, surface, rot = [0, 0, 0], opts = {}) {
    euler.set(rot[0], rot[1], rot[2]);
    const q = new THREE.Quaternion().setFromEuler(euler);
    const color = opts.color ?? shade(surface.color, (rand() - 0.5) * 0.06);
    const m = new THREE.Mesh(boxGeo(sx, sy, sz, opts.tile), mat(color));
    m.position.set(x, y, z);
    m.quaternion.copy(q);
    root.add(m);
    if (opts.collide !== false) physics.addBox(m.position, new THREE.Vector3(sx / 2, sy / 2, sz / 2), q, surface);
    return m;
  }
  function ball(x, y, z, r, surface, opts = {}) {
    const color = opts.color ?? shade(surface.color, (rand() - 0.5) * 0.08);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(color));
    m.position.set(x, y, z);
    root.add(m);
    if (opts.collide !== false) physics.addSphere(m.position, r, surface);
    return m;
  }

  const S = SURFACES;

  // chão
  box(0, -0.5, 0, 90, 1, 90, S.grass, [0, 0, 0], { tile: 3, color: S.grass.color });

  // paredões de pedra nas bordas (dá para escalar)
  const W = 40;
  box(0, 6, -W, 82, 14, 2, S.darkstone);
  box(0, 6, W, 82, 14, 2, S.darkstone);
  box(-W, 6, 0, 2, 14, 82, S.darkstone);
  box(W, 6, 0, 2, 14, 82, S.darkstone);
  // rochas irregulares encostadas nas bordas
  for (let i = 0; i < 40; i++) {
    const side = i % 4, t = (rand() - 0.5) * 74;
    const s = 1.5 + rand() * 3.5;
    const off = W - 1 - s * 0.4;
    const pos = [[t, -off], [t, off], [-off, t], [off, t]][side];
    box(pos[0], s * 0.35, pos[1], s, s * (0.8 + rand()), s, S.darkstone, [rand() * 0.5, rand() * 3, rand() * 0.5]);
  }

  // templo em degraus (centro)
  const stepH = 0.9;
  [12, 9, 6, 3.2].forEach((size, i) => {
    box(0, stepH / 2 + i * stepH, 0, size, stepH, size, i % 2 ? S.moss : S.stone, [0, 0, 0], { color: shade(S.stone.color, -i * 0.03) });
  });
  // altar no topo
  box(0, 4 * stepH + 0.25, 0, 1.4, 0.5, 1.4, S.darkstone);
  // portais no templo
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const cx = Math.sin(a) * 4.6, cz = Math.cos(a) * 4.6;
    const px = Math.cos(a) * 0.9, pz = -Math.sin(a) * 0.9;
    box(cx + px, stepH + 0.9, cz + pz, 0.4, 1.8, 0.4, S.stone);
    box(cx - px, stepH + 0.9, cz - pz, 0.4, 1.8, 0.4, S.stone);
    box(cx, stepH + 1.95, cz, Math.abs(px) * 2 + 0.6 + Math.abs(pz) * 0, 0.3, Math.abs(pz) * 2 + 0.6, S.darkstone, [0, 0, 0]);
  }

  // anel de pilares
  const pillarTops = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rand() * 0.15;
    const r = 13 + rand() * 1.5;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const h = i % 3 === 2 ? 1.2 + rand() * 1.2 : 2.5 + rand() * 4.5;
    const rotY = rand() * Math.PI;
    box(x, h / 2, z, 1.1, h, 1.1, S.stone, [0, rotY, 0]);
    if (i % 3 === 2) {
      // pilar quebrado: pedaço caído ao lado
      box(x + Math.cos(a) * 1.8, 0.55, z - Math.sin(a) * 1.8, 1.1, 1.1, 3.2, S.moss, [0, rotY, 0.1]);
    } else {
      box(x, h + 0.15, z, 1.6, 0.3, 1.6, S.darkstone, [0, rotY, 0]);
      pillarTops.push([x, h + 0.3, z]);
    }
  }
  // vigas de madeira ligando alguns pilares
  for (let i = 0; i + 1 < pillarTops.length; i += 2) {
    const [ax, ay, az] = pillarTops[i], [bx, by, bz] = pillarTops[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const y = Math.min(ay, by) - 0.35;
    box((ax + bx) / 2, y, (az + bz) / 2, 0.35, 0.25, len, S.wood, [0, Math.atan2(dx, dz), 0]);
  }

  // muros quebrados
  for (let i = 0; i < 8; i++) {
    const a = rand() * Math.PI * 2, r = 18 + rand() * 6;
    box(Math.sin(a) * r, 1, Math.cos(a) * r, 4 + rand() * 3, 2 + rand() * 1.5, 0.6, S.stone, [0, a + Math.PI / 2, 0]);
  }

  // plataformas flutuantes
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4, r = 8 + (i % 3) * 5;
    box(Math.sin(a) * r, 3 + (i % 4) * 1.2, Math.cos(a) * r, 2.4, 0.4, 2.4, S.moss, [0, rand(), 0]);
  }

  // árvores (tronco + copa de esferas + galho-plataforma)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.3, r = 24 + rand() * 10;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const h = 6 + rand() * 4;
    box(x, h / 2, z, 0.7, h, 0.7, S.wood, [0, Math.PI / 4, 0]);
    ball(x, h + 0.8, z, 2 + rand() * 0.6, S.leaves);
    ball(x + 1.4, h - 0.4, z + 0.6, 1.4 + rand() * 0.4, S.leaves);
    const ba = rand() * Math.PI * 2;
    box(x + Math.sin(ba) * 1.2, h * 0.5, z + Math.cos(ba) * 1.2, 0.3, 0.25, 2.2, S.wood, [0, ba, 0]);
  }

  // pedras soltas
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, r = 7 + rand() * 28;
    const s = 0.5 + rand() * 1.3;
    box(Math.sin(a) * r, s * 0.3, Math.cos(a) * r, s, s * 0.8, s * 1.1, S.darkstone, [rand(), rand() * 3, rand()]);
  }

  // rampa de gelo (escorrega!)
  box(-22, 1.2, 8, 4, 0.3, 9, S.ice, [0.28, 0, 0], { color: S.ice.color });
  box(-22, 0.25, 13, 5, 0.5, 2, S.ice, [0, 0, 0], { color: S.ice.color });

  // decoração sem colisão: morros ao longe e nuvens
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5f8f5a });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = 75 + rand() * 20;
    const m = new THREE.Mesh(new THREE.ConeGeometry(14 + rand() * 12, 18 + rand() * 20, 7), hillMat);
    m.position.set(Math.sin(a) * r, 6, Math.cos(a) * r);
    root.add(m);
  }
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5 + rand() * 2, 1), cloudMat);
      m.position.set(k * 3 - 4, rand(), rand() * 2);
      m.scale.y = 0.55;
      g.add(m);
    }
    const a = rand() * Math.PI * 2, r = 30 + rand() * 50;
    g.position.set(Math.sin(a) * r, 28 + rand() * 12, Math.cos(a) * r);
    root.add(g);
  }

  // pontos de nascimento (em frente ao quadro, de costas p/ o templo)
  const spawns = [];
  for (let i = 0; i < 10; i++) {
    const a = -1.1 + (i / 9) * 2.2; // arco em volta do templo, longe uns dos outros
    spawns.push(new THREE.Vector3(Math.sin(a) * 8.6, 0.62, Math.cos(a) * 8.6));
  }

  return { root, spawns, boardPos: new THREE.Vector3(0, 0, 10.6) };
}
