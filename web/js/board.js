// Quadro no mundo (sala, jogadores, quem está pegando, versão) + botões de tocar com a mão.
import * as THREE from 'three';

export class Board {
  constructor(scene, physics, pos) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.rotation.y = Math.PI; // virado para os jogadores (para -Z)
    scene.add(this.group);

    const frameMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.12), frameMat);
    frame.position.set(0, 1.05, 0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 1.38), new THREE.MeshBasicMaterial({ map: this.tex }));
    screen.position.set(0, 1.05, 0.065);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), frameMat);
    legL.position.set(-1.1, 0.15, 0);
    const legR = legL.clone(); legR.position.x = 1.1;
    this.group.add(frame, screen, legL, legR);
    this.group.updateMatrixWorld(true);
    physics.addBox(frame.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1.25, 0.75, 0.06),
      frame.getWorldQuaternion(new THREE.Quaternion()), { name: 'wood' });

    this.buttons = [];
    this.lastPress = 0;
    this.info = { room: '-', players: [], status: 'offline', version: '', mode: '', seed: '', floorLine: '', accent: '#2fd6b0' };
    this.draw();
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
  }

  addButton(label, x, color, onPress) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#' + new THREE.Color(color).getHexString();
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshLambertMaterial({ color });
    const front = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.21, 0.08), [side, side, side, side, front, side]);
    mesh.position.set(x, 0.42, 0.25);
    this.group.add(mesh);
    this.group.updateMatrixWorld(true);
    const btn = { mesh, onPress, center: mesh.getWorldPosition(new THREE.Vector3()), pressedAt: 0 };
    this.buttons.push(btn);
    return btn;
  }

  // mãos (posições no mundo) tocando botões?
  checkPress(handPositions, now) {
    for (const b of this.buttons) {
      const restZ = 0.25;
      const pressed = handPositions.some((h) =>
        Math.abs(h.x - b.center.x) < 0.27 && Math.abs(h.y - b.center.y) < 0.16 && Math.abs(h.z - b.center.z) < 0.14);
      if (pressed && now - this.lastPress > 600) {
        this.lastPress = now;
        b.pressedAt = now;
        b.onPress();
      }
      b.mesh.position.z = restZ - (now - b.pressedAt < 200 ? 0.04 : 0);
    }
  }

  set(info) {
    Object.assign(this.info, info);
    this.draw();
  }

  draw() {
    const g = this.ctx, i = this.info;
    g.fillStyle = '#0c1216';
    g.fillRect(0, 0, 1024, 600);
    g.fillStyle = i.accent;
    g.fillRect(0, 0, 1024, 8);
    g.font = 'bold 54px system-ui, sans-serif';
    g.fillText('ESTAÇÃO ZERO', 30, 68);
    g.font = '24px system-ui, sans-serif';
    g.fillStyle = '#9fb2bc';
    g.fillText(`Sala ${i.room}  •  semente ${i.seed}  •  ${i.status}  •  v${i.version}`, 32, 106);
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText(i.floorLine, 32, 156);
    g.font = '28px system-ui, sans-serif';
    g.fillStyle = i.accent;
    g.fillText(i.mode, 32, 196);
    g.font = 'bold 28px system-ui, sans-serif';
    const list = i.players.length ? i.players : [{ name: 'Você (solo)', color: '#8b5a2b', me: false, caught: i.soloCaught || 0 }];
    list.slice(0, 10).forEach((p, k) => {
      const col = k < 5 ? 0 : 1, row = k % 5;
      const x = 40 + col * 490, y = 252 + row * 56;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x + 16, y - 9, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(`${p.name}${p.me ? ' (você)' : ''}`, x + 44, y);
      if (p.caught) { g.fillStyle = '#ff7a6a'; g.fillText(`pego ${p.caught}×`, x + 330, y); }
    });
    g.font = '22px system-ui, sans-serif';
    g.fillStyle = '#7f949e';
    g.fillText('Caixas com faixa amarela e mezaninos = seguro. Elevadores = zona segura.', 32, 548);
    if (i.controls) { g.fillStyle = '#9fd0ff'; g.fillText(`🎮 ${i.controls}`, 32, 582); }
    this.tex.needsUpdate = true;
  }
}
