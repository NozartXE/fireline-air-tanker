// FIRELINE — terrain texture painter.
// Renders the sim grid to an offscreen canvas (top-down). The pseudo-3D
// renderer samples this canvas Mode-7 style, so the fire, the scorched
// ground and the red retardant lines are the sim's own state, drawn
// once per sim tick — never a static decal.
//
// Palette rule (panel: protect the contrast engine): scorched ground is
// near-black, the live front is saturated orange/yellow, retardant is a
// deep red-pink, unburned ground is dark olive green. Nothing pastel.

import {
  WORLD_W, WORLD_H, S_BURNING, S_SCORCHED, S_WET,
  T_FOREST, T_GRASS, T_ROCK, T_WATER, T_ROAD, mulberry32,
} from './sim.js';

export const TEX_W = WORLD_W * 8; // 1024
export const TEX_H = WORLD_H * 8; // 672

// Per-cell static shade, seeded once: ground texture variation.
function buildShade(seed) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const shade = new Float32Array(WORLD_W * WORLD_H);
  for (let i = 0; i < shade.length; i++) shade[i] = 0.82 + rng() * 0.36;
  return shade;
}

export function paintTerrain(sim, ctx, tick, shade) {
  const W = WORLD_W, H = WORLD_H;
  const cell = 8;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const s = shade[i];
      const st = sim.state[i];
      let r, g, b;
      if (st === S_SCORCHED) {
        // Scorched: near-black with a faint warm ember where fresh.
        const fresh = sim.dropScorch[i] ? 26 : 14;
        r = fresh * s; g = (fresh - 4) * s; b = (fresh - 6) * s;
      } else if (st === S_WET) {
        // Retardant: deep red-pink ribbon, unmistakable against black.
        r = 198 * s; g = 52 * s; b = 58 * s;
      } else if (st === S_BURNING) {
        // Live flame base under the billboards: bright orange core.
        const fl = 0.75 + 0.25 * Math.sin(tick * 0.9 + x * 1.7 + y * 2.3);
        r = 255 * fl; g = 128 * fl; b = 18;
      } else {
        switch (sim.terrain[i]) {
          case T_WATER: { // lake: deep blue with a moving glint
            const gl = 0.85 + 0.15 * Math.sin(tick * 0.25 + x * 0.35 + y * 0.5);
            r = 22 * gl; g = 82 * gl; b = 138 * gl; break;
          }
          case T_ROCK: r = 96 * s; g = 92 * s; b = 86 * s; break;
          case T_ROAD: r = 122 * s; g = 98 * s; b = 66 * s; break;
          case T_FOREST: r = 38 * s; g = 74 * s; b = 30 * s; break;
          default: r = 96 * s; g = 104 * s; b = 44 * s; // grass: dark olive
        }
        // Elevation shading: higher ground slightly lighter.
        const e = 0.9 + sim.elev[i] * 0.2;
        r *= e; g *= e; b *= e;
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // Structure roofs, drawn on the texture so they sit IN the world.
  for (const s of sim.structures) {
    const px = s.x * cell, py = s.y * cell;
    if (s.status === 'lost') {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(px - 5, py - 5, 18, 18);
      ctx.fillStyle = '#ff5a00';
      ctx.fillRect(px - 2, py - 2, 12, 12);
    } else {
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(px - 5, py - 4, 18, 14);
      ctx.fillStyle = '#c23b22';
      ctx.fillRect(px - 6, py - 7, 20, 5);
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(px + 1, py + 1, 4, 4);
    }
  }
}

export function createTerrainPainter(sim) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  const shade = buildShade(sim.seed);
  return {
    canvas,
    repaint(tick) { paintTerrain(sim, ctx, tick, shade); },
  };
}
