# Tidewater

Level 1 of a 2D platformer made with Phaser 3. The player pulls plugs to raise or lower the water, and uses the water to get past walls, pits and spikes.

Play it here (Chrome, desktop): https://tidewater-r.vercel.app/

## Run it on your computer
Open a terminal in this folder and run `npx serve .`, then open the address it shows.
(`python3 -m http.server 8000` also works.)

## Controls
- Move: arrow keys or A / D
- Jump: up, W or space
- Pull a plug: E (or down / S)
- Restart: R
- Settings: gear button or Esc. There you can turn on a timer.

## Edit the level
- The map is in `level.js`. It is a text map, and the symbols are explained at the top of the file. Change a row, save, and reload the page.
- Physics (gravity, jump, speed, coyote time) are constants at the top of `game.js`.
- The water speed is in `water.js`.

## Files
- `index.html`: the page and menus
- `level.js`: the level map
- `game.js`: the game code
- `water.js`: the water simulation
- `sprites.js`: the character drawings
- `vendor/`: Phaser
- `HISTORIAL.md`: notes about the changes we made
