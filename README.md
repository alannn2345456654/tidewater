# Tidewater (Level 1 – digital prototype)

2D platformer built with Phaser 3 (included in `vendor/`). One mechanic: pull the drain plugs to raise or lower the water.
Playable link: https://tidewater-r.vercel.app/

## How to run
No install needed to play: open the link above in Chrome (desktop).
To run locally from this folder: `npx serve .` (or `python3 -m http.server 8000`) and open the address it prints.

Controls: ← → / A D move · ↑ / W / Space jump · E (or ↓ / S) pull a plug · R restart.
Settings (gear button or Esc): music, effects, mute, hitboxes and an optional **timer** (off by default) that shows the elapsed time during the level.

## Where to edit the level
- **Level map: `level.js`** – a text map (4 rows: `ceil`, `air`, `enemy`, `ground`) with the legend written at the top of the file. Edit a row, save and reload the page.
  Example: change `W` to `#` in the `ground` row to remove a wall, or move a `P` to move a plug.
- **Physics and feel: top of `game.js`** – `GRAVITY`, `SPEED`, `JUMP_V`, `COYOTE_S`, `BUFFER_S`, `PLUG_LOCK`, `HP_MAX`.
- **Water behavior: `water.js`** – `WATER` constants (pipe flow, drain flow, wave speed).
- Enemy speeds: `ENEMY_SPEED` in `level.js`. Which water zones start flooded: `START_HIGH` in `level.js`.

## Files
`index.html` (page and menus) · `level.js` (map) · `game.js` (game logic, constants at the top) · `water.js` (water simulation) · `sprites.js` (character frames) · `vendor/` (Phaser).

Extra URL options used for the Activity 01 experiment (`?cues=inconsistent`, `?warn=off`, `?look=color`, `?sound=off`) and the full version log are in `HISTORIAL.md`.
