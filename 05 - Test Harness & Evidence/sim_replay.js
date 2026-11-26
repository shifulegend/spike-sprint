(function(root, factory){
  if(typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.SpikeSprintReplay = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const REPLAY_FORMAT_VERSION = 1;
  const BOT_HASH_PREFIX = '99d90952c2b64fac';
  const MAX_REPLAY_EVENTS = 50000;
  const MAX_REPLAY_TICKS = 72000; // 20 minutes at 60 Hz
  const MAX_PAYLOAD_BYTES = 262144; // 256 KB hard cap
  const MAX_B64_CHARS = 350000;

  const EVT = {
    JUMP_DOWN: 1,
    JUMP_UP: 2,
    SPAWN_PIT: 3,
    SPAWN_BUSH: 4,
    SPAWN_ENEMY: 5,
    CLEAR_HELD: 6
  };

  const VALID_MODES = { villain: true, hero: true };
  const VALID_DIFFS = { easy: true, normal: true, hard: true, insane: true };
  const VALID_CAUSES = { pit: true, enemy: true, barrel: true, cap: true };

  const B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_LUT = new Int16Array(128).fill(-1);
  for(let i = 0; i < B64_ALPHA.length; i++) B64_LUT[B64_ALPHA.charCodeAt(i)] = i;

  function encodeBytesToBase64(bytes){
    let out = '';
    const len = bytes.length;
    for(let i = 0; i < len; i += 3){
      const b0 = bytes[i];
      const b1 = i + 1 < len ? bytes[i + 1] : 0;
      const b2 = i + 2 < len ? bytes[i + 2] : 0;
      out += B64_ALPHA[b0 >> 2];
      out += B64_ALPHA[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < len ? B64_ALPHA[((b1 & 15) << 2) | (b2 >> 6)] : '=';
      out += i + 2 < len ? B64_ALPHA[b2 & 63] : '=';
    }
    return out;
  }

  function decodeBase64ToBytes(b64){
    if(typeof b64 !== 'string' || b64.length > MAX_B64_CHARS) return null;
    if(b64.length === 0) return new Uint8Array(0);
    if(b64.length % 4 !== 0) return null;
    let len = b64.length;
    if(b64.charCodeAt(len - 1) === 61) len--;
    if(len > 0 && b64.charCodeAt(len - 1) === 61) len--;
    const outLen = (len * 3) >> 2;
    if(outLen > MAX_PAYLOAD_BYTES) return null;
    const out = new Uint8Array(outLen);
    let o = 0;
    for(let i = 0; i < len; i += 4){
      const a0 = b64.charCodeAt(i);
      const a1 = b64.charCodeAt(i + 1);
      const a2 = i + 2 < len ? b64.charCodeAt(i + 2) : 65;
      const a3 = i + 3 < len ? b64.charCodeAt(i + 3) : 65;
      if(a0 >= 128 || a1 >= 128 || a2 >= 128 || a3 >= 128) return null;
      const c0 = B64_LUT[a0], c1 = B64_LUT[a1], c2 = B64_LUT[a2], c3 = B64_LUT[a3];
      if(c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;
      out[o++] = (c0 << 2) | (c1 >> 4);
      if(o < outLen) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
      if(o < outLen) out[o++] = ((c2 & 3) << 6) | c3;
    }
    return out;
  }

  function writeVarint(buf, val){
    let v = val >>> 0;
    while(v >= 0x80){
      buf.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    buf.push(v);
  }

  function encodeEvents(events){
    const bytes = [];
    let prevTick = 0;
    for(let i = 0; i < events.length; i++){
      const ev = events[i];
      const delta = ev.tick - prevTick;
      if(delta < 0) throw new Error('Replay events must be non-decreasing in tick order');
      prevTick = ev.tick;
      writeVarint(bytes, delta);
      bytes.push(ev.code & 0xff);
    }
    return new Uint8Array(bytes);
  }

  function decodeEvents(bytes, expectedCount){
    const events = [];
    let pos = 0;
    let tick = 0;
    while(pos < bytes.length){
      if(events.length >= MAX_REPLAY_EVENTS) return { ok: false, error: 'Event count exceeds limit' };
      let delta = 0;
      let shift = 0;
      let done = false;
      while(pos < bytes.length){
        const b = bytes[pos++];
        delta |= (b & 0x7f) << shift;
        if((b & 0x80) === 0){ done = true; break; }
        shift += 7;
        if(shift > 28) return { ok: false, error: 'Varint overflow' };
      }
      if(!done) return { ok: false, error: 'Truncated varint' };
      if(pos >= bytes.length) return { ok: false, error: 'Missing event code' };
      const code = bytes[pos++];
      if(code < 1 || code > 6) return { ok: false, error: 'Invalid event code' };
      tick += (delta >>> 0);
      if(tick > MAX_REPLAY_TICKS) return { ok: false, error: 'Event tick exceeds limit' };
      events.push({ tick, code });
    }
    if(expectedCount !== undefined && events.length !== expectedCount){
      return { ok: false, error: 'Event count mismatch' };
    }
    return { ok: true, events };
  }

  function fnv1a32(str, init){
    let h = init >>> 0;
    for(let i = 0; i < str.length; i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function computeIntegrityHash(env){
    const canonical = [
      env.formatVersion,
      env.simVersion,
      env.botHashPrefix,
      env.modeKey,
      env.heroDiff || '',
      env.seed >>> 0,
      env.finalTick >>> 0,
      env.finalScore,
      env.stopCause,
      env.eventCount >>> 0,
      env.eventsB64
    ].join('|');
    return fnv1a32(canonical, 0x811c9dc5) + fnv1a32('S2:' + canonical, 0x9e3779b9);
  }

  function createRecorder(opts, SimModule){
    if(!SimModule || typeof SimModule.createSim !== 'function'){
      throw new Error('SimModule with createSim() is required');
    }
    const sim = SimModule.createSim(opts);
    const events = [];

    function pushEvent(code){
      if(sim.state.gameState !== 'playing') return;
      if(events.length >= MAX_REPLAY_EVENTS) return;
      events.push({ tick: sim.state.simTicks, code });
    }

    function startJump(){
      pushEvent(EVT.JUMP_DOWN);
      return sim.startJump();
    }

    function endJump(){
      pushEvent(EVT.JUMP_UP);
      sim.endJump();
    }

    function clearHeldOnPause(){
      if(sim.state.jumpKeyDown){
        pushEvent(EVT.CLEAR_HELD);
        sim.state.jumpKeyDown = false;
      }
    }

    function triggerHeroSpawn(kind){
      const code = kind === 'pit' ? EVT.SPAWN_PIT : kind === 'bush' ? EVT.SPAWN_BUSH : kind === 'enemy' ? EVT.SPAWN_ENEMY : 0;
      if(!code) return false;
      pushEvent(code);
      return sim.triggerHeroSpawn(kind);
    }

    function step(){
      return sim.step();
    }

    function finalize(){
      const rawBytes = encodeEvents(events);
      const eventsB64 = encodeBytesToBase64(rawBytes);
      const envelope = {
        formatVersion: REPLAY_FORMAT_VERSION,
        simVersion: SimModule.SIM_VERSION,
        botHashPrefix: BOT_HASH_PREFIX,
        modeKey: sim.state.modeKey,
        heroDiff: sim.state.modeKey === 'hero' ? sim.state.heroDiff : null,
        seed: sim.state.seed >>> 0,
        finalTick: sim.state.simTicks >>> 0,
        finalScore: Math.floor(sim.state.score),
        stopCause: sim.state.stopCause || 'cap',
        eventCount: events.length,
        eventsB64
      };
      envelope.integrityHash = computeIntegrityHash(envelope);
      return envelope;
    }

    return {
      sim,
      events,
      startJump,
      endJump,
      clearHeldOnPause,
      triggerHeroSpawn,
      step,
      finalize
    };
  }

  function decodeReplay(envelope, SimModule){
    if(!envelope || typeof envelope !== 'object' || Array.isArray(envelope)){
      return { ok: false, error: 'Replay must be an object' };
    }
    if(envelope.formatVersion !== REPLAY_FORMAT_VERSION){
      return { ok: false, error: 'Unsupported replay formatVersion' };
    }
    if(SimModule && envelope.simVersion !== SimModule.SIM_VERSION){
      return { ok: false, error: 'Incompatible simVersion: ' + envelope.simVersion };
    }
    if(envelope.botHashPrefix !== BOT_HASH_PREFIX){
      return { ok: false, error: 'Incompatible botHashPrefix' };
    }
    if(!VALID_MODES[envelope.modeKey]){
      return { ok: false, error: 'Invalid modeKey' };
    }
    if(envelope.modeKey === 'hero' && !VALID_DIFFS[envelope.heroDiff]){
      return { ok: false, error: 'Invalid heroDiff' };
    }
    if(!VALID_CAUSES[envelope.stopCause]){
      return { ok: false, error: 'Invalid stopCause' };
    }
    if(!Number.isInteger(envelope.seed) || envelope.seed < 0 || envelope.seed > 0xffffffff){
      return { ok: false, error: 'Invalid seed' };
    }
    if(!Number.isInteger(envelope.finalTick) || envelope.finalTick < 0 || envelope.finalTick > MAX_REPLAY_TICKS){
      return { ok: false, error: 'Invalid finalTick' };
    }
    if(!Number.isInteger(envelope.finalScore) || envelope.finalScore < 0 || envelope.finalScore > 1e9){
      return { ok: false, error: 'Invalid finalScore' };
    }
    if(!Number.isInteger(envelope.eventCount) || envelope.eventCount < 0 || envelope.eventCount > MAX_REPLAY_EVENTS){
      return { ok: false, error: 'Invalid eventCount' };
    }
    const expectedHash = computeIntegrityHash(envelope);
    if(envelope.integrityHash !== expectedHash){
      return { ok: false, error: 'Integrity hash mismatch (tampered replay)' };
    }
    const bytes = decodeBase64ToBytes(envelope.eventsB64);
    if(!bytes) return { ok: false, error: 'Invalid Base64 payload' };
    const decoded = decodeEvents(bytes, envelope.eventCount);
    if(!decoded.ok) return decoded;
    return { ok: true, header: envelope, events: decoded.events, rawBytes: bytes.length };
  }

  function applyEvent(sim, code){
    if(code === EVT.JUMP_DOWN) sim.startJump();
    else if(code === EVT.JUMP_UP) sim.endJump();
    else if(code === EVT.SPAWN_PIT) sim.triggerHeroSpawn('pit');
    else if(code === EVT.SPAWN_BUSH) sim.triggerHeroSpawn('bush');
    else if(code === EVT.SPAWN_ENEMY) sim.triggerHeroSpawn('enemy');
    else if(code === EVT.CLEAR_HELD) sim.state.jumpKeyDown = false;
  }

  function verifyReplay(envelope, SimModule){
    const dec = decodeReplay(envelope, SimModule);
    if(!dec.ok) return dec;
    const sim = SimModule.createSim({
      modeKey: dec.header.modeKey,
      heroDiff: dec.header.heroDiff || 'normal',
      seed: dec.header.seed
    });
    const events = dec.events;
    let evIdx = 0;

    for(let t = 0; t < dec.header.finalTick; t++){
      while(evIdx < events.length && events[evIdx].tick === sim.state.simTicks){
        applyEvent(sim, events[evIdx].code);
        evIdx++;
      }
      if(sim.state.gameState !== 'playing') break;
      sim.step();
    }

    const actualScore = Math.floor(sim.state.score);
    const actualCause = sim.state.stopCause || 'cap';
    if(sim.state.simTicks !== dec.header.finalTick){
      return { ok: false, error: 'Replay tick mismatch: ' + sim.state.simTicks + ' vs ' + dec.header.finalTick };
    }
    if(actualScore !== dec.header.finalScore){
      return { ok: false, error: 'Replay score mismatch: ' + actualScore + ' vs ' + dec.header.finalScore };
    }
    if(actualCause !== dec.header.stopCause){
      return { ok: false, error: 'Replay stopCause mismatch: ' + actualCause + ' vs ' + dec.header.stopCause };
    }
    return {
      ok: true,
      finalTick: sim.state.simTicks,
      finalScore: actualScore,
      elapsed: sim.state.elapsed,
      stopCause: actualCause,
      rawBytes: dec.rawBytes,
      snapshot: sim.getSnapshot()
    };
  }

  return {
    REPLAY_FORMAT_VERSION,
    BOT_HASH_PREFIX,
    MAX_REPLAY_EVENTS,
    MAX_REPLAY_TICKS,
    MAX_PAYLOAD_BYTES,
    EVT,
    encodeBytesToBase64,
    decodeBase64ToBytes,
    encodeEvents,
    decodeEvents,
    computeIntegrityHash,
    createRecorder,
    decodeReplay,
    verifyReplay
  };
});
