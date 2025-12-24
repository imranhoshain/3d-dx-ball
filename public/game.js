const baseHref = document.querySelector('base')?.getAttribute('href') || '/';
const basePath = new URL(baseHref, window.location.href).pathname.replace(/\/$/, '');
const socketPath = `${basePath}/socket.io`;
const socket = io({ path: socketPath });

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const comboEl = document.getElementById('combo');
const speedEl = document.getElementById('speed');
const timeEl = document.getElementById('time');
const scoreboardEl = document.getElementById('scoreboard');
const powerupListEl = document.getElementById('powerup-list');
const onlineEl = document.getElementById('online-count');

const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const playerNameInput = document.getElementById('player-name');
const playerPhoneInput = document.getElementById('player-phone');
const formErrorEl = document.getElementById('form-error');
const gameoverOverlay = document.getElementById('gameover-overlay');
const retryBtn = document.getElementById('retry-btn');
const finalScoreEl = document.getElementById('final-score');

const keys = new Set();

const state = {
  status: 'idle',
  score: 0,
  level: 1,
  lives: 3,
  combo: 0,
  time: 0,
  playerName: 'Pilot',
  speedMultiplier: 1,
  baseSpeed: 380,
  lastHitAt: 0,
  arenaWidth: 0,
  arenaHeight: 0,
  bricks: [],
  balls: [],
  powerups: [],
  activePowerups: new Map(),
};

let lastLives = null;

const paddle = {
  width: 120,
  height: 16,
  x: 0,
  y: 0,
  targetX: 0,
  targetWidth: 120,
};

const palette = {
  paddle: '#34f5c5',
  ball: '#f6f7fb',
  brick: '#76a8ff',
  brickStrong: '#f7b267',
  glow: 'rgba(52, 245, 197, 0.35)',
  backdrop: 'rgba(8, 12, 24, 0.8)',
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  state.arenaWidth = rect.width;
  state.arenaHeight = rect.height;
  paddle.y = state.arenaHeight - 30;
  if (state.balls.length === 0) {
    resetPaddle();
  }
}

function resetPaddle() {
  paddle.targetWidth = 120;
  paddle.width = paddle.targetWidth;
  paddle.x = (state.arenaWidth - paddle.width) / 2;
  paddle.targetX = paddle.x;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${mins}:${secs}`;
}

function setFormError(message) {
  formErrorEl.textContent = message || '';
}

function normalizePhone(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { normalized: '', valid: true };
  }
  const digits = trimmed.replace(/\D/g, '');
  const normalized = trimmed.startsWith('+') ? `+${digits}` : digits;
  const valid = digits.length >= 7 && digits.length <= 15;
  return { normalized, valid };
}

function renderLives() {
  livesEl.innerHTML = '';
  if (state.lives <= 0) {
    livesEl.textContent = '0';
    return;
  }
  const heartMarkup =
    '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\">' +
    '<path d=\"M12 21s-7-4.35-9.5-8.35C.5 9.3 2.2 6 5.6 6c2 0 3.4 1.1 4.4 2.6C11 7.1 12.4 6 14.4 6c3.4 0 5.1 3.3 3.1 6.65C19 16.65 12 21 12 21z\" />' +
    '</svg>';
  for (let i = 0; i < state.lives; i += 1) {
    const heart = document.createElement('span');
    heart.className = 'life-heart';
    heart.innerHTML = heartMarkup;
    livesEl.appendChild(heart);
  }
}

function updateHud() {
  scoreEl.textContent = state.score;
  levelEl.textContent = state.level;
  if (state.lives !== lastLives) {
    renderLives();
    lastLives = state.lives;
  }
  comboEl.textContent = state.combo;
  speedEl.textContent = `${state.speedMultiplier.toFixed(1)}x`;
  timeEl.textContent = formatTime(state.time);
}

function createLevel(level) {
  const rows = Math.min(6 + level, 10);
  const cols = 9;
  const margin = 26;
  const gap = 10;
  const availableWidth = state.arenaWidth - margin * 2;
  const brickWidth = (availableWidth - gap * (cols - 1)) / cols;
  const brickHeight = 22;

  const bricks = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if ((row + col + level) % 7 === 0) continue;
      const hp = (row + col + level) % 4 === 0 ? 2 : 1;
      bricks.push({
        x: margin + col * (brickWidth + gap),
        y: 40 + row * (brickHeight + gap),
        w: brickWidth,
        h: brickHeight,
        hp,
      });
    }
  }
  state.bricks = bricks;
}

function spawnBall({ x, y, stuck }) {
  const angle = (-Math.PI / 2) + (Math.random() * 0.6 - 0.3);
  const speed = state.baseSpeed * state.speedMultiplier;
  const ball = {
    x,
    y,
    r: 7,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    stuck,
  };
  state.balls.push(ball);
}

function resetBalls() {
  state.balls = [];
  const x = paddle.x + paddle.width / 2;
  const y = paddle.y - 12;
  spawnBall({ x, y, stuck: true });
}

function resetGame() {
  state.status = 'idle';
  state.score = 0;
  state.level = 1;
  state.lives = 3;
  state.combo = 0;
  state.time = 0;
  state.speedMultiplier = 1;
  state.baseSpeed = 380;
  state.activePowerups.clear();
  state.powerups = [];
  resetPaddle();
  createLevel(state.level);
  resetBalls();
  updateHud();
  renderPowerups();
}

function launchBalls() {
  state.balls.forEach((ball) => {
    if (ball.stuck) {
      ball.stuck = false;
      const angle = (-Math.PI / 2) + (Math.random() * 0.6 - 0.3);
      const speed = state.baseSpeed * state.speedMultiplier;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
    }
  });
  if (state.status === 'idle') {
    state.status = 'playing';
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function circleRectCollision(ball, rect) {
  const closestX = clamp(ball.x, rect.x, rect.x + rect.w);
  const closestY = clamp(ball.y, rect.y, rect.y + rect.h);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  if (dx * dx + dy * dy <= ball.r * ball.r) {
    return { dx, dy };
  }
  return null;
}

function applySpeedMultiplier() {
  const speed = state.baseSpeed * state.speedMultiplier;
  state.balls.forEach((ball) => {
    if (ball.stuck) return;
    const length = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / length) * speed;
    ball.vy = (ball.vy / length) * speed;
  });
}

function activatePowerup(type) {
  const now = performance.now();
  if (type === 'expand') {
    paddle.targetWidth = 170;
    state.activePowerups.set('expand', now + 10000);
  }
  if (type === 'slow') {
    state.speedMultiplier = 0.7;
    state.activePowerups.set('slow', now + 8000);
    applySpeedMultiplier();
  }
  if (type === 'multi') {
    const origin = state.balls[0] || { x: paddle.x, y: paddle.y - 12 };
    spawnBall({ x: origin.x, y: origin.y, stuck: false });
    spawnBall({ x: origin.x, y: origin.y, stuck: false });
  }
  renderPowerups();
}

function renderPowerups() {
  powerupListEl.innerHTML = '';
  if (state.activePowerups.size === 0) {
    const empty = document.createElement('span');
    empty.className = 'small';
    empty.textContent = 'No mods active';
    powerupListEl.appendChild(empty);
    return;
  }
  state.activePowerups.forEach((value, key) => {
    const pill = document.createElement('div');
    pill.className = 'chip-pill';
    pill.textContent = key.toUpperCase();
    powerupListEl.appendChild(pill);
  });
}

function addScore(points) {
  const now = performance.now();
  if (now - state.lastHitAt < 1200) {
    state.combo += 1;
  } else {
    state.combo = 1;
  }
  state.lastHitAt = now;
  state.score += points * state.combo;
}

function spawnPowerup(brick) {
  const roll = Math.random();
  if (roll > 0.22) return;
  const type = roll < 0.1 ? 'expand' : roll < 0.16 ? 'slow' : 'multi';
  state.powerups.push({
    x: brick.x + brick.w / 2,
    y: brick.y,
    size: 16,
    vy: 110,
    type,
  });
}

function updatePowerups(dt) {
  state.powerups.forEach((powerup) => {
    powerup.y += powerup.vy * dt;
  });
  state.powerups = state.powerups.filter((powerup) => {
    if (powerup.y > state.arenaHeight + 40) return false;
    const hit =
      powerup.x > paddle.x &&
      powerup.x < paddle.x + paddle.width &&
      powerup.y + powerup.size > paddle.y &&
      powerup.y < paddle.y + paddle.height;
    if (hit) {
      activatePowerup(powerup.type);
      return false;
    }
    return true;
  });

  const now = performance.now();
  state.activePowerups.forEach((expires, type) => {
    if (now > expires) {
      state.activePowerups.delete(type);
      if (type === 'expand') {
        paddle.targetWidth = 120;
      }
      if (type === 'slow') {
        state.speedMultiplier = 1;
        applySpeedMultiplier();
      }
    }
  });
}

function updatePaddle(dt) {
  if (keys.has('ArrowLeft')) {
    paddle.targetX -= 480 * dt;
  }
  if (keys.has('ArrowRight')) {
    paddle.targetX += 480 * dt;
  }
  paddle.targetX = clamp(paddle.targetX, 10, state.arenaWidth - paddle.width - 10);
  paddle.x += (paddle.targetX - paddle.x) * 0.2;
  paddle.width += (paddle.targetWidth - paddle.width) * 0.15;
}

function handleBallLoss(ball) {
  state.balls = state.balls.filter((b) => b !== ball);
  if (state.balls.length === 0) {
    state.lives -= 1;
    state.combo = 0;
    state.powerups = [];
    if (state.lives <= 0) {
      endGame();
    } else {
      resetBalls();
      state.status = 'idle';
    }
  }
}

function endGame() {
  state.status = 'over';
  finalScoreEl.textContent = state.score;
  gameoverOverlay.classList.remove('hidden');
  socket.emit('score:submit', {
    name: state.playerName,
    score: state.score,
    time: Math.floor(state.time),
    level: state.level,
  });
}

function update(dt) {
  updatePaddle(dt);
  if (state.status === 'playing') {
    state.time += dt;
    updatePowerups(dt);

    state.balls.forEach((ball) => {
      if (ball.stuck) {
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - 12;
        return;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x - ball.r < 0) {
        ball.x = ball.r;
        ball.vx *= -1;
      }
      if (ball.x + ball.r > state.arenaWidth) {
        ball.x = state.arenaWidth - ball.r;
        ball.vx *= -1;
      }
      if (ball.y - ball.r < 0) {
        ball.y = ball.r;
        ball.vy *= -1;
      }

      if (ball.y - ball.r > state.arenaHeight) {
        handleBallLoss(ball);
      }

      const paddleHit =
        ball.y + ball.r >= paddle.y &&
        ball.y + ball.r <= paddle.y + paddle.height &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.width &&
        ball.vy > 0;

      if (paddleHit) {
        const hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
        const angle = hitPoint * (Math.PI / 2.8);
        const speed = state.baseSpeed * state.speedMultiplier;
        ball.vx = Math.sin(angle) * speed;
        ball.vy = -Math.cos(angle) * speed;
      }

      state.bricks.forEach((brick) => {
        if (brick.hp <= 0) return;
        const collision = circleRectCollision(ball, brick);
        if (!collision) return;
        const { dx, dy } = collision;
        if (Math.abs(dx) > Math.abs(dy)) {
          ball.vx *= -1;
        } else {
          ball.vy *= -1;
        }
        brick.hp -= 1;
        addScore(40);
        if (brick.hp <= 0) {
          addScore(60);
          spawnPowerup(brick);
        }
      });
    });
  } else {
    state.balls.forEach((ball) => {
      if (ball.stuck) {
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - 12;
      }
    });
  }

  const remaining = state.bricks.filter((brick) => brick.hp > 0);
  state.bricks = remaining;
  if (state.status !== 'over' && state.bricks.length === 0) {
    state.level += 1;
    state.combo = 0;
    state.baseSpeed += 20;
    createLevel(state.level);
    resetBalls();
    state.status = 'idle';
  }
}

function drawBackground() {
  ctx.fillStyle = palette.backdrop;
  ctx.fillRect(0, 0, state.arenaWidth, state.arenaHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let y = 0; y < state.arenaHeight; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.arenaWidth, y);
    ctx.stroke();
  }
}

function drawBricks() {
  state.bricks.forEach((brick) => {
    const strength = brick.hp;
    const gradient = ctx.createLinearGradient(brick.x, brick.y, brick.x + brick.w, brick.y + brick.h);
    gradient.addColorStop(0, strength === 2 ? palette.brickStrong : palette.brick);
    gradient.addColorStop(1, 'rgba(255,255,255,0.25)');
    ctx.fillStyle = gradient;
    ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.strokeRect(brick.x, brick.y, brick.w, brick.h);
  });
}

function drawPaddle() {
  ctx.fillStyle = palette.paddle;
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 12;
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
  ctx.shadowBlur = 0;
}

function drawBalls() {
  state.balls.forEach((ball) => {
    ctx.beginPath();
    ctx.fillStyle = palette.ball;
    ctx.shadowColor = 'rgba(246, 247, 251, 0.5)';
    ctx.shadowBlur = 10;
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawPowerups() {
  state.powerups.forEach((powerup) => {
    ctx.beginPath();
    ctx.fillStyle = powerup.type === 'expand' ? '#34f5c5' : powerup.type === 'slow' ? '#f7b267' : '#76a8ff';
    ctx.arc(powerup.x, powerup.y, powerup.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0f1a';
    ctx.font = '12px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(powerup.type[0].toUpperCase(), powerup.x, powerup.y + 1);
  });
}

function render() {
  drawBackground();
  drawBricks();
  drawPowerups();
  drawPaddle();
  drawBalls();
}

let lastTime = 0;
function loop(timestamp) {
  const dt = Math.min(0.033, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  update(dt);
  updateHud();
  render();
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  resize();
  createLevel(state.level);
});

window.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  paddle.targetX = clamp(x - paddle.width / 2, 10, state.arenaWidth - paddle.width - 10);
});

window.addEventListener('touchmove', (event) => {
  const touch = event.touches[0];
  if (!touch) return;
  const rect = canvas.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  paddle.targetX = clamp(x - paddle.width / 2, 10, state.arenaWidth - paddle.width - 10);
}, { passive: true });

window.addEventListener('keydown', (event) => {
  keys.add(event.key);
  if (event.key === ' ' || event.code === 'Space') {
    launchBalls();
  }
  if (event.key.toLowerCase() === 'p') {
    if (state.status === 'playing') {
      state.status = 'paused';
    } else if (state.status === 'paused') {
      state.status = 'playing';
    }
  }
  if (event.key.toLowerCase() === 'r') {
    resetGame();
  }
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key);
});

canvas.addEventListener('click', () => {
  launchBalls();
});

startBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Pilot';
  const phoneRaw = playerPhoneInput.value.trim();
  const phoneCheck = normalizePhone(phoneRaw);
  if (!phoneCheck.valid) {
    setFormError('Enter a valid phone number (7-15 digits).');
    return;
  }
  setFormError('');
  socket.emit('player:join', { name, phone: phoneCheck.normalized }, (response) => {
    if (!response || !response.ok) {
      setFormError(response?.message || 'Unable to join the arena.');
      return;
    }
    state.playerName = name;
    startOverlay.classList.add('hidden');
    resetGame();
  });
});

retryBtn.addEventListener('click', () => {
  gameoverOverlay.classList.add('hidden');
  resetGame();
});

playerNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    startBtn.click();
  }
});

playerPhoneInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    startBtn.click();
  }
});

playerPhoneInput.addEventListener('input', () => {
  if (formErrorEl.textContent) {
    setFormError('');
  }
});

socket.on('scoreboard:update', (scores) => {
  scoreboardEl.innerHTML = '';
  if (!scores || scores.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No runs yet. Be the first!';
    scoreboardEl.appendChild(empty);
    return;
  }
  scores.forEach((entry, index) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${entry.name}`;
    const meta = document.createElement('span');
    meta.textContent = `${entry.score} pts · L${entry.level}`;
    item.appendChild(name);
    item.appendChild(meta);
    scoreboardEl.appendChild(item);
  });
});

socket.on('presence:update', ({ count }) => {
  if (typeof count === 'number') {
    onlineEl.textContent = count;
  }
});

socket.on('player:error', ({ message }) => {
  setFormError(message || 'Unable to join the arena.');
});

resize();
resetGame();
requestAnimationFrame(loop);
