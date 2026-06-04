/* =========================================================================
   DASH DUEL — souboj dvou hráčů ve stylu Geometry Dash
   - Hra na jednom zařízení (2 hráči) NEBO online na dvou zařízeních (přes kód)
   - Oba hráči stojí "pravou stranou nahoru" a skáčou NAHORU
   - Překážky jsou pro oba stejné (deterministické dle semínka) → férový závod
   - Obtížnost roste s ujetou vzdáleností (rychlost i hustota), běh není nekonečný
   ========================================================================= */

(() => {
  'use strict';

  // ----- Plátno -----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ----- DOM -----
  const screenMenu  = document.getElementById('screen-menu');
  const screenHost  = document.getElementById('screen-host');
  const screenJoin  = document.getElementById('screen-join');
  const overlay     = document.getElementById('overlay');
  const overlayText = document.getElementById('overlay-text');
  const overlayHint = document.getElementById('overlay-hint');
  const countdownEl = document.getElementById('countdown');
  const hostCodeEl  = document.getElementById('host-code');
  const hostStatus  = document.getElementById('host-status');
  const joinInput   = document.getElementById('join-code');
  const joinError   = document.getElementById('join-error');
  const hudTop      = document.getElementById('hud-top');
  const hudBottom   = document.getElementById('hud-bottom');
  const scoreTopEl  = document.getElementById('score-top');
  const scoreBotEl  = document.getElementById('score-bottom');
  const nameTopEl   = document.getElementById('name-top');
  const nameBotEl   = document.getElementById('name-bottom');
  const keyTopEl    = document.getElementById('key-top');
  const keyBotEl    = document.getElementById('key-bottom');

  // ----- Konstanty -----
  const GRAVITY      = 2600;   // px/s^2 (míří dolů u obou hráčů)
  const JUMP_V       = 900;    // počáteční rychlost skoku
  const GROUND_H     = 54;     // tloušťka podlahy
  const PLAYER_SIZE  = 38;
  const PLAYER_X_FR  = 0.20;
  const START_SPEED  = 340;
  const MAX_SPEED    = 820;
  const SPEED_BYDIST = 0.042;  // přírůstek rychlosti na 1 px vzdálenosti
  const SPIKE_W      = 34;
  const SPIKE_H      = 42;
  const NET_HZ       = 0.04;   // jak často posílat stav po síti (s)
  const COLORS = {
    p1: { core: '#ff3cac', glow: '#ff6ec7' },
    p2: { core: '#2af5ff', glow: '#6efff0' },
  };

  // ----- Stav -----
  let W = 0, H = 0, dpr = 1;
  let mode = null;              // 'local' | 'online'
  let state = 'menu';          // 'menu' | 'ready' | 'countdown' | 'playing' | 'over'
  let lanes = [];
  let field = null;            // deterministický generátor překážek
  let particles = [];
  let bgScroll = 0;
  let lastTime = 0;
  let countdownTimer = 0, countdownNum = 0;

  // online
  let net = null;
  let role = null;             // 'host' | 'guest'
  let localIdx = 1, remoteIdx = 0;   // při online jsi vždy dole
  let netAcc = 0;
  let remoteTarget = null;

  // ----- Pomůcky -----
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp  = (a, b, t) => a + (b - a) * t;

  // Seedovatelný generátor (mulberry32) — stejné semínko = stejné překážky
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===== Rozvržení =====
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildLanes(true);
  }

  // ===== Dráhy obou hráčů (oba gravitace dolů, oba skáčou nahoru) =====
  function buildLanes(preserve) {
    const mid = H / 2;
    const px = Math.round(W * PLAYER_X_FR);

    // Horní hráč: jeho podlaha je u STŘEDU, skáče vzhůru do horní poloviny.
    const topGround = mid - GROUND_H;
    const top = {
      id: 'p1', colors: COLORS.p1,
      groundY: topGround,
      restY: topGround - PLAYER_SIZE,
      regionTop: 0, regionBottom: mid,
      x: px,
    };
    // Dolní hráč: podlaha u DNA, skáče vzhůru ke středu.
    const botGround = H - GROUND_H;
    const bottom = {
      id: 'p2', colors: COLORS.p2,
      groundY: botGround,
      restY: botGround - PLAYER_SIZE,
      regionTop: mid, regionBottom: H,
      x: px,
    };

    const keep = preserve && lanes.length === 2;
    [top, bottom].forEach((lane, i) => {
      const old = keep ? lanes[i] : null;
      lane.vy        = old ? old.vy        : 0;
      lane.onGround  = old ? old.onGround  : true;
      lane.alive     = old ? old.alive     : true;
      lane.score     = old ? old.score     : 0;
      lane.rot       = old ? old.rot       : 0;
      lane.worldDist = old ? old.worldDist : 0;
      lane.trailAcc  = old ? old.trailAcc  : 0;
      lane.y         = old ? old.y         : lane.restY;
    });
    lanes = [top, bottom];
  }

  // ===== Deterministické pole překážek =====
  function makeField(seed) {
    return {
      prng: mulberry32(seed >>> 0),
      groups: [],
      lastX: 700,                       // první překážka až po rozjezdu
      ensure(untilX) {
        while (this.lastX < untilX) {
          const dist = this.lastX;
          const diff = Math.min(1, dist / 7000);            // 0..1 obtížnost
          const sp = Math.min(MAX_SPEED, START_SPEED + dist * SPEED_BYDIST);
          const airTime = (2 * JUMP_V) / GRAVITY;
          const minGap = sp * airTime * 1.04;               // aby šlo doskočit
          const extra = (1 - diff) * 300 + 40;              // mezery se zkracují
          const gap = minGap + this.prng() * extra + 24;

          const r = this.prng();
          let count = 1;
          if (dist > 1400 && r < 0.22 + diff * 0.40) count = 2;
          if (dist > 3600 && r < 0.10 + diff * 0.26) count = 3;

          const x = this.lastX + gap;
          this.groups.push({ x, count });
          this.lastX = x + count * SPIKE_W;
        }
      },
    };
  }

  // ===== Start kola =====
  function startGame(newMode, seed) {
    mode = newMode;
    field = makeField(seed != null ? seed : (Math.random() * 2147483647) | 0);
    particles = [];
    buildLanes(false);
    if (mode === 'online') { localIdx = 1; remoteIdx = 0; remoteTarget = null; netAcc = 0; }
    setHud();
    hideAllScreens();
    showHud(true);
    startCountdown();
  }

  function curSpeed(lane) {
    return Math.min(MAX_SPEED, START_SPEED + lane.worldDist * SPEED_BYDIST);
  }

  // ===== Skok =====
  function jump(idx) {
    if (state !== 'playing') return;
    const lane = lanes[idx];
    if (lane.alive && lane.onGround) {
      lane.vy = -JUMP_V;
      lane.onGround = false;
      spawnPuff(lane, true);
    }
  }

  // ===== Aktualizace =====
  function update(dt) {
    if (state !== 'playing') return;

    const maxCam = Math.max(lanes[0].worldDist, lanes[1].worldDist);
    field.ensure(maxCam + W + 240);
    bgScroll = (bgScroll + curSpeed(lanes[localIndexForBg()]) * dt * 0.35) % 80;

    lanes.forEach((lane, i) => {
      if (mode === 'online' && i === remoteIdx) { updateRemote(lane, dt); return; }
      if (!lane.alive) return;

      const sp = curSpeed(lane);
      lane.worldDist += sp * dt;
      lane.score = lane.worldDist * 0.05;

      // Fyzika — gravitace dolů, skok nahoru
      lane.vy += GRAVITY * dt;
      lane.y += lane.vy * dt;

      if (lane.y >= lane.restY) {            // dopad na podlahu
        lane.y = lane.restY; lane.vy = 0;
        if (!lane.onGround) { lane.onGround = true; lane.rot = 0; spawnPuff(lane, false); }
      } else {
        lane.onGround = false;
        lane.rot += 7.2 * dt;                // rotace kostky ve vzduchu
      }

      // Stopa
      lane.trailAcc += dt;
      if (lane.trailAcc > 0.02) { lane.trailAcc = 0; spawnTrail(lane); }

      if (collide(lane)) killLane(lane);
    });

    // Síťový stav
    if (mode === 'online') {
      netAcc += dt;
      if (netAcc >= NET_HZ) { netAcc = 0; sendState(); }
    }

    updateScores();
    checkEnd();
  }

  function localIndexForBg() { return mode === 'online' ? localIdx : 0; }

  // ===== Kolize hráče s bodci =====
  function collide(lane) {
    const hb = 5;
    const pL = lane.x + hb, pR = lane.x + PLAYER_SIZE - hb;
    const pT = lane.y + hb, pB = lane.y + PLAYER_SIZE - hb;
    const cam = lane.worldDist;
    for (const g of field.groups) {
      const gx = g.x - cam;                  // pozice skupiny na obrazovce
      if (gx + g.count * SPIKE_W < lane.x - 40) continue;
      if (gx > lane.x + PLAYER_SIZE + 40) break;
      for (let k = 0; k < g.count; k++) {
        const ox = gx + k * SPIKE_W;
        const oL = ox + 4, oR = ox + SPIKE_W - 4;
        const oT = lane.groundY - SPIKE_H, oB = lane.groundY;
        if (pR > oL && pL < oR && pB > oT && pT < oB) return true;
      }
    }
    return false;
  }

  function killLane(lane) {
    if (!lane.alive) return;
    lane.alive = false;
    spawnExplosion(lane);
  }

  // ===== Online: vzdálený hráč =====
  function updateRemote(lane, dt) {
    if (!remoteTarget) return;
    const t = clamp(dt * 14, 0, 1);
    lane.y = lerp(lane.y, remoteTarget.y, t);
    lane.worldDist = lerp(lane.worldDist, remoteTarget.worldDist, t);
    lane.rot = remoteTarget.rot;
    lane.alive = remoteTarget.alive;
    lane.score = remoteTarget.score;
  }

  function sendState() {
    const me = lanes[localIdx];
    netSend({ t: 'state', s: [
      Math.round(me.y), Math.round(me.worldDist),
      me.alive ? 1 : 0, Math.round(me.score),
      Math.round(me.rot * 100) / 100,
    ]});
  }

  // ===== Konec kola =====
  function checkEnd() {
    const bothDead = !lanes[0].alive && !lanes[1].alive;
    if (bothDead) endGame();
  }

  function endGame() {
    state = 'over';
    const s1 = Math.floor(lanes[0].score);
    const s2 = Math.floor(lanes[1].score);
    let msg;
    if (mode === 'online') {
      const meScore = Math.floor(lanes[localIdx].score);
      const opScore = Math.floor(lanes[remoteIdx].score);
      if (meScore === opScore) msg = `Remíza! Oba ${meScore} m.`;
      else if (meScore > opScore) msg = `🏆 Vyhrál jsi! ${meScore} m vs ${opScore} m`;
      else msg = `Prohrál jsi… ${meScore} m vs ${opScore} m`;
      overlayHint.innerHTML = 'Stiskni <b>MEZERNÍK</b> pro odvetu';
    } else {
      if (s1 === s2) msg = `Remíza! Oba ${s1} m.`;
      else if (s1 > s2) msg = `🏆 Vyhrál HRÁČ 1 — ${s1} m vs ${s2} m`;
      else msg = `🏆 Vyhrál HRÁČ 2 — ${s2} m vs ${s1} m`;
      overlayHint.innerHTML = 'Stiskni <b>MEZERNÍK</b> pro odvetu';
    }
    overlayText.textContent = msg;
    show(overlay, true);
  }

  // ===== Částice =====
  const laneCY = (lane) => lane.y + PLAYER_SIZE / 2;

  function spawnExplosion(lane) {
    const cx = lane.x + PLAYER_SIZE / 2, cy = laneCY(lane);
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 480);
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.5, 1.1), max: 1.1, size: rand(3, 8),
        color: Math.random() < 0.5 ? lane.colors.core : lane.colors.glow, grav: 700 });
    }
  }
  function spawnPuff(lane, isJump) {
    const cx = lane.x + PLAYER_SIZE / 2, cy = lane.restY + PLAYER_SIZE;
    const n = isJump ? 8 : 10;
    for (let i = 0; i < n; i++) {
      particles.push({ x: cx + rand(-12, 12), y: cy,
        vx: rand(-150, 150), vy: rand(-40, 10),
        life: 0.4, max: 0.4, size: rand(2, 5),
        color: isJump ? lane.colors.glow : '#ffffff', grav: 400 });
    }
  }
  function spawnTrail(lane) {
    particles.push({ x: lane.x + PLAYER_SIZE * 0.2, y: laneCY(lane) + rand(-6, 6),
      vx: -curSpeed(lane) * 0.25, vy: rand(-20, 20),
      life: 0.5, max: 0.5, size: rand(3, 7), color: lane.colors.core, grav: 0, glow: true });
  }
  function updateParticles(dt) {
    for (const p of particles) { p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
  }

  // ===== Vykreslení =====
  function draw() {
    drawHalfBg(lanes[0], true);
    drawHalfBg(lanes[1], false);
    drawDivider();
    lanes.forEach((lane, i) => drawLane(lane, i));
    drawParticles();
  }

  function drawHalfBg(lane, isTop) {
    const top = lane.regionTop, h = lane.regionBottom - lane.regionTop;
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, isTop ? '#1a0a2e' : '#0b0420');
    g.addColorStop(1, isTop ? '#0b0420' : '#0a1430');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, h);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, top, W, h); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let x = -bgScroll; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke(); }
    for (let y = top; y < top + h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawDivider() {
    const mid = H / 2;
    const g = ctx.createLinearGradient(0, mid - 3, 0, mid + 3);
    g.addColorStop(0, COLORS.p1.core); g.addColorStop(1, COLORS.p2.core);
    ctx.fillStyle = g; ctx.shadowColor = '#fff'; ctx.shadowBlur = 16;
    ctx.fillRect(0, mid - 2, W, 4); ctx.shadowBlur = 0;
  }

  function drawLane(lane, i) {
    // Podlaha (pod hráčem)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, lane.groundY, W, lane.regionBottom - lane.groundY);
    ctx.fillStyle = lane.colors.core; ctx.shadowColor = lane.colors.glow; ctx.shadowBlur = 14;
    ctx.fillRect(0, lane.groundY - 2, W, 4); ctx.shadowBlur = 0;

    // Překážky
    const cam = lane.worldDist;
    for (const g of field.groups) {
      const gx = g.x - cam;
      if (gx + g.count * SPIKE_W < -20) continue;
      if (gx > W + 20) break;
      for (let k = 0; k < g.count; k++) drawSpike(lane, gx + k * SPIKE_W);
    }

    if (lane.alive) drawPlayer(lane);
  }

  function drawSpike(lane, ox) {
    const cx = ox + SPIKE_W / 2;
    ctx.save();
    ctx.fillStyle = lane.colors.core; ctx.strokeStyle = lane.colors.glow; ctx.lineWidth = 2;
    ctx.shadowColor = lane.colors.glow; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(ox, lane.groundY);
    ctx.lineTo(cx, lane.groundY - SPIKE_H);
    ctx.lineTo(ox + SPIKE_W, lane.groundY);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(lane) {
    const s = PLAYER_SIZE, cx = lane.x + s / 2, cy = lane.y + s / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(lane.rot);
    const g = ctx.createLinearGradient(-s/2, -s/2, s/2, s/2);
    g.addColorStop(0, lane.colors.glow); g.addColorStop(1, lane.colors.core);
    ctx.fillStyle = g; ctx.shadowColor = lane.colors.glow; ctx.shadowBlur = 20;
    roundRect(-s/2, -s/2, s, s, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(-s*0.18, -s*0.18, s*0.36, s*0.36, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    roundRect(-s/2, -s/2, s, s, 7); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ===== HUD =====
  function updateScores() {
    scoreTopEl.textContent = Math.floor(lanes[0].score);
    scoreBotEl.textContent = Math.floor(lanes[1].score);
  }
  function setHud() {
    if (mode === 'online') {
      nameTopEl.textContent = 'SOUPEŘ'; keyTopEl.textContent = '';
      nameBotEl.textContent = 'TY';     keyBotEl.textContent = 'mezerník / klepni';
    } else {
      nameTopEl.textContent = 'HRÁČ 1'; keyTopEl.textContent = 'W / klepni nahoře';
      nameBotEl.textContent = 'HRÁČ 2'; keyBotEl.textContent = '↑ / klepni dole';
    }
  }
  function showHud(on) { hudTop.classList.toggle('hidden', !on); hudBottom.classList.toggle('hidden', !on); }

  // ===== Odpočet a smyčka =====
  function startCountdown() {
    state = 'countdown';
    countdownNum = 3; countdownTimer = 0;
    showCountdown('3');
  }
  function showCountdown(text) {
    countdownEl.textContent = text;
    countdownEl.classList.remove('show'); void countdownEl.offsetWidth; countdownEl.classList.add('show');
  }

  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000 || 0, 0.05);
    lastTime = t;

    if (state === 'countdown') {
      countdownTimer += dt;
      if (countdownTimer >= 0.8) {
        countdownTimer = 0; countdownNum--;
        if (countdownNum > 0) showCountdown(String(countdownNum));
        else if (countdownNum === 0) showCountdown('START!');
        else { state = 'playing'; countdownEl.classList.remove('show'); }
      }
    }

    update(dt);
    updateParticles(dt);
    if (mode) draw();

    requestAnimationFrame(loop);
  }

  // ===== Obrazovky =====
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function hideAllScreens() {
    show(screenMenu, false); show(screenHost, false); show(screenJoin, false); show(overlay, false);
  }
  function gotoMenu() {
    state = 'menu'; mode = null;
    closeNet();
    showHud(false);
    hideAllScreens();
    show(screenMenu, true);
  }

  // ===== Síť (klient) =====
  function netSend(obj) { if (net && net.readyState === 1) net.send(JSON.stringify(obj)); }
  function closeNet() { if (net) { try { net.onclose = null; net.close(); } catch (_) {} net = null; } }

  function connect(onReady, onFail) {
    if (location.protocol === 'file:') {     // otevřeno přes dvojklik → server není
      onFail('Online hra potřebuje spuštěný server (node server.js), ne otevření souboru.');
      return;
    }
    closeNet();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { net = new WebSocket(proto + '://' + location.host); }
    catch (e) { onFail('Nepodařilo se připojit k serveru.'); return; }
    net.onopen = () => onReady();
    net.onerror = () => onFail('Spojení se serverem selhalo.');
    net.onclose = () => { if (mode === 'online' || state === 'menu') { /* řešeno jinde */ } };
    net.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } handleNet(m); };
  }

  function handleNet(m) {
    switch (m.t) {
      case 'created':
        role = 'host';
        hostCodeEl.textContent = m.code;
        hostStatus.textContent = '⏳ Čekání na druhého hráče…';
        break;
      case 'start':
        role = m.role;
        startGame('online', m.seed);
        break;
      case 'peer': {
        const s = m.s;
        remoteTarget = { y: s[0], worldDist: s[1], alive: s[2] === 1, score: s[3], rot: s[4] };
        if (state === 'over') { lanes[remoteIdx].alive = remoteTarget.alive; lanes[remoteIdx].score = remoteTarget.score; }
        break;
      }
      case 'peer_rematch':
        if (state === 'over') overlayHint.innerHTML = 'Soupeř chce odvetu — stiskni <b>MEZERNÍK</b>';
        break;
      case 'peer_left':
        if (mode === 'online') {
          showCountdown('');
          alert('Soupeř se odpojil.');
        }
        gotoMenu();
        break;
      case 'error':
        joinError.textContent = m.msg || 'Chyba.';
        break;
    }
  }

  function requestRematch() {
    if (mode !== 'online' || state !== 'over') return;
    netSend({ t: 'rematch' });
    overlayHint.innerHTML = '⏳ Čekání na soupeře…';
  }

  // ===== Vstupy =====
  function onKey(e) {
    if (e.repeat) return;
    const k = e.key;
    const isJump = (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'Enter');

    if (mode === 'online') {
      if (state === 'playing' && isJump) { e.preventDefault(); jump(localIdx); }
      else if (state === 'over' && (k === ' ' || k === 'Enter')) { e.preventDefault(); requestRematch(); }
      return;
    }
    if (mode === 'local') {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); if (state === 'over') startGame('local'); return; }
      if (k === 'w' || k === 'W') { e.preventDefault(); jump(0); }
      if (k === 'ArrowUp') { e.preventDefault(); jump(1); }
    }
  }

  function onPointer(e) {
    if (state === 'menu') return;
    if (mode === 'online') {
      if (state === 'playing') jump(localIdx);
      else if (state === 'over') requestRematch();
      return;
    }
    if (mode === 'local') {
      if (state === 'over') { startGame('local'); return; }
      if (state === 'playing') { if (e.clientY < H / 2) jump(0); else jump(1); }
    }
  }

  // ===== Menu akce =====
  function onMenuClick(act) {
    if (act === 'local') {
      startGame('local');
    } else if (act === 'host') {
      hideAllScreens(); show(screenHost, true);
      hostCodeEl.textContent = '······';
      hostStatus.textContent = '⏳ Připojuji se k serveru…';
      connect(() => netSend({ t: 'create' }),
              (msg) => { hostStatus.textContent = '⚠ ' + msg; });
    } else if (act === 'join') {
      hideAllScreens(); show(screenJoin, true);
      joinError.textContent = ''; joinInput.value = '';
      setTimeout(() => joinInput.focus(), 50);
    } else if (act === 'connect') {
      const code = joinInput.value.toUpperCase().trim();
      if (code.length !== 6) { joinError.textContent = 'Kód má 4 písmena a 2 číslice (např. ABCD12).'; return; }
      joinError.textContent = 'Připojuji…';
      connect(() => netSend({ t: 'join', code }),
              (msg) => { joinError.textContent = msg; });
    } else if (act === 'back') {
      gotoMenu();
    }
  }

  // ===== Inicializace =====
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onPointer);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-act]')) return;   // tlačítko Menu řeší klik níže
    onPointer(e);
  });
  document.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); onMenuClick(el.dataset.act); });
  });
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onMenuClick('connect'); });

  resize();
  buildLanes(false);
  gotoMenu();
  requestAnimationFrame((t) => { lastTime = t; loop(t); });
})();
