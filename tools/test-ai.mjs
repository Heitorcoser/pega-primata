// Testes do gerador de andares e da IA dos monstros.  Uso: node tools/test-ai.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../web/js/shared/', import.meta.url));
const S = await import(pathToFileURL(base + 'station.js'));
const { MonsterSim, STATE } = await import(pathToFileURL(base + 'monsterai.js'));
const { FLOORS } = await import(pathToFileURL(base + 'levels.js'));
const { generateFloor, W, H, cellX, cellZ, toCellI, toCellJ, SAFE_HEIGHT } = S;

function ascii(st) {
  const rows = [];
  for (let j = 0; j <= H; j++) {
    let line = '+';
    for (let i = 0; i < W; i++) line += (st.hWall[j][i] ? '---' : '   ') + '+';
    rows.push(line);
    if (j === H) break;
    let c = '';
    for (let i = 0; i <= W; i++) {
      c += st.vWall[j][i] ? '|' : ' ';
      if (i === W) break;
      let ch = '   ';
      if (st.isSafeCell(i, j)) ch = j === H - 1 ? ' S ' : ' E ';
      else if (st.rooms.some((r) => r.cells.some(([a, b]) => a === i && b === j))) ch = st.rooms.find((r) => r.cells.some(([a, b]) => a === i && b === j)).mezz ? ' M ' : ' L ';
      if (st.samples.some((s) => toCellI(s.x) === i && toCellJ(s.z) === j)) ch = ' * ';
      c += ch;
    }
    rows.push(c);
  }
  return rows.join('\n');
}

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + msg); if (!cond) fails++; };

// ---- gerador: várias seeds
for (const seed of [1, 42, 2026, 99999, 123456789]) {
  const st = generateFloor(seed);
  // conectividade a partir do elevador de entrada
  const seen = new Set([`${st.elevators.start.i0},${H - 1}`]);
  const q = [[st.elevators.start.i0, H - 1]];
  while (q.length) {
    const [i, j] = q.shift();
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= W || b >= H || seen.has(`${a},${b}`) || st.wallBetween(i, j, a, b)) continue;
      seen.add(`${a},${b}`); q.push([a, b]);
    }
  }
  const mezz = st.rooms.filter((r) => r.mezz).length;
  ok(seen.size === W * H && st.samples.length === 3 && st.rooms.length >= 3,
    `seed ${seed}: conectado ${seen.size}/${W * H}, amostras ${st.samples.length}, labs ${st.rooms.length} (mezanino ${mezz}), objetos ${st.props.length}, paredes ${st.walls.length}`);
  // nenhum objeto sólido em cima do centro de célula (faixa dos monstros)
  let blocked = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (st.isSafeCell(i, j)) continue;
    const p = { x: cellX(i), z: cellZ(j) }; const before = { ...p };
    S.collideCircle(st, p, 0.42);
    if (Math.hypot(p.x - before.x, p.z - before.z) > 0.01) blocked++;
  }
  ok(blocked === 0, `seed ${seed}: centros de célula livres para os monstros (bloqueados: ${blocked})`);
}
console.log('\nMapa (seed 2026)  S=entrada E=saída L=lab M=lab c/ mezanino *=amostra');
const st = generateFloor(2026);
console.log(ascii(st));

// ---- IA
const V = FLOORS[0].monster;
function fresh(x, z, yaw) {
  const sim = new MonsterSim(st, V, 3);
  sim.spawn(1);
  const m = sim.monsters[0];
  Object.assign(m, { x, z, yaw, state: STATE.patrol, goal: null, path: [] });
  return { sim, m };
}
// acha um corredor reto: duas células alinhadas sem parede entre elas
function straight() {
  for (let j = 1; j < H - 2; j++) for (let i = 0; i < W - 3; i++) {
    if (st.isSafeCell(i, j)) continue;
    if (!st.wallBetween(i, j, i + 1, j) && !st.wallBetween(i + 1, j, i + 2, j) && !st.wallBetween(i + 2, j, i + 3, j)
      && S.lineOfSight(st, cellX(i), cellZ(j), cellX(i + 3), cellZ(j))) return [i, j];
  }
}
const [ci, cj] = straight();
const mx = cellX(ci), mz = cellZ(cj), px = cellX(ci + 3), pz = cellZ(cj);
const faceEast = Math.atan2(1, 0), faceWest = Math.atan2(-1, 0);

{ // 1) vê quem está na frente e persegue até pegar
  const { sim, m } = fresh(mx, mz, faceEast);
  const p = { id: 1, x: px, y: 0.5, z: pz };
  let ev = sim.update(0.05, [p]);
  ok(m.state === STATE.chase && ev.some((e) => e.type === 'spotted'), '1) jogador na frente (9 m): monstro vê e entra em perseguição');
  let caught = false;
  for (let t = 0; t < 200 && !caught; t++) caught = sim.update(0.05, [p]).some((e) => e.type === 'caught');
  ok(caught, `1) jogador parado é pego (monstro chegou a ${m.speed.toFixed(1)} m/s)`);
}
{ // 2) jogador atrás (fora do cone) não é visto
  const { sim, m } = fresh(mx, mz, faceWest);
  sim.update(0.05, [{ id: 1, x: px, y: 0.5, z: pz }]);
  ok(m.state !== STATE.chase, '2) jogador nas costas, longe: NÃO é visto (só visão à frente)');
  const near = { id: 1, x: mx + 1.2, y: 0.5, z: mz };
  sim.update(0.05, [near]);
  ok(m.state === STATE.chase, '2) jogador colado nas costas (1,2 m): é percebido');
}
{ // 3) parede bloqueia a visão
  let found = null;
  for (let j = 0; j < H && !found; j++) for (let i = 0; i < W - 1 && !found; i++)
    if (!st.isSafeCell(i, j) && !st.isSafeCell(i + 1, j) && st.wallBetween(i, j, i + 1, j)) found = [i, j];
  const [i, j] = found;
  const { sim, m } = fresh(cellX(i), cellZ(j), faceEast);
  sim.update(0.05, [{ id: 1, x: cellX(i + 1), y: 0.5, z: cellZ(j) }]);
  ok(m.state !== STATE.chase, '3) jogador do outro lado da parede: NÃO é visto');
}
{ // 4) perde de vista -> vai ao último ponto visto -> procura -> patrulha
  const { sim, m } = fresh(mx, mz, faceEast);
  const p = { id: 1, x: px, y: 0.5, z: pz };
  sim.update(0.05, [p]);
  const seenAt = { ...m.lastSeen };
  // jogador "some" (foi para trás de uma parede longe)
  const hidden = { id: 1, x: cellX(0), y: 0.5, z: cellZ(H - 3) };
  let states = new Set();
  for (let t = 0; t < 400; t++) { sim.update(0.05, S.lineOfSight(st, m.x, m.z, hidden.x, hidden.z) ? [] : [hidden]); states.add(m.state); if (m.state === STATE.patrol && states.has(STATE.search)) break; }
  ok(states.has(STATE.investigate) && states.has(STATE.search) && m.state === STATE.patrol,
    `4) perdeu de vista: foi ao último ponto (${seenAt.x.toFixed(1)}, ${seenAt.z.toFixed(1)}), procurou e voltou a patrulhar`);
}
{ // 5) troca de alvo: perde um, vê outro
  const { sim, m } = fresh(mx, mz, faceEast);
  const a = { id: 1, x: px, y: 0.5, z: pz };
  sim.update(0.05, [a]);
  const b = { id: 2, x: mx + 4, y: 0.5, z: mz };
  sim.update(0.05, [b]); // 'a' sumiu, 'b' está à vista
  ok(m.target === 2 && m.state === STATE.chase, '5) perdeu o jogador 1 e foi atrás do jogador 2 que estava à vista');
}
{ // 6) zona segura: jogador dentro do elevador é ignorado e o monstro não entra
  const e = st.startRect;
  const cx = (e.x0 + e.x1) / 2;
  const { sim, m } = fresh(cx, e.z0 - 2.5, Math.PI); // olhando para o elevador (sul = -z? elevador está em z maior)
  m.yaw = 0; // +z
  const p = { id: 1, x: cx, y: 0.5, z: (e.z0 + e.z1) / 2 };
  let inside = false;
  for (let t = 0; t < 200; t++) { sim.update(0.05, [p]); if (st.isInSafeZone(m.x, m.z)) inside = true; }
  ok(m.state !== STATE.chase && !inside, '6) jogador na zona segura (elevador): ignorado; monstro nunca entra');
}
{ // 7) jogador no alto: monstro espera embaixo e depois desiste
  const { sim, m } = fresh(mx, mz, faceEast);
  const p = { id: 1, x: px, y: SAFE_HEIGHT + 0.3, z: pz };
  let sawWait = false, caught = false;
  for (let t = 0; t < 260; t++) { const ev = sim.update(0.05, [p]); if (m.state === STATE.wait) sawWait = true; if (ev.some((e) => e.type === 'caught')) caught = true; }
  ok(sawWait && !caught && m.state !== STATE.wait, `7) jogador em cima de caixa: monstro esperou embaixo, não pegou e desistiu (estado final ${m.state})`);
}
{ // 8) patrulha explora o mapa sem travar
  const sim = new MonsterSim(st, V, 5);
  sim.spawn(2);
  const cells = new Set();
  let stuck = 0;
  const last = sim.monsters.map((m) => ({ x: m.x, z: m.z }));
  for (let t = 0; t < 6000; t++) { // 300 s
    sim.update(0.05, []);
    sim.monsters.forEach((m, k) => {
      cells.add(`${toCellI(m.x)},${toCellJ(m.z)}`);
      if (t % 100 === 99) { if (Math.hypot(m.x - last[k].x, m.z - last[k].z) < 0.3) stuck++; last[k] = { x: m.x, z: m.z }; }
    });
  }
  ok(cells.size > 80 && stuck < 6, `8) patrulha 300 s: ${cells.size} células visitadas, ${stuck} vezes parado 5 s`);
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo certo');
