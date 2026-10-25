'use strict';
/* MAPA DEL NIVEL
   Edita las filas, guarda y recarga la pagina. No hace falta tocar game.js.
   Son 3 secciones de 18 columnas. El '|' solo separa secciones.

   ceil    v = pinchos de techo, T = tuberia
   air     o = moneda arriba (altura del agua alta), c = moneda en el piso
   enemy   C = cangrejo, B = pelicano (el largo de la racha es su recorrido)
   ground  # = suelo, ^ = pozo con pinchos, G = pilar con la gema (dentro de un pozo),
           W = muro, P = tapon, p = tapon ya puesto, F = bandera (checkpoint), X = meta
*/

const LEVEL_MAP = {
  //        SECCION 1          SECCION 2          SECCION 3
  //        123456789012345678 123456789012345678 123456789012345678
  ceil:   '.T..........T.....|..................|...vvv...T....vvv.',
  air:    '...oooo...........|...ooooo..........|...ccc..oooo......',
  enemy:  '.........CCCCC....|.............BBBB.|..................',
  ground: 'F#P##W############|FP#^^G^^#p#W######|FP#####P^^^^P####X'
};

// zonas de agua (separadas por los muros). true = empieza con agua alta
const START_HIGH = [false, false, true];

// velocidad de los enemigos (px/s)
const ENEMY_SPEED = { crab: 55, pelican: 75 };

// lee el mapa y arma las listas que usa game.js
const LEVEL = (function () {
  const rows = {};
  Object.keys(LEVEL_MAP).forEach(function (k) { rows[k] = LEVEL_MAP[k].replace(/[|\s]/g, ''); });
  const SECTIONS = LEVEL_MAP.ground.split('|').length;
  const COLS = rows.ground.length / SECTIONS;
  Object.keys(rows).forEach(function (k) {
    if (rows[k].length !== COLS * SECTIONS) throw new Error('level.js: la fila "' + k + '" mide ' + rows[k].length + ' y deberia medir ' + COLS * SECTIONS);
  });

  const L = { sections: SECTIONS, secCols: COLS, pits: [], walls: [], plugs: [], plugsClosed: [], ceil: [], pipes: [],
              coins: [], enemies: [], flags: [], goal: null, gem: null };

  // busca rachas de simbolos dentro de una seccion
  function runs(row, s, chars, fn) {
    let a = null;
    for (let c = 1; c <= COLS + 1; c++) {
      const ch = c <= COLS ? row.charAt(s * COLS + c - 1) : '';
      const inside = c <= COLS && chars.indexOf(ch) >= 0;
      if (inside && a === null) a = c;
      if (!inside && a !== null) { fn(a, c - 1, row.charAt(s * COLS + a - 1)); a = null; }
    }
  }

  for (let s = 0; s < SECTIONS; s++) {
    runs(rows.ground, s, '^G', function (a, b) { L.pits.push({ s: s, a: a, b: b }); });
    runs(rows.ceil, s, 'v', function (a, b) { L.ceil.push({ s: s, a: a, b: b }); });
    runs(rows.enemy, s, 'C', function (a, b) { L.enemies.push({ t: 'crab', s: s, a: a, b: b, v: ENEMY_SPEED.crab }); });
    runs(rows.enemy, s, 'B', function (a, b) { L.enemies.push({ t: 'pelican', s: s, a: a, b: b, v: ENEMY_SPEED.pelican }); });
    for (let c = 1; c <= COLS; c++) {
      const i = s * COLS + c - 1, g = rows.ground.charAt(i), a = rows.air.charAt(i), t = rows.ceil.charAt(i);
      if (g === 'W') L.walls.push({ s: s, c: c });
      if (g === 'P' || g === 'p') { L.plugs.push({ s: s, c: c }); if (g === 'p') L.plugsClosed.push({ s: s, c: c }); }
      if (g === 'F') L.flags.push({ s: s, c: c });
      if (g === 'X') L.goal = { s: s, c: c };
      if (g === 'G') L.gem = { s: s, c: c };
      if (t === 'T') L.pipes.push({ s: s, c: c });
      if (a === 'o') L.coins.push({ s: s, c: c, low: false });
      if (a === 'c') L.coins.push({ s: s, c: c, low: true });
    }
  }
  if (!L.goal) throw new Error('level.js: falta la meta (X) en la fila ground');
  if (!L.gem) throw new Error('level.js: falta la gema (G) en la fila ground');
  return L;
})();
