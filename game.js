'use strict';
/* Tidewater - prototipo web (Phaser 3). Nivel de 3 secciones x 18 columnas.
   Un solo mecanismo: cada tapon abre o cierra su desague y el agua fluye con fisica (water.js). */

// ---- Supabase (opcional). Deja vacio para guardar solo en localStorage. ----
const SUPABASE_URL = '';       // ej. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = '';  // clave anon (publica, con RLS solo-insert)

// ---- Constantes del nivel ----
const T = 40, W = 960, H = 540, GY = 440;         // tile, vista, y del suelo
const SC = 18, NSEC = 3, LW = SC * NSEC * T;      // columnas por seccion, ancho total
const HIGH_H = 3 * T, LOW_H = 3;                 // altura del agua alta / baja
const WALL_H = HIGH_H + 36;                       // las torres sobresalen 36 px del agua alta: el agua nunca las rebasa
const CLIMB_MAX = 50;                             // el saltito de trepar solo funciona si la cima esta a <= 50 px sobre la superficie
const PW = 28, PH = 36, SPEED = 170, JUMP_V = -385;
const SPIKE_H = 26;
const PLUG_LOCK = 900;                            // ms de espera tras jalar un tapon
const CLOSE_MAX_H = 22;                           // un desague abierto solo se tapa si el agua sobre el esta a <= 22 px (no con el agua corriendo)
const START_HIGH = [false, false, true];          // la seccion 3 empieza inundada

const PITS = [{ s: 1, a: 4, b: 8 }, { s: 2, a: 9, b: 12 }];        // pozos con pinchos
const CEIL_SPIKES = [{ s: 2, a: 4, b: 6 }, { s: 2, a: 15, b: 17 }]; // pinchos de techo
const CEIL_SOLIDS = [{ s: 2, a: 4, b: 6 }, { s: 2, a: 15, b: 17 }];
const ENEMIES = [{ t: 'crab', s: 0, a: 10, b: 14, v: 55 }, { t: 'pelican', s: 1, a: 14, b: 17, v: 75 }];   // cangrejo (suelo) y pelicano (vuela alto y se lanza al agua de vez en cuando)
const SHARK_ON = false;   // tiburon apagado por ahora (se activa poniendo true)
const SHARK_DEN = { s: 2, c: 7 };   // hueco del tiburon en el suelo de S3: solo sale si estas nadando cerca
const SWIM_ENTER = 0.35, SWIM_EXIT = 0.25;   // nivel minimo del agua (0-1, 1 = agua alta) para empezar a nadar y para seguir nadando mientras baja
const TREAD_HIT_W = 1.3, TREAD_HIT_DEEP = 22;   // flotando quieto: ancho de la caja de dano (x el cuerpo) y cuanto baja bajo la superficie (px)
const HP_MAX = 2, HURT_MS = 1500;   // vida en mitades; ms de invulnerabilidad tras un golpe del cangrejo
const WALLS = [{ s: 0, c: 6 }, { s: 1, c: 12 }];                    // muros de 3 tiles
const PLUG_START_CLOSED = [{ s: 1, c: 10 }];     // tapones que empiezan ya puestos (el de la derecha del pozo de la seccion 2: no hace falta cruzar el pozo saltando)
function plugStartsOpen(p) { return !START_HIGH[p.z] && !PLUG_START_CLOSED.some(function (q) { return q.s === p.s && q.c === p.c; }); }
const PLUGS = [{ s: 0, c: 3 }, { s: 1, c: 2 }, { s: 1, c: 10 },
               { s: 2, c: 2 }, { s: 2, c: 8 }, { s: 2, c: 13 }];

// ---- Variante del experimento: ?cues=inconsistent ----
const params = new URLSearchParams(location.search);
const VARIANT = params.get('cues') === 'inconsistent' ? 'inconsistent' : 'consistent';
// ---- Hitboxes visibles: casilla en Ajustes (o tecla H, o ?debug=hitboxes) ----
let SHOW_HIT = params.get('debug') === 'hitboxes';
try { if (localStorage.getItem('tw_hitboxes') === '1') SHOW_HIT = true; } catch (e) {}
function setHit(v) {
  SHOW_HIT = !!v;
  try { localStorage.setItem('tw_hitboxes', SHOW_HIT ? '1' : '0'); } catch (e) {}
  const cb = document.getElementById('hit-opt'); if (cb) cb.checked = SHOW_HIT;
  const sc = typeof GAME !== 'undefined' && GAME && GAME.scene.scenes[0];
  if (!SHOW_HIT && sc && sc.dbgG) sc.dbgG.clear();
}
const SID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const PALETTE = [0xe63946, 0xf4a261, 0x9b5de5, 0x2a9d8f, 0x8d99ae];
const SHAPES = ['tri', 'dot', 'block'];
function hazardStyle() {
  if (VARIANT === 'consistent') return { color: 0xe63946, shape: 'tri' };
  return { color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
           shape: SHAPES[Math.floor(Math.random() * SHAPES.length)] };
}

// ---- Interruptores del experimento: ?warn=off apaga el aviso de pinchos de techo, ?sound=off apaga el sonido ----
const WARN = params.get('warn') !== 'off';
if (params.get('look') === 'color') document.body.classList.add('color');   // ?look=color: colores originales

// ---- Sonido sintetizado con WebAudio (sin archivos). Se activa con la primera tecla o toque. M = silenciar ----
const SFX = (function () {
  const enabled = params.get('sound') !== 'off';
  let ctx = null, master = null, sfxBus = null, mBus = null, mTimer = null, mStep = 0, mNext = 0, noiseBuf = null, amb = null, muted = false;
  const num = function (k, d) { try { const v = parseFloat(localStorage.getItem(k)); return isNaN(v) ? d : v; } catch (e) { return d; } };
  let mVol = num('tidewater_music', 0.25), sVol = num('tidewater_sfx', 0.8);   // musica bajita por defecto
  const last = {};
  try { muted = localStorage.getItem('tidewater_muted') === '1'; } catch (e) { /* sin storage */ }

  function ensure() {
    if (ctx || !enabled) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = sVol; sfxBus.connect(master);
      const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  function can(name, ms) { const n = performance.now(); if (last[name] && n - last[name] < ms) return false; last[name] = n; return true; }
  function tone(freq, dur, type, vol, t0, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime + (t0 || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, f0, f1, t0, q) {
    if (!ctx || !noiseBuf) return;
    const t = ctx.currentTime + (t0 || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function startAmbient() {   // ambiente: rumor de agua grave + siseo de las tuberias
    if (amb || !ctx) return;
    const mk = function (type, freq, q) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      g.gain.value = 0; s.connect(f); f.connect(g); g.connect(sfxBus); s.start();
      return g;
    };
    amb = { rumble: mk('lowpass', 260), hiss: mk('bandpass', 1500, 0.7) };
  }

  const CH = [[110, 165, 220], [87.31, 130.81, 174.61], [130.81, 196, 261.63], [98, 146.83, 196]];   // Am - F - C - G
  function mnote(f, dur, vol, t) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.5, dur / 3)); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e); e.connect(mBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function msched() {
    while (mNext < ctx.currentTime + 1.5) {
      const bar = Math.floor(mStep / 8) % 4, i = mStep % 8, ch = CH[bar];
      if (i === 0) ch.forEach(function (f) { mnote(f, 7.5, 0.3, mNext); });
      mnote(ch[i % 3] * (i % 2 ? 4 : 2), 1.1, 0.12, mNext);
      mStep++; mNext += 1.0;
    }
  }
  function startMusic() {
    if (!ctx || mTimer) return;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(master);
    mBus = ctx.createGain(); mBus.gain.value = mVol; mBus.connect(lp);
    mNext = ctx.currentTime + 0.2; msched(); mTimer = setInterval(msched, 500);
  }
  const api = {
    available: enabled && !!(window.AudioContext || window.webkitAudioContext),
    onToggle: null,
    musicVol: function () { return mVol; },
    sfxVol: function () { return sVol; },
    setMusicVol: function (v) { mVol = v; try { localStorage.setItem('tidewater_music', v); } catch (e) { /* sin storage */ } if (mBus) mBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setSfxVol: function (v) { sVol = v; try { localStorage.setItem('tidewater_sfx', v); } catch (e) { /* sin storage */ } if (sfxBus) sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    isMuted: function () { return muted; },
    unlock: function () {
      const c = ensure(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      startAmbient(); startMusic();
    },
    toggle: function () {
      muted = !muted;
      try { localStorage.setItem('tidewater_muted', muted ? '1' : '0'); } catch (e) { /* sin storage */ }
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.03);
      if (api.onToggle) api.onToggle();
    },
    ambience: function (inWater, pipeNear) {
      if (!amb || !ctx) return;
      const t = ctx.currentTime;
      amb.rumble.gain.setTargetAtTime(0.03 + (inWater ? 0.05 : 0), t, 0.4);
      amb.hiss.gain.setTargetAtTime(0.01 + 0.05 * pipeNear + (inWater ? 0.01 : 0), t, 0.25);
    },
    jump: function () { tone(330, 0.12, 'square', 0.05, 0, 640); },
    land: function () { if (can('land', 120)) noise(0.09, 0.14, 520, 160, 0, 0.8); },
    splash: function () { if (can('splash', 250)) { noise(0.38, 0.28, 2600, 500, 0, 0.8); tone(520, 0.14, 'sine', 0.06, 0.02, 220); } },
    stroke: function () { if (can('stroke', 380)) tone(300 + Math.random() * 120, 0.09, 'sine', 0.04, 0, 540); },   // burbuja al nadar
    climb: function () { if (can('climb', 300)) { noise(0.3, 0.22, 2200, 700, 0, 0.8); tone(240, 0.18, 'triangle', 0.08, 0, 520); } },
    pull: function (toHigh) {    // clic del anillo + el agua entra (sube) o se va por el desague (baja)
      tone(190, 0.07, 'square', 0.09, 0, 120);
      if (toHigh) { noise(1.5, 0.2, 260, 1900, 0.05, 0.9); tone(150, 1.2, 'sine', 0.05, 0.05, 320); }
      else { noise(1.2, 0.2, 1900, 220, 0.05, 0.9); tone(320, 1.0, 'sine', 0.05, 0.05, 110); }
    },
    blocked: function () { tone(140, 0.15, 'triangle', 0.13, 0, 85); },
    coin: function () { tone(988, 0.08, 'square', 0.06); tone(1319, 0.2, 'square', 0.06, 0.07); },
    gem: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.11, i * 0.07); }); },
    flag: function () { tone(660, 0.12, 'triangle', 0.1); tone(880, 0.24, 'triangle', 0.1, 0.1); },
    warn: function () { if (can('warn', 900)) { tone(880, 0.07, 'square', 0.05); tone(880, 0.07, 'square', 0.05, 0.13); } },
    die: function () { tone(440, 0.5, 'sawtooth', 0.12, 0, 70); noise(0.35, 0.22, 1400, 150, 0, 0.7); },
    win: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, i === 4 ? 0.5 : 0.18, 'triangle', 0.12, i * 0.11); }); },
    clack: function (v) { if (!(v > 0.03)) return; if (can('clack', 130)) { noise(0.06, 0.5 * v, 3400, 1500, 0, 3); tone(2100, 0.05, 'square', 0.1 * v, 0, 900); } },   // pinza que chasquea
    flap: function (v) { if (!(v > 0.03)) return; if (can('flap', 220)) noise(0.16, 0.22 * v, 500, 180, 0, 0.8); },                       // aleteo: soplido grave
    caw: function (v) { if (!(v > 0.03)) return; if (can('caw', 1500)) { tone(560, 0.28, 'sawtooth', 0.09 * v, 0, 300); tone(580, 0.22, 'square', 0.04 * v, 0.1, 330); } },   // graznido de aviso
    skitter: function (v) { if (!(v > 0.03)) return; if (can('skitter', 170)) { noise(0.05, 0.35 * v, 2400, 4200, 0, 3); tone(1500 + Math.random() * 500, 0.03, 'square', 0.05 * v, 0, 800); } },                                        // patitas en el suelo
    ui: function () { tone(700, 0.05, 'square', 0.05); }
  };
  if (enabled) ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, api.unlock, { passive: true }); });
  return api;
})();

const colx = (s, c) => (s * SC + c - 1) * T;       // x izquierda de una columna

// ---- Zonas de agua: el agua llega solo hasta los muros grandes (3 zonas, 2 muros) ----
const NZ = 3;
const ZB = [0, colx(WALLS[0].s, WALLS[0].c) + T / 2, colx(WALLS[1].s, WALLS[1].c) + T / 2, LW];
const zoneOf = function (x) { return x < ZB[1] ? 0 : (x < ZB[2] ? 1 : 2); };
PLUGS.forEach(function (p) { p.z = zoneOf(colx(p.s, p.c) + T / 2); });

// ---- Registro de eventos ----
function log(type, data) {
  const row = { session_id: SID, variant: VARIANT, type: type, data: data || {}, t: Math.round(performance.now()) };
  try {
    const a = JSON.parse(localStorage.getItem('tidewater_events') || '[]');
    a.push(row);
    localStorage.setItem('tidewater_events', JSON.stringify(a.slice(-500)));
  } catch (e) { /* sin storage: se ignora */ }
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    fetch(SUPABASE_URL + '/rest/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY,
                 Authorization: 'Bearer ' + SUPABASE_ANON_KEY, Prefer: 'return=minimal' },
      body: JSON.stringify(row), keepalive: true
    }).catch(function () {});
  }
}

// ---- Controles tactiles (DOM) ----
const TOUCH = { left: false, right: false, jump: false, pull: false };
function bindTouch() {
  if (!('ontouchstart' in window) && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return;
  const kh = document.getElementById('keys'); if (kh) kh.style.display = 'none';
  const box = document.getElementById('touch');
  box.style.display = 'flex';
  [['t-left', 'left'], ['t-right', 'right'], ['t-jump', 'jump'], ['t-pull', 'pull']].forEach(function (p) {
    const el = document.getElementById(p[0]);
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); TOUCH[p[1]] = true; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function () { if (p[1] !== 'pull') TOUCH[p[1]] = false; });
    });
  });
}

function bindMute() {
  const el = document.getElementById('mute'); if (!el) return;
  if (!SFX.available) { el.style.display = 'none'; return; }
  const paint = function () { (el.querySelector('.ico') || el).textContent = SFX.isMuted() ? '\uD83D\uDD07' : '\uD83D\uDD0A'; el.title = SFX.isMuted() ? 'Sound off (M)' : 'Sound (M)'; };
  SFX.onToggle = paint; paint();
  el.addEventListener('click', function (e) { SFX.unlock(); SFX.toggle(); e.currentTarget.blur(); });
}

function mixColor(c1, c2, k) {
  const a = Phaser.Display.Color.IntegerToRGB(c1), b = Phaser.Display.Color.IntegerToRGB(c2);
  return Phaser.Display.Color.GetColor(Math.round(a.r + (b.r - a.r) * k), Math.round(a.g + (b.g - a.g) * k), Math.round(a.b + (b.b - a.b) * k));
}

// ---- Vibracion del control (si existe) ----
function rumble(ms, mag) {
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const a = pads[i] && pads[i].vibrationActuator;
      if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag, weakMagnitude: mag });
    }
  } catch (e) { /* sin vibracion */ }
}

// ---- Control (gamepad): tipo (Xbox / PlayStation), globos con el boton en la interfaz y atajos de menu ----
// Botones estandar: 0 A/✕ · 1 B/○ · 2 X/□ · 3 Y/△ · 8 Select(View/Share) · 9 Start(Menu/Options)
const PADUI = {
  active: false, type: 'xbox', prev: [], blockUntil: 0, hooks: null, badges: [],
  GL: { xbox: { confirm: 'A', back: 'B', pull: 'X', restart: 'Y', menu: 'MENU', view: 'VIEW' },
        ps: { confirm: '\u2715', back: '\u25CB', pull: '\u25A1', restart: '\u25B3', menu: 'OPT', view: 'SHARE' } },
  COL: { xbox: { confirm: '#2ea043', back: '#d1343b', pull: '#2f6fe0', restart: '#c99a10', menu: '#4b5563', view: '#4b5563' },
         ps: { confirm: '#4f8ff7', back: '#e0505a', pull: '#d96aa0', restart: '#2fb36a', menu: '#4b5563', view: '#4b5563' } },
  glyph: function (k) { return this.GL[this.type][k]; },
  color: function (k) { return this.COL[this.type][k]; },
  badge: function (el, k) {   // globo con la letra del boton, pegado debajo del elemento (solo se ve cuando se juega con control)
    if (!el) return;
    const b = document.createElement('span'); b.className = 'gpb'; b.dataset.k = k; el.appendChild(b); this.badges.push(b);
  },
  paint: function () { const me = this; this.badges.forEach(function (b) { b.textContent = me.glyph(b.dataset.k); b.style.setProperty('--c', me.color(b.dataset.k)); }); },
  set: function (a) { if (this.active !== a) { this.active = a; document.body.classList.toggle('pad', a); } },
  handle: function (edge) {
    const h = this.hooks; if (!h) return;
    if (h.onTitle()) {                                   // titulo: A o Start juega, X abre ajustes, B o Start los cierra
      if (h.panelOpen()) { if (edge(1) || edge(9)) h.openPanel(false); return; }
      if (edge(0) || edge(9)) { this.blockUntil = performance.now() + 300; h.play(); } else if (edge(2)) h.openPanel(true);
      return;
    }
    if (edge(8) && SFX.available) { SFX.unlock(); SFX.toggle(); }                              // Select / View / Share: silenciar
    if (h.panelOpen()) { if (edge(1) || edge(9)) { h.openPanel(false); this.blockUntil = performance.now() + 300; } return; }
    if (edge(9) && !ENDUI.open) h.openPanel(true);                                             // Start / Menu / Options: ajustes
  },
  start: function () {
    const me = this;
    window.addEventListener('keydown', function () { me.set(false); }, true);
    ['mousedown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, function () { me.set(false); }, { passive: true }); });
    function tick() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
      if (gp) {
        const type = /054c|playstation|dualshock|dualsense|wireless controller|ps4|ps5/.test((gp.id || '').toLowerCase()) ? 'ps' : 'xbox';
        if (type !== me.type) { me.type = type; me.paint(); }
        const cur = [];
        for (let i = 0; i < 17; i++) cur[i] = !!(gp.buttons[i] && gp.buttons[i].pressed);
        if (cur.some(Boolean) || Math.abs(gp.axes[0] || 0) > 0.5 || Math.abs(gp.axes[1] || 0) > 0.5) me.set(true);
        me.handle(function (i) { return cur[i] && !me.prev[i]; });
        me.prev = cur;
      } else me.prev = [];
      requestAnimationFrame(tick);
    }
    tick();
  }
};

// ---- Pantalla final con la pregunta de justicia ----
const ENDUI = { open: false, sel: 0, rated: false };
function markSel() {
  Array.prototype.forEach.call(document.querySelectorAll('#rate button'), function (b) {
    b.classList.toggle('sel', !ENDUI.rated && Number(b.dataset.v) === ENDUI.sel);
  });
}
function padEnd(P) {   // control en la pantalla final: izq/der elige, A confirma, A otra vez = jugar de nuevo, Start = saltar
  if (!ENDUI.open) return;
  if (P.restart) { document.getElementById('again').click(); return; }
  if (!ENDUI.rated) {
    if (P.lEdge || P.rEdge) ENDUI.sel = ENDUI.sel === 0 ? 3 : Phaser.Math.Clamp(ENDUI.sel + (P.rEdge ? 1 : -1), 1, 5);
    markSel();
    if (P.ok && ENDUI.sel > 0) document.querySelector('#rate button[data-v="' + ENDUI.sel + '"]').click();
  } else if (P.ok) document.getElementById('again').click();
}
function showEnd(stats, again) {
  const end = document.getElementById('end');
  document.getElementById('end-stats').textContent =
    'Time: ' + stats.time + ' s · Failed attempts: ' + stats.deaths + ' · Gem: ' + (stats.gem ? 'yes' : 'no');
  const rate = document.getElementById('rate-wrap');
  const thanks = document.getElementById('thanks');
  rate.style.display = 'block'; thanks.style.display = 'none';
  end.style.display = 'flex';
  ENDUI.open = true; ENDUI.sel = 0; ENDUI.rated = false; markSel();
  Array.prototype.forEach.call(document.querySelectorAll('#rate button'), function (b) {
    b.onclick = function () {
      SFX.ui(); log('rating', { fairness: Number(b.dataset.v) });
      rate.style.display = 'none'; thanks.style.display = 'block';
      ENDUI.rated = true; markSel();
    };
  });
  document.getElementById('again').onclick = function () { ENDUI.open = false; end.style.display = 'none'; again(); };
}

function drawSpikes(g, x, y, w, dir, st, alpha) {
  g.fillStyle(st.color, alpha === undefined ? 1 : alpha);
  const n = Math.max(1, Math.round(w / (T * 0.5))), step = w / n;
  for (let i = 0; i < n; i++) {
    const x0 = x + i * step;
    if (st.shape === 'tri') g.fillTriangle(x0, y, x0 + step, y, x0 + step / 2, y + dir * SPIKE_H);
    else if (st.shape === 'dot') g.fillCircle(x0 + step / 2, y + dir * (SPIKE_H / 2 - 4), step / 2 - 1);
    else g.fillRect(x0 + 3, dir < 0 ? y - SPIKE_H : y, step - 6, SPIKE_H);
  }
}


// ---- Enemigos en silueta (estilo Limbo): negro con un filo apenas mas claro y ojos que brillan ----
const INK = 0x070b10, RIM = 0x2a3d4a, EYE = 0xdfe8ee;
function rimEllipse(G, cx, cy, rx, ry, a0, a1, w, alpha) {   // arco del borde superior de una elipse (el "filo" de luz)
  G.lineStyle(w || 1.5, RIM, alpha === undefined ? 0.9 : alpha); G.beginPath();
  for (let i = 0; i <= 14; i++) { const a = a0 + (a1 - a0) * i / 14; const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry; if (i === 0) G.moveTo(px, py); else G.lineTo(px, py); }
  G.strokePath();
}
function eyeGlow(G, x, y, r) { G.fillStyle(EYE, 0.14); G.fillCircle(x, y, r * 2.8); G.fillStyle(EYE, 1); G.fillCircle(x, y, r); G.fillStyle(INK, 1); }

// Cangrejo visto de frente: camina de lado (como los de verdad). c = estado del cangrejo (ver crabInit / updateCrab).
function drawCrab(G, c, gy, time) {
  const x = c.x, wet = c.wet, sp = c.sp, d = c.dir, TAU = Math.PI * 2;
  const bob = Math.sin(c.ph * 2) * 0.9 * sp + Math.sin(time / 420) * 0.35 * wet;           // el cuerpo sube y baja con cada paso; en el agua se mece
  const cy = gy - 13 - c.lift - bob, A = 4.6 * Math.min(1, sp * 1.2);                     // A = largo del paso
  const shake = c.shake > 0 ? Math.sin(time / 22) * 1.6 * c.shake : 0, bx = x + shake;      // sacudida al quedarse sin agua
  G.fillStyle(INK, 1);
  for (let s = -1; s <= 1; s += 2) {
    const side = s < 0 ? 0 : 1;
    for (let i = 0; i < 3; i++) {
      const phi = c.ph + i * 2.1 + (s > 0 ? Math.PI : 0), sw = Math.sin(phi);
      const idle = (1 - Math.min(1, sp * 2)) * Math.sin(time / 650 + i * 1.7 + side * 2.2) * 0.9;   // parado: las patas tiemblan un poco
      const lift = Math.max(0, sw) * (2.6 + wet * 3.4) * (0.3 + 0.7 * Math.min(1, sp * 1.5)) + Math.max(0, idle);
      const spread = 1 + 0.12 * wet + (c.hop > 0 ? 0.18 : 0);
      const sx = bx + s * (9 + i * 2.5), sy = cy + 3 + i * 0.8;                                        // sale del vientre
      const kx = bx + s * (19 + i * 5) * spread, ky = cy - 9 - (2 - i) * 2.2 - lift - wet * 1.8;      // rodilla alta
      const fx = bx + s * (26 + i * 6) * spread - d * Math.cos(phi) * A, fy = gy - 1 - lift * 0.7 - c.lift * 0.55;   // pie: en el suelo se arrastra hacia atras, en el aire vuelve hacia adelante
      G.lineStyle(3.2 - i * 0.3, INK, 1); G.lineBetween(sx, sy, kx, ky); G.lineBetween(kx, ky, fx, fy);
      G.fillCircle(kx, ky, 1.9);
    }
    // brazo y pinza: r = que tan arriba esta, gr = que tanto se lleva a la boca, op = que tan abierta
    const r = c.cl[side], gr = c.gr[side], op = c.op[side], sway = Math.sin(time / 520 + side * 2.4) * wet * 1.6;
    let ex = bx + s * (19 + r * 2), ey = cy - 4 - r * 7, px = bx + s * (24 + r * 3), py = cy - 12 - r * 12 + sway;
    ex += (bx + s * 11 - ex) * gr; ey += (cy - 5 - ey) * gr; px += (bx + s * 5 - px) * gr; py += (cy - 5 - py) * gr;
    G.lineStyle(4.6, INK, 1); G.lineBetween(bx + s * 12, cy + 1, ex, ey); G.lineBetween(ex, ey, px, py + 3);
    G.fillCircle(ex, ey, 3);
    const mc = ((s > 0 ? 235 : 305) - s * r * 28 + s * gr * 50) * Math.PI / 180, gap = (22 + op * 30) * Math.PI / 180, a0 = mc + gap, a1 = mc - gap + TAU, pts = [{ x: px, y: py }];
    for (let i = 0; i <= 22; i++) { const t = i / 22, th = a0 + (a1 - a0) * t, rr = 8.5 + 7 * (Math.pow(1 - t, 7) + Math.pow(t, 7)); pts.push({ x: px + Math.cos(th) * rr, y: py + Math.sin(th) * rr }); }
    G.fillStyle(INK, 1); G.fillPoints(pts, true);
    G.lineStyle(1.2, RIM, 0.85); G.beginPath();
    for (let i = 3; i <= 14; i++) { const q = pts[i + 1]; if (i === 3) G.moveTo(q.x, q.y); else G.lineTo(q.x, q.y); } G.strokePath();
  }
  const lean = d * 1.6 * sp;                                                                    // al caminar el caparazon se adelanta un poco
  G.fillStyle(INK, 1); G.fillEllipse(bx, cy, 38, 18); G.fillEllipse(bx + lean, cy - 3, 30, 14);   // caparazon
  rimEllipse(G, bx + lean * 0.5, cy - 1, 18, 9, Math.PI + 0.25, 2 * Math.PI - 0.25, 1.4, 0.8);
  G.lineStyle(1, RIM, 0.55); G.lineBetween(bx - 6, cy - 8, bx - 3, cy + 1); G.lineBetween(bx + 6, cy - 8, bx + 3, cy + 1);   // surcos
  const mf = Math.sin(time / 90) * 0.6; G.lineStyle(1.2, RIM, 0.5); G.lineBetween(bx - 2.5, cy + 3, bx - 1.6 + mf, cy + 6); G.lineBetween(bx + 2.5, cy + 3, bx + 1.6 - mf, cy + 6);   // piezas de la boca
  for (let s = -1; s <= 1; s += 2) {   // ojos en tallos: suben al alertarse y miran hacia el jugador
    const up = 5 + 7 * c.eyeUp, tx = bx + s * 5 + c.look * 2.4 + s * c.eyeUp * 1.2, ty = cy - 6 - up;
    G.lineStyle(2, INK, 1); G.lineBetween(bx + s * 4, cy - 6, tx, ty); eyeGlow(G, tx, ty - 0.6, 1.7);
  }
  G.lineStyle(3, INK, 1);
}

// Estado del cangrejo. Modos: walk (camina de lado a rafagas), pause (se detiene: acicala, saluda con la pinza o mira), threat (pinzas arriba y chasqueando
// cuando te acercas), turn (llega al limite, duda y da la vuelta), startle (el agua le llega: se sobresalta y levanta las pinzas).
function crabInit(e) {
  Object.assign(e, { mode: 'pause', mt: 0.6, ph: 0, sp: 0, wet: 0, lift: 0, look: 0, eyeUp: 0.5, cl: [0, 0], gr: [0, 0], op: [0, 0], shake: 0,
    bubbles: [], pops: [], puffs: [], bt: 1.2, hop: 0, hopT: 3 + Math.random() * 3, idle: 'none', idleSide: 1, stepT: 0, clackLast: 0 });
}

function birdInit(e) {
  Object.assign(e, { fd: 1, fp: 0, flap: 0, fmode: 'flap', ft: 1.2, head: 0.3, pitch: 0, pst: 'fly', drops: [], rings: [], dropT: 0, flaps: 0 });
}

const BIRD_K = 1.3;   // escala del dibujo del ave (la caja de dano se calcula con la misma escala)
function drawBird(G, ox, oy, d, st, time, b) {   // ave carronera: cuello pelado, pico ganchudo, alas largas con plumas separadas. b = estado visual (aleteo, cabeza, inclinacion)
  G.save(); G.translateCanvas(ox, oy); G.scaleCanvas(BIRD_K, BIRD_K); if (b && st !== 'dive' && st !== 'stay') G.rotateCanvas(-d * b.pitch); const x = 0, y = 0;
  drawBirdLocal(G, x, y, d, st, time, b); G.restore();
}
function drawBirdLocal(G, x, y, d, st, time, b) {
  const flap = b ? b.flap : Math.sin(time / (st === 'warn' ? 50 : 150));
  G.fillStyle(INK, 1);
  if (st === 'dive' || st === 'stay') {   // picada: alas pegadas hacia atras, cuerpo vertical, pico abajo
    if (st === 'dive') { G.lineStyle(1, 0xcfe8ff, 0.4); G.lineBetween(x - 7, y - 30, x - 7, y - 58); G.lineBetween(x + 7, y - 34, x + 7, y - 66); G.lineBetween(x, y - 28, x, y - 52); }   // lineas de velocidad
    G.fillStyle(INK, 1);
    G.fillTriangle(x - 4, y - 8, x + 4, y - 8, x, y - 26);                                   // cola
    G.fillEllipse(x, y - 2, 15, 26);                                                          // cuerpo
    G.fillTriangle(x - 6, y - 10, x - 17, y - 22, x - 5, y + 8); G.fillTriangle(x + 6, y - 10, x + 17, y - 22, x + 5, y + 8);   // alas hacia atras
    G.lineStyle(1.3, RIM, 0.8); G.lineBetween(x - 17, y - 22, x - 5, y + 8); G.lineBetween(x + 17, y - 22, x + 5, y + 8);
    G.fillStyle(INK, 1); G.fillRect(x - 2.5, y + 8, 5, 10);                                  // cuello
    G.fillCircle(x, y + 20, 5);                                                                // cabeza
    G.fillTriangle(x - 3.5, y + 22, x + 3.5, y + 22, x, y + 40); G.fillTriangle(x - 1, y + 36, x + 1, y + 36, x + 3, y + 42);   // pico ganchudo
    eyeGlow(G, x + d * 2.5, y + 19, 1.3);
    return;
  }
  const hgt = 0.62 + 0.38 * flap;   // altura del ala: baja y sube con el aleteo
  const FEATH = [[2, 0], [0, -14], [-9, -37], [-20, -30], [-18, -26], [-26, -22], [-21, -19], [-30, -13], [-23, -11], [-28, -5], [-18, -3], [-14, 2]];   // contorno del ala (u = hacia adelante, v = hacia arriba)
  const wing = function (ox, oy, sc, lag) {
    const pts = FEATH.map(function (q, i) { const tip = i >= 2 && i <= 9; return { x: ox + d * q[0] * sc, y: oy + q[1] * sc * hgt + (tip ? lag : 0) }; });
    G.fillStyle(INK, 1); G.fillPoints(pts, true);
    G.lineStyle(1.3, RIM, 0.75); G.lineBetween(pts[0].x, pts[0].y, pts[1].x, pts[1].y); G.lineBetween(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
  };
  wing(x + d * 9, y - 4, 0.8, 2 - flap * 2);   // ala lejana (mas chica)
  G.fillStyle(INK, 1);
  G.fillTriangle(x - d * 12, y - 2, x - d * 12, y + 5, x - d * 34, y + 10 + flap * 1.5);       // cola
  G.fillTriangle(x - d * 16, y, x - d * 16, y + 3, x - d * 36, y + 4);
  G.fillEllipse(x, y, 34, 15);                                                                 // cuerpo
  rimEllipse(G, x, y, 17, 7.5, Math.PI + 0.3, 2 * Math.PI - 0.5, 1.3, 0.7);
  const hd = b ? b.head : 0, hx = -hd * 2, hy = hd * 7;   // la cabeza baja y se adelanta menos cuando mira hacia abajo
  G.lineStyle(5, INK, 1); G.lineBetween(x + d * 11, y - 2, x + d * (19 + hx), y - 9 + hy);   // cuello largo
  G.fillStyle(INK, 1); G.fillCircle(x + d * (21 + hx), y - 10 + hy, 5);                        // cabeza
  G.fillTriangle(x + d * (24 + hx), y - 13 + hy, x + d * (24 + hx), y - 7 + hy, x + d * (36 + hx * 0.4), y - 6 + hy * 1.5);   // pico
  G.fillTriangle(x + d * (31 + hx * 0.5), y - 7 + hy * 1.3, x + d * (36 + hx * 0.4), y - 6 + hy * 1.5, x + d * (33 + hx * 0.4), y - 1 + hy * 1.7);   // gancho
  eyeGlow(G, x + d * (22 + hx), y - 11 + hy, 1.4);
  wing(x + d * 1, y - 3, 1.05, -flap * 2);        // ala cercana
}


// ---- Decoracion de ambiente (estilo Limbo): solo adorno, sin colision. Se omite con ?look=color (condicion de control) ----
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function drawWeb(g, x, y, r, sx, sy, alpha) {   // telarana de esquina: radios desde (x, y) hacia (sx, sy) y hilos que cuelgan entre ellos
  const a = alpha === undefined ? 0.26 : alpha, N = 5, R = 5, ang = [];
  for (let i = 0; i <= N; i++) ang.push(i / N * Math.PI / 2);
  g.lineStyle(1, 0xb9c8d4, a);
  for (let i = 0; i <= N; i++) g.lineBetween(x, y, x + Math.cos(ang[i]) * r * sx, y + Math.sin(ang[i]) * r * sy);
  for (let k = 1; k <= R; k++) {
    const rr = r * k / R * (0.78 + 0.22 * (k / R));
    for (let i = 0; i < N; i++) {
      const x0 = x + Math.cos(ang[i]) * rr * sx, y0 = y + Math.sin(ang[i]) * rr * sy, x1 = x + Math.cos(ang[i + 1]) * rr * sx, y1 = y + Math.sin(ang[i + 1]) * rr * sy;
      const mx = (x0 + x1) / 2 - (x0 + x1 - 2 * x) * 0.035, my = (y0 + y1) / 2 - (y0 + y1 - 2 * y) * 0.035;   // el hilo se hunde hacia la esquina
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(mx, my); g.lineTo(x1, y1); g.strokePath();
    }
  }
}
function drawBranch(g, x, y, ang, len, w, rnd) {   // rama seca: se bifurca y se adelgaza
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  g.lineStyle(w, 0x050d14, 0.95); g.lineBetween(x, y, x2, y2);
  if (len < 9) return;
  const n = len > 40 ? 3 : 2;
  for (let i = 0; i < n; i++) drawBranch(g, x2 - Math.cos(ang) * len * 0.15 * i, y2 - Math.sin(ang) * len * 0.15 * i, ang + (rnd() - 0.5) * 1.3, len * (0.55 + rnd() * 0.2), Math.max(1, w * 0.68), rnd);
}
function drawBones(g, x, y, k) {   // pez muerto: esqueleto tumbado en el suelo (craneo, columna, costillas, aletas y cola)
  const BONE = 0xd5e0e4, DARK = 0x07131b, ys = y - 10, L = 74;
  const X = function (d) { return x + d * k; };
  g.fillStyle(0x03080c, 0.4); g.fillEllipse(X(L / 2), y - 1, L + 6, 5);                      // sombra en el suelo
  g.lineStyle(2.4, BONE, 0.92); g.lineBetween(X(15), ys, X(L - 10), ys);                       // columna
  g.fillStyle(BONE, 0.95);
  for (let i = 0; i < 12; i++) g.fillCircle(X(19 + i * 4.4), ys, 1.7);                         // vertebras
  g.lineStyle(1.6, BONE, 0.85);
  for (let i = 0; i < 11; i++) {                                                               // costillas: curvas, mas largas al centro
    const bx = 18 + i * 4.4, h = 3 + 7.5 * Math.pow(Math.sin(Math.PI * (i + 0.6) / 11.4), 0.9);
    g.lineBetween(X(bx), ys, X(bx + 2.2), ys - h * 0.75); g.lineBetween(X(bx + 2.2), ys - h * 0.75, X(bx + 5), ys - h);
    g.lineBetween(X(bx), ys, X(bx + 2.2), ys + h * 0.75); g.lineBetween(X(bx + 2.2), ys + h * 0.75, X(bx + 5), ys + h);
  }
  g.lineStyle(1.2, BONE, 0.7);
  for (let i = 0; i < 6; i++) { const bx = 24 + i * 6; g.lineBetween(X(bx), ys - 11 + Math.abs(i - 2.5) * 0.9, X(bx + 2), ys - 15 + Math.abs(i - 2.5) * 0.9); }   // espinas de la aleta dorsal
  const tx = L - 10;                                                                            // cola bifurcada con radios
  g.lineStyle(1.8, BONE, 0.9); g.lineBetween(X(tx), ys, X(L + 2), ys - 11); g.lineBetween(X(tx), ys, X(L + 2), ys + 11); g.lineBetween(X(L + 2), ys - 11, X(L - 4), ys);  g.lineBetween(X(L + 2), ys + 11, X(L - 4), ys);
  g.lineStyle(1, BONE, 0.65); g.lineBetween(X(tx + 2), ys, X(L), ys - 6); g.lineBetween(X(tx + 2), ys, X(L), ys + 6); g.lineBetween(X(tx), ys, X(L + 1), ys);
  g.fillStyle(BONE, 0.2); g.fillEllipse(X(8), ys, 20, 17);                                      // craneo
  g.lineStyle(2, BONE, 0.95); g.strokeEllipse(X(8), ys, 20, 17);
  g.lineBetween(X(-2), ys + 1, X(6), ys + 6); g.lineBetween(X(-2), ys - 1, X(5), ys - 5);       // mandibula y hocico (boca abierta)
  g.lineStyle(1.4, BONE, 0.8); g.beginPath(); g.moveTo(X(14), ys - 7); g.lineTo(X(11), ys); g.lineTo(X(14), ys + 7); g.strokePath();   // opérculo
  g.fillStyle(DARK, 1); g.fillCircle(X(5), ys - 2, 3.1); g.lineStyle(1.2, BONE, 0.9); g.strokeCircle(X(5), ys - 2, 3.4);   // cuenca del ojo
}
function chainLinks(g, x0, y0, len, sway, time, ph) {
  const n = Math.floor(len / 9);
  g.lineStyle(1.6, 0x2d4352, 0.9);
  for (let i = 0; i < n; i++) {
    const t = i / n, ox = Math.sin(time / 1500 + ph) * sway * t * t, y = y0 + i * 9;
    g.strokeEllipse(x0 + ox, y + 4, i % 2 ? 3 : 5, 8);
  }
  const tx = x0 + Math.sin(time / 1500 + ph) * sway, ty = y0 + n * 9;
  g.fillStyle(0x16222c, 1); g.fillTriangle(tx - 5, ty + 2, tx + 5, ty + 2, tx, ty + 14);   // gancho
  g.lineStyle(1.4, 0x3c5565, 0.9); g.beginPath(); g.moveTo(tx - 5, ty + 2); g.lineTo(tx, ty + 14); g.lineTo(tx + 5, ty + 2); g.strokePath();
}

function drawSlime(g, x, y, w, rnd) {   // limo y algas en la base de una pared; percebes (circulitos claros) en la linea de marea
  g.fillStyle(0x2f5a3a, 0.55); g.fillRect(x, y - 5, w, 5);
  for (let i = 0; i < w / 7; i++) { const sx = x + 3 + i * 7 + rnd() * 3, h = 6 + rnd() * 12; g.lineStyle(1.6, 0x3d7a4c, 0.6); g.lineBetween(sx, y - 3, sx + (rnd() - 0.5) * 6, y - 3 - h); }
  g.fillStyle(0xcfd8d2, 0.5);
  for (let i = 0; i < w / 9; i++) g.fillCircle(x + 4 + i * 9 + rnd() * 4, y - 8 - rnd() * 5, 1.4 + rnd());
}
function drawShell(g, x, y, k) {   // concha
  g.fillStyle(0xb8b2a0, 0.6); g.fillEllipse(x, y - 3, 10, 7); g.lineStyle(1, 0x5f6258, 0.8);
  for (let i = -1; i <= 1; i++) g.lineBetween(x, y, x + i * 3, y - 6);
}
function drawNet(g, x, y, w, h) {   // red vieja tirada en el suelo
  g.lineStyle(1, 0x6f8591, 0.5);
  for (let i = 0; i <= 6; i++) g.lineBetween(x + i * w / 6, y - 2, x + i * w / 6 + 6, y - h);
  for (let j = 1; j <= 3; j++) g.lineBetween(x + j * 2, y - j * h / 3, x + w + j * 2, y - j * h / 3 + (j % 2 ? 2 : -2));
}
function drawArch(g, x, w, gy) {   // arco de concreto en el fondo: dos pilares y viga con borde mas claro
  g.fillStyle(0x0a1d29, 1); g.fillRect(x, 0, 26, gy); g.fillRect(x + w - 26, 0, 26, gy); g.fillRect(x, 0, w, 34);
  g.fillStyle(0x1c3a4a, 0.8); g.fillRect(x, 34, w, 3); g.fillRect(x + 26, 0, 2, gy); g.fillRect(x + w - 28, 0, 2, gy);
}
function drawStain(g, x, y, w, h) {   // mancha de humedad
  g.fillStyle(0x040c12, 0.22); g.fillEllipse(x, y, w, h); g.fillStyle(0x040c12, 0.14); g.fillEllipse(x + 4, y + h * 0.4, w * 0.6, h * 0.9);
}
function drawGrate(g, x, y, w, h) {   // rejilla oxidada
  g.fillStyle(0x03080c, 0.9); g.fillRect(x, y, w, h); g.lineStyle(2, 0x6b4a32, 0.75);
  for (let i = 0; i <= w; i += 8) g.lineBetween(x + i, y, x + i, y + h);
  g.lineStyle(2, 0x6b4a32, 0.6); g.strokeRect(x, y, w, h);
}

const HERO_H = 78;
const PULL_T = 700;   // duracion (ms) de la animacion de agarrar / jalar el tapon   // alto en pantalla del personaje de pie (px)

function pu0(sc, time) { return (time - sc.pullAt) / PULL_T; }

class Level extends Phaser.Scene {
  constructor() { super('Level'); }

  preload() { Object.keys(HERO_IMGS).forEach(function (k) { this.load.image('h_' + k, HERO_IMGS[k]); }, this); }


  addDecor() {
    this.decorOn = !document.body.classList.contains('color');
    if (!this.decorOn) return;
    const rnd = mulberry(7), back = this.add.graphics().setDepth(0.3), far = this.add.graphics().setDepth(0.4), webs = this.add.graphics().setDepth(0.95), floorG = this.add.graphics().setDepth(2.7), slime = this.add.graphics().setDepth(2.75);
    // drenaje pluvial: arcos de concreto cada 3 casillas de 6, manchas de humedad, rejillas y numeros de tramo pintados
    for (let x = 0; x < LW; x += 360) drawArch(back, x + 60, 200, GY);
    for (let i = 0; i < 16; i++) drawStain(back, 40 + i * (LW / 16) + rnd() * 90, 70 + rnd() * 240, 60 + rnd() * 70, 40 + rnd() * 50);
    for (let s = 0; s < NSEC; s++) {
      drawGrate(back, colx(s, 1) + 190 + (s === 1 ? 20 : 0), 52, 46, 22);
      this.add.text(colx(s, 1) + 30, 56, 'SECTION ' + (s + 1), { fontFamily: 'monospace', fontSize: '12px', color: '#8f7f66' }).setAlpha(0.45).setDepth(0.45);
    }
    // oxido: tuberias horizontales viejas en el fondo (las azules del juego siguen azules)
    back.fillStyle(0x4a3424, 0.7);
    [[0, 150], [1, 120], [2, 160]].forEach(function (p) { const x = colx(p[0], 1) + 300; back.fillRect(x, p[1], 260, 9); back.fillStyle(0x6b4a32, 0.8); back.fillRect(x - 3, p[1] - 2, 6, 13); back.fillRect(x + 257, p[1] - 2, 6, 13); back.fillStyle(0x4a3424, 0.7); });
    // raices que cuelgan del techo (pocas y cortas)
    for (let i = 0; i < 5; i++) { const x = 150 + i * (LW / 5) + rnd() * 120; drawBranch(far, x, -4, Math.PI / 2 + (rnd() - 0.5) * 0.3, 22 + rnd() * 22, 2 + rnd(), rnd); }
    // telaranas: solo 4, en las esquinas altas del fondo y pegadas al techo
    [[0, 1, 60], [colx(1, 1), 1, 55], [colx(1, SC) + T, -1, 55], [LW, -1, 50]].forEach(function (w) { drawWeb(webs, w[0], 0, w[2], w[1], 1, 0.2); });
    // basura de mar: una montanita de esqueletos de pez junto al pelicano (S2, columnas 13-17); conchas, algas secas y una red vieja por el resto
    this.textures.get('h_bones_pile').setFilter(Phaser.Textures.FilterMode.NEAREST);   // pixel art: sin suavizar
    floorG.fillStyle(0x03080c, 0.4); floorG.fillEllipse(colx(1, 15) + 10, GY - 1, 140, 6);
    this.add.image(colx(1, 15) + 10, GY + 1, 'h_bones_pile').setOrigin(0.5, 1).setScale(1.4).setDepth(2.7);   // montanita de pescados
    [[0, 2], [0, 15], [1, 1], [1, 9], [2, 3], [2, 14]].forEach(function (c) { drawShell(floorG, colx(c[0], c[1]) + 12, GY, 1); });
    drawNet(floorG, colx(0, 12) + 4, GY, 60, 14); drawNet(floorG, colx(2, 5) + 4, GY, 52, 12);
    // limo, algas y percebes: base de los muros (torres) y de los pozos
    WALLS.forEach(function (wl) { drawSlime(slime, colx(wl.s, wl.c) - 6, GY, T + 12, rnd); });
    PITS.forEach(function (p) { drawSlime(slime, colx(p.s, p.a) - 22, GY, 22, rnd); drawSlime(slime, colx(p.s, p.b) + T, GY, 22, rnd); });
    // luz por seccion: S1 gris oscura, S2 con algo de verde, S3 con luz azul del mar, y la boca del tunel al final
    const tints = [[0x0b0f12, 0.28, null], [0x0f2a1c, 0.16, null], [0x58b4e8, 0.07, 'add']];
    for (let s = 0; s < NSEC; s++) {
      const r = this.add.rectangle(ZB[s], 0, ZB[s + 1] - ZB[s], H, tints[s][0], tints[s][1]).setOrigin(0).setDepth(1.3);
      if (tints[s][2]) r.setBlendMode(Phaser.BlendModes.ADD);
    }
    const mx = LW - 20;   // boca del tunel: luz de afuera
    [[260, 0.07], [190, 0.08], [120, 0.1], [60, 0.14]].forEach(function (c) { this.add.circle(mx, GY - 60, c[0], 0xcfeeff, c[1]).setBlendMode(Phaser.BlendModes.ADD).setDepth(1.35); }, this);
    this.decorG = this.add.graphics().setDepth(0.9);   // cadenas, aranas y vapor (se animan)
    this.fogG = this.add.graphics().setDepth(1.2);
    this.dripG = this.add.graphics().setDepth(1.8);
    // cadenas viejas de mantenimiento: 4, cortas
    this.chains = [[colx(0, 3) + 12, 45], [colx(0, 16), 36], [colx(1, 6) + 8, 54], [colx(2, 12) + 10, 40]];
    // 2 aranas pegadas al techo
    this.spiders = [[colx(0, 6) + 20, 24], [colx(1, 14) + 12, 20]];
    // goteras: x, periodo (ms); caen del techo y hacen ondas al tocar el agua
    this.drips = [[colx(0, 5) + 14, 2300], [colx(0, 13) + 5, 3100], [colx(1, 4) + 9, 2700], [colx(1, 9) + 12, 3500], [colx(2, 9) + 20, 2900], [colx(2, 11) + 8, 3300]].map(function (d, i) { return { x: d[0], per: d[1], off: i * 480, z: zoneOf(d[0]) }; });
  }

  updateDecor(time) {
    if (!this.decorOn) return;
    const g = this.decorG; g.clear();
    this.chains.forEach(function (c, i) { chainLinks(g, c[0], 0, c[1], 3 + (i % 3), time, i * 1.7); }, this);
    this.spiders.forEach(function (sp, i) {
      const x = sp[0], y = sp[1] + Math.sin(time / 900 + i * 2) * 2;
      g.lineStyle(1, 0xb9c8d4, 0.35); g.lineBetween(x, 0, x, y);
      g.fillStyle(0x03080c, 1); g.fillCircle(x, y, 3.2); g.fillCircle(x, y + 5, 2.2);
      g.lineStyle(1.1, 0x03080c, 1);
      for (let j = -1; j <= 1; j += 2) for (let k = 0; k < 4; k++) { const ky = y - 2 + k * 2.6; g.lineBetween(x, ky, x + j * 7, ky - 3 + (k % 2) * 4); g.lineBetween(x + j * 7, ky - 3 + (k % 2) * 4, x + j * 9, ky + 3); }
      g.fillStyle(0xdfe8ee, 0.8); g.fillCircle(x - 1, y - 0.5, 0.7); g.fillCircle(x + 1, y - 0.5, 0.7);
    });
    const f = this.fogG; f.clear();
    for (let i = 0; i < 4; i++) {   // vapor de humedad muy tenue
      const sp = (i % 2 ? 1 : -0.7) * 0.008, x = ((i * 700 + time * sp) % (LW + 600) + LW + 600) % (LW + 600) - 300;
      f.fillStyle(0xb7d3e4, 0.012); f.fillEllipse(x, GY - 30 - (i % 2) * 40, 380, 34);
    }
    // goteras del techo: caen hasta la superficie del agua de su zona y hacen ondas
    const d = this.dripG; d.clear();
    this.drips.forEach(function (dr) {
      const ph = ((time + dr.off) % dr.per) / dr.per, sy = this.surfAt(dr.x), fall = 0.45;
      if (ph < fall) { const t = ph / fall, y = sy * t * t; d.fillStyle(0xbfe0f2, 0.7); d.fillEllipse(dr.x, y, 2.4, 5); }
      else if (ph < fall + 0.25) { const t = (ph - fall) / 0.25; d.lineStyle(1.2, 0xdff1ff, 0.55 * (1 - t)); d.strokeEllipse(dr.x, sy + 1, 6 + t * 26, 2 + t * 5); }
    }, this);
  }

  surfAt(x) { return GY - this.W.at(x); }   // y de la superficie del agua en x (cada punto tiene su propio nivel)
  lvlAt(x) { return this.W.level(x); }       // 0 = lamina, 1 = nivel alto

  create() {
    this.startTime = this.time.now;
    this.deaths = 0; this.coinCount = 0; this.gem = false;
    this.dead = false; this.done = false; this.checkpoint = 0;
    this.hp = HP_MAX; this.hurtUntil = 0; this.knockUntil = 0; this.knockV = 0;   // barra de vida: el cangrejo quita media barra, lo demas mata
    this.coyote = 0; this.buffer = 0; this.lastPull = 0;
    this.W = makeWater(LW, LOW_H, HIGH_H, WALLS.map(function (wl) { return [colx(wl.s, wl.c), colx(wl.s, wl.c) + T]; }));   // agua con fisica
    for (let z = 0; z < NZ; z++) this.W.fill(ZB[z], ZB[z + 1], START_HIGH[z] ? 1 : 0);
    this.zOpen = [0, 0, 0];
    this.hazards = []; this.coinObjs = []; this.plugObjs = []; this.ceilObjs = []; this.wasFloat = false; this.lastAmb = 0;

    this.physics.world.setBounds(0, 0, LW, H + 300);
    this.cameras.main.setBounds(0, 0, LW, H);
    const bg = this.add.graphics().setDepth(0), NB = 14;
    for (let i = 0; i < NB; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(8, 24, 36), new Phaser.Display.Color(24, 62, 80), NB, i);
      bg.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1); bg.fillRect(0, i * H / NB, LW, H / NB + 1);
    }
    if (document.body.classList.contains('color')) {   // control: fondo original con barras y cuadricula
      bg.fillStyle(0x0c2431, 1);
      for (let x = 0; x < LW; x += 160) bg.fillRect(x + 20, 0, 36, GY);
      bg.lineStyle(1, 0x2a5c72, 0.28);
      for (let y = 40; y < GY; y += 40) bg.lineBetween(0, y, LW, y);
    }
    for (let s = 0; s < NSEC; s++) [4, 16].forEach(function (c) {
      const lx = colx(s, c) + T / 2;
      const cone = this.add.graphics().setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD);
      cone.fillStyle(0xffd9a0, 0.05); cone.fillTriangle(lx, 18, lx - 130, GY, lx + 130, GY);
      [70, 44, 22].forEach(function (r) { this.add.circle(lx, 20, r, 0xffc46b, 0.07).setBlendMode(Phaser.BlendModes.ADD).setDepth(0.6); }, this);
      const l = this.add.graphics().setDepth(0.7);
      l.fillStyle(0x3b4a57, 1); l.fillRect(lx - 10, 0, 20, 10); l.fillStyle(0xffe2a8, 1); l.fillRoundedRect(lx - 8, 10, 16, 8, 3);
    }, this);

    const solids = this.physics.add.staticGroup(); this.solidsG = solids;
    const addSolid = function (scene, x, y, w, h, color, depth) {
      const r = scene.add.rectangle(x, y, w, h, color).setOrigin(0).setDepth(depth || 2);
      scene.physics.add.existing(r, true);
      solids.add(r);
      return r;
    };

    // Suelo con pozos
    const isPit = function (s, c) { return PITS.some(function (p) { return p.s === s && c >= p.a && c <= p.b; }); };
    let runStart = null;
    for (let gc = 0; gc <= NSEC * SC; gc++) {
      const s = Math.floor(gc / SC), c = (gc % SC) + 1;
      const ground = gc < NSEC * SC && !isPit(s, c);
      if (ground && runStart === null) runStart = gc;
      if (!ground && runStart !== null) {
        const len = gc - runStart;
        addSolid(this, runStart * T, GY, len * T, H - GY, 0x2b3a4a);
        this.add.rectangle(runStart * T, GY, len * T, 6, 0x84a98c).setOrigin(0).setDepth(2.5); // verde = seguro
        this.add.rectangle(runStart * T, GY, len * T, 2, 0xcdeac0).setOrigin(0).setDepth(2.6);
        const sg = this.add.graphics().setDepth(2.4); sg.lineStyle(1, 0x1c2835, 0.9);
        for (let x = runStart * T + T; x < (runStart + len) * T; x += T) sg.lineBetween(x, GY + 6, x, H);
        sg.lineBetween(runStart * T, GY + 70, (runStart + len) * T, GY + 70);
        runStart = null;
      }
    }
    const spikeG = this.add.graphics().setDepth(3);
    this.warnG = this.add.graphics().setDepth(3.2);   // aviso parpadeante de los pinchos de techo
    PITS.forEach(function (p) {
      const x = colx(p.s, p.a), w = (p.b - p.a + 1) * T;
      addSolid(this, x, GY + T, w, H - GY - T, 0x1b2a38);
      const st = hazardStyle();
      drawSpikes(spikeG, x, GY + T, w, -1, st);
      this.hazards.push({ r: new Phaser.Geom.Rectangle(x + 4, GY + T - SPIKE_H, w - 8, SPIKE_H), kind: 'floor' });
    }, this);
    // pilar con la gema (seccion 2, columna 6)
    addSolid(this, colx(1, 6), GY, T, T, 0x3d405b, 2.5);

    // Muros de 3 tiles
    WALLS.forEach(function (wl) {
      const x = colx(wl.s, wl.c);
      addSolid(this, x, GY - WALL_H, T, WALL_H, 0x6b705c, 2.5);
      this.add.rectangle(x, GY - WALL_H, T, 4, 0xa3a98f).setOrigin(0).setDepth(2.6);
      const wg = this.add.graphics().setDepth(2.6); wg.lineStyle(1, 0x4a4e40, 0.9);
      for (let y = GY - 40; y > GY - WALL_H + 8; y -= 40) wg.lineBetween(x, y, x + T, y);
      wg.lineStyle(2, 0x2f4a3a, 0.55);                              // borde de la cima (agarradero)
      wg.lineBetween(x + 2, GY - WALL_H + 5, x + T - 2, GY - WALL_H + 5);
    }, this);

    // Techos y pinchos de techo
    CEIL_SOLIDS.forEach(function (c) {
      addSolid(this, colx(c.s, c.a), GY - 5 * T, (c.b - c.a + 1) * T, T, 0x1b2a38, 2.5);
    }, this);
    CEIL_SPIKES.forEach(function (c) {
      const x = colx(c.s, c.a), w = (c.b - c.a + 1) * T, yb = GY - 4 * T;
      const st = hazardStyle();
      drawSpikes(spikeG, x, yb, w, 1, st);
      this.hazards.push({ r: new Phaser.Geom.Rectangle(x + 4, yb, w - 8, SPIKE_H), kind: 'ceil' });
      this.ceilObjs.push({ x: x, w: w, yb: yb, z: zoneOf(x + w / 2), st: st, warned: false });
    }, this);

    // Agua (por seccion) y linea punteada del nivel alto junto a cada tapon
    this.waterG = this.add.graphics().setDepth(1.5);   // el agua se dibuja cada frame desde la simulacion
    this.foamG = this.add.graphics().setDepth(1.62);
    this.dotG = this.add.graphics().setDepth(1.7);
    this.waveG = this.add.graphics().setDepth(1.65);
    this.floatingNow = false; this.floatSec = 0; this.sink = 0;
    this.climb = null; this.pushT = 0; this.swimSticky = false;
    this.pullAt = -9999; this.pullPlug = null; this.deadSince = 0; this.squash = 0; this.bounce = 0; this.wasGrounded = true; this.lastVy = 0; this.lastDust = 0; this.lead = 0;

    // Tapones con boya: tapado = desague cerrado (el agua sube); jalar la boya lo destapa (el agua baja).
    // Se dibujan cada frame en update segun el estado del agua de su seccion.
    this.plugG = this.add.graphics().setDepth(3.5);
    PLUGS.forEach(function (p) {
      const cx = colx(p.s, p.c) + T / 2;
      const hint = this.add.text(cx, GY - 45, 'E', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
        backgroundColor: '#2f80ed', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(6).setVisible(false);
      this.plugObjs.push({ s: p.s, z: p.z, cx: cx, c: p.c, hint: hint, by: GY - 15, open: plugStartsOpen(p), lock: 0, lockDur: 1 });
    }, this);

    // Tuberias azules: siempre vierten un chorro grande (se dibuja en update)
    this.pipeX = []; this.pipeL = [];
    for (let s = 0; s < NSEC; s++) {
      const x = [40, colx(0, 13), colx(2, 10)][s], pg = this.add.graphics().setDepth(1);
      this.pipeX.push(x + 91); this.pipeL.push(x);
      pg.fillStyle(0x1f5fbf, 1); pg.fillRect(x + 3, 0, 24, 44);          // tubo de suministro que baja del techo
      pg.fillStyle(0x2f80ed, 1); pg.fillRect(x + 5, 0, 20, 46);
      pg.fillStyle(0xbfe3ff, 0.4); pg.fillRect(x + 8, 0, 4, 40);
      pg.fillStyle(0x3b4a57, 1); pg.fillRect(x - 6, 0, 42, 6);           // placa de anclaje
      pg.fillStyle(0x1f5fbf, 1); pg.fillRect(x, 38, 100, 22); pg.fillRect(x + 78, 58, 26, 18);
      pg.fillStyle(0x2f80ed, 1); pg.fillRect(x, 40, 100, 18); pg.fillRect(x + 80, 58, 22, 14);
      pg.fillStyle(0xbfe3ff, 0.4); pg.fillRect(x, 43, 100, 4);
      pg.fillStyle(0x9ad0ff, 1); pg.fillRect(x, 12, 30, 6); pg.fillRect(x, 28, 30, 5); pg.fillRect(x + 76, 72, 30, 6);
    }
    this.flowG = this.add.graphics().setDepth(1.4);
    this.lastSplash = 0;
    this.addDecor();

    // Monedas (solo guia) y gema
    const addCoin = function (scene, s, c, y) {
      if (WALLS.some(function (wl) { return wl.s === s && wl.c === c; })) y = Math.min(y, GY - WALL_H - 20);   // una moneda en una torre va encima, no incrustada
      const o = scene.add.circle(colx(s, c) + T / 2, y, 8, 0xffd166).setStrokeStyle(2, 0xfff3b0).setDepth(3);
      scene.coinObjs.push(o);
    };
    [4, 5, 6, 7].forEach(function (c) { addCoin(this, 0, c, GY - HIGH_H - 20); }, this);
    [4, 5, 6, 7, 8].forEach(function (c) { addCoin(this, 1, c, GY - HIGH_H - 20); }, this);
    [4, 5, 6].forEach(function (c) { addCoin(this, 2, c, GY - 14); }, this);
    [9, 10, 11, 12].forEach(function (c) { addCoin(this, 2, c, GY - HIGH_H - 20); }, this);
    this.gemObj = this.add.rectangle(colx(1, 6) + T / 2, GY - 18, 16, 16, 0x9b5de5).setAngle(45)
      .setStrokeStyle(2, 0xd9b8ff).setDepth(3);

    // Banderas: verde = inicio y puntos de control, amarilla = meta
    const flag = function (scene, x, color) {
      const g = scene.add.graphics().setDepth(3);
      g.fillStyle(0xdddddd, 1); g.fillRect(x, GY - 70, 4, 70);
      g.fillStyle(color, 1); g.fillTriangle(x + 4, GY - 70, x + 4, GY - 46, x + 34, GY - 58);
    };
    this.flagX = [0, 1, 2].map(function (s) { return colx(s, 1) + 8; });
    this.flagX.forEach(function (x) { flag(this, x, 0x52b788); }, this);
    this.goalX = colx(2, 18) + 12;
    flag(this, this.goalX, 0xffd60a);

    // Jugador
    this.en = ENEMIES.map(function (e) { const x0 = colx(e.s, e.a), x1 = colx(e.s, e.b) + T; const o = { t: e.t, v: e.v, x0: x0, x1: x1, x: x0 + 20, dir: 1, st: 'fly', tm: 2 + Math.random() * 2, y: 0 }; if (e.t === 'crab') crabInit(o); else birdInit(o); return o; });
    this.crabG = this.add.graphics().setDepth(1.45);   // el cangrejo se dibuja detras del agua (depth 1.5): lo que queda bajo la superficie se ve sumergido
    this.enG = this.add.graphics().setDepth(4);
    this.shark = { dx: colx(SHARK_DEN.s, SHARK_DEN.c) + T / 2, x: 0, y: 0, d: 1, st: 'hide', tm: 0, cd: 3 };
    if (!document.body.classList.contains('color')) {   // pozo de luz: el mundo se hunde en sombra lejos del personaje
      if (!this.textures.exists('lamp')) {   // crear la textura solo una vez: al reiniciar la escena ya existe
        const tex = this.textures.createCanvas('lamp', 512, 512), cx = tex.getContext(), gr = cx.createRadialGradient(256, 256, 0, 256, 256, 256);
        gr.addColorStop(0, 'rgba(2,8,14,0)'); gr.addColorStop(0.3, 'rgba(2,8,14,0)'); gr.addColorStop(0.62, 'rgba(2,8,14,0.34)'); gr.addColorStop(1, 'rgba(2,8,14,0.6)');
        cx.fillStyle = gr; cx.fillRect(0, 0, 512, 512); tex.refresh();
      }
      this.lamp = this.add.image(W / 2, H / 2, 'lamp').setScrollFactor(0).setDepth(9).setDisplaySize(2300, 2300);
    }
    this.player = this.add.rectangle(this.flagX[0] + 40, GY - 30, PW, PH, 0xe9ecef).setDepth(5).setAlpha(0);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, solids);
    this.eyes = this.add.rectangle(0, 0, 5, 7, 0x111111).setDepth(6).setAlpha(0);
    this.skin = this.add.graphics().setDepth(5);
    this.heroK = HERO_H / HERO_META.idle0.h;
    this.spr = this.add.image(0, 0, 'h_idle0').setOrigin(0.5, 1).setScale(this.heroK).setDepth(4.9);
    this.sprW = this.add.image(0, 0, 'h_sw14w').setOrigin(0.5, 1).setScale(this.heroK).setDepth(4.95).setVisible(false);   // mitad mojada (bajo la superficie) al flotar quieto
    this.facing = 1;
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    if (!this.textures.exists('vig')) {
      const tx = this.textures.createCanvas('vig', W, H), c = tx.getContext();
      const gr = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
      gr.addColorStop(0, 'rgba(3,12,20,0)'); gr.addColorStop(1, 'rgba(3,12,20,0.55)');
      c.fillStyle = gr; c.fillRect(0, 0, W, H); tx.refresh();
    }
    this.add.image(0, 0, 'vig').setOrigin(0).setScrollFactor(0).setDepth(9);
    const pill = this.add.graphics().setScrollFactor(0).setDepth(9.5);
    pill.fillStyle(0x06121a, 0.6); pill.fillRoundedRect(10, 8, 168, 32, 16);
    // HUD minimo
    this.add.circle(24, 24, 8, 0xffd166).setScrollFactor(0).setDepth(10);
    this.coinText = this.add.text(40, 14, '0', { fontFamily: 'Trebuchet MS, system-ui, sans-serif', fontSize: '20px', color: '#fff' }).setScrollFactor(0).setDepth(10);
    this.add.circle(104, 24, 8, 0xe63946).setScrollFactor(0).setDepth(10);
    this.deathText = this.add.text(120, 14, '0', { fontFamily: 'Trebuchet MS, system-ui, sans-serif', fontSize: '20px', color: '#fff' }).setScrollFactor(0).setDepth(10);

    this.hpG = this.add.graphics().setScrollFactor(0).setDepth(10);   // barra de vida (2 mitades)
    this.drawHp();

    // Entrada
    const kb = this.input.keyboard;
    this.dbgG = null;
    kb.on('keydown-H', function () { setHit(!SHOW_HIT); });
    this.keys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D', up: 'UP', w: 'W', space: 'SPACE', e: 'E', down: 'DOWN', s: 'S', r: 'R', m: 'M' });
    this.jumpWas = false;

    log('session_start', { ua: navigator.userAgent.slice(0, 80), warn: WARN, sound: SFX.available, look: document.body.classList.contains('color') ? 'color' : 'tragic' });
  }

  update(time, delta) {
    const dt = Math.min(delta, 50) / 1000;

    // Agua con fisica: la tuberia solo vierte si todos los tapones de su tramo estan puestos; cada tapon abierto es un desague
    const W = this.W, zOpen = [0, 0, 0], srcs = [], sinks = [];
    this.plugObjs.forEach(function (p) { if (p.open) { zOpen[p.z]++; sinks.push({ x: p.cx, q: WATER.QOUT }); } });
    for (let z = 0; z < NZ; z++) if (!zOpen[z]) srcs.push({ x: this.pipeX[z], q: WATER.QIN });
    this.zOpen = zOpen;
    W.step(dt, srcs, sinks);
    const wg = this.waterG; wg.clear();
    this.waveG.clear(); this.foamG.clear();
    for (let i = 0; i < W.N;) {                       // un tramo continuo de agua entre torres
      if (W.solid[i]) { i++; continue; }
      let j = i; while (j < W.N && !W.solid[j]) j++;
      const x0 = i * W.CW, x1 = j * W.CW;
      wg.fillStyle(0x2f80ed, 0.45);
      for (let x = x0; x < x1; x += 10) {
        const xa = x, xb = Math.min(x + 10, x1), ha = W.at(Math.min(xa + 0.01, x1)), hb = W.at(Math.max(xb - 0.01, x0));
        const la = Math.min(1, Math.max(0, (ha - LOW_H) / (HIGH_H - LOW_H))), lb = Math.min(1, Math.max(0, (hb - LOW_H) / (HIGH_H - LOW_H)));
        wg.fillPoints([{ x: xa, y: GY - ha }, { x: xb, y: GY - hb }, { x: xb, y: GY + T * Math.min(1, lb * 3) }, { x: xa, y: GY + T * Math.min(1, la * 3) }], true);
      }
      [[3, 0.9, 0, 0], [2, 0.35, 1.6, 7]].forEach(function (L) {
        this.waveG.lineStyle(L[0], 0x9ad0ff, L[1]); this.waveG.beginPath();
        for (let x = x0; x <= x1 + 11; x += 12) {
          const xx = Math.min(x, x1), hx = W.at(Math.max(x0 + 0.01, Math.min(xx, x1 - 0.01)));
          const amp = 2.2 * (0.35 + 0.65 * Math.min(1, (hx - LOW_H) / 30));
          const yy = GY - hx + L[3] * Math.min(1, (hx - LOW_H) / 20) + Math.sin(xx * 0.03 + time / 380 + L[2]) * amp;
          if (x === x0) this.waveG.moveTo(xx, yy); else this.waveG.lineTo(xx, yy);
        }
        this.waveG.strokePath();
      }, this);
      i = j;
    }
    for (let i = 1; i < W.N; i++) {                   // espuma: rayitas que se mueven con la corriente
      if (W.solid[i - 1] || W.solid[i]) continue;
      const hh = Math.max(W.h[i - 1], W.h[i]), v = W.f[i] / Math.max(hh, 1);
      if (Math.abs(v) < 45 || hh < LOW_H + 6) continue;
      const sy = GY - hh, a = Math.min(0.7, Math.abs(v) / 300), off = ((time * v * 0.0012) % 24 + 24) % 24;
      this.foamG.lineStyle(2, 0xdff1ff, a);
      for (let k = -1; k < 1; k++) { const xx = i * W.CW + k * 24 + off - 12; this.foamG.lineBetween(xx, sy + 5, xx + Math.sign(v) * 9, sy + 5); }
    }
    this.plugG.clear();
    const plg = this.plugG;
    this.plugObjs.forEach(function (p) {
      const plugged = !p.open, cx = p.cx, surf = this.surfAt(p.cx);
      p.kick = (p.kick || 0) * 0.88; p.deny = (p.deny || 0) * 0.9;
      p.by = surf - 4 + Math.sin(time / 500 + cx) * 1.5 + p.kick * 9;             // la boya flota en la superficie
      plg.fillStyle(0x040b10, 1); plg.fillRoundedRect(cx - 19, GY, 38, 5, 2); // desague
      // centro y tamano del tapon: puesto (42x16) / afuera (30x9); al jalar lo lleva la mano o salta fuera del desague
      const inX = cx, inY = GY - 8, outX = cx + 27, outY = GY - 4.5, ease = function (u) { return u * u * (3 - 2 * u); };
      const tt = (time - (p.pt0 === undefined ? -1e9 : p.pt0)) / PULL_T, H = this.handPos;
      let px = plugged ? inX : outX, py = plugged ? inY : outY, sw = plugged ? 42 : 30, sh = plugged ? 16 : 9;
      if (tt >= 0 && tt < 1 && p.mode === 'buoy') {                    // se saca desde la boya: el tapon sale del desague
        const u = ease(tt); px = inX + (outX - inX) * u; py = inY + (outY - inY) * u - Math.sin(Math.PI * tt) * 14;
        sw = 42 - 12 * u; sh = 16 - 7 * u;
      } else if (tt >= 0 && tt < 1 && p.mode === 'plug' && H) {          // lo agarra con la mano y lo mete al desague
        const carryX = H.x, carryY = H.y + 9.5;
        if (tt < 0.25) { const u = ease(tt / 0.25); px = outX + (carryX - outX) * u; py = outY + (carryY - outY) * u; sw = 30 + 6 * u; sh = 9 + 4 * u; }
        else if (tt < 0.7) { px = carryX; py = carryY; sw = 36; sh = 13; }
        else { const u = ease((tt - 0.7) / 0.3); px = carryX + (inX - carryX) * u; py = carryY + (inY - carryY) * u; sw = 36 + 6 * u; sh = 13 + 3 * u; }
      }
      const ax = px, ay = py - sh / 2;
      const bx = cx, byy = p.by + 11;
      const dist = Math.hypot(bx - ax, byy - ay), slack = Math.max(0, HIGH_H + 8 - dist), bulge = Math.min(34, slack * 0.4);
      plg.lineStyle(3, 0x9ad0ff, 0.95); plg.beginPath(); plg.moveTo(ax, ay);   // cadena (floja si la boya esta abajo)
      for (let i = 1; i <= 14; i++) {
        const t = i / 14, sb = Math.sin(Math.PI * t) * bulge;
        plg.lineTo(ax + (bx - ax) * t + sb * 0.5 * (1 + 0.3 * Math.sin(t * 11)), ay + (byy - ay) * t - sb * 0.9);
      }
      plg.strokePath();
      plg.fillStyle(0x1f5fbf, 1); plg.fillRoundedRect(px - sw / 2, py - sh / 2, sw, sh, 5);          // tapon
      plg.fillStyle(0x2f80ed, 1); plg.fillRoundedRect(px - sw / 2, py - sh / 2, sw, sh * 0.72, 4);
      plg.fillStyle(0xbfe3ff, 0.5); plg.fillRect(px - sw / 2 + 5, py - sh / 2 + 2, sw * 0.45, 3);
      plg.lineStyle(2.2, 0xffd166, 1); plg.strokeCircle(px, py - sh / 2 - 3.5, 4);                   // anilla para agarrarlo
      const bcx = cx + Math.sin(time / 25) * 4 * p.deny, wz = p, rem = Math.max(0, p.lock - time);
      plg.fillStyle(0x1f5fbf, 1); plg.fillCircle(bcx, p.by, 13);      // boya
      plg.fillStyle(0x2f80ed, 1); plg.fillCircle(bcx, p.by - 1, 12);
      plg.fillStyle(0xbfe3ff, 0.9); plg.fillRect(bcx - 12, p.by - 3, 24, 5);
      plg.fillStyle(0xffffff, 0.7); plg.fillCircle(bcx - 5, p.by - 6, 3);
      if (rem > 0) {                                                  // enfriamiento: boya oscura + anillo que se llena
        plg.fillStyle(0x000000, 0.3); plg.fillCircle(bcx, p.by, 13);
        plg.lineStyle(3, p.deny > 0.1 ? 0xe63946 : 0xffd166, 0.95); plg.beginPath();
        plg.arc(bcx, p.by, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - rem / wz.lockDur), false); plg.strokePath();
      }
      plg.lineStyle(2, 0x9ad0ff, 0.5); plg.strokeEllipse(cx, surf + 1, 34, 6);
      if (p.kick > 0.05) { plg.lineStyle(2, 0xffffff, p.kick * 0.8); plg.strokeEllipse(cx, surf + 1, 34 + (1 - p.kick) * 60, 6 + (1 - p.kick) * 14); }
      if (!plugged && this.W.at(cx) > LOW_H + 2) {                     // remolino: el agua se va por el desague
        for (let i = 0; i < 3; i++) {
          const r = 22 - ((time / 28 + i * 7.5) % 22);
          plg.lineStyle(2, 0xdff1ff, Math.min(0.8, r / 22)); plg.strokeEllipse(cx, surf + 2, r * 2, r * 0.45);
        }
      }
    }, this);
    this.flowG.clear();
    for (let s = 0; s < NSEC; s++) {
      const fx = this.pipeX[s], top = 76, bot = this.surfAt(this.pipeX[s]) + 2, len = bot - top;
      const px = this.pipeL[s], L1 = 49, L2 = 76, L3 = 24, tot = L1 + L2 + L3;   // agua corriendo dentro del tubo
      this.flowG.fillStyle(0xdff1ff, 0.75);
      for (let k = 0; k < 6; k++) {
        const u = (time * 0.12 + k * (tot / 6)) % tot;
        if (u < L1) this.flowG.fillRect(px + 12, u, 6, 8);
        else if (u < L1 + L2) this.flowG.fillRect(px + 15 + (u - L1), 46, 8, 6);
        else this.flowG.fillRect(px + 88, 49 + (u - L1 - L2), 6, 8);
      }
      const filling = !this.zOpen[s] && this.lvlAt(this.pipeX[s]) < 0.999, sw = filling ? 28 : (this.zOpen[s] ? 12 : 18);
      this.flowG.fillStyle(0x2f80ed, 0.85); this.flowG.fillRect(fx - sw / 2, top, sw, len);
      if (filling) { this.flowG.fillStyle(0xdff1ff, 0.5); this.flowG.fillCircle(fx, 78, 11 + Math.sin(time / 80) * 2); }
      this.flowG.fillStyle(0xbfe3ff, 0.55);
      for (let k = 0; k <= len / 28; k++) {
        const yy = top + ((time * 0.4 + k * 28) % len);
        this.flowG.fillRect(fx - sw / 2 + 3 + (k % 3) * (sw / 4), yy, 3, Math.min(14, bot - yy));
      }
      this.flowG.fillStyle(0xffffff, 0.35); this.flowG.fillEllipse(fx, bot, 50 + (filling ? 26 : 0), 9);
      this.flowG.fillStyle(0xffffff, 0.7);
      for (let j = 0; j < 5; j++) this.flowG.fillCircle(fx + Math.sin(time / 90 + j * 2) * 15, bot - 1 + Math.cos(time / 110 + j) * 2, 4 + (j % 2) * 2);
    }
    if (time - this.lastSplash > 70) {
      this.lastSplash = time;
      for (let s = 0; s < NSEC; s++) {
        const filling = !this.zOpen[s] && this.lvlAt(this.pipeX[s]) < 0.999;
        if (filling || Math.random() < 0.5) this.burst(this.pipeX[s] + (Math.random() - 0.5) * (filling ? 22 : 14), this.surfAt(this.pipeX[s]), 0xdff1ff, filling ? 3 : 2, filling ? 60 : 46, filling ? -34 : -26);
      }
    }
    // Linea punteada: muestra a que altura llegara el agua si se tira del anillo
    this.dotG.clear(); this.dotG.lineStyle(2, 0x9ad0ff, 0.8);
    PLUGS.forEach(function (p) {
      if (this.lvlAt(colx(p.s, p.c) + T / 2) > 0.5) return;
      const x0 = colx(p.s, p.c) - T, y = GY - HIGH_H;
      for (let x = x0; x < x0 + 3 * T; x += 14) this.dotG.lineBetween(x, y, x + 7, y);
    }, this);

    // Aviso: los pinchos de techo parpadean (y su zona de peligro se enciende) cuando el agua esta alta o subiendo
    this.warnG.clear();
    if (WARN) {
      const ppx = this.player.x;
      this.ceilObjs.forEach(function (o) {
        const lv = Math.max(this.lvlAt(o.x + 8), this.lvlAt(o.x + o.w / 2), this.lvlAt(o.x + o.w - 8));
        const active = (!this.zOpen[o.z] && lv > 0.02) || lv > 0.8;   // llenandose (ningun desague abierto en su tramo) o ya alta                 // alta, o ya a punto de tocar los pinchos
        if (!active) { o.warned = false; return; }
        const gap = Math.max(o.x - ppx, ppx - (o.x + o.w), 0), close = gap < 7 * T;
        const pulse = 0.5 + 0.5 * Math.sin(time / (close ? 90 : 300)), on = Math.floor(time / (close ? 150 : 420)) % 2 === 0;
        const tipY = o.yb + SPIKE_H, bot = GY - HIGH_H + 6;
        this.warnG.fillStyle(o.st.color, 0.16 + 0.32 * pulse * (close ? 1 : 0.6));
        this.warnG.fillRect(o.x + 2, tipY, o.w - 4, bot - tipY);   // la zona donde la cabeza chocaria
        if (on) drawSpikes(this.warnG, o.x, o.yb, o.w, 1, { color: 0xffffff, shape: o.st.shape }, close ? 0.85 : 0.5);
        if (close && !o.warned) { o.warned = true; SFX.warn(); }
      }, this);
    }
    if (time - this.lastAmb > 150) {   // ambiente: sube en el agua y cerca de las tuberias
      this.lastAmb = time;
      let pd = 1e9; for (let i = 0; i < this.pipeX.length; i++) pd = Math.min(pd, Math.abs(this.player.x - this.pipeX[i]));
      SFX.ambience(this.floatingNow, Phaser.Math.Clamp(1 - pd / 450, 0, 1));
    }

    this.updateDecor(time);
    this.drawSkin(time);
    const PAD = this.readPad();
    if (Phaser.Input.Keyboard.JustDown(this.keys.m)) SFX.toggle();
    if (this.done) { padEnd(PAD); return; }
    if (Phaser.Input.Keyboard.JustDown(this.keys.r) || PAD.restart) { this.scene.restart(); return; }
    if (this.dead) return;

    const b = this.player.body, k = this.keys;
    let dir = 0;
    if (k.left.isDown || k.a.isDown || TOUCH.left || PAD.left) dir -= 1;
    if (k.right.isDown || k.d.isDown || TOUCH.right || PAD.right) dir += 1;
    // Trepar torre: mientras dura el saltito se empuja hacia la torre hasta quedar encima de ella
    const wallTop = GY - WALL_H;
    if (this.climb) {
      const c = this.climb, over = Math.abs(this.player.x - (c.wx + T / 2)) < 12;
      if ((b.blocked.down && time > c.t0 + 150) || time > c.t0 + 900) { if (b.blocked.down) { this.squash = 0.7; this.burst(this.player.x, this.player.y + PH / 2, 0xcdd9e3, 4, 30, -6); } this.climb = null; }
      else if (!over) dir = c.side;
    }
    b.setVelocityX(time < this.knockUntil ? this.knockV : dir * SPEED);
    this.inputDir = dir;   // la animacion de nado se decide por lo que presiona el jugador, no por la velocidad (contra una pared la velocidad oscila y parpadeaba entre brazada y flotar)
    if (dir) this.facing = dir;
    if (!dir && this.pullPlug && time - this.pullAt >= 0 && time - this.pullAt < PULL_T * 0.6) {   // al jalar: se acerca al objeto que va a agarrar
      const m3 = HERO_META.jump3, off = this.pullPlug.mode === 'plug' ? (m3.hand[0] - m3.ax) * this.heroK : 24;
      b.setVelocityX(Phaser.Math.Clamp((this.pullPlug.sx - this.facing * off - this.player.x) * 10, -110, 110));
    }
    this.lead += ((dir ? dir * 80 : this.facing * 30) - this.lead) * 0.04;
    this.cameras.main.setFollowOffset(-this.lead, 0);

    // Flotar: en agua alta el personaje flota en la superficie y no puede saltar ni bucear
    const sec = Phaser.Math.Clamp(Math.floor(this.player.x / (SC * T)), 0, NSEC - 1);
    const zn = zoneOf(this.player.x);
    const pLvl = this.lvlAt(this.player.x), surf = this.surfAt(this.player.x);
    if (this.climb || pLvl < SWIM_EXIT) this.swimSticky = false;              // si el agua baja de SWIM_EXIT deja de nadar y camina
    const floating = !this.climb && ((pLvl >= SWIM_ENTER && b.bottom >= surf - 6) || (pLvl >= SWIM_EXIT && !!this.swimSticky));   // empieza a nadar con SWIM_ENTER; con menos agua solo camina
    if (floating) this.swimSticky = true;
    if (floating && !this.wasFloat) SFX.splash();
    this.wasFloat = floating;
    b.setAllowGravity(!floating); this.floatingNow = floating; this.floatSec = zn;
    if (floating) {
      b.setVelocityY(Phaser.Math.Clamp((surf - 3 + 10 * (1 - pLvl) - b.bottom) * 8, -180, 180));
      this.coyote = 0;
    }

    // Saltito para subir a la torre: flotando junto a una torre, empuja hacia ella (o salta) y trepa
    let wallNear = null;
    if (floating && dir && !this.climb) {
      WALLS.forEach(function (wl) {
        const wx = colx(wl.s, wl.c);
        if (dir > 0 && Math.abs(b.right - wx) < 6) wallNear = { wx: wx, side: 1 };
        if (dir < 0 && Math.abs(b.left - (wx + T)) < 6) wallNear = { wx: wx, side: -1 };
      });
    }
    this.pushT = (wallNear && surf - wallTop <= CLIMB_MAX) ? this.pushT + dt : 0;
    if (wallNear && surf - wallTop <= CLIMB_MAX && (this.pushT > 0.14 || this.buffer > 0)) {
      const rise = (b.bottom - wallTop) + 10;
      this.climb = { wx: wallNear.wx, side: wallNear.side, t0: time };
      b.setAllowGravity(true);
      b.setVelocityY(-Math.sqrt(2 * this.physics.world.gravity.y * rise));
      this.buffer = 0; this.pushT = 0; this.floatingNow = false; this.coyote = 0; this.facing = wallNear.side;
      this.burst(this.player.x, surf, 0xdff1ff, 8, 50, -26);
      SFX.climb(); log('climb', { section: sec + 1 });
    }

    // Salto con tolerancia (coyote + buffer) para que el control no "se coma" pulsaciones
    const jumpDown = k.up.isDown || k.w.isDown || k.space.isDown || TOUCH.jump || PAD.jump;
    if (jumpDown && !this.jumpWas) this.buffer = 0.12; else this.buffer -= dt;
    this.jumpWas = jumpDown;
    if (b.blocked.down || b.touching.down) this.coyote = 0.09; else this.coyote -= dt;
    if (this.buffer > 0 && this.coyote > 0 && !floating) {
      b.setVelocityY(JUMP_V); this.buffer = 0; this.coyote = 0;
      this.squash = -0.6; this.burst(this.player.x, this.player.y + PH / 2, 0xcdd9e3, 4, 34, -6); SFX.jump();
    }

    // Reaccion a los controles: polvo al correr, aterrizaje, estela en el agua, saltito al flotar
    const grounded = b.blocked.down;
    if (grounded && !this.wasGrounded && this.lastVy > 220) { SFX.land(); this.squash = 1; this.burst(this.player.x, this.player.y + PH / 2, 0xcdd9e3, 6, 44, -8); }
    this.wasGrounded = grounded; this.lastVy = b.velocity.y;
    if (dir && time - this.lastDust > 150 && (grounded || floating)) {
      this.lastDust = time;
      if (floating) { this.burst(this.player.x - dir * 10, surf, 0xdff1ff, 2, 22, -8); SFX.stroke(); }
      else this.burst(this.player.x - dir * 8, this.player.y + PH / 2, 0xb8c4d0, 1, 14, -6);
    }
    if (floating && this.buffer > 0) { this.bounce = 1; this.buffer = 0; this.burst(this.player.x, surf, 0xdff1ff, 5, 36, -20); }

    // Tirar del anillo del tapon cercano
    let near = null;
    for (let i = 0; i < this.plugObjs.length; i++) {
      const p = this.plugObjs[i], d = Math.abs(this.player.x - p.cx);
      p.hint.setPosition(p.cx, p.by - 84); p.hint.setVisible(d < T * 1.1);
      const wetBlock = p.open && this.W.at(p.cx) - LOW_H > CLOSE_MAX_H;   // no se puede tapar con el agua corriendo
      const usePad = PADUI.active, key = usePad ? PADUI.glyph('pull') : 'E';   // con control muestra el boton (X / □) en vez de E
      const lab = (time < p.lock || wetBlock) ? '...' : key, bg = lab === '...' ? '#6b7280' : (usePad ? PADUI.color('pull') : '#2f80ed');
      if (p.hint.text !== lab || p.hint.hbg !== bg) { p.hint.setText(lab); p.hint.setBackgroundColor(bg); p.hint.hbg = bg; }
      if (d < T * 1.1) near = p;
    }
    const pull = Phaser.Input.Keyboard.JustDown(k.e) || Phaser.Input.Keyboard.JustDown(k.down) ||
                 Phaser.Input.Keyboard.JustDown(k.s) || TOUCH.pull || PAD.pull;
    TOUCH.pull = false;
    if (pull && near && time - this.lastPull > 250) {
      this.lastPull = time;
      const wasPlugged = !near.open, wetBlock = near.open && this.W.at(near.cx) - LOW_H > CLOSE_MAX_H;
      if (time < near.lock || wetBlock) {                             // enfriando, o con agua corriendo por el desague: no pasa nada
        near.deny = 1; rumble(40, 0.2); SFX.blocked(); log('plug_blocked', { section: near.s + 1, wet: wetBlock });
      } else {
        near.mode = wasPlugged ? 'buoy' : 'plug'; near.pt0 = time;           // tapado: jala la boya (abre); abierto: agarra el tapon (cierra)
        near.sx = wasPlugged ? near.cx : near.cx + 27;                       // donde esta el objeto que va a agarrar
        near.open = wasPlugged; SFX.pull(!near.open);
        near.lockDur = PLUG_LOCK; near.lock = time + near.lockDur;
        log('plug_pull', { section: near.s + 1, to: near.open ? 'low' : 'high', open: near.open });
        this.burst(near.cx, !near.open ? near.by : GY - 8, 0x9ad0ff, 8, 34, -50);
        rumble(90, 0.35); near.kick = 1; this.bounce = 0.25; this.pullAt = time; this.pullPlug = near; this.pullSwim = this.floatingNow;
        const dxp = near.sx - this.player.x; if (Math.abs(dxp) > 3) this.facing = dxp > 0 ? 1 : -1; this.cameras.main.shake(70, 0.002);
      }
    }

    // Peligros
    const pb = this.damageBox();
    if (this.lamp) { const c = this.cameras.main; this.lamp.setPosition(this.player.x - c.scrollX, this.player.y - c.scrollY - 20); }
    if (this.updateEnemies(dt, pb, sec, time)) return;
    for (let i = 0; i < this.hazards.length; i++) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(pb, this.hazards[i].r)) { this.die(this.hazards[i].kind + '_spikes', sec); return; }
    }
    if (b.y > H + 40) { this.die('fall', sec); return; }

    // Monedas y gema
    for (let i = this.coinObjs.length - 1; i >= 0; i--) {
      const c = this.coinObjs[i];
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y) < 24) {
        c.destroy(); this.coinObjs.splice(i, 1); this.coinCount++; this.coinText.setText(String(this.coinCount)); SFX.coin();
      }
    }
    if (!this.gem && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.gemObj.x, this.gemObj.y) < 28) {
      this.gem = true; this.gemObj.destroy(); SFX.gem(); log('gem', {});
    }

    // Puntos de control y meta
    for (let s = 0; s < NSEC; s++) if (this.player.x > this.flagX[s] && s > this.checkpoint) { this.checkpoint = s; SFX.flag(); if (this.hp < HP_MAX) { this.hp = HP_MAX; this.drawHp(); } }
    this.eyes.setPosition(this.player.x + this.facing * 5, this.player.y - 6);
    if (this.player.x > this.goalX) this.finish();
  }

  readPad() {
    const P = { left: false, right: false, jump: false, pull: false, restart: false, ok: false, lEdge: false, rEdge: false };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    const prev = this.padPrev || {}, cur = {};
    if (gp) {
      const bt = function (i) { return !!(gp.buttons[i] && gp.buttons[i].pressed); };
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      P.left = ax < -0.35 || bt(14); P.right = ax > 0.35 || bt(15);   // stick izq / cruceta
      P.jump = bt(0) || bt(12);                                       // A / cruceta arriba
      cur.pull = bt(2) || bt(1) || bt(13) || ay > 0.7;                // X, B, cruceta abajo o stick abajo
      cur.restart = bt(3); cur.ok = bt(0); cur.l = P.left; cur.r = P.right;   // Y reinicia (Start abre ajustes)
      P.pull = cur.pull && !prev.pull; P.restart = cur.restart && !prev.restart; P.ok = cur.ok && !prev.ok;
      P.lEdge = cur.l && !prev.l; P.rEdge = cur.r && !prev.r;
      if (performance.now() < PADUI.blockUntil) { P.pull = P.restart = P.ok = P.jump = false; }   // acaba de cerrar el menu / empezar: no cuenta ese boton como accion
      if (!this.padSeen) {
        this.padSeen = true;
        const kh = document.getElementById('keys');
        if (kh) { kh.style.display = ''; kh.textContent += ' · 🎮 stick/d-pad move · A jump · X or B pull · Y restart · Start settings · Select mute'; }
      }
    }
    this.padPrev = cur;
    return P;
  }

  // Elige el cuadro de animacion segun el estado del personaje
  heroFrame(time, b, grounded, spd) {
    if (this.dead) return 'dead';
    if (this.done) return 'done' + (Math.floor(time / 260) % 2);
    const pu = (time - this.pullAt) / PULL_T;
    if (this.pullPlug && pu >= 0 && pu < 1) {
      if (this.pullPlug.mode === 'buoy' && this.pullSwim) return 'sw' + SWIM_REACH;   // nadando: se queda con el brazo estirado y jala la boya
      if (this.pullPlug.mode === 'plug' && pu < 0.25) return 'jump3';        // se agacha a agarrar el tapon
      return 'pull' + (pu < 0.5 ? 0 : pu < 0.75 ? 1 : 2);
    }
    if (this.climb) {                                            // trepar: impulso -> mano en el borde -> se sube a la cima
      const top = GY - WALL_H, bt = b.bottom;
      if (bt > top + 24) return b.velocity.y < -60 ? 'jump1' : 'jump2';
      if (bt > top - 4) return 'pull0';
      return 'jump3';
    }
    if (this.floatingNow) {                                      // brazada continua; mas rapida al avanzar, lenta al flotar quieto
      const dtS = Math.min(50, time - (this.swimT || time)); this.swimT = time;
      const moving = spd > 0.05 || !!this.inputDir;
      if (moving) this.swimMoveT = time;
      if (time - (this.swimMoveT || 0) > 350) return 'sw' + TREAD_FRAMES[Math.floor(time / TREAD_MS) % TREAD_FRAMES.length];   // quieto en el agua: se queda erguido y solo mueve un poco los brazos
      this.swimPh = (this.swimPh || 0) + dtS / (moving ? 83 : 150);
      return 'sw' + (Math.floor(this.swimPh) % SWIM_FRAMES);
    }
    if (!grounded) return b.velocity.y < -100 ? 'jump1' : 'jump2';
    if (this.squash > 0.25) return 'jump3';                      // amortigua el aterrizaje
    if (spd > 0.05) return 'vr' + (Math.floor(time / 1000 * 14) % RUN_FRAMES);
    return 'idle' + (Math.floor(time / 600) % 2);
  }

  drawSkin(time) {
    const g = this.skin, p = this.player, b = p.body;
    g.clear();
    if (this.floatingNow) this.sink += (11 - this.sink) * 0.15; else if (b.blocked.down) this.sink = 0; else this.sink *= 0.85;   // al salir del agua y pisar el piso ya no se queda hundido
    this.squash *= 0.86; this.bounce *= 0.88;
    const grounded = b.blocked.down, spd = Math.min(1, Math.abs(b.velocity.x) / SPEED);
    const bob = this.floatingNow ? Math.sin(time / 420) * 1.5 : 0;
    const feetY = p.y + PH / 2 + this.sink + bob - this.bounce * 9;
    if (this.dead) { if (!this.deadSince) this.deadSince = time; } else this.deadSince = 0;
    if (grounded) { g.fillStyle(0x000000, 0.2); g.fillEllipse(p.x, p.y + PH / 2 + 1, 38, 6); }
    const name = this.heroFrame(time, b, grounded, spd), m = HERO_META[name], K = (/^sw/.test(name) && m.wl && !m.tread) ? this.heroK * SWIM_SCALE : this.heroK;
    const f = this.facing >= 0 ? 1 : -1;
    this.spr.setTexture('h_' + name).setFlipX(f < 0);
    this.spr.setOrigin(f > 0 ? m.ax / m.w : 1 - m.ax / m.w, 1).setScale(K);
    const swimming = /^sw/.test(name), sfc = this.surfAt(this.player.x);
    this.dmgInfo = { m: m, K: K, f: f, swimming: swimming, sfc: sfc };
    const wide = swimming && !this.climb, bw = wide ? Math.max(PW, (m.bw || m.w) * K * (m.tread ? TREAD_HIT_W * 0.85 : 0.8)) : PW;   // nadando: el cuerpo cubre todo el dibujo (horizontal)
    const bo = PW / 2 + (wide ? f * ((m.bcx !== undefined ? m.bcx : m.w / 2) - m.ax) * K : 0) - bw / 2;
    if (wide) {   // si el cuerpo ensanchado cae dentro de una torre (al entrar al agua pegado a ella, o al girar), sacarlo por el lado mas cercano
      const L = p.x + bo - PW / 2, R = L + bw;
      WALLS.forEach(function (wl) {
        const wx = colx(wl.s, wl.c);
        if (R > wx && L < wx + T) { const dl = R - wx, dr = wx + T - L; p.x += dl < dr ? -dl : dr; }
      });
    }
    if (Math.abs(b.width - bw) > 0.5 || Math.abs(b.offset.x - bo) > 0.5) { b.setSize(bw, PH, false); b.setOffset(bo, 0); }
    let sy = swimming ? sfc + (m.wl ? (m.h - m.wl) * K + bob * 0.4 : 9 + bob) : feetY;
    if (m.tread) sy = Math.min(sy, GY);   // poca agua: los pies se quedan sobre el piso (antes se recortaba el dibujo y parecia hundirse)
    const blink = !this.dead && time < this.hurtUntil && Math.floor(time / 90) % 2 === 0 ? 0.35 : 1;   // parpadea mientras es invulnerable
    this.spr.setAlpha(blink); this.sprW.setAlpha(blink);
    this.spr.setPosition(p.x, sy).setTint(this.dead ? 0xffb0b0 : 0xffffff);
    if (m.tread) {   // flotando quieto: dibujo seco sobre la superficie del agua y dibujo mojado (tinte de agua) debajo; el corte sigue la ola real
      const row = Math.max(0, Math.min(m.h, m.h - (sy - sfc) / K)), W = this.sprW;
      this.spr.setVisible(row > 0.5); if (row > 0.5) this.spr.setCrop(0, 0, m.w, row);
      W.setVisible(row < m.h - 0.5);
      if (row < m.h - 0.5) W.setTexture('h_' + name + 'w').setFlipX(f < 0).setOrigin(this.spr.originX, 1).setScale(K).setPosition(p.x, sy).setTint(this.dead ? 0xffb0b0 : 0xffffff).setCrop(0, row, m.w, m.h - row);
    } else { this.spr.setVisible(true); if (this.spr.isCropped) this.spr.setCrop(); this.sprW.setVisible(false); }
    this.handPos = null;
    if (m.hand && this.pullPlug && !this.dead && pu0(this, time) >= 0 && pu0(this, time) < 1) {
      const baseY = swimming && m.wl ? sfc + (m.h - m.wl) * K + bob * 0.4 : feetY;
      const hx = p.x + f * (m.hand[0] - m.ax) * K, hy = baseY - (m.h - m.hand[1]) * K;
      this.handPos = { x: hx, y: hy };
      if (this.pullPlug.mode === 'buoy') {                       // en el agua: jala la boya (la cadena del tapon) con una anilla
        const bx = this.pullPlug.cx, by = this.pullPlug.by - 11;
        const len = Math.hypot(hx - bx, hy - by), n = Math.max(2, Math.round(len / 4.5));
        const slack = Math.max(0, 7 - 6 * Math.sin(Math.PI * Math.min(1, pu0(this, time))));
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = bx + (hx - bx) * t, y = by + (hy - by) * t + Math.sin(Math.PI * t) * slack;
          g.fillStyle(0x262a36, 1); g.fillCircle(x, y, 2.7);
          g.fillStyle(i % 2 ? 0xdfe6f2 : 0x8e97ab, 1); g.fillCircle(x, y - 0.3, 1.5);
        }
        g.lineStyle(2.2, 0xffd166, 1); g.strokeCircle(hx, hy, 4.2);
        g.lineStyle(1, 0x7a5c12, 0.8); g.strokeCircle(hx, hy, 5.3);
      }
    }
    if (this.floatingNow) {
      const sf = this.surfAt(this.player.x), hw = swimming ? (m.wl ? m.w * K / 2 : 50) : 24, bot = swimming ? (m.wl ? sf + (m.h - m.wl) * K + bob * 0.4 : sf + 10 + bob) : feetY;
      if (bot > sf + 2 && !(swimming && m.wl)) { g.fillStyle(0x2f80ed, 0.5); g.fillRoundedRect(p.x - hw, sf, hw * 2, bot - sf + 1, { tl: 0, tr: 0, bl: 8, br: 8 }); }
      g.lineStyle(2, 0x9ad0ff, 0.7); g.strokeEllipse(p.x, sf + 1, hw * 2 + 14 + Math.sin(time / 200) * 5, 8);
    }
  }

  burst(x, y, color, n, spread, rise) {
    for (let i = 0; i < n; i++) {
      const c = this.add.circle(x, y, 2 + Math.random() * 3, color, 0.9).setDepth(7);
      this.tweens.add({ targets: c, x: x + (Math.random() - 0.5) * spread, y: y + rise + (Math.random() - 0.5) * spread * 0.6,
        alpha: 0, duration: 450 + Math.random() * 350, ease: 'Quad.out', onComplete: function () { c.destroy(); } });
    }
  }

  crabPuff(e, n, big) {   // arena que levanta al pisar o al sobresaltarse (solo bajo el agua)
    for (let i = 0; i < n; i++) e.puffs.push({ x: e.x + (Math.random() - 0.5) * 40, y: GY - 2 - Math.random() * 3, vx: (Math.random() - 0.5) * 14, vy: -(5 + Math.random() * 9), r: (big ? 3 : 2) + Math.random() * 2, t: 0 });
  }

  updateCrab(e, dt, time, G) {   // el cangrejo camina de lado a rafagas, reacciona al jugador y se comporta distinto cuando el agua sube
    const R = Math.random, clamp = Phaser.Math.Clamp, px = this.player.x, dx = px - e.x, sy = this.surfAt(e.x);
    const wet = clamp((GY - sy - 6) / 26, 0, 1), prevWet = e.wet; e.wet = wet;           // 0 = seco, 1 = totalmente sumergido
    const near = Math.abs(dx) < 230, prox = Math.max(0, 1 - Math.abs(dx) / 700) * (1 - 0.5 * wet);   // prox: volumen segun cercania (apagado bajo el agua)
    // el agua le llega: se sobresalta; el agua se va: se sacude
    if (prevWet < 0.35 && wet >= 0.35 && e.mode !== 'startle') { e.mode = 'startle'; e.mt = 0.8; this.crabPuff(e, 6, true); for (let i = 0; i < 6; i++) e.bubbles.push({ x: e.x + (R() - 0.5) * 20, y: GY - 16, vy: -(30 + R() * 25), r: 1.2 + R() * 2.2, ph: R() * 6 }); SFX.clack(prox); }
    if (prevWet > 0.3 && wet <= 0.3 && wet < prevWet) e.shake = 0.6;
    e.shake = Math.max(0, e.shake - dt);
    // salto de nado: sumergido, de vez en cuando se impulsa y flota unos instantes con las patas remando
    let hopLift = 0;
    if (e.hop > 0) { e.hop -= dt; hopLift = 13 * Math.sin(Math.PI * clamp(1 - e.hop / 0.75, 0, 1)); if (e.hop <= 0) { e.hop = 0; this.crabPuff(e, 3, false); } }
    else if (wet > 0.9 && (e.mode === 'walk' || e.mode === 'pause')) { e.hopT -= dt; if (e.hopT <= 0) { e.hop = 0.75; e.hopT = 4 + R() * 4; } }
    // maquina de estados
    e.mt -= dt;
    const wm = 1 - 0.45 * wet;   // bajo el agua las pausas son mas cortas: esta mas activo
    let tsp = 0, stHop = 0;
    if (e.mode === 'walk') { tsp = 1; if (e.mt <= 0) { e.mode = 'pause'; e.mt = (0.45 + R() * 0.9) * wm; e.idle = ['groom', 'wave', 'look', 'none'][Math.floor(R() * 4)]; e.idleSide = R() < 0.5 ? 0 : 1; } }
    else if (e.mode === 'pause') { if (e.mt <= 0) { if (near && R() < (wet < 0.3 ? 0.7 : 0.35)) { e.mode = 'threat'; e.mt = 1 + R() * 0.6; } else { e.mode = 'walk'; e.mt = 0.9 + R() * 1.0; } } }
    else if (e.mode === 'threat') { if (e.mt <= 0) { e.mode = 'walk'; e.mt = 0.9 + R() * 1.0; } }
    else if (e.mode === 'turn') { if (e.mt <= 0) { e.dir = -e.dir; e.mode = 'walk'; e.mt = 0.9 + R() * 1.0; } }
    else if (e.mode === 'startle') { stHop = 6 * Math.sin(Math.PI * clamp(1 - e.mt / 0.8, 0, 1)) * (e.mt > 0 ? 1 : 0); if (e.mt <= 0) { e.mode = 'walk'; e.mt = 0.9 + R() * 1.0; } }
    // movimiento: arranca y frena con inercia, mas rapido en rafaga; el promedio sigue siendo ~ la velocidad original
    e.sp += (tsp - e.sp) * Math.min(1, dt * (tsp > e.sp ? 7 : 11));
    const mv = e.sp * e.v * 1.45 * (1 + 0.18 * wet) * dt * e.dir;
    e.x += mv;
    if (e.x > e.x1 - 20) { e.x = e.x1 - 20; if (e.mode === 'walk') { e.mode = 'turn'; e.mt = 0.4; } }
    else if (e.x < e.x0 + 20) { e.x = e.x0 + 20; if (e.mode === 'walk') { e.mode = 'turn'; e.mt = 0.4; } }
    e.ph += Math.abs(mv) * 0.35 + (e.hop > 0 ? dt * 14 : 0);   // ciclo de patas ligado a la distancia: los pies no patinan
    e.lift = wet * 2.6 + hopLift + stHop;
    e.stepT += Math.abs(mv);
    if (e.stepT > 9) { e.stepT -= 9; if (wet < 0.5) SFX.skitter(prox); else if (R() < 0.8) this.crabPuff(e, 1, false); }
    // pinzas, boca y ojos: objetivos segun el modo
    const flo = wet * (0.35 + 0.12 * Math.sin(time / 480)), clT = [flo, flo], grT = [0, 0], opT = [0.1, 0.1];
    let eyeT = 0.45 + 0.35 * wet, lookT = near ? clamp(dx / 70, -1, 1) : Math.sin(time / 900 + e.x0) * 0.7;
    if (e.mode === 'walk') { clT[0] += 0.1 + 0.1 * Math.sin(e.ph) * e.sp; clT[1] += 0.1 + 0.1 * Math.sin(e.ph + Math.PI) * e.sp; if (!near) lookT = e.dir * 0.8; }
    else if (e.mode === 'pause') {
      const i = e.idleSide;
      if (e.idle === 'groom') { grT[i] = 0.7 + 0.3 * Math.sin(time / 120); opT[i] = 0.45 + 0.45 * Math.sin(time / 120); }
      else if (e.idle === 'wave') { clT[i] = 0.8 + 0.2 * Math.sin(time / 170); opT[i] = 0.3 + 0.3 * Math.sin(time / 170 + 1); }
      else if (e.idle === 'look') { lookT = Math.sin(time / 380) * 1.1; eyeT = 0.9; }
    } else if (e.mode === 'threat') {
      clT[0] = clT[1] = 1; eyeT = 1; opT[0] = 0.5 + 0.5 * Math.sin(time / 55); opT[1] = 0.5 + 0.5 * Math.sin(time / 55 + 2.4);
      if (e.op[0] > 0.8 && !e.clk) { e.clk = true; SFX.clack(prox); } else if (e.op[0] < 0.3) e.clk = false;
    } else if (e.mode === 'turn') { clT[0] = clT[1] = 0.55; eyeT = 0.9; opT[0] = opT[1] = 0.3; }
    else if (e.mode === 'startle') { clT[0] = clT[1] = 1; eyeT = 1; opT[0] = opT[1] = 1; }
    if (e.hop > 0) { clT[0] = clT[1] = 0.85; opT[0] = opT[1] = 0.6; }
    for (let i = 0; i < 2; i++) { e.cl[i] += (clT[i] - e.cl[i]) * Math.min(1, dt * 10); e.gr[i] += (grT[i] - e.gr[i]) * Math.min(1, dt * 10); e.op[i] += (opT[i] - e.op[i]) * Math.min(1, dt * 18); }
    e.eyeUp += (eyeT - e.eyeUp) * Math.min(1, dt * 9); e.look += (lookT - e.look) * Math.min(1, dt * 8);
    // burbujas: sumergido suelta burbujas por la boca; revientan en la superficie
    if (wet > 0.6) { e.bt -= dt; if (e.bt <= 0) { const n = 1 + (R() < 0.4 ? 1 : 0); for (let i = 0; i < n; i++) e.bubbles.push({ x: e.x + e.dir * 3 + (R() - 0.5) * 3, y: GY - 15 - e.lift - i * 4, vy: -(26 + R() * 18), r: 1.2 + R() * 2, ph: R() * 6 }); e.bt = (e.mode === 'threat' ? 0.2 : 0.5) + R() * 1.1; } }
    for (let i = e.bubbles.length - 1; i >= 0; i--) {
      const b = e.bubbles[i]; b.y += b.vy * dt; b.x += Math.sin(time / 230 + b.ph) * 10 * dt;
      if (b.y <= sy + 2) { e.pops.push({ x: b.x, y: sy + 1, t: 0 }); e.bubbles.splice(i, 1); }
    }
    for (let i = e.pops.length - 1; i >= 0; i--) { e.pops[i].t += dt; if (e.pops[i].t > 0.4) e.pops.splice(i, 1); }
    for (let i = e.puffs.length - 1; i >= 0; i--) { const p = e.puffs[i]; p.t += dt / 0.9; p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 3; if (p.t >= 1) e.puffs.splice(i, 1); }
    // dibujo
    drawCrab(this.crabG, e, GY, time);
    e.puffs.forEach(function (p) { G.fillStyle(0x93a3a8, 0.35 * (1 - p.t)); G.fillCircle(p.x, p.y, p.r); });
    e.bubbles.forEach(function (b) { G.lineStyle(1, 0xdff1ff, 0.8); G.strokeCircle(b.x, b.y, b.r); G.fillStyle(0xffffff, 0.5); G.fillCircle(b.x - b.r * 0.3, b.y - b.r * 0.3, 0.6); });
    e.pops.forEach(function (p) { G.lineStyle(1.2, 0xdff1ff, 0.6 * (1 - p.t / 0.4)); G.strokeEllipse(p.x, p.y, 6 + p.t * 50, 2 + p.t * 8); });
    G.fillStyle(0x070b10, 1); G.lineStyle(3, 0x070b10, 1);
  }

  birdVis(e, dt, time, yS, prox) {   // capa visual del pelicano: aleteo en rafagas y planeo, giro suave, cabeza que baja a mirar, gotas y ondas al salir del agua
    const R = Math.random, k = function (r) { return Math.min(1, dt * r); };
    e.fd += (e.dir - e.fd) * k(6);                                           // al dar la vuelta se achica y se voltea (no cambia de golpe)
    e.fmode = 'flap';   // aletea siempre (el planeo intermitente se quito)
    const rate = e.st === 'warn' ? 20 : (e.st === 'rise' ? 13 : 8.5);        // rad/s
    if (e.fmode === 'flap') e.fp += rate * dt;
    const tgt = e.fmode === 'glide' ? 0.55 + 0.1 * Math.sin(time / 700) : Math.sin(e.fp);
    e.flap += (tgt - e.flap) * k(e.fmode === 'glide' ? 5 : 30);
    const bobY = e.fmode === 'glide' ? Math.sin(time / 1300) * 2 : Math.cos(e.fp) * (e.st === 'rise' ? 3.5 : 2.2);   // sube en cada aleteo hacia abajo
    const pT = e.st === 'rise' ? 0.38 : (e.st === 'warn' ? 0.18 : (e.fmode === 'glide' ? -0.12 : 0.05 * Math.cos(e.fp)));
    e.pitch += (pT - e.pitch) * k(6);
    const hT = e.st === 'warn' ? 1 : (e.fmode === 'glide' ? 0.45 : 0.25);
    e.head += (hT - e.head) * k(7);
    const n = Math.floor((e.fp + Math.PI / 2) / (Math.PI * 2));              // sonido: un soplido por aleteo, graznido al avisar
    if (n !== e.flaps) { e.flaps = n; if (e.fmode === 'flap') SFX.flap(prox); }
    if (e.st === 'warn' && e.pst !== 'warn') SFX.caw(prox);
    if (e.st === 'stay' && e.pst !== 'stay') e.rings.push({ x: e.x, y: yS, t: 0 });
    if (e.st === 'rise' && e.pst === 'stay') { e.rings.push({ x: e.x, y: yS, t: 0 }); e.dropT = 0.7; }
    e.pst = e.st;
    if (e.dropT > 0) { e.dropT -= dt; if (R() < dt * 30) e.drops.push({ x: e.x + (R() - 0.5) * 26, y: e.y + 4, vx: (R() - 0.5) * 12, vy: 10 + R() * 20 }); }
    for (let i = e.drops.length - 1; i >= 0; i--) { const d = e.drops[i]; d.vy += 260 * dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.y >= yS) { e.rings.push({ x: d.x, y: yS, t: 0.45, small: true }); e.drops.splice(i, 1); } }
    for (let i = e.rings.length - 1; i >= 0; i--) { e.rings[i].t += dt; if (e.rings[i].t > 0.8) e.rings.splice(i, 1); }
    return { flap: e.flap, head: e.head, pitch: e.pitch, bobY: bobY };
  }

  updateEnemies(dt, pb, sec, time) {   // enemigos en silueta; el agua decide cuando son peligrosos
    const G = this.enG; G.clear(); this.crabG.clear();
    this.progEl = this.progEl || document.getElementById('prog-dot');
    if (this.progEl) this.progEl.style.left = Math.min(100, Math.max(0, this.player.x / LW * 100)) + '%';
    this.hitRects = [];
    const hits = this.hitRects;
    const hit = function (cx, cy, w, h) { const r = new Phaser.Geom.Rectangle(cx - w / 2 + 4, cy - h / 2 + 4, w - 8, h - 8); hits.push(r); return Phaser.Geom.Intersects.RectangleToRectangle(pb, r); };
    const patrol = function (e) { e.x += e.dir * e.v * dt; if (e.x > e.x1 - 20) { e.x = e.x1 - 20; e.dir = -1; } else if (e.x < e.x0 + 20) { e.x = e.x0 + 20; e.dir = 1; } };
    // pelicano: patrulla irregular (cambia de sentido y de velocidad al azar, sin quedarse nunca quieta) para que no repita siempre los mismos puntos
    const patrolR = function (e) {
      e.turnT = (e.turnT === undefined ? 0 : e.turnT) - dt;
      if (e.turnT <= 0) { e.turnT = 1.5 + Math.random() * 2.5; if (Math.random() < 0.5) e.dir *= -1; e.vm = 0.6 + Math.random() * 0.9; }   // nunca se queda quieta: siempre avanza (el aleteo y su sonido siguen al movimiento)
      e.x += e.dir * e.v * (e.vm === undefined ? 1 : e.vm) * dt;
      if (e.x > e.x1 - 20) { e.x = e.x1 - 20; e.dir = -1; } else if (e.x < e.x0 + 20) { e.x = e.x0 + 20; e.dir = 1; }
    };
    const S = this.shark, den = S.dx;
    if (SHARK_ON) { G.fillStyle(0x02050a, 1); G.fillEllipse(den, GY + 3, 60, 17); }           // hueco del tiburon
    G.fillStyle(0x070b10, 1); G.lineStyle(3, 0x070b10, 1);
    for (let i = 0; i < this.en.length; i++) {
      const e = this.en[i], z = zoneOf(e.x), hi = this.lvlAt(e.x);
      if (e.t === 'crab') {
        this.updateCrab(e, dt, time, G);
        if (hit(e.x, GY - 15 - e.lift, 64, 30) && this.hurt('crab', sec, time, e.x)) return true;   // la caja de dano sigue al cuerpo (si salta nadando, sube con el)
      } else {   // pelicano: vuela alto; si el agua esta alta avisa, se lanza en picada, se queda un instante y sube
        const yFly = GY - HIGH_H - 90, yS = this.surfAt(e.x) + 4; e.tm -= dt;
        if (e.st === 'fly') { patrolR(e); e.y = yFly + Math.sin(time / 300 + e.x0) * 5; if (e.tm <= 0) { if (hi > 0.85 && Math.random() < 0.7 && Math.abs(e.x - (e.lastDive === undefined ? -1e9 : e.lastDive)) > 45) { e.st = 'warn'; e.tm = 0.7 + Math.random() * 0.3; e.lastDive = e.x; } else e.tm = 0.4 + Math.random() * 1.4; } }
        else if (e.st === 'warn') { e.y = yFly + Math.sin(time / 60) * 3; if (e.tm <= 0) { e.st = 'dive'; e.tm = 0.3; } }
        else if (e.st === 'dive') { const p = 1 - Math.max(0, e.tm) / 0.3; e.y = yFly + (yS - yFly) * p * p; if (e.tm <= 0) { e.st = 'stay'; e.tm = 0.35; SFX.splash(); this.burst(e.x, yS, 0x9ad0ff, 8, 60, -60); } }
        else if (e.st === 'stay') { e.y = yS; if (e.tm <= 0) { e.st = 'rise'; e.tm = 0.7; } }
        else { patrolR(e); e.y = yFly + (yS - yFly) * (Math.max(0, e.tm) / 0.7); if (e.tm <= 0) { e.st = 'fly'; e.tm = 2 + Math.random() * 2.5; } }
        const x = e.x, y = e.y, d = e.dir, diving = e.st === 'dive' || e.st === 'stay';
        if (e.st === 'warn') { G.lineStyle(2, 0xcfe8ff, 0.5); G.strokeEllipse(x, yS, 44 + Math.sin(time / 90) * 8, 8); G.lineStyle(3, 0x070b10, 1); }
        const bv = this.birdVis(e, dt, time, yS, Math.max(0, 1 - Math.abs(this.player.x - e.x) / 700));
        e.rings.forEach(function (r) { const a = 0.6 * (1 - r.t / 0.8); G.lineStyle(r.small ? 1 : 1.6, 0xdff1ff, a); G.strokeEllipse(r.x, r.y, (r.small ? 4 : 10) + r.t * (r.small ? 30 : 100), 2 + r.t * (r.small ? 4 : 12)); });
        e.drops.forEach(function (q) { G.fillStyle(0x9ad0ff, 0.85); G.fillCircle(q.x, q.y, 1.3); });
        G.lineStyle(3, 0x070b10, 1);
        drawBird(G, x, y + (diving ? 0 : bv.bobY), e.fd, e.st, time, bv);   // la picada no cambia: misma posicion y caja de dano
        if (diving && hit(x, y + 12, 34, 92)) { this.die('pelican', sec); return true; }
      }
    }
    if (!SHARK_ON) { this.drawHitboxes(); return false; }
    // tiburon: vive en su hueco. Si estas nadando cerca, sale, te acecha por debajo, salta a morder y vuelve al hueco
    const hi2 = this.lvlAt(den), swimNear = this.floatingNow && this.floatSec === 2 && Math.abs(this.player.x - den) < 520, sf = this.surfAt(den), depth = sf + 46;
    if (hi2 < 0.85 && S.st !== 'hide') { S.st = 'hide'; S.cd = 3; }
    S.tm -= dt;
    if (S.st === 'hide') { if (hi2 > 0.85 && swimNear) S.cd -= dt; if (S.cd <= 0) { S.st = 'stalk'; S.x = den; S.y = GY - 4; S.tm = 2.2; SFX.stroke(); } }
    else if (S.st === 'stalk') {
      const px = this.player.x; S.d = px > S.x ? 1 : -1; S.x += S.d * Math.min(190 * dt, Math.abs(px - S.x)); S.y += (depth - S.y) * Math.min(1, dt * 3);
      if (Math.abs(px - S.x) < 60 || S.tm <= 0) { S.st = 'lunge'; S.tm = 0.75; S.tx = S.x; }
    } else if (S.st === 'lunge') {
      const p = 1 - Math.max(0, S.tm) / 0.75; S.x = S.tx; S.y = depth - (depth - (sf - 70)) * Math.sin(Math.PI * p);
      if (p > 0.15 && !S.splashed) { S.splashed = true; SFX.splash(); this.burst(S.x, sf, 0x9ad0ff, 8, 70, -70); }
      if (S.tm <= 0) { S.st = 'return'; S.splashed = false; }
    } else if (S.st === 'return') {
      S.d = den > S.x ? 1 : -1; S.x += S.d * Math.min(230 * dt, Math.abs(den - S.x));
      S.y += ((Math.abs(den - S.x) < 14 ? GY + 10 : depth) - S.y) * Math.min(1, dt * 4);
      if (Math.abs(den - S.x) < 3 && S.y > GY - 6) { S.st = 'hide'; S.cd = 4 + Math.random() * 2.5; }
    }
    if (S.st !== 'hide') {
      const x = S.x, y = S.y, d = S.d, lunge = S.st === 'lunge', a = S.st === 'stalk' || S.st === 'return' ? 0.6 : 1;
      G.fillStyle(0x070b10, a);
      G.fillEllipse(x, y, 64, 22); G.fillTriangle(x - d * 28, y, x - d * 48, y - 14, x - d * 48, y + 14);       // cuerpo y cola
      G.fillTriangle(x - d * 6, y - 8, x + d * 10, y - 8, x - d * 2, y - 26);                                    // aleta dorsal
      G.fillTriangle(x + d * 4, y + 8, x + d * 16, y + 8, x + d * 4, y + 20);                                    // aleta inferior
      if (S.st === 'stalk') { G.fillStyle(0x070b10, 1); G.fillTriangle(x - d * 6, sf + 2, x + d * 10, sf + 2, x - d * 2, sf - 16); }   // la aleta asoma en la superficie
      G.fillStyle(0xdfe8ee, 1); G.fillCircle(x + d * 18, y - 3, 2);
      if (lunge) { for (let t = 0; t < 4; t++) G.fillTriangle(x + d * (14 + t * 4), y + 5, x + d * (17 + t * 4), y + 5, x + d * (15.5 + t * 4), y + 11); }
      if (lunge && y < sf + 30 && hit(x, y, 60, 26)) { this.die('shark', sec); return true; }
    }
    this.drawHitboxes();
    return false;
  }

  resetEnemies() {   // al morir, todos los enemigos vuelven a su estado inicial (ningun ataque queda a medias)
    this.en.forEach(function (e) { e.x = e.x0 + 20; e.dir = 1; e.st = 'fly'; e.tm = 2 + Math.random() * 2; e.y = 0; if (e.t === 'crab') crabInit(e); else birdInit(e); });
    Object.assign(this.shark, { st: 'hide', cd: 3, tm: 0, splashed: false });
  }

  damageBox() {   // caja de dano: sigue al dibujo (de pie = torso y piernas; nadando = la parte que asoma sobre el agua)
    const p = this.player, b = p.body, d = this.dmgInfo;
    if (!d) return new Phaser.Geom.Rectangle(b.x + 3, b.y + 3, b.width - 6, b.height - 6);
    const m = d.m, K = d.K;
    if (d.swimming) {
      const tr = !!m.tread, w = (m.bw || m.w) * K * (tr ? TREAD_HIT_W : 0.8), cx = p.x + d.f * ((m.bcx !== undefined ? m.bcx : m.w / 2) - m.ax) * K, top = d.sfc - (m.wl || m.h / 2) * K - (tr ? 6 : 0);
      return new Phaser.Geom.Rectangle(cx - w / 2, top, w, d.sfc + (tr ? TREAD_HIT_DEEP : 6) - top);   // flotando quieto: caja mas grande (mas ancha, con la cabeza y las piernas sumergidas)
    }
    const w = Math.max(18, Math.min(30, m.w * K * 0.6)), h = m.h * K * 0.88;
    return new Phaser.Geom.Rectangle(p.x - w / 2, b.bottom - h, w, h);
  }

  drawHitboxes() {   // vista de depuracion (tecla H o ?debug=hitboxes): verde = cuerpo fisico, amarillo = caja de dano del jugador, rojo = peligros, naranja = enemigos, azul = solidos
    if (!SHOW_HIT) return;
    const D = this.dbgG || (this.dbgG = this.add.graphics().setDepth(40)); D.clear();
    D.lineStyle(1.5, 0x4aa3ff, 1); this.solidsG.getChildren().forEach(function (o) { if (o.body) D.strokeRect(o.body.x, o.body.y, o.body.width, o.body.height); });
    D.lineStyle(1.5, 0xff3b3b, 1); this.hazards.forEach(function (h) { D.strokeRect(h.r.x, h.r.y, h.r.width, h.r.height); });
    D.lineStyle(1.5, 0xff9f1a, 1); (this.hitRects || []).forEach(function (r) { D.strokeRect(r.x, r.y, r.width, r.height); });
    const b = this.player.body;
    D.lineStyle(1.5, 0x39ff7a, 1); D.strokeRect(b.x, b.y, b.width, b.height);
    const db = this.damageBox(); D.lineStyle(1.5, 0xffe14a, 1); D.strokeRect(db.x, db.y, db.width, db.height);
  }

  drawHp() {
    const g = this.hpG; g.clear();
    g.fillStyle(0x06121a, 0.6); g.fillRoundedRect(10, 44, 168, 16, 8);
    for (let i = 0; i < HP_MAX; i++) {
      g.fillStyle(i < this.hp ? 0xe63946 : 0x3a1c22, 1); g.fillRoundedRect(15 + i * 81, 48, 77, 8, 4);
      if (i < this.hp) { g.fillStyle(0xff8a93, 0.5); g.fillRect(19 + i * 81, 49, 69, 2); }
    }
  }

  // golpe no letal (cangrejo): quita media barra, da un instante de invulnerabilidad y empuja hacia atras. Devuelve true si murio.
  hurt(cause, sec, time, fromX) {
    if (time < this.hurtUntil) return false;
    this.hp--; this.drawHp();
    if (this.hp <= 0) { this.die(cause, sec); return true; }
    this.hurtUntil = time + HURT_MS;
    const away = this.player.x >= fromX ? 1 : -1;
    this.knockUntil = time + 220; this.knockV = away * 260;
    this.player.body.setVelocityY(-230);
    this.cameras.main.shake(120, 0.004); rumble(120, 0.4); SFX.die();
    this.burst(this.player.x, this.player.y, 0xe63946, 6, 40, -14);
    log('hurt', { cause: cause, section: sec + 1, hp: this.hp });
    return false;
  }

  die(cause, sec) {
    if (this.dead || this.done) return;
    this.dead = true; this.deaths++; this.hp = 0; this.drawHp();
    this.deathText.setText(String(this.deaths));
    SFX.die(); document.body.classList.add('dead');
    log('death', { cause: cause, section: sec + 1, x: Math.round(this.player.x), n: this.deaths });
    this.player.setFillStyle(0xe63946); this.eyes.setVisible(false);
    this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
    this.cameras.main.shake(150, 0.004); rumble(220, 0.6);
    this.burst(this.player.x, this.player.y, 0xe63946, 12, 70, -20); this.burst(this.player.x, this.player.y, 0xeef3f8, 8, 50, -30);
    this.time.delayedCall(500, this.respawn, [], this);
  }

  respawn() {
    document.body.classList.remove('dead');
    this.resetEnemies();
    // Vuelve a la ultima bandera; el agua de esa seccion y las siguientes vuelve a su estado inicial
    for (let z = 0; z < NZ; z++) {
      if (ZB[z + 1] > this.flagX[this.checkpoint]) {
        this.W.fill(ZB[z], ZB[z + 1], START_HIGH[z] ? 1 : 0); this.W.f.fill(0);
        this.plugObjs.forEach(function (p) { if (p.z === z) { p.open = plugStartsOpen(p); p.lock = 0; } });
      }
    }
    this.player.setFillStyle(0xe9ecef); this.eyes.setVisible(true);
    this.player.body.reset(this.flagX[this.checkpoint] + 40 - PW / 2, GY - PH - 2);
    this.dead = false; this.swimSticky = false;
    this.hp = HP_MAX; this.hurtUntil = 0; this.knockUntil = 0; this.drawHp();
  }

  finish() {
    this.done = true;
    this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(false);
    const stats = { time: Math.round((this.time.now - this.startTime) / 1000), deaths: this.deaths, gem: this.gem, coins: this.coinCount };
    SFX.win(); log('goal', stats);
    showEnd(stats, function () { this.scene.restart(); }.bind(this));
  }
}

bindTouch(); bindMute();
let GAME = null;
function startGame() {
  if (GAME) return;
  GAME = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: W, height: H, backgroundColor: '#0b1d2a',
    physics: { default: 'arcade', arcade: { gravity: { y: 1200 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: Level
  });
}
function setPaused(p) {   // pausa el nivel mientras estan abiertos los ajustes
  if (!GAME || !GAME.scene.scenes[0]) return;
  const sc = GAME.scene.scenes[0].scene;
  if (p && !sc.isPaused()) sc.pause(); else if (!p && sc.isPaused()) sc.resume();
}
function bindMenu() {
  const $ = function (id) { return document.getElementById(id); };
  const title = $('title'), panel = $('panel'), mus = $('vol-music'), sfx = $('vol-sfx'), mt = $('mute-opt');
  mus.value = Math.round(SFX.musicVol() * 100); sfx.value = Math.round(SFX.sfxVol() * 100); mt.checked = SFX.isMuted();
  const ht = $('hit-opt'); ht.checked = SHOW_HIT; ht.addEventListener('change', function () { setHit(ht.checked); });
  mus.addEventListener('input', function () { SFX.unlock(); SFX.setMusicVol(mus.value / 100); });
  sfx.addEventListener('input', function () { SFX.unlock(); SFX.setSfxVol(sfx.value / 100); });
  mt.addEventListener('change', function () { if (mt.checked !== SFX.isMuted()) SFX.toggle(); });
  const prevToggle = SFX.onToggle; SFX.onToggle = function () { if (prevToggle) prevToggle(); mt.checked = SFX.isMuted(); };
  function openPanel(o) { panel.style.display = o ? 'flex' : 'none'; setPaused(o); if (o) SFX.ui(); }
  $('cfg').addEventListener('click', function (e) { openPanel(panel.style.display !== 'flex'); e.currentTarget.blur(); });
  $('panel-close').addEventListener('click', function () { openPanel(false); });
  $('title-cfg').addEventListener('click', function () { openPanel(true); });
  function play() { if (title.style.display === 'none') return; title.style.display = 'none'; SFX.unlock(); SFX.ui(); startGame(); }
  $('play').addEventListener('click', play);
  PADUI.hooks = { play: play, openPanel: openPanel, panelOpen: function () { return panel.style.display === 'flex'; }, onTitle: function () { return title.style.display !== 'none'; } };
  PADUI.badge($('cfg'), 'menu'); PADUI.badge($('mute'), 'view'); PADUI.badge($('play'), 'confirm'); PADUI.badge($('title-cfg'), 'pull');
  PADUI.badge($('panel-close'), 'back'); PADUI.badge($('again'), 'confirm');
  PADUI.paint(); PADUI.start();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && title.style.display === 'none') { openPanel(panel.style.display !== 'flex'); return; }
    if (title.style.display !== 'none' && panel.style.display !== 'flex' && e.key !== 'Escape') play();
  });
}
bindMenu();
