(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('../sim/core.js') : (root && root.SpikeSprintSim),
    typeof require === 'function' ? require('./protocol.js') : (root && root.SpikeSprintMpProtocol),
    typeof require === 'function' ? require('crypto') : null
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SpikeSprintRoomEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DefaultSim, DefaultMp, NodeCrypto) {
  'use strict';

  function generateSecureHex(bytesLen, fallbackPrng) {
    if (NodeCrypto && typeof NodeCrypto.randomBytes === 'function') {
      return NodeCrypto.randomBytes(bytesLen).toString('hex');
    }
    let out = '';
    for (let i = 0; i < bytesLen; i++) {
      const b = Math.floor((fallbackPrng ? fallbackPrng() : 0.5) * 256) & 0xff;
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  function createPrivateRoomEngine(opts) {
    const cfg = opts && typeof opts === 'object' ? opts : {};
    const Sim = cfg.Sim || DefaultSim;
    const Mp = cfg.Mp || DefaultMp;
    if (!Sim || !Mp) {
      throw new Error('RoomEngine requires Sim (core.js) and Mp (protocol.js)');
    }

    const basePolicy = Mp.MP_POLICY;
    const policy = Object.freeze(Object.assign({}, basePolicy, cfg.policyOverrides || {}));
    const matchSeed = (Number(cfg.matchSeed) >>> 0) || 1337;
    const prng = Sim.createPrng(matchSeed);
    const matchId = typeof cfg.matchId === 'string' && cfg.matchId ? cfg.matchId : ('mp_' + generateSecureHex(6, prng));
    const inviteCode = typeof cfg.inviteCode === 'string' && cfg.inviteCode ? cfg.inviteCode : generateSecureHex(3, prng).toUpperCase();
    const createdAtMs = Number.isFinite(cfg.createdAtMs) ? cfg.createdAtMs : 0;

    // Precommitted hidden server seed shared across both rounds (Doc 13 §4)
    const roundSeed = (((matchSeed ^ 0x9e3779b9) >>> 0) || 1);

    let state = 'waiting';
    let lastMeaningfulActionMs = createdAtMs;
    let readyDeadlineMs = null;
    let pairingStartedAtMs = null;
    let hardDeadlineMs = null;
    let phaseEndsAtMs = null;
    let pausedPhase = null;
    let freezeStartedAtMs = null;
    let lastGraceChargeMs = null;
    let roundId = 0;
    let activeSim = null;
    let pendingInputs = [];
    let currentRoundInputs = [];
    let round1Result = null;
    let round2Result = null;
    let outcome = null;
    let terminalReason = null;
    const lifecycle = [];

    const seats = {
      seatA: null,
      seatB: null
    };

    function logEvent(type, nowMs, details) {
      lifecycle.push(Object.freeze(Object.assign({ type, nowMs }, details || {})));
    }

    logEvent('room_created', createdAtMs, { matchId, inviteCode });

    function isTerminal() {
      return state === 'result' || state === 'aborted' || state === 'expired' || state === 'closed';
    }

    function authenticateSeat(seatId, seatToken) {
      if (seatId !== 'seatA' && seatId !== 'seatB') return null;
      const seat = seats[seatId];
      if (!seat) return null;
      if (typeof seatToken !== 'string' || !seatToken || seatToken !== seat.seatToken) return null;
      return seat;
    }

    function commitOutcome(nextOutcome, nowMs) {
      if (outcome !== null) return outcome; // Idempotent single terminal commit (M16)
      outcome = nextOutcome;
      state = 'result';
      terminalReason = nextOutcome.reason;
      pendingInputs = [];
      activeSim = null;
      logEvent('match_result', nowMs, {
        outcome: nextOutcome.outcome,
        winnerSeatId: nextOutcome.winnerSeatId,
        reason: nextOutcome.reason
      });
      return outcome;
    }

    function abortRoom(reason, nowMs) {
      if (isTerminal()) return;
      state = 'aborted';
      terminalReason = reason;
      pendingInputs = [];
      activeSim = null;
      logEvent('room_aborted', nowMs, { reason });
    }

    function checkDeadlines(nowMs) {
      if (isTerminal()) return state;
      if (!Number.isFinite(nowMs)) return state;

      // Waiting expiry anchored strictly to last meaningful action (M06)
      if (state === 'waiting') {
        if (nowMs - lastMeaningfulActionMs >= policy.waitingRoomExpiryMs) {
          state = 'expired';
          terminalReason = 'waiting_room_expired';
          logEvent('room_expired', nowMs, { reason: 'waiting_room_expired' });
        }
        return state;
      }

      // Ready check timeout (M07)
      if (state === 'ready_check') {
        if (readyDeadlineMs !== null && nowMs >= readyDeadlineMs) {
          abortRoom('ready_timeout', nowMs);
        }
        return state;
      }

      // Charge cumulative 15s reconnect grace during freeze (M08/M09/M10)
      if (state === 'reconnecting') {
        const prevT = lastGraceChargeMs !== null ? lastGraceChargeMs : nowMs;
        const delta = Math.max(0, nowMs - prevT);
        lastGraceChargeMs = nowMs;
        if (seats.seatA && !seats.seatA.connected) {
          seats.seatA.reconnectGraceRemainingMs = Math.max(0, Number((seats.seatA.reconnectGraceRemainingMs - delta).toFixed(3)));
        }
        if (seats.seatB && !seats.seatB.connected) {
          seats.seatB.reconnectGraceRemainingMs = Math.max(0, Number((seats.seatB.reconnectGraceRemainingMs - delta).toFixed(3)));
        }
      }

      // Hard 5-minute pairing-to-result session deadline (Doc 13 §2)
      if (hardDeadlineMs !== null && nowMs >= hardDeadlineMs) {
        const sATicks = round1Result && round1Result.villainSeatId === 'seatA'
          ? round1Result.survivalTicks
          : (round2Result && round2Result.villainSeatId === 'seatA' ? round2Result.survivalTicks : 0);
        const sBTicks = round1Result && round1Result.villainSeatId === 'seatB'
          ? round1Result.survivalTicks
          : (round2Result && round2Result.villainSeatId === 'seatB' ? round2Result.survivalTicks : 0);
        commitOutcome(Mp.resolveMatchOutcome({
          seatA: 'seatA',
          seatB: 'seatB',
          seatAVillainTicks: sATicks,
          seatBVillainTicks: sBTicks,
          terminalOverride: { type: 'no_contest', reason: 'session_deadline_exceeded' }
        }), nowMs);
        return state;
      }

      if (state === 'reconnecting') {
        const aOff = seats.seatA && !seats.seatA.connected;
        const bOff = seats.seatB && !seats.seatB.connected;
        const aOut = aOff && seats.seatA.reconnectGraceRemainingMs <= 0;
        const bOut = bOff && seats.seatB.reconnectGraceRemainingMs <= 0;
        if (aOff && bOff && (aOut || bOut)) {
          commitOutcome(Mp.resolveMatchOutcome({
            seatA: 'seatA', seatB: 'seatB', seatAVillainTicks: 0, seatBVillainTicks: 0,
            terminalOverride: { type: 'no_contest', reason: 'both_disconnected_grace_exhausted' }
          }), nowMs);
        } else if (aOut) {
          commitOutcome(Mp.resolveMatchOutcome({
            seatA: 'seatA', seatB: 'seatB', seatAVillainTicks: 0, seatBVillainTicks: 0,
            terminalOverride: { type: 'forfeit', winnerSeatId: 'seatB', reason: 'reconnect_grace_exhausted' }
          }), nowMs);
        } else if (bOut) {
          commitOutcome(Mp.resolveMatchOutcome({
            seatA: 'seatA', seatB: 'seatB', seatAVillainTicks: 0, seatBVillainTicks: 0,
            terminalOverride: { type: 'forfeit', winnerSeatId: 'seatA', reason: 'reconnect_grace_exhausted' }
          }), nowMs);
        }
      }
      return state;
    }

    function recordHeartbeat(nowMs) {
      // Deliberately does NOT update lastMeaningfulActionMs (Doc 13 M06)
      checkDeadlines(nowMs);
      return Object.freeze({ ok: !isTerminal(), state });
    }

    function joinSeat(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      checkDeadlines(nowMs);

      if (state !== 'waiting') {
        return Object.freeze({
          ok: false,
          code: (seats.seatA && seats.seatB) ? 'ROOM_FULL' : 'ROOM_NOT_ACCEPTING',
          reason: (seats.seatA && seats.seatB) ? 'Room already has 2 players' : ('Room is in state: ' + state)
        });
      }

      const playerId = typeof p.playerId === 'string' && p.playerId.trim() ? p.playerId.trim() : null;
      if (!playerId) {
        return Object.freeze({ ok: false, code: 'INVALID_PLAYER', reason: 'playerId is required' });
      }
      if ((seats.seatA && seats.seatA.playerId === playerId) || (seats.seatB && seats.seatB.playerId === playerId)) {
        return Object.freeze({ ok: false, code: 'SELF_PAIR_FORBIDDEN', reason: 'Player already occupies a seat' });
      }

      const seatId = !seats.seatA ? 'seatA' : (!seats.seatB ? 'seatB' : null);
      if (!seatId) {
        return Object.freeze({ ok: false, code: 'ROOM_FULL', reason: 'Room already has 2 players' });
      }

      const seatToken = typeof p.seatToken === 'string' && p.seatToken
        ? p.seatToken
        : generateSecureHex(16, prng);

      seats[seatId] = {
        seatId,
        playerId,
        displayName: typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim().slice(0, 12) : seatId.toUpperCase(),
        seatToken,
        connectionEpoch: 1,
        lastSequence: 0,
        ready: false,
        role: 'lobby',
        connected: true,
        reconnectGraceRemainingMs: policy.reconnectGraceTotalMs,
        disconnectedAtMs: null
      };

      lastMeaningfulActionMs = nowMs;
      logEvent('seat_joined', nowMs, { seatId, playerId });

      if (seats.seatA && seats.seatB) {
        state = 'ready_check';
        readyDeadlineMs = nowMs + policy.readyTimeoutMs;
        logEvent('ready_check_started', nowMs, { readyDeadlineMs });
      }

      return Object.freeze({
        ok: true,
        matchId,
        inviteCode,
        seatId,
        seatToken,
        connectionEpoch: seats[seatId].connectionEpoch,
        state
      });
    }

    function setReady(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      checkDeadlines(nowMs);

      const seat = authenticateSeat(p.seatId, p.seatToken);
      if (!seat) {
        return Object.freeze({ ok: false, code: 'UNAUTHORIZED', reason: 'Invalid seatId or seatToken' });
      }
      if (state !== 'waiting' && state !== 'ready_check') {
        return Object.freeze({ ok: false, code: 'INVALID_STATE', reason: 'Cannot toggle ready in state: ' + state });
      }

      seat.ready = Boolean(p.ready);
      lastMeaningfulActionMs = nowMs;
      logEvent('seat_ready', nowMs, { seatId: seat.seatId, ready: seat.ready });

      if (state === 'ready_check' && seats.seatA && seats.seatB && seats.seatA.ready && seats.seatB.ready) {
        pairingStartedAtMs = nowMs;
        hardDeadlineMs = nowMs + policy.pairingToResultBudgetMs;
        const firstIsA = (matchSeed & 1) === 0;
        seats.seatA.role = firstIsA ? 'villain' : 'hero';
        seats.seatB.role = firstIsA ? 'hero' : 'villain';
        roundId = 1;
        state = 'countdown_1';
        phaseEndsAtMs = nowMs + policy.countdownMs;
        logEvent('countdown_started', nowMs, {
          roundId: 1,
          seatARole: seats.seatA.role,
          seatBRole: seats.seatB.role,
          hardDeadlineMs
        });
      }

      return Object.freeze({ ok: true, state, ready: seat.ready });
    }

    function startRound(rId, nowMs) {
      roundId = rId;
      pendingInputs = [];
      currentRoundInputs = [];
      activeSim = Sim.createSim({
        modeKey: 'multiplayer',
        heroDiff: policy.heroCooldownPreset,
        seed: roundSeed,
        maxTicks: policy.maxRoundTicks
      });
      state = (rId === 1) ? 'round_1' : 'round_2';
      phaseEndsAtMs = null;
      logEvent('round_started', nowMs, {
        roundId: rId,
        villainSeatId: seats.seatA.role === 'villain' ? 'seatA' : 'seatB',
        heroSeatId: seats.seatA.role === 'hero' ? 'seatA' : 'seatB'
      });
    }

    function submitInput(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      checkDeadlines(nowMs);

      const seat = authenticateSeat(p.seatId, p.seatToken);
      if (!seat) {
        return Object.freeze({ ok: false, code: 'UNAUTHORIZED', reason: 'Invalid seatId or seatToken' });
      }
      if (isTerminal()) {
        return Object.freeze({ ok: false, code: 'MATCH_TERMINATED', reason: 'Match already ended' });
      }

      const validation = Mp.validateClientInputEnvelope(p.rawMsg, {
        matchId,
        roundId,
        connectionEpoch: seat.connectionEpoch,
        lastSequence: seat.lastSequence,
        role: seat.role
      });
      if (!validation.ok) {
        return validation;
      }

      const norm = validation.normalized;
      seat.lastSequence = norm.sequence;

      if (norm.inputType === 'leave') {
        return leaveSeat({ seatId: seat.seatId, seatToken: seat.seatToken, nowMs });
      }
      if (norm.inputType === 'ready') {
        return setReady({ seatId: seat.seatId, seatToken: seat.seatToken, ready: true, nowMs });
      }

      if (state !== 'round_1' && state !== 'round_2') {
        return Object.freeze({ ok: false, code: 'ROUND_NOT_ACTIVE', reason: 'Gameplay input rejected outside active round' });
      }

      pendingInputs.push({
        seatId: seat.seatId,
        role: seat.role,
        inputType: norm.inputType,
        payload: norm.payload
      });
      return Object.freeze({ ok: true, accepted: true, sequence: norm.sequence });
    }

    function leaveSeat(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      const seat = authenticateSeat(p.seatId, p.seatToken);
      if (!seat) {
        return Object.freeze({ ok: false, code: 'UNAUTHORIZED', reason: 'Invalid seatId or seatToken' });
      }
      if (isTerminal()) {
        return Object.freeze({ ok: true, state, idempotent: true });
      }

      if (state === 'waiting' || state === 'ready_check') {
        lastMeaningfulActionMs = nowMs;
        logEvent('seat_left_lobby', nowMs, { seatId: seat.seatId });
        abortRoom('player_left_lobby', nowMs);
        return Object.freeze({ ok: true, state });
      }

      // Voluntary leave during active match is immediate forfeit (Doc 13 M11)
      const winnerSeatId = seat.seatId === 'seatA' ? 'seatB' : 'seatA';
      const sATicks = round1Result && round1Result.villainSeatId === 'seatA'
        ? round1Result.survivalTicks
        : (activeSim && seats.seatA.role === 'villain' ? activeSim.state.simTicks : 0);
      const sBTicks = round1Result && round1Result.villainSeatId === 'seatB'
        ? round1Result.survivalTicks
        : (activeSim && seats.seatB.role === 'villain' ? activeSim.state.simTicks : 0);

      commitOutcome(Mp.resolveMatchOutcome({
        seatA: 'seatA',
        seatB: 'seatB',
        seatAVillainTicks: sATicks,
        seatBVillainTicks: sBTicks,
        terminalOverride: { type: 'forfeit', winnerSeatId, reason: 'voluntary_leave_forfeit' }
      }), nowMs);

      return Object.freeze({ ok: true, state, outcome });
    }


    function disconnectSeat(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      const seat = (p.seatId === 'seatA' || p.seatId === 'seatB') ? seats[p.seatId] : null;
      if (!seat) return Object.freeze({ ok: false, code: 'INVALID_SEAT', reason: 'Unknown seatId' });
      if (isTerminal()) return Object.freeze({ ok: true, state, idempotent: true });

      if (state === 'waiting' || state === 'ready_check') {
        logEvent('seat_disconnected_lobby', nowMs, { seatId: seat.seatId });
        abortRoom('player_disconnected_lobby', nowMs);
        return Object.freeze({ ok: true, state });
      }

      checkDeadlines(nowMs);
      if (isTerminal()) return Object.freeze({ ok: true, state, idempotent: true });
      if (!seat.connected) return Object.freeze({ ok: true, state, idempotent: true, graceRemainingMs: seat.reconnectGraceRemainingMs });

      seat.connected = false;
      seat.disconnectedAtMs = nowMs;

      if (state !== 'reconnecting') {
        pausedPhase = state;
        freezeStartedAtMs = nowMs;
        lastGraceChargeMs = nowMs;
        // Clear held jump on disconnect boundary without applying boost (M09 / MP-05)
        if (activeSim && activeSim.state && activeSim.state.player) {
          activeSim.state.player.jumpKeyDown = false;
          activeSim.state.player.jumpHoldMs = 0;
        }
        pendingInputs = [];
        state = 'reconnecting';
      }

      logEvent('seat_disconnected', nowMs, {
        seatId: seat.seatId,
        graceRemainingMs: seat.reconnectGraceRemainingMs
      });
      checkDeadlines(nowMs);
      return Object.freeze({ ok: true, state, graceRemainingMs: seat.reconnectGraceRemainingMs });
    }

    function reconnectSeat(params) {
      const p = params && typeof params === 'object' ? params : {};
      const nowMs = Number.isFinite(p.nowMs) ? p.nowMs : createdAtMs;
      checkDeadlines(nowMs);
      if (isTerminal()) {
        return Object.freeze({ ok: false, code: 'MATCH_TERMINATED', reason: 'Match already ended' });
      }
      const seat = authenticateSeat(p.seatId, p.seatToken);
      if (!seat) {
        return Object.freeze({ ok: false, code: 'UNAUTHORIZED', reason: 'Invalid seatId or seatToken' });
      }

      seat.seatToken = generateSecureHex(16, prng);
      seat.connectionEpoch += 1;
      seat.connected = true;
      seat.disconnectedAtMs = null;

      logEvent('seat_reconnected', nowMs, {
        seatId: seat.seatId,
        connectionEpoch: seat.connectionEpoch,
        graceRemainingMs: seat.reconnectGraceRemainingMs
      });

      if (state === 'reconnecting' && seats.seatA && seats.seatB && seats.seatA.connected && seats.seatB.connected) {
        const frozenMs = freezeStartedAtMs !== null ? Math.max(0, nowMs - freezeStartedAtMs) : 0;
        if (phaseEndsAtMs !== null) {
          phaseEndsAtMs += frozenMs;
        }
        state = pausedPhase;
        pausedPhase = null;
        freezeStartedAtMs = null;
        lastGraceChargeMs = null;
        logEvent('match_resumed', nowMs, { resumedState: state, frozenMs });
      }

      return Object.freeze({
        ok: true,
        seatId: seat.seatId,
        seatToken: seat.seatToken,
        connectionEpoch: seat.connectionEpoch,
        graceRemainingMs: seat.reconnectGraceRemainingMs,
        state,
        snapshot: getPublicSnapshot()
      });
    }

    function abortServerError(reason, nowMs) {
      const t = Number.isFinite(nowMs) ? nowMs : createdAtMs;
      if (isTerminal()) return outcome;
      return commitOutcome(Mp.resolveMatchOutcome({
        seatA: 'seatA', seatB: 'seatB', seatAVillainTicks: 0, seatBVillainTicks: 0,
        terminalOverride: { type: 'no_contest', reason: 'server_error:' + (reason || 'internal') }
      }), t);
    }

    function stepTick(nowMs) {
      checkDeadlines(nowMs);
      if (isTerminal()) {
        return Object.freeze({ state, tick: null, outcome });
      }

      if (state === 'countdown_1' && nowMs >= phaseEndsAtMs) {
        startRound(1, nowMs);
        return Object.freeze({ state, tick: 0, outcome: null });
      }

      if (state === 'intermission' && nowMs >= phaseEndsAtMs) {
        // Role swap & clean reset (M15)
        const prevA = seats.seatA.role;
        seats.seatA.role = seats.seatB.role;
        seats.seatB.role = prevA;
        roundId = 2;
        pendingInputs = [];
        state = 'countdown_2';
        phaseEndsAtMs = nowMs + policy.countdownMs;
        logEvent('roles_swapped', nowMs, {
          roundId: 2,
          seatARole: seats.seatA.role,
          seatBRole: seats.seatB.role
        });
        return Object.freeze({ state, tick: null, outcome: null });
      }

      if (state === 'countdown_2' && nowMs >= phaseEndsAtMs) {
        startRound(2, nowMs);
        return Object.freeze({ state, tick: 0, outcome: null });
      }

      if ((state === 'round_1' || state === 'round_2') && activeSim) {
        const currentTick = activeSim.state.simTicks;
        const batch = pendingInputs;
        pendingInputs = [];

        for (let i = 0; i < batch.length; i++) {
          const inp = batch[i];
          let applied = false;
          if (inp.inputType === 'jump_start') {
            applied = activeSim.startJump();
          } else if (inp.inputType === 'jump_end') {
            activeSim.endJump();
            applied = true;
          } else if (inp.inputType === 'spawn_trap' && inp.payload) {
            applied = activeSim.triggerHeroSpawn(inp.payload.kind);
          }
          if (applied) {
            currentRoundInputs.push(Object.freeze({
              tick: currentTick,
              seatId: inp.seatId,
              role: inp.role,
              inputType: inp.inputType,
              payload: inp.payload
            }));
          }
        }

        const stepRes = activeSim.step();
        if (activeSim.state.gameState === 'over') {
          const villainSeatId = seats.seatA.role === 'villain' ? 'seatA' : 'seatB';
          const heroSeatId = seats.seatA.role === 'hero' ? 'seatA' : 'seatB';
          const roundSummary = Object.freeze({
            roundId,
            villainSeatId,
            heroSeatId,
            survivalTicks: activeSim.state.simTicks,
            stopCause: stepRes.stopCause || activeSim.state.stopCause,
            inputs: Object.freeze(currentRoundInputs.slice())
          });

          logEvent('round_ended', nowMs, {
            roundId,
            villainSeatId,
            survivalTicks: roundSummary.survivalTicks,
            stopCause: roundSummary.stopCause
          });

          if (roundId === 1) {
            round1Result = roundSummary;
            pendingInputs = [];
            activeSim = null;
            state = 'intermission';
            phaseEndsAtMs = nowMs + policy.intermissionMs;
          } else {
            round2Result = roundSummary;
            const seatAVillainTicks = round1Result.villainSeatId === 'seatA'
              ? round1Result.survivalTicks
              : round2Result.survivalTicks;
            const seatBVillainTicks = round1Result.villainSeatId === 'seatB'
              ? round1Result.survivalTicks
              : round2Result.survivalTicks;
            commitOutcome(Mp.resolveMatchOutcome({
              seatA: 'seatA',
              seatB: 'seatB',
              seatAVillainTicks,
              seatBVillainTicks
            }), nowMs);
          }
        }

        return Object.freeze({
          state,
          tick: activeSim ? activeSim.state.simTicks : null,
          outcome
        });
      }

      return Object.freeze({ state, tick: null, outcome });
    }

    function getPublicSnapshot() {
      // Explicitly whitelist public fields; NEVER expose seatToken or precommitted roundSeed during play (M19)
      const pubSeat = (s) => s ? Object.freeze({
        seatId: s.seatId,
        displayName: s.displayName,
        ready: s.ready,
        role: s.role,
        connectionEpoch: s.connectionEpoch,
        connected: s.connected,
        reconnectGraceRemainingMs: s.reconnectGraceRemainingMs
      }) : null;

      return Object.freeze({
        protocolVersion: policy.protocolVersion,
        rulesetVersion: policy.rulesetVersion,
        simVersion: Sim.SIM_VERSION,
        matchId,
        inviteCode,
        state,
        roundId,
        seats: Object.freeze({
          seatA: pubSeat(seats.seatA),
          seatB: pubSeat(seats.seatB)
        }),
        sim: activeSim ? Object.freeze(activeSim.getSnapshot()) : null,
        round1: round1Result ? Object.freeze({
          roundId: round1Result.roundId,
          villainSeatId: round1Result.villainSeatId,
          survivalTicks: round1Result.survivalTicks,
          stopCause: round1Result.stopCause
        }) : null,
        round2: round2Result ? Object.freeze({
          roundId: round2Result.roundId,
          villainSeatId: round2Result.villainSeatId,
          survivalTicks: round2Result.survivalTicks,
          stopCause: round2Result.stopCause
        }) : null,
        outcome,
        terminalReason,
        ranked: false,
        soloLeaderboardEligible: false
      });
    }

    function getMatchTrace() {
      return Object.freeze({
        protocolVersion: policy.protocolVersion,
        rulesetVersion: policy.rulesetVersion,
        simVersion: Sim.SIM_VERSION,
        matchId,
        inviteCode,
        heroCooldownPreset: policy.heroCooldownPreset,
        maxRoundTicks: policy.maxRoundTicks,
        roundSeed,
        rounds: Object.freeze([round1Result, round2Result].filter(Boolean)),
        lifecycle: Object.freeze(lifecycle.slice()),
        outcome,
        ranked: false,
        soloLeaderboardEligible: false
      });
    }

    return Object.freeze({
      matchId,
      inviteCode,
      policy,
      joinSeat,
      setReady,
      recordHeartbeat,
      submitInput,
      leaveSeat,
      disconnectSeat,
      reconnectSeat,
      abortServerError,
      stepTick,
      checkDeadlines,
      getPublicSnapshot,
      getMatchTrace
    });
  }

  /**
   * Deterministic offline two-round trace verifier (Doc 13 MP-12).
   */
  function verifyMatchTrace(trace, SimModule, MpModule) {
    const Sim = SimModule || DefaultSim;
    const Mp = MpModule || DefaultMp;
    if (!trace || typeof trace !== 'object') {
      return Object.freeze({ ok: false, code: 'INVALID_TRACE', reason: 'Missing trace object' });
    }
    if (trace.protocolVersion !== Mp.MP_PROTOCOL_VERSION) {
      return Object.freeze({ ok: false, code: 'PROTOCOL_MISMATCH', reason: 'Unsupported trace protocolVersion' });
    }
    if (trace.rulesetVersion !== Mp.MP_RULESET_VERSION) {
      return Object.freeze({ ok: false, code: 'RULESET_MISMATCH', reason: 'Unsupported trace rulesetVersion' });
    }
    if (trace.simVersion !== Sim.SIM_VERSION) {
      return Object.freeze({ ok: false, code: 'SIM_VERSION_MISMATCH', reason: 'Incompatible simVersion' });
    }
    if (!Array.isArray(trace.rounds) || trace.rounds.length !== 2) {
      return Object.freeze({ ok: false, code: 'INCOMPLETE_ROUNDS', reason: 'Trace must contain 2 completed rounds' });
    }

    const replayedTicks = { seatA: 0, seatB: 0 };
    for (let rIdx = 0; rIdx < 2; rIdx++) {
      const rd = trace.rounds[rIdx];
      const sim = Sim.createSim({
        modeKey: 'multiplayer',
        heroDiff: trace.heroCooldownPreset || 'hard',
        seed: trace.roundSeed,
        maxTicks: trace.maxRoundTicks || Mp.MP_POLICY.maxRoundTicks
      });

      const byTick = new Map();
      const inputs = Array.isArray(rd.inputs) ? rd.inputs : [];
      for (let i = 0; i < inputs.length; i++) {
        const ev = inputs[i];
        if (!byTick.has(ev.tick)) byTick.set(ev.tick, []);
        byTick.get(ev.tick).push(ev);
      }

      const cap = (trace.maxRoundTicks || Mp.MP_POLICY.maxRoundTicks) + 5;
      for (let step = 0; step < cap && sim.state.gameState === 'playing'; step++) {
        const list = byTick.get(sim.state.simTicks);
        if (list) {
          for (let j = 0; j < list.length; j++) {
            const ev = list[j];
            if (ev.inputType === 'jump_start') sim.startJump();
            else if (ev.inputType === 'jump_end') sim.endJump();
            else if (ev.inputType === 'spawn_trap' && ev.payload) sim.triggerHeroSpawn(ev.payload.kind);
          }
        }
        sim.step();
      }

      if (sim.state.simTicks !== rd.survivalTicks || sim.state.stopCause !== rd.stopCause) {
        return Object.freeze({
          ok: false,
          code: 'REPLAY_DIVERGENCE',
          reason: `Round ${rd.roundId} mismatch: expected (${rd.survivalTicks}, ${rd.stopCause}), got (${sim.state.simTicks}, ${sim.state.stopCause})`
        });
      }
      replayedTicks[rd.villainSeatId] = sim.state.simTicks;
    }

    const expectedOutcome = Mp.resolveMatchOutcome({
      seatA: 'seatA',
      seatB: 'seatB',
      seatAVillainTicks: replayedTicks.seatA,
      seatBVillainTicks: replayedTicks.seatB
    });

    if (!trace.outcome || trace.outcome.winnerSeatId !== expectedOutcome.winnerSeatId || trace.outcome.outcome !== expectedOutcome.outcome) {
      return Object.freeze({ ok: false, code: 'OUTCOME_MISMATCH', reason: 'Replayed outcome does not match trace outcome' });
    }

    return Object.freeze({ ok: true, replayedTicks: Object.freeze(replayedTicks), outcome: expectedOutcome });
  }

  return Object.freeze({
    createPrivateRoomEngine,
    verifyMatchTrace
  });
});
