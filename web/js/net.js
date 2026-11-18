// Cliente de rede (WebSocket). Reconecta sozinho; sem servidor o jogo roda solo.
import { DEFAULT_SERVER } from './config.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.myId = null;
    this.retry = 0;
    this.joinInfo = null;
    this.wantOpen = false;
  }

  static serverUrl() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    }
    return DEFAULT_SERVER; // file:// (EXE offline) usa o servidor configurado
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  connect(joinInfo) {
    this.joinInfo = joinInfo;
    this.wantOpen = true;
    this._open();
  }

  rejoin(joinInfo) {
    this.joinInfo = joinInfo;
    if (this.connected) this.send({ t: 'join', ...joinInfo });
    else this._open();
  }

  _open() {
    const url = Net.serverUrl();
    if (!url) { this.emit('status', 'offline'); return; }
    try { this.ws?.close(); } catch { /* */ }
    this.emit('status', 'conectando');
    let ws;
    try { ws = new WebSocket(url); } catch { this._scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.emit('status', 'online');
      this.send({ t: 'join', ...this.joinInfo });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') this.myId = msg.id;
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.emit('status', 'offline');
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose cuida */ };
  }

  _scheduleRetry() {
    if (!this.wantOpen) return;
    this.retry = Math.min(this.retry + 1, 6);
    setTimeout(() => this._open(), 1000 * this.retry);
  }

  send(obj) {
    if (this.connected && this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
