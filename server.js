/* =========================================================================
   DASH DUEL — herní server
   - obsluhuje statické soubory (index.html, game.js, style.css)
   - poskytuje WebSocket propojení dvou hráčů přes kód místnosti
   Bez externích závislostí: minimalistická implementace WebSocketu v čistém Node.
   Spuštění:  node server.js   (volitelně PORT=xxxx)
   ========================================================================= */
'use strict';

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT = process.env.PORT || 8000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
};

// ---------- Statický HTTP server ----------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  // ochrana proti path traversal
  const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(__dirname, safe);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Minimalistický WebSocket ----------
class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._fireClose());
    socket.on('error', () => this._fireClose());
  }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    // zpracuj tolik kompletních rámců, kolik jich v bufferu je
    while (this._parseFrame()) { /* loop */ }
  }
  _parseFrame() {
    if (this.buf.length < 2) return false;
    const b1 = this.buf[1];
    const opcode = this.buf[0] & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (this.buf.length < 4) return false;
      len = this.buf.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (this.buf.length < 10) return false;
      len = Number(this.buf.readBigUInt64BE(2)); off = 10;
    }
    let mask;
    if (masked) {
      if (this.buf.length < off + 4) return false;
      mask = this.buf.slice(off, off + 4); off += 4;
    }
    if (this.buf.length < off + len) return false;

    let payload = this.buf.slice(off, off + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    this.buf = this.buf.slice(off + len);

    if (opcode === 0x8) { this.close(); return false; }       // close
    if (opcode === 0x9) { this._frameSend(payload, 0xA); return true; } // ping -> pong
    if (opcode === 0x1 && this.onmessage) this.onmessage(payload.toString('utf8')); // text
    return true;
  }
  _frameSend(payload, opcode) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch (_) { /* ignore */ }
  }
  send(str) { this._frameSend(Buffer.from(str, 'utf8'), 0x1); }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this._frameSend(Buffer.alloc(0), 0x8); this.socket.end(); } catch (_) {}
    this._fireClose();
  }
  _fireClose() {
    if (this._closedFired) return;
    this._closedFired = true;
    this.closed = true;
    if (this.onclose) this.onclose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  handleConnection(new WS(socket));
});

// ---------- Logika místností ----------
const rooms = new Map();

function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // bez I/O kvůli záměně
  const D = '23456789';                  // bez 0/1
  let c = '';
  for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
  for (let i = 0; i < 2; i++) c += D[Math.floor(Math.random() * D.length)];
  return c;
}

function newSeed() { return (Math.random() * 2147483647) | 0; }

function send(ws, obj) { if (ws && !ws.closed) ws.send(JSON.stringify(obj)); }

function startRound(room) {
  room.seed = newSeed();
  room.rematch.clear();
  send(room.host,  { t: 'start', seed: room.seed, role: 'host' });
  send(room.guest, { t: 'start', seed: room.seed, role: 'guest' });
}

function handleConnection(ws) {
  ws.room = null;
  ws.role = null;

  ws.onmessage = (str) => {
    let m; try { m = JSON.parse(str); } catch (_) { return; }

    if (m.t === 'create') {
      let code; do { code = genCode(); } while (rooms.has(code));
      const room = { code, host: ws, guest: null, seed: newSeed(), rematch: new Set() };
      rooms.set(code, room);
      ws.room = room; ws.role = 'host';
      send(ws, { t: 'created', code });

    } else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room)        return send(ws, { t: 'error', msg: 'Hra s tímto kódem neexistuje.' });
      if (room.guest)   return send(ws, { t: 'error', msg: 'Tato hra je už plná.' });
      room.guest = ws; ws.room = room; ws.role = 'guest';
      startRound(room);

    } else if (m.t === 'state') {
      const room = ws.room; if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, { t: 'peer', s: m.s });

    } else if (m.t === 'rematch') {
      const room = ws.room; if (!room) return;
      room.rematch.add(ws.role);
      const peer = ws.role === 'host' ? room.guest : room.host;
      send(peer, { t: 'peer_rematch' });
      if (room.rematch.has('host') && room.rematch.has('guest') && room.host && room.guest) {
        startRound(room);
      }
    }
  };

  ws.onclose = () => {
    const room = ws.room; if (!room) return;
    const peer = ws.role === 'host' ? room.guest : room.host;
    send(peer, { t: 'peer_left' });
    rooms.delete(room.code);
  };
}

server.listen(PORT, () => {
  console.log(`\n  🎮  Dash Duel běží na  http://localhost:${PORT}`);
  console.log(`      (na stejné WiFi otevři na druhém zařízení http://<IP-tohoto-PC>:${PORT})\n`);
});
