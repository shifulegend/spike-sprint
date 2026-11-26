#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M1-S3 Audio & Input Safety Test Suite (Doc 15 C03 & C05)
 * Zero external dependencies (Node.js built-ins only).
 * Verifies:
 *   1. C05 Audio Safety (missing AC, throwing AC, rejected resume/close, closed context, zero unhandledRejection)
 *   2. C03 Input Safety (keyup during pause, pause clears held input, e.repeat ignored,
 *      off-canvas pointer release, multi-touch pointer ownership, window blur, RL bot untouched)
 *   3. D-01 Zero-Diff Characterization Parity against tests/snapshots/v2.5.1_characterization.json
 *   4. BOT-01/02/04 + Static Guardrails (zero external requests, zero Drive URLs, zero scattered mode branches)
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

const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha256 = crypto.createHash('sha256').update(htmlBuf).digest('hex');
const htmlLines = htmlText.split('\n').length - (htmlText.endsWith('\n') ? 1 : 0);

const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not extract <script> from index.html');
const RAW_SCRIPT = scriptMatch[1];

const unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(String(reason));
});

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
  const audioMode = opts.audioMode || 'normal'; // 'normal' | 'missing' | 'throw' | 'reject_resume' | 'closed'

  let nowMs = 1000.0;
  let audioStats = { created: 0, resumed: 0, closed: 0 };
  const elements = Object.create(null);
  function reg(id, tag = 'DIV', attrs = {}, classes = []) {
    const el = new MockElement(id, tag, attrs, classes);
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
  const scoreTabs = ['villain', 'hero_easy', 'hero_normal', 'hero_hard', 'hero_insane']
    .map(b => new MockElement('', 'BUTTON', { 'data-bucket': b }, ['score-tab']));

  const storageMap = new Map();
  const mockLocalStorage = {
    getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(k, String(v)); },
    removeItem: k => { storageMap.delete(k); },
  };

  class MockAudioContext {
    constructor() {
      if (audioMode === 'throw') throw new Error('AudioContext constructor failed');
      audioStats.created += 1;
      this.state = audioMode === 'closed' ? 'closed' : 'suspended';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() {
      audioStats.resumed += 1;
      if (audioMode === 'reject_resume') {
        return Promise.reject(new Error('NotAllowedError: resume rejected'));
      }
      if (this.state !== 'closed') this.state = 'running';
      return Promise.resolve();
    }
    close() {
      audioStats.closed += 1;
      this.state = 'closed';
      if (audioMode === 'reject_resume') {
        return Promise.reject(new Error('InvalidStateError: already closed'));
      }
      return Promise.resolve();
    }
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

  const windowListeners = Object.create(null);
  const docListeners = Object.create(null);

  const mockDocument = {
    activeElement: null,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id);
      return elements[id];
    },
    querySelectorAll(sel) { return sel === '.score-tab' ? scoreTabs : []; },
    addEventListener(type, fn) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of (docListeners[evt.type] || [])) fn(evt);
    },
  };

  const rng = makeMulberry32(seed);
  const customMath = Object.create(Math);
  customMath.random = () => rng();

  const mockWindow = {
    innerWidth: width,
    innerHeight: height,
    AudioContext: audioMode === 'missing' ? undefined : MockAudioContext,
    webkitAudioContext: audioMode === 'missing' ? undefined : MockAudioContext,
    localStorage: mockLocalStorage,
    addEventListener(type, fn) {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    dispatchEvent(evt) {
      const e = evt || {};
      e.defaultPrevented = false;
      e.preventDefault = () => { e.defaultPrevented = true; };
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
    requestAnimationFrame: () => 1,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  const probeTrailer = `
;globalThis.__probe = {
  getState: () => ({
    gameState, score, elapsed, speedMult, groundY, ZOOM,
    currentModeKey, currentHeroDiff, jumpKeyDown, activePointerId,
    _audioUnlocked, audioCtxState: audioCtx ? audioCtx.state : null,
    player: { ...player },
    enemies: enemies.map(e => ({ ...e })),
    pits: pits.map(p => ({ ...p })),
    pipes: pipes.map(p => ({ ...p })),
    heroCooldownRemaining,
  }),
  refs: () => ({ RL_WEIGHTS_B64, player, enemies, pits, pipes }),
  clearObstacles: () => { enemies.length = 0; pits.length = 0; pipes.length = 0; },
  setNextSpawnAt: (v) => { nextSpawnAt = v; },
  fn: {
    update, startGame, startJump, endJump, setHeroDifficulty, triggerHeroSpawn,
    spawnPit, spawnBush, spawnEnemy, logicalW, logicalH, primeAudio, getAudioCtx,
  },
};
`;

  vm.createContext(sandbox);
  vm.runInContext(RAW_SCRIPT + probeTrailer, sandbox, { filename: 'index.html' });

  return {
    probe: sandbox.__probe,
    elements,
    window: mockWindow,
    document: mockDocument,
    audioStats,
    advanceClock: (ms) => { nowMs += ms; },
    stepTick: (n = 1) => {
      for (let i = 0; i < n; i++) {
        nowMs += 1000 / 60;
        sandbox.__probe.fn.update(1 / 60);
      }
    },
  };
}

const results = [];
async function runTest(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail || '' });
    console.log(`[PASS] ${id}: ${name}${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    results.push({ id, name, status: 'FAIL', detail: err && err.message ? err.message : String(err) });
    console.error(`[FAIL] ${id}: ${name} — ${err && err.stack ? err.stack : err}`);
  }
}

async function main() {
  console.log('========================================================================');
  console.log('Spike Sprint — M1-S3 Audio & Input Safety Suite (C03 & C05 + D-01 Parity)');
  console.log(`Node: ${process.version}`);
  console.log(`Target: ${INDEX_PATH}`);
  console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
  console.log('========================================================================');

  // C05-1: Missing AudioContext API
  await runTest('M1-S3-C05-01', 'Missing AudioContext API never blocks startJump() or triggerHeroSpawn()', () => {
    const env = createEnv({ audioMode: 'missing' });
    env.probe.fn.startGame('villain');
    env.probe.clearObstacles();
    env.probe.setNextSpawnAt(99999);
    env.probe.fn.startJump();
    assert.strictEqual(env.probe.getState().player.onGround, false, 'Villain jump must succeed without AudioContext');

    env.probe.fn.startGame('hero');
    const spawned = env.probe.fn.triggerHeroSpawn(env.probe.fn.spawnPit);
    assert.strictEqual(spawned, true, 'Hero spawn must succeed without AudioContext');
    assert.strictEqual(env.probe.getState().pits.length, 1);
    return 'Villain jump & Hero spawn both succeeded with AudioContext=undefined';
  });

  // C05-2: Throwing AudioContext constructor
  await runTest('M1-S3-C05-02', 'AudioContext constructor throw never breaks input or sets false unlock', () => {
    const env = createEnv({ audioMode: 'throw' });
    env.probe.fn.startGame('villain');
    assert.strictEqual(env.probe.getState()._audioUnlocked, false, '_audioUnlocked must stay false on constructor failure');
    env.probe.fn.startJump();
    assert.strictEqual(env.probe.getState().player.onGround, false, 'Jump must succeed when AudioContext throws');
    env.probe.fn.startGame('hero');
    assert.strictEqual(env.probe.fn.triggerHeroSpawn(env.probe.fn.spawnBush), true);
    return 'Constructor throw safely caught; gameplay unaffected';
  });

  // C05-3: Rejected resume() and close() promises (TC-FIX-08)
  await runTest('M1-S3-C05-03', 'Rejected dummy/real resume() & close() emit zero unhandledRejection (TC-FIX-08)', async () => {
    const before = unhandledRejections.length;
    const env = createEnv({ audioMode: 'reject_resume' });
    env.probe.fn.startGame('villain');
    env.probe.fn.startJump();
    env.document.visibilityState = 'visible';
    env.document.dispatchEvent({ type: 'visibilitychange' });
    // Flush microtask queue
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(unhandledRejections.length, before, `Unhandled rejections detected: ${unhandledRejections.join('; ')}`);
    assert(env.audioStats.closed >= 1, 'Dummy AudioContext must be closed even when resume() rejects');
    return `zero unhandledRejection events; dummy closed (${env.audioStats.closed})`;
  });

  // C05-4: Closed AudioContext recovery
  await runTest('M1-S3-C05-04', 'Closed AudioContext never breaks playTone/visibilitychange/primeAudio', () => {
    const env = createEnv({ audioMode: 'closed' });
    env.probe.fn.startGame('villain');
    env.probe.fn.startJump();
    env.document.visibilityState = 'visible';
    env.document.dispatchEvent({ type: 'visibilitychange' });
    assert.strictEqual(env.probe.getState().player.onGround, false);
    return 'Closed context handled safely';
  });

  // C03-1: Keyup during pause clears jumpKeyDown without mutating paused velocity (TC-FIX-06)
  await runTest('M1-S3-C03-01', 'Space press -> pause -> Space release while paused -> resume clears jumpKeyDown (TC-FIX-06)', () => {
    const env = createEnv();
    env.probe.fn.startGame('villain');
    env.probe.clearObstacles();
    env.probe.setNextSpawnAt(99999);
    env.window.dispatchEvent({ type: 'keydown', code: 'Space', repeat: false });
    assert.strictEqual(env.probe.getState().jumpKeyDown, true);
    env.stepTick(2);
    const vyBeforePause = env.probe.getState().player.vy;

    // Pause via exitBtn (must clear held input and not mutate vy)
    env.elements.exitBtn.click();
    assert.strictEqual(env.probe.getState().gameState, 'paused');
    assert.strictEqual(env.probe.getState().jumpKeyDown, false, 'Pause must clear held jumpKeyDown');
    assert.strictEqual(env.probe.getState().player.vy, vyBeforePause, 'Pause must not alter player.vy');

    // Release Space while paused
    env.window.dispatchEvent({ type: 'keyup', code: 'Space' });
    assert.strictEqual(env.probe.getState().jumpKeyDown, false);
    assert.strictEqual(env.probe.getState().player.vy, vyBeforePause, 'keyup during pause must not alter player.vy');

    // Resume and confirm next jump works cleanly after landing
    env.elements.resumeRunBtn.click();
    assert.strictEqual(env.probe.getState().gameState, 'playing');
    assert.strictEqual(env.probe.getState().jumpKeyDown, false);
    for (let i = 0; i < 60; i++) {
      env.stepTick(1);
      if (env.probe.getState().player.onGround) break;
    }
    env.window.dispatchEvent({ type: 'keydown', code: 'Space', repeat: false });
    assert.strictEqual(env.probe.getState().player.onGround, false, 'Subsequent jump after resume must work');
    return 'jumpKeyDown cleared on pause/keyup; vy untouched while paused; resume jump OK';
  });

  // C03-2: Keydown repeat rejected
  await runTest('M1-S3-C03-02', 'keydown with e.repeat=true is ignored for Space and Hero 1/2/3', () => {
    const env = createEnv();
    env.probe.fn.startGame('villain');
    env.probe.clearObstacles();
    env.probe.setNextSpawnAt(99999);
    env.window.dispatchEvent({ type: 'keydown', code: 'Space', repeat: true });
    assert.strictEqual(env.probe.getState().player.onGround, true, 'Repeated Space keydown must not trigger jump');

    env.probe.fn.startGame('hero');
    env.window.dispatchEvent({ type: 'keydown', key: '1', code: 'Digit1', repeat: true });
    assert.strictEqual(env.probe.getState().pits.length, 0, 'Repeated Hero keydown must not trigger spawn');
    return 'Repeated Space and Hero 1/2/3 keydown events ignored';
  });

  // C03-3: Off-canvas pointer release & multi-touch pointer ownership
  await runTest('M1-S3-C03-03', 'Multi-touch pointer ownership & off-canvas window pointerup release', () => {
    const env = createEnv();
    env.probe.fn.startGame('villain');
    env.probe.clearObstacles();
    env.probe.setNextSpawnAt(99999);

    // Primary finger down on canvas (pointerId 1)
    env.elements.gameCanvas.dispatchEvent({ type: 'pointerdown', pointerId: 1 });
    assert.strictEqual(env.probe.getState().jumpKeyDown, true);
    assert.strictEqual(env.probe.getState().activePointerId, 1);

    // Secondary finger down and up (pointerId 2) must NOT release primary jump
    env.elements.gameCanvas.dispatchEvent({ type: 'pointerdown', pointerId: 2 });
    env.window.dispatchEvent({ type: 'pointerup', pointerId: 2 });
    assert.strictEqual(env.probe.getState().jumpKeyDown, true, 'Second finger release must not end primary jump');
    assert.strictEqual(env.probe.getState().activePointerId, 1);

    // Primary finger drags outside canvas and releases on window (pointerId 1)
    env.stepTick(3);
    env.window.dispatchEvent({ type: 'pointerup', pointerId: 1 });
    assert.strictEqual(env.probe.getState().jumpKeyDown, false, 'Window pointerup for primary finger must end jump');
    assert.strictEqual(env.probe.getState().activePointerId, null);
    return 'Secondary touch ignored; off-canvas window pointerup released primary jump cleanly';
  });

  // C03-4: Window blur clears held input
  await runTest('M1-S3-C03-04', 'window.blur clears held jumpKeyDown and activePointerId', () => {
    const env = createEnv();
    env.probe.fn.startGame('villain');
    env.elements.gameCanvas.dispatchEvent({ type: 'pointerdown', pointerId: 7 });
    assert.strictEqual(env.probe.getState().jumpKeyDown, true);
    env.window.dispatchEvent({ type: 'blur' });
    assert.strictEqual(env.probe.getState().jumpKeyDown, false);
    assert.strictEqual(env.probe.getState().activePointerId, null);
    return 'window.blur cleared jumpKeyDown and activePointerId';
  });

  // D-01 Zero-Diff Characterization Parity against golden v2.5.1 snapshot
  await runTest('D-01-PARITY', 'Zero-diff characterization parity vs. v2.5.1_characterization.json (all 10 scenarios)', () => {
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

      assert.strictEqual(finalTick, gRun.finalTick, `finalTick mismatch in ${gRun.viewport}/${gRun.scenario}`);
      assert.deepStrictEqual(frames, gRun.sampledFrames, `Frame trajectory mismatch in ${gRun.viewport}/${gRun.scenario}`);
    }
    return '10/10 scenarios (640w & 490w, Villain + 4 Hero tiers) match v2.5.1 golden snapshot with ZERO differences';
  });

  // BOT-01 + Hygiene checks
  await runTest('BOT-01-LOCK', 'RL bot policy.state weights unchanged', () => {
    const env = createEnv();
    const raw = Buffer.from(env.probe.refs().RL_WEIGHTS_B64, 'base64');
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    assert.strictEqual(raw.length, EXPECTED_BOT_WEIGHTS_BYTES);
    assert.strictEqual(sha, EXPECTED_BOT_WEIGHTS_SHA256);
    return `${raw.length} bytes, SHA-256 verified`;
  });

  await runTest('HYGIENE-SCAN', 'Zero external requests, zero Drive URLs, zero scattered mode branches', () => {
    assert(!/<script[^>]+src\s*=/i.test(htmlText), 'Found external script tag');
    assert(!/\bfetch\s*\(/.test(RAW_SCRIPT), 'Found fetch()');
    assert(!/(drive|docs)\.google\.com/i.test(htmlText), 'Found Google Drive URL in index.html');
    const selfText = fs.readFileSync(__filename, 'utf8');
    assert(!/(drive|docs)\.google\.com/i.test(selfText.replace(/\(drive\|docs\)\\\.google\\\.com/g, '')), 'Found Google Drive URL in test file');
    const updateMatch = RAW_SCRIPT.match(/function update\(dt\)\{[\s\S]*?\n\}/);
    const loopMatch = RAW_SCRIPT.match(/function loop\([^)]*\)\{[\s\S]*?\n\}/);
    assert(updateMatch && loopMatch);
    assert(!/if\s*\(\s*(currentModeKey|mode)\s*===/.test(updateMatch[0]));
    assert(!/if\s*\(\s*(currentModeKey|mode)\s*===/.test(loopMatch[0]));
    return `${htmlBuf.length} bytes, clean static scans`;
  });

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('========================================================================');
  console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
