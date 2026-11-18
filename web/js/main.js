import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { ArmLocomotion } from './locomotion.js';
import { LocalPlayer } from './player.js';
import { Avatar } from './avatar.js';
import { DesktopControls } from './desktop.js';
import { XRInput } from './xr.js';
import { setupPcVr, controllerName } from './pcvr.js';
import { diag } from './diag.js';
import { Net } from './net.js';
import { Board } from './board.js';
import { initAudio, playTap, sfx, setListener, playAt, startAmbient, setHeart, audioTick, jumpscare } from './audio.js';
import { generateFloor } from './shared/station.js';
import { FLOORS, SAMPLES_PER_FLOOR, objectiveText, floorSeed } from './shared/levels.js';
import { FloorGame } from './shared/game.js';
import { STATE } from './shared/monsterai.js';
import { buildStation } from './station3d.js';
import { Ape } from './ape3d.js';
import { NPC } from './npc3d.js';

const COLORS = ['#8b5a2b', '#4a4a4a', '#d8d8d8', '#2e86de', '#27ae60', '#8e44ad', '#f1c40f', '#16a085', '#ff6fb5', '#6d4c41', '#5dade2', '#a3e048'];
const PICK_DIST = 0.3;
const SOLO_ID = 1;

const store = {
  get(k, d) { try { return localStorage.getItem('pp_' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pp_' + k, v); } catch { /* sem storage */ } },
};
const $ = (id) => document.getElementById(id);

// ---------- render / cena ----------
// O contexto WebGL já nasce compatível com XR. Sem isso, ao entrar no VR o three.js chama
// makeXRCompatible(), que no Chrome/Edge com OpenXR (SteamVR, Quest Link) pode trocar o
// contexto da GPU e travar a página ("A página não está respondendo") — three.js #30505.
const canvas = document.createElement('canvas');
const glAttrs = {
  alpha: false, depth: true, stencil: false, antialias: true, premultipliedAlpha: true,
  preserveDrawingBuffer: false, powerPreference: 'high-performance', xrCompatible: !!navigator.xr,
};
const gl = canvas.getContext('webgl2', glAttrs);
const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, powerPreference: 'high-performance' });
canvas.addEventListener('webglcontextlost', () => diag.step('context-lost'));
canvas.addEventListener('webglcontextrestored', () => diag.step('context-restored'));
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation?.(1);
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050808);
scene.fog = new THREE.Fog(0x050808, 5, 26);
scene.add(new THREE.HemisphereLight(0x8a98aa, 0x141414, 0.45));

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.02, 120);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
// lanterna na cabeça
const flashlight = new THREE.SpotLight(0xfff0d8, 22, 16, 0.55, 0.5, 1.3);
flashlight.position.set(0.05, -0.05, 0);
flashlight.target.position.set(0, -0.12, -1);
camera.add(flashlight, flashlight.target);
// véu vermelho do susto (funciona também dentro do VR)
const scareVeil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }));
scareVeil.renderOrder = 999;
camera.add(scareVeil);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const physics = new PhysicsWorld();

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

desktop.yaw = 0;
desktop.update(0, { wasLeftHandTouching: false, wasRightHandTouching: false });
player.bodyFollowsPitch = false;
const loco = new ArmLocomotion(physics, player, { maxJumpSpeed: 6.5, jumpMultiplier: 1.1 });

const localAvatar = new Avatar(myColor, myName, true);
scene.add(localAvatar.root);

const tapCooldown = [0, 0];
loco.onHandTouch = (isLeft, col) => {
  const i = isLeft ? 0 : 1;
  const now = performance.now();
  if (now - tapCooldown[i] < 90) return;
  tapCooldown[i] = now;
  playTap(col?.surface?.name || 'metal', 0.4);
  if (mode === 'vr') xr.haptic(isLeft ? 'left' : 'right', 0.25, 25);
};

// ---------- andar (labirinto) ----------
let st = null, level = null, board = null, npc = null;
let prog = null;          // progresso atual vindo do servidor (ou do jogo solo)
let curKey = '';          // semente+andar carregados
let localGame = null;     // jogo solo (sem servidor)
let soloCaught = 0;
const apes = new Map();   // id -> visual do monstro

function floorInfo(f) { return FLOORS[Math.min(f, FLOORS.length - 1)]; }

function loadLevel(seed, floor) {
  const key = `${seed}:${floor}`;
  if (key === curKey) return;
  curKey = key;
  level?.dispose(); board?.dispose(); npc?.dispose();
  for (const a of apes.values()) scene.remove(a.ape.root);
  apes.clear();
  physics.clear();
  const fi = Math.min(floor, FLOORS.length - 1);
  st = localGame && localGame.seed === seed && Math.min(localGame.floor, FLOORS.length - 1) === fi ? localGame.st : generateFloor(floorSeed(seed, fi));
  const theme = floorInfo(floor);
  level = buildStation(scene, physics, st, fi);
  scene.background.set(theme.fog);
  scene.fog.color.set(theme.fog);
  board = new Board(scene, physics, level.boardPos);
  board.addButton('◀ COR', -0.55, 0x2e86de, () => cycleColor(-1));
  board.addButton('COR ▶', 0, 0x2e86de, () => cycleColor(1));
  board.addButton('SALA', 0.55, 0x27ae60, () => { myRoom = ''; store.set('room', ''); net.rejoin(joinInfo()); });
  board.set({ accent: '#' + new THREE.Color(theme.accent).getHexString(), version: bootVersion || '' });
  npc = new NPC(theme.npc);
  npc.root.position.copy(level.npcPos);
  scene.add(npc.root);
  respawn();
  if (floor > 0) {
    sfx.floorUp();
    fade(`ANDAR ${floor + 1} · ${theme.name.toUpperCase()}`);
  }
  store.set('best', String(Math.max(+store.get('best', '0'), Math.min(floor + 1, FLOORS.length))));
  renderProgressMenu();
}

function respawn() {
  if (!st) return;
  const s = st.spawns[Math.floor(Math.random() * st.spawns.length)];
  const pos = new THREE.Vector3(s.x, 0.62, s.z);
  if (mode === 'vr') player.placeHeadAt(pos, 0);
  else { desktop.yaw = 0; desktop.pitch = 0; desktop.update(0, loco); player.placeHeadAt(pos); }
  loco.initializeValues();
}

// aplica progresso (amostras, porta, contagem, troca de andar)
function applyProgress(p) {
  const prev = prog;
  prog = p;
  loadLevel(p.seed, Math.min(p.floor, FLOORS.length - 1));
  for (const id of p.collected) level.collectSample(id);
  level.setExitOpen(p.exitOpen);
  if (p.exitOpen && prev && !prev.exitOpen && prev.levelId === p.levelId) { sfx.elevatorOpen(); flash('🔓 O elevador de saída abriu!'); }
  if (p.countdown >= 0 && p.countdown !== prev?.countdown) sfx.countdown();
  if (p.won && !prev?.won) {
    store.set('wins', String(+store.get('wins', '0') + 1));
    store.set('best', String(FLOORS.length));
    renderProgressMenu();
    sfx.floorUp();
  }
  $('victory').classList.toggle('hidden', !p.won);
  const theme = floorInfo(p.floor);
  const obj = objectiveText(p.floor, p.collected.length, p.exitOpen);
  npc.extra = p.won ? 'Vocês conseguiram! Uma nova estação está sendo preparada...' : obj + '.';
  board.set({
    room: online ? currentRoom : 'SOLO', seed: p.seed,
    players: online ? roster.map((r) => ({ ...r, me: r.id === net.myId })) : [],
    floorLine: p.won ? 'VOCÊS ESCAPARAM!' : `Andar ${p.floor + 1}/${FLOORS.length} · ${theme.name} · ${theme.monster.label} ×${theme.monster.count}`,
    mode: p.countdown >= 0 ? `Elevador subindo em ${p.countdown}s...` : obj,
    soloCaught,
  });
  refreshHud();
}

function refreshHud() {
  if (!prog) return;
  const t = floorInfo(prog.floor);
  const lock = prog.exitOpen ? '🔓 saída aberta' : '🔒 saída trancada';
  $('hud-status').textContent = prog.won ? '🏁 Vocês escaparam!' : `Andar ${prog.floor + 1} · ${t.name} • 🧪 ${prog.collected.length}/${SAMPLES_PER_FLOOR} • ${lock}`;
  $('hud-count').textContent = prog.countdown >= 0 ? `⬆ ${prog.countdown}` : '';
}

// ---------- quadro / cores ----------
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
let roster = [];
let online = false;
let currentRoom = '-';
const joinInfo = () => ({ name: myName, color: myColor, room: myRoom });
const myId = () => (online ? net.myId : SOLO_ID);

function startSolo() {
  online = false;
  localGame = new FloorGame();
  curKey = '';
  applyProgress(localGame.progress());
}

net.on('status', (s) => {
  board?.set({ status: s });
  $('net-status').textContent = s;
  if (s === 'offline') {
    roster = [];
    for (const r of remotes.values()) r.avatar.dispose();
    remotes.clear();
    if (online || !localGame) startSolo();
  }
});
net.on('welcome', (m) => { currentRoom = m.room; board?.set({ room: m.room }); });
net.on('prog', (m) => {
  if (!online) { online = true; localGame = null; }
  applyProgress(m);
});
net.on('roster', (m) => {
  currentRoom = m.room;
  if (board) board.info.room = m.room;
  roster = m.players;
  const seen = new Set();
  for (const p of m.players) {
    if (p.id === net.myId) continue;
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) {
      r = {
        avatar: new Avatar(p.color, p.name), has: false,
        head: new THREE.Vector3(), quat: new THREE.Quaternion(), l: new THREE.Vector3(), r: new THREE.Vector3(),
        th: new THREE.Vector3(), tq: new THREE.Quaternion(), tl: new THREE.Vector3(), tr: new THREE.Vector3(),
        name: p.name, color: p.color,
      };
      r.avatar.root.visible = false;
      scene.add(r.avatar.root);
      remotes.set(p.id, r);
    }
    if (r.color !== p.color) { r.color = p.color; r.avatar.setColor(p.color); }
    if (r.name !== p.name) { r.name = p.name; r.avatar.setName(p.name); }
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { r.avatar.dispose(); remotes.delete(id); }
  board?.set({ players: roster.map((p) => ({ ...p, me: p.id === net.myId })) });
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
  if (prog && m.lv === prog.levelId) for (const d of m.m) setMonster(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8], d[9], false);
});
net.on('caught', (m) => { if (m.id === net.myId) onCaught(m.by); else growlAt(m.by); });
net.on('spotted', (m) => { if (m.id === net.myId) spottedBy(m.by); });
net.on('picked', (m) => { if (m.by === net.myId) sfx.pickup(); else sfx.countdown(); });

function sendState() {
  const h = player.headWorld(new THREE.Vector3());
  const q = player.headWorldQuat(new THREE.Quaternion());
  const l = loco.lastLeftHandPosition, r = loco.lastRightHandPosition;
  const f = (v) => Math.round(v * 1000) / 1000;
  net.send({ t: 's', d: [h.x, h.y, h.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, r.x, r.y, r.z].map(f) });
}

// ---------- monstros (visual) ----------
function setMonster(id, x, z, yaw, state, speed, lx, ly, lz, target, snap) {
  let a = apes.get(id);
  if (!a) {
    const ape = new Ape(floorInfo(prog?.floor || 0).monster);
    scene.add(ape.root);
    a = { ape, x, z, yaw, tx: x, tz: z, tyaw: yaw, state, speed, look: new THREE.Vector3(lx, ly, lz), target, growlT: 3 + Math.random() * 6 };
    ape.onStep = (pos, run, front) => { if (front) playAt('step', pos, 0.55 + run * 0.7); };
    apes.set(id, a);
  }
  a.tx = x; a.tz = z; a.tyaw = yaw; a.speed = speed; a.target = target;
  if (a.state !== state && state === STATE.chase) playAt('screech', new THREE.Vector3(x, 1, z), 0.9);
  a.state = state;
  a.look.set(lx, ly, lz);
  if (snap) { a.x = x; a.z = z; a.yaw = yaw; }
}
function growlAt(monsterId) {
  const a = apes.get(monsterId);
  if (a) playAt('growl', new THREE.Vector3(a.x, 1, a.z), 1);
}
function spottedBy(monsterId) {
  const a = apes.get(monsterId);
  if (a) playAt('screech', new THREE.Vector3(a.x, 1, a.z), 1);
  flash('🐒 Ele te viu! CORRE!');
}

// ---------- ser pego: susto + volta ao elevador ----------
let scare = null;
function onCaught(monsterId) {
  if (scare) return;
  scare = { t: 0, id: monsterId };
  jumpscare();
  if (mode === 'vr') { xr.haptic('left', 1, 700); xr.haptic('right', 1, 700); }
  else $('app').classList.add('shake'); // tremor da tela só no PC (no VR daria enjoo)
  const el = $('scare');
  el.className = 'flash';
  setTimeout(() => { if (scare) el.className = 'hold'; }, 70);
  setTimeout(() => { if (scare) el.className = 'black'; }, SCARE.hold * 1000);
}
// Susto: o babuíno dá o bote e a CARA dele para enquadrada a ~38 cm dos olhos,
// rugindo e tremendo; depois corta para o preto e você volta ao elevador.
const SCARE = { lunge: 0.14, hold: 0.95, black: 1.25, end: 1.55 };
const faceLight = new THREE.PointLight(0xff8a5c, 0, 2.2, 1.5);
scene.add(faceLight);
const _sv = new THREE.Vector3(), _sf = new THREE.Vector3();
let unfade = 0;
function updateScare(dt, head, headQuat) {
  const veil = scareVeil.material;
  if (!scare) {
    if (unfade > 0) { unfade = Math.max(0, unfade - dt / 0.45); veil.color.set(0x000000); veil.opacity = unfade; }
    else veil.opacity = 0;
    faceLight.intensity = 0;
    return;
  }
  scare.t += dt;
  const t = scare.t;
  // monstro que pegou (ou o mais perto, se ainda não chegou o snapshot dele)
  let a = apes.get(scare.id);
  if (!a) { let best = Infinity; for (const x of apes.values()) { const d = Math.hypot(x.x - head.x, x.z - head.z); if (d < best) { best = d; a = x; } } }
  const fwd = _sf.set(0, 0, -1).applyQuaternion(headQuat).setY(0).normalize();
  if (a && t < SCARE.black) {
    const e = Math.min(1, t / SCARE.lunge);
    const dist = THREE.MathUtils.lerp(1.7, 0.62, 1 - (1 - e) * (1 - e));
    const shake = t > SCARE.lunge ? 0.025 : 0;
    const target = _sv.copy(head).addScaledVector(fwd, dist);
    target.x += (Math.random() - 0.5) * shake + fwd.z * 0.08; target.y += (Math.random() - 0.5) * shake - 0.04; target.z += (Math.random() - 0.5) * shake - fwd.x * 0.08;
    const R = a.ape.root;
    R.visible = true;
    R.rotation.y = Math.atan2(-fwd.x, -fwd.z) + 0.5; // 3/4: mostra o focinho longo e a boca
    // posiciona pelo deslocamento cabeça→raiz (medido no quadro anterior) e corrige
    a.scareOff ??= new THREE.Vector3(0, 1.45 * (a.ape.v.scale || 1), 0.1);
    R.position.copy(target).sub(a.scareOff);
    a.ape.update(dt, 0, STATE.attack, head);
    // pose de rugido: cabeça para trás e boca escancarada virada para você
    a.ape.jawOpen = 1;
    a.ape.jaw.rotation.x = 0.8 + Math.sin(t * 38) * 0.06;
    a.ape.head.rotation.set(-0.12 + Math.sin(t * 27) * 0.05, Math.sin(t * 19) * 0.06, Math.sin(t * 31) * 0.12, 'YXZ');
    R.updateMatrixWorld(true);
    a.ape.head.getWorldPosition(_sv);
    a.scareOff.copy(_sv).sub(R.position);
    R.position.copy(target).sub(a.scareOff);
    faceLight.position.copy(head).addScaledVector(fwd, 0.15).add(new THREE.Vector3(0, -0.75, 0)); // luz de baixo, longe
    faceLight.intensity = 0.9;
    flashlight.intensity = 5;
  }
  // flash branco no bote, depois nada (o rosto é o show), depois corte para o preto
  if (t < 0.07) { veil.color.set(0xffffff); veil.opacity = 0.75; }
  else if (t < SCARE.hold) { veil.color.set(0x330000); veil.opacity = 0.12; }
  else { veil.color.set(0x000000); veil.opacity = Math.min(1, (t - SCARE.hold) / (SCARE.black - SCARE.hold)); }
  if (t > SCARE.black && !scare.respawned) {
    scare.respawned = true;
    faceLight.intensity = 0;
    flashlight.intensity = 22;
    if (!online) soloCaught++;
    respawn();
    if (prog) board.set({ soloCaught });
  }
  if (t > SCARE.end) {
    scare = null;
    unfade = 1;
    $('scare').className = '';
    $('app').classList.remove('shake');
    flash('Você foi pego! Voltou para o elevador.');
  }
}

// ---------- UI (menu / HUD) ----------
function flash(text) {
  const el = $('flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove('show'), 2600);
}
function fade(text) {
  const el = $('fade');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(fade.t);
  fade.t = setTimeout(() => el.classList.remove('show'), 1800);
}
function renderProgressMenu() {
  const best = +store.get('best', '0'), wins = +store.get('wins', '0');
  const dots = FLOORS.map((f, k) => `<span class="pfloor${k < best ? ' done' : ''}" style="--c:#${new THREE.Color(f.accent).getHexString()}">${k + 1}. ${f.name}</span>`).join('');
  $('progress').innerHTML = `<div class="plabel">Seu progresso</div><div class="prow">${dots}</div><div class="plabel">Fugas completas: <b>${wins}</b></div>`;
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
renderProgressMenu();
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
  startAmbient();
  applyMenuInputs();
  mode = 'desktop';
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  desktop.setEnabled(true);
  desktop.lock();
};

let savedHead = new THREE.Vector3(), savedYaw = 0, needsRecenter = false, xrStarting = false;
$('play-vr').onclick = async () => {
  initAudio();
  startAmbient();
  applyMenuInputs();
  // headset ligado depois que a página abriu => contexto não é compatível com XR.
  // Em vez de arriscar o makeXRCompatible (que pode travar no PC), recarrega uma vez.
  if (gl.getContextAttributes()?.xrCompatible === false && !urlParams.has('xrfix')) {
    const u = new URL(location.href);
    u.searchParams.set('vr', '1');
    u.searchParams.set('xrfix', '1');
    u.searchParams.set('name', myName);
    u.searchParams.set('color', myColor);
    u.searchParams.set('room', myRoom);
    flash('Preparando o VR... clique em "Entrar no VR" de novo.');
    setTimeout(() => location.replace(u.toString()), 600);
    return;
  }
  player.headWorld(savedHead);
  savedYaw = player.headYaw();
  diag.start(gl);
  xrStarting = true;
  try {
    await xr.start(onVrEnd);
  } catch (e) {
    diag.step('start-failed', { msg: String(e?.message || e).slice(0, 200), name: e?.name });
    flash('Não foi possível entrar no VR: ' + e.message + ' — confira se o SteamVR/Link está aberto e é o runtime OpenXR ativo.');
    return;
  } finally {
    xrStarting = false;
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
  getMode: () => (xrStarting ? 'vr' : mode),
  getJoin: () => { applyMenuInputs(); return joinInfo(); },
});
// vigia do VR: sem quadros em 5 s => sai e o próximo clique usa o modo compatível
xr.onNoFrames = (wasCompat) => {
  setTimeout(() => flash(wasCompat
    ? 'O VR não recebeu imagem do SteamVR/Link. Feche e abra o SteamVR e tente de novo.'
    : 'Ajustando o VR para o seu PC... clique em "Entrar no VR" de novo.'), 300);
};
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
      board?.set({ version: j.version });
    } else if (j.version !== bootVersion && !pendingUpdate) {
      pendingUpdate = true;
      if (mode === 'vr') board?.set({ mode: `Atualização v${j.version} pronta — saia do VR para atualizar` });
      else { flash(`Nova versão v${j.version}! Atualizando...`); setTimeout(() => location.reload(), 3000); }
    }
  } catch { /* sem rede */ }
}
checkVersion();
setInterval(checkVersion, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// começa jogando solo (fundo do menu e modo sem servidor); ao conectar, segue o servidor
startSolo();

// ---------- laço principal ----------
const clock = new THREE.Clock();
const tmpH = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpF = new THREE.Vector3();
let sendAcc = 0;

// Um erro dentro do laço não pode matar o laço de VR (no three.js, se o callback lançar
// exceção, o próximo quadro nunca é pedido e o SteamVR acusa "não está respondendo").
let loopErrors = 0;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(Math.max(clock.getDelta(), 1e-4), 0.05);
  if (window.__pp?.paused) return; // depuração: simulação manual
  try {
    tick(time, frame, dt);
  } catch (e) {
    if (loopErrors++ < 3) {
      console.error(e);
      diag.step('loop-error', { msg: String(e?.message || e).slice(0, 200), stack: String(e?.stack || '').slice(0, 400) });
    }
    try { renderer.render(scene, camera); } catch { /* nada a fazer */ }
  }
});

function tick(time, frame, dt) {
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
    if (board && ctl !== board.info.controls) board.set({ controls: ctl });
  } else {
    desktop.update(dt, loco);
  }

  if (!(mode === 'vr' && needsRecenter) && !scare) {
    player.stepBody(dt);   // FixedUpdate (Rigidbody)
    loco.update(dt);       // Update (Player.cs)
  }

  const head = player.headWorld(tmpH);
  const headQuat = player.headWorldQuat(tmpQ);
  if (head.y < -5) respawn();

  if (mode !== 'vr') {
    camera.position.copy(player.headLocal);
    camera.quaternion.copy(player.headLocalQuat);
  }
  localAvatar.setPose(head, headQuat, loco.lastLeftHandPosition, loco.lastRightHandPosition);
  board?.checkPress([loco.lastLeftHandPosition, loco.lastRightHandPosition], now);

  // jogo solo: roda as mesmas regras/IA do servidor aqui mesmo
  if (localGame && !online) {
    const alive = scare ? [] : [{ id: SOLO_ID, x: head.x, y: head.y, z: head.z }];
    const lvBefore = localGame.levelId;
    const events = localGame.update(dt, alive);
    for (const e of events) {
      if (e.type === 'caught') onCaught(e.monsterId);
      if (e.type === 'spotted') spottedBy(e.monsterId);
    }
    if (events.some((e) => e.type === 'level' || e.type === 'tick' || e.type === 'progress') || localGame.levelId !== lvBefore) applyProgress(localGame.progress());
    if (localGame.levelId === prog?.levelId) for (const m of localGame.sim.monsters) setMonster(m.id, m.x, m.z, m.yaw, m.state, m.speed, m.look.x, m.look.y, m.look.z, m.target || 0, true);
  }

  // amostras: encoste a mão para pegar
  if (prog && !prog.won && st) {
    for (const s of st.samples) {
      if (prog.collected.includes(s.id)) continue;
      const sy = s.y + 0.1;
      const hit = [loco.lastLeftHandPosition, loco.lastRightHandPosition].find((h) => Math.hypot(h.x - s.x, h.y - sy, h.z - s.z) < PICK_DIST);
      if (!hit) continue;
      if (online) {
        // manda a posição da mão antes, para o servidor validar com a posição atual
        if (!s.sentAt || now - s.sentAt > 300) { s.sentAt = now; sendState(); net.send({ t: 'pick', id: s.id, level: prog.levelId }); }
      } else if (localGame.pick(s.id, hit)) {
        sfx.pickup();
        flash(`🧪 Amostra coletada! (${localGame.collected.size}/${SAMPLES_PER_FLOOR})`);
        applyProgress(localGame.progress());
      }
    }
  }

  // monstros: interpolação + animação procedural + sons
  let heart = 0, chased = false;
  const k = 1 - Math.exp(-dt * 12);
  for (const [id, a] of apes) {
    if (scare && scare.id === id && scare.t < SCARE.black) continue;
    const px = a.x, pz = a.z;
    a.x += (a.tx - a.x) * k; a.z += (a.tz - a.z) * k;
    let dy = a.tyaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * k;
    const moved = Math.hypot(a.x - px, a.z - pz) / dt;
    a.vel = (a.vel ?? 0) + (moved - (a.vel ?? 0)) * 0.2;
    a.ape.root.position.set(a.x, 0, a.z);
    a.ape.root.rotation.y = a.yaw;
    a.ape.root.visible = !prog?.won;
    a.ape.update(dt, Math.min(a.vel, a.speed + 0.5), a.state, a.look);
    const d = Math.hypot(a.x - head.x, a.z - head.z);
    if (a.target === myId() && (a.state === STATE.chase || a.state === STATE.wait)) { chased = true; heart = Math.max(heart, 1 - d / 16); }
    a.growlT -= dt;
    if (a.growlT < 0 && d < 16) { a.growlT = 5 + Math.random() * 8; playAt('growl', new THREE.Vector3(a.x, 1, a.z), 0.7); }
  }
  setHeart(Math.max(0, heart));
  $('hud-warn').classList.toggle('show', chased);

  // NPC olha para o jogador mais perto e fala
  npc?.update(dt, head);
  level?.update(dt);
  updateScare(dt, head, headQuat);

  // outros jogadores (interpolação suave)
  const kr = 1 - Math.exp(-dt * 14);
  for (const r of remotes.values()) {
    if (!r.has) continue;
    r.head.lerp(r.th, kr); r.quat.slerp(r.tq, kr); r.l.lerp(r.tl, kr); r.r.lerp(r.tr, kr);
    r.avatar.setPose(r.head, r.quat, r.l, r.r);
  }

  // ouvido 3D = cabeça do jogador
  setListener(head, tmpF.set(0, 0, -1).applyQuaternion(headQuat));
  audioTick();

  sendAcc += dt;
  if (sendAcc >= 0.05) { sendAcc = 0; sendState(); }

  renderer.render(scene, camera);
}

// para depuração no console
window.__pp = {
  player, loco, desktop, physics, net, THREE, renderer, scene, camera, remotes, apes, paused: false,
  get st() { return st; }, get game() { return localGame; }, get prog() { return prog; }, onCaught,
  // avança a simulação manualmente (testes): n quadros de dt segundos
  sim(n, dt = 1 / 60) {
    for (let i = 0; i < n; i++) tick(0, null, dt);
  },
};
