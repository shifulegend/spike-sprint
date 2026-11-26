#!/usr/bin/env node
'use strict';

/**
 * Spike Sprint — Zero-Dependency Single-File Offline Build Script (ADR-09)
 * Inlines src/sim/core.js into src/template.html -> index.html.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SIM_PATH = path.join(ROOT, 'src', 'sim', 'core.js');
const TEMPLATE_PATH = path.join(ROOT, 'src', 'template.html');
const OUT_PATH = path.join(ROOT, 'index.html');
const PLACEHOLDER = '/* __INLINE_SIM_CORE__ */';
const WARN_BUDGET_BYTES = 120 * 1024; // 122,880 bytes (proposed ADR-09 warning-first budget)

const simCode = fs.readFileSync(SIM_PATH, 'utf8').trim();
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

if (!template.includes(PLACEHOLDER)) {
  throw new Error(`Placeholder ${PLACEHOLDER} not found in ${TEMPLATE_PATH}`);
}

const built = template.replace(PLACEHOLDER, () => simCode);
fs.writeFileSync(OUT_PATH, built, 'utf8');

const buf = Buffer.from(built, 'utf8');
const sha = crypto.createHash('sha256').update(buf).digest('hex');
const lines = built.split('\n').length - (built.endsWith('\n') ? 1 : 0);

console.log(`Built ${OUT_PATH}`);
console.log(`Size: ${buf.length} bytes (${(buf.length / 1024).toFixed(2)} KB) | Lines: ${lines} | SHA-256: ${sha}`);
if (buf.length > WARN_BUDGET_BYTES) {
  console.warn(`WARNING: Build size ${buf.length} exceeds warning budget ${WARN_BUDGET_BYTES} bytes.`);
}
