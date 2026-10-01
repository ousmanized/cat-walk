/* ── Constants ───────────────────────────────────────── */
const GRAV   = 2200;  // px/s²
const JUMP_V =  820;  // px/s (upward)

/* ── Canvas / context ────────────────────────────────── */
const cv  = document.getElementById('game');
const ctx = cv.getContext('2d');

let W, H, DPR, groundY;

function resize() {
  DPR     = Math.min(window.devicePixelRatio || 1, 2);
  W       = window.innerWidth;
  H       = window.innerHeight;
  cv.width  = W * DPR;
  cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  groundY = Math.round(H * 0.72);
}

window.addEventListener('resize', resize);
resize();

/* ── DOM refs ────────────────────────────────────────── */
const overlay   = document.getElementById('overlay');
const startBtn  = document.getElementById('start');
const pauseBtn  = document.getElementById('pause-btn');
const coinEl    = document.getElementById('coin-count');
const distEl    = document.getElementById('distance');
const msgEl     = document.getElementById('msg');
const titleEl   = document.getElementById('title');

/* ── Game state ──────────────────────────────────────── */
let state, running = false, paused = false, last = 0;

function reset() {
  state = {
    cam:      0,
    speed:  260,
    coins:    0,
    time:     0,

    player: {
      y:        0,
      vy:       0,
      onGround: true,
      jumps:    0,
      phase:    0,
      hurt:     0,
      squash:   0,
    },

    coinList:  [],
    rocks:     [],
    particles: [],
    popups:    [],
    nextSpawn: 600,
  };
}
reset();

/* ── Procedural generation ───────────────────────────── */
function spawnPattern(x) {
  const s  = state;
  const r  = Math.random();
  const gy = -34;

  if (r < 0.3) {
    const n = 5 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) s.coinList.push({ x: x + i * 50, y: gy });
    return x + n * 50 + 180 + Math.random() * 200;

  } else if (r < 0.6) {
    const n = 7;
    s.rocks.push({ x: x + 150, w: 36, h: 30 });
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      s.coinList.push({ x: x + i * 50, y: gy - Math.sin(k * Math.PI) * 150 });
    }
    return x + n * 50 + 220 + Math.random() * 200;

  } else if (r < 0.8) {
    const n = 5;
    for (let i = 0; i < n; i++) s.coinList.push({ x: x + i * 46, y: -250 });
    return x + n * 46 + 220 + Math.random() * 200;

  } else {
    s.rocks.push({ x: x,       w: 32, h: 26 });
    s.rocks.push({ x: x + 320, w: 42, h: 36 });
    for (let i = 0; i < 4; i++) s.coinList.push({ x: x + 120 + i * 45, y: gy });
    return x + 520 + Math.random() * 200;
  }
}

/* ── Input ───────────────────────────────────────────── */
function jump() {
  if (!running || paused) return;
  const p = state.player;
  if (p.onGround || p.jumps < 2) {
    p.vy = -JUMP_V * (p.onGround ? 1 : 0.85);
    p.onGround = false;
    p.jumps++;
  }
}

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
    e.preventDefault();
    if (!running) start(); else if (!paused) jump();
  }
  if (e.code === 'KeyP') togglePause();
});

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!running) start(); else jump();
});

/* ── Start / pause flow ──────────────────────────────── */
function start() {
  overlay.classList.add('hidden');
  if (!running) {
    running = true;
    paused  = false;
    last    = performance.now();
  }
  if (paused) {
    paused = false;
    pauseBtn.textContent = 'Pause';
    last = performance.now();
  }
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  if (paused) {
    msgEl.textContent = `${state.coins} coin${state.coins !== 1 ? 's' : ''} so far. The road is waiting.`;
    startBtn.textContent = 'Keep walking';
    titleEl.style.display = 'block';
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
    last = performance.now();
  }
}

startBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', togglePause);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !paused) togglePause();
});

/* ── Update ──────────────────────────────────────────── */
function update(dt) {
  const s  = state;
  const p  = s.player;
  const px = W * 0.25;

  s.time += dt;

  // Speed scaling
  const meters = s.cam / 40;
  const level  = Math.floor(meters / 1000);
  const target = Math.min(700, 260 + level * 40);
  s.speed += (target - s.speed) * Math.min(1, dt * 0.8);
  s.cam   += s.speed * dt;

  // Player physics
  p.vy += GRAV * dt;
  p.y  += p.vy * dt;

  if (p.y >= 0) {
    if (!p.onGround) p.squash = 0.15;
    p.y = 0; p.vy = 0; p.onGround = true; p.jumps = 0;
  }

  p.phase  += dt * s.speed / 24;
  p.hurt    = Math.max(0, p.hurt  - dt);
  p.squash  = Math.max(0, p.squash - dt);

  // Spawn patterns
  while (s.nextSpawn < s.cam + W + 300) {
    s.nextSpawn = spawnPattern(s.nextSpawn);
  }

  // Coin collision
  const pyTop = groundY + p.y - 55;
  const pyBot = groundY + p.y;

  for (const c of s.coinList) {
    const cx = c.x - s.cam;
    const cy = groundY + c.y;
    if (Math.abs(cx - px) < 32 && cy > pyTop - 14 && cy < pyBot + 10) {
      c.got = true;
      s.coins++;
      s.particles.push({ x: cx, y: cy, life: 0.3, max: 0.3 });
      s.popups.push({ x: cx, y: cy, life: 0.6, text: '+1' });
    }
  }
  s.coinList = s.coinList.filter(c => !c.got && c.x - s.cam > -60);

  // Rock collision
  for (const r of s.rocks) {
    const rx = r.x - s.cam;
    if (!r.hit && p.hurt <= 0 &&
        px + 16 > rx && px - 20 < rx + r.w &&
        pyBot > groundY - r.h + 6) {
      r.hit  = true;
      p.hurt = 1.2;
      const lost = Math.min(3, s.coins);
      s.coins -= lost;
      if (lost) s.popups.push({ x: px, y: pyTop - 10, life: 0.9, text: `-${lost}` });
    }
  }
  s.rocks = s.rocks.filter(r => r.x - s.cam > -100);

  // Particles & popups
  for (const q of s.particles) q.life -= dt;
  s.particles = s.particles.filter(q => q.life > 0);
  for (const u of s.popups) { u.life -= dt; u.y -= dt * 40; }
  s.popups = s.popups.filter(u => u.life > 0);

  // HUD
  coinEl.textContent = `○ ${s.coins}` ;
  distEl.textContent = `${Math.floor(meters)} m`;
}

/* ── Draw ────────────────────────────────────────────── */
function draw() {
  const s  = state;
  const p  = s.player;
  const px = W * 0.25;

  ctx.clearRect(0, 0, W, H);

  // Ground line
  ctx.fillStyle = '#000';
  ctx.fillRect(0, groundY, W, 3);

  // Scrolling tick marks
  const step = 160;
  const off  = s.cam % step;
  for (let x = -off; x < W + step; x += step) {
    ctx.fillRect(x, groundY + 18, 24, 2);
  }

  // Rocks
  ctx.fillStyle = '#000';
  for (const r of s.rocks) {
    const rx = r.x - s.cam;
    ctx.beginPath();
    ctx.moveTo(rx, groundY + 1);
    ctx.lineTo(rx + r.w / 2, groundY - r.h);
    ctx.lineTo(rx + r.w, groundY + 1);
    ctx.closePath();
    ctx.fill();
  }

  // Coins
  for (const c of s.coinList) {
    drawCoin(c.x - s.cam, groundY + c.y);
  }

  // Cat
  drawCat();

  // Particles
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  for (const q of s.particles) {
    const k = 1 - q.life / q.max;
    ctx.globalAlpha = 1 - k;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 9 + k * 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Popups
  ctx.font      = 'bold 18px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  for (const u of s.popups) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, u.life * 1.5)})`;
    ctx.fillText(u.text, u.x, u.y - 20);
  }
}

function drawCoin(x, y) {
  ctx.fillStyle   = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCat() {
  const s = state;
  const p = s.player;
  const x = W * 0.25;
  const y = groundY + p.y;

  // Flicker during invincibility
  if (p.hurt > 0 && Math.floor(p.hurt * 12) % 2 === 0) return;

  const t        = p.phase;
  const airborne = !p.onGround;
  const bob      = airborne ? 0 : Math.abs(Math.sin(t)) * 2;
  const sq       = p.squash;

  ctx.save();
  ctx.translate(x, y - bob);
  ctx.scale(1 + sq, 1 - sq);

  ctx.fillStyle = ctx.strokeStyle = '#000';

  // Legs
  ctx.lineWidth = 5;
  const swing = airborne ? 0 : Math.sin(t) * 8;
  const legs  = [[12, swing], [-14, -swing], [8, -swing], [-18, swing]];
  const tuck  = airborne ? 6 : 0;
  for (const [lx, sw] of legs) {
    ctx.beginPath();
    ctx.moveTo(lx, -18);
    ctx.lineTo(lx + sw + (airborne ? (lx > 0 ? 8 : -8) : 0), -2 - tuck);
    ctx.stroke();
  }

  // Body
  ctx.beginPath();
  ctx.ellipse(-2, -26, 24, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.lineWidth = 5;
  const sway = Math.sin(t * 0.5) * 6;
  ctx.beginPath();
  ctx.moveTo(-24, -28);
  ctx.quadraticCurveTo(-42, -32 + sway * 0.3, -40, -52 + sway);
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.arc(24, -40, 11, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath(); ctx.moveTo(15, -46); ctx.lineTo(17, -60); ctx.lineTo(24, -50); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(25, -50); ctx.lineTo(32, -59); ctx.lineTo(34, -44); ctx.closePath(); ctx.fill();

  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(29, -42, 2.2, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ── Game loop ───────────────────────────────────────── */
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (running && !paused) update(dt);
  draw();

  requestAnimationFrame(loop);
}

requestAnimationFrame(t => { last = t; loop(t); });
