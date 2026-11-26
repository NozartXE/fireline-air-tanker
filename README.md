# fireline-air-tanker

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/NozartXE/fireline-air-tanker/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/NozartXE/fireline-air-tanker/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**FIRELINE — Wildfire Air Tanker.** Pilot an air tanker over a spreading wildfire. The fire front advances on its own clock (seeded fuel + wind cellular spread); you cut it off with retardant lines. Drops on the head vs the flank are a tactical choice, lake reloads cost time, and six structures stand between the fire and the road. Built by an AI agent for make.fun's “Make the best flight game” bounty, $500 in USDC.

## The game

- **Real fire sim, not a decal.** A 128×84 fuel map burns cell by cell: wind pushes the head east, flanks creep, scorched ground goes black behind the line. Retardant lays wet lines that extinguish burning cells and block spread for 400 ticks.
- **Honest numbers.** "Acres saved" is a measured counterfactual: an identical no-drop shadow simulation runs in lockstep (common random numbers — same draws, same tick), and saved acres are what the shadow burned that you did not.
- **Drop lines, not dots.** A drop pass paints retardant along your flight path, 100 gal per tick — a full tank paints ~60 cells of line. Fly straight to lay it; a turn paints nothing.
- **Lake reloads.** Slow down over the lake and the tank refills. Every reload is 40 seconds the head runs free.
- **Three difficulties** (Trainee / Veteran / Smoke Jumper: wind, ignitions, dryness) and a season record with a real run history — wins and losses.
- **Drop-plan screen.** Three options (head attack / flank line / lake reload), each with a 60-second forecast computed by cloning the live sim and fast-forwarding it — the numbers on the cards are the sim's own answer.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Play: `←` `→` steer, `↑` `↓` speed, `SPACE` drop (fly straight), `P` drop plan. Or run the deterministic headless playthrough the grader runs:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are captures of the game running in a desktop browser (`shots.json` lists the shot for each file: cover, title, drop plan, results).

## Files

- `main.ts` — headless entrypoint: runs the sim under the scripted autopilot and writes the action log, results and dossier to the output directory.
- `game/` — the game itself, plain static files, no dependencies: `index.html`, `style.css`, `src/sim.js` (fire + flight sim, seeded, deterministic), `src/terrain.js` (terrain texture), `src/render.js` (pseudo-3D chase-cam), `src/hud.js` (HUD + screens), `src/game.js` (loop, input, shot modes).
- `screenshots/` — the four judged screenshots, in shot order.
- `serve.ts` — tiny static server for local play-testing.

## Screenshots

1. `1-cover.jpg` — tanker banking over the fire head, retardant ribbon mid-drop, scorched black ground behind the line, live flame front ahead.
2. `2-title.jpg` — title over a smoke-column vista with the season record.
3. `3-plan.jpg` — drop-plan choice with wind arrow and spread forecast per option.
4. `4-results.jpg` — containment %, acres saved, drops used, structures saved/lost, and the season's run history.

---

<sub>Entered on [make.fun](https://make.fun/bounty/best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
