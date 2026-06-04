/* =========================================================================
   DASH DUEL — souboj dvou hráčů ve stylu Geometry Dash
   - Hra na jednom zařízení (2 hráči) NEBO online na dvou zařízeních
   - Online přes PeerJS (WebRTC) → propojení napřímo, BEZ vlastního serveru
     (funguje i na statickém hostingu typu GitHub Pages)
   - Oba hráči stojí "pravou stranou nahoru" a skáčou NAHORU
   - Stejné překážky i mince pro oba (deterministické dle semínka) → férový závod
   - Obtížnost roste s ujetou vzdáleností; úrovně, zvuky, mince, otřesy, efekty
   ========================================================================= */

(() => {
  'use strict';

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
  const bannerEl    = document.getElementById('banner');
  const muteBtn     = document.getElementById('mute-btn');
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
  const GRAVITY      = 2600;
  const JUMP_V       = 900;
  const GROUND_H     = 54;
  const PLAYER_SIZE  = 38;
  const PLAYER_X_FR  = 0.20;
  const START_SPEED  = 340;
  const MAX_SPEED    = 860;
  const SPEED_BYDIST = 0.044;
  const SPIKE_W      = 34;
  const SPIKE_H      = 42;
  const COIN_R       = 12;
  const COIN_VALUE   = 15;
  const LEVEL_DIST   = 2200;        // délka jedné "úrovně" (m*20)
  const NET_HZ       = 0.04;
  const PEER_PREFIX  = 'dashduel-r1-';
  const COLORS = {
    p1: { core: '#ff3cac', glow: '#ff6ec7' },
    p2: { core: '#2af5ff', glow: '#6efff0' },
  };

  // ----- Stav -----
  let W = 0, H = 0, dpr = 1;
  let mode = null;                  // 'local' | 'online'
  let state = 'menu';
  let lanes = [];
  let field = null;
  let particles = [];
  let bgScroll = 0, lastTime = 0;
  let countdownTimer = 0, countdownNum = 0;
  let gameLevel = 0, lastLevel = 0;
  let shakeMag = 0, shakeT = 0;

  // online
  let peer = null, conn = null, role = null;
  let localIdx = 1, remoteIdx = 0;
  let netAcc = 0, remoteTarget = null;
  let rematchLocal = false, rematchRemote = false;
  let hostTries = 0;

  // ----- Pomůcky -----
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp  = (a, b, t) => a + (b - a) * t;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randSeed = () => (Math.random() * 2147483647) | 0;
  function genCode() {
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
    for (let i = 0; i < 2; i++) c += D[Math.floor(Math.random() * D.length)];
    return c;
  }

  /* =======================================================================
     ZVUKY (WebAudio — generované, žádné soubory)
     ===================================================================== */
  let actx = null, muted = false, musicTimer = null, musicStep = 0, nextNote = 0;
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type, vol, when) {
    if (!actx || muted) return;
    const t = actx.currentTime + (when || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function slide(f1, f2, dur, type, vol) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sawtooth';
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol) {
    if (!actx || muted) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource(); src.buffer = buf;
    const g = actx.createGain(); g.gain.value = vol;
    src.connect(g).connect(actx.destination); src.start();
  }
  const sfx = {
    jump()  { tone(540, 0.10, 'square', 0.16); },
    land()  { tone(150, 0.06, 'sine', 0.10); },
    coin()  { tone(880, 0.05, 'square', 0.14); tone(1320, 0.09, 'square', 0.14, 0.05); },
    crash() { slide(420, 60, 0.45, 'sawtooth', 0.22); noise(0.4, 0.18); },
    count() { tone(440, 0.10, 'square', 0.18); },
    go()    { tone(660, 0.12, 'square', 0.2); tone(990, 0.22, 'square', 0.2, 0.1); },
    level() { [0,1,2].forEach(i => tone(660 * Math.pow(2, i/12*4), 0.10, 'square', 0.16, i*0.06)); },
    win()   { [0,4,7,12].forEach((s,i) => tone(523 * Math.pow(2, s/12), 0.16, 'square', 0.18, i*0.1)); },
    lose()  { slide(330, 120, 0.5, 'triangle', 0.18); },
  };
  // jemná hudba na pozadí
  const SCALE = [0, 3, 5, 7, 10];
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function scheduleMusic() {
    if (!actx) return;
    while (nextNote < actx.currentTime + 0.18) {
      const lvl = Math.min(8, gameLevel);
      const root = 45 + (lvl % 3) * 2;
      const off = nextNote - actx.currentTime;
      if (musicStep % 4 === 0) tone(midi(root - 12), 0.20, 'triangle', 0.05, off);
      const note = root + 12 + SCALE[(musicStep * 3) % SCALE.length] + ((Math.floor(musicStep / 8) % 2) ? 12 : 0);
      tone(midi(note), 0.12, 'square', 0.032, off);
      nextNote += Math.max(0.10, 0.16 - lvl * 0.006);
      musicStep++;
    }
  }
  function startMusic() {
    if (!actx) return;
    musicStep = 0; nextNote = actx.currentTime + 0.05;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = setInterval(scheduleMusic, 60);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  function setMuted(m) {
    muted = m;
    muteBtn.textContent = m ? '🔇' : '🔊';
  }

  /* =======================================================================
     ROZVRŽENÍ A DRÁHY
     ===================================================================== */
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

  function buildLanes(preserve) {
    const mid = H / 2;
    const px = Math.round(W * PLAYER_X_FR);
    const top = {
      id: 'p1', colors: COLORS.p1,
      groundY: mid - GROUND_H, restY: mid - GROUND_H - PLAYER_SIZE,
      regionTop: 0, regionBottom: mid, x: px,
    };
    const bottom = {
      id: 'p2', colors: COLORS.p2,
      groundY: H - GROUND_H, restY: H - GROUND_H - PLAYER_SIZE,
      regionTop: mid, regionBottom: H, x: px,
    };
    const keep = preserve && lanes.length === 2;
    [top, bottom].forEach((lane, i) => {
      const old = keep ? lanes[i] : null;
      lane.vy        = old ? old.vy        : 0;
      lane.onGround  = old ? old.onGround  : true;
      lane.alive     = old ? old.alive     : true;
      lane.bonus     = old ? old.bonus     : 0;
      lane.score     = old ? old.score     : 0;
      lane.rot       = old ? old.rot       : 0;
      lane.worldDist = old ? old.worldDist : 0;
      lane.trailAcc  = old ? old.trailAcc  : 0;
      lane.coinsGot  = old ? old.coinsGot  : new Set();
      lane.y         = old ? old.y         : lane.restY;
    });
    lanes = [top, bottom];
  }

  // Deterministické pole překážek + mincí
  function makeField(seed) {
    return {
      prng: mulberry32(seed >>> 0),
      groups: [], coins: [], lastX: 700,
      ensure(untilX) {
        while (this.lastX < untilX) {
          const prevEnd = this.lastX;
          const dist = this.lastX;
          const diff = Math.min(1, dist / 7000);
          const sp = Math.min(MAX_SPEED, START_SPEED + dist * SPEED_BYDIST);
          const airTime = (2 * JUMP_V) / GRAVITY;
          const minGap = sp * airTime * 1.04;
          const extra = (1 - diff) * 300 + 40;
          const gap = minGap + this.prng() * extra + 24;
          const x = this.lastX + gap;

          const r = this.prng();
          let count = 1;
          if (dist > 1400 && r < 0.22 + diff * 0.40) count = 2;
          if (dist > 3600 && r < 0.10 + diff * 0.26) count = 3;
          const tall = this.prng() < 0.16 && dist > 2000;
          const h = tall ? SPIKE_H * 1.5 : SPIKE_H;
          this.groups.push({ x, count, h });

          // mince v mezeře před skupinou
          if (this.prng() < 0.55) {
            const cx = (prevEnd + x) / 2;
            const floating = this.prng() < 0.5;
            this.coins.push({ x: cx, h: floating ? 90 : 0 });
          }
          this.lastX = x + count * SPIKE_W;
        }
      },
    };
  }

  /* =======================================================================
     PRŮBĚH HRY
     ===================================================================== */
  function startGame(newMode, seed, roleArg) {
    ensureAudio();
    mode = newMode;
    if (roleArg) role = roleArg;
    field = makeField(seed != null ? seed : randSeed());
    particles = [];
    gameLevel = 0; lastLevel = 0; shakeMag = 0; shakeT = 0;
    buildLanes(false);
    if (mode === 'online') { localIdx = 1; remoteIdx = 0; remoteTarget = null; netAcc = 0; }
    rematchLocal = rematchRemote = false;
    setHud();
    hideAllScreens();
    showHud(true);
    startCountdown();
  }

  const curSpeed = (lane) => Math.min(MAX_SPEED, START_SPEED + lane.worldDist * SPEED_BYDIST);
  const ctrlLane = () => lanes[mode === 'online' ? localIdx : 0];

  function jump(idx) {
    if (state !== 'playing') return;
    const lane = lanes[idx];
    if (lane.alive && lane.onGround) {
      lane.vy = -JUMP_V; lane.onGround = false;
      spawnPuff(lane, true); sfx.jump();
    }
  }

  function update(dt) {
    if (state !== 'playing') return;

    const maxCam = Math.max(lanes[0].worldDist, lanes[1].worldDist);
    field.ensure(maxCam + W + 240);
    bgScroll = (bgScroll + curSpeed(ctrlLane()) * dt * 0.35) % 80;

    // úroveň podle ovládané dráhy
    gameLevel = Math.floor(ctrlLane().worldDist / LEVEL_DIST);
    if (gameLevel > lastLevel) { lastLevel = gameLevel; onLevelUp(); }

    lanes.forEach((lane, i) => {
      if (mode === 'online' && i === remoteIdx) { updateRemote(lane, dt); return; }
      if (!lane.alive) return;

      const sp = curSpeed(lane);
      lane.worldDist += sp * dt;
      lane.score = lane.worldDist * 0.05 + lane.bonus;

      lane.vy += GRAVITY * dt;
      lane.y += lane.vy * dt;
      if (lane.y >= lane.restY) {
        lane.y = lane.restY; lane.vy = 0;
        if (!lane.onGround) { lane.onGround = true; lane.rot = 0; spawnPuff(lane, false); sfx.land(); }
      } else {
        lane.onGround = false; lane.rot += 7.2 * dt;
      }

      lane.trailAcc += dt;
      if (lane.trailAcc > 0.02) { lane.trailAcc = 0; spawnTrail(lane); }

      collectCoins(lane);
      if (collide(lane)) killLane(lane);
    });

    if (mode === 'online') { netAcc += dt; if (netAcc >= NET_HZ) { netAcc = 0; sendState(); } }

    if (shakeT > 0) { shakeT -= dt; shakeMag *= Math.pow(0.001, dt); if (shakeT <= 0) shakeMag = 0; }

    updateScores();
    checkEnd();
  }

  function collide(lane) {
    const hb = 5;
    const pL = lane.x + hb, pR = lane.x + PLAYER_SIZE - hb;
    const pT = lane.y + hb, pB = lane.y + PLAYER_SIZE - hb;
    const cam = lane.worldDist;
    for (const g of field.groups) {
      const gx = g.x - cam;
      if (gx + g.count * SPIKE_W < lane.x - 40) continue;
      if (gx > lane.x + PLAYER_SIZE + 40) break;
      const h = g.h || SPIKE_H;
      for (let k = 0; k < g.count; k++) {
        const ox = gx + k * SPIKE_W;
        const oL = ox + 4, oR = ox + SPIKE_W - 4;
        const oT = lane.groundY - h, oB = lane.groundY;
        if (pR > oL && pL < oR && pB > oT && pT < oB) return true;
      }
    }
    return false;
  }

  function collectCoins(lane) {
    const cam = lane.worldDist;
    const px = lane.x + PLAYER_SIZE / 2, py = lane.y + PLAYER_SIZE / 2;
    for (let idx = 0; idx < field.coins.length; idx++) {
      const c = field.coins[idx];
      const cx = c.x - cam;
      if (cx < lane.x - 60) continue;
      if (cx > lane.x + PLAYER_SIZE + 60) break;
      if (lane.coinsGot.has(idx)) continue;
      const cy = lane.groundY - c.h - COIN_R - 6;
      if (Math.abs(px - cx) < COIN_R + PLAYER_SIZE / 2 && Math.abs(py - cy) < COIN_R + PLAYER_SIZE / 2) {
        lane.coinsGot.add(idx);
        lane.bonus += COIN_VALUE;
        sfx.coin();
        spawnCoinBurst(cx, cy, lane);
      }
    }
  }

  function killLane(lane) {
    if (!lane.alive) return;
    lane.alive = false;
    spawnExplosion(lane);
    sfx.crash();
    if (mode === 'local' || lane === lanes[localIdx]) { shakeMag = 16; shakeT = 0.4; }
  }

  function onLevelUp() {
    showBanner(`ÚROVEŇ ${gameLevel + 1}`);
    sfx.level();
  }

  function updateRemote(lane, dt) {
    if (!remoteTarget) return;
    const t = clamp(dt * 14, 0, 1);
    lane.y = lerp(lane.y, remoteTarget.y, t);
    lane.worldDist = lerp(lane.worldDist, remoteTarget.worldDist, t);
    lane.rot = remoteTarget.rot; lane.alive = remoteTarget.alive; lane.score = remoteTarget.score;
  }
  function sendState() {
    const me = lanes[localIdx];
    netSend({ t: 'state', s: [
      Math.round(me.y), Math.round(me.worldDist), me.alive ? 1 : 0,
      Math.round(me.score), Math.round(me.rot * 100) / 100,
    ]});
  }

  function checkEnd() { if (!lanes[0].alive && !lanes[1].alive) endGame(); }

  function endGame() {
    state = 'over';
    stopMusic();
    const s1 = Math.floor(lanes[0].score), s2 = Math.floor(lanes[1].score);
    let msg, won = false;
    if (mode === 'online') {
      const me = Math.floor(lanes[localIdx].score), op = Math.floor(lanes[remoteIdx].score);
      if (me === op) msg = `Remíza! Oba ${me} m.`;
      else if (me > op) { msg = `🏆 Vyhrál jsi! ${me} m vs ${op} m`; won = true; }
      else msg = `Prohrál jsi… ${me} m vs ${op} m`;
    } else {
      if (s1 === s2) msg = `Remíza! Oba ${s1} m.`;
      else if (s1 > s2) { msg = `🏆 Vyhrál HRÁČ 1 — ${s1} m vs ${s2} m`; won = true; }
      else { msg = `🏆 Vyhrál HRÁČ 2 — ${s2} m vs ${s1} m`; won = true; }
    }
    won ? sfx.win() : sfx.lose();
    overlayHint.innerHTML = 'Stiskni <b>MEZERNÍK</b> pro odvetu';
    overlayText.textContent = msg;
    show(overlay, true);
  }

  /* =======================================================================
     ČÁSTICE
     ===================================================================== */
  const laneCY = (lane) => lane.y + PLAYER_SIZE / 2;
  function spawnExplosion(lane) {
    const cx = lane.x + PLAYER_SIZE / 2, cy = laneCY(lane);
    for (let i = 0; i < 44; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 500);
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.5, 1.2), max: 1.2, size: rand(3, 9),
        color: Math.random() < 0.5 ? lane.colors.core : lane.colors.glow, grav: 700 });
    }
  }
  function spawnPuff(lane, isJump) {
    const cx = lane.x + PLAYER_SIZE / 2, cy = lane.restY + PLAYER_SIZE;
    const n = isJump ? 8 : 10;
    for (let i = 0; i < n; i++)
      particles.push({ x: cx + rand(-12, 12), y: cy, vx: rand(-150, 150), vy: rand(-40, 10),
        life: 0.4, max: 0.4, size: rand(2, 5), color: isJump ? lane.colors.glow : '#fff', grav: 400 });
  }
  function spawnTrail(lane) {
    particles.push({ x: lane.x + PLAYER_SIZE * 0.2, y: laneCY(lane) + rand(-6, 6),
      vx: -curSpeed(lane) * 0.25, vy: rand(-20, 20), life: 0.5, max: 0.5,
      size: rand(3, 7), color: lane.colors.core, grav: 0, glow: true });
  }
  function spawnCoinBurst(x, y, lane) {
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 220);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5, max: 0.5, size: rand(2, 5), color: '#ffe14d', grav: 200, glow: true });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) { p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
  }

  /* =======================================================================
     VYKRESLENÍ
     ===================================================================== */
  function draw() {
    ctx.save();
    if (shakeMag > 0.5) ctx.translate(rand(-shakeMag, shakeMag), rand(-shakeMag, shakeMag));
    drawHalfBg(lanes[0], true);
    drawHalfBg(lanes[1], false);
    drawDivider();
    lanes.forEach((lane) => drawLane(lane));
    drawParticles();
    ctx.restore();
  }

  function drawHalfBg(lane, isTop) {
    const top = lane.regionTop, h = lane.regionBottom - lane.regionTop;
    const hue = (isTop ? 275 : 225) + gameLevel * 24;     // barva se posouvá s úrovní
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, `hsl(${hue}, 70%, ${isTop ? 12 : 8}%)`);
    g.addColorStop(1, `hsl(${hue + 20}, 75%, 6%)`);
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

  function drawLane(lane) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, lane.groundY, W, lane.regionBottom - lane.groundY);
    ctx.fillStyle = lane.colors.core; ctx.shadowColor = lane.colors.glow; ctx.shadowBlur = 14;
    ctx.fillRect(0, lane.groundY - 2, W, 4); ctx.shadowBlur = 0;

    const cam = lane.worldDist;
    // mince
    for (let idx = 0; idx < field.coins.length; idx++) {
      const c = field.coins[idx];
      const cx = c.x - cam;
      if (cx < -20) continue;
      if (cx > W + 20) break;
      const isLocal = (mode !== 'online') || (lane === lanes[localIdx]);
      if (isLocal && lane.coinsGot.has(idx)) continue;
      drawCoin(cx, lane.groundY - c.h - COIN_R - 6);
    }
    // překážky
    for (const g of field.groups) {
      const gx = g.x - cam;
      if (gx + g.count * SPIKE_W < -20) continue;
      if (gx > W + 20) break;
      for (let k = 0; k < g.count; k++) drawSpike(lane, gx + k * SPIKE_W, g.h || SPIKE_H);
    }
    if (lane.alive) drawPlayer(lane);
  }

  function drawCoin(x, y) {
    const t = performance.now() / 200;
    const w = Math.abs(Math.cos(t)) * COIN_R + 2;      // rotace mince
    ctx.save();
    ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#fff6c2'; ctx.lineWidth = 2;
    ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.ellipse(x, y, w, COIN_R, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawSpike(lane, ox, h) {
    const cx = ox + SPIKE_W / 2;
    ctx.save();
    ctx.fillStyle = lane.colors.core; ctx.strokeStyle = lane.colors.glow; ctx.lineWidth = 2;
    ctx.shadowColor = lane.colors.glow; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(ox, lane.groundY); ctx.lineTo(cx, lane.groundY - h); ctx.lineTo(ox + SPIKE_W, lane.groundY);
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
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* =======================================================================
     HUD / BANNER / ODPOČET
     ===================================================================== */
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
  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.remove('show'); void bannerEl.offsetWidth; bannerEl.classList.add('show');
  }

  function startCountdown() { state = 'countdown'; countdownNum = 3; countdownTimer = 0; showCountdown('3'); sfx.count(); }
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
        if (countdownNum > 0) { showCountdown(String(countdownNum)); sfx.count(); }
        else if (countdownNum === 0) { showCountdown('START!'); sfx.go(); }
        else { state = 'playing'; countdownEl.classList.remove('show'); startMusic(); }
      }
    }
    update(dt);
    updateParticles(dt);
    if (mode) draw();
    requestAnimationFrame(loop);
  }

  /* =======================================================================
     OBRAZOVKY
     ===================================================================== */
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function hideAllScreens() { show(screenMenu, false); show(screenHost, false); show(screenJoin, false); show(overlay, false); }
  function gotoMenu() {
    state = 'menu'; mode = null;
    stopMusic(); closeNet();
    showHud(false); hideAllScreens(); show(screenMenu, true);
  }

  /* =======================================================================
     SÍŤ — PeerJS (WebRTC), bez vlastního serveru
     ===================================================================== */
  function peerErrMsg(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'Hra s tímto kódem neexistuje.';
    if (t === 'unavailable-id')   return 'Kód je obsazený, zkus to znovu.';
    if (t === 'browser-incompatible') return 'Tento prohlížeč nepodporuje WebRTC.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed')
      return 'Nelze se spojit s propojovací službou (zkontroluj internet).';
    return 'Spojení selhalo.';
  }
  function netSend(obj) { if (conn && conn.open) { try { conn.send(obj); } catch (_) {} } }
  function closeNet() {
    try { if (conn) conn.close(); } catch (_) {}
    try { if (peer) peer.destroy(); } catch (_) {}
    conn = null; peer = null;
  }
  function bindConn(c) {
    conn = c;
    c.on('data', (d) => handleNet(d));
    c.on('close', () => onPeerLeft());
    c.on('error', () => {});
  }

  function hostGame() {
    if (!window.Peer) { hostStatus.textContent = '⚠ Online vyžaduje připojení k internetu (PeerJS se nenačetlo).'; return; }
    hideAllScreens(); show(screenHost, true);
    hostCodeEl.textContent = '······';
    hostStatus.textContent = '⏳ Připojuji se…';
    closeNet(); hostTries = 0; tryHost();
  }
  function tryHost() {
    const code = genCode();
    peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    peer.on('open', () => {
      role = 'host';
      hostCodeEl.textContent = code;
      hostStatus.textContent = '⏳ Čekání na druhého hráče…';
    });
    peer.on('connection', (c) => {
      if (conn) { try { c.close(); } catch (_) {} return; }
      bindConn(c);
      c.on('open', () => {
        const seed = randSeed();
        netSend({ t: 'start', seed });
        startGame('online', seed, 'host');
      });
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && hostTries < 5) {
        hostTries++; try { peer.destroy(); } catch (_) {}
        tryHost();
      } else if (state !== 'playing') {
        hostStatus.textContent = '⚠ ' + peerErrMsg(err);
      }
    });
  }

  function joinGame(code) {
    if (!window.Peer) { joinError.textContent = 'Online vyžaduje připojení k internetu (PeerJS se nenačetlo).'; return; }
    joinError.textContent = '⏳ Připojuji…';
    closeNet();
    peer = new Peer({ debug: 0 });
    peer.on('open', () => {
      const c = peer.connect(PEER_PREFIX + code, { reliable: true });
      bindConn(c);
      c.on('open', () => { role = 'guest'; joinError.textContent = '✓ Spojeno, čekání na start…'; });
    });
    peer.on('error', (err) => {
      if (state !== 'playing') joinError.textContent = peerErrMsg(err);
    });
  }

  function handleNet(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'start':
        startGame('online', m.seed, role || 'guest');
        break;
      case 'state': {
        const s = m.s;
        remoteTarget = { y: s[0], worldDist: s[1], alive: s[2] === 1, score: s[3], rot: s[4] };
        if (state === 'over') { lanes[remoteIdx].alive = remoteTarget.alive; lanes[remoteIdx].score = remoteTarget.score; }
        break;
      }
      case 'rematch':
        rematchRemote = true;
        if (state === 'over') overlayHint.innerHTML = 'Soupeř chce odvetu — stiskni <b>MEZERNÍK</b>';
        maybeRestart();
        break;
      case 'left':
        onPeerLeft();
        break;
    }
  }

  function requestRematch() {
    if (mode !== 'online' || state !== 'over') return;
    rematchLocal = true;
    netSend({ t: 'rematch' });
    overlayHint.innerHTML = '⏳ Čekání na soupeře…';
    maybeRestart();
  }
  function maybeRestart() {
    // o restartu rozhoduje hostitel, aby vzniklo jedno společné semínko
    if (role === 'host' && rematchLocal && rematchRemote) {
      const seed = randSeed();
      netSend({ t: 'start', seed });
      startGame('online', seed, 'host');
    }
  }
  function onPeerLeft() {
    if (mode === 'online' || state !== 'menu') {
      countdownEl.classList.remove('show');
      setTimeout(() => alert('Soupeř se odpojil.'), 10);
    }
    gotoMenu();
  }

  /* =======================================================================
     VSTUPY
     ===================================================================== */
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

  function onMenuClick(act) {
    ensureAudio();
    if (act === 'local') startGame('local');
    else if (act === 'host') hostGame();
    else if (act === 'join') {
      hideAllScreens(); show(screenJoin, true);
      joinError.textContent = ''; joinInput.value = '';
      setTimeout(() => joinInput.focus(), 50);
    } else if (act === 'connect') {
      const code = joinInput.value.toUpperCase().trim();
      if (!/^[A-Z]{4}[0-9]{2}$/.test(code)) { joinError.textContent = 'Kód má 4 písmena a 2 číslice (např. ABCD12).'; return; }
      joinGame(code);
    } else if (act === 'back') gotoMenu();
  }

  /* =======================================================================
     INICIALIZACE
     ===================================================================== */
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onPointer);
  overlay.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-act]')) return; onPointer(e); });
  document.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); onMenuClick(el.dataset.act); });
  });
  joinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onMenuClick('connect'); });
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); ensureAudio(); setMuted(!muted); });

  resize();
  buildLanes(false);
  gotoMenu();
  requestAnimationFrame((t) => { lastTime = t; loop(t); });
})();
