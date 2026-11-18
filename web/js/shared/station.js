// "Estação Zero": cada andar é um labirinto de estação científica gerado por semente.
// Módulo compartilhado (navegador + servidor): sem three.js, só dados e geometria 2D.
//
// Grade W×H de células de CELL metros; paredes nas bordas das células, do chão ao teto.
// Elevador de entrada (sul) e de saída (norte) = zonas seguras. A saída só abre com as amostras.

export const CELL = 3;
export const W = 12;
export const H = 12;
export const WALL_H = 3.6;
export const WALL_T = 0.3;
export const SAFE_HEIGHT = 1.55;   // cabeça acima disso (em cima de algo alto) = monstro não alcança
export const MEZZ_H = 1.6;         // altura do mezanino

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HALF_X = (W * CELL) / 2, HALF_Z = (H * CELL) / 2;
export const cellX = (i) => (i + 0.5) * CELL - HALF_X;
export const cellZ = (j) => (j + 0.5) * CELL - HALF_Z;
export const toCellI = (x) => Math.floor((x + HALF_X) / CELL);
export const toCellJ = (z) => Math.floor((z + HALF_Z) / CELL);

export function generateFloor(seed) {
  const rand = mulberry32(seed);
  const ri = (n) => Math.floor(rand() * n);
  const hWall = Array.from({ length: H + 1 }, () => Array(W).fill(true)); // linha z=j, célula i
  const vWall = Array.from({ length: H }, () => Array(W + 1).fill(true)); // linha x=i, célula j

  // elevadores de carga: 2 células cada (6 m × 3 m)
  const ei = 2 + ri(W - 5); // coluna do elevador de entrada
  const xi = 2 + ri(W - 5); // coluna do elevador de saída
  const elevators = {
    start: { i0: ei, i1: ei + 1, j: H - 1, door: 'N' },
    exit: { i0: xi, i1: xi + 1, j: 0, door: 'S' },
  };
  const inElev = (e, i, j) => j === e.j && i >= e.i0 && i <= e.i1;
  const isSafeCell = (i, j) => inElev(elevators.start, i, j) || inElev(elevators.exit, i, j);

  const openBetween = (i, j, a, b) => {
    if (a === i + 1) vWall[j][i + 1] = false;
    else if (a === i - 1) vWall[j][i] = false;
    else if (b === j + 1) hWall[j + 1][i] = false;
    else if (b === j - 1) hWall[j][i] = false;
  };
  const wallBetween = (i, j, a, b) => {
    if (a === i + 1) return vWall[j][i + 1];
    if (a === i - 1) return vWall[j][i];
    if (b === j + 1) return hWall[j + 1][i];
    if (b === j - 1) return hWall[j][i];
    return true;
  };
  const nbrs = (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < H);

  // 1) labirinto (backtracker) só nas células normais
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const start = [ei, H - 2];
  const stack = [start];
  seen[start[1]][start[0]] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = nbrs(i, j).filter(([a, b]) => !seen[b][a] && !isSafeCell(a, b));
    if (!nb.length) { stack.pop(); continue; }
    const [a, b] = nb[ri(nb.length)];
    openBetween(i, j, a, b);
    seen[b][a] = true;
    stack.push([a, b]);
  }
  // 2) laços extras (dá para fugir dando a volta)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (i + 1 < W && !isSafeCell(i, j) && !isSafeCell(i + 1, j) && rand() < 0.17) vWall[j][i + 1] = false;
    if (j + 1 < H && !isSafeCell(i, j) && !isSafeCell(i, j + 1) && rand() < 0.17) hWall[j + 1][i] = false;
  }
  // saguões na frente dos elevadores (2 células abertas)
  vWall[H - 2][ei + 1] = false;
  vWall[1][xi + 1] = false;

  // 3) laboratórios 2×2
  const rooms = [];
  for (let tries = 0; tries < 80 && rooms.length < 6; tries++) {
    const i = ri(W - 1), j = 1 + ri(H - 4);
    const cells = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
    const nearElev = cells.some(([a, b]) => (b >= H - 2 && a >= ei - 1 && a <= ei + 2) || (b <= 1 && a >= xi - 1 && a <= xi + 2));
    if (nearElev || cells.some(([a, b]) => isSafeCell(a, b) || rooms.some((r) => r.cells.some(([c, d]) => Math.abs(c - a) <= 1 && Math.abs(d - b) <= 1)))) continue;
    vWall[j][i + 1] = false; vWall[j + 1][i + 1] = false;
    hWall[j + 1][i] = false; hWall[j + 1][i + 1] = false;
    rooms.push({ i, j, cells, cx: cellX(i) + CELL / 2, cz: cellZ(j) + CELL / 2, name: `LAB-${String(rooms.length + 1).padStart(2, '0')}` });
  }

  // 4) elevadores: abertos por dentro, fechados por fora, porta para o saguão
  for (const e of [elevators.start, elevators.exit]) {
    vWall[e.j][e.i0 + 1] = false;
    vWall[e.j][e.i0] = true; vWall[e.j][e.i1 + 1] = true;
    for (let i = e.i0; i <= e.i1; i++) {
      hWall[e.j][i] = e.door === 'N' ? false : true;
      hWall[e.j + 1][i] = e.door === 'S' ? false : true;
    }
  }

  // 5) conectividade garantida a partir do saguão de entrada
  const reach = () => {
    const ok = Array.from({ length: H }, () => Array(W).fill(false));
    const q = [[ei, H - 1]];
    ok[H - 1][ei] = true;
    while (q.length) {
      const [i, j] = q.shift();
      for (const [a, b] of nbrs(i, j)) if (!ok[b][a] && !wallBetween(i, j, a, b)) { ok[b][a] = true; q.push([a, b]); }
    }
    return ok;
  };
  for (let guard = 0; guard < 300; guard++) {
    const ok = reach();
    let fixed = false;
    for (let j = 0; j < H && !fixed; j++) for (let i = 0; i < W && !fixed; i++) {
      if (ok[j][i] || isSafeCell(i, j)) continue;
      for (const [a, b] of nbrs(i, j)) if (ok[b][a] && !isSafeCell(a, b)) { openBetween(i, j, a, b); fixed = true; break; }
    }
    if (!fixed) break;
  }

  // 6) segmentos de parede
  const walls = [];
  for (let j = 0; j <= H; j++) {
    let s = -1;
    for (let i = 0; i <= W; i++) {
      const on = i < W && hWall[j][i];
      if (on && s < 0) s = i;
      if (!on && s >= 0) { walls.push({ x1: s * CELL - HALF_X, z1: j * CELL - HALF_Z, x2: i * CELL - HALF_X, z2: j * CELL - HALF_Z, dir: 'h' }); s = -1; }
    }
  }
  for (let i = 0; i <= W; i++) {
    let s = -1;
    for (let j = 0; j <= H; j++) {
      const on = j < H && vWall[j][i];
      if (on && s < 0) s = j;
      if (!on && s >= 0) { walls.push({ x1: i * CELL - HALF_X, z1: s * CELL - HALF_Z, x2: i * CELL - HALF_X, z2: j * CELL - HALF_Z, dir: 'v' }); s = -1; }
    }
  }

  // 7) estruturas e objetos
  const props = [];
  const used = new Set();
  const key = (i, j) => `${i},${j}`;
  const lobby = (i, j) => (j === H - 2 && i >= ei && i <= ei + 1) || (j === 1 && i >= xi && i <= xi + 1);
  const roomOf = (i, j) => rooms.find((r) => r.cells.some(([a, b]) => a === i && b === j));
  const sidesWithWall = (i, j) => {
    const s = [];
    if (hWall[j][i]) s.push([0, -1]);
    if (hWall[j + 1][i]) s.push([0, 1]);
    if (vWall[j][i]) s.push([-1, 0]);
    if (vWall[j][i + 1]) s.push([1, 0]);
    return s;
  };
  // coloca um objeto encostado numa parede, deixando o meio da célula livre
  function against(i, j, side, type, w, d, h, extra = {}) {
    const [sx, sz] = side;
    const inner = CELL / 2 - WALL_T / 2 - d / 2 - 0.03;
    const lat = (rand() - 0.5) * Math.max(0, CELL - w - 0.6);
    const x = cellX(i) + sx * inner + (sx === 0 ? lat : 0);
    const z = cellZ(j) + sz * inner + (sz === 0 ? lat : 0);
    // rotY: frente do objeto virada para o centro da célula
    const rotY = Math.atan2(-sx, -sz);
    const p = { type, x, z, w, d, h, rotY, i, j, solid: true, ...extra };
    props.push(p);
    return p;
  }

  // mezanino + escada em alguns laboratórios
  const R = (k, lx, lz) => { // gira (lx, lz) em k×90°
    const c = [1, 0, -1, 0][k], s = [0, 1, 0, -1][k];
    return [lx * c + lz * s, -lx * s + lz * c];
  };
  const sideOpen = (room, k) => {
    // lado "leste" local (onde fica a escada) precisa estar fechado nas 2 células
    const [ex, ez] = R(k, 1, 0);
    const cells = room.cells.filter(([a, b]) => (ex > 0.5 ? a === room.i + 1 : ex < -0.5 ? a === room.i : ez > 0.5 ? b === room.j + 1 : b === room.j));
    return cells.some(([a, b]) => !sidesWithWall(a, b).some(([sx, sz]) => sx === Math.round(ex) && sz === Math.round(ez)));
  };
  rooms.forEach((room, n) => {
    room.cells.forEach(([a, b]) => used.add(key(a, b)));
    const wantMezz = n % 2 === 0;
    let k = -1;
    if (wantMezz) for (let t = 0; t < 4; t++) { const kk = (ri(4) + t) % 4; if (!sideOpen(room, kk)) { k = kk; break; } }
    const P = (lx, lz) => { const [x, z] = R(Math.max(k, 0), lx, lz); return [room.cx + x, room.cz + z]; };
    // (mesma convenção do three.js: rotation.y = θ leva o x local para (cosθ, -senθ))
    const rot = (r) => r + Math.max(k, 0) * (Math.PI / 2);
    // os monstros andam pelas "faixas" entre os centros das células (±1,5 m do centro da sala):
    // nada fica a menos de ~0,45 m delas, para não enroscarem
    if (k >= 0) {
      room.mezz = true;
      let [x, z] = P(0, -2.15);
      props.push({ type: 'mezz', x, z, w: 5.6, d: 1.4, h: MEZZ_H, rotY: rot(0), solid: false, room: room.name });
      [x, z] = P(2.4, -0.25);
      props.push({ type: 'stairs', x, z, w: 0.9, d: 2.4, h: MEZZ_H, rotY: rot(Math.PI), solid: true });
      [x, z] = P(0, 0);
      props.push({ type: 'table', x, z, w: 1.9, d: 0.8, h: 0.92, rotY: rot(0), solid: true, center: true });
      [x, z] = P(-2.4, 2.4);
      props.push({ type: 'tank', x, z, w: 0.8, d: 0.8, h: 2.1, rotY: 0, solid: true, safe: true });
      [x, z] = P(-2.55, 0);
      props.push({ type: 'rack', x, z, w: 1.0, d: 0.55, h: 2.0, rotY: rot(Math.PI / 2), solid: true });
    } else {
      // laboratório comum: bancada no meio + móveis nas paredes
      const along = rand() < 0.5 ? 0 : Math.PI / 2;
      props.push({ type: 'table', x: room.cx, z: room.cz, w: 1.9, d: 0.85, h: 0.92, rotY: along, solid: true, center: true });
      for (const [a, b] of room.cells) {
        const s = sidesWithWall(a, b);
        if (!s.length) continue;
        const pick = () => s.splice(ri(s.length), 1)[0];
        const r = rand();
        against(a, b, pick(), r < 0.35 ? 'shelf' : r < 0.6 ? 'tank' : r < 0.8 ? 'locker' : 'rack',
          r < 0.35 ? 1.4 : r < 0.6 ? 0.9 : r < 0.8 ? 1.2 : 1.0, r < 0.35 ? 0.55 : r < 0.6 ? 0.8 : r < 0.8 ? 0.5 : 0.6,
          r < 0.35 ? 2.15 : r < 0.6 ? 2.1 : r < 0.8 ? 1.9 : 2.0, { safe: r < 0.6 });
      }
    }
  });

  // corredores: pilhas de caixas (ponto seguro), barris, painéis, armários
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (isSafeCell(i, j) || used.has(key(i, j))) continue;
    const s = sidesWithWall(i, j);
    if (!s.length) continue;
    const pick = () => s.splice(ri(s.length), 1)[0];
    if (lobby(i, j)) { if (s.length && rand() < 0.6) against(i, j, pick(), 'console', 1.1, 0.45, 1.15); continue; }
    const r = rand();
    if (r < 0.34) {
      const side = pick();
      const big = against(i, j, side, 'crate', 1.0, 0.8, 1.25, { safe: true });
      const [sx] = side;
      const off = (rand() < 0.5 ? -1 : 1) * 0.85;
      props.push({ type: 'crate', x: big.x + (sx === 0 ? off : 0), z: big.z + (sx !== 0 ? off : 0), w: 0.6, d: 0.6, h: 0.62, rotY: big.rotY + 0.25, i, j, solid: true, step: true });
    } else if (r < 0.46) against(i, j, pick(), 'barrel', 0.62, 0.62, 0.95);
    else if (r < 0.56) against(i, j, pick(), 'locker', 1.2, 0.5, 1.9);
    else if (r < 0.64) against(i, j, pick(), 'shelf', 1.4, 0.55, 2.15, { safe: true });
    if (s.length && rand() < 0.15) against(i, j, pick(), 'console', 1.1, 0.45, 1.15);
  }

  // 8) amostras: longe do início, preferindo laboratórios (mesa, mezanino) e becos
  const samples = [];
  const candidates = [];
  for (const room of rooms) {
    const t = props.find((p) => p.type === 'table' && Math.hypot(p.x - room.cx, p.z - room.cz) < 2.6);
    if (t) candidates.push({ x: t.x, y: t.h + 0.09, z: t.z, w: 3 + toCellJ(-t.z) * 0.1 });
    const m = props.find((p) => p.type === 'mezz' && p.room === room.name);
    if (m) candidates.push({ x: m.x, y: MEZZ_H + 0.12, z: m.z, w: 4 });
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (isSafeCell(i, j) || used.has(key(i, j)) || lobby(i, j)) continue;
    if (sidesWithWall(i, j).length === 3) candidates.push({ x: cellX(i), y: 0.12, z: cellZ(j), w: 2 }); // beco sem saída
  }
  const sx0 = cellX(ei) + CELL / 2, sz0 = cellZ(H - 1);
  candidates.forEach((c) => { c.score = Math.hypot(c.x - sx0, c.z - sz0) * 0.15 + c.w + rand() * 2; });
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (samples.length >= 3) break;
    if (samples.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 9)) continue;
    samples.push({ id: samples.length + 1, x: c.x, y: c.y, z: c.z });
  }
  for (const c of candidates) { // garante 3 mesmo em mapas apertados
    if (samples.length >= 3) break;
    if (!samples.some((s) => s.x === c.x && s.z === c.z)) samples.push({ id: samples.length + 1, x: c.x, y: c.y, z: c.z });
  }

  // 9) luzes do teto e de destaque
  const lights = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const r = rand();
    const kind = isSafeCell(i, j) ? 'elevator' : lobby(i, j) ? 'panel' : r < 0.2 ? 'broken' : r < 0.3 ? 'flicker' : 'panel';
    lights.push({ x: cellX(i), z: cellZ(j), kind, i, j });
  }
  const elevRect = (e) => ({ x0: e.i0 * CELL - HALF_X, x1: (e.i1 + 1) * CELL - HALF_X, z0: e.j * CELL - HALF_Z, z1: (e.j + 1) * CELL - HALF_Z });
  const startRect = elevRect(elevators.start), exitRect = elevRect(elevators.exit);
  const pointLights = [
    { x: (startRect.x0 + startRect.x1) / 2, z: (startRect.z0 + startRect.z1) / 2, kind: 'start' },
    { x: (exitRect.x0 + exitRect.x1) / 2, z: (exitRect.z0 + exitRect.z1) / 2, kind: 'exit' },
    ...rooms.slice(0, 3).map((r) => ({ x: r.cx, z: r.cz, kind: 'lab', flicker: rand() < 0.4 })),
  ];
  for (let k = 0; k < 2; k++) pointLights.push({ x: cellX(ri(W)), z: cellZ(2 + ri(H - 5)), kind: 'alarm' });

  const spawns = [];
  for (let k = 0; k < 8; k++) spawns.push({ x: startRect.x0 + 1 + (k % 4) * 1.3, z: startRect.z0 + 1.1 + Math.floor(k / 4) * 0.9 });
  const monsterSpawns = [];
  for (let j = 0; j < H - 4; j++) for (let i = 0; i < W; i++) {
    if (isSafeCell(i, j) || lobby(i, j)) continue;
    if (Math.hypot(cellX(i) - sx0, cellZ(j) - sz0) > 15) monsterSpawns.push({ x: cellX(i), z: cellZ(j) });
  }
  for (let k = monsterSpawns.length - 1; k > 0; k--) { const t = ri(k + 1); [monsterSpawns[k], monsterSpawns[t]] = [monsterSpawns[t], monsterSpawns[k]]; }

  const inRect = (r, x, z, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
  return {
    seed, W, H, CELL, WALL_H, WALL_T, hWall, vWall, walls, props, rooms, lights, pointLights, samples,
    elevators, startRect, exitRect, spawns, monsterSpawns,
    isSafeCell, wallBetween,
    // zona segura = dentro de qualquer um dos elevadores
    isInSafeZone: (x, z) => inRect(startRect, x, z, -0.15) || inRect(exitRect, x, z, -0.15),
    inExitElevator: (x, z) => inRect(exitRect, x, z, -0.2),
    safeRects: [startRect, exitRect],
  };
}

// --- geometria 2D compartilhada (IA) ---------------------------------------------------
function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rX = bx - ax, rZ = bz - az, sX = dx - cx, sZ = dz - cz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * sZ - (cz - az) * sX) / den;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}

// linha de visão (paredes bloqueiam; móveis baixos não)
export function lineOfSight(st, ax, az, bx, bz) {
  for (const w of st.walls) if (segIntersect(ax, az, bx, bz, w.x1, w.z1, w.x2, w.z2)) return false;
  return true;
}

// segmento cruza algum objeto sólido (inflado pelo raio r)? — para a IA desviar de móveis
export function propsBlock(st, ax, az, bx, bz, r) {
  for (const o of st.props) {
    if (!o.solid) continue;
    const [hx, hz] = propHalf(o);
    const x0 = o.x - hx - r, x1 = o.x + hx + r, z0 = o.z - hz - r, z1 = o.z + hz + r;
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    let hit = true;
    for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [az, dz, z0, z1]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { hit = false; break; } continue; }
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

// meias-medidas no eixo do mundo de um objeto girado em múltiplos de 90° (aprox.)
export function propHalf(o) {
  const rotated = Math.abs(Math.sin(o.rotY)) > 0.5;
  return [(rotated ? o.d : o.w) / 2, (rotated ? o.w : o.d) / 2];
}

// empurra um círculo para fora das paredes e dos objetos no chão
export function collideCircle(st, p, r) {
  const t = st.WALL_T / 2;
  for (const w of st.walls) {
    const ex = w.x2 - w.x1, ez = w.z2 - w.z1;
    const len2 = ex * ex + ez * ez;
    let k = ((p.x - w.x1) * ex + (p.z - w.z1) * ez) / len2;
    k = Math.max(0, Math.min(1, k));
    const qx = w.x1 + ex * k, qz = w.z1 + ez * k;
    const dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz), min = r + t;
    if (d < min && d > 1e-6) { p.x = qx + (dx / d) * min; p.z = qz + (dz / d) * min; }
  }
  for (const o of st.props) {
    if (!o.solid) continue;
    const [hx, hz] = propHalf(o);
    const cx = Math.max(o.x - hx, Math.min(p.x, o.x + hx));
    const cz = Math.max(o.z - hz, Math.min(p.z, o.z + hz));
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d < r && d > 1e-6) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
    else if (d <= 1e-6) { // centro dentro do objeto: sai pelo lado mais perto
      const ox = hx - Math.abs(p.x - o.x), oz = hz - Math.abs(p.z - o.z);
      if (ox < oz) p.x = o.x + Math.sign(p.x - o.x || 1) * (hx + r); else p.z = o.z + Math.sign(p.z - o.z || 1) * (hz + r);
    }
  }
}
