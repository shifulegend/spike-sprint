#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M2-S2 Fixed 490x720 World, Render-Only Resize & DPR Scaling Suite
 * Covers: ADR-06, Doc 15 C02, TC-FIX-03, TC-FIX-10, L-01..L-04, BOT-01, HYGIENE-SCAN,
 *         and reproducible fixed-world golden snapshot (v2.6_fixed_world_characterization.json).
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
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'v2.6_fixed_world_characterization.json');
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
  constructor() { this._props = Object.create(null); this.display = ''; this.width = ''; this.height = ''; }
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
    this.value = '';
    this.offsetWidth = 100;
    this.width = 0;
    this.height = 0;
    this._attrs = { ...attrs };
    this._listeners = Object.create(null);
    this.children = [];
  }
  focus() {}
  get textContent() { return this._textContent; }
  set textContent(v) { this.children = []; this._textContent = String(v); }
  appendChild(child) { this.children.push(child); return child; }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  querySelectorAll() { return []; }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  dispatchEvent(evt) {
    const e = evt || {};
    e.stopPropagation = () => {};
    e.preventDefault = () => {};
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
  const dpr = opts.dpr !== undefined ? opts.dpr : 1;
  const seed = opts.seed !== undefined ? opts.seed : 1337;

  let nowMs = 1000.0;
  let rafCallback = null;
  const elements = Object.create(null);
  const windowListeners = Object.create(null);

  function reg(id, tag = 'DIV') {
    const el = new MockElement(id, tag);
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

  const scoreTabs = ['villain', 'hero_easy', 'hero_normal', 'hero_hard', 'hero_insane']
    .map(b => new MockElement('', 'BUTTON', { 'data-bucket': b }, ['score-tab']));

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

  const mockDocument = {
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id);
      return elements[id];
    },
    createElement(tag) { return new MockElement('', tag); },
    querySelectorAll(sel) { return sel === '.score-tab' ? scoreTabs : []; },
    addEventListener() {},
  };

  const mockWindow = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    localStorage: mockLocalStorage,
    addEventListener(type, fn) {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of (windowListeners[evt.type] || [])) fn(evt);
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
  getSimState: () => ({
    gameState, simTicks, score: Number(score.toFixed(6)), elapsed: Number(elapsed.toFixed(6)),
    speedMult: Number(speedMult.toFixed(6)), groundY, worldW: logicalW(), worldH: logicalH(),
    player: {
      x: Number(player.x.toFixed(6)), y: Number(player.y.toFixed(6)),
      vy: Number(player.vy.toFixed(6)), onGround: player.onGround, stuck: player.stuck,
    },
    enemies: enemies.map(e => ({ x: Number(e.x.toFixed(6)), y: Number(e.y.toFixed(6)), alive: e.alive })),
    pits: pits.map(p => ({ x: Number(p.x.toFixed(6)), w: Number(p.w.toFixed(6)) })),
    pipes: pipes.map(p => ({ x: Number(p.x.toFixed(6)), h: Number(p.h.toFixed(6)) })),
    heroCooldownRemaining,
  }),
  getRenderState: () => ({
    canvasWidth: canvas.width, canvasHeight: canvas.height,
    cssWidth: canvas.style.width, cssHeight: canvas.style.height,
    renderDpr, renderScale, renderOffsetX, renderOffsetY, extraSkyLogical,
  }),
  refs: () => ({ RL_WEIGHTS_B64 }),
  fn: {
    update, loop, resize, startGame, startJump, endJump, setHeroDifficulty,
    triggerHeroSpawn, spawnPit, spawnBush, spawnEnemy, logicalW, logicalH,
  },
};
`;

  vm.createContext(sandbox);
  vm.runInContext(RAW_SCRIPT + probeTrailer, sandbox, { filename: 'index.html' });

  return {
    probe: sandbox.__probe,
    elements,
    window: mockWindow,
    resizeTo: (w, h, newDpr) => {
      mockWindow.innerWidth = w;
      mockWindow.innerHeight = h;
      if (newDpr !== undefined) mockWindow.devicePixelRatio = newDpr;
      sandbox.__probe.fn.resize();
    },
    renderOnce: () => { if (rafCallback) rafCallback(nowMs); },
    stepTick: (n = 1) => {
      for (let i = 0; i < n; i++) {
        nowMs += 1000 / 60;
        sandbox.__probe.fn.update(1 / 60);
      }
    },
  };
}

function hashObj(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function runScriptedRun(opts) {
  const env = createEnv(opts);
  if (opts.modeKey === 'hero') env.probe.fn.setHeroDifficulty(opts.heroDiff);
  env.probe.fn.startGame(opts.modeKey);
  const spawners = [env.probe.fn.spawnPit, env.probe.fn.spawnBush, env.probe.fn.spawnEnemy];
  let spawnIdx = 0;
  const frames = [];
  frames.push(env.probe.getSimState());

  for (let t = 1; t <= 600; t++) {
    const st = env.probe.getSimState();
    if (st.gameState !== 'playing') break;

    if (opts.resizeSchedule && opts.resizeSchedule[t]) {
      const [rw, rh, rd] = opts.resizeSchedule[t];
      env.resizeTo(rw, rh, rd);
    }

    if (opts.modeKey === 'villain') {
      if (t === 55 || t === 140 || t === 230 || t === 340) env.probe.fn.startJump();
      if (t === 61 || t === 148 || t === 235 || t === 346) env.probe.fn.endJump();
    } else if (st.heroCooldownRemaining === 0 && t >= 20) {
      env.probe.fn.triggerHeroSpawn(spawners[spawnIdx % 3]);
      spawnIdx++;
    }

    env.stepTick(1);
    const after = env.probe.getSimState();
    if (t % 30 === 0 || after.gameState !== 'playing') frames.push(after);
    if (after.gameState !== 'playing') break;
  }
  return { final: env.probe.getSimState(), frames, render: env.probe.getRenderState() };
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
console.log('Spike Sprint — M2-S2 Fixed 490x720 World, Resize & DPR Scaling Suite');
console.log(`Node: ${process.version}`);
console.log(`Target: ${INDEX_PATH}`);
console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
console.log('========================================================================');

// 1. L-01: Identical simulation trajectory across 390x844, 1080x1920, 1280x720, 1920x1080
runTest('M2-S2-L01', 'Fixed 490x720 world yields bit-identical sim across phone, tall phone & desktop (L-01)', () => {
  const viewports = [[390, 844], [1080, 1920], [1280, 720], [1920, 1080]];
  for (const mode of [{ modeKey: 'villain', seed: 1001 }, { modeKey: 'hero', heroDiff: 'normal', seed: 2002 }]) {
    const base = runScriptedRun({ ...mode, width: 390, height: 844 });
    assert.strictEqual(base.final.worldW, 490);
    assert.strictEqual(base.final.worldH, 720);
    assert(Math.abs(base.final.groundY - 561.6) < 1e-6);
    const baseHash = hashObj(base.frames);
    for (const [w, h] of viewports.slice(1)) {
      const cur = runScriptedRun({ ...mode, width: w, height: h });
      assert.strictEqual(hashObj(cur.frames), baseHash, `Sim diverged on ${w}x${h} in ${mode.modeKey}`);
    }
  }
  return '4 viewports x Villain & Hero identical (WORLD=490x720, groundY=561.6)';
});

// 2. L-02 & L-03: Tall sky extension vs. wide side-bar centering
runTest('M2-S2-L02-L03', 'Tall portrait extends sky above ground; wide desktop centers with side bars (L-02 / L-03)', () => {
  // Tall iPhone 390x844
  const tall = createEnv({ width: 390, height: 844, dpr: 2 });
  const rt = tall.probe.getRenderState();
  assert(rt.renderOffsetY > 0, `Tall screen must bottom-anchor with renderOffsetY > 0, got ${rt.renderOffsetY}`);
  assert(rt.extraSkyLogical > 0, `Tall screen must extend sky above, got ${rt.extraSkyLogical}`);
  assert(Math.abs(rt.renderOffsetX) < 1e-6, `Tall screen should fill width (renderOffsetX=0), got ${rt.renderOffsetX}`);

  // Wide desktop 1920x1080
  const wide = createEnv({ width: 1920, height: 1080, dpr: 1 });
  const rw = wide.probe.getRenderState();
  assert(rw.renderOffsetX > 0, `Wide screen must center with side bars (renderOffsetX > 0), got ${rw.renderOffsetX}`);
  assert(Math.abs(rw.renderOffsetY) < 1e-6, `Wide screen should fill height (renderOffsetY=0), got ${rw.renderOffsetY}`);
  assert.strictEqual(rw.extraSkyLogical, 0);
  return `390x844 extraSky=${rt.extraSkyLogical.toFixed(1)}px; 1920x1080 sideBarX=${rw.renderOffsetX.toFixed(1)}px`;
});

// 3. TC-FIX-03 / L-04: Mid-run & mid-jump resize/rotation leaves sim state hash bit-identical
runTest('M2-S2-FIX03', 'Mid-run & mid-jump resize/rotation leaves simulation state bit-identical (TC-FIX-03 / L-04)', () => {
  const control = runScriptedRun({ modeKey: 'villain', seed: 4242, width: 1280, height: 720, dpr: 1 });
  const rotated = runScriptedRun({
    modeKey: 'villain',
    seed: 4242,
    width: 1280,
    height: 720,
    dpr: 1,
    resizeSchedule: {
      58: [720, 1280, 2],  // mid-jump rotation
      142: [390, 844, 3],  // narrow tall phone mid-jump
      210: [1920, 1080, 1], // wide landscape mid-run
      343: [844, 390, 2],  // landscape phone mid-jump
    },
  });
  assert.strictEqual(hashObj(rotated.frames), hashObj(control.frames), 'Mid-run resize altered simulation state');
  return `Sim hash identical across 4 mid-run/mid-jump rotations (${hashObj(control.frames).slice(0, 12)}...)`;
});

// 4. TC-FIX-10: DPR 1, 2, 3 backing store scales by min(DPR, 2) with bit-identical sim state
runTest('M2-S2-FIX10', 'DPR 1, 2, 3 scale backing store by min(DPR, 2) with bit-identical sim state (TC-FIX-10)', () => {
  const r1 = runScriptedRun({ modeKey: 'villain', seed: 555, width: 390, height: 844, dpr: 1 });
  const r2 = runScriptedRun({ modeKey: 'villain', seed: 555, width: 390, height: 844, dpr: 2 });
  const r3 = runScriptedRun({ modeKey: 'villain', seed: 555, width: 390, height: 844, dpr: 3 });

  assert.strictEqual(r1.render.renderDpr, 1);
  assert.strictEqual(r1.render.canvasWidth, 390);
  assert.strictEqual(r1.render.canvasHeight, 844);

  assert.strictEqual(r2.render.renderDpr, 2);
  assert.strictEqual(r2.render.canvasWidth, 780);
  assert.strictEqual(r2.render.canvasHeight, 1688);

  assert.strictEqual(r3.render.renderDpr, 2, 'DPR=3 must clamp to 2');
  assert.strictEqual(r3.render.canvasWidth, 780);
  assert.strictEqual(r3.render.canvasHeight, 1688);

  const h1 = hashObj(r1.frames);
  assert.strictEqual(hashObj(r2.frames), h1);
  assert.strictEqual(hashObj(r3.frames), h1);
  return 'DPR 1->390x844, DPR 2->780x1688, DPR 3->clamped 780x1688; sim bit-identical';
});

// 5. Capture fixed-world golden snapshot (v2.6_fixed_world_characterization.json)
runTest('M2-S2-SNAPSHOT', 'Capture reproducible v2.6_fixed_world_characterization.json (Villain + 4 Hero tiers)', () => {
  const scenarios = [
    { name: 'villain', modeKey: 'villain', heroDiff: null, seed: 1001 },
    { name: 'hero_easy', modeKey: 'hero', heroDiff: 'easy', seed: 2001 },
    { name: 'hero_normal', modeKey: 'hero', heroDiff: 'normal', seed: 2002 },
    { name: 'hero_hard', modeKey: 'hero', heroDiff: 'hard', seed: 2003 },
    { name: 'hero_insane', modeKey: 'hero', heroDiff: 'insane', seed: 2004 },
  ];
  const runs = scenarios.map(sc => {
    const out = runScriptedRun({ ...sc, width: 1280, height: 720, dpr: 2 });
    return {
      scenario: sc.name,
      modeKey: sc.modeKey,
      heroDiff: sc.heroDiff,
      seed: sc.seed,
      finalTick: out.final.simTicks,
      finalScore: out.final.score,
      finalGameState: out.final.gameState,
      sampledFrames: out.frames,
    };
  });
  const snapshot = {
    schema: 'spike-sprint-v2.6-fixed-world-v1',
    worldW: 490,
    worldH: 720,
    groundY: 561.6,
    dt: 1 / 60,
    buildBytes: htmlBuf.length,
    buildSha256: htmlSha256,
    botWeightsSha256: EXPECTED_BOT_WEIGHTS_SHA256,
    scenarioCount: runs.length,
    runs,
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const jsonStr = JSON.stringify(snapshot, null, 2) + '\n';
  fs.writeFileSync(SNAPSHOT_PATH, jsonStr, 'utf8');
  const snapSha = crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
  return `5 scenarios saved (${Buffer.byteLength(jsonStr, 'utf8')} bytes, SHA-256=${snapSha})`;
});

// 6. BOT-01 + Budget + Hygiene
runTest('BOT-01-AND-HYGIENE', 'RL weights unchanged, size within 120 KB budget, zero external requests/Drive URLs', () => {
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
