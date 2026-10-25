'use strict';
/* ============================================================
   TIDEWATER - MAPA DEL NIVEL (datos, separado de la logica)
   Edita las filas de abajo y recarga la pagina. No hay que tocar game.js.

   El nivel mide 3 secciones x 18 columnas. En cada fila, '|' separa
   las secciones (solo es visual: el lector lo ignora). Cada fila debe
   tener exactamente 18 simbolos por seccion.

   FILA ceil   (techo)
     v  pinchos de techo (bloque negro + pinchos; hacen dano con agua alta)
     T  tuberia de agua (siempre vierte agua)
     .  nada
   FILA air    (monedas, solo guia)
     o  moneda a la altura del agua alta ("aqui vas a flotar")
     c  moneda en el piso ("camina por aqui")
     .  nada
   FILA enemy  (zona de patrulla; la longitud de la racha = su recorrido)
     C  cangrejo (camina por el suelo)
     B  pelicano (vuela alto y se lanza al agua)
     .  nada
   FILA ground (suelo)
     #  suelo seguro
     ^  pozo con pinchos de piso (hacen dano con agua baja)
     G  pilar con la gema opcional (va dentro de un pozo)
     W  muro de 3 casillas
     P  tapon (empieza puesto o abierto segun la zona)
     p  tapon que empieza ya puesto
     F  bandera verde: inicio de seccion y checkpoint
     X  bandera amarilla: meta
   ============================================================ */

const LEVEL_MAP = {
  //        SECCION 1          SECCION 2          SECCION 3
  //        123456789012345678 123456789012345678 123456789012345678
  ceil:   '.T..........T.....|..................|...vvv...T....vvv.',
  air:    '...oooo...........|...ooooo..........|...ccc..oooo......',
  enemy:  '.........CCCCC....|.............BBBB.|..................',
  ground: 'F#P##W############|FP#^^G^^#p#W######|FP#####P^^^^P####X'
};

// Zonas de agua (entre muros): true = esa zona empieza con el agua alta.
// Zona 1 = antes del primer muro, zona 2 = entre muros, zona 3 = despues del segundo muro.
const START_HIGH = [false, false, true];

// Velocidad de patrulla de cada enemigo (px/s)
const ENEMY_SPEED = { crab: 55, pelican: 75 };

// ---- Lector del mapa: convierte el texto en listas que usa game.js ----
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

  // rachas de simbolos iguales (o de un grupo de simbolos) dentro de una seccion
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
