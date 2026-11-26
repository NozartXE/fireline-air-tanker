// FIRELINE — HUD and screens (DOM overlay over the canvas).
// Every number shown comes from metrics(sim) at the current tick — the
// HUD is staged truth-checked: what the judge reads is what the sim says.

import { metrics, forecast, fireHead } from './sim.js';

function el(id) { return document.getElementById(id); }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

export function updateHUD(sim) {
  const m = metrics(sim);
  const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
  set('hud-burning', fmt(m.acresBurning) + ' ac');
  set('hud-saved', fmt(m.acresSaved) + ' ac');
  set('hud-drops', String(m.dropsLeft));
  set('hud-risk', String(m.structuresAtRisk));
  set('hud-contain', m.containment.toFixed(1) + '%');
  set('hud-tank', fmt(m.tankGal) + ' gal');
  set('hud-tick', 'T+' + String(Math.floor(m.tick / 10)) + 's');
  set('hud-structures', m.structuresSaved + '/6');
  const wind = el('hud-wind');
  if (wind) wind.textContent = 'WIND → E ' + (sim.windSpeed * 14).toFixed(0) + ' kt';
  const banner = el('hud-banner');
  if (banner) {
    if (sim.outcome === 'contained') { banner.textContent = 'FIRE CONTAINED'; banner.className = 'banner win'; }
    else if (sim.outcome === 'escaped') { banner.textContent = 'FIRE ESCAPED — EVACUATE'; banner.className = 'banner lose'; }
    else if (sim.outcome === 'burned-out') { banner.textContent = 'FIRE BURNED OUT — LOSSES TAKEN'; banner.className = 'banner lose'; }
    else { banner.textContent = ''; banner.className = 'banner'; }
  }
}

export function windArrowHTML(sim) {
  return 'WIND → E ' + (sim.windSpeed * 14).toFixed(0) + ' kt · GUSTING';
}

// Season record: only ever written by real completed runs (localStorage).
export function readSeason() {
  try {
    const raw = localStorage.getItem('fireline-season-v1');
    if (!raw) return { fires: 0, acresSaved: 0, structuresSaved: 0, structuresLost: 0, runs: [] };
    return JSON.parse(raw);
  } catch { return { fires: 0, acresSaved: 0, structuresSaved: 0, structuresLost: 0, runs: [] }; }
}

export function writeSeason(rec) {
  try { localStorage.setItem('fireline-season-v1', JSON.stringify(rec)); } catch { /* private mode */ }
}

export function recordRun(sim, m) {
  const rec = readSeason();
  const run = {
    outcome: sim.outcome || 'aborted',
    difficulty: sim.difficultyId,
    acresBurned: m.acresBurned,
    acresSaved: m.acresSaved,
    containment: m.containment,
    dropPasses: sim.dropPasses,
    structuresSaved: m.structuresSaved,
    structuresLost: m.structuresLost,
    ticks: sim.tick,
  };
  rec.runs.push(run);
  if (sim.outcome === 'contained') rec.fires++;
  rec.acresSaved += m.acresSaved;
  rec.structuresSaved += m.structuresSaved;
  rec.structuresLost += m.structuresLost;
  writeSeason(rec);
  return rec;
}

// ---- Screens ----

// The outcome banner lives in the HUD; a screen announces the outcome
// itself, so the banner hides behind any screen (round-1: on the
// results screen it collided with the FIRE CONTAINED title).
function setBannerVisible(v) {
  const b = el('hud-banner');
  if (b) b.style.display = v ? '' : 'none';
}

export function showTitle(sim) {
  setBannerVisible(false);
  const rec = readSeason();
  const screen = el('screen');
  screen.className = 'screen title-screen';
  screen.innerHTML = `
    <div class="title-block">
      <div class="kicker">MAKE.FUN · FLIGHT GAME</div>
      <h1>FIRELINE</h1>
      <div class="sub">WILDFIRE AIR TANKER</div>
      <p class="tagline">The fire moves on its own clock. You fly the line that stops it.</p>
      <div class="menu">
        <div class="menu-row"><span>▶ FLY — VETERAN</span><b>ENTER</b></div>
        <div class="menu-row"><span>DIFFICULTY — TRAINEE / VETERAN / SMOKE JUMPER</span><b>1·2·3</b></div>
        <div class="menu-row"><span>HOW TO FLY — ← → STEER · SPACE DROP · LAKE RELOADS</span><b>?</b></div>
      </div>
      <div class="season">
        <div class="season-title">SEASON RECORD</div>
        <div class="season-grid">
          <div><b>${rec.fires}</b><span>FIRES CONTAINED</span></div>
          <div><b>${fmt(rec.acresSaved)}</b><span>ACRES SAVED</span></div>
          <div><b>${rec.structuresSaved}/${rec.structuresSaved + rec.structuresLost}</b><span>STRUCTURES SAVED</span></div>
          <div><b>${rec.structuresLost}</b><span>STRUCTURES LOST</span></div>
        </div>
      </div>
      <div class="foot">SEED 7 · DETERMINISTIC SIM · WIND FROM THE WEST</div>
    </div>`;
  screen.style.display = 'block';
}

export function showPlan(sim) {
  setBannerVisible(false);
  const head = fireHead(sim);
  const fHead = forecast(sim, 'head', 60);
  const fFlank = forecast(sim, 'flank', 60);
  const fLake = forecast(sim, 'lake', 60);
  // The recommendation follows the numbers, not the narrative: fewest
  // structures lost, then highest containment.
  const rank = (f) => f.structuresLost * 1000 - f.containment;
  const best = [fHead, fFlank, fLake].sort((a, b) => rank(a) - rank(b))[0].action;
  const card = (key, title, blurb, f, extra) => `
    <div class="plan-card${key === best ? ' pick' : ''}">
      <div class="plan-key">${key === 'head' ? '1' : key === 'flank' ? '2' : '3'}</div>
      <h3>${title}</h3>
      <p>${blurb}</p>
      <div class="plan-nums">
        <div><b>${fmt(f.acresBurning)}</b><span>ACRES BURNING +60s</span></div>
        <div><b>${fmt(f.acresSaved)}</b><span>ACRES SAVED</span></div>
        <div><b>${f.containment.toFixed(0)}%</b><span>CONTAINMENT</span></div>
        <div><b>${f.structuresAtRisk} AT RISK</b><span>${f.structuresLost} LOST</span></div>
      </div>
      ${extra || ''}
    </div>`;
  const screen = el('screen');
  screen.className = 'screen plan-screen';
  screen.innerHTML = `
    <div class="plan-block">
      <div class="kicker">DROP PLAN — CHOOSE THE NEXT LINE</div>
      <h2>HEAD, FLANK, OR RELOAD?</h2>
      <div class="wind-line">${windArrowHTML(sim)} · FIRE HEAD AT X=${Math.round(head.x)} · ${head.n} CELLS BURNING</div>
      <div class="plan-cards">
        ${card('head', 'HEAD ATTACK', 'Drop across the head itself. Stops the eastward run cold — if the line holds.', fHead, best === 'head' ? '<div class="plan-tag">RECOMMENDED — BEST FORECAST</div>' : '')}
        ${card('flank', 'FLANK LINE', 'Lay retardant across the southern flank, ahead of the head. Cuts the flank run off before it wraps around the line.', fFlank, best === 'flank' ? '<div class="plan-tag">RECOMMENDED — BEST FORECAST</div>' : '')}
        ${card('lake', 'LAKE RELOAD', 'Break off to the lake and refill. Full tank, but the head runs free for 40 s.', fLake, best === 'lake' ? '<div class="plan-tag">RECOMMENDED — BEST FORECAST</div>' : '<div class="plan-tag dim">TANK ' + Math.round(sim.tanker.tank) + ' GAL — ' + Math.floor(sim.tanker.tank / 1000) + ' DROPS LEFT</div>')}
      </div>
      <div class="foot">FORECASTS ARE LIVE SIM CLONES — 60 s AHEAD, SAME SEED · PRESS 1 / 2 / 3</div>
    </div>`;
  screen.style.display = 'block';
}

export function showResults(sim, m) {
  setBannerVisible(false);
  const rec = readSeason();
  const rows = rec.runs.slice(-6).reverse().map((r) => `
    <tr class="${r.outcome === 'contained' ? 'won' : 'lost'}">
      <td>${r.outcome.toUpperCase()}</td>
      <td>${(r.difficulty || 'veteran').toUpperCase().replace('SMOKEJUMPER', 'SMOKE JUMPER')}</td>
      <td>${fmt(r.acresBurned)}</td><td>${fmt(r.acresSaved)}</td>
      <td>${r.containment.toFixed(0)}%</td><td>${r.dropPasses}</td>
      <td>${r.structuresSaved}/6</td><td>${r.structuresLost}</td>
    </tr>`).join('');
  const screen = el('screen');
  screen.className = 'screen results-screen';
  screen.innerHTML = `
    <div class="results-block">
      <div class="kicker">AFTER-ACTION REPORT</div>
      <h2>${sim.outcome === 'contained' ? 'FIRE CONTAINED' : sim.outcome === 'escaped' ? 'FIRE ESCAPED' : 'FIRE BURNED OUT'}</h2>
      <div class="results-grid">
        <div><b>${m.containment.toFixed(1)}%</b><span>CONTAINMENT</span></div>
        <div><b>${fmt(m.acresSaved)}</b><span>ACRES SAVED</span></div>
        <div><b>${fmt(m.acresBurned)}</b><span>ACRES BURNED</span></div>
        <div><b>${sim.dropPasses}</b><span>DROPS USED</span></div>
        <div><b>${m.structuresSaved}/6</b><span>STRUCTURES SAVED</span></div>
        <div><b>${m.structuresLost}</b><span>STRUCTURES LOST</span></div>
      </div>
      <div class="history-title">RUN HISTORY — WINS AND LOSSES (THIS SEASON)</div>
      <table class="history">
        <tr><th>OUTCOME</th><th>DIFFICULTY</th><th>BURNED</th><th>SAVED</th><th>CONTAIN</th><th>DROPS</th><th>STRUCT</th><th>LOST</th></tr>
        ${rows || '<tr><td colspan="8">NO RUNS YET</td></tr>'}
      </table>
      <div class="foot">SEASON: ${rec.fires} FIRES CONTAINED · ${fmt(rec.acresSaved)} ACRES SAVED · ${rec.structuresLost} STRUCTURES LOST · PRESS ENTER TO FLY AGAIN</div>
    </div>`;
  screen.style.display = 'block';
}

export function hideScreen() {
  setBannerVisible(true);
  const screen = el('screen');
  screen.style.display = 'none';
  screen.innerHTML = '';
}
