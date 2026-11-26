(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('../sim/core.js') : (root && root.SpikeSprintSim)
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SpikeSprintNetSim = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DefaultSim) {
  'use strict';

  function createNetworkSimulator(opts) {
    const cfg = opts && typeof opts === 'object' ? opts : {};
    const Sim = cfg.Sim || DefaultSim;
    const seed = (Number(cfg.seed) >>> 0) || 4242;
    const rand = Sim.createPrng(seed);
    const rttMs = Number.isFinite(cfg.rttMs) && cfg.rttMs >= 0 ? cfg.rttMs : 100;
    const jitterMs = Number.isFinite(cfg.jitterMs) && cfg.jitterMs >= 0 ? cfg.jitterMs : 15;
    const dropRate = Number.isFinite(cfg.dropRate) && cfg.dropRate >= 0 ? Math.min(1, cfg.dropRate) : 0;
    const dupRate = Number.isFinite(cfg.dupRate) && cfg.dupRate >= 0 ? Math.min(1, cfg.dupRate) : 0;

    const queue = [];
    let sent = 0;
    let delivered = 0;
    let dropped = 0;
    let duplicated = 0;
    let maxOneWayMs = 0;
    let orderCounter = 0;

    function sampleOneWayMs() {
      const half = rttMs / 2;
      const offset = (rand() * 2 - 1) * jitterMs;
      const d = Math.max(1, Math.round(half + offset));
      if (d > maxOneWayMs) maxOneWayMs = d;
      return d;
    }

    function send(nowMs, packet) {
      sent += 1;
      if (dropRate > 0 && rand() < dropRate) {
        dropped += 1;
        return false;
      }
      const delay = sampleOneWayMs();
      queue.push({
        deliverAtMs: nowMs + delay,
        order: orderCounter++,
        packet,
        isDuplicate: false
      });
      if (dupRate > 0 && rand() < dupRate) {
        duplicated += 1;
        const dupDelay = delay + Math.max(1, Math.round(rand() * Math.max(5, jitterMs)));
        queue.push({
          deliverAtMs: nowMs + dupDelay,
          order: orderCounter++,
          packet,
          isDuplicate: true
        });
      }
      return true;
    }

    function drainDue(nowMs) {
      const due = [];
      const keep = [];
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].deliverAtMs <= nowMs) due.push(queue[i]);
        else keep.push(queue[i]);
      }
      queue.length = 0;
      for (let i = 0; i < keep.length; i++) queue.push(keep[i]);
      due.sort((a, b) => (a.deliverAtMs - b.deliverAtMs) || (a.order - b.order));
      delivered += due.length;
      return due;
    }

    function pendingCount() {
      return queue.length;
    }

    function getStats() {
      return Object.freeze({
        seed,
        rttMs,
        jitterMs,
        dropRate,
        dupRate,
        sent,
        delivered,
        dropped,
        duplicated,
        maxOneWayMs
      });
    }

    return Object.freeze({
      send,
      drainDue,
      pendingCount,
      getStats
    });
  }

  return Object.freeze({ createNetworkSimulator });
});
