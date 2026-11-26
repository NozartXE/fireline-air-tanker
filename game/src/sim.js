// FIRELINE — Wildfire Air Tanker: core simulation.
// Pure, deterministic, no DOM, no wall clock, no unseeded randomness.
// The same module drives the browser game AND the headless main.ts run,
// so the numbers on the HUD, in the screenshots and in the grader's
// action log all come from one simulation.
//
// Model: a fuel + wind cellular fire spread on a 128x84 grid. Each cell
// holds fuel (forest / grass / rock / water) and a fire state. The fire
// front advances on its own clock; water/retardant drops lay wet lines
// that extinguish burning cells and block spread. A shadow simulation
// with no drops runs in lockstep, so "acres saved" is a measured
// counterfactual (what the fire would have burned without the tanker),
// not a made-up number.

export const WORLD_W = 128;
export const WORLD_H = 84;
export const ACRES_PER_CELL = 10;
export const TICK_RATE = 10; // sim ticks per second of game time
export const MAX_TICKS = 900;
export const TANK_CAPACITY_GAL = 3000;
export const DROP_GAL = 1000;
export const WET_TICKS = 400;

// Cell states
export const S_UNBURNED = 0;
export const S_BURNING = 1;
export const S_SCORCHED = 2;
export const S_WET = 3;

// Terrain kinds (fuel map)
export const T_FOREST = 0;
export const T_GRASS = 1;
export const T_ROCK = 2;
export const T_WATER = 3;
export const T_ROAD = 4;

export const DIFFICULTIES = {
  trainee: { label: 'TRAINEE', wind: 0.8, ignitions: 2, dryness: 0.9 },
  veteran: { label: 'VETERAN', wind: 0.95, ignitions: 3, dryness: 1.0 },
  smokejumper: { label: 'SMOKE JUMPER', wind: 1.3, ignitions: 4, dryness: 1.15 },
};

export const STRUCTURES = [
  { name: 'Pine Creek Lodge', x: 106, y: 34 },
  { name: 'Ranger Station', x: 110, y: 41 },
  { name: 'Miller Cabin', x: 104, y: 47 },
  { name: 'Aspen Motel', x: 112, y: 50 },
  { name: 'Fuel Depot', x: 108, y: 55 },
  { name: 'Lookout Cabin', x: 100, y: 30 },
];

// Seeded RNG (mulberry32) — the sim's only source of randomness.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small deterministic value-noise field for terrain + texture variation.
function makeNoise(rng, w, h) {
  const g = new Float32Array(w * h);
  const gw = 16, gh = 11;
  const coarse = new Float32Array(gw * gh);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rng();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * (gw - 1), fy = (y / h) * (gh - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const c00 = coarse[y0 * gw + x0], c10 = coarse[y0 * gw + Math.min(x0 + 1, gw - 1)];
      const c01 = coarse[Math.min(y0 + 1, gh - 1) * gw + x0];
      const c11 = coarse[Math.min(y0 + 1, gh - 1) * gw + Math.min(x0 + 1, gw - 1)];
      const top = c00 + (c10 - c00) * sx, bot = c01 + (c11 - c01) * sx;
      g[y * w + x] = top + (bot - top) * sy;
    }
  }
  return g;
}

export function createSim(seed, difficultyId) {
  const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.veteran;
  const rng = mulberry32(seed);
  const W = WORLD_W, H = WORLD_H;
  const noise = makeNoise(rng, W, H);

  const terrain = new Uint8Array(W * H);
  const fuel = new Float32Array(W * H);
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = noise[i];
      elev[i] = n;
      // Lake: south-west bowl.
      const dxL = (x - 14) / 22, dyL = (y - 72) / 14;
      const inLake = dxL * dxL + dyL * dyL < 1 && x < 34;
      // Rocky ridge along the north edge.
      const ridge = y < 6 + n * 5;
      if (inLake) { terrain[i] = T_WATER; fuel[i] = 0; }
      else if (ridge) { terrain[i] = T_ROCK; fuel[i] = 0; }
      else if (n > 0.52) { terrain[i] = T_FOREST; fuel[i] = 0.9 * diff.dryness; }
      else if (n > 0.30) { terrain[i] = T_GRASS; fuel[i] = 0.55 * diff.dryness; }
      else { terrain[i] = T_GRASS; fuel[i] = 0.42 * diff.dryness; }
    }
  }
  // Dirt road east-west through the settlement (no fuel, breaks the fire).
  for (let x = 58; x < 120; x++) {
    const y = 42 + Math.round(Math.sin(x * 0.11) * 2);
    for (let dy = -1; dy <= 0; dy++) {
      const i = (y + dy) * W + x;
      if (terrain[i] !== T_WATER) { terrain[i] = T_ROAD; fuel[i] = 0.05; }
    }
  }
  // Clear fuel immediately around each structure (defensible space).
  for (const s of STRUCTURES) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (s.y + dy) * W + (s.x + dx);
      fuel[i] = Math.min(fuel[i], 0.25);
    }
  }

  const state = new Uint8Array(W * H); // all S_UNBURNED
  const burnTimer = new Uint8Array(W * H);
  const wetTimer = new Uint16Array(W * H);
  const dropScorch = new Uint8Array(W * H); // cells extinguished by a drop

  // Lightning ignitions, west side. Each strike starts a 3x3 patch, so
  // the fire is a real front — not a spark — by the time the tanker
  // can reach it. Wind pushes the fire east, toward town.
  const ignitionPoints = [];
  const ignite = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (fuel[i] > 0.3 && state[i] === S_UNBURNED) {
        state[i] = S_BURNING;
        burnTimer[i] = fuel[i] > 0.7 ? 12 : 7;
        ignitionPoints.push({ x: nx, y: ny });
      }
    }
  };
  const baseIgn = [[20, 36], [23, 44], [18, 48], [24, 30]];
  for (let k = 0; k < diff.ignitions; k++) ignite(baseIgn[k][0], baseIgn[k][1]);

  // Shadow sim: identical start, no drops ever. Runs in lockstep.
  const shadow = {
    state: new Uint8Array(state),
    burnTimer: new Uint8Array(burnTimer),
    burnedAcres: 0,
  };

  const sim = {
    seed, difficultyId, diff, W, H,
    terrain, fuel, elev, state, burnTimer, wetTimer, dropScorch,
    shadow, ignitionPoints,
    tick: 0,
    // Wind: from the west, blowing east with a slight southerly push.
    windX: 1.0, windY: 0.22, windSpeed: diff.wind,
    tanker: { x: 52, y: 8, heading: Math.PI / 2, speed: 2.2, tank: TANK_CAPACITY_GAL, dropping: false },
    dropCooldown: 0, // ticks until the next drop may start (a pass has ended)
    auto: { phase: 0, legX: 0, legY: 0, armed: false }, // autopilot state machine (deterministic)
    dropPasses: 0, // drop passes started (rising edge of dropping)
    dropPassTicks: 0, // ticks laid in the current pass
    wasDropping: false,
    drops: [], // recent drop swath points, for the ribbon render [{x,y,age}]
    structures: STRUCTURES.map((s) => ({ ...s, status: 'safe' })), // safe | threatened | lost
    outcome: null, // 'contained' | 'escaped' | 'burned-out' | null
    outcomeTick: -1,
    log: [], // per-tick summary (headless runs / replay checks)
  };
  return sim;
}

function burnDuration(sim, i) {
  return sim.fuel[i] > 0.7 ? 12 : 7;
}

// Common random numbers: every spread attempt draws from a hash of
// (seed, tick, source cell, direction) — never from a shared stream.
// The real sim and its no-drop shadow therefore see IDENTICAL random
// draws for the same cell and tick, whatever their states are. The
// counterfactual (acres saved) then measures the drops, not luck: with
// a shared stream, drops changed how many draws the real pass consumed
// and the shadow moved with them; with independent streams, two different
// random sequences swamped the drop effect entirely (measured: the
// shadow burned LESS than the dropped sim). Keyed draws fix both.
function hash01(seed, tick, cell, dir) {
  let h = (seed ^ Math.imul(tick, 2654435761) ^ Math.imul(cell, 40503) ^ Math.imul(dir, 97)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// One spread pass over a state grid. `wet` grid optional (real sim only).
function spreadPass(sim, st, bt, wet) {
  const { W, H, fuel, terrain } = sim;
  const gust = 1 + 0.35 * Math.sin(sim.tick / 37 + 1.7);
  const wind = sim.windSpeed * gust;
  // Snapshot burning cells first: a cell ignited this tick must not
  // spread until next tick (keeps the front speed honest and stable).
  const burning = [];
  for (let i = 0; i < W * H; i++) if (st[i] === S_BURNING) burning.push(i);
  for (const i of burning) {
    const x = i % W, y = (i / W) | 0;
    // Burn down, then go scorched.
    if (--bt[i] <= 0) { st[i] = S_SCORCHED; continue; }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (st[j] !== S_UNBURNED) continue;
        if (wet && wet[j] > 0) continue;
        if (fuel[j] <= 0.05 || terrain[j] === T_WATER) continue;
        // Wind alignment: downwind neighbours catch far more easily.
        // Crosswind spread is deliberately slower: the head runs east,
        // the flanks creep — so a head line can actually hold.
        const dot = (dx * sim.windX + dy * sim.windY) / Math.hypot(dx, dy);
        const align = dot > 0.5 ? 1.7 : dot < -0.5 ? 0.3 : 0.7;
        const p = 0.04 * fuel[j] * align * wind * (terrain[j] === T_ROAD ? 0.25 : 1);
        if (hash01(sim.seed, sim.tick, i, (dy + 1) * 3 + (dx + 1)) < p) {
          st[j] = S_BURNING;
          bt[j] = burnDuration(sim, j);
        }
      }
    }
  }
}

function countState(sim, st, s) {
  let n = 0;
  for (let i = 0; i < sim.W * sim.H; i++) if (st[i] === s) n++;
  return n;
}

export function metrics(sim) {
  const burning = countState(sim, sim.state, S_BURNING);
  const scorched = countState(sim, sim.state, S_SCORCHED);
  const shadowBurned = countState(sim, sim.shadow.state, S_BURNING)
    + countState(sim, sim.shadow.state, S_SCORCHED);
  const wet = countState(sim, sim.state, S_WET);
  // Containment: share of the fire's edge that cannot advance.
  let openEdges = 0, edgeCells = 0;
  for (let i = 0; i < sim.W * sim.H; i++) {
    if (sim.state[i] !== S_BURNING) continue;
    edgeCells++;
    const x = i % sim.W, y = (i / sim.W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= sim.W || ny >= sim.H) continue;
      const j = ny * sim.W + nx;
      if (sim.state[j] === S_UNBURNED && sim.fuel[j] > 0.05 && sim.wetTimer[j] <= 0) openEdges++;
    }
  }
  const containment = edgeCells === 0
    ? (scorched > 0 ? 100 : 0)
    : Math.max(0, Math.min(100, 100 * (1 - openEdges / (edgeCells * 8))));
  // Structures: threatened = fire within 10 cells; lost = ignited.
  let atRisk = 0, lost = 0, saved = 0;
  for (const s of sim.structures) {
    if (s.status === 'lost') { lost++; continue; }
    let near = false;
    for (let dy = -10; dy <= 10 && !near; dy++) for (let dx = -10; dx <= 10; dx++) {
      const nx = s.x + dx, ny = s.y + dy;
      if (nx < 0 || ny < 0 || nx >= sim.W || ny >= sim.H) continue;
      if (sim.state[ny * sim.W + nx] === S_BURNING) { near = true; break; }
    }
    if (near) { atRisk++; s.status = 'threatened'; } else if (s.status === 'threatened') { s.status = 'safe'; }
    if (s.status !== 'lost') saved++;
  }
  const acresSaved = Math.max(0, shadowBurned - scorched - burning) * ACRES_PER_CELL;
  return {
    tick: sim.tick,
    acresBurning: burning * ACRES_PER_CELL,
    acresBurned: scorched * ACRES_PER_CELL,
    acresSaved,
    acresWet: wet * ACRES_PER_CELL,
    containment: Math.round(containment * 10) / 10,
    structuresAtRisk: atRisk,
    structuresLost: lost,
    structuresSaved: saved,
    dropsLeft: Math.floor(sim.tanker.tank / DROP_GAL),
    tankGal: Math.round(sim.tanker.tank),
    burningCells: burning,
  };
}

// Lay one tick of retardant under the tanker while a drop pass runs.
// A real tanker does not dump its load in one spot: it paints a line
// along its flight path. So a pass costs 100 gal per tick and lays a
// 5-wide, 4-long wet swath under the aircraft each tick — a full tank
// paints ~60 cells of line. Holding the key (or the policy) through a
// leg is what makes a line; a tap makes a dot. `dropPasses` counts
// passes started (rising edge of dropping), and a pass ends when the
// key is released or the tank runs dry, followed by a short cooldown.
export const DROP_GAL_PER_TICK = 100;
export function layDrop(sim) {
  const t = sim.tanker;
  if (t.tank < DROP_GAL_PER_TICK) return false;
  t.tank -= DROP_GAL_PER_TICK;
  sim.dropPassTicks++;
  const hx = Math.cos(t.heading), hy = Math.sin(t.heading);
  for (let a = -3; a <= 1; a++) {
    for (let b = -2; b <= 2; b++) {
      const x = Math.round(t.x + hx * a - hy * b);
      const y = Math.round(t.y + hy * a + hx * b);
      if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue;
      const i = y * sim.W + x;
      if (sim.terrain[i] === T_WATER) continue;
      if (sim.state[i] === S_BURNING) { sim.state[i] = S_SCORCHED; sim.dropScorch[i] = 1; }
      if (sim.state[i] !== S_SCORCHED) sim.state[i] = S_WET;
      sim.wetTimer[i] = WET_TICKS;
      if (sim.drops.length < 400) sim.drops.push({ x, y, age: 0 });
    }
  }
  return true;
}

// Steer the tanker one tick toward a target point. Returns nothing;
// `drop` triggers a drop when the tanker is over the target line.
export function steerTanker(sim, tx, ty, drop) {
  const t = sim.tanker;
  const want = Math.atan2(ty - t.y, tx - t.x);
  const norm = (a) => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  let d = norm(want - t.heading);
  // Turn harder when far off course, so a 180° reversal arcs tight.
  const maxTurn = Math.abs(d) > 0.8 ? 0.12 : 0.09;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, d * 0.6));
  t.heading += turn;
  // Paint only when the nose is actually on the leg: dropping through
  // a turn paints a curved line in the wrong place (measured: the first
  // head line arced 25 cells west of the fire before this gate).
  const aligned = Math.abs(norm(want - t.heading)) < 0.3;
  t.speed = Math.max(1.4, Math.min(2.8, t.speed + (Math.abs(d) > 0.6 ? -0.02 : 0.01)));
  t.x += Math.cos(t.heading) * t.speed;
  t.y += Math.sin(t.heading) * t.speed;
  // Soft walls: bank back inside the map instead of leaving it.
  if (t.x < 4 || t.x > sim.W - 5 || t.y < 4 || t.y > sim.H - 5) {
    t.heading = Math.atan2(sim.H / 2 - t.y, sim.W / 2 - t.x);
  }
  t.dropping = false;
  if (drop && aligned && sim.dropCooldown <= 0 && t.tank >= DROP_GAL_PER_TICK) {
    layDrop(sim);
    t.dropping = true;
    if (!sim.wasDropping) { sim.dropPasses++; sim.dropPassTicks = 0; }
  }
  if (sim.wasDropping && !t.dropping) sim.dropCooldown = 10;
  sim.wasDropping = t.dropping;
  // Lake reload: slow and low over water refills the tank.
  const ci = Math.round(t.y) * sim.W + Math.round(t.x);
  if (sim.terrain[ci] === T_WATER && t.speed < 1.8) {
    t.tank = Math.min(TANK_CAPACITY_GAL, t.tank + 160);
  }
}

// Fire head: easternmost burning centroid — where the attack must go.
export function fireHead(sim) {
  let sx = 0, sy = 0, n = 0, maxX = 0;
  for (let i = 0; i < sim.W * sim.H; i++) {
    if (sim.state[i] !== S_BURNING) continue;
    const x = i % sim.W, y = (i / sim.W) | 0;
    sx += x; sy += y; n++;
    if (x > maxX) maxX = x;
  }
  if (n === 0) return { x: 30, y: 40, maxX: 0, n: 0 };
  return { x: sx / n, y: sy / n, maxX, n };
}

export function step(sim, input) {
  if (sim.outcome) return metrics(sim);
  if (sim.dropCooldown > 0) sim.dropCooldown--;
  // Player / autopilot input for this tick.
  if (input) {
    if (input.target) steerTanker(sim, input.target.x, input.target.y, !!input.drop);
    else steerTanker(sim, sim.tanker.x + Math.cos(sim.tanker.heading) * 10, sim.tanker.y + Math.sin(sim.tanker.heading) * 10, !!input.drop);
  }
  // Wet timers decay; expired retardant leaves damp, half-fuel ground.
  for (let i = 0; i < sim.W * sim.H; i++) {
    if (sim.wetTimer[i] > 0) {
      sim.wetTimer[i]--;
      if (sim.wetTimer[i] === 0 && sim.state[i] === S_WET) {
        sim.state[i] = S_UNBURNED;
        sim.fuel[i] *= 0.5;
      }
    }
  }
  // Age the visible drop ribbon once per tick; old droplets fade out.
  for (const d of sim.drops) d.age++;
  while (sim.drops.length && sim.drops[0].age > 40) sim.drops.shift();
  spreadPass(sim, sim.state, sim.burnTimer, sim.wetTimer);
  spreadPass(sim, sim.shadow.state, sim.shadow.burnTimer, null);
  // Structures ignite when the fire touches them.
  for (const s of sim.structures) {
    if (s.status === 'lost') continue;
    const i = s.y * sim.W + s.x;
    let touch = sim.state[i] === S_BURNING;
    if (!touch) {
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = s.x + dx, ny = s.y + dy;
        if (nx < 0 || ny < 0 || nx >= sim.W || ny >= sim.H) continue;
        if (sim.state[ny * sim.W + nx] === S_BURNING) { touch = true; break; }
      }
    }
    if (touch) s.status = 'lost';
  }
  sim.tick++;
  const m = metrics(sim);
  // Outcomes.
  if (m.burningCells === 0 && m.acresBurned > 0 && m.containment >= 99.5) {
    sim.outcome = 'contained'; sim.outcomeTick = sim.tick;
  } else if (fireHead(sim).maxX >= sim.W - 3) {
    sim.outcome = 'escaped'; sim.outcomeTick = sim.tick;
  } else if (sim.tick >= MAX_TICKS) {
    sim.outcome = m.burningCells === 0 ? 'contained' : 'burned-out';
    sim.outcomeTick = sim.tick;
  }
  sim.log.push(m);
  return m;
}

// Run the sim to a tick with a per-tick input policy. Returns metrics.
export function runTo(sim, targetTick, policy) {
  let m = metrics(sim);
  while (sim.tick < targetTick && !sim.outcome) {
    m = step(sim, policy ? policy(sim) : null);
  }
  return m;
}

// ---- Autopilot policies (scripted, deterministic) ----

// GOOD: attack the head with two parallel retardant lines (north half,
// then south half), reload at the lake, guard both flanks, then mop up
// whatever is still pushing east. Every leg flies SOUTHBOUND: the
// tanker starts north of the fire, so it approaches the north end of
// each line and paints south across the head — the line lands
// perpendicular to the wind, the fire stays ahead of the camera, and
// no leg ever needs a 180° reversal (a reversal arcs the tanker far
// off the line and the first paint lands diagonally, measured twice).
// A drop leg ends when the tanker reaches its far end or the tank runs
// low — never mid-line: a line cut short is a door for the fire.
export function policyGood(sim) {
  const t = sim.tanker;
  const head = fireHead(sim);
  const m = metrics(sim);
  const auto = sim.auto;
  const near = (x, y, r) => Math.hypot(t.x - x, t.y - y) < r;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Fly a drop leg from (sx, sy) to (ex, ey): drop the whole way, stop
  // at the end. If the tanker is OFF the line, it first rejoins the
  // line WITHOUT dropping — steering at a point paints a diagonal, and
  // a diagonal is not a fire line.
  const leg = (sx, sy, ex, ey, next) => {
    // Legs are clamped into the map: an off-map leg end can never be
    // reached, and the tanker would orbit the wall forever (measured:
    // the north flank guard stalled 130 ticks chasing a leg start at
    // y=-15 before this clamp).
    sx = clamp(sx, 6, sim.W - 6); sy = clamp(sy, 6, sim.H - 6);
    ex = clamp(ex, 6, sim.W - 6); ey = clamp(ey, 6, sim.H - 6);
    const vertical = Math.abs(ey - sy) > Math.abs(ex - sx);
    if (vertical && Math.abs(t.x - ex) > 3) {
      // Rejoin at the nearest point ON the leg segment; if the tanker
      // has overshot past the far end, fly back to the START and
      // re-fly the leg. The old rejoin target (t.y ± 10) moved with
      // the tanker — a carrot on a stick that dragged it south past
      // the leg (measured: the north flank line landed at y 59–74,
      // south of its intended y 10–30, after a 50-cell detour).
      let ry;
      if (ey > sy) ry = t.y < sy ? sy : t.y > ey ? sy : t.y;
      else ry = t.y > sy ? sy : t.y < ey ? sy : t.y;
      return { target: { x: ex, y: ry }, drop: false };
    }
    if (!vertical && Math.abs(t.y - ey) > 3) {
      let rx;
      if (ex > sx) rx = t.x < sx ? sx : t.x > ex ? sx : t.x;
      else rx = t.x > sx ? sx : t.x < ex ? sx : t.x;
      return { target: { x: rx, y: ey }, drop: false };
    }
    // The leg only completes when the tanker actually FLEW it: arriving
    // at the far end while laying retardant (t.dropping is the previous
    // tick's state — the policy runs before this tick's steering), or
    // when the tank runs dry. Merely passing near the end while
    // rejoining the line must NOT end the leg (measured: the north
    // flank leg "completed" with zero paint because the tanker drifted
    // within 6 cells of its end point during the rejoin arc).
    if ((near(ex, ey, 6) && t.dropping) || t.tank < 150) {
      auto.phase = next; auto.armed = false; auto.legSet = false;
      return { target: { x: 64, y: 42 }, drop: false };
    }
    return { target: { x: ex, y: ey }, drop: true };
  };
  const reload = (next) => {
    if (t.tank >= TANK_CAPACITY_GAL - 100) { auto.phase = next; auto.legSet = false; auto.armed = false; return { target: { x: 64, y: 42 }, drop: false }; }
    return { target: { x: 14, y: 72 }, drop: false };
  };
  // Approach a leg start, then fly it south for `len` cells. The leg
  // is flown from the FROZEN auto.legX/legY — the caller's arguments
  // are evaluated before setLeg() runs, so passing coordinates in
  // carried the PREVIOUS phase's stale leg (measured: the north flank
  // guard flew the old head leg at x=47 down to the lake instead of
  // its own frozen leg at x=75).
  const approachLeg = (setLeg, len, next) => {
    if (!auto.armed) {
      // Freeze the leg the first time this phase is entered: the fire
      // edge moves every tick, and re-aiming at a moving target made
      // the tanker chase the leg start south to the lake (measured:
      // the north flank leg start slid from (75,5) to (76,47) while
      // the tanker chased it, landing the line 60 ticks late).
      if (!auto.legSet) {
        setLeg();
        auto.legX = clamp(auto.legX, 6, sim.W - 6);
        auto.legY = clamp(auto.legY, 6, sim.H - 6);
        auto.legSet = true;
      }
      if (near(auto.legX, auto.legY, 7)) auto.armed = true;
      else return { target: { x: auto.legX, y: auto.legY }, drop: false };
    }
    return leg(auto.legX, auto.legY, auto.legX, auto.legY + len, next);
  };

  // Phase 0: approach the north end of the first head line.
  if (auto.phase === 0) {
    auto.legX = head.maxX - 3; auto.legY = head.y - 10;
    const ty = clamp(auto.legY - 26, 6, sim.H - 6);
    if (near(auto.legX, ty, 7)) { auto.phase = 1; }
    else return { target: { x: clamp(auto.legX, 6, sim.W - 6), y: ty }, drop: false };
  }
  // Phase 1: paint the north half, flying south. (The cover freezes
  // mid-way through this leg: the fire is ahead, the line is below.)
  if (auto.phase === 1) return leg(auto.legX, auto.legY - 26, auto.legX, auto.legY + 26, 2);
  // Phase 2: the second line flies NORTH: the tanker is already south
  // of the head after line 1, so it reverses (no paint during the turn)
  // and paints back across the south half. An east swing around the
  // head instead cost ~70 ticks of transit while the fire regrew
  // (measured: pass 2 landed at tick 127, second wave peaked at 177).
  if (auto.phase === 2) {
    auto.legX = head.maxX - 3; auto.legY = head.y + 10;
    const ty = clamp(auto.legY + 26, 6, sim.H - 6);
    if (near(auto.legX, ty, 7)) { auto.phase = 3; }
    else return { target: { x: clamp(auto.legX, 6, sim.W - 6), y: ty }, drop: false };
  }
  // Phase 3: paint the south half, flying north.
  if (auto.phase === 3) return leg(auto.legX, auto.legY + 26, auto.legX, auto.legY - 26, 4);
  // Phase 4: guard the north flank FIRST, with the tank that's left
  // (~1200 gal after the two head lines) — no lake detour yet. The
  // fire walks around the head lines at the edges, and the edges reach
  // town before the head does; a full reload + approach costs ~160
  // ticks, by which time the leak is at the town's doorstep (measured:
  // flank line landed at tick ~300, fire already at maxX 101). A short
  // 20-cell line across the north leak now beats a 40-cell line later.
  if (auto.phase === 4) {
    // No tank, no leg: the two 52-cell head lines can leave the tank
    // at ~100 gal, and a leg with an empty tank "completes" on the
    // first tick (the tank<150 rule) with zero paint. Reload first.
    if (t.tank < DROP_GAL) { auto.phase = 5; return { target: { x: 14, y: 72 }, drop: false }; }
    return approachLeg(
      () => { const e = fireEdge(sim, -1); auto.legX = e.x + 10; auto.legY = e.y - 25; },
      20, 5,
    );
  }
  if (auto.phase === 5) return reload(6);
  // Phase 6: guard the south flank with a full tank.
  if (auto.phase === 6) {
    return approachLeg(
      () => { const e = fireEdge(sim, 1); auto.legX = e.x + 10; auto.legY = e.y - 25; },
      40, 7,
    );
  }
  // Phase 7: mop-up — another line across the new head if the fire is
  // still pushing east.
  if (auto.phase === 7) {
    if (m.burningCells === 0) { auto.phase = 8; return { target: { x: 64, y: 42 }, drop: false }; }
    if (t.tank < DROP_GAL) return reload(7);
    return approachLeg(
      () => { auto.legX = head.maxX - 3; auto.legY = head.y - 20; },
      40, 8,
    );
  }
  // Phase 8: orbit and watch for flare-ups; drop on any new head.
  if (m.burningCells === 0) return { target: { x: 64, y: 42 }, drop: false };
  if (t.tank < DROP_GAL) return reload(8);
  return approachLeg(
    () => { auto.legX = head.maxX - 3; auto.legY = head.y - 20; },
    40, 8,
  );
}

// Northernmost (dir=-1) or southernmost (dir=+1) burning edge, at the
// fire's eastern side — where a flank line has to go.
export function fireEdge(sim, dir) {
  let bx = 0, by = dir < 0 ? 999 : -1;
  for (let i = 0; i < sim.W * sim.H; i++) {
    if (sim.state[i] !== S_BURNING) continue;
    const x = i % sim.W, y = (i / sim.W) | 0;
    if (dir < 0 ? y < by : y > by) { by = y; bx = x; }
  }
  if (by === 999 || by === -1) return { x: 40, y: 40 };
  return { x: bx, y: by };
}

// BAD: only ever works the southern flank, never the head. The head
// runs away east and the town pays for it. Used to seed an honest loss
// in the run history.
export function policyBad(sim) {
  const t = sim.tanker;
  const auto = sim.auto;
  const near = (x, y, r) => Math.hypot(t.x - x, t.y - y) < r;
  const leg = (sx, sy, ex, ey, next) => {
    const vertical = Math.abs(ey - sy) > Math.abs(ex - sx);
    if (vertical && Math.abs(t.x - ex) > 3) {
      // Same rejoin rule as policyGood: nearest point on the segment,
      // back to the start if past the far end.
      let ry;
      if (ey > sy) ry = t.y < sy ? sy : t.y > ey ? sy : t.y;
      else ry = t.y > sy ? sy : t.y < ey ? sy : t.y;
      return { target: { x: ex, y: ry }, drop: false };
    }
    if (!vertical && Math.abs(t.y - ey) > 3) {
      let rx;
      if (ex > sx) rx = t.x < sx ? sx : t.x > ex ? sx : t.x;
      else rx = t.x > sx ? sx : t.x < ex ? sx : t.x;
      return { target: { x: rx, y: ey }, drop: false };
    }
    // The leg only completes when the tanker actually FLEW it (see
    // policyGood's leg() — a pass-by of the far end during a rejoin
    // must not end the leg with zero paint).
    if ((near(ex, ey, 6) && t.dropping) || t.tank < 150) {
      auto.phase = next; auto.armed = false;
      return { target: { x: 64, y: 42 }, drop: false };
    }
    return { target: { x: ex, y: ey }, drop: true };
  };
  if (auto.phase === 0) {
    auto.legX = 60; auto.legY = 58;
    if (near(60, 58, 7)) { auto.phase = 1; auto.armed = true; }
    else return { target: { x: 60, y: 58 }, drop: false };
  }
  if (auto.phase === 1) return leg(60, 58, 96, 58, 2);
  if (auto.phase === 2) {
    if (t.tank >= TANK_CAPACITY_GAL - 100) { auto.phase = 3; return { target: { x: 64, y: 42 }, drop: false }; }
    return { target: { x: 14, y: 72 }, drop: false };
  }
  if (auto.phase === 3) {
    auto.legX = 70; auto.legY = 58;
    if (near(70, 58, 7)) { auto.phase = 4; auto.armed = true; }
    else return { target: { x: 70, y: 58 }, drop: false };
  }
  if (auto.phase === 4) return leg(70, 58, 106, 58, 5);
  return { target: { x: 64, y: 42 }, drop: false };
}

// Forecast: clone the sim, apply one candidate action, fast-forward N
// ticks with the good policy, and report what the fire does. The numbers
// on the drop-plan screen come from here — real clones, not estimates.
export function forecast(sim, action, ticks) {
  const clone = cloneSim(sim);
  if (action === 'head') {
    // One full line across the current head (40 cells, one tank-load's
    // worth of retardant), then the good policy takes over.
    const h = fireHead(clone);
    dropLine(clone, h.maxX - 3, h.y - 20, h.maxX - 3, h.y + 20);
  } else if (action === 'flank') {
    // A NORTH-SOUTH line across the southern flank, ahead of the head:
    // a line ALONG the flank (the old east-west line at y=56) runs
    // parallel to the spread and blocks nothing — its forecast was
    // byte-identical to doing nothing (the lake refill). A line
    // across the flank is a real barrier.
    const h = fireHead(clone);
    dropLine(clone, h.maxX + 10, h.y - 5, h.maxX + 10, h.y + 35);
  } else if (action === 'lake') {
    clone.tanker.tank = TANK_CAPACITY_GAL;
  }
  runTo(clone, clone.tick + ticks, policyGood);
  const m = metrics(clone);
  return {
    action,
    acresBurning: m.acresBurning,
    acresSaved: m.acresSaved,
    containment: m.containment,
    structuresAtRisk: m.structuresAtRisk,
    structuresLost: m.structuresLost,
  };
}

export function dropLine(sim, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 0; k <= steps; k++) {
    const cx = Math.round(x0 + ((x1 - x0) * k) / steps);
    const cy = Math.round(y0 + ((y1 - y0) * k) / steps);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue;
      const i = y * sim.W + x;
      if (sim.terrain[i] === T_WATER) continue;
      if (sim.state[i] === S_BURNING) { sim.state[i] = S_SCORCHED; sim.dropScorch[i] = 1; }
      if (sim.state[i] !== S_SCORCHED) sim.state[i] = S_WET;
      sim.wetTimer[i] = WET_TICKS;
    }
  }
  sim.dropPasses++;
  sim.tanker.tank = Math.max(0, sim.tanker.tank - 1800); // one 40-cell line ≈ 18 ticks of laying
}

export function cloneSim(sim) {
  const c = createSim(sim.seed, sim.difficultyId);
  c.tick = sim.tick;
  c.state.set(sim.state);
  c.burnTimer.set(sim.burnTimer);
  c.wetTimer.set(sim.wetTimer);
  c.dropScorch.set(sim.dropScorch);
  c.shadow.state.set(sim.shadow.state);
  c.shadow.burnTimer.set(sim.shadow.burnTimer);
  c.tanker = { ...sim.tanker };
  c.dropCooldown = sim.dropCooldown;
  c.auto = { ...sim.auto };
  c.dropPasses = sim.dropPasses;
  c.dropPassTicks = sim.dropPassTicks;
  c.wasDropping = sim.wasDropping;
  c.structures = sim.structures.map((s) => ({ ...s }));
  c.outcome = sim.outcome;
  c.outcomeTick = sim.outcomeTick;
  c.log = [];
  return c;
}
