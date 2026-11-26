// FIRELINE — pseudo-3D chase-cam renderer.
// Canvas 2D, no libraries. The ground is the terrain texture (the sim's
// own state) sampled in horizontal strips under a pinhole projection —
// a hand-rolled Mode-7. Fire, smoke, structures and the tanker are
// projected billboards / screen-space sprites on top. Everything drawn
// here comes from the sim at a real tick: the cover frame's retardant
// ribbon, black scorched ground and live flame line are the sim, not art.

import { TEX_W, TEX_H } from './terrain.js';
import { WORLD_W, WORLD_H, S_BURNING, mulberry32 } from './sim.js';

export const VIEW_W = 1280;
export const VIEW_H = 800;

const FOCAL = 680;      // px
const HORIZON = 290;    // screen row of the horizon
const CAM_H = 12;       // camera height above ground, in cells — low
// enough that the fire line ahead projects to mid-frame, above the
// tanker sprite, instead of at the bottom edge behind it (round-1:
// the cover's fire was half-hidden by the tanker at the frame bottom).
const CAM_BACK = 26;    // camera sits this far behind the tanker —
// far enough that the retardant line the tanker just laid (the ~10
// cells behind it) is still in front of the camera and reads on the
// ground as a red-pink band below the plane (round-5: at 14 the whole
// wet line sat behind the camera and the cover showed no wet band).
const CAM_AHEAD = 30;   // camera looks this far ahead of the tanker

function makeCamera(sim) {
  const t = sim.tanker;
  const h = t.heading;
  const fx = Math.cos(h), fy = Math.sin(h);
  const rx = -fy, ry = fx; // right vector
  return {
    x: t.x - fx * CAM_BACK, y: t.y - fy * CAM_BACK, z: CAM_H,
    fx, fy, rx, ry, heading: h,
  };
}

function project(cam, wx, wy, wz) {
  const dx = wx - cam.x, dy = wy - cam.y;
  const z = dx * cam.fx + dy * cam.fy;
  if (z < 2) return null;
  const r = dx * cam.rx + dy * cam.ry;
  return {
    x: VIEW_W / 2 + (FOCAL * r) / z,
    y: HORIZON + (FOCAL * (cam.z - wz)) / z,
    s: FOCAL / z,
    z,
  };
}

// Deterministic per-cell flicker: same tick + cell => same flame.
function flicker(tick, x, y) {
  return 0.72 + 0.28 * Math.sin(tick * 0.85 + x * 1.93 + y * 2.71);
}

function drawSky(ctx, sim) {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON + 40);
  g.addColorStop(0, '#241610');
  g.addColorStop(0.55, '#5a2c14');
  g.addColorStop(1, '#a35a20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, HORIZON + 40);
  // Low sun, half-swallowed by smoke.
  const sg = ctx.createRadialGradient(980, 180, 8, 980, 180, 190);
  sg.addColorStop(0, 'rgba(255,214,130,0.95)');
  sg.addColorStop(0.35, 'rgba(255,150,60,0.55)');
  sg.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(760, 0, 440, 380);
  // Distant ridge silhouette — two overlapping irregular layers so it
  // reads as a ridgeline, not a row of pyramids (round-1 defect: the
  // single layer of even triangles looked stamped).
  const ridge = (seed, base, col, wMin, wMax, hMin, hMax) => {
    const r = mulberry32(seed);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 6);
    let rx = -20;
    while (rx < VIEW_W + 20) {
      const w = wMin + r() * (wMax - wMin);
      const hgt = hMin + r() * (hMax - hMin);
      // Asymmetric humps — the peak sits at a random 25–75% of each
      // segment, not the midpoint — AND the valleys vary in height,
      // so no two humps share a base line (round-2: midpoint peaks
      // with a flat base still read as a stamped row of triangles).
      const peak = rx + w * (0.25 + r() * 0.5);
      const valley = HORIZON + 6 + (r() - 0.5) * 14;
      ctx.lineTo(peak, HORIZON + 6 - hgt);
      ctx.lineTo(rx + w, valley);
      rx += w;
    }
    ctx.lineTo(VIEW_W, HORIZON + 40);
    ctx.lineTo(0, HORIZON + 40);
    ctx.closePath();
    ctx.fill();
  };
  ridge(777, 0, '#4a2c1c', 180, 420, 20, 60);
  ridge(4242, 0, '#3a2216', 40, 260, 8, 70);
}

function drawGround(ctx, cam, terrainCanvas) {
  const stripH = 8;
  const texScale = 8; // texture px per world cell
  for (let y = HORIZON + 1; y < VIEW_H; y += stripH) {
    const yc = y + stripH / 2;
    const z = (FOCAL * CAM_H) / (yc - HORIZON);
    if (z > 170) continue; // beyond the haze line
    // Ground-line centre, in world coords.
    const cxw = cam.x + cam.fx * z;
    const cyw = cam.y + cam.fy * z;
    // Screen direction of the world-right vector at this depth.
    const p0 = project(cam, cxw, cyw, 0);
    const p1 = project(cam, cxw + cam.rx, cyw + cam.ry, 0);
    if (!p0 || !p1) continue;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const k = (p1.x - p0.x) / texScale; // texture-px -> screen-px (x axis)
    // The transform maps texture space onto the screen for this strip.
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const a = cos * k, b = sin * k, c = -sin * k, d = cos * k;
    const t0x = cxw * texScale, t0y = cyw * texScale;
    const e = p0.x - (a * t0x + c * t0y);
    const f = p0.y - (b * t0x + d * t0y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, VIEW_W, stripH + 1);
    ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainCanvas, 0, 0);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Haze where the ground meets the sky.
  const haze = ctx.createLinearGradient(0, HORIZON, 0, HORIZON + 90);
  haze.addColorStop(0, 'rgba(163,90,32,0.55)');
  haze.addColorStop(1, 'rgba(163,90,32,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, HORIZON, VIEW_W, 90);
}

function drawFlames(ctx, sim, cam) {
  const list = [];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = y * WORLD_W + x;
      if (sim.state[i] !== S_BURNING) continue;
      const p = project(cam, x + 0.5, y + 0.5, 0.6);
      if (!p || p.x < -60 || p.x > VIEW_W + 60 || p.y < HORIZON - 80 || p.y > VIEW_H + 40) continue;
      list.push({ x, y, p });
    }
  }
  // Far first so near flames overlap them.
  list.sort((a, b) => b.p.z - a.p.z);
  const shown = list.slice(0, 420);
  ctx.globalCompositeOperation = 'lighter';
  for (const f of shown) {
    const fl = flicker(sim.tick, f.x, f.y);
    // Billboards overlap their neighbours: a real front is a continuous
    // wall of flame, not one dot per cell (round-5: 1.1-wide billboards
    // read as scattered blobs even at 100+ burning cells; 0.9-wide
    // tongues in attempt 3 read worse — the fire collapsed into one
    // blob around the plane).
    const hgt = Math.max(6, f.p.s * 2.3 * fl);
    const wid = Math.max(4, f.p.s * 1.5);
    const g = ctx.createRadialGradient(f.p.x, f.p.y - hgt / 2, 1, f.p.x, f.p.y - hgt / 2, hgt);
    g.addColorStop(0, 'rgba(255,236,120,0.95)');
    g.addColorStop(0.45, 'rgba(255,140,20,0.75)');
    g.addColorStop(1, 'rgba(200,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(f.p.x, f.p.y - hgt / 2, wid, hgt, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSmokeColumns(ctx, sim, cam) {
  // Tall smoke columns rising from the fire's head into the sky band.
  // The cover's top half was empty brown haze (round-3): these are
  // real sim content — one column per burning cluster at the head,
  // projected from the same cells the flames come from — not decoration.
  const head = { x: 0, y: 0, n: 0, maxX: 0 };
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    if (sim.state[y * WORLD_W + x] !== S_BURNING) continue;
    head.x += x; head.y += y; head.n++;
    if (x > head.maxX) head.maxX = x;
  }
  if (head.n === 0) return;
  const cx = head.x / head.n, cy = head.y / head.n;
  // Screen-space columns: fixed pixel height/width, rising straight up
  // from each cluster's screen position and leaning with the wind. They
  // must be TALL — the fire sits at y≈700 on screen, so a column has
  // to rise ~500px to reach the sky band (round-4: 250px columns ended
  // at y≈450, still in the ground band, invisible against the flames).
  const cols = [
    { x: cx - 8, y: cy, w: 130, h: 520 },
    { x: head.maxX - 6, y: cy + 4, w: 110, h: 460 },
    { x: cx + 10, y: cy - 6, w: 90, h: 400 },
  ];
  for (const c of cols) {
    const p = project(cam, c.x, c.y, 0);
    if (!p || p.x < -60 || p.x > VIEW_W + 60) continue;
    const top = Math.max(36, p.y - c.h);
    const lean = 34; // wind pushes the tops east (screen-right here)
    const g = ctx.createLinearGradient(0, top, 0, p.y);
    g.addColorStop(0, 'rgba(46,38,32,0)');
    g.addColorStop(0.55, 'rgba(46,38,32,0.35)');
    g.addColorStop(1, 'rgba(46,38,32,0.58)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x - c.w * 0.4, p.y);
    ctx.quadraticCurveTo(p.x - c.w * 0.7, (top + p.y) / 2, p.x - c.w * 0.55 + lean, top);
    ctx.lineTo(p.x + c.w * 0.55 + lean, top);
    ctx.quadraticCurveTo(p.x + c.w * 0.7, (top + p.y) / 2, p.x + c.w * 0.4, p.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSmoke(ctx, sim, cam) {
  // Puffs are a pure function of (cell, tick): re-rendering a tick is identical.
  const rng = mulberry32((sim.seed ^ (sim.tick * 97)) >>> 0);
  const puffs = [];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = y * WORLD_W + x;
      if (sim.state[i] !== S_BURNING) continue;
      if (rng() < 0.55) continue; // ~45% of burning cells smoke
      const age = (rng() * 26 + sim.tick * 0.9) % 26;
      const px = x + 0.5 + sim.windX * age * 0.55 + Math.sin(age * 0.7 + x) * 0.8;
      const py = y + 0.5 + sim.windY * age * 0.55;
      const pz = 1.5 + age * 0.9;
      const p = project(cam, px, py, pz);
      if (!p || p.x < -80 || p.x > VIEW_W + 80 || p.y < -40 || p.y > VIEW_H) continue;
      puffs.push({ p, age });
    }
  }
  puffs.sort((a, b) => b.p.z - a.p.z);
  for (const pu of puffs.slice(0, 260)) {
    const r = Math.max(5, pu.p.s * (0.9 + pu.age * 0.28));
    const alpha = Math.max(0.05, 0.42 - pu.age * 0.011);
    const g = ctx.createRadialGradient(pu.p.x, pu.p.y, 1, pu.p.x, pu.p.y, r);
    g.addColorStop(0, `rgba(58,50,46,${alpha})`);
    g.addColorStop(1, 'rgba(58,50,46,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pu.p.x, pu.p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStructures(ctx, sim, cam) {
  for (const s of sim.structures) {
    const p = project(cam, s.x + 0.5, s.y + 0.5, 0);
    if (!p || p.x < -40 || p.x > VIEW_W + 40 || p.y < HORIZON || p.y > VIEW_H) continue;
    const w = Math.max(5, p.s * 1.5), h = Math.max(4, p.s * 1.1);
    ctx.fillStyle = s.status === 'lost' ? '#14100c' : '#6b4423';
    ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    ctx.fillStyle = s.status === 'lost' ? '#3a1c08' : '#b03a20';
    ctx.beginPath();
    ctx.moveTo(p.x - w / 2 - 1, p.y - h);
    ctx.lineTo(p.x, p.y - h - Math.max(3, p.s * 0.7));
    ctx.lineTo(p.x + w / 2 + 1, p.y - h);
    ctx.closePath();
    ctx.fill();
    if (s.status === 'lost') {
      ctx.fillStyle = 'rgba(255,90,0,0.8)';
      ctx.fillRect(p.x - 2, p.y - h - 4, 4, 4);
    }
  }
}

function drawTankerShadow(ctx, sim, cam) {
  const t = sim.tanker;
  const p = project(cam, t.x, t.y, 0);
  if (!p) return;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, Math.max(10, p.s * 2.6), Math.max(4, p.s * 0.9), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRibbon(ctx, sim, cam) {
  // Red retardant stream from the belly to the ground while dropping,
  // plus the fresh droplets along the swath. The stream TAPERS — wide
  // at the belly, thin where it hits the ground — and falls DOWN-screen:
  // from a chase cam the ground the retardant lands on is below the
  // plane, not ahead of it (round-1: the old stream ran up-screen
  // behind the fuselage and was invisible). The impact point sits ~8
  // cells BEHIND the tanker along its heading — the drops fall while
  // the plane flies on, so they land behind the drop point, on the wet
  // band (round-5: the old +2-cells-ahead anchor projected above the
  // belly once the camera moved back to 26). Drawn AFTER the tanker so
  // the stream reads on top of the tail.
  const t = sim.tanker;
  if (t.dropping) {
    const gp = project(cam, t.x - Math.cos(t.heading) * 8, t.y - Math.sin(t.heading) * 8, 0);
    const sx = VIEW_W / 2 + 46, sy = 612;
    if (gp) {
      const dx = gp.x - sx, dy = gp.y - sy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // unit normal
      const grad = ctx.createLinearGradient(sx, sy, gp.x, gp.y);
      grad.addColorStop(0, 'rgba(214,48,49,0.95)');
      grad.addColorStop(1, 'rgba(214,48,49,0.30)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx + nx * 13, sy + ny * 13);
      ctx.lineTo(gp.x + nx * 3, gp.y + ny * 3);
      ctx.lineTo(gp.x - nx * 3, gp.y - ny * 3);
      ctx.lineTo(sx - nx * 13, sy - ny * 13);
      ctx.closePath();
      ctx.fill();
      // Droplets breaking off along the stream.
      for (let k = 1; k <= 4; k++) {
        const f = k / 5;
        ctx.fillStyle = `rgba(224,62,62,${0.85 - f * 0.4})`;
        ctx.beginPath();
        ctx.arc(sx + dx * f + (k % 2 ? 8 : -8), sy + dy * f, Math.max(2, 6 - f * 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Fresh droplets along the swath. The radius is CLAMPED: droplets on
  // ground near the camera project huge (p.s = FOCAL/z blows up at
  // small z) and the old unclamped radius drew giant red balloons
  // across the bottom of the cover (round-2).
  for (const d of sim.drops) {
    if (d.age > 12) continue;
    const p = project(cam, d.x + 0.5, d.y + 0.5, 0.4);
    if (!p) continue;
    ctx.fillStyle = `rgba(224,62,62,${0.9 - d.age * 0.05})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, Math.min(6, p.s * 0.45)), 0, Math.PI * 2);
    ctx.fill();
  }
}

// The air tanker, seen from behind and slightly above — a chase-cam
// rear three-quarter view: nose pointing up-screen (away, toward the
// fire), tail at the bottom (toward the viewer), wings spanning
// left-right. The old side-on sprite read as a yellow banana with the
// registration upside-down (round-1 P0); a chase cam never sees a
// plane side-on.
function drawTanker(ctx, sim) {
  const t = sim.tanker;
  const cx = VIEW_W / 2 + 46, cy = 596;
  // Bank: how far the nose is off straight-ahead, clamped gentle —
  // a 0.5 rad bank read as a submarine roll (round-1 P0).
  const bank = Math.max(-0.28, Math.min(0.28, (t.heading - Math.PI / 2) * 0.9));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bank);
  // 0.95 in attempt 3 let the fire mass swallow the plane; 1.15 keeps
  // the wings clear of the flames beside the leg.
  ctx.scale(1.15, 1.15);
  // Prop discs on the wings (seen from behind: tall thin ellipses).
  ctx.fillStyle = 'rgba(40,30,20,0.32)';
  ctx.beginPath(); ctx.ellipse(-72, -6, 5, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(72, -6, 5, 22, 0, 0, Math.PI * 2); ctx.fill();
  // Engine nacelles.
  ctx.fillStyle = '#c8341f';
  ctx.beginPath(); ctx.ellipse(-72, -4, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(72, -4, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Wings — high wing, spanning left-right, slight sweep back. Thick
  // chord: the old thin bars made the plane read as a rocket with
  // fins (round-2). Wings sit slightly forward so the tail reads.
  ctx.fillStyle = '#c8341f';
  ctx.beginPath();
  ctx.moveTo(-152, -26); ctx.lineTo(152, -26); ctx.lineTo(138, 10); ctx.lineTo(-138, 10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(-152, -26); ctx.lineTo(152, -26); ctx.lineTo(146, -18); ctx.lineTo(-146, -18);
  ctx.closePath(); ctx.fill();
  // Fuselage — nose up (away), tail down (toward viewer). Narrower
  // than the old 44px body: a wide body + thin wings read as a rocket.
  const fg = ctx.createLinearGradient(0, -84, 0, 50);
  fg.addColorStop(0, '#f6c945');
  fg.addColorStop(0.55, '#e8a51c');
  fg.addColorStop(1, '#b06a10');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(0, -84);
  ctx.quadraticCurveTo(13, -80, 16, -58);
  ctx.quadraticCurveTo(18, -20, 17, 16);
  ctx.quadraticCurveTo(16, 40, 12, 50);
  ctx.lineTo(-12, 50);
  ctx.quadraticCurveTo(-16, 40, -17, 16);
  ctx.quadraticCurveTo(-18, -20, -16, -58);
  ctx.quadraticCurveTo(-13, -80, 0, -84);
  ctx.closePath(); ctx.fill();
  // Red cheatline along the fuselage sides.
  ctx.fillStyle = '#c8341f';
  ctx.fillRect(-17, -28, 3, 58);
  ctx.fillRect(14, -28, 3, 58);
  // Cockpit canopy — a visible dark bubble on the nose, not a dot.
  ctx.fillStyle = '#2a1f16';
  ctx.beginPath();
  ctx.moveTo(-10, -70); ctx.lineTo(10, -70); ctx.lineTo(8, -56); ctx.lineTo(-8, -56);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(160,200,230,0.5)';
  ctx.beginPath();
  ctx.moveTo(-10, -70); ctx.lineTo(10, -70); ctx.lineTo(9, -64); ctx.lineTo(-9, -64);
  ctx.closePath(); ctx.fill();
  // Belly tank + drop doors.
  ctx.fillStyle = '#8c1f16';
  ctx.fillRect(-13, 8, 26, 14);
  ctx.fillStyle = '#5e120a';
  ctx.fillRect(-10, 12, 20, 3);
  // Tail — horizontal stabilizer, and the vertical fin as a small
  // dorsal triangle ON the tail (the old fin below the tail read as a
  // red pole hanging off the plane).
  ctx.fillStyle = '#c8341f';
  ctx.beginPath();
  ctx.moveTo(-68, 38); ctx.lineTo(68, 38); ctx.lineTo(56, 50); ctx.lineTo(-56, 50);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6, 48); ctx.lineTo(6, 48); ctx.lineTo(3, 26); ctx.lineTo(-3, 26);
  ctx.closePath(); ctx.fill();
  // Registration, upright and readable on the fuselage.
  ctx.fillStyle = '#7a1508';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N311FT', 0, 22);
  ctx.restore();
  // Speed lines — subtle, ground area only (round-1: the bright
  // white lines read as stray UI in the void).
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 4; k++) {
    const yy = 460 + k * 58;
    ctx.beginPath();
    ctx.moveTo(70, yy);
    ctx.lineTo(150 + (k % 2) * 40, yy);
    ctx.stroke();
  }
}

export function renderFrame(ctx, sim, terrainCanvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Base-fill the whole canvas with smoky haze FIRST: ground strips
  // skip off-map and far cells, and without this the frame below the
  // sky was a black void (round-1 P0 on the cover).
  const base = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  base.addColorStop(0, '#241610');
  base.addColorStop(0.36, '#5a2c14');
  base.addColorStop(0.6, '#7a4218');
  base.addColorStop(1, '#4a2410');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const cam = makeCamera(sim);
  drawSky(ctx, sim);
  drawGround(ctx, cam, terrainCanvas);
  drawTankerShadow(ctx, sim, cam);
  drawStructures(ctx, sim, cam);
  drawSmokeColumns(ctx, sim, cam);
  drawFlames(ctx, sim, cam);
  drawSmoke(ctx, sim, cam);
  drawTanker(ctx, sim);
  drawRibbon(ctx, sim, cam); // after the tanker: the stream falls below the tail, on top
  // Warm grade + vignette to hold the palette off pastel.
  const vg = ctx.createRadialGradient(640, 400, 320, 640, 400, 780);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,4,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}
