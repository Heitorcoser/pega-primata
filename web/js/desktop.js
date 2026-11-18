// Controles de PC: o MESMO motor de locomoção por braços é usado, mas as mãos são
// animadas automaticamente. WASD faz as mãos "remarem" contra a superfície à frente
// (chão, parede, galho) e o corpo é empurrado exatamente como no VR; Espaço empurra o
// chão para pular; clique esquerdo/direito dá um tapa (serve para pegar os outros).
//
// Cada mão é uma máquina de estados:  rest → reach (mira) → plant (apoia) → pull (puxa
// enquanto grudada) → back (volta) → rest.  As posições são relativas à cabeça.
import * as THREE from 'three';
import { Hit } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);

export class DesktopControls {
  constructor(player, physics, dom) {
    this.player = player;
    this.physics = physics;
    this.dom = dom;
    this.yaw = Math.PI;
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.hands = [this._newHand(-1), this._newHand(1)];
    this.strokeTimer = 0;
    this.nextHand = 0;
    this.jumpCooldown = 0;
    this._hit = new Hit();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._f = new THREE.Vector3();
    this._yawQ = new THREE.Quaternion();
    this._camQ = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    this.dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.slap(0);
      if (e.button === 2) this.slap(1);
    });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _newHand(side) {
    return {
      side,
      local: new THREE.Vector3(side * 0.22, -0.3, -0.3),
      target: new THREE.Vector3(),
      state: 'rest', t: 0,
      anchor: new THREE.Vector3(),     // ponto de apoio (relativo à cabeça no início da remada)
      normal: new THREE.Vector3(0, 1, 0),
      pull: new THREE.Vector3(),       // direção em que a mão é puxada (corpo vai ao contrário)
      jump: false,
    };
  }

  lock() {
    try { this.dom.requestPointerLock()?.catch?.(() => {}); } catch { /* ignorado */ }
  }
  setEnabled(v) { this.enabled = v; if (!v) this.keys.clear(); }
  slap(i) { const h = this.hands[i]; h.state = 'slap'; h.t = 0; }

  update(dt, loco) {
    const p = this.player;
    this._e.set(this.pitch, this.yaw, 0, 'YXZ');
    this._camQ.setFromEuler(this._e);
    p.headLocal.set(0, 0, 0);
    p.headLocalQuat.copy(this._camQ);
    p.rig.quaternion.identity(); // no PC o rig não gira: a orientação fica toda na cabeça
    this._yawQ.setFromAxisAngle(UP, this.yaw);
    if (!dt) { this._apply(); return; }

    const k = this.keys;
    const mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const mz = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    const moving = this.enabled && (mx !== 0 || mz !== 0);
    const intent = this._f.set(mx, 0, mz);
    if (moving) intent.normalize().applyQuaternion(this._yawQ);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const pullSpeed = sprint ? 4.6 : 3.4;   // m/s da mão puxando = velocidade do corpo
    const strokeEvery = sprint ? 0.2 : 0.25; // alterna as mãos

    // pulo: as duas mãos apoiam no chão e empurram para baixo
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (this.enabled && k.has('Space') && this.jumpCooldown <= 0) {
      this.jumpCooldown = 0.45;
      const head = p.headWorld(new THREE.Vector3());
      for (const h of this.hands) {
        if (h.state === 'slap') continue;
        this._aim(h, head, -1.25, moving ? intent : null);
        h.jump = true;
        h.pull.set(0, -1, 0); // mão empurra para baixo => corpo sobe
        if (moving) h.pull.addScaledVector(intent, -0.6);
        h.pull.normalize();
        h.state = 'reach'; h.t = 0;
      }
    }

    // começa remadas alternadas
    if (moving) {
      this.strokeTimer -= dt;
      if (this.strokeTimer <= 0) {
        const h = this.hands[this.nextHand];
        if (h.state === 'rest' || h.state === 'back') {
          const head = p.headWorld(new THREE.Vector3());
          const a = Math.max(-1.2, Math.min(1.0, this.pitch - 0.42)); // mira um pouco abaixo do olhar
          this._aim(h, head, a, intent);
          // corpo deve ir = intenção + viés para cima, projetado na superfície (parede => escala)
          const desired = this._v.copy(intent).addScaledVector(UP, 0.9);
          desired.addScaledVector(h.normal, -desired.dot(h.normal));
          if (desired.lengthSq() < 1e-6) desired.copy(intent);
          h.pull.copy(desired).normalize().negate();
          h.jump = false;
          h.state = 'reach'; h.t = 0;
          this.nextHand = 1 - this.nextHand;
          this.strokeTimer = strokeEvery;
        }
      }
    } else {
      this.strokeTimer = 0;
    }

    const head = p.headWorld(new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const touching = i === 0 ? loco.wasLeftHandTouching : loco.wasRightHandTouching;
      const rest = this._w.set(h.side * 0.22, -0.28, -0.3).applyQuaternion(this._yawQ);
      h.t += dt;
      let direct = false; // true = posição definida diretamente (sem limite de velocidade)
      let speed = 8;      // velocidade máx. da mão (m/s) rumo ao alvo

      switch (h.state) {
        case 'reach': // vai até um pouco acima do ponto de apoio
          h.target.copy(h.anchor).addScaledVector(h.normal, 0.08);
          if (touching) { h.state = 'pull'; h.t = 0; }
          else if (h.local.distanceTo(h.target) < 0.04 || h.t > 0.2) { h.state = 'plant'; h.t = 0; }
          break;
        case 'plant': // desce reto na superfície
          h.target.copy(h.local).addScaledVector(h.normal, -0.5);
          speed = 2.5;
          if (touching) { h.state = 'pull'; h.t = 0; h.target.copy(h.local); }
          else if (h.t > 0.12) { h.state = 'back'; h.t = 0; }
          break;
        case 'pull': {
          const dur = h.jump ? 0.14 : 0.24;
          if (touching) {
            // mão grudada: move a mão (relativa ao corpo), como um braço de verdade;
            // o motor de locomoção empurra o corpo para o lado contrário
            // (+ leve pressão contra a superfície: no original, mão que só desliza paralela solta)
            h.local.addScaledVector(h.pull, (h.jump ? 3.0 : pullSpeed) * dt).addScaledVector(h.normal, -0.08 * dt);
            direct = true;
          } else {
            h.target.copy(h.local).addScaledVector(h.normal, -0.3); // perdeu contato: pressiona
            speed = 1.5;
          }
          if (h.t > dur) { h.state = 'back'; h.t = 0; }
          break;
        }
        case 'back':
          h.target.copy(rest).y += 0.1;
          if (h.local.distanceTo(h.target) < 0.05) { h.state = 'rest'; h.t = 0; }
          break;
        case 'slap': {
          const fw = this._v.set(h.side * 0.12, -0.05, -0.85).applyQuaternion(this._camQ);
          h.target.copy(h.t < 0.16 ? fw : rest);
          if (h.t > 0.32) { h.state = 'rest'; h.t = 0; }
          break;
        }
        default:
          h.target.copy(rest);
      }

      if (!direct) {
        // mão se move com velocidade limitada (não teleporta, senão quebraria o "grudar")
        const maxStep = speed * dt;
        const delta = this._v.copy(h.target).sub(h.local);
        const d = delta.length();
        if (d > maxStep) delta.multiplyScalar(maxStep / d);
        h.local.add(delta);
      }
      if (h.local.length() > 1.45) h.local.setLength(1.45);
    }
    this._apply();
  }

  _apply() {
    for (let i = 0; i < 2; i++) {
      this.player.handLocal[i].copy(this.hands[i].local);
      this.player.handLocalQuat[i].copy(this._yawQ);
    }
  }

  // mira: lança um raio a partir da cabeça para achar a superfície de apoio
  _aim(h, head, angle, intent) {
    const fwd = intent ? intent.clone() : new THREE.Vector3(0, 0, -1).applyQuaternion(this._yawQ);
    const side = new THREE.Vector3().crossVectors(fwd, UP).normalize().multiplyScalar(h.side * 0.22);
    const dir = new THREE.Vector3();
    // tenta o ângulo mirado; se não alcançar nada, vai abaixando até achar onde apoiar
    for (let a = angle; a >= -1.3; a -= 0.2) {
      dir.copy(fwd).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).add(side).normalize();
      if (this.physics.raycast(head, dir, 1.4, this._hit)) {
        h.anchor.copy(this._hit.point).sub(head);
        h.normal.copy(this._hit.normal);
        return;
      }
    }
    h.anchor.copy(dir).multiplyScalar(0.9);
    h.normal.set(0, 1, 0);
  }
}
