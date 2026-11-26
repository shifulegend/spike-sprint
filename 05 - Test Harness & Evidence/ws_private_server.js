'use strict';

/**
 * Spike Sprint — Local WebSocket Private Room Server (ws v8.11.0)
 * Wraps transport-agnostic src/mp/room_engine.js over real localhost WebSockets
 * for Gate B two-client end-to-end verification in offline/CI environments.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const RoomEngine = require('../src/mp/room_engine.js');

function createWsPrivateServer(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const port = Number.isInteger(opts.port) ? opts.port : 0;
  const tickMs = Number.isFinite(opts.tickMs) && opts.tickMs > 0 ? opts.tickMs : (1000 / 60);
  const policyOverrides = opts.policyOverrides || {};

  const rooms = new Map(); // inviteCode -> { engine, clients: Map<seatId, ws>, timer }
  let server = null;
  let wss = null;
  let actualPort = null;

  function nowMs() {
    return performance.now();
  }

  function safeSend(ws, obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  }

  function broadcastState(roomRec) {
    const snap = roomRec.engine.getPublicSnapshot();
    const payload = { type: 'state', snapshot: snap };
    for (const ws of roomRec.clients.values()) {
      safeSend(ws, payload);
    }
  }

  function startRoomTicker(roomRec) {
    if (roomRec.timer) return;
    roomRec.timer = setInterval(() => {
      const prev = roomRec.engine.getPublicSnapshot().state;
      roomRec.engine.stepTick(nowMs());
      const nextSnap = roomRec.engine.getPublicSnapshot();
      if (nextSnap.state !== prev || nextSnap.state === 'result') {
        broadcastState(roomRec);
      }
      if (nextSnap.state === 'result' || nextSnap.state === 'aborted' || nextSnap.state === 'expired') {
        clearInterval(roomRec.timer);
        roomRec.timer = null;
      }
    }, tickMs);
  }

  function handleMessage(ws, raw) {
    let msg;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (Buffer.byteLength(text, 'utf8') > 1024) {
        return safeSend(ws, { type: 'error', code: 'PAYLOAD_TOO_LARGE' });
      }
      msg = JSON.parse(text);
    } catch (_) {
      return safeSend(ws, { type: 'error', code: 'MALFORMED_JSON' });
    }

    if (!msg || typeof msg !== 'object') {
      return safeSend(ws, { type: 'error', code: 'INVALID_SHAPE' });
    }

    if (msg.type === 'create_room') {
      const engine = RoomEngine.createPrivateRoomEngine({
        matchSeed: msg.matchSeed || 2026,
        createdAtMs: nowMs(),
        policyOverrides
      });
      const joinRes = engine.joinSeat({
        playerId: msg.playerId,
        displayName: msg.displayName,
        nowMs: nowMs()
      });
      if (!joinRes.ok) {
        return safeSend(ws, { type: 'error', code: joinRes.code, reason: joinRes.reason });
      }
      const roomRec = { engine, clients: new Map([[joinRes.seatId, ws]]), timer: null };
      rooms.set(engine.inviteCode, roomRec);
      startRoomTicker(roomRec);
      return safeSend(ws, {
        type: 'room_created',
        inviteCode: engine.inviteCode,
        matchId: engine.matchId,
        seatId: joinRes.seatId,
        seatToken: joinRes.seatToken,
        connectionEpoch: joinRes.connectionEpoch,
        snapshot: engine.getPublicSnapshot()
      });
    }

    const roomRec = rooms.get(msg.inviteCode);
    if (!roomRec) {
      return safeSend(ws, { type: 'error', code: 'ROOM_NOT_FOUND' });
    }

    if (msg.type === 'join_room') {
      const joinRes = roomRec.engine.joinSeat({
        playerId: msg.playerId,
        displayName: msg.displayName,
        nowMs: nowMs()
      });
      if (!joinRes.ok) {
        return safeSend(ws, { type: 'error', code: joinRes.code, reason: joinRes.reason });
      }
      roomRec.clients.set(joinRes.seatId, ws);
      safeSend(ws, {
        type: 'room_joined',
        inviteCode: roomRec.engine.inviteCode,
        matchId: roomRec.engine.matchId,
        seatId: joinRes.seatId,
        seatToken: joinRes.seatToken,
        connectionEpoch: joinRes.connectionEpoch,
        snapshot: roomRec.engine.getPublicSnapshot()
      });
      broadcastState(roomRec);
      return;
    }

    if (msg.type === 'ready') {
      const res = roomRec.engine.setReady({
        seatId: msg.seatId,
        seatToken: msg.seatToken,
        ready: msg.ready !== false,
        nowMs: nowMs()
      });
      if (!res.ok) {
        return safeSend(ws, { type: 'error', code: res.code, reason: res.reason });
      }
      broadcastState(roomRec);
      return;
    }

    if (msg.type === 'input') {
      const res = roomRec.engine.submitInput({
        seatId: msg.seatId,
        seatToken: msg.seatToken,
        rawMsg: msg.envelope,
        nowMs: nowMs()
      });
      if (!res.ok) {
        return safeSend(ws, { type: 'input_rejected', code: res.code, reason: res.reason });
      }
      return;
    }

    if (msg.type === 'leave') {
      const res = roomRec.engine.leaveSeat({
        seatId: msg.seatId,
        seatToken: msg.seatToken,
        nowMs: nowMs()
      });
      if (!res.ok) {
        return safeSend(ws, { type: 'error', code: res.code, reason: res.reason });
      }
      broadcastState(roomRec);
      return;
    }

    return safeSend(ws, { type: 'error', code: 'UNKNOWN_TYPE' });
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer();
      wss = new WebSocketServer({ server });
      wss.on('connection', (ws) => {
        ws.on('message', (data) => handleMessage(ws, data));
      });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        actualPort = server.address().port;
        resolve(actualPort);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      for (const rec of rooms.values()) {
        if (rec.timer) clearInterval(rec.timer);
        for (const ws of rec.clients.values()) {
          try { ws.terminate(); } catch (_) {}
        }
      }
      rooms.clear();
      if (wss) {
        wss.close(() => {
          if (server) server.close(() => resolve());
          else resolve();
        });
      } else if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  return Object.freeze({
    start,
    stop,
    getPort: () => actualPort,
    getRoom: (inviteCode) => rooms.get(inviteCode) || null
  });
}

module.exports = { createWsPrivateServer };
