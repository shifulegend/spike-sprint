(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SpikeSprintBridge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  const BRIDGE_CONTRACT_VERSION = 1;
  const DEFAULT_TIMEOUT_MS = 3000;
  const ALLOWED_HOOKS = Object.freeze(['onRunStart', 'onRunComplete']);

  function isPlainObject(val) {
    if (val === null || typeof val !== 'object') return false;
    if (Object.prototype.toString.call(val) !== '[object Object]') return false;
    const proto = Object.getPrototypeOf(val);
    if (proto === null) return true;
    return Object.getPrototypeOf(proto) === null;
  }

  function deepCloneFreeze(value, seen) {
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'boolean' || t === 'number' || t === 'string') return value;
    if (t === 'function' || t === 'symbol' || t === 'bigint') {
      throw new TypeError('Bridge payload may only contain plain JSON-safe data');
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      throw new TypeError('Bridge payload must not contain ArrayBuffer or TypedArray views');
    }
    const visited = seen || new Set();
    if (visited.has(value)) {
      throw new TypeError('Bridge payload must not contain circular references');
    }
    visited.add(value);

    if (Array.isArray(value)) {
      const outArr = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        outArr[i] = deepCloneFreeze(value[i], visited);
      }
      visited.delete(value);
      return Object.freeze(outArr);
    }

    if (!isPlainObject(value)) {
      throw new TypeError('Bridge payload must only contain plain objects');
    }

    const outObj = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      outObj[k] = deepCloneFreeze(value[k], visited);
    }
    visited.delete(value);
    return Object.freeze(outObj);
  }

  function formatError(err) {
    if (!err) return 'Unknown bridge error';
    if (typeof err === 'string') return err;
    if (typeof err.message === 'string' && err.message) return err.message;
    try {
      return String(err);
    } catch (_) {
      return 'Unserializable bridge error';
    }
  }

  function createBridgeDispatcher(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const globalObj = opts.globalObj !== undefined
      ? opts.globalObj
      : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
    const propertyName = typeof opts.propertyName === 'string' && opts.propertyName
      ? opts.propertyName
      : 'SPIKE_SPRINT_BRIDGE';
    const timeoutMs = (typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0)
      ? Math.floor(opts.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

    let lastResult = null;

    function record(res) {
      lastResult = Object.freeze(Object.assign({}, res));
      return lastResult;
    }

    function dispatch(hookName, rawPayload) {
      if (ALLOWED_HOOKS.indexOf(hookName) === -1) {
        return Promise.resolve(record({ status: 'invalid-hook', hook: String(hookName) }));
      }
      if (!globalObj) {
        return Promise.resolve(record({ status: 'no-bridge', hook: hookName }));
      }

      let bridge;
      try {
        bridge = globalObj[propertyName];
      } catch (err) {
        return Promise.resolve(record({ status: 'sync-error', hook: hookName, error: formatError(err) }));
      }

      if (!bridge || (typeof bridge !== 'object' && typeof bridge !== 'function')) {
        return Promise.resolve(record({ status: 'no-bridge', hook: hookName }));
      }

      let hookFn;
      try {
        hookFn = bridge[hookName];
      } catch (err) {
        return Promise.resolve(record({ status: 'sync-error', hook: hookName, error: formatError(err) }));
      }

      if (typeof hookFn !== 'function') {
        return Promise.resolve(record({ status: 'no-hook', hook: hookName }));
      }

      let frozenPayload;
      try {
        frozenPayload = deepCloneFreeze(rawPayload);
      } catch (err) {
        return Promise.resolve(record({ status: 'payload-error', hook: hookName, error: formatError(err) }));
      }

      let ret;
      try {
        ret = hookFn.call(bridge, frozenPayload);
      } catch (err) {
        return Promise.resolve(record({ status: 'sync-error', hook: hookName, error: formatError(err) }));
      }

      let thenFn = null;
      if (ret !== null && (typeof ret === 'object' || typeof ret === 'function')) {
        try {
          if (typeof ret.then === 'function') {
            thenFn = ret.then;
          }
        } catch (err) {
          return Promise.resolve(record({ status: 'sync-error', hook: hookName, error: formatError(err) }));
        }
      }

      if (!thenFn) {
        return Promise.resolve(record({ status: 'ok', hook: hookName }));
      }

      return new Promise(function (resolve) {
        let settled = false;
        const timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          resolve(record({ status: 'timeout', hook: hookName, timeoutMs: timeoutMs }));
        }, timeoutMs);

        try {
          thenFn.call(
            ret,
            function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(record({ status: 'ok', hook: hookName }));
            },
            function (err) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(record({ status: 'async-error', hook: hookName, error: formatError(err) }));
            }
          );
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(record({ status: 'sync-error', hook: hookName, error: formatError(err) }));
        }
      });
    }

    function notifyRunStart(meta) {
      const m = meta && typeof meta === 'object' ? meta : {};
      return dispatch('onRunStart', {
        contractVersion: BRIDGE_CONTRACT_VERSION,
        simVersion: typeof m.simVersion === 'string' ? m.simVersion : '',
        modeKey: typeof m.modeKey === 'string' ? m.modeKey : 'villain',
        heroDiff: m.heroDiff ? String(m.heroDiff) : null,
        seed: (Number(m.seed) >>> 0),
        playerName: typeof m.playerName === 'string' ? m.playerName : ''
      });
    }

    function notifyRunComplete(summary) {
      const s = summary && typeof summary === 'object' ? summary : {};
      return dispatch('onRunComplete', {
        contractVersion: BRIDGE_CONTRACT_VERSION,
        simVersion: typeof s.simVersion === 'string' ? s.simVersion : '',
        runId: s.runId ? String(s.runId) : null,
        modeKey: typeof s.modeKey === 'string' ? s.modeKey : 'villain',
        heroDiff: s.heroDiff ? String(s.heroDiff) : null,
        seed: (Number(s.seed) >>> 0),
        score: Number.isFinite(s.score) ? Math.floor(s.score) : 0,
        elapsed: Number.isFinite(s.elapsed) ? Number(s.elapsed.toFixed(6)) : 0,
        totalTicks: (Number(s.totalTicks) >>> 0),
        cause: s.cause ? String(s.cause) : 'cap',
        playerName: typeof s.playerName === 'string' ? s.playerName : '',
        replay: s.replay ? s.replay : null
      });
    }

    function getLastResult() {
      return lastResult;
    }

    return Object.freeze({
      BRIDGE_CONTRACT_VERSION,
      DEFAULT_TIMEOUT_MS,
      dispatch,
      notifyRunStart,
      notifyRunComplete,
      getLastResult
    });
  }

  return Object.freeze({
    BRIDGE_CONTRACT_VERSION,
    DEFAULT_TIMEOUT_MS,
    ALLOWED_HOOKS,
    deepCloneFreeze,
    createBridgeDispatcher
  });
});
