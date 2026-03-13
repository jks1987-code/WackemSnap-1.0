/* ============================================================
   WackemSnap – Game Engine
   Animal-themed Tetris with community calorie tracking
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const COLS = 10;
const ROWS = 20;
const LINES_PER_DAY = 10;       // game-days tick every N lines cleared
const BASE_INTERVAL = 850;      // ms between auto-drops at level 1
const MIN_INTERVAL  = 90;       // fastest drop speed
const SPEED_FACTOR  = 0.84;     // multiplied per level
const CAL_PER_PERSON_PER_DAY = 1500;  // minimum daily calories per community member

// ---- Animal definitions ----
const ANIMALS = {
  BUCK: {
    id:    'BUCK',
    name:  'White Tail Buck',
    emoji: '🦌',
    calPerBlock: 200,   // 4 blocks = 800 cal per piece
    color: '#7a3a10',
    hiColor: '#b85a28',
    loColor: '#4a1e06',
  },
  TURKEY: {
    id:    'TURKEY',
    name:  'Wild Turkey',
    emoji: '🦃',
    calPerBlock: 100,   // 4 blocks = 400 cal per piece
    color: '#5c3000',
    hiColor: '#9a5010',
    loColor: '#361800',
  },
  RABBIT: {
    id:    'RABBIT',
    name:  'Rabbit',
    emoji: '🐇',
    calPerBlock: 40,    // 4 blocks = 160 cal per piece
    color: '#7a7a7a',
    hiColor: '#b2b2b2',
    loColor: '#484848',
  },
  GROUSE: {
    id:    'GROUSE',
    name:  'Grouse',
    emoji: '🐦',
    calPerBlock: 20,    // 4 blocks = 80 cal per piece
    color: '#3e6010',
    hiColor: '#6aaa20',
    loColor: '#213306',
  },
};

const ANIMAL_KEYS = ['BUCK', 'TURKEY', 'RABBIT', 'GROUSE'];

// Spawn weights – grouse most common, buck rarest
const WEIGHTS = [1, 2, 4, 5]; // BUCK, TURKEY, RABBIT, GROUSE

// ---- Tetromino shapes  [rotation][row][col] ----
//  BUCK   → J-piece
//  TURKEY → T-piece
//  RABBIT → S-piece
//  GROUSE → I-piece
const SHAPES = {
  BUCK: [
    [[1,0,0],[1,1,1]],
    [[1,1],[1,0],[1,0]],
    [[1,1,1],[0,0,1]],
    [[0,1],[0,1],[1,1]],
  ],
  TURKEY: [
    [[0,1,0],[1,1,1]],
    [[1,0],[1,1],[1,0]],
    [[1,1,1],[0,1,0]],
    [[0,1],[1,1],[0,1]],
  ],
  RABBIT: [
    [[0,1,1],[1,1,0]],
    [[1,0],[1,1],[0,1]],
  ],
  GROUSE: [
    [[1,1,1,1]],
    [[1],[1],[1],[1]],
  ],
};

// Points awarded for clearing N lines simultaneously
const LINE_PTS = [0, 100, 300, 600, 1000];

// Flash animation duration (ms)
const FLASH_MS = 220;

// ============================================================
// STATE
// ============================================================

let G = {}; // game state, reset on each new game
let communitySize = 10;

function resetState() {
  G = {
    board:        createBoard(),
    cur:          null,
    next:         null,
    score:        0,
    level:        1,
    lines:        0,
    totalCal:     0,
    day:          1,
    status:       'playing',  // 'playing' | 'paused' | 'over'
    rafId:        null,
    lastDrop:     0,
    interval:     BASE_INTERVAL,
    communitySize,
    harvestCounts: { BUCK: 0, TURKEY: 0, RABBIT: 0, GROUSE: 0 },
    flashRows:    [],          // rows currently flashing before removal
    flashUntil:   0,
    pendingLines: 0,
    // touch tracking
    tx0: 0, ty0: 0, tt0: 0,
    // button repeat
    repeatTid: null, repeatIid: null,
  };
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

// ============================================================
// CANVAS SETUP
// ============================================================

let canvas, ctx, nCanvas, nCtx, CS; // CS = cell size in px

function setupCanvas() {
  canvas  = document.getElementById('game-canvas');
  ctx     = canvas.getContext('2d');
  nCanvas = document.getElementById('next-canvas');
  nCtx    = nCanvas.getContext('2d');

  const wrap = document.querySelector('.canvas-wrap');
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;

  CS = Math.floor(Math.min(W / COLS, H / ROWS));
  CS = Math.max(CS, 22);

  canvas.width  = CS * COLS;
  canvas.height = CS * ROWS;
}

// ============================================================
// PIECE FACTORY
// ============================================================

function makePiece(type) {
  const shape = SHAPES[type][0];
  return {
    type,
    rot: 0,
    shape,
    x: Math.floor((COLS - shape[0].length) / 2),
    y: 0,
  };
}

function weightedRand(keys, weights) {
  let total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i];
    if (r <= 0) return keys[i];
  }
  return keys[keys.length - 1];
}

function nextPieceType() {
  return weightedRand(ANIMAL_KEYS, WEIGHTS);
}

// ============================================================
// COLLISION
// ============================================================

function collides(board, shape, px, py) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const bx = px + c;
      const by = py + r;
      if (bx < 0 || bx >= COLS)   return true;
      if (by >= ROWS)               return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

// ============================================================
// PIECE MOVEMENT
// ============================================================

function tryMove(dx, dy) {
  if (!G.cur || G.status !== 'playing') return false;
  if (!collides(G.board, G.cur.shape, G.cur.x + dx, G.cur.y + dy)) {
    G.cur.x += dx;
    G.cur.y += dy;
    return true;
  }
  return false;
}

function tryRotate() {
  if (!G.cur || G.status !== 'playing') return;
  const rots = SHAPES[G.cur.type];
  const newRot = (G.cur.rot + 1) % rots.length;
  const newShape = rots[newRot];
  // Wall-kick offsets
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collides(G.board, newShape, G.cur.x + kick, G.cur.y)) {
      G.cur.rot   = newRot;
      G.cur.shape = newShape;
      G.cur.x    += kick;
      return;
    }
  }
}

function hardDrop() {
  if (!G.cur || G.status !== 'playing') return;
  let dropped = 0;
  while (!collides(G.board, G.cur.shape, G.cur.x, G.cur.y + 1)) {
    G.cur.y++;
    dropped++;
  }
  G.score += dropped * 2;
  lockPiece();
}

// ============================================================
// GAME LOOP
// ============================================================

function gameLoop(ts) {
  if (G.status !== 'playing') return;

  // If we're in a flash-wait state, just render and wait
  if (G.flashRows.length > 0) {
    if (ts >= G.flashUntil) {
      finalizeLineClear();
    }
    render(ts);
    G.rafId = requestAnimationFrame(gameLoop);
    return;
  }

  const elapsed = ts - G.lastDrop;
  if (elapsed >= G.interval) {
    G.lastDrop = ts;
    if (!tryMove(0, 1)) {
      lockPiece();
      if (G.status === 'over') return;
    }
  }

  render(ts);
  G.rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
// LOCKING & LINE CLEAR
// ============================================================

function lockPiece() {
  const p = G.cur;

  // Stamp piece on board
  for (let r = 0; r < p.shape.length; r++) {
    for (let c = 0; c < p.shape[r].length; c++) {
      if (!p.shape[r][c]) continue;
      const by = p.y + r;
      const bx = p.x + c;
      if (by < 0) { gameOver('The board filled up – hunt is over!'); return; }
      G.board[by][bx] = p.type;
    }
  }
  G.harvestCounts[p.type]++;

  // Detect complete rows
  const full = [];
  for (let r = 0; r < ROWS; r++) {
    if (G.board[r].every(c => c !== null)) full.push(r);
  }

  if (full.length > 0) {
    // Start flash animation
    G.flashRows  = full;
    G.flashUntil = performance.now() + FLASH_MS;
    G.pendingLines = full.length;
    // Don't advance piece yet – wait for flash to finish
    render(performance.now());
    G.rafId = requestAnimationFrame(gameLoop);
    return;
  }

  advancePiece();
}

function finalizeLineClear() {
  const n = G.pendingLines;

  // Harvest calories from cleared rows
  let earnedCal = 0;
  for (const r of G.flashRows) {
    for (const cell of G.board[r]) {
      if (cell) earnedCal += ANIMALS[cell].calPerBlock;
    }
  }
  G.totalCal += earnedCal;

  // Remove rows (splice and unshift empty)
  // Sort descending so indices stay valid
  const sorted = [...G.flashRows].sort((a, b) => b - a);
  for (const r of sorted) {
    G.board.splice(r, 1);
    G.board.unshift(new Array(COLS).fill(null));
  }

  G.flashRows   = [];
  G.pendingLines = 0;

  // Score
  G.lines += n;
  G.score += LINE_PTS[Math.min(n, 4)] * G.level;

  // Level
  const newLevel = Math.floor(G.lines / 10) + 1;
  if (newLevel > G.level) {
    G.level    = newLevel;
    G.interval = Math.max(MIN_INTERVAL,
      BASE_INTERVAL * Math.pow(SPEED_FACTOR, G.level - 1));
  }

  // Day
  const newDay = Math.floor(G.lines / LINES_PER_DAY) + 1;
  if (newDay > G.day) G.day = newDay;

  updateHUD();
  updateStarvationWarning();
  advancePiece();
}

function advancePiece() {
  G.cur  = G.next;
  G.next = makePiece(nextPieceType());

  if (collides(G.board, G.cur.shape, G.cur.x, G.cur.y)) {
    gameOver('The board filled up – hunt is over!');
    return;
  }

  updateHUD();
  G.lastDrop = performance.now();
  G.rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
// CALORIE / STARVATION SYSTEM
// ============================================================

function dailyNeed() { return G.communitySize * CAL_PER_PERSON_PER_DAY; }
function totalNeeded() { return G.day * dailyNeed(); }

function surplusDays() {
  const dn = dailyNeed();
  if (dn === 0) return 999;
  return (G.totalCal - totalNeeded()) / dn;
}

function updateStarvationWarning() {
  const s = surplusDays();
  const banner = document.getElementById('warn-banner');
  const text   = document.getElementById('warn-text');

  banner.classList.remove('hidden', 'info', 'warn', 'crit');

  if (s < -2) {
    banner.classList.add('crit');
    text.textContent = '🚨 CRITICAL: Community is starving!';
  } else if (s < 0) {
    banner.classList.add('warn');
    text.textContent = '⚠️ Food supplies depleted! Hunt faster!';
  } else if (s < 1.5) {
    banner.classList.add('info');
    text.textContent = '⚠️ Food running low – keep hunting!';
  } else {
    banner.classList.add('hidden');
  }
}

// ============================================================
// HUD
// ============================================================

function updateHUD() {
  document.getElementById('hud-score').textContent = G.score.toLocaleString();
  document.getElementById('hud-level').textContent = G.level;
  document.getElementById('hud-day').textContent   = G.day;

  const earned = G.totalCal;
  const needed = totalNeeded();

  document.getElementById('cal-earned').textContent = fmtCal(earned);
  document.getElementById('cal-needed').textContent = fmtCal(needed);

  // Bar fill: ratio of earned vs needed, capped at 120% visually
  const ratio   = needed > 0 ? earned / needed : 1;
  const fillPct = Math.min(ratio * 100, 100);
  const bar     = document.getElementById('cal-bar-fill');
  bar.style.width = fillPct + '%';

  const s = surplusDays();
  bar.className = 'cal-bar-fill';
  if (s < 0)   bar.classList.add('crit');
  else if (s < 1.5) bar.classList.add('warn');
}

function fmtCal(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toString();
}

// ============================================================
// RENDERING
// ============================================================

function render(ts) {
  if (!ctx) return;

  // Background
  ctx.fillStyle = '#060e06';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawLockedCells(ts);
  if (G.cur) {
    drawGhost();
    drawPiece(ctx, G.cur, CS, 0, 0);
  }
  drawNextPreview();
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth   = 0.5;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CS);
    ctx.lineTo(canvas.width, r * CS);
    ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CS, 0);
    ctx.lineTo(c * CS, canvas.height);
    ctx.stroke();
  }
}

function drawLockedCells(ts) {
  const flash = G.flashRows.length > 0 && ts < G.flashUntil;
  const flashPct = flash ? 1 - (G.flashUntil - ts) / FLASH_MS : 0;

  for (let r = 0; r < ROWS; r++) {
    const isFlash = G.flashRows.includes(r);
    for (let c = 0; c < COLS; c++) {
      const cell = G.board[r][c];
      if (!cell) continue;
      if (isFlash) {
        // Flash white then fade
        ctx.globalAlpha = 0.4 + 0.6 * (1 - flashPct);
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(c * CS + 1, r * CS + 1, CS - 2, CS - 2);
        ctx.globalAlpha = 1;
      } else {
        drawCell(ctx, c, r, cell, CS);
      }
    }
  }
}

function drawGhost() {
  const p = G.cur;
  let ghostY = p.y;
  while (!collides(G.board, p.shape, p.x, ghostY + 1)) ghostY++;
  if (ghostY === p.y) return;

  ctx.globalAlpha = 0.22;
  const a = ANIMALS[p.type];
  ctx.fillStyle = a.color;
  for (let r = 0; r < p.shape.length; r++) {
    for (let c = 0; c < p.shape[r].length; c++) {
      if (!p.shape[r][c]) continue;
      ctx.fillRect((p.x + c) * CS + 1, (ghostY + r) * CS + 1, CS - 2, CS - 2);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPiece(context, piece, cs, offX, offY) {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (!piece.shape[r][c]) continue;
      drawCellAt(context,
        offX + (piece.x + c) * cs,
        offY + (piece.y + r) * cs,
        piece.type, cs);
    }
  }
}

function drawCell(context, col, row, type, cs) {
  drawCellAt(context, col * cs, row * cs, type, cs);
}

function drawCellAt(context, x, y, type, cs) {
  const a = ANIMALS[type];
  const inset = 1;

  // Base fill
  context.fillStyle = a.color;
  context.fillRect(x + inset, y + inset, cs - inset * 2, cs - inset * 2);

  // Bevel highlight (top + left)
  context.fillStyle = a.hiColor;
  context.fillRect(x + inset, y + inset, cs - inset * 2, 3);
  context.fillRect(x + inset, y + inset, 3, cs - inset * 2);

  // Bevel shadow (bottom + right)
  context.fillStyle = a.loColor;
  context.fillRect(x + inset, y + cs - inset - 3, cs - inset * 2, 3);
  context.fillRect(x + cs - inset - 3, y + inset, 3, cs - inset * 2);

  // Emoji (only when cell large enough)
  if (cs >= 26) {
    const fs = Math.floor(cs * 0.52);
    context.font          = `${fs}px serif`;
    context.textAlign     = 'center';
    context.textBaseline  = 'middle';
    context.fillText(a.emoji, x + cs / 2, y + cs / 2 + 1);
  }
}

function drawNextPreview() {
  if (!nCtx || !G.next) return;
  const nw = nCanvas.width;
  const nh = nCanvas.height;

  nCtx.fillStyle = 'rgba(0,0,0,0.6)';
  nCtx.fillRect(0, 0, nw, nh);

  const sh   = G.next.shape;
  const cols = sh[0].length;
  const rows = sh.length;
  const cs   = Math.floor(Math.min(nw / (cols + 1), nh / (rows + 1)));
  const ox   = Math.floor((nw - cols * cs) / 2);
  const oy   = Math.floor((nh - rows * cs) / 2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!sh[r][c]) continue;
      drawCellAt(nCtx, ox + c * cs, oy + r * cs, G.next.type, cs);
    }
  }
}

// ============================================================
// GAME OVER
// ============================================================

function gameOver(reason) {
  G.status = 'over';
  if (G.rafId) cancelAnimationFrame(G.rafId);
  saveScore();
  setTimeout(() => showGameOverScreen(reason), 400);
}

function showGameOverScreen(reason) {
  const starved  = surplusDays() < -1;
  const titleEl  = document.getElementById('go-title');
  const logoEl   = document.getElementById('go-logo');

  titleEl.textContent = starved ? '☠ Community Starved!' : 'Hunt Over';
  titleEl.style.color = starved ? '#cc2222' : '#d4a017';
  // Show logo only on a normal game-over; hide it when community starved
  logoEl.classList.toggle('hidden', starved);

  const { lived, dead } = calcSurvivors();

  document.getElementById('go-reason').textContent    = reason || '';
  document.getElementById('go-score').textContent     = G.score.toLocaleString();
  document.getElementById('go-days').textContent      = G.day;
  document.getElementById('go-cal').textContent       = G.totalCal.toLocaleString();
  document.getElementById('go-lived').textContent     = lived;
  document.getElementById('go-dead').textContent      = dead;

  const badgeWrap = document.getElementById('go-badges');
  badgeWrap.innerHTML = ANIMAL_KEYS
    .filter(k => G.harvestCounts[k] > 0)
    .map(k => `<span class="h-badge">${ANIMALS[k].emoji} ×${G.harvestCounts[k]}</span>`)
    .join('');

  showScreen('gameover');
}

// ============================================================
// SURVIVOR CALCULATION
// ============================================================

function calcSurvivors() {
  // Each person needs 1,500 cal × number of days played
  const calPerPerson = G.day * 1500;
  const deficit      = Math.max(0, totalNeeded() - G.totalCal);
  const dead         = Math.min(G.communitySize, Math.floor(deficit / calPerPerson));
  return { lived: G.communitySize - dead, dead };
}

// ============================================================
// HIGH SCORES  (localStorage)
// ============================================================

function saveScore() {
  try {
    const { lived, dead } = calcSurvivors();
    const key    = 'wackemsnap_v1_scores';
    const scores = JSON.parse(localStorage.getItem(key) || '[]');
    scores.push({
      score: G.score,
      days:  G.day,
      cal:   G.totalCal,
      size:  G.communitySize,
      lived,
      dead,
      date:  new Date().toLocaleDateString(),
    });
    scores.sort((a, b) => b.score - a.score);
    scores.splice(5);
    localStorage.setItem(key, JSON.stringify(scores));
  } catch (_) {}
}

function loadScores() {
  try {
    return JSON.parse(localStorage.getItem('wackemsnap_v1_scores') || '[]');
  } catch (_) { return []; }
}

function renderScores() {
  const el     = document.getElementById('score-list');
  const scores = loadScores();
  if (!scores.length) {
    el.innerHTML = '<div class="score-empty">No hunts recorded yet</div>';
    return;
  }
  el.innerHTML = scores.slice(0, 5).map((s, i) => {
    const livedStr = s.lived !== undefined
      ? `✅${s.lived} ☠${s.dead}`
      : `👥${s.size}`;
    return `<div class="score-row">
      <span>${i + 1}. ${s.score.toLocaleString()}</span>
      <span>${livedStr}</span>
      <span>Day ${s.days}</span>
    </div>`;
  }).join('');
}

// ============================================================
// TOUCH CONTROLS
// ============================================================

function setupTouch() {
  const cv = document.getElementById('game-canvas');
  cv.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    G.tx0 = t.clientX;
    G.ty0 = t.clientY;
    G.tt0 = performance.now();
  }, { passive: true });

  cv.addEventListener('touchend', e => {
    if (G.status !== 'playing') return;
    const t  = e.changedTouches[0];
    const dx = t.clientX - G.tx0;
    const dy = t.clientY - G.ty0;
    const dt = performance.now() - G.tt0;
    const dist = Math.hypot(dx, dy);

    if (dist < 12) {
      // Tap = rotate
      tryRotate();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal swipe – one square per gesture
      tryMove(dx > 0 ? 1 : -1, 0);
    } else {
      // Vertical swipe
      if (dy > 0) {
        if (dt < 180 && dy > CS * 3) {
          hardDrop();
        } else {
          tryMove(0, 1);
        }
      }
    }
  }, { passive: true });
}

// ---- Button repeat ----
function startRepeat(action) {
  doAction(action);
  G.repeatTid = setTimeout(() => {
    G.repeatIid = setInterval(() => doAction(action), 75);
  }, 180);
}

function stopRepeat() {
  clearTimeout(G.repeatTid);
  clearInterval(G.repeatIid);
  G.repeatTid = G.repeatIid = null;
  // Remove pressed state from all buttons
  document.querySelectorAll('.ctrl-btn.pressed').forEach(b => b.classList.remove('pressed'));
}

function doAction(action) {
  if (G.status !== 'playing') return;
  switch (action) {
    case 'left':     tryMove(-1, 0); break;
    case 'right':    tryMove( 1, 0); break;
    case 'down':     tryMove( 0, 1); break;
    case 'rotate':   tryRotate();    break;
    case 'harddrop': hardDrop();     break;
  }
}

// ---- Keyboard ----
document.addEventListener('keydown', e => {
  if (G.status !== 'playing') return;
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); tryMove(-1, 0); break;
    case 'ArrowRight': e.preventDefault(); tryMove( 1, 0); break;
    case 'ArrowDown':  e.preventDefault(); tryMove( 0, 1); break;
    case 'ArrowUp':    e.preventDefault(); tryRotate();    break;
    case ' ':          e.preventDefault(); hardDrop();     break;
    case 'p': case 'P': togglePause(); break;
  }
});

// ============================================================
// PAUSE
// ============================================================

function togglePause() {
  if (G.status === 'playing') {
    G.status = 'paused';
    if (G.rafId) cancelAnimationFrame(G.rafId);
    document.getElementById('pause-overlay').classList.remove('hidden');
  } else if (G.status === 'paused') {
    resumeGame();
  }
}

function resumeGame() {
  G.status   = 'playing';
  G.lastDrop = performance.now();
  document.getElementById('pause-overlay').classList.add('hidden');
  G.rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
// SCREEN MANAGEMENT
// ============================================================

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ============================================================
// PUBLIC ACTIONS (called from HTML)
// ============================================================

function adjustCommunity(delta) {
  communitySize = Math.max(1, Math.min(100, communitySize + delta));
  document.getElementById('comm-display').textContent = communitySize;
  const preview = document.getElementById('cal-preview');
  if (preview) preview.textContent = (communitySize * 1500).toLocaleString();
}

function startGame() {
  resetState();
  showScreen('game');
  setupCanvas();
  setupTouch();

  G.next = makePiece(nextPieceType());
  G.cur  = makePiece(nextPieceType());

  document.getElementById('warn-banner').classList.add('hidden');
  document.getElementById('pause-overlay').classList.add('hidden');
  updateHUD();

  G.lastDrop = performance.now();
  G.rafId    = requestAnimationFrame(gameLoop);
}

function goToMenu() {
  if (G.rafId) cancelAnimationFrame(G.rafId);
  G.status = 'over';
  renderScores();
  showScreen('menu');
}

function showHowTo() { showScreen('howto'); }
function backToMenu() { showScreen('menu'); }

// ============================================================
// BOOT
// ============================================================

window.addEventListener('load', () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  renderScores();
  showScreen('menu');
});
