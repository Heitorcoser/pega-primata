// NPC de cada andar: holograma de cientista ou robô de manutenção, com balão de fala.
import * as THREE from 'three';

function bubbleTexture(name, text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,14,20,0.88)';
  g.beginPath(); g.roundRect(6, 6, 500, 150, 22); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.moveTo(236, 156); g.lineTo(256, 186); g.lineTo(276, 156); g.fill();
  g.fillStyle = color; g.font = 'bold 28px system-ui, sans-serif'; g.fillText(name, 26, 46);
  g.fillStyle = '#eef6ff'; g.font = '24px system-ui, sans-serif';
  // quebra de linha simples
  const words = text.split(' ');
  let line = '', y = 84;
  for (const w of words) {
    if (g.measureText(line + w).width > 460) { g.fillText(line, 26, y); line = ''; y += 30; }
    line += w + ' ';
  }
  g.fillText(line, 26, y);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class NPC {
  constructor(cfg) {
    this.cfg = cfg;
    this.root = new THREE.Group();
    const color = new THREE.Color(cfg.color);
    this.parts = new THREE.Group();
    this.root.add(this.parts);
    if (cfg.style === 'robot') {
      const body = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.4 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.5 });
      this.screenMat = new THREE.MeshBasicMaterial({ color: 0x0b1a10 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 16), dark); base.position.y = 0.08;
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.32), body); torso.position.y = 0.48;
      const head = new THREE.Group(); head.position.y = 0.92;
      head.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.26, 0.28), body));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.17), this.screenMat); screen.position.z = 0.141;
      this.eyes = [];
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color }));
        e.position.set(sx * 0.06, 0.01, 0.143); head.add(e); this.eyes.push(e);
      }
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2), dark); ant.position.y = 0.23;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 })); tip.position.y = 0.34;
      head.add(screen, ant, tip);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12), dark); neck.position.y = 0.78;
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42), dark);
        arm.position.set(sx * 0.27, 0.48, 0.03); arm.rotation.z = sx * 0.15; this.parts.add(arm);
      }
      this.head = head;
      this.parts.add(base, torso, neck, head);
    } else {
      // holograma: figura translúcida com linhas de varredura
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
      this.holoMat = mat;
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, 0.9, 16, 1, true), mat); coat.position.y = 0.75;
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 4, 12), mat); torso.position.y = 1.15;
      const head = new THREE.Group(); head.position.y = 1.55;
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat));
      const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.02), mat); glasses.position.set(0, 0.01, 0.115);
      head.add(glasses);
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.45, 4, 8), mat);
        arm.position.set(sx * 0.21, 1.02, 0.02); arm.rotation.z = sx * 0.12; this.parts.add(arm);
      }
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.06, 24), new THREE.MeshBasicMaterial({ color: 0x1a2128 }));
      pad.position.y = 0.03;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 32), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.07;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 0.95;
      this.head = head;
      this.root.add(pad, ring, beam);
      this.parts.add(coat, torso, head);
    }
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.bubble.scale.set(1.1, 0.41, 1);
    this.bubble.position.y = cfg.style === 'robot' ? 1.45 : 2.05;
    this.root.add(this.bubble);
    this.lineIdx = 0;
    this.lineT = 0;
    this.time = 0;
    this.extra = null; // fala de progresso (ex.: "faltam 2 amostras")
    this.say(cfg.lines[0]);
  }

  say(text) {
    if (text === this.current) return;
    this.current = text;
    this.bubble.material.map?.dispose();
    this.bubble.material.map = bubbleTexture(this.cfg.name, text, '#' + new THREE.Color(this.cfg.color).getHexString());
    this.bubble.material.needsUpdate = true;
  }

  // nearest: posição da cabeça do jogador mais perto (ou null)
  update(dt, nearest) {
    this.time += dt;
    this.lineT += dt;
    const near = nearest && nearest.distanceTo(this.root.position) < 6;
    this.bubble.visible = !!near;
    if (near && this.lineT > 6) {
      this.lineT = 0;
      this.lineIdx = (this.lineIdx + 1) % (this.cfg.lines.length + (this.extra ? 1 : 0));
      this.say(this.lineIdx === this.cfg.lines.length ? this.extra : this.cfg.lines[this.lineIdx]);
    }
    if (nearest) {
      const yaw = Math.atan2(nearest.x - this.root.position.x, nearest.z - this.root.position.z);
      let d = yaw - this.parts.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.parts.rotation.y += d * (1 - Math.exp(-4 * dt));
    }
    if (this.holoMat) {
      this.holoMat.opacity = 0.38 + Math.sin(this.time * 9) * 0.05 + (Math.random() < 0.02 ? -0.25 : 0);
      this.parts.position.y = Math.sin(this.time * 1.5) * 0.02;
    } else {
      this.head.rotation.z = Math.sin(this.time * 1.7) * 0.06;
      for (const e of this.eyes) e.scale.y = (this.time % 4) < 0.12 ? 0.15 : 1; // pisca
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }
}
