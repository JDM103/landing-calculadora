/* /live · simulación en vivo de tres reglas sobre QQQ con barras de 30 minutos de Alpaca
 *
 * SOLO LEE DATOS. Único host: data.alpaca.markets (Market Data API, GET). No manda órdenes,
 * no toca cuentas: el host de trading no aparece en este archivo. Las keys solo sirven para
 * leer precios y viven en Netlify (nunca en el repo).
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   APCA_API_KEY_ID, APCA_API_SECRET_KEY · keys de Alpaca (las de una cuenta paper bastan; solo se leen datos)
 *
 * GET /.netlify/functions/live  → JSON con el estado y el PnL simulado desde INICIO de:
 *   a2   · Atalaya actual: SMA 200 días ±3% Y máximo de 39 semanas −12/−6, señal al cierre, MOC al día siguiente
 *   r30  · Atalaya 30 min (mejor de la malla, edges/atalaya-intradia nivel 6): SMA 100 barras ±2% Y máximo de 650 barras −12/−6,
 *          decidida con la barra de las 15:30, MOC el mismo día
 *   s1   · Concretum (Zarattini, Aziz, Barbon 2024), versión del paper: bandas de ruido + VWAP cada 30 min, largo/corto,
 *          tamaño 2% ÷ vol 14 d (tope 4x), todo cerrado con la MOC
 *   qqq  · comprar y mantener, de referencia
 * Cada una arranca con $100,000 el día INICIO y se reconstruye entera en cada llamada (sin estado guardado).
 * Costos: los medidos en edges/concretum-slippage (oct 2026): 0.6 bps por orden MOC, 0.83 bps por cambio de Concretum.
 * Efectivo: RF_ANUAL (High Yield Savings de Alpaca, aproximado), acreditado en el tramo nocturno.
 * Datos SIP del plan gratis: llegan con 15 minutos de atraso. La función cachea 60 s.
 */
"use strict";

const INICIO = "2026-10-27";          // primer día simulado (hora de Nueva York)
const CAPITAL = 100000;
const RF_ANUAL = 0.04;
const BPS_MOC = 0.6e-4, BPS_S1 = 0.83e-4;
const HOST = "https://data.alpaca.markets/v2/stocks/QQQ/";
const NY = "America/New_York";

const resp = (code, body, cacheSeg) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheSeg ? "public, max-age=" + cacheSeg : "no-store", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

// ---------- hora de Nueva York (con horario de verano) sin librerías
const fmtNY = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
function ny(iso) {
  const p = {}; fmtNY.formatToParts(new Date(iso)).forEach(x => p[x.type] = x.value);
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, dow: p.weekday };
}
const hhmm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// ---------- Alpaca (solo lectura)
async function alpaca(path, q, key, sec) {
  let out = [], tok = null;
  for (let i = 0; i < 60; i++) {   // Alpaca devuelve ~340 barras por página sin importar el limit
    const u = new URL(HOST + path); Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, v)); if (tok) u.searchParams.set("page_token", tok);
    if (u.hostname !== "data.alpaca.markets") throw new Error("host no permitido");
    const r = await fetch(u, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec } });
    if (!r.ok) throw new Error("Alpaca " + r.status + " " + (await r.text()).slice(0, 200));
    const d = await r.json(); out = out.concat(d.bars || []); tok = d.next_page_token; if (!tok) break;
  }
  return out;
}
const iso = d => d.toISOString().slice(0, 19) + "Z";
async function datos(key, sec) {
  const hoy = new Date();
  const d1 = await alpaca("bars", { timeframe: "1Day", start: iso(new Date(hoy - 560 * 864e5)), adjustment: "split", feed: "sip", limit: 10000, sort: "asc" }, key, sec);
  const m30 = await alpaca("bars", { timeframe: "30Min", start: iso(new Date(hoy - 150 * 864e5)), adjustment: "split", feed: "sip", limit: 10000, sort: "asc" }, key, sec);   // ~105 días hábiles: 650 barras del máximo + 55 días de calentamiento
  const diario = d1.map(b => ({ fecha: ny(b.t).fecha, o: b.o, h: b.h, l: b.l, c: b.c }));
  // solo horario regular: barras que empiezan 9:30 … 15:30, lunes a viernes
  const barras = m30.map(b => ({ ...ny(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter(b => b.min >= 570 && b.min < 960 && b.dow !== "Sat" && b.dow !== "Sun");
  return { diario, barras };
}

// ---------- reglas
function histeresis(rel, lvl, band, x, y) {
  // estado AND de dos histéresis: SMA (sale si rel < −band, entra si rel > band) y máximo (sale si lvl < −x, entra si lvl ≥ −y)
  let s1 = 1, s2 = 1; const out = new Array(rel.length).fill(null);
  for (let i = 0; i < rel.length; i++) {
    if (rel[i] == null || lvl[i] == null) continue;
    if (s1 && rel[i] < -band) s1 = 0; else if (!s1 && rel[i] > band) s1 = 1;
    if (s2 && lvl[i] < -x) s2 = 0; else if (!s2 && lvl[i] >= -y) s2 = 1;
    out[i] = s1 && s2 ? 1 : 0;
  }
  return out;
}
function smaMax(close, nS, nM) {
  const rel = [], lvl = []; let sum = 0;
  for (let i = 0; i < close.length; i++) {
    sum += close[i]; if (i >= nS) sum -= close[i - nS];
    rel.push(i >= nS - 1 ? close[i] / (sum / nS) - 1 : null);
    if (i >= nM - 1) { let m = -Infinity; for (let j = i - nM + 1; j <= i; j++) if (close[j] > m) m = close[j]; lvl.push(close[i] / m - 1); } else lvl.push(null);
  }
  return { rel, lvl };
}

function simular({ diario, barras }, ahoraNY) {
  // --- días completos: agrupar barras regulares por fecha
  const dias = []; const porDia = new Map();
  barras.forEach(b => { if (!porDia.has(b.fecha)) { porDia.set(b.fecha, []); dias.push(b.fecha); } porDia.get(b.fecha).push(b); });
  const cierreDiario = new Map(diario.map(d => [d.fecha, d.c]));
  // --- Atalaya actual: estado al cierre de cada día completo (el día de hoy solo si ya cerró)
  const cerrado = f => f < ahoraNY.fecha || (f === ahoraNY.fecha && ahoraNY.min >= 965);
  const fechasD = diario.map(d => d.fecha).filter(cerrado); const closeD = fechasD.map(f => cierreDiario.get(f));
  const { rel: relD, lvl: lvlD } = smaMax(closeD, 200, 195); const estA2 = histeresis(relD, lvlD, 0.03, 0.12, 0.06);
  const estadoA2 = new Map(fechasD.map((f, i) => [f, estA2[i]]));
  // --- Atalaya 30 min: estado decidido en la barra de las 15:30 de cada día
  const serie = []; dias.forEach(f => porDia.get(f).forEach(b => serie.push(b)));
  const closeB = serie.map(b => b.c); const { rel: relB, lvl: lvlB } = smaMax(closeB, 100, 650);
  const relS = relB.map((v, i) => serie[i].min === 930 ? v : null), lvlS = lvlB.map((v, i) => serie[i].min === 930 ? v : null);
  // la histéresis solo decide en las barras de las 15:30; entre medio mantiene el estado
  let s1 = null, s2 = null; const estadoR30 = new Map();
  for (let i = 0; i < serie.length; i++) {
    if (relS[i] == null) continue;
    if (s1 === null) { s1 = relS[i] > 0 ? 1 : 0; s2 = lvlS[i] >= -0.06 ? 1 : 0; }   // semilla con los primeros valores; 55 días de calentamiento la corrigen
    if (s1 && relS[i] < -0.02) s1 = 0; else if (!s1 && relS[i] > 0.02) s1 = 1;
    if (s2 && lvlS[i] < -0.12) s2 = 0; else if (!s2 && lvlS[i] >= -0.06) s2 = 1;
    estadoR30.set(serie[i].fecha, s1 && s2 ? 1 : 0);
  }
  const niveles = (() => { const i = serie.length - 1; return { sma100: closeB.slice(-100).reduce((a, b) => a + b, 0) / Math.min(100, closeB.length), max650: Math.max(...closeB.slice(-650)), rel: relB[i], lvl: lvlB[i] }; })();
  // --- Concretum: por día, con 14 días previos completos
  const completo = f => porDia.get(f).length === 13;
  const diasC = dias.filter(completo);
  const s1Dia = new Map(); // fecha -> { sig[13], pos[13], L, ub, lb, vwap, pnlAcum[13], costoAcum[13] }
  for (let di = 0; di < dias.length; di++) {
    const f = dias[di]; const prev15 = diasC.filter(x => x < f).slice(-15); if (prev15.length < 15) continue;
    const prev = prev15.slice(1);   // 14 días para las bandas; 15 cierres (14 retornos) para la volatilidad, como el paper
    const bs = porDia.get(f); const open = bs[0].o; const prevClose = porDia.get(prev[13])[12].c;
    const sigma = []; for (let k = 0; k < 13; k++) { let s = 0; prev.forEach(p => { const pb = porDia.get(p); s += Math.abs(pb[k].c / pb[0].o - 1); }); sigma.push(s / 14); }
    const retD = []; for (let j = 1; j < 15; j++) retD.push(porDia.get(prev15[j])[12].c / porDia.get(prev15[j - 1])[12].c - 1);
    const mu = retD.reduce((a, b) => a + b, 0) / retD.length; const vol14 = Math.sqrt(retD.reduce((a, b) => a + (b - mu) ** 2, 0) / (retD.length - 1));
    const L = Math.min(4, 0.02 / vol14);
    const ub = [], lb = [], vwap = [], sig = [], pos = [], pnl = [], costo = []; let spv = 0, sv = 0, cum = 0, cumc = 0, ppos = 0;
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k]; ub.push(Math.max(open, prevClose) * (1 + sigma[k])); lb.push(Math.min(open, prevClose) * (1 - sigma[k]));
      spv += (b.h + b.l + b.c) / 3 * b.v; sv += b.v; vwap.push(sv ? spv / sv : b.c);
      const s = b.c > ub[k] && b.c > vwap[k] ? 1 : b.c < lb[k] && b.c < vwap[k] ? -1 : 0; sig.push(s);
      const p = k === 0 ? 0 : sig[k - 1]; pos.push(p);                       // decisión al cierre de k−1 vigente en el tramo k
      if (k > 0) cum += p * (b.c / bs[k - 1].c - 1);
      cumc += Math.abs(p - ppos) * BPS_S1; ppos = p; pnl.push(cum); costo.push(cumc);
    }
    const cerrada = bs.length === 13 && cerrado(f); if (cerrada) costo[12] += Math.abs(pos[12]) * BPS_S1;   // cierre MOC
    s1Dia.set(f, { sig, pos, L, ub, lb, vwap, pnl, costo, cerrada });
  }
  // --- recorrido tramo a tramo desde INICIO: equity de cada regla y órdenes
  const idx = dias.indexOf(dias.find(f => f >= INICIO)); if (idx < 0) return null;
  const eq = { a2: CAPITAL, r30: CAPITAL, s1: CAPITAL, qqq: CAPITAL }; const puntos = []; const ordenes = { a2: [], r30: [], s1: [] };
  let posA2 = null, posR30 = null; let nOrdS1 = 0;
  const estadoDiaAntes = (mapa, f, n) => { const i = dias.indexOf(f); let j = i - n; while (j >= 0 && !mapa.has(dias[j])) j--; return j >= 0 ? mapa.get(dias[j]) : 1; };
  for (let di = idx; di < dias.length; di++) {
    const f = dias[di], bs = porDia.get(f), prevDia = porDia.get(dias[di - 1]); const prevClose = prevDia[prevDia.length - 1].c;
    // posiciones vigentes durante el día (decididas antes): A2 al cierre de d−2 (MOC d−1); R30 a las 15:30 de d−1 (MOC d−1)
    const nA2 = estadoDiaAntes(estadoA2, f, 2), nR30 = estadoDiaAntes(estadoR30, f, 1);
    if (posA2 === null) posA2 = nA2; if (posR30 === null) posR30 = nR30;
    const gapDias = di > 0 ? Math.max(1, Math.round((new Date(f) - new Date(dias[di - 1])) / 864e5)) : 1; const rfTramo = RF_ANUAL * gapDias / 365;
    const costoA2 = Math.abs(nA2 - posA2) * BPS_MOC, costoR30 = Math.abs(nR30 - posR30) * BPS_MOC;
    if (nA2 !== posA2) ordenes.a2.push({ t: dias[di - 1] + " 16:00", lado: nA2 ? "compra" : "venta", px: prevClose, nota: nA2 ? "vuelve al Nasdaq" : "sale a efectivo" });
    if (nR30 !== posR30) ordenes.r30.push({ t: dias[di - 1] + " 16:00", lado: nR30 ? "compra" : "venta", px: prevClose, nota: nR30 ? "vuelve al Nasdaq" : "sale a efectivo" });
    posA2 = nA2; posR30 = nR30;
    const S = s1Dia.get(f); const eqS1Ini = eq.s1;
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k]; const r = k === 0 ? b.c / prevClose - 1 : b.c / bs[k - 1].c - 1;   // k=0 incluye el gap nocturno
      const rfk = k === 0 ? rfTramo : 0;
      eq.qqq *= 1 + r;
      eq.a2 *= 1 + (posA2 ? r : rfk) - (k === 0 ? costoA2 : 0);
      eq.r30 *= 1 + (posR30 ? r : rfk) - (k === 0 ? costoR30 : 0);
      if (S) { eq.s1 = eqS1Ini * (1 + S.L * (S.pnl[k] - S.costo[k]) + (k === 0 ? rfTramo : 0) * 0); if (k === 0) eq.s1 *= 1 + rfTramo; }
      else if (k === 0) eq.s1 *= 1 + rfTramo;
      const expS1 = S ? S.L * S.pos[k] : 0;
      puntos.push({ t: f + " " + hhmm(b.min + 30), px: b.c, a2: eq.a2, r30: eq.r30, s1: eq.s1, qqq: eq.qqq, pa2: posA2, pr30: posR30, ps1: +expS1.toFixed(2) });
      if (S && k > 0 && S.pos[k] !== S.pos[k - 1]) { nOrdS1++; ordenes.s1.push({ t: f + " " + hhmm(b.min), lado: S.pos[k] > S.pos[k - 1] ? "compra" : "venta", px: bs[k - 1].c, exp: +(S.L * S.pos[k]).toFixed(2), nota: S.pos[k] === 0 ? "cierra" : S.pos[k] > 0 ? "largo" : "corto" }); }
    }
    if (S && S.cerrada && S.pos[12] !== 0) { nOrdS1++; ordenes.s1.push({ t: f + " 16:00", lado: S.pos[12] > 0 ? "venta" : "compra", px: bs[12].c, exp: 0, nota: "cierre MOC" }); }
  }
  const ultimo = puntos[puntos.length - 1]; const fHoy = dias[dias.length - 1], SH = s1Dia.get(fHoy), bsH = porDia.get(fHoy), kH = bsH.length - 1;
  const estado = {
    a2: { dentro: !!posA2, exposicion: posA2 ? 1 : 0, decidido: "al cierre de " + (fechasD[fechasD.length - 1] || "—"), proximo: "cierre de hoy 16:00 → MOC mañana", rel: relD[relD.length - 1], lvl: lvlD[lvlD.length - 1] },
    r30: { dentro: !!posR30, exposicion: posR30 ? 1 : 0, decidido: "15:30 de " + [...estadoR30.keys()].pop(), proximo: "hoy 15:30 → MOC 16:00", rel: niveles.rel, lvl: niveles.lvl, sma100: niveles.sma100, max650: niveles.max650 },
    s1: SH ? { exposicion: +(SH.L * SH.pos[kH]).toFixed(2), senal: SH.sig[kH], L: +SH.L.toFixed(2), ub: SH.ub[kH], lb: SH.lb[kH], vwap: SH.vwap[kH], proximo: "al cierre de la próxima barra de 30 min", ordenesHoy: SH.pos.filter((p, k) => k && p !== SH.pos[k - 1]).length }
      : { exposicion: 0, senal: 0, L: 0, proximo: "faltan 14 días completos", ordenesHoy: 0 },
  };
  const n = puntos.length;
  return {
    inicio: INICIO, capital: CAPITAL, generado: new Date().toISOString(), ahoraNY: ahoraNY.fecha + " " + hhmm(ahoraNY.min), ultimaBarra: ultimo.t, barras: n, dias: dias.length - idx,
    supuestos: { rfAnual: RF_ANUAL, bpsMOC: 6e4 * BPS_MOC / 6, bpsS1: Math.round(BPS_S1 * 1e6) / 100, datos: "Alpaca SIP, ajustado por splits, 15 min de atraso" },
    estado, equity: { a2: eq.a2, r30: eq.r30, s1: eq.s1, qqq: eq.qqq }, nOrdenes: { a2: ordenes.a2.length, r30: ordenes.r30.length, s1: nOrdS1 },
    ordenes: { a2: ordenes.a2.slice(-30), r30: ordenes.r30.slice(-30), s1: ordenes.s1.slice(-40) },
    serie: { t: puntos.map(p => p.t), px: puntos.map(p => +p.px.toFixed(2)), a2: puntos.map(p => +p.a2.toFixed(2)), r30: puntos.map(p => +p.r30.toFixed(2)), s1: puntos.map(p => +p.s1.toFixed(2)), qqq: puntos.map(p => +p.qqq.toFixed(2)), ps1: puntos.map(p => p.ps1), pa2: puntos.map(p => p.pa2), pr30: puntos.map(p => p.pr30) },
  };
}

let cache = { t: 0, body: null };
exports.handler = async function () {
  const key = process.env.APCA_API_KEY_ID, sec = process.env.APCA_API_SECRET_KEY;
  if (!key || !sec) return resp(500, { error: "faltan APCA_API_KEY_ID / APCA_API_SECRET_KEY en Netlify" });
  if (cache.body && Date.now() - cache.t < 60000) return resp(200, cache.body, 60);
  try {
    const d = await datos(key, sec); const out = simular(d, ny(new Date().toISOString()));
    if (!out) return resp(200, { error: "todavía no hay barras desde " + INICIO, generado: new Date().toISOString() }, 60);
    cache = { t: Date.now(), body: out }; return resp(200, out, 60);
  } catch (e) { return resp(502, { error: String(e.message || e) }); }
};
exports._simular = simular; exports._datos = datos; exports._ny = ny;
