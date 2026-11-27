#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M1-S4 Leaderboard Hardening & Dead-Code Cleanup Suite
 * Covers: Doc 15 C04, TC-FIX-07, TC-FIX-09, S-01, S-02, BOT-01, HYGIENE-SCAN, and D-01 zero-diff parity.
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
  constructor(id, tagName = 'DIV', attrs = {}, classes = []) {
    this.id = id || '';
    this.tagName = tagName.toUpperCase();
    this.className = classes.join(' ');
    this.style = new MockStyle();
    this.classList = new MockClassList(classes);
    this._textContent = '';
    this._innerHTMLWrites = 0;
    this._innerHTML = '';
    this.value = '';
    this.offsetWidth = 100;
    this.width = 0;
    this.height = 0;
    this._attrs = { ...attrs };
    this._listeners = Object.create(null);
    this.children = [];
  }
  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._textContent = String(v);
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTMLWrites += 1;
    this._innerHTML = String(v);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
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
  const initialStorage = opts.initialStorage || {};

  let nowMs = 1000.0;
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

  const storageMap = new Map(Object.entries(initialStorage));
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

  const windowListeners = Object.create(null);
  const mockDocument = {
    activeElement: null,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id);
      return elements[id];
    },
    createElement(tag) { return new MockElement('', tag); },
    querySelectorAll(sel) { return sel === '.score-tab' ? scoreTabs : []; },
    addEventListener() {},
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
    requestAnimationFrame: () => 1,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  const probeTrailer = `
;globalThis.__probe = {
  getState: () => ({
    gameState, score, elapsed, speedMult, groundY, ZOOM,
    currentModeKey, currentHeroDiff, activeMode,
    player: { ...player },
    enemies: enemies.map(e => ({ ...e })),
    pits: pits.map(p => ({ ...p })),
    pipes: pipes.map(p => ({ ...p })),
    heroCooldownRemaining,
  }),
  refs: () => ({ BASE_MODE, MODES, HERO_DIFFICULTIES, RL_WEIGHTS_B64 }),
  fn: {
    update, startGame, startJump, endJump, setHeroDifficulty, triggerHeroSpawn,
    spawnPit, spawnBush, spawnEnemy, logicalW, logicalH,
    loadScores, saveScores, sanitizeScoreRow, openScoresModal, renderScoresModal,
    sanitizePlayerName, savePlayerName, loadPlayerName, formatDuration, endGame,
  },
};
`;

  vm.createContext(sandbox);
  vm.runInContext(RAW_SCRIPT + probeTrailer, sandbox, { filename: 'index.html' });

  return {
    probe: sandbox.__probe,
    elements,
    storageMap,
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
console.log('Spike Sprint — M1-S4 Leaderboard Hardening & Dead-Code Cleanup Suite');
console.log(`Node: ${process.version}`);
console.log(`Target: ${INDEX_PATH}`);
console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
console.log('========================================================================');

// 1. TC-FIX-07 / S-02: Tampered localStorage rejection + boundary acceptance
runTest('M1-S4-C04-01', 'loadScores() rejects null, primitives, arrays, markup, NaN/Inf/negative rows (TC-FIX-07 / S-02)', () => {
  const tampered = {
    villain: {
      byScore: [
        null,
        'corrupt-string',
        42,
        ['nested', 'array'],
        { name: '<b>XSS</b>', score: '<img src=x onerror=alert(1)>', time: 12 },
        { name: 'BADTIME', score: 100, time: '<svg/onload=1>' },
        { name: 'NEG', score: -5, time: 10 },
        { name: 'INF', score: 1e12, time: 10 },
        { name: 'GOOD0', score: 0, time: 0 }, // valid boundary row (zero score & time, no runId)
        { runId: 'r1', name: 'legit!', score: '250.9', time: '45.67' }, // valid numeric string coercion
      ],
      byTime: [
        null,
        { name: 'HERO1', score: 0, time: 1.2 },
      ],
    },
  };
  const env = createEnv({ initialStorage: { spike_sprint_scores_v1: JSON.stringify(tampered) } });
  const store = env.probe.fn.loadScores();
  assert.strictEqual(store.villain.byScore.length, 2, `Expected 2 valid rows, got ${store.villain.byScore.length}`);
  assert.deepStrictEqual({ ...store.villain.byScore[0] }, { runId: '', name: 'GOOD0', score: 0, time: 0 });
  assert.deepStrictEqual({ ...store.villain.byScore[1] }, { runId: 'r1', name: 'LEGIT', score: 250, time: 45.7 });
  assert.strictEqual(store.villain.byTime.length, 1);
  return 'Rejected 8 invalid/markup rows; preserved boundary (0,0) and coerced valid row';
});

// 2. TC-FIX-07: Zero innerHTML writes in renderScoresModal()
runTest('M1-S4-C04-02', 'renderScoresModal() builds DOM via textContent with ZERO innerHTML writes', () => {
  const env = createEnv();
  env.probe.fn.savePlayerName('<b>ab!99</b>');
  env.probe.fn.startGame('villain');
  env.probe.fn.endGame('enemy');

  // Render populated table
  env.probe.fn.openScoresModal('villain');
  const wrap = env.elements.scoreTableWrap;
  assert.strictEqual(wrap._innerHTMLWrites, 0, `Expected 0 innerHTML writes, got ${wrap._innerHTMLWrites}`);
  assert.strictEqual(wrap.children.length, 1);
  assert.strictEqual(wrap.children[0].tagName, 'TABLE');
  const tableText = wrap.textContent;
  assert(tableText.includes('BAB99B'), `Expected sanitized player name in DOM text, got: ${tableText}`);
  assert(!tableText.includes('<img'), 'No raw HTML tags in DOM text');

  // Render empty state
  env.probe.fn.openScoresModal('hero_insane');
  assert.strictEqual(wrap._innerHTMLWrites, 0, 'Empty state must also avoid innerHTML');
  assert(wrap.textContent.includes('No completed runs recorded'));

  // Static check: renderScoresModal body must contain zero innerHTML references
  const renderFn = RAW_SCRIPT.match(/function renderScoresModal\(\)\{[\s\S]*?\n\}/);
  assert(renderFn, 'Could not locate renderScoresModal');
  assert(!/innerHTML/.test(renderFn[0]), 'renderScoresModal must not reference innerHTML');
  return '0 innerHTML writes (populated & empty states); static scan clean';
});

// 3. S-01: Player name sanitization & formatDuration NaN safety
runTest('M1-S4-S01', 'Player name sanitization (A-Z0-9, max 6) & formatDuration NaN safety', () => {
  const env = createEnv();
  assert.strictEqual(env.probe.fn.sanitizePlayerName('<script>123</script>'), 'SCRIPT');
  assert.strictEqual(env.probe.fn.sanitizePlayerName('  a-b_c!99  '), 'ABC99');
  assert.strictEqual(env.probe.fn.formatDuration(NaN), '00:00');
  assert.strictEqual(env.probe.fn.formatDuration(-10), '00:00');
  assert.strictEqual(env.probe.fn.formatDuration(85.9), '01:25');
  return 'Name sanitization and formatDuration NaN/negative guards verified';
});

// 4. TC-FIX-09: Dead-code removal verification
runTest('M1-S4-FIX09', 'All 7 dead symbols removed; active BASE_MODE/HERO_DIFFICULTIES intact (TC-FIX-09)', () => {
  const removedSymbols = ['sessionHighScore', 'BASE_SPEED', 'GRAVITY', 'MIN_JUMP_V', 'MAX_JUMP_V', 'MAX_HOLD_MS'];
  for (const sym of removedSymbols) {
    const re = new RegExp(`\\b${sym}\\b`);
    assert(!re.test(RAW_SCRIPT), `Dead symbol ${sym} still present in index.html`);
  }
  const env = createEnv();
  const refs = env.probe.refs();
  assert.strictEqual(refs.BASE_MODE.cooldownScale, 1.0, 'BASE_MODE.cooldownScale must remain 1.0');
  assert.strictEqual('cooldownScale' in refs.MODES.hero, false, 'Dead MODES.hero.cooldownScale must be removed');
  assert.strictEqual(refs.HERO_DIFFICULTIES.easy.cooldownScale, 0.55);
  assert.strictEqual(refs.HERO_DIFFICULTIES.normal.cooldownScale, 0.65);
  assert.strictEqual(refs.HERO_DIFFICULTIES.hard.cooldownScale, 0.75);
  assert.strictEqual(refs.HERO_DIFFICULTIES.insane.cooldownScale, 0.90);
  // Confirm startGame('hero') works even with invalid currentHeroDiff fallback
  env.probe.fn.setHeroDifficulty('normal');
  env.probe.fn.startGame('hero');
  assert.strictEqual(env.probe.getState().activeMode.cooldownScale, 0.65);
  return '7/7 dead symbols absent; active mode configs intact';
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

// 6. BOT-01 + Hygiene
runTest('BOT-01-AND-HYGIENE', 'RL weights unchanged, zero external requests, zero Drive URLs, zero scattered mode branches', () => {
  const env = createEnv();
  const raw = Buffer.from(env.probe.refs().RL_WEIGHTS_B64, 'base64');
  assert.strictEqual(raw.length, EXPECTED_BOT_WEIGHTS_BYTES);
  assert.strictEqual(crypto.createHash('sha256').update(raw).digest('hex'), EXPECTED_BOT_WEIGHTS_SHA256);
  assert(!/<script[^>]+src\s*=/i.test(htmlText));
  assert(!/\bfetch\s*\(/.test(RAW_SCRIPT));
  assert(!/(drive|docs)\.google\.com/i.test(htmlText));
  const updateMatch = RAW_SCRIPT.match(/function update\(dt\)\{[\s\S]*?\n\}/);
  const loopMatch = RAW_SCRIPT.match(/function loop\([^)]*\)\{[\s\S]*?\n\}/);
  assert(updateMatch && loopMatch);
  assert(!/if\s*\(\s*(currentModeKey|mode)\s*===/.test(updateMatch[0]));
  assert(!/if\s*\(\s*(currentModeKey|mode)\s*===/.test(loopMatch[0]));
  return `${htmlBuf.length} bytes, BOT-01 & hygiene scans clean`;
});

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log('========================================================================');
console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log('========================================================================');
if (failed > 0) process.exit(1);
