#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M4-S1 Replay Engine & 1,000-Run Property Test Suite
 * Covers: TC-35, TC-36, TC-38, D-03 (1,000 random runs), D-04, D-06/D-07 purity, S-04, Doc 15 D03 bounds.
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const Sim = require(path.join(ROOT, 'src', 'sim', 'core.js'));
const Replay = require(path.join(ROOT, 'src', 'sim', 'replay.js'));
const replaySrc = fs.readFileSync(path.join(ROOT, 'src', 'sim', 'replay.js'), 'utf8');

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
console.log('Spike Sprint — M4-S1 Replay Engine & 1,000-Run Property Test Suite');
console.log(`Node: ${process.version} | SIM_VERSION: ${Sim.SIM_VERSION} | FORMAT_V: ${Replay.REPLAY_FORMAT_VERSION}`);
console.log('========================================================================');

// 1. Purity scan on src/sim/replay.js (D-06 / D-07)
runTest('M4-S1-PURITY', 'src/sim/replay.js has zero Math.random, DOM, window, wall-clock, audio, Buffer, or Drive URLs', () => {
  const forbidden = [
    ['Math.random', /\bMath\.random\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['performance', /\bperformance\b/],
    ['Date', /\bDate\b/],
    ['localStorage', /\blocalStorage\b/],
    ['AudioContext', /\bAudioContext\b/],
    ['fetch', /\bfetch\s*\(/],
    ['Buffer', /\bBuffer\b/],
    ['atob', /\batob\b/],
    ['btoa', /\bbtoa\b/],
    ['Google Drive URL', /(drive|docs)\.google\.com/i],
  ];
  for (const [label, re] of forbidden) {
    assert(!re.test(replaySrc), `Forbidden token "${label}" found in src/sim/replay.js`);
  }
  return `Zero forbidden tokens in src/sim/replay.js (${Buffer.byteLength(replaySrc, 'utf8')} bytes)`;
});

// 2. TC-35: Villain bit-exact live-vs-replay determinism
runTest('M4-S1-TC35', 'Villain live run matches deterministic replay bit-for-bit (TC-35)', () => {
  const rec = Replay.createRecorder({ modeKey: 'villain', seed: 1001 }, Sim);
  for (let t = 0; t < 600 && rec.sim.state.gameState === 'playing'; t++) {
    if (t === 55 || t === 140 || t === 230 || t === 340) rec.startJump();
    if (t === 61 || t === 148 || t === 235 || t === 346) rec.endJump();
    rec.step();
  }
  const env = rec.finalize();
  const ver = Replay.verifyReplay(env, Sim);
  assert.strictEqual(ver.ok, true, ver.error);
  assert.deepStrictEqual(ver.snapshot, rec.sim.getSnapshot());
  return `finalTick=${ver.finalTick}, score=${ver.finalScore}, cause=${ver.stopCause}, payload=${ver.rawBytes}B`;
});

// 3. TC-36: Hero + RL bot bit-exact determinism across all 4 tiers
runTest('M4-S1-TC36', 'Hero + DQN RL bot matches replay bit-for-bit across Easy/Normal/Hard/Insane (TC-36)', () => {
  const tiers = ['easy', 'normal', 'hard', 'insane'];
  const kinds = ['pit', 'bush', 'enemy'];
  const summary = [];
  for (let idx = 0; idx < tiers.length; idx++) {
    const tier = tiers[idx];
    const rec = Replay.createRecorder({ modeKey: 'hero', heroDiff: tier, seed: 2001 + idx }, Sim);
    let sp = 0;
    for (let t = 0; t < 1200 && rec.sim.state.gameState === 'playing'; t++) {
      if (rec.sim.state.heroCooldownRemaining === 0 && t >= 20) {
        rec.triggerHeroSpawn(kinds[sp % 3]);
        sp++;
      }
      rec.step();
    }
    const env = rec.finalize();
    const ver = Replay.verifyReplay(env, Sim);
    assert.strictEqual(ver.ok, true, `${tier}: ${ver.error}`);
    assert.deepStrictEqual(ver.snapshot, rec.sim.getSnapshot(), `${tier} snapshot mismatch`);
    summary.push(`${tier}(t=${ver.finalTick},ev=${env.eventCount},${ver.rawBytes}B)`);
  }
  return summary.join(', ');
});

// 4. D-03: 1,000-run randomized live-vs-replay property test (with random pause/blur CLEAR_HELD events)
runTest('M4-S1-D03', '1,000 randomized live-vs-replay runs (Villain + Hero + pause/blur CLEAR_HELD) match 100% (D-03)', () => {
  const propRng = Sim.createPrng(20261125);
  const tiers = ['easy', 'normal', 'hard', 'insane'];
  const kinds = ['pit', 'bush', 'enemy'];
  let villainRuns = 0, heroRuns = 0, pauseClears = 0;

  for (let i = 0; i < 1000; i++) {
    const isHero = propRng() < 0.5;
    const modeKey = isHero ? 'hero' : 'villain';
    const heroDiff = tiers[Math.floor(propRng() * 4)];
    const seed = (Math.floor(propRng() * 0xfffffffe) + 1) >>> 0;
    const maxTicks = 180 + Math.floor(propRng() * 240);

    const rec = Replay.createRecorder({ modeKey, heroDiff, seed }, Sim);
    for (let t = 0; t < maxTicks && rec.sim.state.gameState === 'playing'; t++) {
      const r = propRng();
      if (!isHero) {
        if (r < 0.04) rec.startJump();
        else if (r < 0.08) rec.endJump();
        else if (r < 0.095) {
          // Simulate pause/hidden-tab/blur while jump may be held
          if (rec.sim.state.jumpKeyDown) pauseClears++;
          rec.clearHeldOnPause();
        } else if (r < 0.10) {
          // Same-tick press+release (D-04)
          rec.startJump();
          rec.endJump();
        }
      } else {
        if (r < 0.05) rec.triggerHeroSpawn(kinds[Math.floor(propRng() * 3)]);
      }
      rec.step();
    }

    const env = rec.finalize();
    const ver = Replay.verifyReplay(env, Sim);
    assert.strictEqual(ver.ok, true, `Run #${i} (${modeKey}/${heroDiff}, seed=${seed}) failed: ${ver.error}`);
    assert.deepStrictEqual(ver.snapshot, rec.sim.getSnapshot(), `Run #${i} snapshot diverged`);
    if (isHero) heroRuns++; else villainRuns++;
  }
  return `1,000/1,000 PASS (Villain=${villainRuns}, Hero=${heroRuns}, pauseClears=${pauseClears})`;
});

// 5. TC-38: Replay byte sizes for 1-min, 5-min, and 10-min runs (Villain & Hero)
runTest('M4-S1-TC38', '1-min, 5-min, and 10-min encoded replay sizes within compact budget (TC-38)', () => {
  const durations = [
    ['1m', 3600],
    ['5m', 18000],
    ['10m', 36000],
  ];
  const sizes = [];
  for (const [label, ticks] of durations) {
    // Realistic Villain input stream (~1 jump/sec = 2 events/sec)
    const vEvents = [];
    for (let t = 30; t < ticks; t += 60) {
      vEvents.push({ tick: t, code: Replay.EVT.JUMP_DOWN });
      vEvents.push({ tick: t + 8, code: Replay.EVT.JUMP_UP });
    }
    const vRaw = Replay.encodeEvents(vEvents);
    const vB64 = Replay.encodeBytesToBase64(vRaw);
    const vDec = Replay.decodeEvents(Replay.decodeBase64ToBytes(vB64), vEvents.length);
    assert.strictEqual(vDec.ok, true);
    assert.strictEqual(vDec.events.length, vEvents.length);

    // Realistic Hero input stream (~2 traps/sec)
    const hEvents = [];
    for (let t = 20; t < ticks; t += 30) {
      hEvents.push({ tick: t, code: Replay.EVT.SPAWN_PIT + ((t / 30) % 3) });
    }
    const hRaw = Replay.encodeEvents(hEvents);
    const hB64 = Replay.encodeBytesToBase64(hRaw);
    const hDec = Replay.decodeEvents(Replay.decodeBase64ToBytes(hB64), hEvents.length);
    assert.strictEqual(hDec.ok, true);
    assert.strictEqual(hDec.events.length, hEvents.length);

    assert(vB64.length < 16384 && hB64.length < 16384, `Replay size unexpectedly large at ${label}`);
    sizes.push(`${label}:V=${vRaw.length}B(${vB64.length}b64)/H=${hRaw.length}B(${hB64.length}b64)`);
  }
  return sizes.join('; ');
});

// 6. S-04 & Doc 15 D03: Tamper, version/bot mismatch, and malformed varint rejection
runTest('M4-S1-S04', 'Tampered payload, score edit, version/bot mismatch, and truncated varint cleanly rejected (S-04)', () => {
  const rec = Replay.createRecorder({ modeKey: 'villain', seed: 555 }, Sim);
  rec.startJump(); rec.step(); rec.endJump();
  for (let t = 0; t < 150 && rec.sim.state.gameState === 'playing'; t++) rec.step();
  const valid = rec.finalize();
  assert.strictEqual(Replay.verifyReplay(valid, Sim).ok, true);

  // Score tamper
  const badScore = { ...valid, finalScore: valid.finalScore + 100 };
  assert.strictEqual(Replay.verifyReplay(badScore, Sim).ok, false);

  // Version mismatch
  const badVer = { ...valid, simVersion: '2.5.1' };
  badVer.integrityHash = Replay.computeIntegrityHash(badVer);
  assert.strictEqual(Replay.verifyReplay(badVer, Sim).ok, false);

  // Bot hash mismatch
  const badBot = { ...valid, botHashPrefix: '0000000000000000' };
  badBot.integrityHash = Replay.computeIntegrityHash(badBot);
  assert.strictEqual(Replay.verifyReplay(badBot, Sim).ok, false);

  // Unterminated varint byte (0x80)
  const badVarint = Replay.decodeEvents(new Uint8Array([0x80, 0x80]), 1);
  assert.strictEqual(badVarint.ok, false);

  // Oversized finalTick (> 72000)
  const badTicks = { ...valid, finalTick: 999999 };
  badTicks.integrityHash = Replay.computeIntegrityHash(badTicks);
  assert.strictEqual(Replay.decodeReplay(badTicks, Sim).ok, false);

  return 'All 5 tamper/mismatch/malformed cases cleanly rejected';
});

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log('========================================================================');
console.log(`SUMMARY: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log('========================================================================');
if (failed > 0) process.exit(1);
