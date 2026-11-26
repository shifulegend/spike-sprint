#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M4-S2 Replay Storage (ST-01..ST-08) & Replay Playback UX (TC-37) Suite
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const Sim = require(path.join(ROOT, 'src', 'sim', 'core.js'));
const Replay = require(path.join(ROOT, 'src', 'sim', 'replay.js'));
const ReplayStore = require(path.join(ROOT, 'src', 'storage', 'replays.js'));
const INDEX_PATH = path.join(ROOT, 'index.html');

const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha = crypto.createHash('sha256').update(htmlBuf).digest('hex');
const BUILT_SCRIPT = htmlText.match(/<script>([\s\S]*?)<\/script>/)[1];

// Minimal in-memory mock IndexedDB implementing open/transaction/objectStore/put/get/delete/getAllKeys
function createMockIndexedDB(mode = 'normal') {
  const backing = new Map();
  let putCount = 0;

  function makeReq(executor) {
    const req = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null };
    setImmediate(() => executor(req));
    return req;
  }

  return {
    getPutCount: () => putCount,
    getKeys: () => Array.from(backing.keys()),
    putRaw: (k, v) => backing.set(k, v),
    open() {
      if (mode === 'blocked') {
        const err = new Error('The operation is insecure.');
        err.name = 'SecurityError';
        throw err;
      }
      return makeReq((req) => {
        if (mode === 'open_error') {
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const tx = { onerror: null };
            tx.objectStore = () => ({
              put(record) {
                putCount++;
                return makeReq((r) => {
                  if (mode === 'quota') {
                    if (r.onerror) r.onerror({ target: { error: { name: 'QuotaExceededError' } } });
                    return;
                  }
                  backing.set(record.runId, record);
                  r.result = record.runId;
                  if (r.onsuccess) r.onsuccess({ target: r });
                });
              },
              get(key) {
                return makeReq((r) => {
                  r.result = backing.get(key);
                  if (r.onsuccess) r.onsuccess({ target: r });
                });
              },
              delete(key) {
                return makeReq((r) => {
                  backing.delete(key);
                  if (r.onsuccess) r.onsuccess({ target: r });
                });
              },
              getAllKeys() {
                return makeReq((r) => {
                  r.result = Array.from(backing.keys());
                  if (r.onsuccess) r.onsuccess({ target: r });
                });
              },
            });
            return tx;
          },
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
    },
  };
}

function makeSampleEnvelope(seed = 1001) {
  const rec = Replay.createRecorder({ modeKey: 'villain', seed }, Sim);
  rec.startJump();
  rec.step();
  rec.endJump();
  for (let t = 0; t < 160 && rec.sim.state.gameState === 'playing'; t++) rec.step();
  return rec.finalize();
}

function createBrowserEnv() {
  const elements = Object.create(null);
  const windowListeners = Object.create(null);

  class El {
    constructor(id, tag = 'DIV', attrs = {}, classes = []) {
      this.id = id || '';
      this.tagName = tag.toUpperCase();
      this.className = classes.join(' ');
      this.style = { display: '', width: '', height: '', setProperty() {}, getPropertyValue() { return ''; } };
      this.classList = {
        _s: new Set(classes),
        add(...c) { c.forEach(x => this._s.add(x)); },
        remove(...c) { c.forEach(x => this._s.delete(x)); },
        contains(x) { return this._s.has(x); },
        toggle(x, f) { if (f === undefined) { if (this._s.has(x)) this._s.delete(x); else this._s.add(x); } else if (f) this._s.add(x); else this._s.delete(x); },
      };
      this._text = '';
      this.value = '';
      this.offsetWidth = 100;
      this.width = 0;
      this.height = 0;
      this.disabled = false;
      this._attrs = { ...attrs };
      this._listeners = Object.create(null);
      this.children = [];
    }
    focus() {}
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
    set textContent(v) { this.children = []; this._text = String(v); }
    appendChild(c) { this.children.push(c); return c; }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    querySelectorAll() { return []; }
    addEventListener(t, fn) { if (!this._listeners[t]) this._listeners[t] = []; this._listeners[t].push(fn); }
    dispatchEvent(e) {
      const ev = e || {};
      ev.stopPropagation = () => {};
      ev.preventDefault = () => {};
      for (const fn of (this._listeners[ev.type] || [])) fn(ev);
      return ev;
    }
    click() { return this.dispatchEvent({ type: 'click' }); }
    getContext() {
      const n = () => {};
      return {
        clearRect: n, fillRect: n, strokeRect: n, beginPath: n, closePath: n,
        moveTo: n, lineTo: n, arc: n, ellipse: n, fill: n, stroke: n, save: n,
        restore: n, scale: n, translate: n, rotate: n, fillText: n, strokeText: n,
        measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: n }),
        setLineDash: n, quadraticCurveTo: n, bezierCurveTo: n, rect: n, clip: n, drawImage: n,
      };
    }
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
    getElementById: id => (elements[id] || (elements[id] = new El(id))),
    createElement: tag => new El('', tag),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const mockWin = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
    AudioContext: MockAC, webkitAudioContext: MockAC, localStorage: mockLS,
    addEventListener(t, fn) { if (!windowListeners[t]) windowListeners[t] = []; windowListeners[t].push(fn); },
    dispatchEvent(e) {
      const ev = e || {};
      ev.preventDefault = () => {};
      for (const fn of (windowListeners[ev.type] || [])) fn(ev);
      return ev;
    },
  };
  const sandbox = {
    window: mockWin, document: mockDoc, localStorage: mockLS, Math,
    Float32Array, Uint8Array, Int16Array, Array, Object, Number, String, Boolean, JSON, Date,
    Promise, Error, RegExp, Set, Map, isFinite, isNaN, parseInt, parseFloat,
    performance: { now: () => nowMs }, requestAnimationFrame: () => 1,
    console, setTimeout: () => 0, clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;

  const probe = `
;globalThis.__p = {
  getState: () => ({
    gameState, isReplaying, simTicks, score, elapsed, lastRunId,
    player: { ...player },
    scores: loadScores(),
    replayBadgeDisplay: document.getElementById('replayBadge').style.display,
    scoresModalDisplay: document.getElementById('scoresModal').style.display,
    exitModalDisplay: document.getElementById('exitModal').style.display,
    scoresStatusText: document.getElementById('scoresStatus').textContent,
    gameOverTitle: document.getElementById('gameOverTitle').textContent,
  }),
  fn: {
    startGame, stepActiveSim, startJump, endJump, startReplay, exitReplayToScores,
    openScoresModal, watchReplayByRunId, replayStore,
  },
};`;

  vm.createContext(sandbox);
  vm.runInContext(BUILT_SCRIPT + probe, sandbox, { filename: 'index.html' });
  return { p: sandbox.__p, elements, window: mockWin };
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
  console.log('Spike Sprint — M4-S2 Replay Storage (ST-01..ST-08) & Replay UX (TC-37)');
  console.log(`Node: ${process.version}`);
  console.log(`Built index.html: ${htmlBuf.length} bytes (${(htmlBuf.length / 1024).toFixed(2)} KB) | SHA-256: ${htmlSha}`);
  console.log('========================================================================');

  // ST-01 & ST-07 & ST-08: Normal IDB save/load, write-once async, persist request
  await runTest('M4-S2-ST01-07-08', 'Normal IndexedDB save/load, async write-once & navigator.storage.persist() (ST-01/07/08)', async () => {
    const idb = createMockIndexedDB('normal');
    let persistCalls = 0;
    const store = ReplayStore.createReplayStore({
      indexedDB: idb,
      navigator: { storage: { persist: () => { persistCalls++; return Promise.resolve(true); } } },
    });
    await store.hydrateKeys();
    assert.strictEqual(persistCalls, 1, 'Expected persist() called once');
    const env = makeSampleEnvelope(1001);
    const saveRes = await store.saveReplay('run_1', env);
    assert.strictEqual(saveRes.ok, true);
    assert.strictEqual(saveRes.persisted, true);
    assert.strictEqual(idb.getPutCount(), 1, 'Expected write-once per completed run');
    assert.strictEqual(store.hasReplaySync('run_1'), true);
    const loaded = await store.loadReplay('run_1', Replay, Sim);
    assert.strictEqual(loaded.ok, true);
    assert.strictEqual(loaded.header.finalTick, env.finalTick);
    return `IDB persisted (putCount=1), persistCalls=${persistCalls}, loaded OK`;
  });

  // ST-02 & ST-03: Blocked IDB & QuotaExceeded fallback to memory without crash
  await runTest('M4-S2-ST02-03', 'Blocked IndexedDB (SecurityError) & QuotaExceeded fall back cleanly to memory (ST-02/03)', async () => {
    const env = makeSampleEnvelope(2002);
    for (const mode of ['blocked', 'quota']) {
      const store = ReplayStore.createReplayStore({ indexedDB: createMockIndexedDB(mode), navigator: null });
      const res = await store.saveReplay('run_' + mode, env);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.fallback, true);
      assert.strictEqual(store.getStatus().usingMemoryFallback, true);
      const loaded = await store.loadReplay('run_' + mode, Replay, Sim);
      assert.strictEqual(loaded.ok, true, `${mode} fallback must still load current run`);
    }
    return 'Blocked & QuotaExceeded both fell back cleanly without losing current run';
  });

  // ST-04 & ST-05: Corrupted record & simVersion/botHash mismatch refused cleanly
  await runTest('M4-S2-ST04-05', 'Corrupted record & simVersion/botHash mismatch refused cleanly (ST-04/05)', async () => {
    const idb = createMockIndexedDB('normal');
    idb.putRaw('corrupt_1', { runId: 'corrupt_1', envelope: { bad: 'schema' } });
    const badVer = makeSampleEnvelope(3003);
    badVer.simVersion = '2.5.1';
    badVer.integrityHash = Replay.computeIntegrityHash(badVer);
    idb.putRaw('old_ver', { runId: 'old_ver', envelope: badVer });

    const store = ReplayStore.createReplayStore({ indexedDB: idb, navigator: null });
    const r1 = await store.loadReplay('corrupt_1', Replay, Sim);
    assert.strictEqual(r1.ok, false);
    const r2 = await store.loadReplay('old_ver', Replay, Sim);
    assert.strictEqual(r2.ok, false);
    assert(r2.error.includes('Incompatible simVersion'));
    return 'Corrupted & version-mismatched records cleanly refused';
  });

  // ST-06: Garbage collection keeps Top 10 referenced runs + latest run, deletes unreferenced
  await runTest('M4-S2-ST06', 'GC deletes unreferenced replays while retaining Top 10 & latest run (ST-06)', async () => {
    const idb = createMockIndexedDB('normal');
    const store = ReplayStore.createReplayStore({ indexedDB: idb, navigator: null });
    const env = makeSampleEnvelope(4004);
    await store.saveReplay('top_1', env);
    await store.saveReplay('latest_run', env);
    await store.saveReplay('orphan_1', env);
    await store.saveReplay('orphan_2', env);
    const gcRes = await store.gcReplays(new Set(['top_1', 'latest_run']));
    assert(gcRes.removed >= 2);
    assert.strictEqual(store.hasReplaySync('top_1'), true);
    assert.strictEqual(store.hasReplaySync('latest_run'), true);
    assert.strictEqual(store.hasReplaySync('orphan_1'), false);
    assert.strictEqual(store.hasReplaySync('orphan_2'), false);
    assert.deepStrictEqual(idb.getKeys().sort(), ['latest_run', 'top_1']);
    return 'GC removed 2 unreferenced replays; retained top_1 & latest_run';
  });

  // TC-37: Replay UX in built index.html (input lock, zero score mutation, instant EXIT back to scores, mismatch refusal)
  await runTest('M4-S2-TC37', 'Replay UX: input lock, zero score mutation, instant EXIT to scores & mismatch refusal (TC-37)', async () => {
    const { p, elements, window } = createBrowserEnv();
    // 1. Play a live Villain run until game over (records replay automatically)
    p.fn.startGame('villain', 1001);
    p.fn.startJump();
    p.fn.stepActiveSim();
    p.fn.endJump();
    for (let t = 0; t < 200 && p.getState().gameState === 'playing'; t++) p.fn.stepActiveSim();
    const afterLive = p.getState();
    assert.strictEqual(afterLive.gameState, 'over');
    assert.strictEqual(afterLive.scores.villain.byScore.length, 1);
    const runId = afterLive.lastRunId;
    assert(runId, 'Expected lastRunId after live run');

    // 2. Watch replay -> verify REPLAY badge, input lock, and instant Escape/EXIT back to scores
    p.fn.openScoresModal('villain');
    await p.fn.watchReplayByRunId(runId);
    const midReplay = p.getState();
    assert.strictEqual(midReplay.isReplaying, true);
    assert.strictEqual(midReplay.replayBadgeDisplay, 'flex');

    // Human Space press must be ignored during replay
    window.dispatchEvent({ type: 'keydown', code: 'Space', key: ' ', repeat: false });
    assert.strictEqual(p.getState().player.onGround, true, 'Human jump must be locked during replay');

    // Instant EXIT via exitBtn -> returns straight to scoresModal with zero exitModal warning
    elements.exitBtn.click();
    const afterExit = p.getState();
    assert.strictEqual(afterExit.isReplaying, false);
    assert.strictEqual(afterExit.exitModalDisplay, 'none');
    assert.strictEqual(afterExit.scoresModalDisplay, 'flex');

    // 3. Run full replay to completion -> must NOT add a 2nd leaderboard entry
    await p.fn.watchReplayByRunId(runId);
    for (let t = 0; t < 200 && p.getState().gameState === 'playing'; t++) p.fn.stepActiveSim();
    const afterDone = p.getState();
    assert.strictEqual(afterDone.gameOverTitle, 'REPLAY COMPLETE');
    assert.strictEqual(afterDone.scores.villain.byScore.length, 1, 'Replay must never mutate leaderboard');

    // 4. Version-mismatched replay refused with clear inline message
    const badEnv = makeSampleEnvelope(999);
    badEnv.simVersion = '0.0.1';
    badEnv.integrityHash = Replay.computeIntegrityHash(badEnv);
    await p.fn.replayStore.saveReplay('bad_ver_run', badEnv);
    await p.fn.watchReplayByRunId('bad_ver_run');
    assert(p.getState().scoresStatusText.includes('Replay unavailable'), 'Expected clear version-mismatch message');

    return 'Input lock, zero score mutation, instant EXIT to scores, and mismatch banner verified';
  });

  // Deduplication & Hygiene check
  await runTest('M4-S2-DEDUP-HYGIENE', 'Template deduplicated onto SpikeSprintSim; zero external requests & zero Drive URLs', () => {
    const tmpl = fs.readFileSync(path.join(ROOT, 'src', 'template.html'), 'utf8');
    assert(!tmpl.includes('function rlBotUpdate('), 'Duplicate rlBotUpdate still in template.html');
    assert(!tmpl.includes('function buildRlObservation('), 'Duplicate buildRlObservation still in template.html');
    assert(!tmpl.includes('function update(dt){'), 'Duplicate update(dt) still in template.html');
    assert(!/<script[^>]+src\s*=/i.test(htmlText), 'Found external <script src>');
    assert(!/\bfetch\s*\(/.test(htmlText), 'Found fetch()');
    assert(!/(drive|docs)\.google\.com/i.test(htmlText), 'Found Google Drive URL in built index.html');
    return `Template deduplicated; built index.html = ${htmlBuf.length} bytes (${(htmlBuf.length / 1024).toFixed(2)} KB)`;
  });

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('========================================================================');
  console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
