'use strict';
/* Agua con fisica (1D, aguas poco profundas): el nivel es una altura por columna de 20 px.
   El agua fluye sola de la columna alta a la baja; las torres la frenan; las tuberias vierten
   en su columna y cada tapon abierto es un desague en su columna. Nada esta "por zonas":
   lo que ves en cada punto es el agua que de verdad llego (o se fue) hasta alli. */
const WATER = {
  CW: 20,            // ancho de columna (px)
  G: 3000,           // "gravedad" del agua: velocidad de la ola ~ sqrt(G * altura)
  DAMP: 0.8,         // friccion (1/s): sin ella el agua se mecería para siempre
  SUB: 1 / 120,      // paso fijo de simulacion (s)
  QIN: 12000,        // caudal de cada tuberia (px^2/s): zona 1 ~2.3 s, zonas 2 y 3 ~8.5 s para llenarse
  QOUT: 60000        // caudal maximo de cada desague abierto (px^2/s)
};

function makeWater(len, low, high, solidRanges) {
  const CW = WATER.CW, N = Math.round(len / CW);
  const h = new Float32Array(N).fill(low), f = new Float32Array(N + 1), solid = new Uint8Array(N);
  solidRanges.forEach(function (r) { for (let i = Math.floor(r[0] / CW); i < Math.ceil(r[1] / CW); i++) solid[i] = 1; });
  const col = function (x) { return Math.max(0, Math.min(N - 1, Math.floor(x / CW))); };
  return {
    N: N, h: h, f: f, solid: solid, low: low, high: high, CW: CW, acc: 0, col: col,
    // altura (px sobre el piso) en x, interpolada entre columnas
    at: function (x) {
      const u = x / CW - 0.5, i = Math.floor(u), t = u - i;
      const a = h[Math.max(0, Math.min(N - 1, i))], b = h[Math.max(0, Math.min(N - 1, i + 1))];
      const sa = solid[Math.max(0, Math.min(N - 1, i))], sb = solid[Math.max(0, Math.min(N - 1, i + 1))];
      if (sa && !sb) return b; if (sb && !sa) return a;
      return a + (b - a) * t;
    },
    // 0 = lamina, 1 = nivel alto
    level: function (x) { return Math.max(0, Math.min(1, (this.at(x) - low) / (high - low))); },
    fill: function (x0, x1, lvl) { for (let i = col(x0); i <= col(x1 - 1); i++) if (!solid[i]) h[i] = low + (high - low) * lvl; },
    // fuentes: [{x, q}], desagues abiertos: [{x, q}]
    step: function (dt, sources, sinks) {
      this.acc += dt;
      while (this.acc >= WATER.SUB) { this.acc -= WATER.SUB; this.sub(WATER.SUB, sources, sinks); }
    },
    sub: function (dt, sources, sinks) {
      const G = WATER.G, damp = Math.max(0, 1 - WATER.DAMP * dt);
      for (let i = 1; i < N; i++) {
        if (solid[i - 1] || solid[i]) { f[i] = 0; continue; }
        const hh = Math.max(h[i - 1], h[i]);
        let q = (f[i] + G * hh * (h[i - 1] - h[i]) / CW * dt) * damp;
        const lim = q > 0 ? (h[i - 1] - low) * CW / dt * 0.5 : (h[i] - low) * CW / dt * 0.5;   // una columna no puede quedar bajo la lamina
        if (q > lim && q > 0) q = lim; else if (q < -lim && q < 0) q = -lim;
        f[i] = q;
      }
      f[0] = 0; f[N] = 0;
      for (let i = 0; i < N; i++) if (!solid[i]) h[i] += (f[i] - f[i + 1]) * dt / CW;
      for (let k = 0; k < sources.length; k++) {
        const c = col(sources[k].x), add = sources[k].q * dt / CW / 2;
        for (let j = 0; j < 2; j++) { const i = c + j - (sources[k].x % CW < CW / 2 ? 1 : 0); if (i >= 0 && i < N && !solid[i]) h[i] += add; }
      }
      for (let k = 0; k < sinks.length; k++) {
        const c = col(sinks[k].x), want = sinks[k].q * dt / CW / 2;
        for (let j = 0; j < 2; j++) { const i = c + j - (sinks[k].x % CW < CW / 2 ? 1 : 0); if (i >= 0 && i < N && !solid[i]) h[i] -= Math.min(want, Math.max(0, h[i] - low)); }
      }
      for (let i = 0; i < N; i++) { if (h[i] > high) h[i] = high; else if (h[i] < low && !solid[i]) h[i] = low; }
    }
  };
}
if (typeof module !== 'undefined') module.exports = { WATER: WATER, makeWater: makeWater };
