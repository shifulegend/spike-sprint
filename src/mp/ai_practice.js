(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('../sim/core.js') : (root && root.SpikeSprintSim)
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SpikeSprintAiPractice = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (DefaultSim) {
  'use strict';

  const SUPPORTED_PRACTICE_MODE = 'human_hero_vs_ai_villain';
  const PRACTICE_LABEL = 'PRACTICE: HUMAN HERO VS AI VILLAIN (UNRANKED)';

  function createAiPracticeSession(opts) {
    const cfg = opts && typeof opts === 'object' ? opts : {};
    const Sim = cfg.Sim || DefaultSim;
    const mode = typeof cfg.mode === 'string' && cfg.mode ? cfg.mode : SUPPORTED_PRACTICE_MODE;

    if (mode !== SUPPORTED_PRACTICE_MODE) {
      return Object.freeze({
        ok: false,
        code: 'AI_HERO_NOT_IMPLEMENTED',
        reason: 'Only Human-Hero vs AI-Villain practice is available; no AI-Hero trap policy exists (Doc 13 §7).'
      });
    }

    const heroDiff = typeof cfg.heroDiff === 'string' && Sim.HERO_DIFFICULTIES[cfg.heroDiff]
      ? cfg.heroDiff
      : 'hard';
    const seed = (Number(cfg.seed) >>> 0) || 1337;
    const maxTicks = Number.isInteger(cfg.maxTicks) && cfg.maxTicks > 0 ? cfg.maxTicks : 7200;

    const sim = Sim.createSim({
      modeKey: 'hero',
      heroDiff,
      seed,
      maxTicks
    });

    const metadata = Object.freeze({
      practiceMode: true,
      mode: SUPPORTED_PRACTICE_MODE,
      label: PRACTICE_LABEL,
      heroDiff,
      seed,
      maxTicks,
      ranked: false,
      soloLeaderboardEligible: false,
      multiplayerEligible: false,
      aiHeroSupported: false,
      offlineCapable: true
    });

    function spawnTrap(kind) {
      return sim.triggerHeroSpawn(kind);
    }

    function step() {
      return sim.step();
    }

    function getResult() {
      return Object.freeze({
        practiceMode: true,
        label: PRACTICE_LABEL,
        gameState: sim.state.gameState,
        survivalTicks: sim.state.simTicks,
        stopCause: sim.state.stopCause,
        ranked: false,
        soloLeaderboardEligible: false,
        multiplayerEligible: false
      });
    }

    return Object.freeze({
      ok: true,
      metadata,
      sim,
      spawnTrap,
      step,
      getResult
    });
  }

  return Object.freeze({
    SUPPORTED_PRACTICE_MODE,
    PRACTICE_LABEL,
    createAiPracticeSession
  });
});
