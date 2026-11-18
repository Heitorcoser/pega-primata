// Servidor do Pega Primata: serve os arquivos do jogo (pasta ../web) e o multiplayer
// por WebSocket em /ws. Modo de jogo: infecção (quem é pego passa a pegar também).
// Um único deploy (ex.: Render) = site do jogo + servidor. Cada deploy novo atualiza
// automaticamente o APK do Quest e o EXE, porque os dois carregam o jogo deste servidor.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const WEB = path.resolve(__dirname, '..', 'web');
const MAX_PLAYERS = 10;
const TICK_MS = 50;
const ROUND_END_MS = 4000;
const GRACE_MS = 3000;

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
      const safe = JSON.stringify(j).replace(/[\r\n]/g, ' ').slice(0, 1200);
      console.log('[diag]', safe);
    } catch { /* ignorado */ }
  });
}

// ------------------------------------------------------------------ salas
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

function getRoom(code) {
  if (code) {
    if (!rooms.has(code)) rooms.set(code, { code, isPublic: false, players: new Map(), state: 'waiting', endAt: 0 });
    return rooms.get(code);
  }
  for (const r of rooms.values()) if (r.isPublic && r.players.size < MAX_PLAYERS) return r;
  let c; do { c = makeCode(); } while (rooms.has(c));
  const r = { code: c, isPublic: true, players: new Map(), state: 'waiting', endAt: 0 };
  rooms.set(c, r);
  return r;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { const s = JSON.stringify(obj); for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }

function sendRoster(room) {
  broadcast(room, {
    t: 'roster', room: room.code, state: room.state,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, inf: p.inf })),
  });
}

function pickInfected(room) {
  const list = [...room.players.values()];
  for (const p of list) p.inf = false;
  if (list.length < 2) { room.state = 'waiting'; return; }
  list[Math.floor(Math.random() * list.length)].inf = true;
  room.state = 'playing';
  room.startedAt = Date.now();
  broadcast(room, { t: 'round', state: 'start' });
}

function updateRound(room) {
  const list = [...room.players.values()];
  if (room.state === 'ending') return;
  if (list.length < 2) {
    if (room.state !== 'waiting') { room.state = 'waiting'; for (const p of list) p.inf = false; }
    return;
  }
  const infected = list.filter((p) => p.inf).length;
  if (room.state === 'waiting' || infected === 0) { pickInfected(room); return; }
  if (infected === list.length) {
    room.state = 'ending';
    room.endAt = Date.now() + ROUND_END_MS;
    broadcast(room, { t: 'round', state: 'end' });
  }
}

function leave(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  p.room = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  updateRound(room);
  sendRoster(room);
}

function cleanStr(s, max, fallback) {
  s = String(s ?? '').replace(/[<>\n\r\t]/g, '').trim().slice(0, max);
  return s || fallback;
}
const cleanColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#8b5a2b');
const finite = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e4);
const dist = (s, i, t, j) => Math.hypot(s[i] - t[j], s[i + 1] - t[j + 1], s[i + 2] - t[j + 2]);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  const p = { id: nextId++, ws, name: 'Macaco', color: '#8b5a2b', inf: false, s: null, room: null, alive: true, lastTag: 0 };
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
      p.inf = false;
      p.s = null;
      room.players.set(p.id, p);
      send(ws, { t: 'welcome', id: p.id, room: room.code });
      updateRound(room);
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
    } else if (m.t === 'tag') {
      const target = room.players.get(m.id);
      const now = Date.now();
      if (room.state !== 'playing' || !target || target === p || !p.inf || target.inf || now - p.lastTag < 300) return;
      if (now - (room.startedAt || 0) < GRACE_MS) return; // proteção no começo da rodada
      if (!p.s || !target.s) return;
      // validação folgada (latência): mão/cabeça do pegador perto da cabeça do alvo
      const near = Math.min(dist(p.s, 7, target.s, 0), dist(p.s, 10, target.s, 0), dist(p.s, 0, target.s, 0));
      if (near > 1.6) return;
      p.lastTag = now;
      target.inf = true;
      broadcast(room, { t: 'tagged', id: target.id, by: p.id });
      updateRound(room);
      sendRoster(room);
    }
  });

  ws.on('close', () => leave(p));
  ws.on('error', () => leave(p));
});

// snapshots + fim de rodada
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state === 'ending' && now >= room.endAt) {
      room.state = 'waiting';
      updateRound(room);
      sendRoster(room);
    }
    const ps = [];
    for (const p of room.players.values()) if (p.s) ps.push([p.id, ...p.s]);
    if (ps.length) broadcast(room, { t: 'snap', p: ps });
  }
}, TICK_MS);

// derruba conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    const p = [...rooms.values()].flatMap((r) => [...r.players.values()]).find((x) => x.ws === ws);
    if (p && !p.alive) { ws.terminate(); continue; }
    if (p) p.alive = false;
    try { ws.ping(); } catch { /* */ }
  }
}, 15000);

server.listen(PORT, () => console.log(`Pega Primata rodando em http://localhost:${PORT}`));
