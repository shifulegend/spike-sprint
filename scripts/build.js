#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — Zero-Dependency Single-File Offline Build Script (ADR-09)
 * Inlines src/sim/core.js, src/sim/replay.js, src/storage/replays.js, and src/bridge/contract.js into src/template.html -> index.html.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'src', 'template.html');
const OUT_PATH = path.join(ROOT, 'index.html');
const WARN_BUDGET_BYTES = 120 * 1024; // 122,880 bytes (proposed ADR-09 warning-first budget)

const INLINES = [
  ['/* __INLINE_SIM_CORE__ */', path.join(ROOT, 'src', 'sim', 'core.js')],
  ['/* __INLINE_SIM_REPLAY__ */', path.join(ROOT, 'src', 'sim', 'replay.js')],
  ['/* __INLINE_REPLAY_STORE__ */', path.join(ROOT, 'src', 'storage', 'replays.js')],
  ['/* __INLINE_BRIDGE_CONTRACT__ */', path.join(ROOT, 'src', 'bridge', 'contract.js')],
];

let built = fs.readFileSync(TEMPLATE_PATH, 'utf8');
for (const [placeholder, filePath] of INLINES) {
  if (!built.includes(placeholder)) {
    throw new Error(`Placeholder ${placeholder} not found in ${TEMPLATE_PATH}`);
  }
  const code = fs.readFileSync(filePath, 'utf8').trim();
  built = built.replace(placeholder, () => code);
}

fs.writeFileSync(OUT_PATH, built, 'utf8');

const buf = Buffer.from(built, 'utf8');
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const lines = built.split('\n').length - (built.endsWith('\n') ? 1 : 0);

console.log(`Built ${OUT_PATH}`);
console.log(`Size: ${buf.length} bytes (${(buf.length / 1024).toFixed(2)} KB) | Lines: ${lines} | SHA-256: ${sha}`);
if (buf.length > WARN_BUDGET_BYTES) {
  console.warn(`WARNING: Build size ${buf.length} exceeds warning-first budget ${WARN_BUDGET_BYTES} bytes (non-blocking per Doc 16).`);
}
