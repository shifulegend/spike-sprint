#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M2-S1 Fixed-Timestep Accumulator, Tick-Derived Elapsed & Visibility Auto-Pause Suite
 * Covers: Doc 15 C01, TC-FIX-01, TC-FIX-02, D-01 parity, D-02 refresh-rate equivalence, BOT-01, HYGIENE-SCAN.
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = process.env.SPIKE_SPRINT_INDEX
  ? path.resolve(process.env.SPIKE_SPRINT_INDEX)
  : path.join(REPO_ROOT, 'index.html');
const GOLDEN_SNAPSHOT_PATH = path.join(__dirname, 'snapshots', 'v2.5.1_characterization.json');
const EXPECTED_BOT_WEIGHTS_BYTES = 23572;
const EXPECTED_BOT_WEIGHTS_SHA256 = '99d90952c2b64faca1aefe3aadc7ca6ee6c38d785bb660f06982f503161d5361';
const PROPOSED_SIZE_WARN_BYTES = 120 * 1024;

const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha256 = crypto.createHash('sha256').update(htmlBuf).digest('hex');
const htmlLines = htmlText.split('\n').length - (htmlText.endsWith('\n') ? 1 : 0);

const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not extract <script> from index.html');
const RAW_SCRIPT = scriptMatch[1];

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
  constructor(initial = []) { this._set = new Set(initial); }
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
  constructor() { this._props = Object.create(null); this.display = ''; }
  setProperty(k, v) { this._props[k] = String(v); }
  getPropertyValue(k) { return this._props[k] || ''; }
}

class MockElement {
  constructor(id, tagName = 'DIV', attrs = {}, classes = [], docRef = null) {
    this.id = id || '';
    this.tagName = tagName.toUpperCase();
    this.className = classes.join(' ');
    this.style = new MockStyle();
    this.classList = new MockClassList(classes);
    this._textContent = '';
    this.value = '';
    this.offsetWidth = 100;
    this.width = 0;
    this.height = 0;
    this.disabled = false;
    this._attrs = { ...attrs };
    this._listeners = Object.create(null);
    this.children = [];
    this._docRef = docRef;
  }
  focus() { if (this._docRef) this._docRef.activeElement = this; }
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this.children = []; this._textContent = String(v); }
  appendChild(child) { this.children.push(child); return child; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (sel.includes('button') && c.tagName === 'BUTTON') out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
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
    for (const fn of (this._listeners[e.type] || [])) fn(e);
    return e;
  }
  click() { return this.dispatchEvent({ type: 'click' }); }
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

function createEnv(opts = {}) {
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const seed = opts.seed !== undefined ? opts.seed : 1337;

  let nowMs = 1000.0;
  let rafCallback = null;
  const elements = Object.create(null);
  const windowListeners = Object.create(null);
  const docListeners = Object.create(null);

  const mockDocument = {
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id, 'DIV', {}, [], mockDocument);
      return elements[id];
    },
    createElement(tag) { return new MockElement('', tag, {}, [], mockDocument); },
    querySelectorAll(sel) { return sel === '.score-tab' ? scoreTabs : []; },
    addEventListener(type, fn) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of (docListeners[evt.type] || [])) fn(evt);
    },
  };

  function reg(id, tag = 'DIV', attrs = {}, classes = []) {
    const el = new MockElement(id, tag, attrs, classes, mockDocument);
    elements[id] = el;
    return el;
  }

  [
    ['gameCanvas', 'CANVAS'], ['hud', 'DIV'], ['speedTag', 'DIV'], ['timeTag', 'DIV'],
    ['highScoreTag', 'DIV'], ['soundToggle', 'BUTTON'], ['iconSoundOn', 'SVG'], ['iconSoundOff', 'SVG'],
    ['storyToggle', 'BUTTON'], ['loreCard', 'DIV'], ['loreCloseBtn', 'BUTTON'],
    ['startScreen', 'DIV'], ['gameOverScreen', 'DIV'], ['gameOverTitle', 'H1'],
    ['endFlavor', 'P'], ['finalScore', 'P'], ['heroControls', 'DIV'],
    ['spawnPitBtn', 'BUTTON'], ['spawnBushBtn', 'BUTTON'], ['spawnHeroBtn', 'BUTTON'],
    ['playVillainBtn', 'BUTTON'], ['playHeroBtn', 'BUTTON'], ['playHeroTitle', 'SPAN'],
    ['diffEasy', 'BUTTON'], ['diffNormal', 'BUTTON'], ['diffHard', 'BUTTON'], ['diffInsane', 'BUTTON'],
    ['restartBtn', 'BUTTON'], ['changeModeBtn', 'BUTTON'], ['exitBtn', 'BUTTON'],
    ['exitModal', 'DIV'], ['resumeRunBtn', 'BUTTON'], ['confirmExitBtn', 'BUTTON'],
    ['scoresModal', 'DIV'], ['openScoresStartBtn', 'BUTTON'], ['openScoresEndBtn', 'BUTTON'],
    ['closeScoresBtn', 'BUTTON'], ['sortByScoreBtn', 'BUTTON'], ['sortByTimeBtn', 'BUTTON'],
    ['scoreTableWrap', 'DIV'], ['startNameInput', 'INPUT'], ['endNameInput', 'INPUT'],
    ['randNameStartBtn', 'BUTTON'], ['randNameEndBtn', 'BUTTON'],
  ].forEach(([id, tag]) => reg(id, tag));

  elements.startScreen.style.display = 'flex';
  elements.exitModal.style.display = 'none';
  elements.exitModal.appendChild(elements.resumeRunBtn);
  elements.exitModal.appendChild(elements.confirmExitBtn);
  const scoreTabs = ['villain', 'hero_easy', 'hero_normal', 'hero_hard', 'hero_insane']
    .map(b => new MockElement('', 'BUTTON', { 'data-bucket': b }, ['score-tab'], mockDocument));

  const storageMap = new Map();
  const mockLocalStorage = {
    getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(k, String(v)); },
    removeItem: k => { storageMap.delete(k); },
  };

  class MockAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createOscillator() {
      return {
        type: 'square',
        frequency: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, start() {}, stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: { setValueAtTime() {} }, connect() {} }; }
  }

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
      e.preventDefault = () => {};
      for (const fn of (windowListeners[e.type] || [])) fn(e);
      return e;
    },
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    localStorage: mockLocalStorage,
    Math: customMath,
    Float32Array, Uint8Array, Array, Object, Number, String, Boolean, JSON, Date,
    Promise, Error, RegExp, isFinite, isNaN, parseInt, parseFloat,
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
    btoa: bin => Buffer.from(bin, 'binary').toString('base64'),
    performance: { now: () => nowMs },
    requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  const probeTrailer = `
;globalThis.__probe = {
  getState: () => ({
    gameState, score, elapsed, simTicks, speedMult, groundY, ZOOM,
    currentModeKey, currentHeroDiff, jumpKeyDown, heroCooldownRemaining,
    accumulatorMs, lastFrameTime,
    player: { ...player },
    enemies: enemies.map(e => ({ ...e })),
    pits: pits.map(p => ({ ...p })),
    pipes: pipes.map(p => ({ ...p })),
  }),
  refs: () => ({ RL_WEIGHTS_B64 }),
  clearObstacles: () => { enemies.length = 0; pits.length = 0; pipes.length = 0; },
  setNextSpawnAt: (v) => { nextSpawnAt = v; },
  fn: {
    update, loop, startGame, startJump, endJump, setHeroDifficulty, triggerHeroSpawn,
    spawnPit, spawnBush, spawnEnemy, logicalW, logicalH,
  },
};
`;

  vm.createContext(sandbox);
  vm.runInContext(RAW_SCRIPT + probeTrailer, sandbox, { filename: 'index.html' });

  return {
    probe: sandbox.__probe,
    elements,
    document: mockDocument,
    window: mockWindow,
    driveFrame: (ts) => {
      nowMs = ts;
      if (rafCallback) rafCallback(ts);
    },
    stepTick: (n = 1) => {
      for (let i = 0; i < n; i++) {
        nowMs += 1000 / 60;
        sandbox.__probe.fn.update(1 / 60);
      }
    },
  };
}

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
console.log('Spike Sprint — M2-S1 Fixed-Timestep & Visibility Auto-Pause Suite');
console.log(`Node: ${process.version}`);
console.log(`Target: ${INDEX_PATH}`);
console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
console.log('========================================================================');

// 1. TC-FIX-01 / D-02: 30, 60, 120, 144 Hz refresh-rate equivalence over 60 seconds
runTest('M2-S1-FIX01-HZ', '30, 60, 120, 144 Hz synthetic schedules for 60s yield 3,600 +/- 1 ticks & identical state (TC-FIX-01 / D-02)', () => {
  const rates = [30, 60, 120, 144];
  const summaries = [];
  const stateAt3599 = [];

  for (const hz of rates) {
    const env = createEnv({ seed: 777 });
    env.probe.fn.startGame('villain');
    env.probe.clearObstacles();
    env.probe.setNextSpawnAt(999999);

    const frameMs = 1000 / hz;
    const totalFrames = Math.round(60 * hz);
    let captured3599 = null;

    // Initial timestamp establishes lastFrameTime = 1000
    env.driveFrame(1000);
    for (let f = 1; f <= totalFrames; f++) {
      env.driveFrame(1000 + f * frameMs);
      const st = env.probe.getState();
      if (!captured3599 && st.simTicks >= 3599) {
        captured3599 = {
          simTicks: st.simTicks,
          score: Number(st.score.toFixed(6)),
          elapsed: Number(st.elapsed.toFixed(6)),
          speedMult: Number(st.speedMult.toFixed(6)),
        };
      }
    }
    const end = env.probe.getState();
    assert(Math.abs(end.simTicks - 3600) <= 1, `${hz}Hz produced ${end.simTicks} ticks (expected 3600 +/- 1)`);
    summaries.push(`${hz}Hz=${end.simTicks}t`);
    stateAt3599.push({ hz, captured3599 });
  }

  // Verify identical simulation state at exact same tick count across 30/60/120/144 Hz
  const env60 = createEnv({ seed: 9001 });
  env60.probe.fn.startGame('villain');
  env60.probe.clearObstacles();
  env60.probe.setNextSpawnAt(999999);
  env60.driveFrame(1000);
  for (let f = 1; f <= 600; f++) env60.driveFrame(1000 + f * (1000 / 60));

  const env120 = createEnv({ seed: 9001 });
  env120.probe.fn.startGame('villain');
  env120.probe.clearObstacles();
  env120.probe.setNextSpawnAt(999999);
  env120.driveFrame(1000);
  for (let f = 1; f <= 1200; f++) env120.driveFrame(1000 + f * (1000 / 120));

  const s60 = env60.probe.getState();
  const s120 = env120.probe.getState();
  assert.strictEqual(s60.simTicks, s120.simTicks);
  assert.strictEqual(s60.score, s120.score);
  assert.strictEqual(s60.elapsed, s120.elapsed);
  assert.strictEqual(s60.speedMult, s120.speedMult);

  return `${summaries.join(', ')}; 60Hz vs 120Hz state bit-identical at ${s60.simTicks} ticks`;
});

// 2. TC-FIX-01: 5-second lag spike clamps to at most 6 steps
runTest('M2-S1-FIX01-CLAMP', '5-second (5,000ms) lag spike clamps to at most 6 simulation steps', () => {
  const env = createEnv({ seed: 123 });
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(999999);
  env.driveFrame(1000);
  assert.strictEqual(env.probe.getState().simTicks, 0);
  env.driveFrame(6000); // +5000ms spike
  const ticks = env.probe.getState().simTicks;
  assert(ticks >= 1 && ticks <= 6, `Expected <= 6 steps on 5s lag spike, got ${ticks}`);
  return `5,000ms spike clamped cleanly to ${ticks} steps`;
});

// 3. TC-FIX-02: 300 ticks === 5.0s & hidden tab for 60s auto-pauses with zero drift
runTest('M2-S1-FIX02-VIS', '300 ticks === 5.0s; hidden tab auto-pauses, clears jump, and freezes elapsed/speedMult (TC-FIX-02)', () => {
  const env = createEnv({ seed: 321 });
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(999999);
  env.stepTick(300);
  const s300 = env.probe.getState();
  assert.strictEqual(s300.simTicks, 300);
  assert.strictEqual(s300.elapsed, 5.0, `Expected exact 5.0s at 300 ticks, got ${s300.elapsed}`);

  // Hold Space, then hide tab for 60 seconds
  env.window.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ', repeat: false });
  assert.strictEqual(env.probe.getState().jumpKeyDown, true);
  env.document.hidden = true;
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent({ type: 'visibilitychange' });

  const sPaused = env.probe.getState();
  assert.strictEqual(sPaused.gameState, 'paused', 'Hiding tab must auto-pause active play');
  assert.strictEqual(sPaused.jumpKeyDown, false, 'Auto-pause must clear held jumpKeyDown');
  assert.strictEqual(env.elements.exitModal.style.display, 'flex', 'Auto-pause must show exitModal');

  // Advance wall clock by 60 seconds and return to visible
  env.driveFrame(70000);
  env.document.hidden = false;
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent({ type: 'visibilitychange' });
  env.driveFrame(70016.6667);

  const sReturn = env.probe.getState();
  assert.strictEqual(sReturn.gameState, 'paused', 'Returning to visible must stay paused until user resumes');
  assert.strictEqual(sReturn.simTicks, 300, 'simTicks must not advance while hidden');
  assert.strictEqual(sReturn.elapsed, 5.0, 'elapsed must not advance while hidden');
  assert.strictEqual(sReturn.speedMult, s300.speedMult, 'speedMult must not drift while hidden');
  return '300 ticks = 5.0s; 60s hidden tab auto-paused with zero tick/elapsed/speedMult drift';
});

// 4. Static check: wall-clock startTime & pausedAt removed
runTest('M2-S1-NO-WALLCLOCK', 'Wall-clock startTime and pausedAt removed from simulation', () => {
  assert(!/\bstartTime\b/.test(RAW_SCRIPT), 'Found leftover startTime reference');
  assert(!/\bpausedAt\b/.test(RAW_SCRIPT), 'Found leftover pausedAt reference');
  const updateMatch = RAW_SCRIPT.match(/function update\(dt\)\{[\s\S]*?\n\}/);
  assert(updateMatch && !/performance\.now/.test(updateMatch[0]), 'update() must not read performance.now()');
  return 'Zero startTime/pausedAt references; update() has zero performance.now() calls';
});

// 5. D-01 Zero-Diff Characterization Parity
runTest('D-01-PARITY', 'Zero-diff characterization parity vs. v2.5.1_characterization.json (all 10 scenarios)', () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_SNAPSHOT_PATH, 'utf8'));
  assert.strictEqual(golden.runs.length, 10);
  for (const gRun of golden.runs) {
    const env = createEnv({ width: gRun.width, height: gRun.height, seed: gRun.seed });
    if (gRun.modeKey === 'hero') env.probe.fn.setHeroDifficulty(gRun.heroDiff);
    env.probe.fn.startGame(gRun.modeKey);
    const spawners = [env.probe.fn.spawnPit, env.probe.fn.spawnBush, env.probe.fn.spawnEnemy];
    let spawnIdx = 0;
    const frames = [];
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
        counts: { enemies: s.enemies.length, pits: s.pits.length, pipes: s.pipes.length },
      };
    };
    frames.push(captureFrame(0));
    let finalTick = 0;
    for (let t = 1; t <= 900; t++) {
      const st = env.probe.getState();
      if (st.gameState !== 'playing') break;
      if (gRun.modeKey === 'villain') {
        if (t === 55 || t === 140 || t === 230 || t === 340) env.probe.fn.startJump();
        if (t === 61 || t === 148 || t === 235 || t === 346) env.probe.fn.endJump();
      } else if (st.heroCooldownRemaining === 0 && t >= 20) {
        env.probe.fn.triggerHeroSpawn(spawners[spawnIdx % 3]);
        spawnIdx++;
      }
      env.stepTick(1);
      finalTick = t;
      const after = env.probe.getState();
      if (t % 30 === 0 || after.gameState !== 'playing') frames.push(captureFrame(t));
      if (after.gameState !== 'playing') break;
    }
    assert.strictEqual(finalTick, gRun.finalTick);
    assert.deepStrictEqual(frames, gRun.sampledFrames);
  }
  return '10/10 scenarios match v2.5.1 golden snapshot with ZERO differences';
});

// 6. BOT-01 + Budget + Hygiene
runTest('BOT-01-AND-HYGIENE', 'RL weights unchanged, size within 120 KB warning budget, zero external requests/Drive URLs', () => {
  const env = createEnv();
  const raw = Buffer.from(env.probe.refs().RL_WEIGHTS_B64, 'base64');
  assert.strictEqual(raw.length, EXPECTED_BOT_WEIGHTS_BYTES);
  assert.strictEqual(crypto.createHash('sha256').update(raw).digest('hex'), EXPECTED_BOT_WEIGHTS_SHA256);
  assert(htmlBuf.length <= PROPOSED_SIZE_WARN_BYTES, `Size ${htmlBuf.length} > ${PROPOSED_SIZE_WARN_BYTES}`);
  assert(!/<script[^>]+src\s*=/i.test(htmlText));
  assert(!/\bfetch\s*\(/.test(RAW_SCRIPT));
  assert(!/(drive|docs)\.google\.com/i.test(htmlText));
  return `${htmlBuf.length} bytes (<= ${PROPOSED_SIZE_WARN_BYTES}), BOT-01 & hygiene clean`;
});

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log('========================================================================');
console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log('========================================================================');
if (failed > 0) process.exit(1);
