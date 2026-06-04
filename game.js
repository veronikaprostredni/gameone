/* =========================================================================
   DASH DUEL — lokální souboj dvou hráčů ve stylu Geometry Dash
   Horní hráč běží po stropě (gravitace nahoru), dolní hráč po zemi.
   Oba skáčou směrem ke středu a vyhýbají se stejným překážkám.
   Vyhrává ten, kdo vydrží déle.
   ========================================================================= */

(() => {
  'use strict';

  // ----- Plátno a kontext -----
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ----- HUD / překryvné prvky -----
  const overlay      = document.getElementById('overlay');
  const overlayText  = document.getElementById('overlay-text');
  const overlayHint  = document.getElementById('overlay-hint');
  const countdownEl  = document.getElementById('countdown');
  const scoreTopEl   = document.getElementById('score-top');
  const scoreBotEl   = document.getElementById('score-bottom');

  // ----- Herní konstanty -----
  const GRAVITY      = 2600;   // px/s^2
  const JUMP_V       = 880;    // počáteční rychlost skoku (px/s)
  const GROUND_H     = 56;     // tloušťka "podlahy" každé poloviny
  const PLAYER_SIZE  = 38;
  const PLAYER_X_FR  = 0.18;   // vodorovná pozice hráče (podíl šířky)
  const START_SPEED  = 360;    // px/s
  const MAX_SPEED    = 820;
  const SPEED_RAMP   = 14;     // přírůstek rychlosti za sekundu
  const SPIKE_W      = 34;
  const SPIKE_H      = 40;
  const COLORS = {
    p1: { core: '#ff3cac', glow: '#ff6ec7', dark: '#7a1450' },
    p2: { core: '#2af5ff', glow: '#6efff0', dark: '#0a6b73' },
  };

  // ----- Stav hry -----
  let W = 0, H = 0, dpr = 1;
  let state = 'ready';          // 'ready' | 'countdown' | 'playing' | 'over'
  let lanes = [];               // [topLane, bottomLane]
  let speed = START_SPEED;
  let elapsed = 0;              // herní čas (s)
  let spawnAcc = 0;             // akumulátor vzdálenosti pro generování překážek
  let nextGap = 0;              // vzdálenost do další překážky
  let particles = [];           // globální částice (efekty)
  let bgScroll = 0;             // posun pozadí (parallax)
  let lastTime = 0;
  let countdownTimer = 0;
  let countdownNum = 0;

  // ===== Pomocné funkce =====
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ===== Rozvržení (responsivní) =====
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildLanes();
  }

  // ===== Vytvoření drah pro oba hráče =====
  function buildLanes() {
    const mid = H / 2;
    const px = Math.round(W * PLAYER_X_FR);

    // Horní hráč: "podlaha" je u horního okraje, gravitace míří NAHORU (-1).
    const topGround = GROUND_H;                 // y povrchu stropu
    const top = {
      id: 'p1',
      colors: COLORS.p1,
      gravitySign: -1,
      groundY: topGround,
      restY: topGround,                          // hráč visí pod stropem
      regionTop: 0,
      regionBottom: mid,
      x: px,
      obstacles: [],
    };

    // Dolní hráč: podlaha u dolního okraje, gravitace DOLŮ (+1).
    const botGround = H - GROUND_H;             // y povrchu země
    const bottom = {
      id: 'p2',
      colors: COLORS.p2,
      gravitySign: 1,
      groundY: botGround,
      restY: botGround - PLAYER_SIZE,            // hráč stojí na zemi
      regionTop: mid,
      regionBottom: H,
      x: px,
      obstacles: [],
    };

    // Zachovat herní stav při změně velikosti okna, jinak inicializovat.
    const preserve = lanes.length === 2;
    [top, bottom].forEach((lane, i) => {
      const old = preserve ? lanes[i] : null;
      lane.y       = old ? old.y       : lane.restY;
      lane.vy      = old ? old.vy      : 0;
      lane.onGround= old ? old.onGround: true;
      lane.alive   = old ? old.alive   : true;
      lane.score   = old ? old.score   : 0;
      lane.rot     = old ? old.rot     : 0;
      lane.obstacles = old ? old.obstacles : [];
      lane.trailAcc = 0;
    });

    lanes = [top, bottom];
  }

  // ===== Reset do výchozího stavu =====
  function resetGame() {
    speed = START_SPEED;
    elapsed = 0;
    spawnAcc = 0;
    nextGap = W * 0.6;
    particles = [];
    lanes.forEach(lane => {
      lane.y = lane.restY;
      lane.vy = 0;
      lane.onGround = true;
      lane.alive = true;
      lane.score = 0;
      lane.rot = 0;
      lane.obstacles = [];
      lane.trailAcc = 0;
    });
    updateScores();
  }

  // ===== Skok =====
  function jump(laneIndex) {
    if (state !== 'playing') return;
    const lane = lanes[laneIndex];
    if (lane.alive && lane.onGround) {
      lane.vy = -JUMP_V * lane.gravitySign;   // proti gravitaci
      lane.onGround = false;
      spawnJumpPuff(lane);
    }
  }

  // ===== Generování překážek (stejné pro obě dráhy = férový závod) =====
  function spawnObstacles() {
    const startX = W + SPIKE_W;
    // 60 % jeden bodec, jinak dvojitý bodec (těžší)
    const doubleSpike = Math.random() < 0.4 && speed > 480;
    lanes.forEach(lane => {
      lane.obstacles.push({ x: startX, w: SPIKE_W, h: SPIKE_H, scored: false });
      if (doubleSpike) {
        lane.obstacles.push({ x: startX + SPIKE_W + 6, w: SPIKE_W, h: SPIKE_H, scored: false });
      }
    });
    // Mezera musí být přeskočitelná: doba výskoku × rychlost + rezerva.
    const airTime = (2 * JUMP_V) / GRAVITY;
    const minGap  = speed * airTime * 1.15 + (doubleSpike ? SPIKE_W * 2 : SPIKE_W);
    nextGap = minGap + rand(60, 260);
  }

  // ===== Aktualizace =====
  function update(dt) {
    if (state !== 'playing') return;

    elapsed += dt;
    speed = Math.min(MAX_SPEED, START_SPEED + elapsed * SPEED_RAMP);
    bgScroll = (bgScroll + speed * dt * 0.35) % 80;

    // Generování překážek podle uražené vzdálenosti
    spawnAcc += speed * dt;
    if (spawnAcc >= nextGap) {
      spawnAcc = 0;
      spawnObstacles();
    }

    let aliveCount = 0;

    lanes.forEach(lane => {
      // Posun překážek
      for (const o of lane.obstacles) o.x -= speed * dt;
      lane.obstacles = lane.obstacles.filter(o => o.x + o.w > -20);

      if (!lane.alive) return;
      aliveCount++;

      // Skóre = uražená vzdálenost (v "metrech")
      lane.score += speed * dt * 0.05;

      // Fyzika hráče
      lane.vy += GRAVITY * lane.gravitySign * dt;
      lane.y  += lane.vy * dt;

      // Přistání: hráč se vrátí k podlaze ve směru gravitace
      const passedRest = (lane.y - lane.restY) * lane.gravitySign >= 0;
      if (passedRest) {
        lane.y = lane.restY;
        lane.vy = 0;
        if (!lane.onGround) {
          lane.onGround = true;
          lane.rot = 0;                 // srovnat kostku po dopadu
          spawnLandPuff(lane);
        }
      } else {
        lane.onGround = false;
        // Rotace kostky ve vzduchu (jako v Geometry Dash)
        lane.rot += (-lane.gravitySign) * 8.5 * dt;
      }

      // Stopa za hráčem
      lane.trailAcc += dt;
      if (lane.trailAcc > 0.02) {
        lane.trailAcc = 0;
        spawnTrail(lane);
      }

      // Kolize s bodci
      const hb = 5; // zmenšení hitboxu kvůli férovosti
      const pL = lane.x + hb, pR = lane.x + PLAYER_SIZE - hb;
      const pT = lane.y + hb, pB = lane.y + PLAYER_SIZE - hb;
      for (const o of lane.obstacles) {
        const oL = o.x + 4, oR = o.x + o.w - 4;
        let oT, oB;
        if (lane.gravitySign > 0) {     // bodce trčí nahoru ze země
          oB = lane.groundY;
          oT = lane.groundY - o.h;
        } else {                        // bodce trčí dolů ze stropu
          oT = lane.groundY;
          oB = lane.groundY + o.h;
        }
        if (pR > oL && pL < oR && pB > oT && pT < oB) {
          killLane(lane);
          break;
        }
      }
    });

    updateScores();

    // Konec hry, když nikdo nežije (nebo zbyl jediný při remíze nelze)
    if (aliveCount === 0) {
      endGame();
    }
  }

  function killLane(lane) {
    if (!lane.alive) return;
    lane.alive = false;
    spawnExplosion(lane);
  }

  // ===== Částicové efekty =====
  function laneCenterY(lane) { return lane.y + PLAYER_SIZE / 2; }

  function spawnExplosion(lane) {
    const cx = lane.x + PLAYER_SIZE / 2;
    const cy = laneCenterY(lane);
    for (let i = 0; i < 38; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 460);
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.5, 1.1), max: 1.1,
        size: rand(3, 8),
        color: Math.random() < 0.5 ? lane.colors.core : lane.colors.glow,
        grav: lane.gravitySign * 600,
      });
    }
  }

  function spawnJumpPuff(lane) {
    const cx = lane.x + PLAYER_SIZE / 2;
    const cy = lane.restY + (lane.gravitySign > 0 ? PLAYER_SIZE : 0);
    for (let i = 0; i < 8; i++) {
      particles.push({
        x: cx + rand(-12, 12), y: cy,
        vx: rand(-80, 80), vy: lane.gravitySign * rand(20, 120),
        life: 0.4, max: 0.4, size: rand(2, 5),
        color: lane.colors.glow, grav: lane.gravitySign * 400,
      });
    }
  }

  function spawnLandPuff(lane) {
    const cx = lane.x + PLAYER_SIZE / 2;
    const cy = lane.restY + (lane.gravitySign > 0 ? PLAYER_SIZE : 0);
    for (let i = 0; i < 10; i++) {
      particles.push({
        x: cx, y: cy,
        vx: rand(-160, 160), vy: -lane.gravitySign * rand(10, 60),
        life: 0.35, max: 0.35, size: rand(2, 5),
        color: '#ffffff', grav: lane.gravitySign * 300,
      });
    }
  }

  function spawnTrail(lane) {
    particles.push({
      x: lane.x + PLAYER_SIZE * 0.2,
      y: laneCenterY(lane) + rand(-6, 6),
      vx: -speed * 0.25, vy: rand(-20, 20),
      life: 0.5, max: 0.5, size: rand(3, 7),
      color: lane.colors.core, grav: 0, glow: true,
    });
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  // ===== Vykreslení =====
  function draw() {
    // Pozadí každé poloviny
    drawHalfBackground(lanes[0]);
    drawHalfBackground(lanes[1]);

    // Středová dělicí linie
    drawDivider();

    // Podlahy, překážky, hráči
    lanes.forEach(drawLane);

    // Částice
    drawParticles();
  }

  function drawHalfBackground(lane) {
    const top = lane.regionTop, h = lane.regionBottom - lane.regionTop;
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    if (lane.gravitySign < 0) {
      g.addColorStop(0, '#1a0a2e');
      g.addColorStop(1, '#0b0420');
    } else {
      g.addColorStop(0, '#0b0420');
      g.addColorStop(1, '#0a1430');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, h);

    // Parallax mřížka
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const off = bgScroll;
    for (let x = -off; x < W; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
    }
    for (let y = top; y < top + h; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawDivider() {
    const mid = H / 2;
    const g = ctx.createLinearGradient(0, mid - 3, 0, mid + 3);
    g.addColorStop(0, COLORS.p1.core);
    g.addColorStop(1, COLORS.p2.core);
    ctx.fillStyle = g;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18;
    ctx.fillRect(0, mid - 2, W, 4);
    ctx.shadowBlur = 0;
  }

  function drawLane(lane) {
    // Podlaha
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    if (lane.gravitySign > 0) {
      ctx.fillRect(0, lane.groundY, W, lane.regionBottom - lane.groundY);
    } else {
      ctx.fillRect(0, lane.regionTop, W, lane.groundY - lane.regionTop);
    }
    // Zářící hrana podlahy
    ctx.fillStyle = lane.colors.core;
    ctx.shadowColor = lane.colors.glow;
    ctx.shadowBlur = 14;
    ctx.fillRect(0, lane.groundY - 2, W, 4);
    ctx.shadowBlur = 0;

    // Překážky (bodce)
    for (const o of lane.obstacles) drawSpike(lane, o);

    // Hráč
    if (lane.alive) drawPlayer(lane);
  }

  function drawSpike(lane, o) {
    const cx = o.x + o.w / 2;
    ctx.save();
    ctx.fillStyle = lane.colors.core;
    ctx.strokeStyle = lane.colors.glow;
    ctx.lineWidth = 2;
    ctx.shadowColor = lane.colors.glow;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    if (lane.gravitySign > 0) {           // trojúhelník vzhůru
      ctx.moveTo(o.x, lane.groundY);
      ctx.lineTo(cx, lane.groundY - o.h);
      ctx.lineTo(o.x + o.w, lane.groundY);
    } else {                              // trojúhelník dolů
      ctx.moveTo(o.x, lane.groundY);
      ctx.lineTo(cx, lane.groundY + o.h);
      ctx.lineTo(o.x + o.w, lane.groundY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(lane) {
    const s = PLAYER_SIZE;
    const cx = lane.x + s / 2;
    const cy = lane.y + s / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(lane.rot);

    // Tělo kostky s gradientem
    const g = ctx.createLinearGradient(-s/2, -s/2, s/2, s/2);
    g.addColorStop(0, lane.colors.glow);
    g.addColorStop(1, lane.colors.core);
    ctx.fillStyle = g;
    ctx.shadowColor = lane.colors.glow;
    ctx.shadowBlur = 20;
    roundRect(-s/2, -s/2, s, s, 7);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Vnitřní detail
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(-s*0.18, -s*0.18, s*0.36, s*0.36, 4);
    ctx.fill();

    // Obrys
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    roundRect(-s/2, -s/2, s, s, 7);
    ctx.stroke();

    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
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

  // ===== Tok hry =====
  function startCountdown() {
    if (state === 'countdown' || state === 'playing') return;
    resetGame();
    state = 'countdown';
    overlay.classList.add('hidden');
    countdownNum = 3;
    countdownTimer = 0;
    showCountdown('3');
  }

  function showCountdown(text) {
    countdownEl.textContent = text;
    countdownEl.classList.remove('show');
    void countdownEl.offsetWidth; // restart animace
    countdownEl.classList.add('show');
  }

  function endGame() {
    state = 'over';
    const s1 = Math.floor(lanes[0].score);
    const s2 = Math.floor(lanes[1].score);
    let msg;
    if (s1 === s2)      msg = `Remíza! Oba ${s1} m.`;
    else if (s1 > s2)   msg = `🏆 Vyhrál HRÁČ 1 — ${s1} m vs ${s2} m`;
    else                msg = `🏆 Vyhrál HRÁČ 2 — ${s2} m vs ${s1} m`;
    overlayText.textContent = msg;
    overlayHint.innerHTML = 'Stiskni <b>MEZERNÍK</b> nebo klepni pro odvetu';
    overlay.classList.remove('hidden');
  }

  // ===== Hlavní smyčka =====
  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000 || 0, 0.05);
    lastTime = t;

    if (state === 'countdown') {
      countdownTimer += dt;
      if (countdownTimer >= 0.8) {
        countdownTimer = 0;
        countdownNum--;
        if (countdownNum > 0)      showCountdown(String(countdownNum));
        else if (countdownNum === 0) showCountdown('START!');
        else { state = 'playing'; countdownEl.classList.remove('show'); }
      }
    }

    update(dt);
    updateParticles(dt);
    draw();

    requestAnimationFrame(loop);
  }

  // ===== Vstupy =====
  function onKey(e) {
    if (e.repeat) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (state === 'ready' || state === 'over') startCountdown();
      return;
    }
    // Hráč 1: W (nebo malé/velké), Hráč 2: šipka nahoru
    if (k === 'w' || k === 'W') { e.preventDefault(); jump(0); }
    if (k === 'ArrowUp')        { e.preventDefault(); jump(1); }
  }

  function onPointer(e) {
    const y = e.clientY;
    if (state === 'ready' || state === 'over') { startCountdown(); return; }
    if (state !== 'playing') return;
    // Horní polovina obrazovky → hráč 1, dolní → hráč 2
    if (y < H / 2) jump(0); else jump(1);
  }

  // ===== Inicializace =====
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onPointer);
  overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); startCountdown(); });

  resize();
  resetGame();
  requestAnimationFrame((t) => { lastTime = t; loop(t); });
})();
