// FIRELINE — Wildfire Air Tanker: headless entrypoint (Node 22).
// The grader runs `node /bot/main.ts` with no network, a read-only
// repo at /bot and an empty writable /output, 10 s wall, 1 CPU.
// This program runs the SAME deterministic fire simulation the browser
// game runs (one shared module, game/src/sim.js) under the scripted
// good autopilot, and writes the action log + results + a dossier to
// /output. No wall clock, no unseeded randomness, no network: two runs
// produce byte-identical output.
//
// Usage outside the grader: MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, runTo, metrics, policyGood, MAX_TICKS } from './game/src/sim.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const SEED = 7;
const DIFFICULTY = 'veteran';

// 1. Headless playthrough: the full game, autopilot at the stick.
const sim = createSim(SEED, DIFFICULTY);
const final = runTo(sim, MAX_TICKS, policyGood);

// 2. Action log: one line per tick, from the sim's own per-tick metrics.
//    (sim.log already holds exactly this; it is the deterministic record
//    of the run the grader replays.)
const actionLog = sim.log.map((m) => ({
  tick: m.tick,
  acresBurning: m.acresBurning,
  acresSaved: m.acresSaved,
  containment: m.containment,
  structuresAtRisk: m.structuresAtRisk,
  structuresLost: m.structuresLost,
  dropsLeft: m.dropsLeft,
  tankGal: m.tankGal,
}));

const results = {
  game: 'FIRELINE — Wildfire Air Tanker',
  seed: SEED,
  difficulty: DIFFICULTY,
  ticks: sim.tick,
  outcome: sim.outcome,
  outcomeTick: sim.outcomeTick,
  dropPasses: sim.dropPasses,
  acresBurned: final.acresBurned,
  acresSaved: final.acresSaved,
  containment: final.containment,
  structuresSaved: final.structuresSaved,
  structuresLost: final.structuresLost,
  structures: sim.structures.map((s) => ({ name: s.name, status: s.status })),
};

// 3. Output tree (mirrors the known-good best-game-01 hand-in shape).
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}
writeFileSync(join(out, 'game-log.json'), JSON.stringify(actionLog, null, 1) + '\n');
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1) + '\n');

// 4. Dossier: file manifest (sorted, so it is stable across runs).
function manifest(dir, base) {
  const rows = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = statSync(p);
    if (st.isDirectory()) rows.push(...manifest(p, rel));
    else rows.push({ file: rel, bytes: st.size });
  }
  return rows;
}
const dossier = {
  game: 'FIRELINE — Wildfire Air Tanker',
  seed: SEED,
  difficulty: DIFFICULTY,
  outcome: sim.outcome,
  files: manifest(join(here, 'game'), 'game'),
  screenshots: existsSync(join(here, 'screenshots'))
    ? readdirSync(join(here, 'screenshots')).sort().map((f) => ({
        file: 'screenshots/' + f,
        bytes: statSync(join(here, 'screenshots', f)).size,
      }))
    : [],
  results,
};
writeFileSync(join(out, 'dossier.json'), JSON.stringify(dossier, null, 1) + '\n');

console.log(
  'fireline: outcome=' + sim.outcome
  + ' containment=' + final.containment + '%'
  + ' acresSaved=' + final.acresSaved
  + ' structures=' + final.structuresSaved + '/6'
  + ' drops=' + sim.dropPasses,
);
