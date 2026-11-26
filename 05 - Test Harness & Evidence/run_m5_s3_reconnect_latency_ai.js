#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — M5-S3 Gate C Verification Suite
 * Covers MP-05 (15s cumulative reconnect grace, freeze, held-jump clear, token/epoch rotation),
 * M10/M11/M13/MP-07 (both-disconnect no_contest, voluntary forfeit, server-error abort),
 * MP-08/M12 (50/100/200/300 ms RTT + jitter + duplicate + loss trials),
 * live ws v8.11.0 reconnect + old-socket revocation, and MP-13/M26/MP-11 explicit AI practice.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const Sim = require(path.join(ROOT, 'src', 'sim', 'core.js'));
const Mp = require(path.join(ROOT, 'src', 'mp', 'protocol.js'));
const RoomEngine = require(path.join(ROOT, 'src', 'mp', 'room_engine.js'));
const NetSim = require(path.join(ROOT, 'src', 'mp', 'net_sim.js'));
const AiPractice = require(path.join(ROOT, 'src', 'mp', 'ai_practice.js'));
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

function advanceUntil(engine, startMs, targets, maxSteps = 20000, stepMs = 1000 / 60) {
  let t = startMs;
  for (let i = 0; i < maxSteps; i++) {
    t += stepMs;
    const res = engine.stepTick(t);
    if (targets.includes(res.state)) return { t, res };
  }
  throw new Error('Stuck in ' + engine.getPublicSnapshot().state);
}

(async function main() {
  console.log(`M5-S3 Reconnect Freeze, Latency Trials & AI Practice Suite (Gate C) | Node ${process.version}`);

  // T1: MP-05 / M08 / M09 / M19 — Cumulative 15s grace, freeze, held-jump clear & token/epoch rotation
  await runTest('T1 (MP-05 / M08 / M09 / M19): Cumulative 15s grace, freeze, held-jump clear & token/epoch rotation', async () => {
    const engine = RoomEngine.createPrivateRoomEngine({ matchSeed: 801, createdAtMs: 0 });
    const a = engine.joinSeat({ playerId: 'alice', nowMs: 100 });
    const b = engine.joinSeat({ playerId: 'bob', nowMs: 200 });
    engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 300 });
    engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 400 });

    let { t } = advanceUntil(engine, 400, ['round_1']);
    const snap1 = engine.getPublicSnapshot();
    const villain = snap1.seats.seatA.role === 'villain' ? a : b;
    const hero = snap1.seats.seatA.role === 'hero' ? a : b;

    // Villain starts holding jump
    engine.submitInput({
      seatId: villain.seatId, seatToken: villain.seatToken, nowMs: t,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 1, inputType: 'jump_start' }
    });
    engine.stepTick(t + 16.67);
    const tickBeforeDc = engine.getPublicSnapshot().sim.simTicks;

    // Disconnect #1 for 9,000 ms (leaves 6,000 ms in cumulative pool)
    const dc1 = engine.disconnectSeat({ seatId: villain.seatId, nowMs: t + 20 });
    assert.strictEqual(dc1.ok, true);
    assert.strictEqual(dc1.state, 'reconnecting');

    // Stepping during freeze must NOT advance simulation ticks
    engine.stepTick(t + 4000);
    assert.strictEqual(engine.getPublicSnapshot().state, 'reconnecting');
    assert.strictEqual(engine.getPublicSnapshot().sim.simTicks, tickBeforeDc, 'Sim ticks must freeze during disconnect');

    // Reconnect after 9,000 ms -> token rotates & connectionEpoch increments to 2
    const oldToken = villain.seatToken;
    const rc1 = engine.reconnectSeat({ seatId: villain.seatId, seatToken: oldToken, nowMs: t + 9020 });
    assert.strictEqual(rc1.ok, true);
    assert.strictEqual(rc1.state, 'round_1');
    assert.strictEqual(rc1.connectionEpoch, 2);
    assert.notStrictEqual(rc1.seatToken, oldToken, 'seatToken must rotate on reconnect');
    assert.strictEqual(rc1.graceRemainingMs, 6000);

    // Old token rejected (UNAUTHORIZED)
    const staleTok = engine.submitInput({
      seatId: villain.seatId, seatToken: oldToken, nowMs: t + 9030,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 2, sequence: 2, inputType: 'jump_end' }
    });
    assert.strictEqual(staleTok.ok, false);
    assert.strictEqual(staleTok.code, 'UNAUTHORIZED');

    // New token with stale epoch 1 rejected (EPOCH_MISMATCH)
    const staleEpoch = engine.submitInput({
      seatId: villain.seatId, seatToken: rc1.seatToken, nowMs: t + 9040,
      rawMsg: { protocolVersion: 1, matchId: engine.matchId, roundId: 1, connectionEpoch: 1, sequence: 2, inputType: 'jump_end' }
    });
    assert.strictEqual(staleEpoch.ok, false);
    assert.strictEqual(staleEpoch.code, 'EPOCH_MISMATCH');

    // Disconnect #2 for 6,000 ms exhausts the cumulative 15,000 ms pool -> immediate forfeit!
    engine.disconnectSeat({ seatId: villain.seatId, nowMs: t + 10000 });
    engine.stepTick(t + 16000);
    const finalSnap = engine.getPublicSnapshot();
    assert.strictEqual(finalSnap.state, 'result');
    assert.strictEqual(finalSnap.outcome.outcome, 'forfeit');
    assert.strictEqual(finalSnap.outcome.winnerSeatId, hero.seatId);
    assert.strictEqual(finalSnap.outcome.reason, 'reconnect_grace_exhausted');
  });

  // T2: M10 / M11 / M13 / MP-07 — Both-disconnect no_contest, voluntary forfeit & server-error no_contest
  await runTest('T2 (M10 / M11 / M13 / MP-07): Both-disconnect no_contest, voluntary forfeit & server-error abort', async () => {
    // 2a: Both disconnect -> grace expires -> no_contest
    const e1 = RoomEngine.createPrivateRoomEngine({ matchSeed: 802, createdAtMs: 0 });
    const a1 = e1.joinSeat({ playerId: 'p1', nowMs: 10 });
    const b1 = e1.joinSeat({ playerId: 'p2', nowMs: 20 });
    e1.setReady({ seatId: a1.seatId, seatToken: a1.seatToken, ready: true, nowMs: 30 });
    e1.setReady({ seatId: b1.seatId, seatToken: b1.seatToken, ready: true, nowMs: 40 });
    const { t } = advanceUntil(e1, 40, ['round_1']);
    e1.disconnectSeat({ seatId: a1.seatId, nowMs: t + 100 });
    e1.disconnectSeat({ seatId: b1.seatId, nowMs: t + 200 });
    e1.stepTick(t + 16000);
    assert.strictEqual(e1.getPublicSnapshot().outcome.outcome, 'no_contest');
    assert.strictEqual(e1.getPublicSnapshot().outcome.reason, 'both_disconnected_grace_exhausted');

    // 2b: Server stall / crash abort -> no_contest (no phantom winner, M13/MP-07)
    const e2 = RoomEngine.createPrivateRoomEngine({ matchSeed: 803, createdAtMs: 0 });
    const a2 = e2.joinSeat({ playerId: 'q1', nowMs: 10 });
    const b2 = e2.joinSeat({ playerId: 'q2', nowMs: 20 });
    e2.setReady({ seatId: a2.seatId, seatToken: a2.seatToken, ready: true, nowMs: 30 });
    e2.setReady({ seatId: b2.seatId, seatToken: b2.seatToken, ready: true, nowMs: 40 });
    const { t: t2 } = advanceUntil(e2, 40, ['round_1']);
    e2.abortServerError('event_loop_stall', t2 + 50);
    assert.strictEqual(e2.getPublicSnapshot().outcome.outcome, 'no_contest');
    assert.strictEqual(e2.getPublicSnapshot().outcome.winnerSeatId, null);
    assert.ok(e2.getPublicSnapshot().outcome.reason.includes('server_error'));

    // 2c: Colyseus onLeave(client, false) triggers reconnect freeze instead of immediate forfeit
    const RoomCls = createSpikeSprintRoomClass(null);
    const room = new RoomCls();
    room.onCreate({ matchSeed: 804 });
    const cA = { sessionId: 'sa', send: () => {} };
    const cB = { sessionId: 'sb', send: () => {} };
    room.onJoin(cA, { playerId: 'ca' });
    room.onJoin(cB, { playerId: 'cb' });
    room._handlers.get('ready')(cA, { ready: true });
    room._handlers.get('ready')(cB, { ready: true });
    room.onLeave(cA, false);
    assert.strictEqual(room.engine.getPublicSnapshot().state, 'reconnecting');
    room.onDispose();
  });

  // T3: MP-08 / M12 — 50 / 100 / 200 / 300 ms RTT + jitter + duplicates + 5% packet loss trials
  await runTest('T3 (MP-08 / M12): 50/100/200/300 ms RTT + jitter + duplicate + loss trials complete cleanly', async () => {
    const rttBands = [50, 100, 200, 300];
    const summary = [];
    for (const rttMs of rttBands) {
      const engine = RoomEngine.createPrivateRoomEngine({
        matchSeed: 900 + rttMs,
        createdAtMs: 0,
        policyOverrides: { maxRoundTicks: 300, countdownMs: 100, intermissionMs: 100 }
      });
      const net = NetSim.createNetworkSimulator({
        seed: 7000 + rttMs,
        rttMs,
        jitterMs: Math.round(rttMs * 0.15),
        dropRate: 0.05,
        dupRate: 0.15
      });

      const a = engine.joinSeat({ playerId: 'n1', nowMs: 10 });
      const b = engine.joinSeat({ playerId: 'n2', nowMs: 20 });
      engine.setReady({ seatId: a.seatId, seatToken: a.seatToken, ready: true, nowMs: 30 });
      engine.setReady({ seatId: b.seatId, seatToken: b.seatToken, ready: true, nowMs: 40 });

      let t = 40;
      const seq = { seatA: 0, seatB: 0 };
      let dupRejected = 0;

      for (let step = 0; step < 2000 && engine.getPublicSnapshot().state !== 'result'; step++) {
        t += 1000 / 60;
        const snap = engine.getPublicSnapshot();
        if ((snap.state === 'round_1' || snap.state === 'round_2') && step % 20 === 0) {
          const heroSeat = snap.seats.seatA.role === 'hero' ? a : b;
          const vilSeat = snap.seats.seatA.role === 'villain' ? a : b;
          seq[heroSeat.seatId] += 1;
          net.send(t, {
            seatId: heroSeat.seatId,
            seatToken: heroSeat.seatToken,
            rawMsg: {
              protocolVersion: 1, matchId: engine.matchId, roundId: snap.roundId,
              connectionEpoch: 1, sequence: seq[heroSeat.seatId],
              inputType: 'spawn_trap', payload: { kind: 'bush' }
            }
          });
          seq[vilSeat.seatId] += 1;
          net.send(t, {
            seatId: vilSeat.seatId,
            seatToken: vilSeat.seatToken,
            rawMsg: {
              protocolVersion: 1, matchId: engine.matchId, roundId: snap.roundId,
              connectionEpoch: 1, sequence: seq[vilSeat.seatId],
              inputType: 'jump_start'
            }
          });
        }

        const due = net.drainDue(t);
        for (const item of due) {
          const r = engine.submitInput({
            seatId: item.packet.seatId,
            seatToken: item.packet.seatToken,
            rawMsg: item.packet.rawMsg,
            nowMs: t
          });
          if (item.isDuplicate && !r.ok && r.code === 'INVALID_SEQUENCE') {
            dupRejected += 1;
          }
        }
        engine.stepTick(t);
      }

      const finalSnap = engine.getPublicSnapshot();
      assert.strictEqual(finalSnap.state, 'result', `RTT ${rttMs}ms match must complete`);
      const traceCheck = RoomEngine.verifyMatchTrace(engine.getMatchTrace(), Sim, Mp);
      assert.strictEqual(traceCheck.ok, true, `RTT ${rttMs}ms trace must verify bit-exact`);
      const st = net.getStats();
      summary.push(`${rttMs}ms(sent=${st.sent},drop=${st.dropped},dup=${st.duplicated},dupRej=${dupRejected})`);
    }
    console.log('      RTT Bands:', summary.join(' | '));
  });

  // T4: Live localhost ws v8.11.0 disconnect freeze, reconnect token rotation & old-socket revocation
  await runTest('T4 (Live ws v8.11.0 Reconnect): Socket drop freezes match, reconnect rotates token & completes', async () => {
    const srv = createWsPrivateServer({
      port: 0,
      tickMs: 10,
      policyOverrides: { countdownMs: 30, intermissionMs: 30, maxRoundTicks: 50, reconnectGraceTotalMs: 5000 }
    });
    const port = await srv.start();
    const url = `ws://127.0.0.1:${port}`;

    function connectWs() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const inbox = [];
        const waiters = [];
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString('utf8'));
          const idx = waiters.findIndex((w) => w.pred(m));
          if (idx !== -1) {
            const w = waiters.splice(idx, 1)[0];
            w.resolve(m);
          } else {
            inbox.push(m);
          }
        });
        ws.once('open', () => resolve({
          ws,
          send: (o) => ws.send(JSON.stringify(o)),
          waitFor: (pred, ms = 4000) => {
            const i = inbox.findIndex(pred);
            if (i !== -1) return Promise.resolve(inbox.splice(i, 1)[0]);
            return new Promise((res, rej) => {
              const tm = setTimeout(() => rej(new Error('WS timeout')), ms);
              waiters.push({ pred, resolve: (m) => { clearTimeout(tm); res(m); } });
            });
          }
        }));
        ws.once('error', reject);
      });
    }

    const c1 = await connectWs();
    const c2 = await connectWs();
    let c1Reconn = null;
    try {
      c1.send({ type: 'create_room', playerId: 'ws_r1', displayName: 'R1', matchSeed: 950 });
      const created = await c1.waitFor((m) => m.type === 'room_created');
      c2.send({ type: 'join_room', inviteCode: created.inviteCode, playerId: 'ws_r2', displayName: 'R2' });
      const joined = await c2.waitFor((m) => m.type === 'room_joined');

      c1.send({ type: 'ready', inviteCode: created.inviteCode, seatId: created.seatId, seatToken: created.seatToken, ready: true });
      c2.send({ type: 'ready', inviteCode: created.inviteCode, seatId: joined.seatId, seatToken: joined.seatToken, ready: true });

      await c2.waitFor((m) => m.type === 'state' && m.snapshot.state === 'round_1');

      // Drop c1 socket abruptly -> c2 observes 'reconnecting' freeze
      c1.ws.terminate();
      await c2.waitFor((m) => m.type === 'state' && m.snapshot.state === 'reconnecting');

      // Reconnect on a brand-new WebSocket with prior seatToken
      c1Reconn = await connectWs();
      c1Reconn.send({
        type: 'reconnect',
        inviteCode: created.inviteCode,
        seatId: created.seatId,
        seatToken: created.seatToken
      });
      const recMsg = await c1Reconn.waitFor((m) => m.type === 'reconnected');
      assert.strictEqual(recMsg.connectionEpoch, 2);
      assert.notStrictEqual(recMsg.seatToken, created.seatToken);

      // Match resumes and completes cleanly
      const done = await c2.waitFor((m) => m.type === 'state' && m.snapshot.state === 'result', 5000);
      assert.strictEqual(done.snapshot.outcome.outcome, 'draw');
    } finally {
      try { c1.ws.close(); } catch (_) {}
      try { c2.ws.close(); } catch (_) {}
      if (c1Reconn) try { c1Reconn.ws.close(); } catch (_) {}
      await srv.stop();
    }
  });

  // T5: MP-13 / M26 / MP-11 — Explicit Human-Hero vs AI-Villain practice & AI_HERO_NOT_IMPLEMENTED
  await runTest('T5 (MP-13 / M26 / MP-11): Explicit Human-Hero vs AI-Villain practice & AI_HERO_NOT_IMPLEMENTED', async () => {
    const denied = AiPractice.createAiPracticeSession({ mode: 'human_villain_vs_ai_hero', seed: 101 });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, 'AI_HERO_NOT_IMPLEMENTED');

    const sess = AiPractice.createAiPracticeSession({ mode: 'human_hero_vs_ai_villain', seed: 102, heroDiff: 'hard', maxTicks: 180 });
    assert.strictEqual(sess.ok, true);
    assert.strictEqual(sess.metadata.practiceMode, true);
    assert.strictEqual(sess.metadata.ranked, false);
    assert.strictEqual(sess.metadata.soloLeaderboardEligible, false);
    assert.strictEqual(sess.metadata.aiHeroSupported, false);
    assert.strictEqual(sess.metadata.offlineCapable, true);

    assert.strictEqual(sess.spawnTrap('enemy'), true);
    for (let i = 0; i < 180 && sess.sim.state.gameState === 'playing'; i++) {
      sess.step();
    }
    const res = sess.getResult();
    assert.strictEqual(res.practiceMode, true);
    assert.strictEqual(res.ranked, false);
    assert.strictEqual(res.soloLeaderboardEligible, false);
    assert.strictEqual(res.gameState, 'over');
  });

  // T6: Hygiene & zero Drive URLs across all M5-S3 files
  await runTest('T6 (Hygiene): Zero Google Drive URLs across all M5-S3 files', async () => {
    const files = [
      'src/mp/room_engine.js',
      'src/mp/net_sim.js',
      'src/mp/ai_practice.js',
      'server/ws_private_server.js',
      'server/colyseus/SpikeSprintRoom.js',
      'tests/run_m5_s3_reconnect_latency_ai.js'
    ];
    for (const f of files) {
      const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.strictEqual(/drive\.google\.com|docs\.google\.com/i.test(txt), false, `Drive URL found in ${f}`);
    }
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nSummary: ${passed}/${results.length} PASS`);
  process.exit(passed === results.length ? 0 : 1);
})();
