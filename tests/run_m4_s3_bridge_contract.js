#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M4-S3 Optional External Bridge Contract (TC-39) & State Isolation (S-05) Suite
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const Bridge = require(path.join(ROOT, 'src', 'bridge', 'contract.js'));
const INDEX_PATH = path.join(ROOT, 'index.html');

const htmlBuf = fs.readFileSync(INDEX_PATH);
const htmlText = htmlBuf.toString('utf8');
const htmlSha = crypto.createHash('sha256').update(htmlBuf).digest('hex');
const BUILT_SCRIPT = htmlText.match(/<script>([\s\S]*?)<\/script>/)[1];

function createBrowserEnv(bridgeInit) {
  const elements = Object.create(null);

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
        toggle(x, f) {
          if (f === undefined) {
            if (this._s.has(x)) this._s.delete(x);
            else this._s.add(x);
          } else if (f) this._s.add(x);
          else this._s.delete(x);
        },
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

  const ids = [
    'gameCanvas', 'startScreen', 'gameOverScreen', 'heroControls', 'exitBtn',
    'exitModal', 'scoresModal', 'loreCard', 'loreBtn', 'loreCloseBtn',
    'scoresBtn', 'scoresCloseBtn', 'scoresTableWrap', 'scoresTabVillain',
    'scoresTabHero', 'scoresTabBest', 'scoresTabRecent', 'scoresReplayNotice',
    'replayBadge', 'exitConfirmBtn', 'exitCancelBtn', 'playVillainBtn',
    'playHeroBtn', 'restartBtn', 'changeModeBtn', 'gameOverTitle', 'endFlavor',
    'finalScore', 'playerNameStart', 'playerNameEnd', 'randNameStartBtn',
    'randNameEndBtn', 'scoreDisplay', 'bestDisplay', 'timeDisplay', 'hudModeLabel',
  ];
  for (const id of ids) {
    elements[id] = new El(id, id === 'gameCanvas' ? 'CANVAS' : 'DIV');
  }

  const storage = new Map();
  const localStorageMock = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Uint8Array,
    ArrayBuffer,
    Promise,
    Error,
    TypeError,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performance: { now: () => 1000 },
    innerWidth: 490,
    innerHeight: 720,
    devicePixelRatio: 1,
    localStorage: localStorageMock,
    navigator: {},
    document: {
      hidden: false,
      activeElement: null,
      getElementById: (id) => { if (!elements[id]) elements[id] = new El(id, id === "gameCanvas" ? "CANVAS" : "DIV"); return elements[id]; },
      createElement: (tag) => new El('', tag),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  if (typeof bridgeInit === 'function') {
    bridgeInit(sandbox);
  } else if (bridgeInit !== undefined) {
    sandbox.SPIKE_SPRINT_BRIDGE = bridgeInit;
  }

  const ctx = vm.createContext(sandbox);
  vm.runInContext(BUILT_SCRIPT, ctx);
  return { ctx, sandbox, elements };
}

function playLiveRunToEnd(ctx, modeKey = 'villain', seed = 4242) {
  vm.runInContext(`
    startGame(${JSON.stringify(modeKey)}, ${seed});
    for (let i = 0; i < 6000 && gameState === 'playing'; i++) {
      if (i === 20) { activeRecorder.startJump(); }
      if (i === 25) { activeRecorder.endJump(); }
      stepActiveSim();
    }
    if (gameState === 'playing') {
      endGame('cap');
    }
  `, ctx);
  return vm.runInContext(`({
    gameState,
    score: Math.floor(score),
    simTicks,
    lastRunId,
    gameOverVisible: document.getElementById('gameOverScreen').style.display === 'flex',
    lastBridgeResult: bridgeDispatcher.getLastResult()
  })`, ctx);
}

const results = [];
async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`PASS | ${name}`);
  } catch (err) {
    results.push({ name, pass: false, err });
    console.error(`FAIL | ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

(async function main() {
  let unhandledCount = 0;
  const onUnhandled = (reason) => {
    unhandledCount++;
    console.error('UNHANDLED REJECTION:', reason);
  };
  process.on('unhandledRejection', onUnhandled);

  console.log(`M4-S3 Bridge Contract & Isolation Suite | index.html SHA-256: ${htmlSha}`);

  // T1: TC-39a — No Bridge defined
  await runTest('T1 (TC-39a): No bridge defined — standalone offline play runs cleanly', async () => {
    const { ctx } = createBrowserEnv(undefined);
    const out = playLiveRunToEnd(ctx, 'villain', 1111);
    assert.strictEqual(out.gameState, 'over');
    assert.strictEqual(out.gameOverVisible, true);
    assert.ok(out.lastRunId, 'Expected lastRunId to be assigned');
    assert.strictEqual(out.lastBridgeResult.status, 'no-bridge');
    assert.strictEqual(out.lastBridgeResult.hook, 'onRunComplete');
  });

  // T2: TC-39b — Healthy sync & async mock bridge + replay playback suppression
  await runTest('T2 (TC-39b): Healthy mock bridge receives deep-frozen payloads; replays suppressed', async () => {
    const starts = [];
    const completes = [];
    const mockBridge = {
      onRunStart(payload) {
        starts.push(payload);
      },
      async onRunComplete(payload) {
        await new Promise((r) => setTimeout(r, 10));
        completes.push(payload);
      },
    };
    const { ctx } = createBrowserEnv(mockBridge);
    const out = playLiveRunToEnd(ctx, 'villain', 2222);
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(starts.length, 1, 'Expected 1 onRunStart call');
    assert.strictEqual(completes.length, 1, 'Expected 1 onRunComplete call');
    assert.strictEqual(starts[0].contractVersion, 1);
    assert.strictEqual(starts[0].modeKey, 'villain');
    assert.strictEqual(starts[0].seed, 2222);
    assert.strictEqual(completes[0].runId, out.lastRunId);
    assert.strictEqual(completes[0].score, out.score);
    assert.strictEqual(completes[0].totalTicks, out.simTicks);
    assert.ok(completes[0].replay && typeof completes[0].replay.eventsB64 === 'string', 'Expected string eventsB64');
    assert.ok(typeof completes[0].replay.integrityHash === 'string' && completes[0].replay.integrityHash.length === 16);

    // Watch the saved replay and confirm bridge hooks are NOT called during replay playback
    await vm.runInContext(`watchReplayByRunId(${JSON.stringify(out.lastRunId)})`, ctx);
    vm.runInContext(`
      for (let i = 0; i < 6000 && gameState === 'playing'; i++) {
        stepActiveSim();
      }
      if (gameState === 'playing') endGame('cap');
    `, ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(starts.length, 1, 'Replay must not trigger onRunStart');
    assert.strictEqual(completes.length, 1, 'Replay must not trigger onRunComplete');
  });

  // T3: TC-39c — Sync throwing bridge & hostile getters
  await runTest('T3 (TC-39c): Sync throwing hooks & hostile global/property getters contained', async () => {
    // 3a: Throwing hook functions
    const throwingBridge = {
      onRunStart() { throw new Error('sync start boom'); },
      onRunComplete() { throw new Error('sync complete boom'); },
    };
    const env1 = createBrowserEnv(throwingBridge);
    const out1 = playLiveRunToEnd(env1.ctx, 'villain', 3333);
    assert.strictEqual(out1.gameState, 'over');
    assert.strictEqual(out1.gameOverVisible, true);
    assert.strictEqual(out1.lastBridgeResult.status, 'sync-error');
    assert.ok(out1.lastBridgeResult.error.includes('sync complete boom'));

    // 3b: Hostile getter on window.SPIKE_SPRINT_BRIDGE
    const env2 = createBrowserEnv((sb) => {
      Object.defineProperty(sb, 'SPIKE_SPRINT_BRIDGE', {
        configurable: true,
        get() { throw new Error('hostile global getter'); },
      });
    });
    const out2 = playLiveRunToEnd(env2.ctx, 'villain', 3334);
    assert.strictEqual(out2.gameState, 'over');
    assert.strictEqual(out2.gameOverVisible, true);
    assert.strictEqual(out2.lastBridgeResult.status, 'sync-error');
    assert.ok(out2.lastBridgeResult.error.includes('hostile global getter'));

    // 3c: Hostile getter on hook property
    const env3 = createBrowserEnv({
      get onRunStart() { throw new Error('hostile hook getter'); },
      get onRunComplete() { throw new Error('hostile complete getter'); },
    });
    const out3 = playLiveRunToEnd(env3.ctx, 'villain', 3335);
    assert.strictEqual(out3.gameState, 'over');
    assert.strictEqual(out3.lastBridgeResult.status, 'sync-error');
  });

  // T4: TC-39d — Rejecting async bridge (zero unhandled rejections)
  await runTest('T4 (TC-39d): Rejecting async hooks produce zero unhandledRejection events', async () => {
    const before = unhandledCount;
    const rejectingBridge = {
      onRunStart() { return Promise.reject(new Error('async start reject')); },
      onRunComplete() { return Promise.reject(new Error('async complete reject')); },
    };
    const { ctx } = createBrowserEnv(rejectingBridge);
    const out = playLiveRunToEnd(ctx, 'villain', 4444);
    await new Promise((r) => setTimeout(r, 30));
    const finalRes = vm.runInContext('bridgeDispatcher.getLastResult()', ctx);
    assert.strictEqual(out.gameState, 'over');
    assert.strictEqual(out.gameOverVisible, true);
    assert.strictEqual(finalRes.status, 'async-error');
    assert.ok(finalRes.error.includes('async complete reject'));
    assert.strictEqual(unhandledCount, before, 'Expected zero unhandled rejections');
  });

  // T5: TC-39e — Hanging async bridge bounded by timeout & non-blocking
  await runTest('T5 (TC-39e): Hanging async hooks time out cleanly without blocking gameplay', async () => {
    const fakeGlobal = {
      SPIKE_SPRINT_BRIDGE: {
        onRunStart() { return new Promise(() => {}); },
        onRunComplete() { return new Promise(() => {}); },
      },
    };
    const dispatcher = Bridge.createBridgeDispatcher({ globalObj: fakeGlobal, timeoutMs: 50 });
    const t0 = Date.now();
    const res = await dispatcher.notifyRunComplete({ simVersion: '2.6.0-sim1', seed: 5555, score: 120, elapsed: 2, totalTicks: 120, cause: 'spike' });
    const dt = Date.now() - t0;
    assert.strictEqual(res.status, 'timeout');
    assert.strictEqual(res.timeoutMs, 50);
    assert.ok(dt >= 40 && dt < 500, `Expected timeout near 50ms, got ${dt}ms`);

    // Also verify built index.html does not block startGame() / endGame() when bridge hangs
    const { ctx } = createBrowserEnv(fakeGlobal.SPIKE_SPRINT_BRIDGE);
    const startMs = Date.now();
    const out = playLiveRunToEnd(ctx, 'villain', 5556);
    const runMs = Date.now() - startMs;
    assert.strictEqual(out.gameState, 'over');
    assert.strictEqual(out.gameOverVisible, true);
    assert.ok(runMs < 1500, `Expected non-blocking run, took ${runMs}ms`);
  });

  // T6: S-05 — State & payload immutability isolation
  await runTest('T6 (S-05): Deep-frozen payloads reject mutation; TypedArrays/non-plain rejected; return values ignored', async () => {
    assert.throws(() => Bridge.deepCloneFreeze({ buf: new Uint8Array([1, 2, 3]) }), TypeError);
    assert.throws(() => Bridge.deepCloneFreeze({ fn: () => {} }), TypeError);
    assert.throws(() => Bridge.deepCloneFreeze({ d: new Date() }), TypeError);

    let startFrozen = false;
    let completeFrozen = false;
    let replayFrozen = false;
    let mutationThrew = false;
    let nestedMutationThrew = false;

    const hostileBridge = {
      onRunStart(payload) {
        'use strict';
        startFrozen = Object.isFrozen(payload);
        try { payload.seed = 999999; } catch (_) { mutationThrew = true; }
        return { seed: 1, modeKey: 'hero' };
      },
      onRunComplete(payload) {
        'use strict';
        completeFrozen = Object.isFrozen(payload);
        replayFrozen = payload.replay ? Object.isFrozen(payload.replay) : false;
        try { payload.replay.finalScore = 999999; } catch (_) { nestedMutationThrew = true; }
        return { score: 999999, cause: 'forged' };
      },
    };

    const { ctx } = createBrowserEnv(hostileBridge);
    const out = playLiveRunToEnd(ctx, 'villain', 6666);
    const storedReplay = await vm.runInContext(`replayStore.loadReplay(${JSON.stringify(out.lastRunId)}, SpikeSprintReplay, SpikeSprintSim)`, ctx);

    assert.strictEqual(startFrozen, true, 'onRunStart payload must be frozen');
    assert.strictEqual(completeFrozen, true, 'onRunComplete payload must be frozen');
    assert.strictEqual(replayFrozen, true, 'nested replay payload must be frozen');
    assert.strictEqual(mutationThrew, true, 'Mutating top-level payload must throw in strict mode');
    assert.strictEqual(nestedMutationThrew, true, 'Mutating nested replay payload must throw in strict mode');
    assert.notStrictEqual(out.score, 999999, 'Bridge return value must not alter game score');
    assert.strictEqual(storedReplay.ok, true, 'Stored replay must remain valid and intact');
    assert.strictEqual(storedReplay.header.finalScore, out.score, 'Stored replay score must match real run');
  });

  process.removeListener('unhandledRejection', onUnhandled);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} PASS | Unhandled Rejections: ${unhandledCount}`);
  if (passed !== results.length || unhandledCount > 0) {
    process.exit(1);
  }
  process.exit(0);
})();
