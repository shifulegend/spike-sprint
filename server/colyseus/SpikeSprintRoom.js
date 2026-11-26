'use strict';

/**
 * Spike Sprint — Thin Colyseus Room Adapter (Doc 13 §1 & §5)
 * Delegates 100% of game rules, envelope validation, role swap, and outcome
 * resolution to transport-agnostic src/mp/room_engine.js.
 */

const RoomEngine = require('../../src/mp/room_engine.js');

function createSpikeSprintRoomClass(BaseRoom) {
  const SuperRoom = BaseRoom || class MinimalBaseRoom {
    constructor() {
      this.maxClients = 2;
      this._handlers = new Map();
      this._interval = null;
    }
    onMessage(type, fn) { this._handlers.set(type, fn); }
    setSimulationInterval(fn, ms) { this._interval = { fn, ms }; }
    broadcast() {}
  };

  return class SpikeSprintRoom extends SuperRoom {
    onCreate(options) {
      this.maxClients = 2;
      this.sessionToSeat = new Map();
      const opts = options && typeof options === 'object' ? options : {};
      this.engine = RoomEngine.createPrivateRoomEngine({
        matchId: opts.matchId,
        inviteCode: opts.inviteCode,
        matchSeed: opts.matchSeed || 2026,
        createdAtMs: typeof opts.nowMs === 'number' ? opts.nowMs : performance.now(),
        policyOverrides: opts.policyOverrides
      });

      this.onMessage('ready', (client, payload) => {
        const seat = this.sessionToSeat.get(client.sessionId);
        if (!seat) return;
        const res = this.engine.setReady({
          seatId: seat.seatId,
          seatToken: seat.seatToken,
          ready: !(payload && payload.ready === false),
          nowMs: performance.now()
        });
        if (!res.ok) client.send('error', res);
        else this.broadcast('state', this.engine.getPublicSnapshot());
      });

      this.onMessage('input', (client, envelope) => {
        const seat = this.sessionToSeat.get(client.sessionId);
        if (!seat) return;
        const res = this.engine.submitInput({
          seatId: seat.seatId,
          seatToken: seat.seatToken,
          rawMsg: envelope,
          nowMs: performance.now()
        });
        if (!res.ok) client.send('input_rejected', res);
      });

      this.onMessage('reconnect', (client, payload) => {
        const p = payload && typeof payload === 'object' ? payload : {};
        const res = this.engine.reconnectSeat({
          seatId: p.seatId,
          seatToken: p.seatToken,
          nowMs: performance.now()
        });
        if (!res.ok) return client.send('error', res);
        this.sessionToSeat.set(client.sessionId, { seatId: res.seatId, seatToken: res.seatToken });
        client.send('reconnected', {
          seatId: res.seatId,
          seatToken: res.seatToken,
          connectionEpoch: res.connectionEpoch,
          graceRemainingMs: res.graceRemainingMs,
          snapshot: res.snapshot
        });
        this.broadcast('state', this.engine.getPublicSnapshot());
      });

      this.onMessage('leave', (client) => {
        const seat = this.sessionToSeat.get(client.sessionId);
        if (!seat) return;
        this.engine.leaveSeat({
          seatId: seat.seatId,
          seatToken: seat.seatToken,
          nowMs: performance.now()
        });
        this.broadcast('state', this.engine.getPublicSnapshot());
      });

      this.setSimulationInterval(() => {
        const prev = this.engine.getPublicSnapshot().state;
        this.engine.stepTick(performance.now());
        const nextSnap = this.engine.getPublicSnapshot();
        if (nextSnap.state !== prev || nextSnap.state === 'result') {
          this.broadcast('state', nextSnap);
        }
      }, 1000 / 60);
    }

    onJoin(client, options) {
      const opts = options && typeof options === 'object' ? options : {};
      const joinRes = this.engine.joinSeat({
        playerId: opts.playerId || client.sessionId,
        displayName: opts.displayName || 'PLAYER',
        nowMs: performance.now()
      });
      if (!joinRes.ok) {
        const err = new Error(joinRes.reason || joinRes.code);
        err.code = joinRes.code;
        throw err;
      }
      this.sessionToSeat.set(client.sessionId, {
        seatId: joinRes.seatId,
        seatToken: joinRes.seatToken
      });
      client.send('seat_assigned', {
        matchId: joinRes.matchId,
        inviteCode: joinRes.inviteCode,
        seatId: joinRes.seatId,
        seatToken: joinRes.seatToken,
        connectionEpoch: joinRes.connectionEpoch
      });
      this.broadcast('state', this.engine.getPublicSnapshot());
    }

    onLeave(client, consented) {
      const seat = this.sessionToSeat.get(client.sessionId);
      if (seat) {
        if (consented === false) {
          this.engine.disconnectSeat({ seatId: seat.seatId, nowMs: performance.now() });
        } else {
          this.engine.leaveSeat({
            seatId: seat.seatId,
            seatToken: seat.seatToken,
            nowMs: performance.now()
          });
          this.sessionToSeat.delete(client.sessionId);
        }
        this.broadcast('state', this.engine.getPublicSnapshot());
      }
    }

    onDispose() {
      this.sessionToSeat.clear();
    }
  };
}

let ColyseusRoomBase = null;
try {
  ColyseusRoomBase = require('colyseus').Room;
} catch (_) {
  ColyseusRoomBase = null;
}

const SpikeSprintRoom = createSpikeSprintRoomClass(ColyseusRoomBase);

module.exports = {
  SpikeSprintRoom,
  createSpikeSprintRoomClass
};
