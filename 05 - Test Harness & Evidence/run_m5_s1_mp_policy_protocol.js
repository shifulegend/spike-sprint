#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M5-S1 Multiplayer Policy Lock, Pure Sim MP Seam & Protocol Contract Suite
 * Covers Doc 13 §11 policy lock, MP-02, MP-06, MP-11, M17, and pure-sim determinism.
 * Zero external dependencies (Node.js built-ins only).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const Sim = require(path.join(ROOT, 'src', 'sim', 'core.js'));
const Mp = require(path.join(ROOT, 'src', 'mp', 'protocol.js'));

const results = [];
function runTest(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`PASS | ${name}`);
  } catch (err) {
    results.push({ name, pass: false, err });
    console.error(`FAIL | ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

const coreSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src', 'sim', 'core.js'))).digest('hex');
const mpSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src', 'mp', 'protocol.js'))).digest('hex');
console.log(`M5-S1 Policy & Protocol Suite | Node ${process.version}`);
console.log(`core.js SHA-256: ${coreSha}`);
console.log(`protocol.js SHA-256: ${mpSha}`);

// T1: Owner-locked Doc 13 §11 policy constants
runTest('T1 (Doc 13 §11): Frozen MP_POLICY matches all owner-locked decisions', () => {
  const P = Mp.MP_POLICY;
  assert.strictEqual(Object.isFrozen(P), true);
  assert.strictEqual(P.protocolVersion, 1);
  assert.strictEqual(P.rulesetVersion, 'mp-1.0');
  assert.strictEqual(P.maxPlayers, 2);
  assert.strictEqual(P.roundsPerMatch, 2);
  assert.strictEqual(P.maxRoundTicks, 7200);
  assert.strictEqual(P.maxRoundSec, 120);
  assert.strictEqual(P.speedRampSec, 120);
  assert.strictEqual(P.heroCooldownPreset, 'hard');
  assert.strictEqual(P.heroCooldownScale, 0.75);
  assert.strictEqual(P.pairingToResultBudgetMs, 300000);
  assert.strictEqual(P.queueWaitLimitMs, 60000);
  assert.strictEqual(P.waitingRoomExpiryMs, 300000);
  assert.strictEqual(P.waitingExpiryAnchor, 'last_meaningful_action');
  assert.deepStrictEqual(Array.from(P.meaningfulLobbyActions), ['join', 'leave', 'ready']);
  assert.strictEqual(P.readyTimeoutMs, 15000);
  assert.strictEqual(P.countdownMs, 3000);
  assert.strictEqual(P.intermissionMs, 5000);
  assert.strictEqual(P.reconnectGraceTotalMs, 15000);
  assert.strictEqual(P.disconnectPolicy, 'freeze');
  assert.strictEqual(P.drawPolicy, 'exact_tick_draw');
  assert.strictEqual(P.aiPracticeScope, 'human_hero_vs_ai_villain');
  assert.strictEqual(P.ranked, false);
  assert.strictEqual(P.soloLeaderboardEligible, false);
});

// T2: Pure sim 'multiplayer' mode seam (dual human control, HARD 0.75x cooldown, 120s ramp, determinism)
runTest('T2 (MP Sim Seam): Simultaneous human Villain + Hero, HARD 0.75x cooldown, 120s 1x->3x ramp & determinism', () => {
  const simA = Sim.createSim({ modeKey: 'multiplayer', seed: 9001 });
  const simB = Sim.createSim({ modeKey: 'multiplayer', seed: 9001 });

  assert.strictEqual(simA.state.modeKey, 'multiplayer');
  assert.strictEqual(simA.state.heroDiff, 'hard');
  assert.strictEqual(simA.state.activeMode.cooldownScale, 0.75);
  assert.strictEqual(simA.state.activeMode.allowHumanJump, true);
  assert.strictEqual(simA.state.activeMode.showSpawnControls, true);
  assert.strictEqual(simA.state.activeMode.autoSpawn, false);
  assert.strictEqual(simA.state.activeMode.useRlRunner, false);

  // Confirm no auto-spawns occur over 300 ticks when Hero does nothing
  for (let i = 0; i < 300; i++) {
    simA.step();
    simB.step();
  }
  assert.strictEqual(simA.state.pits.length + simA.state.pipes.length + simA.state.enemies.length, 0);

  // Simultaneous human jump + human trap spawn
  assert.strictEqual(simA.startJump(), true);
  assert.strictEqual(simB.startJump(), true);
  assert.strictEqual(simA.triggerHeroSpawn('enemy'), true);
  assert.strictEqual(simB.triggerHeroSpawn('enemy'), true);
  // Cooldown must block immediate second spawn
  assert.strictEqual(simA.triggerHeroSpawn('pit'), false);
  assert.strictEqual(simA.state.enemies.length, 1);

  for (let i = 0; i < 6; i++) {
    simA.step();
    simB.step();
  }
  simA.endJump();
  simB.endJump();

  assert.deepStrictEqual(simA.getSnapshot(), simB.getSnapshot());

  // Verify 120s compressed speed ramp: at 60s (tick 3600) speedMult === 2.0, at 120s (tick 7200) speedMult === 3.0
  const rampSim = Sim.createSim({ modeKey: 'multiplayer', seed: 1234 });
  for (let i = 0; i < 3600; i++) rampSim.step();
  assert.ok(Math.abs(rampSim.state.speedMult - 2.0) < 1e-9, `Expected 2.0 at 60s, got ${rampSim.state.speedMult}`);
  for (let i = 0; i < 3599; i++) rampSim.step();
  assert.strictEqual(rampSim.state.gameState, 'playing');
  const lastRes = rampSim.step();
  assert.strictEqual(rampSim.state.simTicks, 7200);
  assert.ok(Math.abs(rampSim.state.speedMult - 3.0) < 1e-9, `Expected 3.0 at 120s, got ${rampSim.state.speedMult}`);
  assert.strictEqual(lastRes.stopCause, 'timeout');
  assert.strictEqual(rampSim.state.player.dead, false);
});

// T3: MP-02 exact last-tick death vs timeout ordering
runTest('T3 (MP-02): Exact 7,200-tick survival yields timeout; death on final tick records death cause', () => {
  // Case A: Survive all 7,200 ticks
  const surviveSim = Sim.createSim({ modeKey: 'multiplayer', seed: 777 });
  let res;
  for (let i = 0; i < 7200; i++) res = surviveSim.step();
  assert.strictEqual(surviveSim.state.simTicks, 7200);
  assert.strictEqual(surviveSim.state.gameState, 'over');
  assert.strictEqual(res.stopCause, 'timeout');
  assert.strictEqual(surviveSim.state.player.dead, false);

  // Case B: Force collision on exact final tick (tick 7,199 -> simTicks === 7,200)
  const deathSim = Sim.createSim({ modeKey: 'multiplayer', seed: 778 });
  for (let i = 0; i < 7199; i++) deathSim.step();
  assert.strictEqual(deathSim.state.gameState, 'playing');
  // Place a live Purple Hero right in front of the Villain so it collides on the 7,200th tick
  deathSim.state.enemies.push({
    x: deathSim.state.player.x + 2,
    y: deathSim.state.player.y,
    w: 44,
    h: 44,
    alive: true,
    stepPhase: 0,
    squishTimer: 0
  });
  const finalTickRes = deathSim.step();
  assert.strictEqual(deathSim.state.simTicks, 7200);
  assert.strictEqual(deathSim.state.gameState, 'over');
  assert.strictEqual(finalTickRes.stopCause, 'enemy', 'Death on final tick must win over timeout');
  assert.strictEqual(deathSim.state.player.dead, true);
});

// T4: MP-06 / M17 strict client input envelope validation
runTest('T4 (MP-06 / M17): Valid inputs pass; all 10 invalid/spoofed/oversized cases rejected', () => {
  const vCtx = { matchId: 'm_100', roundId: 1, connectionEpoch: 2, lastSequence: 10, role: 'villain' };
  const hCtx = { matchId: 'm_100', roundId: 1, connectionEpoch: 3, lastSequence: 5, role: 'hero' };

  const okJump = Mp.validateClientInputEnvelope({
    protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'jump_start', clientTs: 12345
  }, vCtx);
  assert.strictEqual(okJump.ok, true);
  assert.strictEqual(okJump.normalized.inputType, 'jump_start');

  const okTrap = Mp.validateClientInputEnvelope(JSON.stringify({
    protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 3, sequence: 6, inputType: 'spawn_trap', payload: { kind: 'pit' }
  }), hCtx);
  assert.strictEqual(okTrap.ok, true);
  assert.strictEqual(okTrap.normalized.payload.kind, 'pit');

  // 10 rejection cases
  const cases = [
    ['bad protocolVersion', { protocolVersion: 99, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'jump_start' }, vCtx, 'PROTOCOL_MISMATCH'],
    ['wrong matchId', { protocolVersion: 1, matchId: 'm_other', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'jump_start' }, vCtx, 'MATCH_MISMATCH'],
    ['stale roundId', { protocolVersion: 1, matchId: 'm_100', roundId: 0, connectionEpoch: 2, sequence: 11, inputType: 'jump_start' }, vCtx, 'ROUND_MISMATCH'],
    ['stale connectionEpoch', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 1, sequence: 11, inputType: 'jump_start' }, vCtx, 'EPOCH_MISMATCH'],
    ['duplicate sequence', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 10, inputType: 'jump_start' }, vCtx, 'INVALID_SEQUENCE'],
    ['Hero sending jump', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 3, sequence: 6, inputType: 'jump_start' }, hCtx, 'ROLE_FORBIDDEN'],
    ['Villain sending spawn_trap', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'spawn_trap', payload: { kind: 'pit' } }, vCtx, 'ROLE_FORBIDDEN'],
    ['invalid trap kind', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 3, sequence: 6, inputType: 'spawn_trap', payload: { kind: 'laser' } }, hCtx, 'INVALID_TRAP_KIND'],
    ['oversized >512B payload', JSON.stringify({ protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'jump_start', pad: 'x'.repeat(600) }), vCtx, 'PAYLOAD_TOO_LARGE'],
    ['forged authoritative score', { protocolVersion: 1, matchId: 'm_100', roundId: 1, connectionEpoch: 2, sequence: 11, inputType: 'jump_start', score: 99999 }, vCtx, 'FORBIDDEN_FIELD'],
  ];
  for (const [label, msg, ctx, expectedCode] of cases) {
    const r = Mp.validateClientInputEnvelope(msg, ctx);
    assert.strictEqual(r.ok, false, `Expected failure for ${label}`);
    assert.strictEqual(r.code, expectedCode, `Expected ${expectedCode} for ${label}, got ${r.code}`);
  }
});

// T5: MP-02 & MP-11 two-round outcome resolution & solo isolation
runTest('T5 (MP-02 / MP-11): Two-round survival comparator, exact-tick draws, forfeits & unranked flags', () => {
  const wA = Mp.resolveMatchOutcome({ seatA: 'p1', seatB: 'p2', seatAVillainTicks: 4200, seatBVillainTicks: 3100 });
  assert.strictEqual(wA.outcome, 'win');
  assert.strictEqual(wA.winnerSeatId, 'p1');
  assert.strictEqual(wA.ranked, false);
  assert.strictEqual(wA.soloLeaderboardEligible, false);

  const dEq = Mp.resolveMatchOutcome({ seatA: 'p1', seatB: 'p2', seatAVillainTicks: 2500, seatBVillainTicks: 2500 });
  assert.strictEqual(dEq.outcome, 'draw');
  assert.strictEqual(dEq.winnerSeatId, null);
  assert.strictEqual(dEq.reason, 'equal_survival_ticks');

  const dCap = Mp.resolveMatchOutcome({ seatA: 'p1', seatB: 'p2', seatAVillainTicks: 7200, seatBVillainTicks: 7200 });
  assert.strictEqual(dCap.outcome, 'draw');
  assert.strictEqual(dCap.reason, 'both_survived_timeout');

  const ff = Mp.resolveMatchOutcome({
    seatA: 'p1', seatB: 'p2', seatAVillainTicks: 1000, seatBVillainTicks: 0,
    terminalOverride: { type: 'forfeit', winnerSeatId: 'p1', reason: 'reconnect_grace_exhausted' }
  });
  assert.strictEqual(ff.outcome, 'forfeit');
  assert.strictEqual(ff.winnerSeatId, 'p1');
  assert.strictEqual(ff.ranked, false);
  assert.strictEqual(ff.soloLeaderboardEligible, false);

  const nc = Mp.resolveMatchOutcome({
    seatA: 'p1', seatB: 'p2', seatAVillainTicks: 1000, seatBVillainTicks: 500,
    terminalOverride: { type: 'no_contest', reason: 'both_disconnected' }
  });
  assert.strictEqual(nc.outcome, 'no_contest');
  assert.strictEqual(nc.winnerSeatId, null);
});

// T6: Purity & Drive-URL hygiene
runTest('T6 (Purity & Hygiene): Zero forbidden globals in core.js/protocol.js and zero Drive URLs', () => {
  const coreSrc = fs.readFileSync(path.join(ROOT, 'src', 'sim', 'core.js'), 'utf8');
  const mpSrc = fs.readFileSync(path.join(ROOT, 'src', 'mp', 'protocol.js'), 'utf8');
  for (const [name, src] of [['src/sim/core.js', coreSrc], ['src/mp/protocol.js', mpSrc]]) {
    assert.strictEqual(/Math\.random\s*\(|document\.|AudioContext|performance\.now|Date\.now|drive\.google\.com|docs\.google\.com/.test(src), false, `Forbidden token in ${name}`);
  }
});

const passed = results.filter((r) => r.pass).length;
console.log(`\nSummary: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
