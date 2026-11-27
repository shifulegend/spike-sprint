#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M3-S1 Pure Simulation Module & Build Pipeline Test Suite
 * Covers: ADR-09, pure-Node vs. built-HTML bit-exact parity, D-04, D-06, D-07,
 *         BOT-01, BOT-02, HYGIENE-SCAN, and reproducible v2.6_pure_sim_golden.json.
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SIM_PATH = path.join(ROOT, 'src', 'sim', 'core.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const GOLDEN_OUT_PATH = path.join(__dirname, 'snapshots', 'v2.6_pure_sim_golden.json');
const EXPECTED_BOT_WEIGHTS_BYTES = 23572;
const EXPECTED_BOT_WEIGHTS_SHA256 = '99d90952c2b64faca1aefe3aadc7ca6ee6c38d785bb660f06982f503161d5361';
const WARN_BUDGET_BYTES = 120 * 1024;

const Sim = require(SIM_PATH);
const simSource = fs.readFileSync(SIM_PATH, 'utf8');
const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha = crypto.createHash('sha256').update(htmlBuf).digest('hex');

const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not extract <script> from built index.html');
const BUILT_SCRIPT = scriptMatch[1];

function runBuiltHtmlScenario(modeKey, heroDiff, seed) {
  const elements = Object.create(null);
  function mkEl(id) {
    return {
      id: id || '', tagName: 'DIV', value: '', textContent: '', innerHTML: '',
      offsetWidth: 100, width: 0, height: 0, disabled: false, children: [],
      style: { display: '', width: '', height: '', setProperty() {}, getPropertyValue() { return ''; } },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      focus() {}, getAttribute() { return null; }, setAttribute() {},
      querySelectorAll() { return []; }, addEventListener() {}, appendChild(c) { return c; },
      getContext() {
        const n = () => {};
        return {
          clearRect: n, fillRect: n, strokeRect: n, beginPath: n, closePath: n,
          moveTo: n, lineTo: n, arc: n, ellipse: n, fill: n, stroke: n, save: n,
          restore: n, scale: n, translate: n, rotate: n, fillText: n, strokeText: n,
          measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: n }),
          setLineDash: n, quadraticCurveTo: n, bezierCurveTo: n, rect: n, clip: n, drawImage: n,
        };
      },
    };
  }
  const storage = new Map();
  const mockLS = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  };
  class MockAC {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createOscillator() { return { type: 'square', frequency: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: { setValueAtTime() {} }, connect() {} }; }
  }
  let nowMs = 1000;
  const mockDoc = {
    activeElement: null, hidden: false, visibilityState: 'visible',
    getElementById: id => (elements[id] || (elements[id] = mkEl(id))),
    createElement: tag => mkEl(tag),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const mockWin = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
    AudioContext: MockAC, webkitAudioContext: MockAC, localStorage: mockLS,
    addEventListener() {},
  };
  const sandbox = {
    window: mockWin, document: mockDoc, localStorage: mockLS, Math,
    Float32Array, Uint8Array, Int16Array, Array, Object, Number, String, Boolean, JSON, Date,
    Promise, Error, RegExp, isFinite, isNaN, parseInt, parseFloat,
    performance: { now: () => nowMs }, requestAnimationFrame: () => 1,
    console, setTimeout: () => 0, clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;

  const probe = `
;globalThis.__p = {
  snap: () => ({
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
  fn: { startGame, setHeroDifficulty, stepActiveSim, startJump, endJump, triggerHeroSpawn },
};`;

  vm.createContext(sandbox);
  vm.runInContext(BUILT_SCRIPT + probe, sandbox, { filename: 'index.html' });
  const p = sandbox.__p;
  if (modeKey === 'hero') p.fn.setHeroDifficulty(heroDiff);
  p.fn.startGame(modeKey, seed);

  const spawners = ['pit', 'bush', 'enemy'];
  let spawnIdx = 0;
  const frames = [JSON.parse(JSON.stringify(p.snap()))];
  for (let t = 1; t <= 600; t++) {
    const st = p.snap();
    if (st.gameState !== 'playing') break;
    if (modeKey === 'villain') {
      if (t === 55 || t === 140 || t === 230 || t === 340) p.fn.startJump();
      if (t === 61 || t === 148 || t === 235 || t === 346) p.fn.endJump();
    } else if (st.heroCooldownRemaining === 0 && t >= 20) {
      p.fn.triggerHeroSpawn(spawners[spawnIdx % 3]);
      spawnIdx++;
    }
    nowMs += 1000 / 60;
    p.fn.stepActiveSim();
    const after = JSON.parse(JSON.stringify(p.snap()));
    if (t % 30 === 0 || after.gameState !== 'playing') frames.push(after);
    if (after.gameState !== 'playing') break;
  }
  return frames;
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
console.log('Spike Sprint — M3-S1 Pure Simulation Module & Build Pipeline Suite');
console.log(`Node: ${process.version} | SIM_VERSION: ${Sim.SIM_VERSION}`);
console.log(`Built index.html: ${htmlBuf.length} bytes | SHA-256: ${htmlSha}`);
console.log('========================================================================');

// 1. D-06 & D-07: Static purity scan on src/sim/core.js
runTest('M3-S1-PURITY', 'src/sim/core.js has zero Math.random, DOM, window, wall-clock, audio, or mode branches (D-06/D-07)', () => {
  const forbidden = [
    ['Math.random', /\bMath\.random\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['performance', /\bperformance\b/],
    ['Date', /\bDate\b/],
    ['localStorage', /\blocalStorage\b/],
    ['AudioContext', /\bAudioContext\b/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['atob', /\batob\s*\(/],
    ['scattered mode branch', /if\s*\(\s*(currentModeKey|modeKey|mode)\s*===/],
    ['Google Drive URL', /(drive|docs)\.google\.com/i],
  ];
  for (const [label, re] of forbidden) {
    assert(!re.test(simSource), `Forbidden token "${label}" found in src/sim/core.js`);
  }
  return `Zero forbidden tokens in src/sim/core.js (${Buffer.byteLength(simSource, 'utf8')} bytes)`;
});

// 2. Direct headless Node src/sim/core.js vs. built single-file index.html parity (5/5 scenarios)
runTest('M3-S1-PARITY', 'Pure headless Node src/sim/core.js matches built index.html BIT-FOR-BIT across all 5 scenarios', () => {
  const scenarios = [
    { name: 'villain', modeKey: 'villain', heroDiff: null, seed: 1001 },
    { name: 'hero_easy', modeKey: 'hero', heroDiff: 'easy', seed: 2001 },
    { name: 'hero_normal', modeKey: 'hero', heroDiff: 'normal', seed: 2002 },
    { name: 'hero_hard', modeKey: 'hero', heroDiff: 'hard', seed: 2003 },
    { name: 'hero_insane', modeKey: 'hero', heroDiff: 'insane', seed: 2004 },
  ];
  const spawnKinds = ['pit', 'bush', 'enemy'];
  const goldenRuns = [];

  for (const sc of scenarios) {
    const sim = Sim.createSim({ modeKey: sc.modeKey, heroDiff: sc.heroDiff || 'normal', seed: sc.seed });
    let spawnIdx = 0;
    const pureFrames = [sim.getSnapshot()];
    for (let t = 1; t <= 600; t++) {
      if (sim.state.gameState !== 'playing') break;
      if (sc.modeKey === 'villain') {
        if (t === 55 || t === 140 || t === 230 || t === 340) sim.startJump();
        if (t === 61 || t === 148 || t === 235 || t === 346) sim.endJump();
      } else if (sim.state.heroCooldownRemaining === 0 && t >= 20) {
        sim.triggerHeroSpawn(spawnKinds[spawnIdx % 3]);
        spawnIdx++;
      }
      sim.step();
      if (t % 30 === 0 || sim.state.gameState !== 'playing') pureFrames.push(sim.getSnapshot());
      if (sim.state.gameState !== 'playing') break;
    }

    const htmlFrames = runBuiltHtmlScenario(sc.modeKey, sc.heroDiff || 'normal', sc.seed);
    assert.deepStrictEqual(pureFrames, htmlFrames, `Pure Node sim vs built index.html diverged on ${sc.name}`);
    goldenRuns.push({
      scenario: sc.name,
      modeKey: sc.modeKey,
      heroDiff: sc.heroDiff,
      seed: sc.seed,
      finalTick: sim.state.simTicks,
      finalScore: Number(sim.state.score.toFixed(6)),
      stopCause: sim.state.stopCause,
      sampledFrames: pureFrames,
    });
  }

  const goldenDoc = {
    schema: 'spike-sprint-v2.6-pure-sim-golden-v1',
    simVersion: Sim.SIM_VERSION,
    worldW: Sim.WORLD_W,
    worldH: Sim.WORLD_H,
    groundY: Sim.GROUND_Y,
    botWeightsSha256: EXPECTED_BOT_WEIGHTS_SHA256,
    scenarioCount: goldenRuns.length,
    runs: goldenRuns,
  };
  fs.mkdirSync(path.dirname(GOLDEN_OUT_PATH), { recursive: true });
  const jsonStr = JSON.stringify(goldenDoc, null, 2) + '\n';
  fs.writeFileSync(GOLDEN_OUT_PATH, jsonStr, 'utf8');
  const gSha = crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
  return `5/5 scenarios bit-exact (Node pure sim === built index.html); golden SHA-256=${gSha.slice(0, 12)}...`;
});

// 3. D-04: Input ordering (press & release same tick; spam rejected during cooldown)
runTest('M3-S1-D04', 'Same-tick press+release and Hero cooldown spam rejection behave deterministically (D-04)', () => {
  const s1 = Sim.createSim({ modeKey: 'villain', seed: 42 });
  const s2 = Sim.createSim({ modeKey: 'villain', seed: 42 });
  for (const s of [s1, s2]) {
    s.startJump();
    s.endJump();
    s.step();
  }
  assert.deepStrictEqual(s1.getSnapshot(), s2.getSnapshot());
  assert.strictEqual(s1.state.jumpKeyDown, false);

  const h = Sim.createSim({ modeKey: 'hero', heroDiff: 'easy', seed: 99 });
  assert.strictEqual(h.triggerHeroSpawn('pit'), true);
  assert.strictEqual(h.triggerHeroSpawn('bush'), false, 'Spam during cooldown must be rejected');
  assert.strictEqual(h.triggerHeroSpawn('enemy'), false, 'Spam during cooldown must be rejected');
  assert.strictEqual(h.state.pits.length, 1);
  assert.strictEqual(h.state.pipes.length, 0);
  assert.strictEqual(h.state.enemies.length, 0);
  return 'Same-tick press+release identical; cooldown anti-spam enforced';
});

// 4. D-06: Decorative Math.random() calls between ticks never affect simulation
runTest('M3-S1-D06', 'External Math.random() calls never perturb simulation RNG draw order (D-06)', () => {
  const a = Sim.createSim({ modeKey: 'villain', seed: 2026 });
  const b = Sim.createSim({ modeKey: 'villain', seed: 2026 });
  for (let t = 0; t < 240; t++) {
    a.step();
    for (let k = 0; k < 7; k++) Math.random();
    b.step();
  }
  assert.deepStrictEqual(a.getSnapshot(), b.getSnapshot());
  return '1,680 interleaved Math.random() calls caused zero sim divergence';
});

// 5. BOT-01 & BOT-02 directly on src/sim/core.js
runTest('M3-S1-BOT', 'Pure-JS Base64 weight decode matches policy.state SHA-256 & Q-value parity (BOT-01/BOT-02)', () => {
  const raw = Sim.decodeBase64ToBytes(Sim.RL_WEIGHTS_B64);
  const sha = crypto.createHash('sha256').update(Buffer.from(raw)).digest('hex');
  assert.strictEqual(raw.length, EXPECTED_BOT_WEIGHTS_BYTES);
  assert.strictEqual(sha, EXPECTED_BOT_WEIGHTS_SHA256);

  const buf = Buffer.from(Sim.RL_WEIGHTS_B64, 'base64');
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const obs = Float32Array.from([0.8, 0, 1, 0, 0, 0.3, 0.2, 0.1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const qSim = Sim.rlForward(obs);
  let off = 0, act = Float32Array.from(obs);
  const sizes = [21, 64, 64, 5];
  for (let l = 0; l < 3; l++) {
    const inD = sizes[l], outD = sizes[l + 1];
    const W = f32.subarray(off, off + outD * inD); off += outD * inD;
    const b = f32.subarray(off, off + outD); off += outD;
    const nxt = new Float32Array(outD);
    for (let o = 0; o < outD; o++) {
      let sum = b[o];
      for (let i = 0; i < inD; i++) sum += W[o * inD + i] * act[i];
      nxt[o] = (l < 2 && sum < 0) ? 0 : sum;
    }
    act = nxt;
  }
  let maxDiff = 0;
  for (let i = 0; i < 5; i++) maxDiff = Math.max(maxDiff, Math.abs(qSim[i] - act[i]));
  assert(maxDiff < 1e-5, `Q-value diff ${maxDiff} >= 1e-5`);
  return `23,572 bytes SHA-256 verified; maxAbsDiff=${maxDiff.toExponential(2)}`;
});

// 6. Built single-file index.html hygiene & warning-first budget (per Doc 16)
runTest('M3-S1-BUILD-HYGIENE', 'Built index.html is offline-only, zero Drive URLs, and reports warning-first 120 KB budget', () => {
  assert(htmlText.includes('SpikeSprintSim'), 'Built index.html missing inlined SpikeSprintSim');
  assert(!/<script[^>]+src\s*=/i.test(htmlText), 'Found external <script src>');
  assert(!/\bfetch\s*\(/.test(htmlText), 'Found fetch()');
  assert(!/(drive|docs)\.google\.com/i.test(htmlText), 'Found Google Drive URL in built index.html');
  const budgetNote = htmlBuf.length > WARN_BUDGET_BYTES
    ? `WARNING: ${htmlBuf.length} > ${WARN_BUDGET_BYTES} (non-blocking per Doc 16)`
    : `<= ${WARN_BUDGET_BYTES}`;
  return `${htmlBuf.length} bytes (${budgetNote}), single-file offline clean`;
});

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log('========================================================================');
console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log('========================================================================');
if (failed > 0) process.exit(1);
