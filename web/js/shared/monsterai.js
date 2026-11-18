// IA dos babuínos (compartilhada: roda no servidor e, sem servidor, no próprio jogo).
//
// Percepção: só um cone de visão à frente (paredes bloqueiam) + sentido de proximidade
// bem curto (ouve quem está colado nele). Nada de "ver o mapa inteiro".
// Estados:
//   patrol      explora o labirinto, preferindo células que não visita há mais tempo
//   chase       vê um jogador: corre atrás e lembra onde o viu por último
//   investigate perdeu de vista: vai até o último ponto em que viu (ou atrás de outro visível)
//   search      chegou lá e não achou: para e olha em volta
//   wait        jogador subiu num lugar alto: fica embaixo rondando, depois desiste
//   attack      pegou alguém
import { W, H, SAFE_HEIGHT, cellX, cellZ, toCellI, toCellJ, lineOfSight, collideCircle, propsBlock, mulberry32 } from './station.js';

export const STATE = { patrol: 0, chase: 1, investigate: 2, search: 3, wait: 4, attack: 5 };

const CFG = {
  radius: 0.42,
  eyeHeight: 1.0,
  fov: (115 * Math.PI) / 180,   // cone de visão total
  viewDist: 17,
  senseDist: 1.8,              // percebe quem está colado, mesmo atrás
  catchDist: 0.95,
  speed: { patrol: 1.35, investigate: 2.7, chase: 3.75, search: 0, wait: 0.9, attack: 0 },
  turnRate: { patrol: 2.2, investigate: 3.6, chase: 5.5, search: 2.0, wait: 4.0, attack: 6 },
  accel: 5,
  waitGiveUp: 6,               // segundos esperando embaixo de alguém no alto
  ignoreAfterGiveUp: 9,
  searchTime: 3.2,
  attackTime: 1.4,
  memory: 12,                  // por quanto tempo o último ponto visto "vale"
};

export class MonsterSim {
  // variant: { speed, viewDist, fov, count, scale } do andar (levels.js)
  constructor(station, variant = {}, seed = 7) {
    this.st = station;
    this.rand = mulberry32(seed);
    this.cfg = {
      ...CFG,
      viewDist: variant.viewDist ?? CFG.viewDist,
      fov: ((variant.fov ?? 115) * Math.PI) / 180,
      radius: CFG.radius * (variant.scale ?? 1),
      speed: { ...CFG.speed, chase: variant.speed ?? CFG.speed.chase, investigate: (variant.speed ?? CFG.speed.chase) * 0.72 },
    };
    this.monsters = [];
    this.visited = Array.from({ length: H }, () => Array(W).fill(0));
    this.time = 0;
    this.nextId = 1;
  }

  spawn(count) {
    const sp = this.st.monsterSpawns;
    for (let k = 0; k < count; k++) {
      const s = sp[(this.monsters.length * 5 + k) % sp.length];
      this.monsters.push({
        id: this.nextId++, x: s.x, z: s.z, yaw: this.rand() * Math.PI * 2, speed: 0,
        state: STATE.patrol, stateT: 0, target: null, lastSeen: null, goal: null,
        path: [], pathT: 0, waitT: 0, ignore: new Map(), look: { x: s.x, y: 1, z: s.z + 1 },
        searchYaw: 0, attackVictim: null,
      });
    }
  }

  setCount(n) {
    while (this.monsters.length < n) this.spawn(1);
    while (this.monsters.length > n) this.monsters.pop();
  }

  // players: [{ id, x, y, z }]  (posição da cabeça; jogadores "mortos" não entram)
  update(dt, players) {
    this.time += dt;
    const events = [];
    for (const m of this.monsters) this._think(m, dt, players, events);
    for (const m of this.monsters) this._move(m, dt);
    // monstros não se atravessam
    for (let a = 0; a < this.monsters.length; a++) for (let b = a + 1; b < this.monsters.length; b++) {
      const A = this.monsters[a], B = this.monsters[b];
      const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), min = this.cfg.radius * 2;
      if (d < min && d > 1e-6) { const k = (min - d) / 2 / d; A.x -= dx * k; A.z -= dz * k; B.x += dx * k; B.z += dz * k; }
    }
    return events;
  }

  // ---------------------------------------------------------------- percepção
  _canSee(m, p) {
    if (this.st.isInSafeZone(p.x, p.z)) return false;
    const dx = p.x - m.x, dz = p.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d > this.cfg.viewDist) return false;
    if (d > this.cfg.senseDist) {
      const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
      const cos = (dx * fx + dz * fz) / (d || 1);
      if (cos < Math.cos(this.cfg.fov / 2)) return false;
    }
    return lineOfSight(this.st, m.x, m.z, p.x, p.z);
  }

  _think(m, dt, players, events) {
    m.stateT += dt;
    for (const [id, until] of m.ignore) if (until < this.time) m.ignore.delete(id);

    if (m.state === STATE.attack) {
      if (m.stateT > this.cfg.attackTime) this._setState(m, STATE.patrol);
      return;
    }

    // quem ele enxerga agora
    const visible = players.filter((p) => !m.ignore.has(p.id) && this._canSee(m, p));
    let target = visible.find((p) => p.id === m.target) || null;
    if (!target && visible.length) {
      target = visible.reduce((best, p) => (Math.hypot(p.x - m.x, p.z - m.z) < Math.hypot(best.x - m.x, best.z - m.z) ? p : best));
    }

    if (target) {
      const first = m.target !== target.id || m.state !== STATE.chase;
      m.target = target.id;
      m.lastSeen = { x: target.x, z: target.z, t: this.time };
      m.look = { x: target.x, y: target.y, z: target.z };
      const high = target.y > SAFE_HEIGHT;
      if (high) {
        // subiu em algo alto: fica embaixo rondando e desiste depois de um tempo
        if (m.state !== STATE.wait) { this._setState(m, STATE.wait); m.waitT = 0; }
        m.waitT += dt;
        m.goal = { x: target.x, z: target.z };
        if (m.waitT > this.cfg.waitGiveUp) {
          m.ignore.set(target.id, this.time + this.cfg.ignoreAfterGiveUp);
          m.target = null; m.lastSeen = null;
          this._setState(m, STATE.patrol);
        }
        return;
      }
      if (m.state !== STATE.chase) this._setState(m, STATE.chase);
      if (first) events.push({ type: 'spotted', monsterId: m.id, playerId: target.id });
      m.goal = { x: target.x, z: target.z };
      // pegou?
      const d = Math.hypot(target.x - m.x, target.z - m.z);
      if (d < this.cfg.catchDist) {
        events.push({ type: 'caught', monsterId: m.id, playerId: target.id });
        m.ignore.set(target.id, this.time + 4);
        m.target = null; m.lastSeen = null; m.speed = 0;
        this._setState(m, STATE.attack);
      }
      return;
    }

    // ninguém à vista
    if (m.state === STATE.chase || m.state === STATE.wait) {
      // perdeu de vista: vai até o último ponto em que viu
      if (m.lastSeen && this.time - m.lastSeen.t < this.cfg.memory) {
        this._setState(m, STATE.investigate);
        m.goal = { x: m.lastSeen.x, z: m.lastSeen.z };
      } else this._setState(m, STATE.patrol);
      m.target = null;
    }

    if (m.state === STATE.investigate) {
      m.look = { x: m.goal.x, y: 0.8, z: m.goal.z };
      if (Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 0.8 || m.stateT > 14) {
        this._setState(m, STATE.search);
        m.searchYaw = m.yaw;
      }
      return;
    }

    if (m.state === STATE.search) {
      // olha para os lados procurando
      const a = m.searchYaw + Math.sin(m.stateT * 2.1) * 1.3;
      m.look = { x: m.x + Math.sin(a) * 4, y: 1, z: m.z + Math.cos(a) * 4 };
      m.yawGoal = a;
      if (m.stateT > this.cfg.searchTime) { m.lastSeen = null; this._setState(m, STATE.patrol); }
      return;
    }

    // patrulha: escolhe uma célula pouco visitada
    const ci = toCellI(m.x), cj = toCellJ(m.z);
    if (ci >= 0 && cj >= 0 && ci < W && cj < H) this.visited[cj][ci] = this.time;
    if (!m.goal || Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 0.9 || m.stateT > 25) {
      let best = null, bestScore = -Infinity;
      for (let k = 0; k < 8; k++) {
        const i = Math.floor(this.rand() * W), j = Math.floor(this.rand() * H);
        if (this.st.isSafeCell(i, j)) continue;
        const age = this.time - this.visited[j][i];
        const dist = Math.hypot(cellX(i) - m.x, cellZ(j) - m.z);
        const score = age - dist * 0.4 + this.rand() * 3;
        if (score > bestScore) { bestScore = score; best = { x: cellX(i), z: cellZ(j) }; }
      }
      if (best) { m.goal = best; m.path = []; m.stateT = 0; }
    }
    m.look = { x: m.x + Math.sin(m.yaw) * 3, y: 0.9, z: m.z + Math.cos(m.yaw) * 3 };
  }

  _setState(m, s) {
    if (m.state !== s) { m.state = s; m.stateT = 0; m.path = []; m.pathT = 0; }
  }

  // ---------------------------------------------------------------- navegação
  _findPath(fromX, fromZ, toX, toZ) {
    const st = this.st;
    const si = clampI(toCellI(fromX), W), sj = clampI(toCellJ(fromZ), H);
    let gi = clampI(toCellI(toX), W), gj = clampI(toCellJ(toZ), H);
    if (st.isSafeCell(gi, gj)) return [];
    const key = (i, j) => j * W + i;
    const open = [[si, sj]];
    const came = new Map([[key(si, sj), null]]);
    const g = new Map([[key(si, sj), 0]]);
    const hfn = (i, j) => Math.abs(i - gi) + Math.abs(j - gj);
    const f = new Map([[key(si, sj), hfn(si, sj)]]);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f.get(key(...open[k])) < f.get(key(...open[bi]))) bi = k;
      const [i, j] = open.splice(bi, 1)[0];
      if (i === gi && j === gj) {
        const out = [];
        let c = [i, j];
        while (c) { out.unshift({ x: cellX(c[0]), z: cellZ(c[1]) }); c = came.get(key(...c)); }
        out[out.length - 1] = { x: toX, z: toZ };
        return out;
      }
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= W || b >= H || st.isSafeCell(a, b) || st.wallBetween(i, j, a, b)) continue;
        const ng = g.get(key(i, j)) + 1;
        if (ng < (g.get(key(a, b)) ?? Infinity)) {
          came.set(key(a, b), [i, j]); g.set(key(a, b), ng); f.set(key(a, b), ng + hfn(a, b));
          if (!open.some(([x, y]) => x === a && y === b)) open.push([a, b]);
        }
      }
    }
    return [];
  }

  // linha livre com folga do corpo (duas linhas paralelas ao lado)
  _clearLine(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz) || 1;
    const nx = (-dz / d) * this.cfg.radius, nz = (dx / d) * this.cfg.radius;
    return lineOfSight(this.st, ax + nx, az + nz, bx + nx, bz + nz) && lineOfSight(this.st, ax - nx, az - nz, bx - nx, bz - nz)
      && !propsBlock(this.st, ax, az, bx, bz, this.cfg.radius * 0.8);
  }

  _move(m, dt) {
    const st = m.state;
    let want = this.cfg.speed[Object.keys(STATE).find((k) => STATE[k] === st)] ?? 0;
    let aim = null;
    if (m.goal && st !== STATE.search && st !== STATE.attack) {
      const dGoal = Math.hypot(m.goal.x - m.x, m.goal.z - m.z);
      if (st === STATE.wait && dGoal < 0.9) want = 0; // já está embaixo: só ronda olhando para cima
      if (this._clearLine(m.x, m.z, m.goal.x, m.goal.z)) {
        aim = m.goal;
        m.path = [];
      } else {
        m.pathT -= dt;
        if (!m.path.length || m.pathT <= 0) { m.path = this._findPath(m.x, m.z, m.goal.x, m.goal.z); m.pathT = 0.6; }
        // pula para o ponto mais distante do caminho que já dá para ver (curvas suaves)
        while (m.path.length > 1 && this._clearLine(m.x, m.z, m.path[1].x, m.path[1].z)) m.path.shift();
        if (m.path.length && Math.hypot(m.path[0].x - m.x, m.path[0].z - m.z) < 0.5) m.path.shift();
        aim = m.path[0] || null;
        if (!aim) want = 0;
      }
    }
    let goalYaw = m.yaw;
    if (aim) goalYaw = Math.atan2(aim.x - m.x, aim.z - m.z);
    else if (st === STATE.search && m.yawGoal !== undefined) goalYaw = m.yawGoal;
    if (st === STATE.wait && m.look) goalYaw = Math.atan2(m.look.x - m.x, m.look.z - m.z);

    const rate = this.cfg.turnRate[Object.keys(STATE).find((k) => STATE[k] === st)] ?? 3;
    let dy = wrapAngle(goalYaw - m.yaw);
    dy = Math.max(-rate * dt, Math.min(rate * dt, dy));
    m.yaw = wrapAngle(m.yaw + dy);
    // desacelera nas curvas fechadas
    const align = Math.max(0, Math.cos(wrapAngle(goalYaw - m.yaw)));
    const target = want * (0.35 + 0.65 * align);
    m.speed += Math.max(-this.cfg.accel * 2 * dt, Math.min(this.cfg.accel * dt, target - m.speed));
    if (m.speed < 0.01) m.speed = 0;
    m.x += Math.sin(m.yaw) * m.speed * dt;
    m.z += Math.cos(m.yaw) * m.speed * dt;
    collideCircle(this.st, m, this.cfg.radius);
    // nunca entra nos elevadores (zonas seguras)
    const pad = this.cfg.radius + 0.2;
    for (const r of this.st.safeRects) {
      if (m.x > r.x0 - pad && m.x < r.x1 + pad && m.z > r.z0 - pad && m.z < r.z1 + pad) {
        const dl = m.x - (r.x0 - pad), dr = r.x1 + pad - m.x, dtp = m.z - (r.z0 - pad), db = r.z1 + pad - m.z;
        const mn = Math.min(dl, dr, dtp, db);
        if (mn === dl) m.x = r.x0 - pad; else if (mn === dr) m.x = r.x1 + pad; else if (mn === dtp) m.z = r.z0 - pad; else m.z = r.z1 + pad;
      }
    }
  }

  // estado enxuto para a rede: [id, x, z, yaw, state, speed, lookX, lookY, lookZ, targetId]
  snapshot() {
    const f = (v) => Math.round(v * 100) / 100;
    return this.monsters.map((m) => [m.id, f(m.x), f(m.z), f(m.yaw), m.state, f(m.speed), f(m.look.x), f(m.look.y), f(m.look.z), m.target || 0]);
  }
}

function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
const clampI = (v, n) => Math.max(0, Math.min(n - 1, v));
