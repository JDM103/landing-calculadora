/* /atalaya/vivo · datos para ver Atalaya Momentum en tiempo real sobre QQQ
 *
 * SOLO LEE DATOS. Único host: data.alpaca.markets (Market Data API, GET). No manda órdenes ni toca cuentas.
 * Variables de entorno (Netlify → Environment variables): APCA_API_KEY_ID, APCA_API_SECRET_KEY (cuenta paper basta).
 *
 * GET /.netlify/functions/atalaya-vivo → JSON:
 *   diario    · cierres diarios de QQQ (ajuste por splits, SIP) de los últimos ~700 días calendario, SIN la barra de hoy
 *               mientras el mercado no haya cerrado (la página la arma con el precio en vivo)
 *   intradia  · barras de 5 min de hoy (IEX, tiempo real) en horario regular
 *   snap      · último precio y cierre previo de QQQ, TQQQ, QLD y SPY (IEX, tiempo real)
 *   params    · la regla: SMA 200 ±3% Y máximo 39 semanas −12/−6 (Atalaya); M39 semanal −18/−6 (regla del panel)
 * Los niveles (SMA, máximo, precios de salida) los calcula la página con estos datos y el precio del WebSocket de Yahoo.
 * Caché en memoria: diario 10 min, intradía y snapshot 5 s.
 */
"use strict";

const HOST = "https://data.alpaca.markets/v2/stocks/";
const NY = "America/New_York";
const fmtNY = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
function ny(iso) {
  const p = {}; fmtNY.formatToParts(new Date(iso)).forEach(x => p[x.type] = x.value);
  return { fecha: p.year + "-" + p.month + "-" + p.day, min: +p.hour * 60 + +p.minute, dow: p.weekday };
}
const resp = (code, body) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

async function barras(path, q, key, sec) {
  let out = [], tok = null;
  for (let i = 0; i < 40; i++) {
    const u = new URL(HOST + path); Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, v)); if (tok) u.searchParams.set("page_token", tok);
    if (u.hostname !== "data.alpaca.markets") throw new Error("host no permitido");
    const r = await fetch(u, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec } });
    if (!r.ok) throw new Error("Alpaca " + r.status + " " + (await r.text()).slice(0, 200));
    const d = await r.json();
    out = out.concat(d.bars || []); tok = d.next_page_token; if (!tok) break;
  }
  return out;
}

let cDiario = { t: 0, v: null }, cRapido = { t: 0, v: null };

async function diario(key, sec, ahora) {
  if (cDiario.v && Date.now() - cDiario.t < 600e3) return cDiario.v;
  const start = new Date(Date.now() - 700 * 864e5).toISOString().slice(0, 10);
  const bars = await barras("QQQ/bars", { timeframe: "1Day", start, adjustment: "split", feed: "sip", limit: 10000, sort: "asc" }, key, sec);
  const cerrado = ahora.min >= 965 || ahora.dow === "Sat" || ahora.dow === "Sun";
  const v = bars.map(b => [ny(b.t).fecha, +b.c.toFixed(2)]).filter(x => x[0] < ahora.fecha || cerrado);
  cDiario = { t: Date.now(), v }; return v;
}
async function rapido(key, sec, ahora) {
  if (cRapido.v && Date.now() - cRapido.t < 5e3) return cRapido.v;
  const syms = "QQQ,TQQQ,QLD,SPY";
  const u = new URL(HOST + "snapshots"); u.searchParams.set("symbols", syms); u.searchParams.set("feed", "iex");
  const r = await fetch(u, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec } });
  if (!r.ok) throw new Error("Alpaca snapshots " + r.status);
  const s = await r.json(); const snap = {};
  for (const k of syms.split(",")) {
    const q = s[k] || {};
    snap[k] = { prev: q.prevDailyBar ? q.prevDailyBar.c : null, px: q.latestTrade ? q.latestTrade.p : null, t: q.latestTrade ? q.latestTrade.t : null };
  }
  // barras de 5 min de hoy (hora de NY), filtradas al horario regular 9:30–16:00
  const bars5 = await barras("QQQ/bars", { timeframe: "5Min", start: ahora.fecha + "T00:00:00-05:00", feed: "iex", limit: 10000, sort: "asc" }, key, sec);
  const intradia = bars5.map(b => Object.assign(ny(b.t), { c: b.c })).filter(b => b.fecha === ahora.fecha && b.min >= 570 && b.min < 960).map(b => [b.min + 5, +b.c.toFixed(2)]);
  const v = { snap, intradia }; cRapido = { t: Date.now(), v }; return v;
}

exports.handler = async function () {
  const key = process.env.APCA_API_KEY_ID, sec = process.env.APCA_API_SECRET_KEY;
  if (!key || !sec) return resp(500, { error: "faltan APCA_API_KEY_ID / APCA_API_SECRET_KEY en Netlify" });
  try {
    const ahora = ny(new Date().toISOString());
    const [d, r] = await Promise.all([diario(key, sec, ahora), rapido(key, sec, ahora)]);
    const abierto = ahora.min >= 570 && ahora.min < 960 && ahora.dow !== "Sat" && ahora.dow !== "Sun";
    return resp(200, {
      generado: new Date().toISOString(), ahoraNY: { fecha: ahora.fecha, min: ahora.min, dow: ahora.dow }, abierto,
      params: { sma: 200, banda: 0.03, dias: 195, x: 0.12, y: 0.06, m39: { sem: 39, x: 0.18, y: 0.06 } },
      diario: d, intradia: r.intradia, snap: r.snap,
      fuente: "Alpaca: diario SIP ajustado por splits; intradía y último precio IEX en tiempo real",
    });
  } catch (e) { return resp(502, { error: String(e.message || e) }); }
};
