/* 2D TOP-DOWN DRIFT GAME
   - Canvas rendering
   - Car physics with drift (traction factor)
   - Skid marks trail
   - Score for continuous drift time
   - Collisions with track bounds
*/

// ----- Setup canvas -----
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ----- Track definition (simple racetrack shape) -----
const track = {
  // outer boundary rectangle (full screen margin)
  margin: 60,
  innerOffset: 220, // width of road
  draw(ctx) {
    // draw asphalt area (simple oval-like track)
    // We'll draw a dark background then lighter road
    ctx.save();
    // background
    ctx.fillStyle = '#1f1f1f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // create path for center oval (rounded rectangle)
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rx = Math.max(220, canvas.width / 2 - this.margin - 40);
    const ry = Math.max(140, canvas.height / 2 - this.margin - 40);

    // outer (road outer edge)
    ctx.beginPath();
    roundedEllipse(ctx, cx, cy, rx + 80, ry + 80, 30);
    ctx.fillStyle = '#222';
    ctx.fill();

    // road (lighter)
    ctx.beginPath();
    roundedEllipse(ctx, cx, cy, rx, ry, 30);
    ctx.fillStyle = '#3b3b3b'; // road color
    ctx.fill();

    // inner grass / infield
    ctx.beginPath();
    roundedEllipse(ctx, cx, cy, rx - this.innerOffset, ry - this.innerOffset, 30);
    ctx.fillStyle = '#101316';
    ctx.fill();

    // lane markings (dashed)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 12]);
    ctx.lineDashOffset = performance.now() / -20;
    ctx.beginPath();
    roundedEllipse(ctx, cx, cy, (rx + rx - this.innerOffset) / 2 + 10, (ry + ry - this.innerOffset) / 2 + 10, 30);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  },

  // simple point-in-road test: check distance from center ellipse; inside road if between outer rx and inner rx
  contains(x, y) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rx = Math.max(220, canvas.width / 2 - this.margin - 40);
    const ry = Math.max(140, canvas.height / 2 - this.margin - 40);
    const innerRx = rx - this.innerOffset;
    const innerRy = ry - this.innerOffset;

    // ellipse equation scaled
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const outerVal = nx * nx + ny * ny;

    const nx2 = (x - cx) / innerRx;
    const ny2 = (y - cy) / innerRy;
    const innerVal = nx2 * nx2 + ny2 * ny2;

    // On road if outerVal <= 1 and innerVal >= 1 (between outer and inner ellipse)
    return outerVal <= 1 && innerVal >= 1;
  }
};

// helper: rounded ellipse path
function roundedEllipse(ctx, cx, cy, rx, ry, radius) {
  // approximate rounded ellipse via bezier arc segments (simpler: use ellipse if available)
  if (ctx.ellipse) {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  } else {
    ctx.save();
    ctx.translate(cx - rx, cy);
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(1, 0, 1, 0, Math.PI * 2, false);
    ctx.restore();
  }
}

// ----- Car object (top-down) -----
const car = {
  x: canvas.width / 2 + 0,
  y: canvas.height / 2 - 200,
  angle: Math.PI / 2,   // facing downwards
  width: 36,
  height: 64,
  speed: 0,
  maxSpeed: 520, // arbitrary units (we'll convert display)
  accel: 320, // acceleration units
  brake: 420,
  friction: 220, // natural deceleration
  steerSpeed: 2.6, // radians per second baseline
  traction: 1.0, // 1 = full grip, lower = more slide
  drifting: false,
  lastSkidTime: 0
};

// skid marks (array of {x,y,alpha})
const skids = [];

// input state
const keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// UI refs
const scoreEl = document.getElementById('score');
const driftEl = document.getElementById('drift');
const speedEl = document.getElementById('speed');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const pauseBtn = document.getElementById('pauseBtn');

let running = false;
let paused = false;
let lastTime = 0;
let score = 0;
let driftTimer = 0;
let driftActive = false;

// start and reset
startBtn.addEventListener('click', ()=> { if(!running){ running = true; lastTime = performance.now(); loop(lastTime); } });
resetBtn.addEventListener('click', resetGame);
pauseBtn.addEventListener('click', ()=> { paused = !paused; pauseBtn.textContent = paused ? 'Возобновить' : 'Пауза'; });

// reset game
function resetGame(){
  running = false; paused = false;
  car.x = canvas.width / 2;
  car.y = canvas.height / 2 - 200;
  car.angle = Math.PI / 2;
  car.speed = 0;
  score = 0;
  driftTimer = 0;
  driftActive = false;
  skids.length = 0;
  scoreEl.textContent = '0';
  driftEl.textContent = '0.0s';
  speedEl.textContent = '0';
  lastTime = performance.now();
}

// ----- Main loop -----
function loop(t) {
  if(!running) return;
  if(paused) { lastTime = t; requestAnimationFrame(loop); return; }

  const dt = Math.min(0.04, (t - lastTime) / 1000); // clamp dt for stability
  update(dt);
  render();
  lastTime = t;
  requestAnimationFrame(loop);
}

// ----- Update physics -----
function update(dt) {
  // controls: W/up = accelerate, S/down = brake/reverse, A/left = steer left, D/right = steer right
  const forward = keys['w'] || keys['arrowup'];
  const back = keys['s'] || keys['arrowdown'];
  const left = keys['a'] || keys['arrowleft'];
  const right = keys['d'] || keys['arrowright'];

  // acceleration/brake
  if (forward) {
    car.speed += car.accel * dt;
  } else if (back) {
    car.speed -= car.brake * dt;
  } else {
    // natural friction
    if (car.speed > 0) {
      car.speed -= car.friction * dt;
      if (car.speed < 0) car.speed = 0;
    } else {
      car.speed += car.friction * dt;
      if (car.speed > 0) car.speed = 0;
    }
  }

  // clamp speed to ±maxSpeed
  car.speed = Math.max(-car.maxSpeed * 0.5, Math.min(car.maxSpeed, car.speed));

  // determine turning effectiveness relative to speed and traction
  const speedFactor = Math.min(1, Math.abs(car.speed) / (car.maxSpeed * 0.45)); // more speed = more turning influence for drift
  const baseSteer = car.steerSpeed * (car.speed >= 0 ? 1 : 0.6); // reduced steer in reverse
  let steer = 0;
  if (left) steer = -baseSteer * (0.8 + 0.4 * speedFactor);
  if (right) steer = baseSteer * (0.8 + 0.4 * speedFactor);

  // drift detection: if steering while moving fast -> reduce traction (simulate slide)
  const isTurning = left || right;
  if (isTurning && Math.abs(car.speed) > car.maxSpeed * 0.35) {
    car.traction = 0.35; // more slide
    car.drifting = true;
  } else {
    car.traction = 0.92;
    car.drifting = false;
  }

  // apply angular change: when traction low, car rotates faster than heading change (slip)
  // rotation acceleration based on steer and (1/traction)
  car.angle += steer * dt * (1 + (1 - car.traction));

  // convert car speed to velocity components
  const vx = Math.cos(car.angle) * car.speed * dt;
  const vy = Math.sin(car.angle) * car.speed * dt;

  // advance position (approx)
  car.x += vx;
  car.y += vy;

  // skid generation: if drifting and lateral component high, add skid mark
  if (car.drifting && Math.abs(car.speed) > car.maxSpeed * 0.3) {
    addSkid(car.x - Math.cos(car.angle) * car.height * 0.25, car.y - Math.sin(car.angle) * car.height * 0.25);
    driftTimer += dt;
    driftActive = true;
    // award points proportional to drift time
    score += dt * 25;
  } else {
    if (driftActive) {
      // small bonus for finishing drift
      score += Math.floor(driftTimer * 10);
    }
    driftTimer = 0;
    driftActive = false;
  }

  // clamp car inside canvas simple bounds
  // but check track collision: if car not on track -> collision
  if (!track.contains(car.x, car.y)) {
    // collision: bounce back a bit and penalize
    car.x -= vx * 1.6;
    car.y -= vy * 1.6;
    car.speed *= -0.35;
    // produce big skid
    addSkid(car.x, car.y, 0.8);
    // reduce score
    score = Math.max(0, score - 40);
    // reset drift
    driftTimer = 0;
    driftActive = false;
  }

  // update skids (fade)
  for (let i = skids.length - 1; i >= 0; i--) {
    skids[i].life -= dt;
    skids[i].alpha = Math.max(0, skids[i].life / skids[i].maxLife);
    if (skids[i].life <= 0) skids.splice(i, 1);
  }

  // update UI
  scoreEl.textContent = Math.floor(score);
  driftEl.textContent = driftTimer > 0 ? driftTimer.toFixed(1) + 's' : '0.0s';
  speedEl.textContent = Math.max(0, Math.round(Math.abs(car.speed) / car.maxSpeed * 240)); // show km/h-ish
}

// add skid mark point
function addSkid(x, y, life = 1.2) {
  skids.push({ x, y, life, maxLife: life, alpha: 1, width: 6 + Math.random() * 6 });
  // keep skids array limited
  if (skids.length > 1500) skids.splice(0, skids.length - 1500);
}

// ----- Render -----
function render() {
  // clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // draw track
  track.draw(ctx);

  // draw skids (older first)
  ctx.save();
  for (let i = 0; i < skids.length; i++) {
    const s = skids[i];
    ctx.beginPath();
    ctx.fillStyle = `rgba(8,8,8,${0.25 * s.alpha})`;
    ctx.ellipse(s.x, s.y, s.width, s.width * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // draw car
  drawCar(ctx, car.x, car.y, car.angle, car.width, car.height);
}

// draw top-down car using simple shapes
function drawCar(ctx, x, y, angle, w, h) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // shadow
  ctx.fillStyle = 'rgba(3,3,3,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.3, w * 0.9, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  // main rect
  ctx.fillStyle = '#e6e6e6'; // light color for car body
  roundRect(ctx, -w/2, -h/2, w, h, 6);
  ctx.fill();

  // roof
  ctx.fillStyle = '#bfbfbf';
  roundRect(ctx, -w/3, -h/2 + 8, (w/3)*2, h*0.35, 4);
  ctx.fill();

  // windows
  ctx.fillStyle = 'rgba(12,12,12,0.9)';
  ctx.fillRect(-w*0.25, -h*0.3, w*0.5, h*0.18);

  // wheels (indicate steer)
  ctx.fillStyle = '#202020';
  // left front
  ctx.save();
  ctx.translate(-w*0.45, -h*0.12);
  ctx.rotate(0.15 * steeringVisual());
  ctx.fillRect(-3, -8, 6, 16);
  ctx.restore();
  // right front
  ctx.save();
  ctx.translate(w*0.45, -h*0.12);
  ctx.rotate(0.15 * steeringVisual());
  ctx.fillRect(-3, -8, 6, 16);
  ctx.restore();
  // rear wheels
  ctx.fillRect(-w*0.45, h*0.18, 6, 16);
  ctx.fillRect(w*0.45, h*0.18, 6, 16);

  // accent stripe
  ctx.fillStyle = '#c4122e';
  ctx.fillRect(-w/2 + 6, -h/6, w - 12, 6);

  ctx.restore();
}

// small helper for wheel visual based on keys
function steeringVisual() {
  return ((keys['a'] || keys['arrowleft']) ? -1 : 0) + ((keys['d'] || keys['arrowright']) ? 1 : 0);
}

// helper: rounded rect
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ----- start auto loop on load (not auto-starting gameplay) -----
resetGame();
render();

// keyboard shortcuts: Space to start/pause
window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    if (!running) { running = true; lastTime = performance.now(); loop(lastTime); }
    else { paused = !paused; pauseBtn.textContent = paused ? 'Возобновить' : 'Пауза'; }
  }
});
