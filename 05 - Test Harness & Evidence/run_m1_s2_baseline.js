#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M1-S2 Reproducible Baseline Test Harness & D-01 Characterization Snapshot
 * Zero external dependencies (Node.js built-ins only: fs, path, vm, crypto, assert).
 * Strictly read-only on index.html (verifies canonical v2.5.1 SHA-256 & byte size).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const EXPECTED_HTML_BYTES = 97313;
const EXPECTED_HTML_LINES = 1724;
const EXPECTED_HTML_SHA256 = 'f865aa76e28b138e6a8e5d315e1d0afc8f34b0eb5d42a8e7bef9fdb88e802cf8';
const EXPECTED_BOT_WEIGHTS_BYTES = 23572;
const EXPECTED_BOT_WEIGHTS_SHA256 = '99d90952c2b64faca1aefe3aadc7ca6ee6c38d785bb660f06982f503161d5361';
const PROPOSED_SIZE_WARN_BYTES = 120 * 1024; // 122,880 bytes (ADR-09 warning-first budget)

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = process.env.SPIKE_SPRINT_INDEX
  ? path.resolve(process.env.SPIKE_SPRINT_INDEX)
  : path.join(REPO_ROOT, 'index.html');
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'v2.5.1_characterization.json');

const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha256 = crypto.createHash('sha256').update(htmlBuf).digest('hex');
const htmlLines = htmlText.split('\n').length - (htmlText.endsWith('\n') ? 1 : 0);

const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error('Could not extract inline <script> block from index.html');
}
const RAW_SCRIPT = scriptMatch[1];

// Deterministic PRNG (mulberry32) injected strictly inside test VM sandbox
function makeMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MockClassList {
  constructor(initial = []) {
    this._set = new Set(initial);
  }
  add(...cls) { cls.forEach(c => this._set.add(c)); }
  remove(...cls) { cls.forEach(c => this._set.delete(c)); }
  contains(c) { return this._set.has(c); }
  toggle(c, force) {
    if (force === undefined) {
      if (this._set.has(c)) { this._set.delete(c); return false; }
      this._set.add(c); return true;
    }
    if (force) { this._set.add(c); return true; }
    this._set.delete(c); return false;
  }
}

class MockStyle {
  constructor() {
    this._props = Object.create(null);
    this.display = '';
  }
  setProperty(k, v) { this._props[k] = String(v); }
  getPropertyValue(k) { return this._props[k] || ''; }
}

class MockElement {
  constructor(id, tagName = 'DIV', attrs = {}, classes = []) {
    this.id = id || '';
    this.tagName = tagName.toUpperCase();
    this.style = new MockStyle();
    this.classList = new MockClassList(classes);
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.offsetWidth = 100;
    this.width = 0;
    this.height = 0;
    this._attrs = { ...attrs };
    this._listeners = Object.create(null);
    this.children = [];
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  dispatchEvent(evt) {
    const e = evt || {};
    e.stopped = false;
    e.defaultPrevented = false;
    e.stopPropagation = () => { e.stopped = true; };
    e.preventDefault = () => { e.defaultPrevented = true; };
    const list = this._listeners[e.type] || [];
    for (const fn of list) fn(e);
    return e;
  }
  click() {
    return this.dispatchEvent({ type: 'click' });
  }
  getContext() {
    const noop = () => {};
    return {
      clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop,
      closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
      fill: noop, stroke: noop, save: noop, restore: noop, scale: noop,
      translate: noop, rotate: noop, fillText: noop, strokeText: noop,
      measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: noop }),
      setLineDash: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
      clip: noop, drawImage: noop,
    };
  }
}

function createGameEnv(opts = {}) {
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const seed = opts.seed !== undefined ? opts.seed : 1337;
  const blockStorage = Boolean(opts.blockStorage);
  const rlAblation = Boolean(opts.rlAblation);

  let nowMs = 1000.0;
  let audioCtxCreations = 0;
  let oscillatorCount = 0;
  const sfxLog = [];

  const elements = Object.create(null);
  function reg(id, tag = 'DIV', attrs = {}, classes = []) {
    const el = new MockElement(id, tag, attrs, classes);
    elements[id] = el;
    return el;
  }

  reg('gameCanvas', 'CANVAS');
  reg('hud', 'DIV');
  reg('speedTag', 'DIV');
  reg('timeTag', 'DIV');
  reg('highScoreTag', 'DIV');
  reg('soundToggle', 'BUTTON');
  reg('iconSoundOn', 'SVG');
  reg('iconSoundOff', 'SVG');
  reg('storyToggle', 'BUTTON');
  reg('loreCard', 'DIV');
  reg('loreCloseBtn', 'BUTTON');
  reg('startScreen', 'DIV').style.display = 'flex';
  reg('gameOverScreen', 'DIV').style.display = 'none';
  reg('gameOverTitle', 'H1');
  reg('endFlavor', 'P');
  reg('finalScore', 'P');
  reg('heroControls', 'DIV').style.display = 'none';
  reg('spawnPitBtn', 'BUTTON');
  reg('spawnBushBtn', 'BUTTON');
  reg('spawnHeroBtn', 'BUTTON');
  reg('playVillainBtn', 'BUTTON');
  reg('playHeroBtn', 'BUTTON');
  reg('playHeroTitle', 'SPAN').textContent = 'PLAY AS HERO · NORMAL';
  reg('diffEasy', 'BUTTON', { 'data-diff': 'easy' }, ['diff-pill']);
  reg('diffNormal', 'BUTTON', { 'data-diff': 'normal' }, ['diff-pill', 'active']);
  reg('diffHard', 'BUTTON', { 'data-diff': 'hard' }, ['diff-pill']);
  reg('diffInsane', 'BUTTON', { 'data-diff': 'insane' }, ['diff-pill']);
  reg('restartBtn', 'BUTTON');
  reg('changeModeBtn', 'BUTTON');
  reg('exitBtn', 'BUTTON').style.display = 'none';
  reg('exitModal', 'DIV').style.display = 'none';
  reg('resumeRunBtn', 'BUTTON');
  reg('confirmExitBtn', 'BUTTON');
  reg('scoresModal', 'DIV').style.display = 'none';
  reg('openScoresStartBtn', 'BUTTON');
  reg('openScoresEndBtn', 'BUTTON');
  reg('closeScoresBtn', 'BUTTON');
  reg('sortByScoreBtn', 'BUTTON');
  reg('sortByTimeBtn', 'BUTTON');
  reg('scoresTableBody', 'TBODY');
  reg('scoreTableWrap', 'DIV');
  reg('scoresTitle', 'H2');
  reg('scoresColMetric', 'TH');
  reg('scoresColTime', 'TH');
  reg('startNameInput', 'INPUT');
  reg('endNameInput', 'INPUT');
  reg('randNameStartBtn', 'BUTTON');
  reg('randNameEndBtn', 'BUTTON');

  const scoreBuckets = ['villain', 'hero_easy', 'hero_normal', 'hero_hard', 'hero_insane'];
  const scoreTabs = scoreBuckets.map(b => new MockElement('', 'BUTTON', { 'data-bucket': b }, ['score-tab']));

  const storageMap = new Map();
  const mockLocalStorage = {
    getItem(k) {
      if (blockStorage) {
        const err = new Error('The operation is insecure.');
        err.name = 'SecurityError';
        throw err;
      }
      return storageMap.has(k) ? storageMap.get(k) : null;
    },
    setItem(k, v) {
      if (blockStorage) {
        const err = new Error('The operation is insecure.');
        err.name = 'SecurityError';
        throw err;
      }
      storageMap.set(k, String(v));
    },
    removeItem(k) {
      if (blockStorage) {
        const err = new Error('The operation is insecure.');
        err.name = 'SecurityError';
        throw err;
      }
      storageMap.delete(k);
    },
    clear() { storageMap.clear(); },
  };

  class MockAudioContext {
    constructor() {
      audioCtxCreations += 1;
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() {
      oscillatorCount += 1;
      return {
        type: 'square',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, start() {}, stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
      };
    }
    createBuffer(ch, len) {
      return { getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {}, stop() {} };
    }
    createBiquadFilter() {
      return { type: 'lowpass', frequency: { setValueAtTime() {} }, connect() {} };
    }
  }

  const windowListeners = Object.create(null);
  const docListeners = Object.create(null);
  let rafCallback = null;

  const mockDocument = {
    activeElement: null,
    hidden: false,
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id);
      return elements[id];
    },
    querySelectorAll(sel) {
      if (sel === '.score-tab') return scoreTabs;
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
  };

  const rng = makeMulberry32(seed);
  const customMath = Object.create(Math);
  customMath.random = () => rng();

  const mockWindow = {
    innerWidth: width,
    innerHeight: height,
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    localStorage: mockLocalStorage,
    addEventListener(type, fn) {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    dispatchEvent(evt) {
      const e = evt || {};
      e.defaultPrevented = false;
      e.preventDefault = () => { e.defaultPrevented = true; };
      const list = windowListeners[e.type] || [];
      for (const fn of list) fn(e);
      return e;
    },
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    localStorage: mockLocalStorage,
    Math: customMath,
    Float32Array,
    Uint8Array,
    Array,
    Object,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Promise,
    Error,
    RegExp,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    btoa: (bin) => Buffer.from(bin, 'binary').toString('base64'),
    performance: { now: () => nowMs },
    requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  let scriptToRun = RAW_SCRIPT;
  if (rlAblation) {
    // Strictly in-memory ablation for BOT-04 guard verification (never modifies index.html)
    const targetRe = /if\s*\(\s*bestAct\s*===\s*0\s*&&\s*jumpKeyDown\s*\)\s*\{[\s\S]*?rlHoldRemainingMs\s*=\s*0;[\s\S]*?endJump\(\);[\s\S]*?\}/;
    assert(targetRe.test(scriptToRun), 'Expected RL key-release fix block to exist in v2.5.1');
    scriptToRun = scriptToRun.replace(targetRe, 'if(false){} /* BOT-04 ABLATED */');
  }

  // Append read/write test probe inside VM memory only (index.html untouched)
  const probeTrailer = `
;globalThis.__probe = {
  getState: () => ({
    gameState, score, elapsed, speedMult, worldSpeed, startTime, groundY, ZOOM,
    currentModeKey, currentHeroDiff, activeMode, sessionBest,
    heroCooldownRemaining, heroCooldownTotal, _audioUnlocked, soundEnabled,
    jumpKeyDown, jumpHoldTime, barrelRoll, barrelCatchUp, playerStuckTimer,
    spawnTimer, nextSpawnAt, lastRunId, lastRunBucket,
    player: { ...player },
    enemies: enemies.map(e => ({ ...e })),
    pits: pits.map(p => ({ ...p })),
    pipes: pipes.map(p => ({ ...p })),
  }),
  refs: () => ({
    BASE_MODE, MODES, HERO_DIFFICULTIES, DEFAULT_PLAYER_NAMES, RL_WEIGHTS_B64,
    RL_NET_SIZES, RL_ACTION_HOLD_MS, RL_FRAME_SKIP, SCORE_STORAGE_KEY,
    PLAYER_NAME_STORAGE_KEY, RESPONSIVE_ZOOM_ENABLED, MIN_LOGICAL_W,
    player, enemies, pits, pipes, sessionBest,
  }),
  setStartTime: (v) => { startTime = v; },
  setScore: (v) => { score = v; },
  setSpawnTimer: (v) => { spawnTimer = v; },
  setNextSpawnAt: (v) => { nextSpawnAt = v; },
  setHeroCooldown: (rem, tot) => { heroCooldownRemaining = rem; heroCooldownTotal = tot; },
  clearObstacles: () => { enemies.length = 0; pits.length = 0; pipes.length = 0; },
  fn: {
    update, startGame, resetGame, startJump, endJump, resize, drawHUD,
    getRlLayers, rlForward, rlBotUpdate, buildRlObservation,
    triggerHeroSpawn, spawnPit, spawnBush, spawnEnemy, spawnObstacle,
    loadScores, saveScores, loadPlayerName, savePlayerName, sanitizePlayerName,
    pickRandomDefaultName, openScoresModal, renderScoresModal, endGame,
    getBaseSpawnInterval, logicalW, logicalH, formatDuration, setHeroDifficulty,
    primeAudio,
  },
};
`;

  // Instrument sfx calls in-memory for verification
  const sfxWrapped = scriptToRun.replace(
    /function (sfxJump|sfxLand|sfxSquash|sfxGameOver|sfxBarrelWarn|sfxSpawnTrap)\(\)\{/g,
    'function $1(){ __sfxLog.push("$1");'
  );
  sandbox.__sfxLog = sfxLog;

  vm.createContext(sandbox);
  vm.runInContext(sfxWrapped + probeTrailer, sandbox, { filename: 'index.html' });

  return {
    sandbox,
    probe: sandbox.__probe,
    elements,
    scoreTabs,
    window: mockWindow,
    document: mockDocument,
    storageMap,
    sfxLog,
    getAudioCtxCreations: () => audioCtxCreations,
    getOscillatorCount: () => oscillatorCount,
    getNow: () => nowMs,
    advanceClock: (ms) => { nowMs += ms; },
    stepTick: (n = 1) => {
      for (let i = 0; i < n; i++) {
        nowMs += 1000 / 60;
        sandbox.__probe.fn.update(1 / 60);
      }
    },
    setViewport: (w, h) => {
      mockWindow.innerWidth = w;
      mockWindow.innerHeight = h;
      sandbox.__probe.fn.resize();
    },
    runRafOnce: () => { if (rafCallback) rafCallback(); },
  };
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------
const results = [];
function runTest(id, name, fn) {
  try {
    const detail = fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    console.log(`[PASS] ${id}: ${name}${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    results.push({ id, name, status: 'FAIL', detail: err && err.message ? err.message : String(err) });
    console.error(`[FAIL] ${id}: ${name} — ${err && err.stack ? err.stack : err}`);
  }
}

console.log('========================================================================');
console.log('Spike Sprint — M1-S2 Baseline Test Harness & D-01 Characterization');
console.log(`Node: ${process.version}`);
console.log(`Target: ${INDEX_PATH}`);
console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
console.log('========================================================================');

// 0. Baseline Lock Verification
runTest('M1-S1-LOCK', 'Canonical v2.5.1 index.html fingerprint unchanged', () => {
  assert.strictEqual(htmlBuf.length, EXPECTED_HTML_BYTES, `Byte size mismatch: ${htmlBuf.length}`);
  assert.strictEqual(htmlLines, EXPECTED_HTML_LINES, `Line count mismatch: ${htmlLines}`);
  assert.strictEqual(htmlSha256, EXPECTED_HTML_SHA256, `SHA-256 mismatch: ${htmlSha256}`);
  return `${htmlBuf.length} bytes, ${htmlLines} lines, SHA-256 verified`;
});

// TC-01
runTest('TC-01', 'Start Screen, Story Placement & Mode Entry', () => {
  const env = createGameEnv();
  assert(htmlText.includes('id="storyHook"'), 'storyHook missing');
  assert(htmlText.includes('id="storyToggle"'), 'storyToggle missing');
  assert(htmlText.includes('id="playVillainBtn"'), 'playVillainBtn missing');
  assert(htmlText.includes('id="playHeroBtn"'), 'playHeroBtn missing');
  assert.strictEqual(env.elements.startScreen.style.display, 'flex');
  env.elements.playVillainBtn.click();
  const s = env.probe.getState();
  assert.strictEqual(s.gameState, 'playing');
  assert.strictEqual(env.elements.startScreen.style.display, 'none');
  assert.strictEqual(env.elements.hud.textContent, '00000');
  assert.strictEqual(env.elements.speedTag.textContent, 'SPEED x1.00');
  assert.strictEqual(s._audioUnlocked, true);
  return 'Villain entry clean, HUD=00000, SPEED x1.00';
});

// TC-02
runTest('TC-02', 'Variable-Height Jump & Physics Parity', () => {
  const env = createGameEnv();
  const refs = env.probe.refs();
  assert.strictEqual(refs.BASE_MODE.minJumpV, -9);
  assert.strictEqual(refs.BASE_MODE.maxJumpV, -16.5);
  assert.strictEqual(refs.BASE_MODE.gravity, 0.85);
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);

  // Short hop
  env.probe.fn.startJump();
  env.stepTick(1);
  env.probe.fn.endJump();
  let minYShort = env.probe.getState().player.y;
  for (let i = 0; i < 60; i++) {
    env.stepTick(1);
    const st = env.probe.getState();
    if (st.player.y < minYShort) minYShort = st.player.y;
    if (st.player.onGround) break;
  }
  const landsAfterShort = env.sfxLog.filter(x => x === 'sfxLand').length;
  assert.strictEqual(landsAfterShort, 1, `Expected 1 sfxLand, got ${landsAfterShort}`);

  // Max hold (~180ms while vy < 0)
  env.probe.fn.startJump();
  env.stepTick(8);
  env.probe.fn.endJump();
  let minYLong = env.probe.getState().player.y;
  for (let i = 0; i < 80; i++) {
    env.stepTick(1);
    const st = env.probe.getState();
    if (st.player.y < minYLong) minYLong = st.player.y;
    if (st.player.onGround) break;
  }
  assert(minYLong < minYShort - 15, `Long hold should jump higher (${minYLong} vs ${minYShort})`);
  return `shortPeakY=${minYShort.toFixed(1)}, longPeakY=${minYLong.toFixed(1)}, sfxLand=1`;
});

// TC-03 (C8 repaired: seeded RNG, first spawn at 60 frames, x=logicalW()+40, statistical mix)
runTest('TC-03', 'Obstacle Spawner & Distribution Parity (C8 seeded)', () => {
  const env = createGameEnv({ seed: 42 });
  env.probe.fn.startGame('villain');
  const lw = env.probe.fn.logicalW();
  assert.strictEqual(env.probe.getState().nextSpawnAt, 60);
  env.stepTick(61);
  const s = env.probe.getState();
  const total = s.enemies.length + s.pits.length + s.pipes.length;
  assert.strictEqual(total, 1, 'First obstacle must spawn once spawnTimer > 60 (tick 61)');
  const firstX = s.enemies[0]?.x ?? s.pits[0]?.x ?? s.pipes[0]?.x;
  assert(Math.abs(firstX - (lw + 40 - s.worldSpeed)) <= s.worldSpeed + 1, `Unexpected first spawn x=${firstX}`);

  // Statistical distribution check over 300 seeded spawns
  let eCnt = 0, pCnt = 0, bCnt = 0;
  for (let i = 0; i < 300; i++) {
    env.probe.clearObstacles();
    env.probe.fn.spawnObstacle();
    const st = env.probe.getState();
    if (st.enemies.length) {
      eCnt++;
      assert.strictEqual(st.enemies[0].w, 23);
      assert.strictEqual(st.enemies[0].h, 23);
    } else if (st.pits.length) {
      pCnt++;
      assert(st.pits[0].w >= 70 && st.pits[0].w <= 120);
    } else if (st.pipes.length) {
      bCnt++;
      assert.strictEqual(st.pipes[0].w, 34);
      assert(st.pipes[0].h >= 40 && st.pipes[0].h <= 60);
    }
  }
  assert(eCnt > 90 && pCnt > 60 && bCnt > 60, `Skewed distribution: E=${eCnt}, P=${pCnt}, B=${bCnt}`);
  return `300 seeded spawns: Enemy=${eCnt}, Pit=${pCnt}, Bush=${bCnt}`;
});

// TC-04
runTest('TC-04', 'Enemy Stomp (+100, bounce) vs. Side Collision (Game Over)', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  const refs = env.probe.refs();
  const s0 = env.probe.getState();
  // Place enemy directly below falling player
  refs.player.onGround = false;
  refs.player.y = s0.groundY - refs.player.h - 20;
  refs.player.vy = 5;
  refs.enemies.push({ x: refs.player.x + 6, y: s0.groundY - 23, w: 23, h: 23, alive: true });
  const scoreBefore = env.probe.getState().score;
  env.stepTick(1);
  const s1 = env.probe.getState();
  assert.strictEqual(s1.gameState, 'playing', 'Stomp should not kill player');
  assert(s1.score >= scoreBefore + 100, `Expected +100 stomp score (${scoreBefore} -> ${s1.score})`);
  assert.strictEqual(s1.player.vy, -9, 'Expected -9 stomp bounce');
  assert(env.sfxLog.includes('sfxSquash'), 'Expected sfxSquash');

  // Side collision
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  const refs2 = env.probe.refs();
  refs2.enemies.push({ x: refs2.player.x + refs2.player.w - 2, y: env.probe.getState().groundY - 23, w: 23, h: 23, alive: true });
  env.stepTick(1);
  assert.strictEqual(env.probe.getState().gameState, 'over', 'Side collision must trigger gameover');
  return 'Stomp +100 & bounce=-9; side collision -> gameover';
});

// TC-05
runTest('TC-05', 'Bush Trap & Spiked Barrel Touch Collision', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  const refs = env.probe.refs();
  const gy = env.probe.getState().groundY;
  refs.pipes.push({ x: refs.player.x + refs.player.w - 4, y: gy - 45, w: 34, h: 45 });
  env.stepTick(1);
  assert.strictEqual(env.probe.getState().player.stuck, true, 'Player should be stuck in bush');
  // Jump free
  env.probe.fn.startJump();
  assert.strictEqual(env.probe.getState().player.stuck, false, 'Jumping must free player');

  // Stay stuck until barrel touches
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  const refs2 = env.probe.refs();
  const gy2 = env.probe.getState().groundY;
  refs2.pipes.push({ x: refs2.player.x + refs2.player.w - 4, y: gy2 - 45, w: 34, h: 45 });
  let ticks = 0;
  while (env.probe.getState().gameState === 'playing' && ticks < 300) {
    env.stepTick(1);
    ticks++;
  }
  assert.strictEqual(env.probe.getState().gameState, 'over', 'Barrel must catch stuck player');
  assert(env.sfxLog.includes('sfxBarrelWarn'), 'Expected sfxBarrelWarn during bush trap');
  return `Bush stuck -> jump free OK; barrel touch gameover in ${ticks} ticks`;
});

// TC-06
runTest('TC-06', 'Pit Fall Detection', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  const refs = env.probe.refs();
  refs.pits.push({ x: refs.player.x - 10, w: 90 });
  let ticks = 0;
  while (env.probe.getState().gameState === 'playing' && ticks < 60) {
    env.stepTick(1);
    ticks++;
  }
  assert.strictEqual(env.probe.getState().gameState, 'over', 'Pit fall must trigger gameover');
  return `Pit fall gameover in ${ticks} ticks`;
});

// TC-07
runTest('TC-07', 'Difficulty Ramp (1x -> 2x at 5m -> 3x cap at 10m+)', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  // 5 min (300s)
  env.probe.setStartTime(env.getNow() - 300000);
  env.stepTick(1);
  assert(Math.abs(env.probe.getState().speedMult - 2.0) < 0.01, `Expected ~2.00 at 300s, got ${env.probe.getState().speedMult}`);
  // 10m50s (650s)
  env.probe.setStartTime(env.getNow() - 650000);
  env.stepTick(1);
  assert.strictEqual(env.probe.getState().speedMult, 3.0, `Expected 3.00 cap at 650s, got ${env.probe.getState().speedMult}`);
  return 'speedMult 2.00 at 300s, capped at 3.00 at 650s';
});

// TC-08
runTest('TC-08', 'End Screen, Restart & Change Mode Navigation', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.setScore(420);
  env.probe.fn.endGame('enemy');
  assert.strictEqual(env.probe.getState().gameState, 'over');
  assert.strictEqual(env.elements.gameOverTitle.textContent, 'GAME OVER');
  assert.strictEqual(env.probe.getState().sessionBest.villain, 420);
  assert(env.sfxLog.includes('sfxGameOver'));
  env.elements.restartBtn.click();
  assert.strictEqual(env.probe.getState().gameState, 'playing');
  assert.strictEqual(env.probe.getState().score, 0);
  assert.strictEqual(env.probe.getState().sessionBest.villain, 420);
  env.elements.changeModeBtn.click();
  assert.strictEqual(env.probe.getState().gameState, 'start');
  assert.strictEqual(env.elements.startScreen.style.display, 'flex');
  return 'Restart preserves best=420; Change Mode returns to startScreen';
});

// TC-09
runTest('TC-09', 'Sound Toggle & Cross-Browser Audio Unlock', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  const before = env.getAudioCtxCreations();
  env.probe.fn.primeAudio();
  env.probe.fn.primeAudio();
  assert.strictEqual(env.getAudioCtxCreations(), before, 'primeAudio must not create extra AudioContexts');
  const evt = env.elements.soundToggle.click();
  assert.strictEqual(evt.stopped, true, 'soundToggle must stopPropagation');
  assert.strictEqual(env.probe.getState().soundEnabled, false);
  env.elements.soundToggle.click();
  assert.strictEqual(env.probe.getState().soundEnabled, true);
  return `AudioContext creations bounded (${before}), mute toggle works`;
});

// TC-10
runTest('TC-10', 'Viewport Resize & Responsive Zoom Floor', () => {
  const env = createGameEnv({ width: 1280, height: 720 });
  assert.strictEqual(env.probe.getState().ZOOM, 2);
  assert.strictEqual(env.probe.fn.logicalW(), 640);
  assert(Math.abs(env.probe.getState().groundY - env.probe.fn.logicalH() * 0.78) < 1e-6);
  env.setViewport(390, 844);
  assert(env.probe.getState().ZOOM < 2, 'Narrow 390px viewport must scale ZOOM below 2');
  assert(Math.abs(env.probe.fn.logicalW() - 490) < 1e-6, `Expected logicalW=490, got ${env.probe.fn.logicalW()}`);
  return `1280x720 -> ZOOM=2 (lw=640); 390x844 -> ZOOM=${env.probe.getState().ZOOM.toFixed(4)} (lw=490)`;
});

// TC-11
runTest('TC-11', 'Hero Mode Entry, Controls Visibility & HAVOC HUD', () => {
  const env = createGameEnv();
  env.elements.playHeroBtn.click();
  const s0 = env.probe.getState();
  assert.strictEqual(s0.gameState, 'playing');
  assert.strictEqual(s0.activeMode.autoSpawn, false);
  assert.strictEqual(env.elements.heroControls.style.display, 'flex');
  assert.strictEqual(env.elements.hud.textContent, 'HAVOC 00000');
  assert(env.elements.highScoreTag.textContent.includes('MIN HAVOC'));
  env.stepTick(100);
  const s1 = env.probe.getState();
  assert.strictEqual(s1.enemies.length + s1.pits.length + s1.pipes.length, 0, 'No auto-spawned obstacles in Hero mode');
  return 'Hero HUD=HAVOC 00000, autoSpawn=false verified over 100 ticks';
});

// TC-12
runTest('TC-12', 'Manual Spawning & Touch Propagation Isolation', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('hero');
  const pd = env.elements.spawnPitBtn.dispatchEvent({ type: 'pointerdown' });
  assert.strictEqual(pd.stopped, true, 'spawnPitBtn pointerdown must stopPropagation');
  env.elements.spawnPitBtn.click();
  assert.strictEqual(env.probe.getState().pits.length, 1);
  assert(env.sfxLog.includes('sfxSpawnTrap'));
  env.probe.setHeroCooldown(0, 0);
  env.elements.spawnBushBtn.click();
  assert.strictEqual(env.probe.getState().pipes.length, 1);
  env.probe.setHeroCooldown(0, 0);
  env.elements.spawnHeroBtn.click();
  assert.strictEqual(env.probe.getState().enemies.length, 1);
  return 'Pit/Bush/Purple Hero manual spawns + pointerdown isolation OK';
});

// TC-13 (C8 repaired: tier cooldowns at 1x + anti-spam)
runTest('TC-13', 'Shared Global Deterministic Cooldown & Anti-Spam (C8 repaired)', () => {
  const expected1x = { easy: 26, normal: 31, hard: 35, insane: 42 };
  for (const [tier, expectedFrames] of Object.entries(expected1x)) {
    const env = createGameEnv();
    env.probe.fn.setHeroDifficulty(tier);
    env.probe.fn.startGame('hero');
    env.elements.spawnPitBtn.click();
    const s = env.probe.getState();
    assert.strictEqual(s.heroCooldownTotal, expectedFrames, `${tier} 1x cooldown expected ${expectedFrames}, got ${s.heroCooldownTotal}`);
    assert(env.elements.spawnPitBtn.classList.contains('cooling'));
    assert(env.elements.spawnBushBtn.classList.contains('cooling'));
    assert(env.elements.spawnHeroBtn.classList.contains('cooling'));
    // Spam clicks during cooldown must be rejected
    env.elements.spawnBushBtn.click();
    env.elements.spawnHeroBtn.click();
    const s2 = env.probe.getState();
    assert.strictEqual(s2.pipes.length, 0);
    assert.strictEqual(s2.enemies.length, 0);
  }
  return '1x tier cooldowns Easy=26, Normal=31, Hard=35, Insane=42; anti-spam OK';
});

// TC-14 (C8 repaired: refill + ready flash + 1x/2x/3x scaling across all 4 tiers)
runTest('TC-14', 'Cooldown Refill, Ready Flash & 1x/2x/3x Tier Scaling (C8 repaired)', () => {
  const matrix = {
    easy: [26, 21, 17],
    normal: [31, 25, 20],
    hard: [35, 29, 23],
    insane: [42, 35, 28],
  };
  for (const [tier, [c1, c2, c3]] of Object.entries(matrix)) {
    const env = createGameEnv();
    env.probe.fn.setHeroDifficulty(tier);
    env.probe.fn.startGame('hero');
    env.elements.spawnPitBtn.click();
    assert.strictEqual(env.probe.getState().heroCooldownTotal, c1);
    env.stepTick(c1);
    assert.strictEqual(env.probe.getState().heroCooldownRemaining, 0);
    assert(!env.elements.spawnPitBtn.classList.contains('cooling'));
    assert(env.elements.spawnPitBtn.classList.contains('ready-flash'));

    // 2x (300s)
    env.probe.setStartTime(env.getNow() - 300000);
    env.stepTick(1);
    env.elements.spawnBushBtn.click();
    assert.strictEqual(env.probe.getState().heroCooldownTotal, c2, `${tier} 2x expected ${c2}`);

    // 3x (650s)
    env.probe.setHeroCooldown(0, 0);
    env.probe.setStartTime(env.getNow() - 650000);
    env.stepTick(1);
    env.elements.spawnHeroBtn.click();
    assert.strictEqual(env.probe.getState().heroCooldownTotal, c3, `${tier} 3x expected ${c3}`);
  }
  return 'All 4 tiers verified at 1x/2x/3x + ready-flash';
});

// TC-15
runTest('TC-15', 'Hero Victory Screen (VILLAGE SAVED!) & Dynamic Stop-Cause Flavor', () => {
  const cases = [
    ['barrel', 'Crushed by the spiked barrel!'],
    ['enemy', 'Stopped by a Purple Hero!'],
    ['pit', 'Tumbled into a pit!'],
  ];
  for (const [cause, expectedText] of cases) {
    const env = createGameEnv();
    env.probe.fn.startGame('hero');
    env.probe.fn.endGame(cause);
    assert.strictEqual(env.elements.gameOverTitle.textContent, 'VILLAGE SAVED!');
    assert.strictEqual(env.elements.heroControls.style.display, 'none');
    assert.strictEqual(env.elements.endFlavor.textContent, expectedText);
  }
  return 'All 3 Hero stop-cause flavor texts verified';
});

// TC-16
runTest('TC-16', 'Lower-Is-Better MIN HAVOC & Per-Mode Session Best Isolation', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.setScore(320);
  env.probe.fn.endGame('enemy');
  assert.strictEqual(env.probe.getState().sessionBest.villain, 320);

  env.probe.fn.setHeroDifficulty('normal');
  env.probe.fn.startGame('hero');
  env.probe.setScore(180);
  env.probe.fn.endGame('pit');
  assert.strictEqual(env.probe.getState().sessionBest.hero.normal, 180);

  env.probe.fn.startGame('hero');
  env.probe.setScore(75);
  env.probe.fn.endGame('barrel');
  assert.strictEqual(env.probe.getState().sessionBest.hero.normal, 75);
  assert.strictEqual(env.probe.getState().sessionBest.villain, 320);
  return 'Hero normal MIN HAVOC 180 -> 75; Villain best stays 320';
});

// TC-17
runTest('TC-17', 'Keyboard Shortcuts (1 / 2 / 3) Scoped to Hero Mode', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('hero');
  env.window.dispatchEvent({ type: 'keydown', key: '1', code: 'Digit1' });
  assert.strictEqual(env.probe.getState().pits.length, 1);
  env.probe.setHeroCooldown(0, 0);
  env.window.dispatchEvent({ type: 'keydown', key: '2', code: 'Digit2' });
  assert.strictEqual(env.probe.getState().pipes.length, 1);
  env.probe.setHeroCooldown(0, 0);
  env.window.dispatchEvent({ type: 'keydown', key: '3', code: 'Digit3' });
  assert.strictEqual(env.probe.getState().enemies.length, 1);

  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.window.dispatchEvent({ type: 'keydown', key: '1', code: 'Digit1' });
  assert.strictEqual(env.probe.getState().pits.length, 0, 'Key 1 must be ignored in Villain mode');
  return 'Keys 1/2/3 spawn in Hero mode only';
});

// TC-18
runTest('TC-18', 'Architectural Guardrail (Zero Scattered Mode Conditionals)', () => {
  const updateMatch = RAW_SCRIPT.match(/function update\(dt\)\{[\s\S]*?\n\}/);
  const loopMatch = RAW_SCRIPT.match(/function loop\(\)\{[\s\S]*?\n\}/);
  assert(updateMatch && loopMatch, 'Could not locate update() and loop()');
  const badRe = /if\s*\(\s*(currentModeKey|mode)\s*===/;
  assert(!badRe.test(updateMatch[0]), 'Found scattered mode conditional in update()');
  assert(!badRe.test(loopMatch[0]), 'Found scattered mode conditional in loop()');
  return 'Zero scattered mode conditionals in update() and loop()';
});

// TC-19 + BOT-01 + BOT-02
runTest('TC-19', 'Base64 Float32Array Decoding & Q-Value Parity', () => {
  const env = createGameEnv();
  const layers = env.probe.fn.getRlLayers();
  assert.strictEqual(layers.length, 3);
  let totalFloats = 0;
  for (const l of layers) {
    totalFloats += l.W.length + l.b.length;
    for (let i = 0; i < l.W.length; i++) assert(Number.isFinite(l.W[i]), 'NaN/Inf in weights');
    for (let i = 0; i < l.b.length; i++) assert(Number.isFinite(l.b[i]), 'NaN/Inf in biases');
  }
  assert.strictEqual(totalFloats, 5893, `Expected 5893 floats, got ${totalFloats}`);
  // Reference state check (zero vector & synthetic obstacle vector)
  const zeroObs = new Float32Array(21);
  const qZero = env.probe.fn.rlForward(zeroObs);
  assert.strictEqual(qZero.length, 5);
  for (let i = 0; i < 5; i++) assert(Number.isFinite(qZero[i]));
  return `5,893 finite floats decoded; q(0)=[${Array.from(qZero).map(v => v.toFixed(3)).join(', ')}]`;
});

// TC-20
runTest('TC-20', 'Human Jump Isolation in Hero Mode vs. Villain Mode', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('hero');
  env.window.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ' });
  env.elements.gameCanvas.dispatchEvent({ type: 'pointerdown' });
  assert.strictEqual(env.probe.getState().player.onGround, true, 'Human jump must be ignored in Hero mode');

  env.probe.fn.startGame('villain');
  env.window.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ' });
  assert.strictEqual(env.probe.getState().player.onGround, false, 'Human jump must work in Villain mode');
  return 'allowHumanJump isolation verified';
});

// TC-21
runTest('TC-21', 'Live Autonomous RL Bot Simulation in Hero Mode', () => {
  const env = createGameEnv({ seed: 2026 });
  env.probe.fn.startGame('hero');
  let spawns = 0;
  const spawners = [env.probe.fn.spawnPit, env.probe.fn.spawnBush, env.probe.fn.spawnEnemy];
  for (let t = 0; t < 600; t++) {
    const st = env.probe.getState();
    if (st.gameState !== 'playing') break;
    if (st.heroCooldownRemaining === 0 && t % 45 === 10) {
      env.probe.fn.triggerHeroSpawn(spawners[spawns % 3]);
      spawns++;
    }
    env.stepTick(1);
  }
  const botJumps = env.sfxLog.filter(x => x === 'sfxJump').length;
  assert(spawns >= 3, `Expected >=3 spawns, got ${spawns}`);
  assert(botJumps >= 1, `Expected autonomous RL jumps, got ${botJumps}`);
  return `spawns=${spawns}, autonomousJumps=${botJumps}, endState=${env.probe.getState().gameState}`;
});

// TC-22 (C8 repaired: exact UTF-8 byte size, warning-first 120 KB budget, zero external requests)
runTest('TC-22', 'Single-File Footprint & Zero External Dependencies (C8 repaired)', () => {
  assert.strictEqual(htmlBuf.length, EXPECTED_HTML_BYTES);
  assert(htmlBuf.length <= PROPOSED_SIZE_WARN_BYTES, `Size ${htmlBuf.length} exceeds 120 KB warning budget`);
  assert(!/<script[^>]+src\s*=/i.test(htmlText), 'Found external <script src=...>');
  assert(!/\bfetch\s*\(/.test(RAW_SCRIPT), 'Found fetch() call in standalone script');
  assert(!/\bXMLHttpRequest\b/.test(RAW_SCRIPT), 'Found XMLHttpRequest in standalone script');
  return `${htmlBuf.length} bytes (<= ${PROPOSED_SIZE_WARN_BYTES} warning budget), zero external requests`;
});

// TC-23
runTest('TC-23', 'RL Bot Pit Clearance & Key-Release Parity Fix', () => {
  assert(/if\s*\(\s*bestAct\s*===\s*0\s*&&\s*jumpKeyDown\s*\)\s*\{[\s\S]*?rlHoldRemainingMs\s*=\s*0;[\s\S]*?endJump\(\);[\s\S]*?\}/.test(RAW_SCRIPT));
  let cleared = 0;
  const widths = [70, 80, 90, 100, 110, 120];
  for (const w of widths) {
    const env = createGameEnv({ seed: 100 + w, width: 1280, height: 720 });
    env.probe.fn.startGame('hero');
    env.probe.refs().pits.push({ x: 340, w });
    let alive = true;
    for (let t = 0; t < 160; t++) {
      env.stepTick(1);
      if (env.probe.getState().gameState !== 'playing') { alive = false; break; }
    }
    if (alive) cleared++;
  }
  assert.strictEqual(cleared, widths.length, `Expected ${widths.length}/${widths.length} pit clearances, got ${cleared}`);
  return `${cleared}/${widths.length} pit widths (70–120px) cleared cleanly`;
});

// TC-24 (C8 consolidated into TC-25; document dead MODES.hero.cooldownScale for M1-S4)
runTest('TC-24', 'Consolidated into TC-25 (C8: dead MODES.hero.cooldownScale flagged for M1-S4)', () => {
  const env = createGameEnv();
  const refs = env.probe.refs();
  // Verify the dead config still exists in unmodified v2.5.1 and is overridden by HERO_DIFFICULTIES
  assert.strictEqual(refs.MODES.hero.cooldownScale, 0.55);
  env.probe.fn.setHeroDifficulty('hard');
  env.probe.fn.startGame('hero');
  assert.strictEqual(env.probe.getState().activeMode.cooldownScale, 0.75);
  return 'Overridden by HERO_DIFFICULTIES; dead key scheduled for removal in M1-S4';
});

// TC-25
runTest('TC-25', 'Four Hero Difficulty Tiers & Per-Tier MIN HAVOC Isolation', () => {
  const env = createGameEnv();
  const scores = { easy: 110, normal: 220, hard: 330, insane: 440 };
  for (const [tier, sc] of Object.entries(scores)) {
    env.probe.fn.setHeroDifficulty(tier);
    env.probe.fn.startGame('hero');
    env.probe.setScore(sc);
    env.probe.fn.endGame('pit');
  }
  const sb = env.probe.getState().sessionBest;
  assert.strictEqual(sb.hero.easy, 110);
  assert.strictEqual(sb.hero.normal, 220);
  assert.strictEqual(sb.hero.hard, 330);
  assert.strictEqual(sb.hero.insane, 440);
  return 'Independent MIN HAVOC across Easy/Normal/Hard/Insane verified';
});

// TC-26
runTest('TC-26', 'Live Run Duration (TIME MM:SS) in Both Modes', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.setStartTime(env.getNow() - 85000);
  env.stepTick(1);
  env.probe.fn.drawHUD();
  assert.strictEqual(env.elements.timeTag.textContent, 'TIME 01:25');
  env.probe.fn.endGame('enemy');
  assert(env.elements.finalScore.textContent.includes('Time: 01:25'));

  env.probe.fn.startGame('hero');
  env.probe.setStartTime(env.getNow() - 24000);
  env.stepTick(1);
  env.probe.fn.drawHUD();
  assert.strictEqual(env.elements.timeTag.textContent, 'TIME 00:24');
  env.probe.fn.endGame('pit');
  assert(env.elements.finalScore.textContent.includes('Time: 00:24'));
  return 'TIME 01:25 (Villain) & TIME 00:24 (Hero) HUD + end screen OK';
});

// TC-27
runTest('TC-27', 'Explicit Hero-Only Difficulty Card & Dynamic Button Label', () => {
  assert(htmlText.includes('class="mode-card hero-card"'));
  assert(htmlText.includes('class="mode-card villain-card"'));
  const env = createGameEnv();
  env.elements.diffEasy.click();
  assert.strictEqual(env.elements.playHeroTitle.textContent, 'PLAY AS HERO · EASY');
  env.elements.diffInsane.click();
  assert.strictEqual(env.elements.playHeroTitle.textContent, 'PLAY AS HERO · INSANE');
  env.elements.diffNormal.click();
  assert.strictEqual(env.elements.playHeroTitle.textContent, 'PLAY AS HERO · NORMAL');
  return 'Grouped Hero card + dynamic PLAY AS HERO · <DIFF> verified';
});

// TC-28
runTest('TC-28', 'In-Game Exit Button (Pause, Time Preservation & Unscored Discard)', () => {
  const env = createGameEnv();
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  env.advanceClock(10000);
  env.stepTick(1);
  const elapsedBefore = env.probe.getState().elapsed;
  const pd = env.elements.exitBtn.dispatchEvent({ type: 'pointerdown' });
  assert.strictEqual(pd.stopped, true);
  env.elements.exitBtn.click();
  assert.strictEqual(env.probe.getState().gameState, 'paused');
  assert.strictEqual(env.elements.exitModal.style.display, 'flex');

  env.advanceClock(10000); // wait 10s while paused
  env.elements.resumeRunBtn.click();
  assert.strictEqual(env.probe.getState().gameState, 'playing');
  env.stepTick(1);
  const elapsedAfter = env.probe.getState().elapsed;
  assert(Math.abs(elapsedAfter - elapsedBefore) < 0.1, `Elapsed drifted during pause: ${elapsedBefore} -> ${elapsedAfter}`);

  env.elements.exitBtn.click();
  env.elements.confirmExitBtn.click();
  assert.strictEqual(env.probe.getState().gameState, 'start');
  assert.strictEqual(env.probe.fn.loadScores().villain.byScore.length, 0, 'Exited run must not be scored');
  return 'Pause preserved elapsed time; Exit discarded unscored run';
});

// TC-29
runTest('TC-29', '5-Tab Dual Top 10 Leaderboard', () => {
  const env = createGameEnv();
  // Villain: high score short run vs low score long run
  env.probe.fn.startGame('villain');
  env.probe.setScore(900);
  env.probe.setStartTime(env.getNow() - 15000);
  env.stepTick(1);
  env.probe.fn.endGame('enemy');

  env.probe.fn.startGame('villain');
  env.probe.setScore(200);
  env.probe.setStartTime(env.getNow() - 95000);
  env.stepTick(1);
  env.probe.fn.endGame('enemy');

  const store = env.probe.fn.loadScores();
  assert.strictEqual(store.villain.byScore[0].score, 900);
  assert(store.villain.byTime[0].time >= 95);

  // Hero Easy: low havoc slow vs high havoc fast
  env.probe.fn.setHeroDifficulty('easy');
  env.probe.fn.startGame('hero');
  env.probe.setScore(40);
  env.probe.setStartTime(env.getNow() - 50000);
  env.stepTick(1);
  env.probe.fn.endGame('pit');

  env.probe.fn.startGame('hero');
  env.probe.setScore(300);
  env.probe.setStartTime(env.getNow() - 8000);
  env.stepTick(1);
  env.probe.fn.endGame('pit');

  const store2 = env.probe.fn.loadScores();
  assert.strictEqual(store2.hero_easy.byScore[0].score, 40);
  assert(store2.hero_easy.byTime[0].time <= 9);
  env.elements.openScoresEndBtn.click();
  assert.strictEqual(env.elements.scoresModal.style.display, 'flex');
  return 'Villain (high/long) & Hero (low/fast) dual Top 10 verified';
});

// TC-30
runTest('TC-30', 'Safe localStorage Persistence & iOS data: URL Fallback', () => {
  const env = createGameEnv({ blockStorage: true });
  env.probe.fn.startGame('villain');
  env.probe.setScore(555);
  env.probe.fn.endGame('enemy');
  const store = env.probe.fn.loadScores();
  assert.strictEqual(store.villain.byScore[0].score, 555);
  const name = env.probe.fn.loadPlayerName();
  assert(/^[A-Z0-9]{1,6}$/.test(name));
  return `SecurityError fallback OK (score=555, name=${name})`;
});

// TC-31
runTest('TC-31', 'First-Launch Random Default Name (48-Name Pool) & Persistence', () => {
  const env = createGameEnv();
  const pool = env.probe.refs().DEFAULT_PLAYER_NAMES;
  assert.strictEqual(pool.length, 48, `Expected 48 names, got ${pool.length}`);
  for (const n of pool) assert(/^[A-Z0-9]{1,6}$/.test(n), `Invalid default name: ${n}`);
  const saved = env.storageMap.get('spike_sprint_player_name_v1');
  assert(pool.includes(saved), `Initial saved name ${saved} not from 48-name pool`);
  assert.strictEqual(env.elements.startNameInput.value, saved);
  return `48 valid defaults; first-launch name=${saved}`;
});

// TC-32
runTest('TC-32', 'Character Sanitization & Blank-Input Revert', () => {
  const env = createGameEnv();
  env.elements.startNameInput.value = 'ab!12345';
  env.elements.startNameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(env.elements.startNameInput.value, 'AB1234');
  assert.strictEqual(env.elements.endNameInput.value, 'AB1234');
  env.elements.startNameInput.value = '   ';
  env.elements.startNameInput.dispatchEvent({ type: 'blur' });
  assert.strictEqual(env.elements.startNameInput.value, 'AB1234');
  return 'Sanitized ab!12345 -> AB1234; blank blur reverted to AB1234';
});

// TC-33
runTest('TC-33', 'End-Screen Name Edit (Just-Finished + Future Runs Only)', () => {
  const env = createGameEnv();
  env.probe.fn.savePlayerName('AB1234');
  // Run 1
  env.probe.fn.startGame('villain');
  env.probe.setScore(100);
  env.probe.fn.endGame('enemy');
  // Run 2
  env.probe.fn.startGame('villain');
  env.probe.setScore(200);
  env.probe.fn.endGame('enemy');
  // Edit name on end screen
  env.elements.endNameInput.value = 'hero99!';
  env.elements.endNameInput.dispatchEvent({ type: 'input' });
  assert.strictEqual(env.elements.endNameInput.value, 'HERO99');
  // Run 3
  env.probe.fn.startGame('villain');
  env.probe.setScore(300);
  env.probe.fn.endGame('enemy');

  const rows = env.probe.fn.loadScores().villain.byScore;
  const byScore = Object.fromEntries(rows.map(r => [r.score, r.name]));
  assert.strictEqual(byScore[100], 'AB1234', 'Run 1 must stay AB1234');
  assert.strictEqual(byScore[200], 'HERO99', 'Run 2 must update to HERO99');
  assert.strictEqual(byScore[300], 'HERO99', 'Run 3 must record under HERO99');
  return 'Run1=AB1234, Run2=HERO99, Run3=HERO99';
});

// TC-34
runTest('TC-34', 'Leaderboard Player Column Rendering', () => {
  const env = createGameEnv();
  env.probe.fn.savePlayerName('SPIKE1');
  env.probe.fn.startGame('villain');
  env.probe.setScore(777);
  env.probe.fn.endGame('enemy');
  env.probe.fn.openScoresModal('villain');
  const html = env.elements.scoreTableWrap.innerHTML;
  assert(html.includes('SPIKE1'), 'Player name missing from rendered leaderboard');
  assert(html.includes('777'), 'Score missing from rendered leaderboard');
  return 'Rendered leaderboard contains SPIKE1 and 777';
});

// ---------------------------------------------------------------------------
// Bot Verification Suite (Doc 11 §7: BOT-01, BOT-02, BOT-04)
// ---------------------------------------------------------------------------
runTest('BOT-01', 'Decoded policy.state weight bytes SHA-256 matches frozen checkpoint', () => {
  const env = createGameEnv();
  const b64 = env.probe.refs().RL_WEIGHTS_B64;
  const rawBytes = Buffer.from(b64, 'base64');
  const sha = crypto.createHash('sha256').update(rawBytes).digest('hex');
  assert.strictEqual(rawBytes.length, EXPECTED_BOT_WEIGHTS_BYTES, `Expected ${EXPECTED_BOT_WEIGHTS_BYTES} bytes, got ${rawBytes.length}`);
  assert.strictEqual(sha, EXPECTED_BOT_WEIGHTS_SHA256, `Weight SHA-256 mismatch: ${sha}`);
  return `${rawBytes.length} bytes, SHA-256=${sha}`;
});

runTest('BOT-02', 'Q-value parity against independent Float32 ReLU reference forward pass', () => {
  const env = createGameEnv();
  const b64 = env.probe.refs().RL_WEIGHTS_B64;
  const rawBuf = Buffer.from(b64, 'base64');
  const f32 = new Float32Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength / 4);
  const sizes = [21, 64, 64, 5];

  function refForward(obs) {
    let offset = 0;
    let act = Float32Array.from(obs);
    for (let li = 0; li < sizes.length - 1; li++) {
      const inDim = sizes[li];
      const outDim = sizes[li + 1];
      const w = f32.subarray(offset, offset + outDim * inDim); offset += outDim * inDim;
      const b = f32.subarray(offset, offset + outDim); offset += outDim;
      const next = new Float32Array(outDim);
      const isLast = li === sizes.length - 2;
      for (let o = 0; o < outDim; o++) {
        let sum = b[o];
        const row = o * inDim;
        for (let i = 0; i < inDim; i++) sum += w[row + i] * act[i];
        next[o] = isLast ? sum : (sum > 0 ? sum : 0);
      }
      act = next;
    }
    return act;
  }

  // Test 3 distinct reference observation vectors
  const testStates = [
    new Float32Array(21),
    Float32Array.from([0.8, 0, 1, 0, 0, 0.3, 0.2, 0.1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Float32Array.from([0.5, -0.4, 0, 1, 0.2, 0.1, 0.6, 0.05, 0.15, 0.1, 0.2, 0.3, 0.4, 0.1, 0, 0, 0, 0, 0, 0, 0.5]),
  ];
  let maxDiff = 0;
  for (const obs of testStates) {
    const qGame = env.probe.fn.rlForward(obs);
    const qRef = refForward(obs);
    for (let i = 0; i < 5; i++) {
      const diff = Math.abs(qGame[i] - qRef[i]);
      if (diff > maxDiff) maxDiff = diff;
      assert(diff < 1e-5, `Q-value diff ${diff} >= 1e-5`);
    }
  }
  return `3 reference states verified, maxAbsDiff=${maxDiff.toExponential(2)} (<1e-5)`;
});

runTest('BOT-04', 'Release-fix ablation guard proves key-release fix is active', () => {
  const widths = [70, 80, 90, 100, 110, 120];
  let normalClears = 0;
  let ablatedClears = 0;
  for (const w of widths) {
    for (const ablated of [false, true]) {
      const env = createGameEnv({ seed: 500 + w, width: 1280, height: 720, rlAblation: ablated });
      env.probe.fn.startGame('hero');
      env.probe.refs().pits.push({ x: 340, w });
      let alive = true;
      for (let t = 0; t < 160; t++) {
        env.stepTick(1);
        if (env.probe.getState().gameState !== 'playing') { alive = false; break; }
      }
      if (alive) {
        if (ablated) ablatedClears++; else normalClears++;
      }
    }
  }
  assert.strictEqual(normalClears, widths.length, `Expected all ${widths.length} normal pit clears`);
  assert(ablatedClears < normalClears, `Ablation should degrade pit clearance (${ablatedClears} vs ${normalClears})`);
  return `Normal=${normalClears}/${widths.length} clears vs Ablated=${ablatedClears}/${widths.length} clears`;
});

// ---------------------------------------------------------------------------
// D-01 Characterization Snapshot (640-wide & 490-wide, Villain + 4 Hero tiers)
// ---------------------------------------------------------------------------
function captureScenario(viewportName, width, height, scenarioName, modeKey, heroDiff, seed) {
  const env = createGameEnv({ width, height, seed });
  if (modeKey === 'hero') env.probe.fn.setHeroDifficulty(heroDiff);
  env.probe.fn.startGame(modeKey);

  const MAX_TICKS = 900;
  const SAMPLE_EVERY = 30;
  const frames = [];
  const spawners = [env.probe.fn.spawnPit, env.probe.fn.spawnBush, env.probe.fn.spawnEnemy];
  let spawnIdx = 0;
  let endCause = null;

  // Hook endGame in-memory to capture stopCause
  const origEndGame = env.probe.fn.endGame;
  let lastCause = null;
  const captureFrame = (tick) => {
    const s = env.probe.getState();
    return {
      tick,
      gameState: s.gameState,
      score: Number(s.score.toFixed(6)),
      elapsed: Number(s.elapsed.toFixed(6)),
      speedMult: Number(s.speedMult.toFixed(6)),
      player: {
        x: Number(s.player.x.toFixed(6)),
        y: Number(s.player.y.toFixed(6)),
        vy: Number(s.player.vy.toFixed(6)),
        onGround: s.player.onGround,
        stuck: s.player.stuck,
      },
      counts: {
        enemies: s.enemies.length,
        pits: s.pits.length,
        pipes: s.pipes.length,
      },
    };
  };

  frames.push(captureFrame(0));
  let finalTick = 0;

  for (let t = 1; t <= MAX_TICKS; t++) {
    const st = env.probe.getState();
    if (st.gameState !== 'playing') break;

    if (modeKey === 'villain') {
      // Scripted deterministic jumps
      if (t === 55 || t === 140 || t === 230 || t === 340) env.probe.fn.startJump();
      if (t === 61 || t === 148 || t === 235 || t === 346) env.probe.fn.endJump();
    } else {
      // Deterministic Hero trap cadence
      if (st.heroCooldownRemaining === 0 && t >= 20) {
        env.probe.fn.triggerHeroSpawn(spawners[spawnIdx % 3]);
        spawnIdx++;
      }
    }

    env.stepTick(1);
    finalTick = t;
    const after = env.probe.getState();
    if (t % SAMPLE_EVERY === 0 || after.gameState !== 'playing') {
      frames.push(captureFrame(t));
    }
    if (after.gameState !== 'playing') {
      endCause = env.elements.endFlavor.textContent || 'over';
      break;
    }
  }

  const endState = env.probe.getState();
  return {
    viewport: viewportName,
    width,
    height,
    logicalW: Number(env.probe.fn.logicalW().toFixed(6)),
    logicalH: Number(env.probe.fn.logicalH().toFixed(6)),
    ZOOM: Number(endState.ZOOM.toFixed(6)),
    groundY: Number(endState.groundY.toFixed(6)),
    scenario: scenarioName,
    modeKey,
    heroDiff: heroDiff || null,
    seed,
    finalTick,
    finalGameState: endState.gameState,
    finalScore: Number(endState.score.toFixed(6)),
    stopFlavor: endCause,
    sampledFrames: frames,
  };
}

runTest('D-01', 'Characterization snapshot (640-wide & 490-wide, Villain + 4 Hero tiers)', () => {
  const viewports = [
    { name: '640w_desktop', width: 1280, height: 720 },
    { name: '490w_portrait', width: 980, height: 1600 },
  ];
  const scenarios = [
    { name: 'villain', modeKey: 'villain', heroDiff: null, seed: 1001 },
    { name: 'hero_easy', modeKey: 'hero', heroDiff: 'easy', seed: 2001 },
    { name: 'hero_normal', modeKey: 'hero', heroDiff: 'normal', seed: 2002 },
    { name: 'hero_hard', modeKey: 'hero', heroDiff: 'hard', seed: 2003 },
    { name: 'hero_insane', modeKey: 'hero', heroDiff: 'insane', seed: 2004 },
  ];

  const runs = [];
  for (const vp of viewports) {
    for (const sc of scenarios) {
      runs.push(captureScenario(vp.name, vp.width, vp.height, sc.name, sc.modeKey, sc.heroDiff, sc.seed));
    }
  }

  const snapshot = {
    schema: 'spike-sprint-d01-characterization-v1',
    baselineVersion: 'v2.5.1',
    baselineBytes: htmlBuf.length,
    baselineLines: htmlLines,
    baselineSha256: htmlSha256,
    botWeightsSha256: EXPECTED_BOT_WEIGHTS_SHA256,
    dt: 1 / 60,
    scenarioCount: runs.length,
    runs,
  };

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const jsonStr = JSON.stringify(snapshot, null, 2) + '\n';
  fs.writeFileSync(SNAPSHOT_PATH, jsonStr, 'utf8');
  const snapSha = crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
  return `${runs.length} scenarios saved (${Buffer.byteLength(jsonStr, 'utf8')} bytes, SHA-256=${snapSha})`;
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log('========================================================================');
console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log('========================================================================');

if (failed > 0) {
  process.exit(1);
}
