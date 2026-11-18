// Servidor do Pega Primata: serve os arquivos do jogo (pasta ../web) e o multiplayer
// por WebSocket em /ws. Modo: Estação Zero (fuga cooperativa de um labirinto com babuínos).
// A IA dos monstros e as regras (amostras, elevadores, andares) rodam AQUI, com o mesmo
// código do jogo solo (web/js/shared), para todos verem os mesmos monstros.
// Um único deploy (ex.: Render) = site do jogo + servidor; APK e EXE carregam daqui.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const WEB = path.resolve(__dirname, '..', 'web');
const MAX_PLAYERS = 10;
const TICK_MS = 50;
const DEAD_MS = 2600; // depois de pego, o jogador fica fora da IA enquanto renasce

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (url === '/diag' && req.method === 'POST') { handleDiag(req, res); return; }
  if (url.endsWith('/')) url += 'index.html';
  const file = path.resolve(WEB, '.' + url);
  if (!file.startsWith(WEB + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache', // sempre revalida => atualizações chegam na hora
    });
    fs.createReadStream(file).pipe(res);
  });
});

// diagnóstico da entrada no VR: só imprime nos logs do servidor (Render → Logs)
const diagCount = new Map();
setInterval(() => diagCount.clear(), 60000);
function handleDiag(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const n = (diagCount.get(ip) || 0) + 1;
  diagCount.set(ip, n);
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    res.writeHead(204).end();
    if (n > 120) return;
    try {
      const j = JSON.parse(body);
      console.log('[diag]', JSON.stringify(j).replace(/[\r\n]/g, ' ').slice(0, 1200));
    } catch { /* ignorado */ }
  });
}

// ------------------------------------------------------------------ salas
const rooms = new Map();
let nextId = 1;
let FloorGame = null; // carregado do módulo compartilhado (ESM)

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// cada sala nasce com uma semente aleatória => labirinto diferente a cada partida
function newRoom(code, isPublic) {
  const r = { code, isPublic, players: new Map(), game: new FloorGame() };
  rooms.set(code, r);
  return r;
}
function getRoom(code) {
  if (code) return rooms.get(code) || newRoom(code, false);
  for (const r of rooms.values()) if (r.isPublic && r.players.size < MAX_PLAYERS) return r;
  let c; do { c = makeCode(); } while (rooms.has(c));
  return newRoom(c, true);
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { const s = JSON.stringify(obj); for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }

function sendRoster(room) {
  broadcast(room, {
    t: 'roster', room: room.code,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, caught: p.caught })),
  });
}
const sendProgress = (room) => broadcast(room, { t: 'prog', ...room.game.progress() });

function leave(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  p.room = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  sendRoster(room);
}

function cleanStr(s, max, fallback) {
  s = String(s ?? '').replace(/[<>\n\r\t]/g, '').trim().slice(0, max);
  return s || fallback;
}
const cleanColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#8b5a2b');
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  const p = { id: nextId++, ws, name: 'Macaco', color: '#8b5a2b', s: null, room: null, alive: true, deadUntil: 0, caught: 0 };
  ws.on('pong', () => { p.alive = true; });

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      leave(p);
      p.name = cleanStr(m.name, 14, 'Macaco');
      p.color = cleanColor(m.color);
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      let room = getRoom(code);
      if (room.players.size >= MAX_PLAYERS) room = getRoom(''); // sala cheia → pública
      p.room = room;
      p.s = null;
      p.caught = 0;
      p.deadUntil = Date.now() + 1500; // tempo para carregar o andar
      room.players.set(p.id, p);
      send(ws, { t: 'welcome', id: p.id, room: room.code });
      send(ws, { t: 'prog', ...room.game.progress() });
      sendRoster(room);
      return;
    }
    const room = p.room;
    if (!room) return;

    if (m.t === 's' && finite(m.d, 13)) p.s = m.d;
    else if (m.t === 'meta') {
      p.name = cleanStr(m.name, 14, p.name);
      p.color = cleanColor(m.color);
      sendRoster(room);
    } else if (m.t === 'pick' && Number.isInteger(m.id) && p.s && m.level === room.game.levelId) {
      // valida com a mão mais perto que o servidor conhece
      const hands = [{ x: p.s[7], y: p.s[8], z: p.s[9] }, { x: p.s[10], y: p.s[11], z: p.s[12] }];
      const s = room.game.st.samples.find((x) => x.id === m.id);
      if (!s) return;
      const hand = hands.reduce((a, b) => (Math.hypot(a.x - s.x, a.y - s.y, a.z - s.z) < Math.hypot(b.x - s.x, b.y - s.y, b.z - s.z) ? a : b));
      if (room.game.pick(m.id, hand)) {
        broadcast(room, { t: 'picked', id: m.id, by: p.id });
        sendProgress(room);
      }
    }
  });

  ws.on('close', () => leave(p));
  ws.on('error', () => leave(p));
});

// laço do servidor: IA dos monstros + regras + estados
let lastTick = Date.now();
function tick() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of rooms.values()) {
    const g = room.game;
    const alive = [];
    for (const p of room.players.values()) if (p.s && now > p.deadUntil) alive.push({ id: p.id, x: p.s[0], y: p.s[1], z: p.s[2] });
    const events = g.update(dt, alive);
    let progressChanged = false;
    for (const e of events) {
      if (e.type === 'caught') {
        const victim = room.players.get(e.playerId);
        if (!victim) continue;
        victim.deadUntil = now + DEAD_MS;
        victim.caught++;
        broadcast(room, { t: 'caught', id: e.playerId, by: e.monsterId });
        sendRoster(room);
      } else if (e.type === 'spotted') {
        broadcast(room, { t: 'spotted', id: e.playerId, by: e.monsterId });
      } else if (e.type === 'level') {
        for (const p of room.players.values()) { p.deadUntil = now + 2000; p.s = null; }
        progressChanged = true;
      } else if (e.type === 'progress' || e.type === 'tick') progressChanged = true;
    }
    if (progressChanged) sendProgress(room);
    const ps = [];
    for (const p of room.players.values()) if (p.s) ps.push([p.id, ...p.s]);
    broadcast(room, { t: 'snap', p: ps, m: g.won ? [] : g.sim.snapshot(), lv: g.levelId });
  }
}

// derruba conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    const p = [...rooms.values()].flatMap((r) => [...r.players.values()]).find((x) => x.ws === ws);
    if (p && !p.alive) { ws.terminate(); continue; }
    if (p) p.alive = false;
    try { ws.ping(); } catch { /* */ }
  }
}, 15000);

// carrega as regras compartilhadas (módulos ES do jogo) e sobe o servidor
import(pathToFileURL(path.join(WEB, 'js', 'shared', 'game.js')).href).then((mod) => {
  FloorGame = mod.FloorGame;
  setInterval(tick, TICK_MS);
  server.listen(PORT, () => console.log(`Pega Primata rodando em http://localhost:${PORT}`));
}).catch((e) => { console.error('Falha ao carregar o jogo compartilhado:', e); process.exit(1); });
