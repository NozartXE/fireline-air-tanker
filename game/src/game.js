// FIRELINE — game bootstrap, loop, input and shot modes.
// Shot modes (?shot=cover|title|plan|results|play|autoplay) render real
// sim states: every screenshot is the game running, fast-forwarded to a
// chosen tick with a scripted policy — never a staged mockup.

import {
  createSim, runTo, step, metrics, policyGood, policyBad, MAX_TICKS,
} from './sim.js';
import { createTerrainPainter } from './terrain.js';
import { renderFrame, VIEW_W, VIEW_H } from './render.js';
import {
  updateHUD, showTitle, showPlan, showResults, hideScreen, recordRun,
} from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || 'play';
const SEED = Number(params.get('seed') || 7);
const DIFF = params.get('difficulty') || 'veteran';
const POLICY = params.get('policy') || 'good';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const sim = createSim(SEED, DIFF);
const painter = createTerrainPainter(sim);
let lastPaintedTick = -1;

function status(text) {
  const n = document.getElementById('selftest');
  if (n) n.textContent = text;
}

function paintIfNeeded() {
  if (sim.tick !== lastPaintedTick) {
    painter.repaint(sim.tick);
    lastPaintedTick = sim.tick;
  }
}

function render() {
  paintIfNeeded();
  renderFrame(ctx, sim, painter.canvas);
  updateHUD(sim);
}

// ---- Shot states (deterministic, scripted policies) ----

function shotCover() {
  // Fast-forward with the good policy to the most dramatic real drop:
  // the first pass that is well into laying its line (6+ ticks of
  // retardant down — a pass only paints ~9-17 ticks before its leg
  // ends) while the fire is a wide front (80+ burning cells), falling
  // back to the fourth pass if the fire never gets that big. The freeze
  // is mid-pass, so the frame holds the whole cause-effect chain:
  // ribbon streaming + red line + scorched black ground behind it +
  // live flame line ahead.
  const policy = POLICY === 'bad' ? policyBad : policyGood;
  let m = metrics(sim);
  while (!sim.outcome && sim.tick < MAX_TICKS) {
    m = step(sim, policy(sim));
    if (sim.dropPasses >= 1 && sim.dropPassTicks >= 6 && m.burningCells >= 80) break;
    // Fallback: late in the first pass, whatever the fire size — the
    // freeze must stay inside pass 1 (southbound, fire ahead). Past
    // it, pass 2 flies north and the fire is behind the camera.
    if (sim.dropPasses >= 1 && sim.dropPassTicks >= 12) break;
  }
  // A few ticks of drift so the droplets read as mid-drop, not instant.
  for (let k = 0; k < 4 && !sim.outcome; k++) step(sim, null);
  sim.tanker.dropping = true; // the stream is still falling from this drop
  render();
  status(`STATUS: OK shot=cover tick=${sim.tick} drops=${sim.dropPasses} burning=${metrics(sim).acresBurning}ac`);
}

function shotTitle() {
  // No drops, no steering: the tanker holds at its start (52,8),
  // nose south over the valley, while the fire grows untouched for
  // 60 ticks into a wide smoke-column vista — and the tank stays
  // full, so the menu reads DROPS LEFT 3 / TANK 3000 gal (round-1:
  // the policyGood-to-tick-90 title showed 0 drops / 900 gal left,
  // odd for a menu).
  runTo(sim, 60, null);
  render();
  showTitle(sim);
  status(`STATUS: OK shot=title tick=${sim.tick}`);
}

function shotPlan() {
  // Tick 60: mid-pass-1, two drops left, tank ~2,300 gal — the choice
  // is real. (The old tick-110 plan had 0 drops left, so the head and
  // flank options were unaffordable while the forecast recommended one.)
  runTo(sim, 60, policyGood);
  render();
  showPlan(sim);
  status(`STATUS: OK shot=plan tick=${sim.tick}`);
}

function shotResults() {
  const m = runTo(sim, MAX_TICKS, policyGood);
  recordRun(sim, m);
  render();
  showResults(sim, m);
  status(`STATUS: OK shot=results tick=${sim.tick} outcome=${sim.outcome} containment=${m.containment}`);
}

function shotAutoplay() {
  const policy = POLICY === 'bad' ? policyBad : policyGood;
  const m = runTo(sim, MAX_TICKS, policy);
  recordRun(sim, m);
  render();
  status(`AUTOPLAY DONE policy=${POLICY} outcome=${sim.outcome} tick=${sim.tick} containment=${m.containment} saved=${m.acresSaved} lost=${m.structuresLost}`);
}

// ---- Interactive play ----

const keys = {};
let planOpen = false;

addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') e.preventDefault();
  if (e.key === 'Enter' && SHOT === 'play') hideScreen();
  if (e.key === 'p' || e.key === 'P') {
    planOpen = !planOpen;
    if (planOpen) showPlan(sim); else hideScreen();
  }
  if (e.key === '1' && planOpen) { hideScreen(); planOpen = false; }
  if (e.key === '2' && planOpen) { hideScreen(); planOpen = false; }
  if (e.key === '3' && planOpen) { hideScreen(); planOpen = false; }
});
addEventListener('keyup', (e) => { keys[e.key] = false; });

document.getElementById('btn-drop').addEventListener('click', () => { keys[' '] = true; setTimeout(() => { keys[' '] = false; }, 120); });
document.getElementById('btn-left').addEventListener('click', () => { keys.ArrowLeft = true; setTimeout(() => { keys.ArrowLeft = false; }, 200); });
document.getElementById('btn-right').addEventListener('click', () => { keys.ArrowRight = true; setTimeout(() => { keys.ArrowRight = false; }, 200); });

function playerInput() {
  const t = sim.tanker;
  let heading = t.heading;
  if (keys.ArrowLeft) heading -= 0.09;
  if (keys.ArrowRight) heading += 0.09;
  if (keys.ArrowUp) t.speed = Math.min(2.6, t.speed + 0.02);
  if (keys.ArrowDown) t.speed = Math.max(1.2, t.speed - 0.02);
  const tx = t.x + Math.cos(heading) * 12;
  const ty = t.y + Math.sin(heading) * 12;
  return { target: { x: tx, y: ty }, drop: !!keys[' '] };
}

let lastTickAt = 0;
let frames = 0;
function loop(now) {
  if (sim.outcome) {
    render();
    if (!loop.reported) {
      loop.reported = true;
      const m = metrics(sim);
      recordRun(sim, m);
      showResults(sim, m);
      status(`STATUS: OK play outcome=${sim.outcome} tick=${sim.tick}`);
    }
    return;
  }
  if (now - lastTickAt >= 100) {
    lastTickAt = now;
    if (!planOpen) step(sim, playerInput());
  }
  render();
  frames++;
  if (frames === 5) status(`STATUS: OK shot=play tick=${sim.tick}`);
  requestAnimationFrame(loop);
}

// ---- Boot ----

if (SHOT === 'cover') shotCover();
else if (SHOT === 'title') shotTitle();
else if (SHOT === 'plan') shotPlan();
else if (SHOT === 'results') shotResults();
else if (SHOT === 'autoplay') shotAutoplay();
else {
  document.getElementById('hud').style.display = 'flex';
  requestAnimationFrame(loop);
}
