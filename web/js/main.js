import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { ArmLocomotion } from './locomotion.js';
import { LocalPlayer } from './player.js';
import { buildWorld } from './world.js';
import { Avatar } from './avatar.js';
import { DesktopControls } from './desktop.js';
import { XRInput } from './xr.js';
import { setupPcVr, controllerName } from './pcvr.js';
import { Net } from './net.js';
import { Board } from './board.js';
import { initAudio, playTap, sfx } from './audio.js';

// Velocidades do modo infecção: quem está pegando é mais rápido (valores conhecidos do jogo
// original: sobrevivente 6.5 / 1.1, pegador 8.5 / 1.3)
const SPEED = { survivor: { maxJumpSpeed: 6.5, jumpMultiplier: 1.1 }, infected: { maxJumpSpeed: 8.5, jumpMultiplier: 1.3 } };
const COLORS = ['#8b5a2b', '#4a4a4a', '#d8d8d8', '#2e86de', '#27ae60', '#8e44ad', '#f1c40f', '#16a085', '#ff6fb5', '#6d4c41', '#5dade2', '#a3e048'];
const TAG_DIST_HAND = 0.32;

const store = {
  get(k, d) { try { return localStorage.getItem('pp_' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pp_' + k, v); } catch { /* sem storage */ } },
};
const $ = (id) => document.getElementById(id);

// ---------- render / cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation?.(1);
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd6ff);
scene.fog = new THREE.Fog(0x9fd6ff, 35, 140);
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x45652a, 1.3));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.position.set(30, 50, 20);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.02, 260);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const physics = new PhysicsWorld();
const world = buildWorld(scene, physics);

// ---------- jogador ----------
const player = new LocalPlayer(physics, rig);
const desktop = new DesktopControls(player, physics, renderer.domElement);
const xr = new XRInput(renderer, player);
let mode = 'menu'; // menu | desktop | vr

// o EXE passa nome/cor/sala pela URL ao abrir o VR no navegador
const urlParams = new URLSearchParams(location.search);
const pColor = urlParams.get('color');
let myColor = (pColor && COLORS.includes(pColor)) ? pColor : store.get('color', COLORS[Math.floor(Math.random() * COLORS.length)]);
let myName = (urlParams.get('name') || '').slice(0, 14) || store.get('name', 'Macaco' + Math.floor(Math.random() * 900 + 100));
let myRoom = urlParams.has('room') ? urlParams.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : store.get('room', '');
const me = { inf: false };

desktop.yaw = Math.PI;
desktop.update(0, { wasLeftHandTouching: false, wasRightHandTouching: false });
player.bodyFollowsPitch = false;
player.placeHeadAt(world.spawns[Math.floor(Math.random() * world.spawns.length)]);
const loco = new ArmLocomotion(physics, player, SPEED.survivor);

const localAvatar = new Avatar(myColor, myName, true);
scene.add(localAvatar.root);

const tapCooldown = [0, 0];
loco.onHandTouch = (isLeft, col) => {
  const i = isLeft ? 0 : 1;
  const now = performance.now();
  if (now - tapCooldown[i] < 90) return;
  tapCooldown[i] = now;
  playTap(col?.surface?.name || 'grass', 0.45);
  if (mode === 'vr') xr.haptic(isLeft ? 'left' : 'right', 0.25, 25);
};

function respawn() {
  const s = world.spawns[Math.floor(Math.random() * world.spawns.length)];
  if (mode === 'vr') player.placeHeadAt(s, Math.PI);
  else { desktop.yaw = Math.PI; desktop.pitch = 0; desktop.update(0, loco); player.placeHeadAt(s); }
  loco.initializeValues();
}

// ---------- quadro ----------
const board = new Board(scene, physics, world.boardPos);
board.addButton('◀ COR', -0.55, 0x2e86de, () => cycleColor(-1));
board.addButton('COR ▶', 0, 0x2e86de, () => cycleColor(1));
board.addButton('SALA', 0.55, 0x27ae60, () => { myRoom = ''; store.set('room', ''); net.rejoin(joinInfo()); });

function cycleColor(d) {
  const i = (COLORS.indexOf(myColor) + d + COLORS.length) % COLORS.length;
  setColor(COLORS[i]);
  sfx.button();
}
function setColor(c) {
  myColor = c;
  store.set('color', c);
  localAvatar.setColor(c);
  renderSwatches();
  net.send({ t: 'meta', name: myName, color: myColor });
}

// ---------- rede ----------
const net = new Net();
const remotes = new Map();
let roundState = 'waiting';
let roster = [];
const joinInfo = () => ({ name: myName, color: myColor, room: myRoom });

function modeText() {
  if (roundState === 'playing') return me.inf ? 'Você está PEGANDO! Encoste nos outros.' : 'Fuja de quem está pegando (laranja)!';
  if (roundState === 'ending') return 'Todo mundo foi pego! Nova rodada...';
  return 'Esperando mais jogadores (mínimo 2)';
}

function refreshBoard() {
  board.set({
    room: board.info.room,
    players: roster.map((p) => ({ ...p, me: p.id === net.myId })),
    mode: modeText(),
  });
  const n = roster.length || 1;
  $('hud-status').textContent = `${board.info.room === '-' ? 'Solo' : 'Sala ' + board.info.room} • ${n} jogador${n > 1 ? 'es' : ''} • ${me.inf ? '🔥 PEGANDO' : roundState === 'playing' ? 'Sobrevivente' : 'Aguardando'}`;
  $('hud-status').classList.toggle('inf', me.inf);
}

function setInfected(v) {
  me.inf = v;
  Object.assign(loco.p, v ? SPEED.infected : SPEED.survivor);
  localAvatar.setInfected(v);
}

net.on('status', (s) => {
  board.set({ status: s });
  $('net-status').textContent = s;
  if (s === 'offline') { roster = []; for (const r of remotes.values()) r.avatar.dispose(); remotes.clear(); setInfected(false); roundState = 'waiting'; refreshBoard(); }
});
net.on('welcome', (m) => { board.set({ room: m.room }); });
net.on('roster', (m) => {
  board.info.room = m.room;
  roundState = m.state;
  roster = m.players;
  const seen = new Set();
  for (const p of m.players) {
    if (p.id === net.myId) { setInfected(p.inf); continue; }
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) {
      r = {
        avatar: new Avatar(p.color, p.name), has: false,
        head: new THREE.Vector3(), quat: new THREE.Quaternion(), l: new THREE.Vector3(), r: new THREE.Vector3(),
        th: new THREE.Vector3(), tq: new THREE.Quaternion(), tl: new THREE.Vector3(), tr: new THREE.Vector3(),
        name: p.name, color: p.color, inf: false, lastTagSent: 0,
      };
      r.avatar.root.visible = false;
      scene.add(r.avatar.root);
      remotes.set(p.id, r);
    }
    if (r.color !== p.color) { r.color = p.color; r.avatar.setColor(p.color); }
    if (r.name !== p.name) { r.name = p.name; r.avatar.setName(p.name); }
    if (r.inf !== p.inf) { r.inf = p.inf; r.avatar.setInfected(p.inf); }
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { r.avatar.dispose(); remotes.delete(id); }
  refreshBoard();
});
net.on('snap', (m) => {
  for (const d of m.p) {
    const r = remotes.get(d[0]);
    if (!r) continue;
    r.th.set(d[1], d[2], d[3]);
    r.tq.set(d[4], d[5], d[6], d[7]);
    r.tl.set(d[8], d[9], d[10]);
    r.tr.set(d[11], d[12], d[13]);
    if (!r.has) { r.has = true; r.head.copy(r.th); r.quat.copy(r.tq); r.l.copy(r.tl); r.r.copy(r.tr); r.avatar.root.visible = true; }
  }
});
net.on('tagged', (m) => {
  if (m.id === net.myId) {
    sfx.tagged();
    flash('Você foi pego! Agora é sua vez de pegar 🔥');
    if (mode === 'vr') { xr.haptic('left', 1, 250); xr.haptic('right', 1, 250); }
  } else if (m.by === net.myId) sfx.tagOther();
});
net.on('round', (m) => {
  if (m.state === 'start') { sfx.roundStart(); flash('Nova rodada!'); }
  if (m.state === 'end') sfx.roundEnd();
});

function sendState() {
  const h = player.headWorld(new THREE.Vector3());
  const q = player.headWorldQuat(new THREE.Quaternion());
  const l = loco.lastLeftHandPosition, r = loco.lastRightHandPosition;
  const f = (v) => Math.round(v * 1000) / 1000;
  net.send({ t: 's', d: [h.x, h.y, h.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, r.x, r.y, r.z].map(f) });
}

// ---------- UI (menu / HUD) ----------
function flash(text) {
  const el = $('flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function renderSwatches() {
  const wrap = $('swatches');
  wrap.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === myColor ? ' sel' : '');
    b.style.background = c;
    b.setAttribute('aria-label', 'cor ' + c);
    b.onclick = () => setColor(c);
    wrap.appendChild(b);
  }
}
renderSwatches();
$('name').value = myName;
$('room').value = myRoom;

let started = false;
function applyMenuInputs() {
  const n = $('name').value.trim().slice(0, 14) || myName;
  const r = $('room').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const changedRoom = r !== myRoom;
  myName = n; myRoom = r;
  store.set('name', n); store.set('room', r);
  localAvatar.setName(n);
  if (!started) { started = true; net.connect(joinInfo()); }
  else if (changedRoom) net.rejoin(joinInfo());
  else net.send({ t: 'meta', name: myName, color: myColor });
}

$('play-pc').onclick = () => {
  initAudio();
  applyMenuInputs();
  mode = 'desktop';
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  desktop.setEnabled(true);
  desktop.lock();
};

let savedHead = new THREE.Vector3(), savedYaw = Math.PI, needsRecenter = false;
$('play-vr').onclick = async () => {
  initAudio();
  applyMenuInputs();
  player.headWorld(savedHead);
  savedYaw = player.headYaw();
  try {
    await xr.start(onVrEnd);
  } catch (e) {
    flash('Não foi possível entrar no VR: ' + e.message);
    return;
  }
  mode = 'vr';
  desktop.setEnabled(false);
  player.bodyFollowsPitch = true; // igual ao original
  needsRecenter = true;
  $('menu').classList.add('hidden');
};

function onVrEnd() {
  player.headWorld(savedHead);
  savedYaw = player.headYaw();
  mode = 'menu';
  player.bodyFollowsPitch = false;
  player.headLocal.set(0, 0, 0);
  desktop.yaw = savedYaw; desktop.pitch = 0;
  desktop.update(0, loco);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  player.placeHeadAt(savedHead);
  loco.initializeValues();
  $('menu').classList.remove('hidden');
  if (pendingUpdate) location.reload();
}

desktop.onLockChange = (locked) => {
  if (mode !== 'desktop') return;
  if (!locked) {
    mode = 'menu';
    desktop.setEnabled(false);
    $('menu').classList.remove('hidden');
    $('play-pc').textContent = 'Continuar no PC';
    pcvr.refresh(); // headset pode ter sido ligado enquanto jogava
  } else pcvr.render();
};
addEventListener('keydown', (e) => { if (e.code === 'KeyR' && mode === 'desktop') respawn(); });

// ---------- VR no PC (detecção de headset) ----------
const pcvr = setupPcVr({
  startWebXR: () => $('play-vr').onclick(),
  getMode: () => mode,
  getJoin: () => { applyMenuInputs(); return joinInfo(); },
});
if (urlParams.get('vr') === '1') {
  flash('Clique em "Entrar no VR" e coloque o headset 🥽');
  $('play-vr').classList.add('pulse');
}

// ---------- atualização automática do conteúdo ----------
let bootVersion = null, pendingUpdate = false;
async function checkVersion() {
  if (location.protocol === 'file:') return; // EXE offline: o próprio app (Electron) se atualiza
  try {
    const r = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    if (!bootVersion) {
      bootVersion = j.version;
      $('version').textContent = 'v' + j.version;
      board.set({ version: j.version });
    } else if (j.version !== bootVersion && !pendingUpdate) {
      pendingUpdate = true;
      if (mode === 'vr') {
        board.set({ mode: `Atualização v${j.version} pronta — saia do VR para atualizar` });
      } else {
        flash(`Nova versão v${j.version}! Atualizando...`);
        setTimeout(() => location.reload(), 3000);
      }
    }
  } catch { /* sem rede */ }
}
checkVersion();
setInterval(checkVersion, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- laço principal ----------
const clock = new THREE.Clock();
const tmpH = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpB = new THREE.Vector3();
let sendAcc = 0;

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(Math.max(clock.getDelta(), 1e-4), 0.05);
  if (window.__pp?.paused) return; // depuração: simulação manual
  const now = performance.now();

  if (mode === 'vr') {
    const ok = xr.update(frame, loco);
    if (ok && needsRecenter) {
      needsRecenter = false;
      player.placeHeadAt(savedHead, savedYaw);
      loco.initializeValues();
    }
    if (xr.menuPressed) respawn();
    const ctl = controllerName(xr.profiles.right || xr.profiles.left);
    if (ctl !== board.info.controls) board.set({ controls: ctl });
  } else {
    desktop.update(dt, loco);
  }

  if (!(mode === 'vr' && needsRecenter)) {
    player.stepBody(dt);   // FixedUpdate (Rigidbody)
    loco.update(dt);       // Update (Player.cs)
  }

  const head = player.headWorld(tmpH);
  if (head.y < -12 || Math.abs(head.x) > 70 || Math.abs(head.z) > 70) respawn();

  if (mode !== 'vr') {
    camera.position.copy(player.headLocal);
    camera.quaternion.copy(player.headLocalQuat);
  }
  localAvatar.setPose(head, player.headWorldQuat(tmpQ), loco.lastLeftHandPosition, loco.lastRightHandPosition);
  board.checkPress([loco.lastLeftHandPosition, loco.lastRightHandPosition], now);

  // outros jogadores (interpolação suave)
  const k = 1 - Math.exp(-dt * 14);
  for (const [id, r] of remotes) {
    if (!r.has) continue;
    r.head.lerp(r.th, k); r.quat.slerp(r.tq, k); r.l.lerp(r.tl, k); r.r.lerp(r.tr, k);
    r.avatar.setPose(r.head, r.quat, r.l, r.r);
    // pegar: sou pegador e minha mão (ou cabeça) encostou num sobrevivente
    if (me.inf && !r.inf && roundState === 'playing' && now - r.lastTagSent > 400) {
      tmpB.copy(r.head); tmpB.y -= 0.27;
      const hands = [loco.lastLeftHandPosition, loco.lastRightHandPosition];
      const touch = hands.some((h) => h.distanceTo(r.head) < TAG_DIST_HAND || h.distanceTo(tmpB) < TAG_DIST_HAND + 0.05)
        || head.distanceTo(r.head) < 0.32;
      if (touch) { r.lastTagSent = now; net.send({ t: 'tag', id }); }
    }
  }

  sendAcc += dt;
  if (sendAcc >= 0.05) { sendAcc = 0; sendState(); }

  renderer.render(scene, camera);
});

// para depuração no console
window.__pp = {
  player, loco, desktop, physics, net, THREE, renderer, scene, camera, me, remotes, paused: false,
  // avança a simulação manualmente (testes): n quadros de dt segundos
  sim(n, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { desktop.update(dt, loco); player.stepBody(dt); loco.update(dt); }
    camera.position.copy(player.headLocal); camera.quaternion.copy(player.headLocalQuat);
    localAvatar.setPose(player.headWorld(new THREE.Vector3()), player.headWorldQuat(new THREE.Quaternion()), loco.lastLeftHandPosition, loco.lastRightHandPosition);
    renderer.render(scene, camera);
  },
};
