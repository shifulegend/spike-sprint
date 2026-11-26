#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M5-S2 Private Rooms, Two-Round Engine & Colyseus Adapter Suite (Gate B)
 * Covers MP-01, MP-02, MP-04, MP-06, MP-09, MP-11, MP-12, M04, M05, M06, M15, M16, M17, M19.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const Sim = require(path.join(ROOT, 'src', 'sim', 'core.js'));
const Mp = require(path.join(ROOT, 'src', 'mp', 'protocol.js'));
const RoomEngine = require(path.join(ROOT, 'src', 'mp', 'room_engine.js'));
const { createWsPrivateServer } = require(path.join(ROOT, 'server', 'ws_private_server.js'));
const { createSpikeSprintRoomClass } = require(path.join(ROOT, 'server', 'colyseus', 'SpikeSprintRoom.js'));

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

function advanceRoomUntil(engine, startMs, targetStates, maxSteps = 20000, stepMs = 1000 / 60) {
  let t = startMs;
  for (let i = 0; i < maxSteps; i++) {
    t += stepMs;
    const res = engine.stepTick(t);
    if (targetStates.includes(res.state)) return { t, res };
  }
  throw new Error('Did not reach target state(s) ' + targetStates.join(',') + '; stuck in ' + engine.getPublicSnapshot().state);
}

(async function main() {
  console.log(`M5-S2 Private Rooms & Two-Round Match Suite (Gate B) | Node ${process.version}`);

  // T1: MP-01 & M15 — Full two-round private match with role swap & late Round-1 packet rejection
  await runTest('T1 (MP-01 / M15): Two-round private match, role swap, queue flush & late Round-1 packet rejected', async () => {
    const engine = RoomEngine.createPrivateRoomEngine({ matchSeed: 100, createdAtMs: 0 });
    const a = engine.joinSeat({ playerId: 'alice', displayName: 'ALICE', nowMs: 100 });
    const b = engine.joinSeat({ playerId: 'bob', displayName: 'BOB', nowMs: 200 });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, true);
    assert.strictEqual(engine.getPublicSnapshot().state, 'ready_check');

    assert.strictEqual(engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 300 }).ok, true);
    const rdyB = engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 400 });
    assert.strictEqual(rdyB.state, 'countdown_1');

    // Advance past 3s countdown into round_1
    let { t } = advanceRoomUntil(engine, 400, ['round_1']);
    const snap1 = engine.getPublicSnapshot();
    const r1Villain = snap1.seats.seatA.role === 'villain' ? a : b;
    const r1Hero = snap1.seats.seatA.role === 'hero' ? a : b;
    assert.notStrictEqual(r1Villain.seatId, r1Hero.seatId);

    // Round 1: Hero spawns an enemy immediately; Villain does NOT jump -> dies quickly
    let hSeq = 1;
    let vSeq = 1;
    const sp1 = engine.submitInput({
      seatId: r1Hero.seatId, seatToken: r1Hero.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: hSeq++, inputType: 'spawn_trap', payload: { kind: 'enemy' } }
    });
    assert.strictEqual(sp1.ok, true);

    ({ t } = advanceRoomUntil(engine, t, ['intermission']));
    const afterR1 = engine.getPublicSnapshot();
    assert.ok(afterR1.round1.survivalTicks > 0 && afterR1.round1.survivalTicks < 400, 'Expected early R1 death');
    assert.strictEqual(afterR1.round1.stopCause, 'enemy');

    // Advance past 5s intermission + 3s countdown into round_2 (roles must swap!)
    ({ t } = advanceRoomUntil(engine, t, ['round_2']));
    const snap2 = engine.getPublicSnapshot();
    assert.strictEqual(snap2.roundId, 2);
    assert.strictEqual(snap2.seats[r1Villain.seatId].role, 'hero', 'Roles must swap for round 2');
    assert.strictEqual(snap2.seats[r1Hero.seatId].role, 'villain', 'Roles must swap for round 2');

    // M15: Late Round-1 packet sent in Round 2 MUST be rejected
    const staleR1 = engine.submitInput({
      seatId: r1Villain.seatId, seatToken: r1Villain.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: vSeq++, inputType: 'jump_start' }
    });
    assert.strictEqual(staleR1.ok, false);
    assert.strictEqual(staleR1.code, 'ROUND_MISMATCH');

    // Round 2: New Hero does nothing -> new Villain survives full 7,200 ticks (timeout) and wins
    ({ t } = advanceRoomUntil(engine, t, ['result']));
    const finalSnap = engine.getPublicSnapshot();
    assert.strictEqual(finalSnap.outcome.outcome, 'win');
    assert.strictEqual(finalSnap.outcome.winnerSeatId, r1Hero.seatId);
    assert.strictEqual(finalSnap.round2.survivalTicks, 7200);
    assert.strictEqual(finalSnap.round2.stopCause, 'timeout');
  });

  // T2: MP-02 & M16 — Both-survive draw + idempotent terminal commit under leave race
  await runTest('T2 (MP-02 / M16): Both-survive 7,200-tick draw & idempotent terminal commit under race', async () => {
    const engine = RoomEngine.createPrivateRoomEngine({ matchSeed: 202, createdAtMs: 0 });
    const a = engine.joinSeat({ playerId: 'p1', nowMs: 10 });
    const b = engine.joinSeat({ playerId: 'p2', nowMs: 20 });
    engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 30 });
    engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 40 });

    let { t } = advanceRoomUntil(engine, 40, ['result'], 25000);
    const snap = engine.getPublicSnapshot();
    assert.strictEqual(snap.outcome.outcome, 'draw');
    assert.strictEqual(snap.outcome.reason, 'both_survived_timeout');
    assert.strictEqual(snap.outcome.winnerSeatId, null);
    assert.strictEqual(snap.round1.survivalTicks, 7200);
    assert.strictEqual(snap.round2.survivalTicks, 7200);

    // M16: Leave after result must NOT overwrite draw with forfeit
    const lateLeave = engine.leaveSeat({ seatId: a.seatId, seatToken: a.seatToken, nowMs: t + 10 });
    assert.strictEqual(lateLeave.idempotent, true);
    assert.strictEqual(engine.getPublicSnapshot().outcome.outcome, 'draw');
  });

  // T3: MP-04 & M06 — Heartbeat-immune 5-min waiting expiry, 15s ready timeout & 5-min session deadline
  await runTest('T3 (MP-04 / M06): Heartbeat-immune 5-min waiting expiry, 15s ready timeout & 5-min hard deadline', async () => {
    // 3a: Waiting expiry anchored to last meaningful action; heartbeats do NOT reset expiry
    const e1 = RoomEngine.createPrivateRoomEngine({ matchSeed: 301, createdAtMs: 0 });
    const a1 = e1.joinSeat({ playerId: 'solo_host', nowMs: 1000 });
    assert.strictEqual(a1.ok, true);
    // Heartbeat at 4 min does NOT reset waiting clock
    assert.strictEqual(e1.recordHeartbeat(241000).state, 'waiting');
    // Meaningful action (ready toggle) at 4 min DOES reset waiting clock
    assert.strictEqual(e1.setReady({ seatId: a1.seatId, seatToken: a1.seatToken, ready: true, nowMs: 241000 }).ok, true);
    // At 305s (only 64s after ready toggle), still waiting
    assert.strictEqual(e1.recordHeartbeat(305000).state, 'waiting');
    // At 241000 + 300000 = 541000ms, expires cleanly
    assert.strictEqual(e1.recordHeartbeat(541000).state, 'expired');

    // 3b: 15s ready timeout aborts without game result (M07)
    const e2 = RoomEngine.createPrivateRoomEngine({ matchSeed: 302, createdAtMs: 0 });
    const a2 = e2.joinSeat({ playerId: 'u1', nowMs: 100 });
    e2.joinSeat({ playerId: 'u2', nowMs: 200 });
    e2.setReady({ seatId: a2.seatId, seatToken: a2.seatToken, ready: true, nowMs: 500 });
    assert.strictEqual(e2.checkDeadlines(15199), 'ready_check');
    assert.strictEqual(e2.checkDeadlines(15200), 'aborted');
    assert.strictEqual(e2.getPublicSnapshot().outcome, null);

    // 3c: 5-min pairing-to-result hard deadline triggers no_contest
    const e3 = RoomEngine.createPrivateRoomEngine({ matchSeed: 303, createdAtMs: 0 });
    const a3 = e3.joinSeat({ playerId: 'x1', nowMs: 100 });
    const b3 = e3.joinSeat({ playerId: 'x2', nowMs: 200 });
    e3.setReady({ seatId: a3.seatId, seatToken: a3.seatToken, ready: true, nowMs: 300 });
    e3.setReady({ seatId: b3.seatId, seatToken: b3.seatToken, ready: true, nowMs: 400 });
    e3.stepTick(400 + 300000);
    assert.strictEqual(e3.getPublicSnapshot().state, 'result');
    assert.strictEqual(e3.getPublicSnapshot().outcome.outcome, 'no_contest');
    assert.strictEqual(e3.getPublicSnapshot().outcome.reason, 'session_deadline_exceeded');
  });

  // T4: MP-09, M04, M05, M17, MP-06 — Atomic 2-seat lock, self-pair prevention, seatToken auth & anti-cheat
  await runTest('T4 (MP-09 / M04 / M05 / M17): Atomic 2-seat lock, self-pair block, seatToken auth & forged input rejection', async () => {
    const engine = RoomEngine.createPrivateRoomEngine({ matchSeed: 404, createdAtMs: 0 });
    const a = engine.joinSeat({ playerId: 'same_user', nowMs: 10 });
    const dup = engine.joinSeat({ playerId: 'same_user', nowMs: 20 });
    assert.strictEqual(dup.ok, false);
    assert.strictEqual(dup.code, 'SELF_PAIR_FORBIDDEN');

    const b = engine.joinSeat({ playerId: 'second_user', nowMs: 30 });
    assert.strictEqual(b.ok, true);

    const third = engine.joinSeat({ playerId: 'intruder', nowMs: 40 });
    assert.strictEqual(third.ok, false);
    assert.strictEqual(third.code, 'ROOM_FULL');

    // Forged seatToken rejected
    const badToken = engine.setReady({ seatId: a.seatId, seatToken: '0000000000000000', ready: true, nowMs: 50 });
    assert.strictEqual(badToken.ok, false);
    assert.strictEqual(badToken.code, 'UNAUTHORIZED');

    // Start round 1 and verify wrong-role + forged-score inputs rejected
    engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 60 });
    engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 70 });
    const { t } = advanceRoomUntil(engine, 70, ['round_1']);
    const snap = engine.getPublicSnapshot();
    const heroSeat = snap.seats.seatA.role === 'hero' ? a : b;
    const villainSeat = snap.seats.seatA.role === 'villain' ? a : b;

    const wrongRole = engine.submitInput({
      seatId: heroSeat.seatId, seatToken: heroSeat.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 1, inputType: 'jump_start' }
    });
    assert.strictEqual(wrongRole.ok, false);
    assert.strictEqual(wrongRole.code, 'ROLE_FORBIDDEN');

    const forged = engine.submitInput({
      seatId: villainSeat.seatId, seatToken: villainSeat.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 1, inputType: 'jump_start', score: 99999 }
    });
    assert.strictEqual(forged.ok, false);
    assert.strictEqual(forged.code, 'FORBIDDEN_FIELD');
  });

  // T5: MP-12, MP-11, M19 — Bit-exact offline 2-round trace replay, solo isolation & zero token leaks
  await runTest('T5 (MP-12 / MP-11 / M19): Offline 2-round trace replays bit-for-bit; zero seatToken leaks; unranked', async () => {
    const engine = RoomEngine.createPrivateRoomEngine({ matchSeed: 505, createdAtMs: 0 });
    const a = engine.joinSeat({ playerId: 'alice', nowMs: 10 });
    const b = engine.joinSeat({ playerId: 'bob', nowMs: 20 });
    engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 30 });
    engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 40 });

    // Confirm neither seatToken appears in public snapshot
    const pubJson = JSON.stringify(engine.getPublicSnapshot());
    assert.strictEqual(pubJson.includes(a.seatToken), false, 'seatA token leaked in snapshot');
    assert.strictEqual(pubJson.includes(b.seatToken), false, 'seatB token leaked in snapshot');

    let { t } = advanceRoomUntil(engine, 40, ['round_1']);
    const s1 = engine.getPublicSnapshot();
    const h1 = s1.seats.seatA.role === 'hero' ? a : b;
    const v1 = s1.seats.seatA.role === 'villain' ? a : b;
    engine.submitInput({
      seatId: v1.seatId, seatToken: v1.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 1, inputType: 'jump_start' }
    });
    engine.submitInput({
      seatId: h1.seatId, seatToken: h1.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 1, inputType: 'spawn_trap', payload: { kind: 'pit' } }
    });
    ({ t } = advanceRoomUntil(engine, t, ['round_2'], 15000));
    const s2 = engine.getPublicSnapshot();
    const h2 = s2.seats.seatA.role === 'hero' ? a : b;
    engine.submitInput({
      seatId: h2.seatId, seatToken: h2.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 2, connectionEpoch: 1, sequence: 2, inputType: 'spawn_trap', payload: { kind: 'enemy' } }
    });
    ({ t } = advanceRoomUntil(engine, t, ['result'], 15000));

    const trace = engine.getMatchTrace();
    const traceJson = JSON.stringify(trace);
    assert.strictEqual(traceJson.includes(a.seatToken), false, 'seatA token leaked in trace');
    assert.strictEqual(traceJson.includes(b.seatToken), false, 'seatB token leaked in trace');
    assert.strictEqual(trace.ranked, false);
    assert.strictEqual(trace.soloLeaderboardEligible, false);

    const verified = RoomEngine.verifyMatchTrace(trace, Sim, Mp);
    assert.strictEqual(verified.ok, true, verified.reason || '');

    // Version mismatch must be rejected (MP-12)
    const badVer = RoomEngine.verifyMatchTrace(Object.assign({}, trace, { protocolVersion: 999 }), Sim, Mp);
    assert.strictEqual(badVer.ok, false);
    assert.strictEqual(badVer.code, 'PROTOCOL_MISMATCH');
  });

  // T6: Live 2-client localhost WebSocket match + Mock Colyseus Adapter + Zero Drive URLs
  await runTest('T6 (Live ws v8.11.0 + Colyseus Adapter + Hygiene): Real 2-client WS match & Colyseus delegation pass', async () => {
    // 6a: Live localhost WebSocket 2-client match with short prototype countdown/cap for fast real-WS test
    const srv = createWsPrivateServer({
      port: 0,
      tickMs: 5,
      policyOverrides: { countdownMs: 25, intermissionMs: 25, maxRoundTicks: 40 }
    });
    const port = await srv.start();
    const url = `ws://127.0.0.1:${port}`;

    function connectClient() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const inbox = [];
        const waiters = [];
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString('utf8'));
          if (waiters.length) {
            const idx = waiters.findIndex((w) => w.pred(msg));
            if (idx !== -1) {
              const w = waiters.splice(idx, 1)[0];
              w.resolve(msg);
              return;
            }
          }
          inbox.push(msg);
        });
        ws.once('open', () => resolve({
          ws,
          send: (obj) => ws.send(JSON.stringify(obj)),
          waitFor: (pred, timeoutMs = 4000) => {
            const existingIdx = inbox.findIndex(pred);
            if (existingIdx !== -1) return Promise.resolve(inbox.splice(existingIdx, 1)[0]);
            return new Promise((res, rej) => {
              const timer = setTimeout(() => rej(new Error('WS waitFor timeout')), timeoutMs);
              waiters.push({
                pred,
                resolve: (m) => { clearTimeout(timer); res(m); }
              });
            });
          }
        }));
        ws.once('error', reject);
      });
    }

    const c1 = await connectClient();
    const c2 = await connectClient();
    try {
      c1.send({ type: 'create_room', playerId: 'ws_alice', displayName: 'ALICE', matchSeed: 606 });
      const created = await c1.waitFor((m) => m.type === 'room_created');
      c2.send({ type: 'join_room', inviteCode: created.inviteCode, playerId: 'ws_bob', displayName: 'BOB' });
      const joined = await c2.waitFor((m) => m.type === 'room_joined');

      c1.send({ type: 'ready', inviteCode: created.inviteCode, seatId: created.seatId, seatToken: created.seatToken, ready: true });
      c2.send({ type: 'ready', inviteCode: created.inviteCode, seatId: joined.seatId, seatToken: joined.seatToken, ready: true });

      const finalMsg = await c1.waitFor((m) => m.type === 'state' && m.snapshot && m.snapshot.state === 'result', 5000);
      assert.strictEqual(finalMsg.snapshot.outcome.outcome, 'draw');
      assert.strictEqual(finalMsg.snapshot.ranked, false);
      assert.strictEqual(finalMsg.snapshot.soloLeaderboardEligible, false);

      // Verify offline trace from live WS server room
      const liveTrace = srv.getRoom(created.inviteCode).engine.getMatchTrace();
      const traceCheck = RoomEngine.verifyMatchTrace(liveTrace, Sim, Mp);
      assert.strictEqual(traceCheck.ok, true);
    } finally {
      c1.ws.close();
      c2.ws.close();
      await srv.stop();
    }

    // 6b: Thin Colyseus Room adapter contract test
    const RoomCls = createSpikeSprintRoomClass(null);
    const room = new RoomCls();
    const broadcasts = [];
    room.broadcast = (type, payload) => broadcasts.push({ type, payload });
    room.onCreate({ matchSeed: 707 });

    const sentA = [];
    const sentB = [];
    const clientA = { sessionId: 'sess_a', send: (t, p) => sentA.push({ t, p }) };
    const clientB = { sessionId: 'sess_b', send: (t, p) => sentB.push({ t, p }) };
    const clientC = { sessionId: 'sess_c', send: () => {} };

    room.onJoin(clientA, { playerId: 'col_a', displayName: 'COL_A' });
    room.onJoin(clientB, { playerId: 'col_b', displayName: 'COL_B' });
    assert.throws(() => room.onJoin(clientC, { playerId: 'col_c' }), /2 players/);
    assert.strictEqual(sentA[0].t, 'seat_assigned');
    assert.strictEqual(sentB[0].t, 'seat_assigned');
    room._handlers.get('ready')(clientA, { ready: true });
    room._handlers.get('ready')(clientB, { ready: true });
    assert.strictEqual(room.engine.getPublicSnapshot().state, 'countdown_1');
    room.onLeave(clientA);
    assert.strictEqual(room.engine.getPublicSnapshot().outcome.outcome, 'forfeit');
    room.onDispose();

    // 6c: Zero Google Drive URLs across all M5-S2 files
    const files = [
      'src/mp/room_engine.js',
      'server/ws_private_server.js',
      'server/colyseus/SpikeSprintRoom.js',
      'server/package.json',
      'tests/run_m5_s2_private_rooms.js'
    ];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.strictEqual(/drive\.google\.com|docs\.google\.com/i.test(text), false, `Drive URL found in ${f}`);
    }
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} PASS`);
  process.exit(passed === results.length ? 0 : 1);
})();
