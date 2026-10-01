# Build an Endless Runner Game with HTML Canvas

This tutorial walks you through building **Cat Walk** — a complete browser-based endless runner — using only HTML, CSS, and vanilla JavaScript. No libraries, no build tools, just a single `.html` file.

---

## What You'll Build

A side-scrolling game where a black-and-white cat runs forever, collects coins, and avoids rocks. Features include:
- Smooth canvas rendering with HiDPI support
- Physics-based movement (gravity, jump, double-jump)
- Procedural level generation
- Increasing difficulty over time
- Pause / resume flow
- Touch and keyboard input

---

## Step 1 — HTML Shell

Start with a minimal page. The game renders entirely on a `<canvas>` element.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>Cat Walk</title>
</head>
<body>
  <canvas id="game"></canvas>
</body>
</html>
```

**Key points:**
- `user-scalable=no` prevents pinch-zoom on mobile from interfering with touch jumps.
- The canvas has no `width`/`height` attributes here — we set those in JavaScript to match the window and the device pixel ratio.

---

## Step 2 — CSS Layout

The canvas should fill the whole screen. All other UI sits on top in fixed `div` layers.

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  height: 100%;
  overflow: hidden;
  background: #fff;
  color: #000;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  touch-action: none;   /* stop the browser handling swipes/pans */
  user-select: none;    /* no text selection during play */
}
canvas { display: block; width: 100vw; height: 100vh; }
```

Add three overlay layers on top of the canvas:

| Element | Purpose |
|---------|---------|
| `#hud` | Coin count + distance counter + Pause button |
| `#overlay` | Start screen and pause screen |
| `#disclaimer` | Small footer text |

```css
#hud {
  position: fixed; top: 20px; left: 24px; right: 24px;
  display: flex; justify-content: space-between; align-items: flex-start;
  pointer-events: none;   /* clicks pass through to canvas */
}
#overlay {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
  background: rgba(255, 255, 255, .85);
  gap: 16px; padding: 24px;
}
```

---

## Step 3 — HiDPI Canvas Setup

A canvas drawn at CSS size will look blurry on Retina/HiDPI screens. Fix this by scaling the backing buffer by the device pixel ratio.

```js
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let W, H, DPR, groundY;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); // cap at 2× to spare GPU memory
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width  = W * DPR;   // actual pixel dimensions of the buffer
  cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // scale all draw calls uniformly
  groundY = Math.round(H * 0.72);          // ground line sits 72 % down
}

window.addEventListener('resize', resize);
resize(); // call once on load
```

After this, every `ctx` call uses logical CSS pixels — you never have to multiply by DPR yourself.

---

## Step 4 — Game State

Keep all mutable game data in a single `state` object so reset is trivial.

```js
const GRAV   = 2200;  // pixels per second² (downward)
const JUMP_V =  820;  // pixels per second  (upward, negative direction)

let state, running = false, paused = false, last = 0;

function reset() {
  state = {
    cam:      0,      // how far the world has scrolled (px)
    speed:  260,      // current scroll speed (px/s)
    coins:    0,
    time:     0,

    player: {
      y:        0,    // vertical offset from groundY (0 = on the ground)
      vy:       0,    // vertical velocity
      onGround: true,
      jumps:    0,    // jumps used this airtime (max 2)
      phase:    0,    // walk-cycle angle
      hurt:     0,    // seconds of invincibility remaining after a hit
      squash:   0,    // landing squash animation
    },

    coinList:  [],
    rocks:     [],
    particles: [],   // ring effects on coin pickup
    popups:    [],   // floating "+1" / "-N" text
    nextSpawn: 600,  // world-x where the next pattern should be placed
  };
}
reset();
```

---

## Step 5 — Procedural Level Generation

Instead of designing hand-crafted levels, the game generates obstacle/coin patterns on the fly as the camera advances.

```js
function spawnPattern(x) {
  const s = state;
  const r = Math.random();
  const gy = -34; // coin height above ground

  if (r < 0.3) {
    // Pattern A: straight row of coins
    const n = 5 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) s.coinList.push({ x: x + i * 50, y: gy });
    return x + n * 50 + 180 + Math.random() * 200;

  } else if (r < 0.6) {
    // Pattern B: arc of coins over a rock
    const n = 7;
    s.rocks.push({ x: x + 150, w: 36, h: 30 });
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      s.coinList.push({ x: x + i * 50, y: gy - Math.sin(k * Math.PI) * 150 });
    }
    return x + n * 50 + 220 + Math.random() * 200;

  } else if (r < 0.8) {
    // Pattern C: high coins — requires a double jump
    const n = 5;
    for (let i = 0; i < n; i++) s.coinList.push({ x: x + i * 46, y: -250 });
    return x + n * 46 + 220 + Math.random() * 200;

  } else {
    // Pattern D: two rocks with coins between them
    s.rocks.push({ x: x,       w: 32, h: 26 });
    s.rocks.push({ x: x + 320, w: 42, h: 36 });
    for (let i = 0; i < 4; i++) s.coinList.push({ x: x + 120 + i * 45, y: gy });
    return x + 520 + Math.random() * 200;
  }
}
```

The function returns the **next spawn x**, so patterns chain without gaps or overlaps.

During the update loop, spawn whenever the lookahead runs dry:
```js
while (s.nextSpawn < s.cam + W + 300) {
  s.nextSpawn = spawnPattern(s.nextSpawn);
}
```

---

## Step 6 — Input Handling

The game accepts three input sources for jumping:

```js
function jump() {
  if (!running || paused) return;
  const p = state.player;
  if (p.onGround || p.jumps < 2) {          // allow up to 2 jumps
    p.vy = -JUMP_V * (p.onGround ? 1 : 0.85); // second jump is slightly weaker
    p.onGround = false;
    p.jumps++;
  }
}

// Keyboard
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
    e.preventDefault();
    if (!running) start(); else if (!paused) jump();
  }
  if (e.code === 'KeyP') togglePause();
});

// Touch / mouse (pointer events cover both)
cv.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });
```

---

## Step 7 — Start and Pause Flow

```js
const overlay = document.getElementById('overlay');

function start() {
  overlay.classList.add('hidden');
  if (!running) {
    running = true;
    paused  = false;
    last    = performance.now(); // reset the clock to avoid a large first dt
  }
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  if (paused) {
    document.getElementById('msg').textContent =
      `${state.coins} coins so far. The road is waiting.`;
    document.getElementById('start').textContent = 'Keep walking';
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
    last = performance.now(); // reset clock so paused time isn't counted as dt
  }
}

// Auto-pause when the tab becomes hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !paused) togglePause();
});
```

---

## Step 8 — Physics Update

All physics runs in world units (pixels and seconds). `dt` is capped at 33 ms so a momentary freeze doesn't launch the player through the floor.

```js
function update(dt) {
  const s = state, p = s.player, px = W * 0.25;
  s.time += dt;

  // --- Speed scaling ---
  const meters = s.cam / 40;                           // 40 px = 1 m
  const level  = Math.floor(meters / 1000);            // level up every 1 km
  const target = Math.min(700, 260 + level * 40);      // cap at 700 px/s
  s.speed += (target - s.speed) * Math.min(1, dt * 0.8); // ease in
  s.cam   += s.speed * dt;

  // --- Player physics ---
  p.vy += GRAV * dt;   // accelerate downward
  p.y  += p.vy * dt;   // integrate position

  if (p.y >= 0) {      // landing
    if (!p.onGround) p.squash = 0.15;   // trigger squash
    p.y = 0; p.vy = 0; p.onGround = true; p.jumps = 0;
  }

  p.phase += dt * s.speed / 24;         // walk cycle speed scales with scroll
  p.hurt   = Math.max(0, p.hurt  - dt);
  p.squash = Math.max(0, p.squash - dt);
```

Notice the player **never actually moves horizontally** — the world scrolls left via `s.cam`, and the cat is always drawn at `W * 0.25`.

---

## Step 9 — Collision Detection

### Coins (AABB overlap)

```js
const pyTop = groundY + p.y - 55; // top of cat bounding box
const pyBot = groundY + p.y;       // bottom (feet)

for (const c of s.coinList) {
  const cx = c.x - s.cam;         // screen x of coin
  const cy = groundY + c.y;       // screen y of coin
  if (Math.abs(cx - px) < 32 && cy > pyTop - 14 && cy < pyBot + 10) {
    c.got = true;
    s.coins++;
    s.particles.push({ x: cx, y: cy, life: .3, max: .3 });
    s.popups.push({ x: cx, y: cy, life: .6, text: '+1' });
  }
}
s.coinList = s.coinList.filter(c => !c.got && c.x - s.cam > -60);
```

### Rocks (with invincibility window)

```js
for (const r of s.rocks) {
  const rx = r.x - s.cam;
  if (!r.hit && p.hurt <= 0 &&
      px + 16 > rx && px - 20 < rx + r.w &&
      pyBot > groundY - r.h + 6) {
    r.hit   = true;
    p.hurt  = 1.2;                        // 1.2 s of invincibility
    const lost = Math.min(3, s.coins);
    s.coins -= lost;
    if (lost) s.popups.push({ x: px, y: pyTop - 10, life: .9, text: `-${lost}` });
  }
}
s.rocks = s.rocks.filter(r => r.x - s.cam > -100);
```

---

## Step 10 — Drawing the Scene

### Ground

```js
ctx.fillStyle = '#000';
ctx.fillRect(0, groundY, W, 3);  // ground line

// Scrolling tick marks give a sense of speed
const step = 160, off = s.cam % step;
for (let x = -off; x < W + step; x += step) {
  ctx.fillRect(x, groundY + 18, 24, 2);
}
```

### Rocks (triangle silhouettes)

```js
for (const r of s.rocks) {
  const rx = r.x - s.cam;
  ctx.beginPath();
  ctx.moveTo(rx, groundY + 1);
  ctx.lineTo(rx + r.w / 2, groundY - r.h);
  ctx.lineTo(rx + r.w, groundY + 1);
  ctx.closePath();
  ctx.fill();
}
```

### Coins (outlined circle)

```js
function drawCoin(x, y) {
  ctx.fillStyle   = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
```

---

## Step 11 — Drawing the Cat

The cat is built from primitive shapes positioned relative to the cat's feet (`y` coordinate). All parts animate using `p.phase` (the walk-cycle angle) and `p.squash`.

```js
function drawCat() {
  const s = state, p = s.player;
  const x = W * 0.25, y = groundY + p.y;

  // Blink/flash during invincibility
  if (p.hurt > 0 && Math.floor(p.hurt * 12) % 2 === 0) return;

  const t        = p.phase;
  const airborne = !p.onGround;
  const bob      = airborne ? 0 : Math.abs(Math.sin(t)) * 2; // vertical bounce
  const sq       = p.squash;

  ctx.save();
  ctx.translate(x, y - bob);
  ctx.scale(1 + sq, 1 - sq);  // squash on landing (wider, shorter)

  ctx.fillStyle = ctx.strokeStyle = '#000';

  // --- Legs (two diagonal pairs) ---
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

  // --- Body ---
  ctx.beginPath();
  ctx.ellipse(-2, -26, 24, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- Tail (animated sway) ---
  ctx.lineWidth = 5;
  const sway = Math.sin(t * 0.5) * 6;
  ctx.beginPath();
  ctx.moveTo(-24, -28);
  ctx.quadraticCurveTo(-42, -32 + sway * 0.3, -40, -52 + sway);
  ctx.stroke();

  // --- Head ---
  ctx.beginPath();
  ctx.arc(24, -40, 11, 0, Math.PI * 2);
  ctx.fill();

  // --- Ears ---
  ctx.beginPath(); ctx.moveTo(15, -46); ctx.lineTo(17, -60); ctx.lineTo(24, -50); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(25, -50); ctx.lineTo(32, -59); ctx.lineTo(34, -44); ctx.closePath(); ctx.fill();

  // --- Eye ---
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(29, -42, 2.2, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
```

### Pickup particles and popups

```js
// Expanding ring on coin pickup
for (const q of s.particles) {
  const k = 1 - q.life / q.max;
  ctx.globalAlpha = 1 - k;
  ctx.beginPath();
  ctx.arc(q.x, q.y, 9 + k * 18, 0, Math.PI * 2);
  ctx.stroke();
}
ctx.globalAlpha = 1;

// Floating text
ctx.font = 'bold 18px "Helvetica Neue", Helvetica, Arial, sans-serif';
ctx.textAlign = 'center';
for (const u of s.popups) {
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, u.life * 1.5)})`;
  ctx.fillText(u.text, u.x, u.y - 20);
}
```

---

## Step 12 — The Game Loop

`requestAnimationFrame` drives the loop. Capping `dt` at 33 ms prevents physics explosions if the tab was backgrounded or the frame dropped.

```js
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (running && !paused) update(dt);
  draw();

  requestAnimationFrame(loop);
}

// Prime the clock on the very first frame, then hand off to the loop
requestAnimationFrame(t => { last = t; loop(t); });
```

The separation of `update` (world logic) and `draw` (rendering) keeps concerns clean. If you wanted to add a fixed-timestep simulation, you'd modify only `update`.

---

## Concepts Summary

| Concept | Where it appears |
|---------|-----------------|
| HiDPI canvas scaling | `resize()` — `DPR`, `setTransform` |
| Relative coords via `cam` | Every coin/rock x is `worldX - s.cam` |
| Integrate with dt | `p.vy += GRAV * dt`, `p.y += p.vy * dt` |
| Double jump | `p.jumps < 2` guard in `jump()` |
| Invincibility frames | `p.hurt` countdown, flicker on odd frame |
| Squash & stretch | `ctx.scale(1+sq, 1-sq)` on landing |
| Procedural generation | `spawnPattern` chains via return value |
| Speed scaling | Level-based target speed, eased with `dt * 0.8` |
| HUD update | Direct DOM writes inside `update()` |

---

## Exercises

1. **Add a high-score display** — store the best coin count in `localStorage` and show it on the overlay.
2. **Add a second obstacle type** — a pit (gap in the ground) that kills the player instantly.
3. **Add sound** — use the Web Audio API to play a short tone on jump and a lower tone on coin pickup.
4. **Add a parallax background** — draw subtle grey shapes behind the ground that scroll at 40 % of the camera speed.
5. **Mobile controls** — add an on-screen jump button for mobile players who prefer a fixed target over a tap anywhere.
