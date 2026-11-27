(function(root, factory){
  if(typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.SpikeSprintReplayStore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const DB_NAME = 'spike_sprint_replays_v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'replays';

  function createReplayStore(opts){
    const cfg = opts || {};
    const idbFactory = cfg.indexedDB !== undefined
      ? cfg.indexedDB
      : (typeof globalThis !== 'undefined' && globalThis.indexedDB ? globalThis.indexedDB : null);
    const nav = cfg.navigator !== undefined
      ? cfg.navigator
      : (typeof globalThis !== 'undefined' && globalThis.navigator ? globalThis.navigator : null);

    const memoryMap = new Map();
    const knownRunIds = new Set();
    let dbPromise = null;
    let usingMemoryFallback = false;
    let persistRequested = false;
    let lastStorageWarning = null;

    function requestPersistenceOnce(){
      if(persistRequested) return Promise.resolve(false);
      persistRequested = true;
      try {
        if(nav && nav.storage && typeof nav.storage.persist === 'function'){
          return Promise.resolve(nav.storage.persist()).then(Boolean, () => false);
        }
      } catch(e){}
      return Promise.resolve(false);
    }

    function openDb(){
      if(usingMemoryFallback || !idbFactory){
        usingMemoryFallback = true;
        return Promise.resolve(null);
      }
      if(dbPromise) return dbPromise;
      dbPromise = new Promise(resolve => {
        try {
          const req = idbFactory.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            try {
              const db = req.result;
              if(!db.objectStoreNames.contains(STORE_NAME)){
                db.createObjectStore(STORE_NAME, { keyPath: 'runId' });
              }
            } catch(e){}
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => {
            usingMemoryFallback = true;
            lastStorageWarning = 'IndexedDB open failed; using in-memory fallback';
            resolve(null);
          };
        } catch(e){
          usingMemoryFallback = true;
          lastStorageWarning = 'IndexedDB blocked (' + (e && e.name ? e.name : 'Error') + '); using in-memory fallback';
          resolve(null);
        }
      });
      return dbPromise;
    }

    function hydrateKeys(){
      requestPersistenceOnce();
      return openDb().then(db => {
        if(!db) return Array.from(knownRunIds);
        return new Promise(resolve => {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAllKeys();
            req.onsuccess = () => {
              const keys = Array.isArray(req.result) ? req.result : [];
              for(const k of keys) knownRunIds.add(String(k));
              resolve(Array.from(knownRunIds));
            };
            req.onerror = () => resolve(Array.from(knownRunIds));
          } catch(e){
            usingMemoryFallback = true;
            resolve(Array.from(knownRunIds));
          }
        });
      });
    }

    function saveReplay(runId, envelope){
      if(!runId || !envelope) return Promise.resolve({ ok: false, persisted: false });
      const key = String(runId);
      memoryMap.set(key, envelope);
      knownRunIds.add(key);
      return openDb().then(db => {
        if(!db) return { ok: true, persisted: false, fallback: true };
        return new Promise(resolve => {
          try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put({ runId: key, envelope });
            req.onsuccess = () => resolve({ ok: true, persisted: true, fallback: false });
            req.onerror = () => {
              usingMemoryFallback = true;
              lastStorageWarning = 'IndexedDB write failed (quota/blocked); kept in memory';
              resolve({ ok: true, persisted: false, fallback: true });
            };
            tx.onerror = () => {
              usingMemoryFallback = true;
              lastStorageWarning = 'IndexedDB transaction failed; kept in memory';
              resolve({ ok: true, persisted: false, fallback: true });
            };
          } catch(e){
            usingMemoryFallback = true;
            lastStorageWarning = 'IndexedDB put threw; kept in memory';
            resolve({ ok: true, persisted: false, fallback: true });
          }
        });
      });
    }

    function loadRawReplay(runId){
      const key = String(runId || '');
      if(!key) return Promise.resolve(null);
      if(memoryMap.has(key)) return Promise.resolve(memoryMap.get(key));
      return openDb().then(db => {
        if(!db) return null;
        return new Promise(resolve => {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => {
              const rec = req.result;
              resolve(rec && rec.envelope ? rec.envelope : null);
            };
            req.onerror = () => resolve(null);
          } catch(e){
            resolve(null);
          }
        });
      });
    }

    function loadReplay(runId, ReplayMod, SimMod){
      return loadRawReplay(runId).then(env => {
        if(!env) return { ok: false, error: 'Replay not found' };
        if(!ReplayMod || typeof ReplayMod.decodeReplay !== 'function'){
          return { ok: false, error: 'Replay decoder unavailable' };
        }
        return ReplayMod.decodeReplay(env, SimMod);
      });
    }

    function gcReplays(keepRunIds){
      const keep = keepRunIds instanceof Set ? keepRunIds : new Set(keepRunIds || []);
      let removed = 0;
      for(const k of Array.from(memoryMap.keys())){
        if(!keep.has(k)){
          memoryMap.delete(k);
          knownRunIds.delete(k);
          removed++;
        }
      }
      return openDb().then(db => {
        if(!db) return { removed };
        return new Promise(resolve => {
          try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAllKeys();
            req.onsuccess = () => {
              const keys = Array.isArray(req.result) ? req.result : [];
              const toDelete = [];
              for(const k of keys){
                const ks = String(k);
                if(!keep.has(ks)){
                  toDelete.push(ks);
                  knownRunIds.delete(ks);
                }
              }
              if(!toDelete.length){ resolve({ removed }); return; }
              let remaining = toDelete.length;
              const doneOne = () => { remaining--; if(remaining <= 0) resolve({ removed: removed + toDelete.length }); };
              for(const ks of toDelete){
                const dreq = store.delete(ks);
                if(dreq){
                  dreq.onsuccess = doneOne;
                  dreq.onerror = doneOne;
                } else {
                  doneOne();
                }
              }
            };
            req.onerror = () => resolve({ removed });
          } catch(e){
            resolve({ removed });
          }
        });
      });
    }

    function hasReplaySync(runId){
      return Boolean(runId && knownRunIds.has(String(runId)));
    }

    function getStatus(){
      return {
        usingMemoryFallback,
        persistRequested,
        knownCount: knownRunIds.size,
        lastStorageWarning
      };
    }

    return {
      DB_NAME,
      STORE_NAME,
      requestPersistenceOnce,
      hydrateKeys,
      saveReplay,
      loadReplay,
      gcReplays,
      hasReplaySync,
      getStatus
    };
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
    createReplayStore
  };
});
