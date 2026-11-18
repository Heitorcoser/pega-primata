// Jogador local: o "rig" (origem do espaço de rastreamento) + cabeça/mãos rastreadas
// + física de corpo rígido (equivalente ao Rigidbody do Unity com gravidade).
// Colisores iguais ao prefab oficial: cabeça = esfera r 0.15; corpo = cápsula r 0.15,
// altura 0.5, presa na cabeça com deslocamento local (0, -0.24, -0.06 no Unity).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.81;
const FRICTION = 0.6; // atrito padrão do Unity

export class LocalPlayer {
  constructor(world, rig) {
    this.world = world;
    this.rig = rig; // THREE.Group com a câmera dentro
    this.rigPosition = rig.position;
    this.velocity = new THREE.Vector3();
    this.headLocal = new THREE.Vector3();
    this.headLocalQuat = new THREE.Quaternion();
    this.handLocal = [new THREE.Vector3(-0.2, -0.3, -0.3), new THREE.Vector3(0.2, -0.3, -0.3)]; // 0 = esquerda
    this.handLocalQuat = [new THREE.Quaternion(), new THREE.Quaternion()];
    this.handOffset = [new THREE.Vector3(), new THREE.Vector3()]; // leftHandOffset/rightHandOffset (0 no prefab)
    this.headRadius = 0.15;
    this.bodyRadius = 0.15;
    this.bodyHalfSegment = 0.1; // (altura 0.5 - 2*raio) / 2
    this.bodyOffset = new THREE.Vector3(0, -0.24, 0.06); // em three.js "frente" é -Z
    this.bodyFollowsPitch = true; // VR: igual ao original. PC: só yaw (senão olhar p/ baixo levanta o corpo)
    this._t = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._yaw = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._spheres = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  headWorld(out) {
    return out.copy(this.headLocal).applyQuaternion(this.rig.quaternion).add(this.rig.position);
  }
  headWorldQuat(out) {
    return out.copy(this.rig.quaternion).multiply(this.headLocalQuat);
  }
  headYaw() {
    this.headWorldQuat(this._q);
    this._e.setFromQuaternion(this._q, 'YXZ');
    return this._e.y;
  }
  handWorld(isLeft, out) {
    const i = isLeft ? 0 : 1;
    out.copy(this.handOffset[i]).applyQuaternion(this.handLocalQuat[i]).add(this.handLocal[i]);
    return out.applyQuaternion(this.rig.quaternion).add(this.rig.position);
  }
  handWorldQuat(isLeft, out) {
    return out.copy(this.rig.quaternion).multiply(this.handLocalQuat[isLeft ? 0 : 1]);
  }
  bodyCenter(out) {
    this.headWorld(out);
    if (this.bodyFollowsPitch) this.headWorldQuat(this._q);
    else this._q.setFromAxisAngle(UP, this.headYaw());
    return out.add(this._t.copy(this.bodyOffset).applyQuaternion(this._q));
  }

  // Player.Turn: gira o rig em volta da cabeça
  turnRig(degrees) {
    const head = this.headWorld(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(degrees));
    this.rig.position.sub(head).applyQuaternion(q).add(head);
    this.rig.quaternion.premultiply(q);
  }

  // coloca a cabeça num ponto do mundo, olhando para "yaw"
  placeHeadAt(pos, yaw = null) {
    if (yaw !== null) {
      this._e.setFromQuaternion(this.headLocalQuat, 'YXZ');
      this.rig.quaternion.setFromAxisAngle(UP, yaw - this._e.y);
    }
    this.rig.position.copy(pos).sub(this._t.copy(this.headLocal).applyQuaternion(this.rig.quaternion));
    this.velocity.set(0, 0, 0);
  }

  // Rigidbody: gravidade + colisões da cabeça e da cápsula do corpo, com atrito
  stepBody(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.velocity.y -= GRAVITY * h;
      this.rig.position.addScaledVector(this.velocity, h);
      for (let it = 0; it < 3; it++) if (!this._depenetrate()) break;
    }
  }

  _depenetrate() {
    const sp = this._spheres;
    this.headWorld(sp[0]);
    this.bodyCenter(sp[2]);
    sp[1].copy(sp[2]); sp[1].y += this.bodyHalfSegment;
    sp[3].copy(sp[2]); sp[3].y -= this.bodyHalfSegment;
    const radii = [this.headRadius, this.bodyRadius, this.bodyRadius, this.bodyRadius];
    let any = false;
    const shift = this._t.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const c = this._p.copy(sp[i]).add(shift);
      this.world.sphereContacts(c, radii[i], (col, depth) => {
        const n = this._n;
        this.world.surfaceInfo(col, c, new THREE.Vector3(), n, false);
        // se o centro estiver dentro, surfaceInfo já devolve a normal da face mais próxima
        shift.addScaledVector(n, depth);
        c.addScaledVector(n, depth);
        const vn = this.velocity.dot(n);
        if (vn < 0) {
          this.velocity.addScaledVector(n, -vn);
          // atrito de Coulomb no componente tangencial
          const tx = this.velocity.x, ty = this.velocity.y, tz = this.velocity.z;
          const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
          const drop = FRICTION * -vn;
          if (vt <= drop) this.velocity.set(0, 0, 0);
          else this.velocity.multiplyScalar(1 - drop / vt);
        }
        any = true;
      });
    }
    if (any) this.rig.position.add(shift);
    return any;
  }
}
