#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M1-S5 Accessibility, Escape/Focus Trap, Viewport Meta & Touch-Action Suite
 * Covers: TC-FIX-04, TC-FIX-05, BOT-01, HYGIENE-SCAN, and D-01 zero-diff parity.
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
  focus() {
    if (this._docRef) this._docRef.activeElement = this;
  }
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
        else if (sel.includes('input') && c.tagName === 'INPUT') out.push(c);
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
  const elements = Object.create(null);
  const windowListeners = Object.create(null);

  const mockDocument = {
    activeElement: null,
    visibilityState: 'visible',
    getElementById(id) {
      if (!elements[id]) elements[id] = new MockElement(id, 'DIV', {}, [], mockDocument);
      return elements[id];
    },
    createElement(tag) { return new MockElement('', tag, {}, [], mockDocument); },
    querySelectorAll(sel) { return sel === '.score-tab' ? scoreTabs : []; },
    addEventListener() {},
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
    ['spawnPitBtn', 'BUTTON', { 'aria-disabled': 'false' }],
    ['spawnBushBtn', 'BUTTON', { 'aria-disabled': 'false' }],
    ['spawnHeroBtn', 'BUTTON', { 'aria-disabled': 'false' }],
    ['playVillainBtn', 'BUTTON'], ['playHeroBtn', 'BUTTON'], ['playHeroTitle', 'SPAN'],
    ['diffEasy', 'BUTTON'], ['diffNormal', 'BUTTON'], ['diffHard', 'BUTTON'], ['diffInsane', 'BUTTON'],
    ['restartBtn', 'BUTTON'], ['changeModeBtn', 'BUTTON'], ['exitBtn', 'BUTTON'],
    ['exitModal', 'DIV'], ['resumeRunBtn', 'BUTTON'], ['confirmExitBtn', 'BUTTON'],
    ['scoresModal', 'DIV'], ['openScoresStartBtn', 'BUTTON'], ['openScoresEndBtn', 'BUTTON'],
    ['closeScoresBtn', 'BUTTON'], ['sortByScoreBtn', 'BUTTON'], ['sortByTimeBtn', 'BUTTON'],
    ['scoreTableWrap', 'DIV'], ['startNameInput', 'INPUT'], ['endNameInput', 'INPUT'],
    ['randNameStartBtn', 'BUTTON'], ['randNameEndBtn', 'BUTTON'],
  ].forEach(([id, tag, attrs]) => reg(id, tag, attrs || {}));

  elements.startScreen.style.display = 'flex';
  elements.loreCard.style.display = 'none';
  elements.exitModal.style.display = 'none';
  elements.scoresModal.style.display = 'none';

  // Wire modal children for focus-trap traversal
  elements.loreCard.appendChild(elements.loreCloseBtn);
  elements.exitModal.appendChild(elements.resumeRunBtn);
  elements.exitModal.appendChild(elements.confirmExitBtn);
  const scoreTabs = ['villain', 'hero_easy', 'hero_normal', 'hero_hard', 'hero_insane']
    .map(b => new MockElement('', 'BUTTON', { 'data-bucket': b }, ['score-tab'], mockDocument));
  scoreTabs.forEach(t => elements.scoresModal.appendChild(t));
  elements.scoresModal.appendChild(elements.sortByScoreBtn);
  elements.scoresModal.appendChild(elements.sortByTimeBtn);
  elements.scoresModal.appendChild(elements.closeScoresBtn);

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
    currentModeKey, currentHeroDiff, jumpKeyDown, heroCooldownRemaining,
    player: { ...player },
    enemies: enemies.map(e => ({ ...e })),
    pits: pits.map(p => ({ ...p })),
    pipes: pipes.map(p => ({ ...p })),
  }),
  refs: () => ({ RL_WEIGHTS_B64 }),
  clearObstacles: () => { enemies.length = 0; pits.length = 0; pipes.length = 0; },
  setNextSpawnAt: (v) => { nextSpawnAt = v; },
  fn: {
    update, startGame, startJump, endJump, setHeroDifficulty, triggerHeroSpawn,
    spawnPit, spawnBush, spawnEnemy, logicalW, logicalH, openScoresModal,
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
console.log('Spike Sprint — M1-S5 Accessibility, Escape/Focus Trap & Viewport Suite');
console.log(`Node: ${process.version}`);
console.log(`Target: ${INDEX_PATH}`);
console.log(`Size: ${htmlBuf.length} bytes | Lines: ${htmlLines} | SHA-256: ${htmlSha256}`);
console.log('========================================================================');

// 1. TC-FIX-05: Viewport meta, touch-action: manipulation, safe-area & responsive media query
runTest('M1-S5-FIX05', 'Viewport meta, touch-action: manipulation, safe-area insets & mobile CSS (TC-FIX-05)', () => {
  assert(
    /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0,\s*viewport-fit=cover"\s*>/i.test(htmlText),
    'Missing viewport meta tag with viewport-fit=cover'
  );
  assert(/button\s*\{[^}]*touch-action\s*:\s*manipulation/i.test(htmlText), 'Missing touch-action: manipulation on buttons');
  assert(/env\(safe-area-inset-top\)/i.test(htmlText), 'Missing safe-area-inset-top');
  assert(/env\(safe-area-inset-bottom\)/i.test(htmlText), 'Missing safe-area-inset-bottom');
  assert(/@media\s*\(\s*max-width\s*:\s*520px\s*\)/i.test(htmlText), 'Missing compact mobile media query');
  return 'Viewport meta, touch-action, safe-area insets, and mobile media query verified';
});

// 2. TC-FIX-04 (Static): Focus rings, no outline:none on buttons, aria-modal="true"
runTest('M1-S5-FIX04-STATIC', 'Visible :focus-visible ring, no outline:none suppression, aria-modal="true" on all 3 dialogs', () => {
  assert(/button:focus-visible[^{]*\{[^}]*outline\s*:\s*2px\s+solid/i.test(htmlText), 'Missing :focus-visible outline rule');
  const styleBlock = htmlText.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert(!/outline\s*:\s*none/i.test(styleBlock), 'Found outline:none in CSS');
  assert(/id="loreCard"[^>]*aria-modal="true"/.test(htmlText), 'loreCard missing aria-modal="true"');
  assert(/id="exitModal"[^>]*aria-modal="true"/.test(htmlText), 'exitModal missing aria-modal="true"');
  assert(/id="scoresModal"[^>]*aria-modal="true"/.test(htmlText), 'scoresModal missing aria-modal="true"');
  return 'CSS focus rings & aria-modal="true" verified on loreCard, exitModal, scoresModal';
});

// 3. TC-FIX-04 (Runtime): Escape closes modals (including while input focused) & pauses/resumes play
runTest('M1-S5-FIX04-ESC', 'Escape closes loreCard/scoresModal (even from name input) and toggles pause without timer drift', () => {
  const env = createEnv();

  // Open loreCard, focus startNameInput, press Escape -> input must NOT swallow Escape
  env.elements.storyToggle.click();
  assert.strictEqual(env.elements.loreCard.style.display, 'block');
  env.elements.startNameInput.focus();
  const inpEsc = env.elements.startNameInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(inpEsc.stopped, false, 'startNameInput must allow Escape to bubble');
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(env.elements.loreCard.style.display, 'none', 'Escape must close loreCard');
  assert.strictEqual(env.document.activeElement, env.elements.storyToggle, 'Focus must restore to storyToggle');

  // Open scoresModal -> Escape closes it
  env.elements.openScoresStartBtn.focus();
  env.elements.openScoresStartBtn.click();
  assert.strictEqual(env.elements.scoresModal.style.display, 'flex');
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(env.elements.scoresModal.style.display, 'none', 'Escape must close scoresModal');

  // Active play -> Escape pauses -> wait 10s -> Escape resumes without elapsed drift
  env.probe.fn.startGame('villain');
  env.probe.clearObstacles();
  env.probe.setNextSpawnAt(99999);
  env.advanceClock(5000);
  env.stepTick(1);
  const elapsedBefore = env.probe.getState().elapsed;

  env.window.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ', repeat: false });
  assert.strictEqual(env.probe.getState().jumpKeyDown, true);
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(env.probe.getState().gameState, 'paused', 'Escape during play must pause');
  assert.strictEqual(env.probe.getState().jumpKeyDown, false, 'Escape pause must clear held jumpKeyDown');
  assert.strictEqual(env.elements.exitModal.style.display, 'flex');
  assert.strictEqual(env.document.activeElement, env.elements.resumeRunBtn, 'Pause modal must focus resumeRunBtn');

  env.advanceClock(10000);
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(env.probe.getState().gameState, 'playing', 'Escape in exitModal must resume');
  assert.strictEqual(env.elements.exitModal.style.display, 'none');
  env.stepTick(1);
  const elapsedAfter = env.probe.getState().elapsed;
  assert(Math.abs(elapsedAfter - elapsedBefore) < 0.1, `Elapsed drifted on Escape pause/resume: ${elapsedBefore} -> ${elapsedAfter}`);
  return 'Escape modal close (including from input) & pause/resume without drift verified';
});

// 4. TC-FIX-04 (Runtime): Tab / Shift+Tab focus trap inside open modal
runTest('M1-S5-FIX04-TRAP', 'Tab and Shift+Tab wrap focus cleanly inside open modals', () => {
  const env = createEnv();
  env.probe.fn.startGame('villain');
  env.window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.strictEqual(env.document.activeElement, env.elements.resumeRunBtn);

  // Shift+Tab from first (resumeRunBtn) wraps to last (confirmExitBtn)
  const e1 = env.window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true });
  assert.strictEqual(e1.defaultPrevented, true);
  assert.strictEqual(env.document.activeElement, env.elements.confirmExitBtn);

  // Tab from last (confirmExitBtn) wraps back to first (resumeRunBtn)
  const e2 = env.window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false });
  assert.strictEqual(e2.defaultPrevented, true);
  assert.strictEqual(env.document.activeElement, env.elements.resumeRunBtn);
  return 'Tab / Shift+Tab focus trap wrapped cleanly inside exitModal';
});

// 5. TC-FIX-04 (Runtime): Cooling Hero buttons set aria-disabled="true" -> "false"
runTest('M1-S5-FIX04-ARIA', 'Cooling Hero spawn buttons toggle aria-disabled="true" and restore "false" when ready', () => {
  const env = createEnv();
  env.probe.fn.setHeroDifficulty('easy');
  env.probe.fn.startGame('hero');
  assert.strictEqual(env.elements.spawnPitBtn.getAttribute('aria-disabled'), 'false');
  env.elements.spawnPitBtn.click();
  assert.strictEqual(env.elements.spawnPitBtn.getAttribute('aria-disabled'), 'true');
  assert.strictEqual(env.elements.spawnBushBtn.getAttribute('aria-disabled'), 'true');
  assert.strictEqual(env.elements.spawnHeroBtn.getAttribute('aria-disabled'), 'true');
  env.stepTick(26);
  assert.strictEqual(env.elements.spawnPitBtn.getAttribute('aria-disabled'), 'false');
  assert.strictEqual(env.elements.spawnBushBtn.getAttribute('aria-disabled'), 'false');
  assert.strictEqual(env.elements.spawnHeroBtn.getAttribute('aria-disabled'), 'false');
  return 'aria-disabled transitions false -> true (cooling) -> false (ready) across all 3 buttons';
});

// 6. D-01 Zero-Diff Characterization Parity
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

// 7. BOT-01 + Budget + Hygiene
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
