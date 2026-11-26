(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SpikeSprintMpProtocol = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  const MP_PROTOCOL_VERSION = 1;
  const MP_RULESET_VERSION = 'mp-1.0';
  const MAX_INPUT_BYTES = 512;

  const MP_POLICY = Object.freeze({
    protocolVersion: MP_PROTOCOL_VERSION,
    rulesetVersion: MP_RULESET_VERSION,
    maxPlayers: 2,
    roundsPerMatch: 2,
    tickRateHz: 60,
    maxRoundTicks: 7200,
    maxRoundSec: 120,
    speedRampSec: 120,
    speedMinMult: 1,
    speedMaxMult: 3,
    heroCooldownPreset: 'hard',
    heroCooldownScale: 0.75,
    pairingToResultBudgetMs: 300000,
    queueWaitLimitMs: 60000,
    waitingRoomExpiryMs: 300000,
    waitingExpiryAnchor: 'last_meaningful_action',
    meaningfulLobbyActions: Object.freeze(['join', 'leave', 'ready']),
    readyTimeoutMs: 15000,
    countdownMs: 3000,
    intermissionMs: 5000,
    reconnectGraceTotalMs: 15000,
    disconnectPolicy: 'freeze',
    drawPolicy: 'exact_tick_draw',
    aiPracticeScope: 'human_hero_vs_ai_villain',
    ranked: false,
    soloLeaderboardEligible: false
  });

  const ALLOWED_INPUT_TYPES = Object.freeze(['jump_start', 'jump_end', 'spawn_trap', 'ready', 'leave']);
  const ALLOWED_TRAP_KINDS = Object.freeze(['pit', 'bush', 'enemy']);
  const ALLOWED_ENVELOPE_KEYS = Object.freeze([
    'protocolVersion',
    'matchId',
    'roundId',
    'connectionEpoch',
    'sequence',
    'inputType',
    'payload',
    'clientTs'
  ]);
  const FORBIDDEN_AUTH_FIELDS = Object.freeze([
    'score',
    'x',
    'y',
    'vy',
    'cooldown',
    'elapsed',
    'role',
    'simTicks',
    'state',
    'seed'
  ]);

  function isPlainObject(val) {
    if (val === null || typeof val !== 'object') return false;
    if (Object.prototype.toString.call(val) !== '[object Object]') return false;
    const proto = Object.getPrototypeOf(val);
    if (proto === null) return true;
    return Object.getPrototypeOf(proto) === null;
  }

  function utf8ByteLength(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function reject(code, reason) {
    return Object.freeze({ ok: false, code, reason });
  }

  /**
   * Validates a client multiplayer input envelope against Doc 13 §5, M17, and MP-06.
   * @param {string|object} rawMsg Raw JSON string or parsed object
   * @param {object} seatCtx Authoritative server seat context:
   *   { matchId, roundId, connectionEpoch, lastSequence, role: 'villain'|'hero'|'lobby' }
   */
  function validateClientInputEnvelope(rawMsg, seatCtx) {
    if (!seatCtx || typeof seatCtx !== 'object') {
      return reject('INVALID_CONTEXT', 'Missing authoritative seat context');
    }

    let msg;
    let serialized;
    if (typeof rawMsg === 'string') {
      if (utf8ByteLength(rawMsg) > MAX_INPUT_BYTES) {
        return reject('PAYLOAD_TOO_LARGE', 'Message exceeds 512-byte limit');
      }
      try {
        msg = JSON.parse(rawMsg);
      } catch (_) {
        return reject('MALFORMED_JSON', 'Message is not valid JSON');
      }
    } else if (isPlainObject(rawMsg)) {
      try {
        serialized = JSON.stringify(rawMsg);
      } catch (_) {
        return reject('UNSERIALIZABLE', 'Message cannot be serialized');
      }
      if (utf8ByteLength(serialized) > MAX_INPUT_BYTES) {
        return reject('PAYLOAD_TOO_LARGE', 'Message exceeds 512-byte limit');
      }
      msg = rawMsg;
    } else {
      return reject('INVALID_TYPE', 'Message must be a JSON string or plain object');
    }

    if (!isPlainObject(msg)) {
      return reject('INVALID_SHAPE', 'Envelope must be a plain object');
    }

    const keys = Object.keys(msg);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (FORBIDDEN_AUTH_FIELDS.indexOf(k) !== -1) {
        return reject('FORBIDDEN_FIELD', 'Client-supplied authoritative field rejected: ' + k);
      }
      if (ALLOWED_ENVELOPE_KEYS.indexOf(k) === -1) {
        return reject('UNKNOWN_FIELD', 'Unknown envelope field: ' + k);
      }
    }

    if (msg.protocolVersion !== MP_PROTOCOL_VERSION) {
      return reject('PROTOCOL_MISMATCH', 'Unsupported protocolVersion');
    }
    if (typeof msg.matchId !== 'string' || !msg.matchId || msg.matchId !== seatCtx.matchId) {
      return reject('MATCH_MISMATCH', 'Invalid or mismatched matchId');
    }
    if (!Number.isInteger(msg.roundId) || msg.roundId !== seatCtx.roundId) {
      return reject('ROUND_MISMATCH', 'Stale or invalid roundId');
    }
    if (!Number.isInteger(msg.connectionEpoch) || msg.connectionEpoch !== seatCtx.connectionEpoch) {
      return reject('EPOCH_MISMATCH', 'Stale or invalid connectionEpoch');
    }
    if (!Number.isInteger(msg.sequence) || msg.sequence <= seatCtx.lastSequence || msg.sequence > 1000000000) {
      return reject('INVALID_SEQUENCE', 'Duplicate or out-of-order sequence');
    }
    if (typeof msg.inputType !== 'string' || ALLOWED_INPUT_TYPES.indexOf(msg.inputType) === -1) {
      return reject('INVALID_INPUT_TYPE', 'Unsupported inputType');
    }

    const role = seatCtx.role;
    if ((msg.inputType === 'jump_start' || msg.inputType === 'jump_end') && role !== 'villain') {
      return reject('ROLE_FORBIDDEN', 'Only the Villain seat may send jump inputs');
    }
    if (msg.inputType === 'spawn_trap' && role !== 'hero') {
      return reject('ROLE_FORBIDDEN', 'Only the Hero seat may send spawn_trap inputs');
    }

    let normalizedPayload = null;
    if (msg.inputType === 'spawn_trap') {
      if (!isPlainObject(msg.payload)) {
        return reject('INVALID_PAYLOAD', 'spawn_trap requires a plain payload object');
      }
      const pKeys = Object.keys(msg.payload);
      for (let i = 0; i < pKeys.length; i++) {
        if (FORBIDDEN_AUTH_FIELDS.indexOf(pKeys[i]) !== -1) {
          return reject('FORBIDDEN_FIELD', 'Forbidden payload field: ' + pKeys[i]);
        }
        if (pKeys[i] !== 'kind') {
          return reject('UNKNOWN_PAYLOAD_FIELD', 'Unexpected spawn_trap payload field: ' + pKeys[i]);
        }
      }
      if (ALLOWED_TRAP_KINDS.indexOf(msg.payload.kind) === -1) {
        return reject('INVALID_TRAP_KIND', 'Invalid trap kind');
      }
      normalizedPayload = Object.freeze({ kind: msg.payload.kind });
    } else if (msg.payload !== undefined && msg.payload !== null) {
      if (!isPlainObject(msg.payload) || Object.keys(msg.payload).length > 0) {
        return reject('UNEXPECTED_PAYLOAD', 'Payload must be empty for ' + msg.inputType);
      }
    }

    const clientTs = (typeof msg.clientTs === 'number' && Number.isFinite(msg.clientTs) && msg.clientTs >= 0)
      ? Math.floor(msg.clientTs)
      : null;

    return Object.freeze({
      ok: true,
      normalized: Object.freeze({
        protocolVersion: MP_PROTOCOL_VERSION,
        matchId: msg.matchId,
        roundId: msg.roundId,
        connectionEpoch: msg.connectionEpoch,
        sequence: msg.sequence,
        inputType: msg.inputType,
        payload: normalizedPayload,
        clientTs
      })
    });
  }

  /**
   * Resolves a two-round unranked multiplayer match outcome (Doc 13 §4, MP-02, MP-11).
   * Compares each seat's survival ticks while playing Villain; longer wins, equal ticks draw.
   */
  function resolveMatchOutcome(summary) {
    const s = summary && typeof summary === 'object' ? summary : {};
    const seatA = typeof s.seatA === 'string' && s.seatA ? s.seatA : 'seatA';
    const seatB = typeof s.seatB === 'string' && s.seatB ? s.seatB : 'seatB';
    const r1Ticks = Number.isInteger(s.seatAVillainTicks) && s.seatAVillainTicks >= 0
      ? Math.min(MP_POLICY.maxRoundTicks, s.seatAVillainTicks)
      : 0;
    const r2Ticks = Number.isInteger(s.seatBVillainTicks) && s.seatBVillainTicks >= 0
      ? Math.min(MP_POLICY.maxRoundTicks, s.seatBVillainTicks)
      : 0;

    if (s.terminalOverride && typeof s.terminalOverride === 'object') {
      const ov = s.terminalOverride;
      if (ov.type === 'forfeit' && (ov.winnerSeatId === seatA || ov.winnerSeatId === seatB)) {
        return Object.freeze({
          winnerSeatId: ov.winnerSeatId,
          outcome: 'forfeit',
          reason: typeof ov.reason === 'string' && ov.reason ? ov.reason : 'opponent_forfeit',
          seatAVillainTicks: r1Ticks,
          seatBVillainTicks: r2Ticks,
          ranked: false,
          soloLeaderboardEligible: false
        });
      }
      if (ov.type === 'no_contest') {
        return Object.freeze({
          winnerSeatId: null,
          outcome: 'no_contest',
          reason: typeof ov.reason === 'string' && ov.reason ? ov.reason : 'match_aborted',
          seatAVillainTicks: r1Ticks,
          seatBVillainTicks: r2Ticks,
          ranked: false,
          soloLeaderboardEligible: false
        });
      }
    }

    if (r1Ticks > r2Ticks) {
      return Object.freeze({
        winnerSeatId: seatA,
        outcome: 'win',
        reason: 'longer_villain_survival',
        seatAVillainTicks: r1Ticks,
        seatBVillainTicks: r2Ticks,
        ranked: false,
        soloLeaderboardEligible: false
      });
    }
    if (r2Ticks > r1Ticks) {
      return Object.freeze({
        winnerSeatId: seatB,
        outcome: 'win',
        reason: 'longer_villain_survival',
        seatAVillainTicks: r1Ticks,
        seatBVillainTicks: r2Ticks,
        ranked: false,
        soloLeaderboardEligible: false
      });
    }

    const bothTimeout = (r1Ticks === MP_POLICY.maxRoundTicks && r2Ticks === MP_POLICY.maxRoundTicks);
    return Object.freeze({
      winnerSeatId: null,
      outcome: 'draw',
      reason: bothTimeout ? 'both_survived_timeout' : 'equal_survival_ticks',
      seatAVillainTicks: r1Ticks,
      seatBVillainTicks: r2Ticks,
      ranked: false,
      soloLeaderboardEligible: false
    });
  }

  return Object.freeze({
    MP_PROTOCOL_VERSION,
    MP_RULESET_VERSION,
    MAX_INPUT_BYTES,
    MP_POLICY,
    ALLOWED_INPUT_TYPES,
    ALLOWED_TRAP_KINDS,
    FORBIDDEN_AUTH_FIELDS,
    validateClientInputEnvelope,
    resolveMatchOutcome
  });
});
