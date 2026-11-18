// Física de colisão com semântica igual à do Unity (Physics.SphereCast / Physics.Raycast),
// necessária para que o port da locomoção se comporte igual ao original.
//  - SphereCast/Raycast NÃO detectam colisores que já estão sobrepostos no ponto de partida
//  - hit.distance = quanto o centro da esfera andou, hit.point = ponto de contato na superfície
//  - colisores: caixas orientadas (OBB) e esferas; cast analítico e exato (soma de Minkowski)
import * as THREE from 'three';

const _o = [0, 0, 0], _d = [0, 0, 0], _h = [0, 0, 0];
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();

export class Hit {
  constructor() {
    this.distance = 0;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.collider = null;
  }
  copy(h) {
    this.distance = h.distance;
    this.point.copy(h.point);
    this.normal.copy(h.normal);
    this.collider = h.collider;
    return this;
  }
}

// --- primitivas de raio (em espaço local da caixa) -------------------------------------
function rayAABB(o, d, hx, hy, hz) {
  let tmin = -Infinity, tmax = Infinity;
  const hs = [hx, hy, hz];
  for (let a = 0; a < 3; a++) {
    const h = hs[a];
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < -h || o[a] > h) return Infinity;
    } else {
      let t1 = (-h - o[a]) / d[a], t2 = (h - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return tmin;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const px = ox - cx, py = oy - cy, pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

// raio contra caixa arredondada (caixa expandida pelo raio r) — exato
function rayRoundedBox(o, d, h, r) {
  if (r <= 0) return rayAABB(o, d, h[0], h[1], h[2]);
  let best = Infinity, t;
  // 3 lajes (caixa crescida em um eixo de cada vez)
  t = rayAABB(o, d, h[0] + r, h[1], h[2]); if (t < best) best = t;
  t = rayAABB(o, d, h[0], h[1] + r, h[2]); if (t < best) best = t;
  t = rayAABB(o, d, h[0], h[1], h[2] + r); if (t < best) best = t;
  // 12 arestas (cilindros)
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const A = d[b] * d[b] + d[c] * d[c];
    if (A < 1e-12) continue;
    for (let sb = -1; sb <= 1; sb += 2) {
      for (let sc = -1; sc <= 1; sc += 2) {
        const ob = o[b] - sb * h[b], oc = o[c] - sc * h[c];
        const B = ob * d[b] + oc * d[c];
        const C = ob * ob + oc * oc - r * r;
        const disc = B * B - A * C;
        if (disc < 0) continue;
        let tt = (-B - Math.sqrt(disc)) / A;
        if (tt < 0) { if (C > 0) continue; tt = 0; }
        if (tt >= best) continue;
        const ax = o[a] + d[a] * tt;
        if (ax >= -h[a] && ax <= h[a]) best = tt;
      }
    }
  }
  // 8 cantos (esferas)
  for (let sx = -1; sx <= 1; sx += 2)
    for (let sy = -1; sy <= 1; sy += 2)
      for (let sz = -1; sz <= 1; sz += 2) {
        t = raySphere(o[0], o[1], o[2], d[0], d[1], d[2], sx * h[0], sy * h[1], sz * h[2], r);
        if (t < best) best = t;
      }
  return best < 0 ? 0 : best;
}

// --- mundo -----------------------------------------------------------------------------
export class PhysicsWorld {
  constructor() {
    this.colliders = [];
  }

  // remove tudo (troca de andar)
  clear() {
    this.colliders.length = 0;
  }

  addBox(center, half, quat = null, surface = {}) {
    const q = quat ? quat.clone() : new THREE.Quaternion();
    const col = {
      type: 'box', c: center.clone(), h: half.clone(), q, qi: q.clone().invert(), surface,
      min: new THREE.Vector3(), max: new THREE.Vector3(),
    };
    const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const ex = Math.abs(e[0]) * half.x + Math.abs(e[4]) * half.y + Math.abs(e[8]) * half.z;
    const ey = Math.abs(e[1]) * half.x + Math.abs(e[5]) * half.y + Math.abs(e[9]) * half.z;
    const ez = Math.abs(e[2]) * half.x + Math.abs(e[6]) * half.y + Math.abs(e[10]) * half.z;
    col.min.set(center.x - ex, center.y - ey, center.z - ez);
    col.max.set(center.x + ex, center.y + ey, center.z + ez);
    this.colliders.push(col);
    return col;
  }

  addSphere(center, radius, surface = {}) {
    const col = {
      type: 'sphere', c: center.clone(), r: radius, surface,
      min: new THREE.Vector3(center.x - radius, center.y - radius, center.z - radius),
      max: new THREE.Vector3(center.x + radius, center.y + radius, center.z + radius),
    };
    this.colliders.push(col);
    return col;
  }

  // distância com sinal do ponto p até o colisor
  sdf(col, px, py, pz) {
    if (col.type === 'sphere') {
      const dx = px - col.c.x, dy = py - col.c.y, dz = pz - col.c.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - col.r;
    }
    _tmpV.set(px - col.c.x, py - col.c.y, pz - col.c.z).applyQuaternion(col.qi);
    const qx = Math.abs(_tmpV.x) - col.h.x, qy = Math.abs(_tmpV.y) - col.h.y, qz = Math.abs(_tmpV.z) - col.h.z;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0);
  }

  // ponto mais próximo na superfície + normal para fora, a partir de um ponto p (mundo)
  surfaceInfo(col, p, outPoint, outNormal, preferFace) {
    if (col.type === 'sphere') {
      outNormal.copy(p).sub(col.c);
      const l = outNormal.length();
      if (l < 1e-9) outNormal.set(0, 1, 0); else outNormal.multiplyScalar(1 / l);
      outPoint.copy(col.c).addScaledVector(outNormal, col.r);
      return;
    }
    const lp = _tmpV2.copy(p).sub(col.c).applyQuaternion(col.qi);
    const h = col.h;
    const cx = Math.min(Math.max(lp.x, -h.x), h.x);
    const cy = Math.min(Math.max(lp.y, -h.y), h.y);
    const cz = Math.min(Math.max(lp.z, -h.z), h.z);
    let nx = lp.x - cx, ny = lp.y - cy, nz = lp.z - cz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 1e-6 && !preferFace) {
      nx /= l; ny /= l; nz /= l;
      outPoint.set(cx, cy, cz);
    } else {
      // dentro ou sobre a face: normal da face mais próxima
      const qx = Math.abs(lp.x) - h.x, qy = Math.abs(lp.y) - h.y, qz = Math.abs(lp.z) - h.z;
      nx = ny = nz = 0;
      outPoint.set(cx, cy, cz);
      if (qx >= qy && qx >= qz) { nx = lp.x >= 0 ? 1 : -1; outPoint.x = nx * h.x; }
      else if (qy >= qz) { ny = lp.y >= 0 ? 1 : -1; outPoint.y = ny * h.y; }
      else { nz = lp.z >= 0 ? 1 : -1; outPoint.z = nz * h.z; }
    }
    outNormal.set(nx, ny, nz).applyQuaternion(col.q);
    outPoint.applyQuaternion(col.q).add(col.c);
  }

  // Physics.SphereCast(origin, radius, direction, out hit, maxDistance)
  sphereCast(origin, radius, direction, maxDist, hit) {
    const len = direction.length();
    if (len < 1e-9 || !(maxDist >= 0)) return false;
    const dx = direction.x / len, dy = direction.y / len, dz = direction.z / len;
    const ex = origin.x + dx * maxDist, ey = origin.y + dy * maxDist, ez = origin.z + dz * maxDist;
    const minx = Math.min(origin.x, ex) - radius, maxx = Math.max(origin.x, ex) + radius;
    const miny = Math.min(origin.y, ey) - radius, maxy = Math.max(origin.y, ey) + radius;
    const minz = Math.min(origin.z, ez) - radius, maxz = Math.max(origin.z, ez) + radius;

    let best = Infinity, bestCol = null;
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      if (col.enabled === false) continue; // ex.: porta do elevador aberta
      if (col.min.x > maxx || col.max.x < minx || col.min.y > maxy || col.max.y < miny || col.min.z > maxz || col.max.z < minz) continue;
      // como no Unity: colisores já sobrepostos no início são ignorados
      if (this.sdf(col, origin.x, origin.y, origin.z) < radius) continue;
      let t;
      if (col.type === 'sphere') {
        t = raySphere(origin.x, origin.y, origin.z, dx, dy, dz, col.c.x, col.c.y, col.c.z, col.r + radius);
      } else {
        _tmpV.set(origin.x - col.c.x, origin.y - col.c.y, origin.z - col.c.z).applyQuaternion(col.qi);
        _o[0] = _tmpV.x; _o[1] = _tmpV.y; _o[2] = _tmpV.z;
        _tmpV.set(dx, dy, dz).applyQuaternion(col.qi);
        _d[0] = _tmpV.x; _d[1] = _tmpV.y; _d[2] = _tmpV.z;
        _h[0] = col.h.x; _h[1] = col.h.y; _h[2] = col.h.z;
        t = rayRoundedBox(_o, _d, _h, radius);
      }
      if (t <= maxDist && t < best) { best = t; bestCol = col; }
    }
    if (!bestCol) return false;
    hit.distance = best;
    hit.collider = bestCol;
    const center = _tmpV.set(origin.x + dx * best, origin.y + dy * best, origin.z + dz * best);
    this.surfaceInfo(bestCol, center, hit.point, hit.normal, radius <= 0);
    return true;
  }

  // Physics.Raycast(origin, direction, out hit, maxDistance)
  raycast(origin, direction, maxDist, hit) {
    return this.sphereCast(origin, 0, direction, maxDist, hit);
  }

  // contatos de uma esfera sobreposta (para a física do corpo / rigidbody)
  sphereContacts(center, radius, cb) {
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      if (col.enabled === false) continue;
      if (col.min.x > center.x + radius || col.max.x < center.x - radius ||
          col.min.y > center.y + radius || col.max.y < center.y - radius ||
          col.min.z > center.z + radius || col.max.z < center.z - radius) continue;
      const sd = this.sdf(col, center.x, center.y, center.z);
      if (sd < radius) cb(col, radius - sd);
    }
  }
}
