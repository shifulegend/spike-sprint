#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — v2.6 Regression Tests (Issues #3, #4, #5)
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Could not extract <script> from index.html');
const BUILT_SCRIPT = scriptMatch[1];

function createDomEnv() {
  const elements = {};
  const winListeners = {};
  const docListeners = {};

  class El {
    constructor(id, tag = 'DIV') {
      this.id = id;
      this.tagName = tag;
      this.style = { display: '', setProperty() {} };
      this.value = '';
      this.textContent = '';
      this.disabled = false;
      this.children = [];
      this._listeners = {};
      this._attrs = {};
      const clsSet = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => clsSet.add(x)),
        remove: (...c) => c.forEach((x) => clsSet.delete(x)),
        contains: (c) => clsSet.has(c),
        toggle: (c, f) => (f === undefined ? (clsSet.has(c) ? clsSet.delete(c) : clsSet.add(c)) : (f ? clsSet.add(c) : clsSet.delete(c))),
      };
    }
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
    dispatch(ev, payload) { (this._listeners[ev] || []).forEach((fn) => fn(payload)); }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return this._attrs[k] ?? null; }
    appendChild(child) { this.children.push(child); return child; }
    focus() { sandbox.document.activeElement = this; }
    querySelectorAll() {
      if (this.id === 'loreCard') return [getEl('loreCloseBtn', 'BUTTON')];
      if (this.id === 'exitModal') return [getEl('resumeRunBtn', 'BUTTON'), getEl('confirmExitBtn', 'BUTTON')];
      if (this.id === 'scoresModal') return [getEl('closeScoresBtn', 'BUTTON')];
      return [];
    }
    getContext() {
      return {
        clearRect() {}, fillRect() {}, save() {}, restore() {},
        scale() {}, translate() {}, beginPath() {}, rect() {}, clip() {},
        ellipse() {}, fill() {}, arc() {},
      };
    }
  }

  function getEl(id, tag) {
    if (!elements[id]) elements[id] = new El(id, tag || (id === 'gameCanvas' ? 'CANVAS' : 'DIV'));
    return elements[id];
  }

  // Pre-register key interactive elements
  ['loreCloseBtn', 'resumeRunBtn', 'confirmExitBtn', 'closeScoresBtn', 'openScoresStartBtn', 'openScoresEndBtn', 'exitBtn', 'storyToggle', 'playVillainBtn', 'playHeroBtn'].forEach((id) => getEl(id, 'BUTTON'));
  ['startNameInput', 'endNameInput'].forEach((id) => getEl(id, 'INPUT'));

  const sandbox = {
    console, Math, Date, JSON, Number, String, Boolean, Array, Object, Set, Map,
    Uint8Array, ArrayBuffer, Promise, Error, TypeError, setTimeout, clearTimeout,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    performance: { now: () => 1000 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: {},
    document: {
      hidden: false,
      activeElement: null,
      getElementById: (id) => getEl(id),
      createElement: (tag) => new El('', tag.toUpperCase()),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    },
    addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(BUILT_SCRIPT, ctx);
  return { ctx, sandbox, getEl, winListeners };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

// Issue #3: Spacebar inside open modals (#loreCard, #exitModal, #scoresModal) must not be preventDefault()'d
test('Issue #3: Spacebar inside #loreCard, #exitModal, and #scoresModal does not call preventDefault()', () => {
  const { ctx, getEl, winListeners } = createDomEnv();

  function assertSpaceAllowed(label) {
    let kdPrevented = false;
    (winListeners.keydown || []).forEach((fn) =>
      fn({ key: ' ', code: 'Space', repeat: false, preventDefault() { kdPrevented = true; } })
    );
    assert.strictEqual(kdPrevented, false, `keydown Space inside ${label} must not preventDefault()`);

    let kuPrevented = false;
    (winListeners.keyup || []).forEach((fn) =>
      fn({ key: ' ', code: 'Space', preventDefault() { kuPrevented = true; } })
    );
    assert.strictEqual(kuPrevented, false, `keyup Space inside ${label} must not preventDefault()`);
  }

  getEl('loreCard').style.display = 'block';
  getEl('loreCloseBtn').focus();
  assertSpaceAllowed('#loreCard');
  getEl('loreCard').style.display = 'none';

  vm.runInContext(`startGame('villain', 555);`, ctx);
  getEl('exitBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('exitModal').style.display, 'flex');
  assertSpaceAllowed('#exitModal');
  getEl('resumeRunBtn').dispatch('click', { stopPropagation() {} });

  getEl('openScoresStartBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('scoresModal').style.display, 'flex');
  assertSpaceAllowed('#scoresModal');
});

// Issue #5: Replay EXIT -> CLOSE Scores restores originating screen & focus, and clears stale origin on mode change
test('Issue #5: Replay EXIT -> CLOSE Scores restores originating screen/focus and resets stale origin', () => {
  const { ctx, sandbox, getEl } = createDomEnv();
  vm.runInContext(`
    startGame('villain', 1234);
    for (let i = 0; i < 6000 && gameState === 'playing'; i++) stepActiveSim();
    if (gameState === 'playing') endGame('pit');
  `, ctx);

  assert.strictEqual(getEl('gameOverScreen').style.display, 'flex');
  getEl('openScoresEndBtn').focus();
  getEl('openScoresEndBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('scoresModal').style.display, 'flex');

  // Start replay from Game Over -> Scores, then exit back to Scores and close
  vm.runInContext(`
    startReplay({
      header: { modeKey: 'villain', heroDiff: null, seed: 1234, finalTick: 60 },
      events: []
    });
  `, ctx);
  assert.strictEqual(getEl('gameOverScreen').style.display, 'none');

  getEl('exitBtn').focus();
  vm.runInContext(`openPauseModal();`, ctx);
  assert.strictEqual(getEl('scoresModal').style.display, 'flex');

  getEl('closeScoresBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('scoresModal').style.display, 'none');
  assert.strictEqual(getEl('gameOverScreen').style.display, 'flex', '#gameOverScreen should be restored');
  assert.strictEqual(sandbox.document.activeElement.id, 'openScoresEndBtn', 'focus should return to #openScoresEndBtn');

  // Return to Start Screen via Change Mode, open Scores with 1-arg call, close -> must stay on #startScreen
  getEl('changeModeBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('startScreen').style.display, 'flex');
  getEl('openScoresStartBtn').focus();
  vm.runInContext(`openScoresModal('villain');`, ctx);
  getEl('closeScoresBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('startScreen').style.display, 'flex', 'must remain on #startScreen without stale over origin');
  assert.strictEqual(getEl('gameOverScreen').style.display, 'none');

  // Start-origin replay -> exit -> close restores #startScreen and #openScoresStartBtn
  getEl('openScoresStartBtn').dispatch('click', { stopPropagation() {} });
  vm.runInContext(`
    startReplay({
      header: { modeKey: 'villain', heroDiff: null, seed: 1234, finalTick: 60 },
      events: []
    });
  `, ctx);
  getEl('exitBtn').focus();
  vm.runInContext(`openPauseModal();`, ctx);
  getEl('closeScoresBtn').dispatch('click', { stopPropagation() {} });
  assert.strictEqual(getEl('startScreen').style.display, 'flex');
  assert.strictEqual(sandbox.document.activeElement.id, 'openScoresStartBtn');
});

// Issue #4: Villain mode Game Over screen must display death cause flavor text (#endFlavor)
test('Issue #4: Villain mode Game Over displays #endFlavor death cause for pit/enemy/barrel', () => {
  const { ctx, getEl } = createDomEnv();
  for (const cause of ['pit', 'enemy', 'barrel']) {
    vm.runInContext(`startGame('villain', 100); endGame(${JSON.stringify(cause)});`, ctx);
    const flavor = getEl('endFlavor');
    assert.ok(flavor.textContent && flavor.textContent.length > 0, `endFlavor must be non-empty for ${cause}`);
    assert.strictEqual(flavor.style.display, 'block', `endFlavor must be visible for ${cause}`);
  }
});

// Issue #6: Start/GameOver overlay must allow vertical scrolling and compact short-viewport spacing
test('Issue #6: #startScreen/#gameOverScreen CSS supports overflow-y:auto and max-height compact layout', () => {
  assert.ok(/#startScreen,#gameOverScreen\{[^}]*overflow-y:auto/.test(html), 'overlay must set overflow-y:auto');
  assert.ok(/@media\s*\(max-height:\s*\d+px\)/.test(html), 'must include short-viewport max-height media query');
});

console.log(`Summary: ${passed}/${passed + failed} PASS`);
if (failed > 0) process.exit(1);
