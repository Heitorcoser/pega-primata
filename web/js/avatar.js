// Personagem original: primata redondinho, rosto claro, orelhas laterais e braços esticados
// até as mãos (como em jogos de locomoção por braços, os braços vão de ombro até a mão).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const INFECTED_COLOR = 0xff5a1f;

const geo = {
  body: new THREE.SphereGeometry(0.2, 14, 10),
  head: new THREE.SphereGeometry(0.16, 16, 12),
  face: new THREE.SphereGeometry(0.115, 14, 10),
  eye: new THREE.SphereGeometry(0.032, 10, 8),
  pupil: new THREE.SphereGeometry(0.017, 8, 6),
  ear: new THREE.SphereGeometry(0.05, 10, 8),
  arm: (() => { const g = new THREE.CylinderGeometry(0.045, 0.055, 1, 8); g.translate(0, 0.5, 0); return g; })(),
  hand: new THREE.SphereGeometry(0.06, 12, 8),
};
const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(0.6, 0.15, 1);
  return s;
}

export class Avatar {
  constructor(color = 0x8b5a2b, name = '', isLocal = false) {
    this.root = new THREE.Group();
    this.isLocal = isLocal;
    this.bodyMat = new THREE.MeshLambertMaterial({ color });
    this.faceMat = new THREE.MeshLambertMaterial({ color: 0xf2d2b0 });
    this.handMat = new THREE.MeshLambertMaterial({ color });

    this.body = new THREE.Mesh(geo.body, this.bodyMat);
    this.body.scale.set(1, 1.25, 0.9);
    this.head = new THREE.Group();
    const headMesh = new THREE.Mesh(geo.head, this.bodyMat);
    const face = new THREE.Mesh(geo.face, this.faceMat);
    face.scale.set(1, 0.85, 0.55);
    face.position.set(0, -0.02, -0.11);
    this.head.add(headMesh, face);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(geo.eye, whiteMat);
      eye.position.set(sx * 0.05, 0.035, -0.13);
      const pupil = new THREE.Mesh(geo.pupil, blackMat);
      pupil.position.set(0, 0, -0.022);
      eye.add(pupil);
      const ear = new THREE.Mesh(geo.ear, this.faceMat);
      ear.position.set(sx * 0.16, 0.02, 0);
      ear.scale.set(0.5, 1, 1);
      this.head.add(eye, ear);
    }
    this.arms = [new THREE.Mesh(geo.arm, this.bodyMat), new THREE.Mesh(geo.arm, this.bodyMat)];
    this.hands = [new THREE.Mesh(geo.hand, this.handMat), new THREE.Mesh(geo.hand, this.handMat)];
    this.label = makeLabel(name);
    this.root.add(this.body, this.head, ...this.arms, ...this.hands, this.label);
    if (isLocal) { this.body.visible = false; this.head.visible = false; this.label.visible = false; }

    this.baseColor = new THREE.Color(color);
    this.infected = false;
    this._yawQ = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();
    this._sh = new THREE.Vector3();
  }

  setColor(color) {
    this.baseColor.set(color);
    this._applyColor();
  }
  setName(name) {
    this.root.remove(this.label);
    this.label.material.map.dispose();
    this.label = makeLabel(name);
    this.label.visible = !this.isLocal;
    this.root.add(this.label);
  }
  setInfected(v) {
    this.infected = v;
    this._applyColor();
  }
  _applyColor() {
    const c = this.infected ? new THREE.Color(INFECTED_COLOR) : this.baseColor;
    this.bodyMat.color.copy(c);
    this.handMat.color.copy(c).offsetHSL(0, 0, -0.08);
    this.bodyMat.emissive.set(this.infected ? 0x551100 : 0x000000);
  }

  // headPos/headQuat/hands em coordenadas de mundo
  setPose(headPos, headQuat, leftHand, rightHand) {
    this._e.setFromQuaternion(headQuat, 'YXZ');
    this._yawQ.setFromAxisAngle(UP, this._e.y);
    this.head.position.copy(headPos);
    this.head.quaternion.copy(headQuat);
    this.body.position.copy(headPos).add(this._v.set(0, -0.27, 0.06).applyQuaternion(this._yawQ));
    this.body.quaternion.copy(this._yawQ);
    this.label.position.copy(headPos).y += 0.3;
    const hands = [leftHand, rightHand];
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const shoulder = this._sh.set(sx * 0.17, -0.2, 0.04).applyQuaternion(this._yawQ).add(headPos);
      this.hands[i].position.copy(hands[i]);
      const dir = this._v.copy(hands[i]).sub(shoulder);
      const len = dir.length();
      this.arms[i].position.copy(shoulder);
      if (len > 1e-4) this.arms[i].quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
      this.arms[i].scale.set(1, Math.max(len - 0.04, 0.01), 1);
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.bodyMat.dispose(); this.faceMat.dispose(); this.handMat.dispose();
    this.label.material.map.dispose(); this.label.material.dispose();
  }
}
