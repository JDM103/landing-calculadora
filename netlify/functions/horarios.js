/* Horarios disponibles de la llamada de médicos (Calendly → la landing)
 *
 * Qué hace: la página /medicos, después de recibir los datos del médico, pide
 * acá los próximos espacios libres y los muestra como botones de un solo click.
 * Cada espacio trae el link de reserva de Calendly con la hora ya elegida.
 *
 * El token de Calendly no puede ir en la página (sería público), por eso esta
 * función vive en el servidor.
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   CALENDLY_TOKEN         · Personal Access Token de Calendly (el mismo del registro de Windows)
 *   CALENDLY_EVENT_TYPE    · opcional, uuid del tipo de evento de médicos
 *
 * GET /.netlify/functions/horarios?n=3&desde=13
 *   n      · cuántos espacios devolver (1–6, por defecto 3)
 *   desde  · hora mínima en Costa Rica (0–23, por defecto 13 = de la 1 pm en adelante).
 *            Si no alcanza con los de la tarde, completa con los demás.
 */
"use strict";

const EVENT_TYPE = process.env.CALENDLY_EVENT_TYPE || "83aa89b0-4502-4f3b-8cad-69d665b6d0a0";
const TZ_OFFSET_H = -6; // Costa Rica no cambia de hora

const resp = (code, body, cacheSeg) => ({
  statusCode: code,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheSeg ? ("public, max-age=" + cacheSeg) : "no-store",
  },
  body: JSON.stringify(body),
});

function horaCR(iso) {
  const d = new Date(iso);
  return (d.getUTCHours() + TZ_OFFSET_H + 24) % 24 + d.getUTCMinutes() / 60;
}

exports.handler = async (event) => {
  const token = (process.env.CALENDLY_TOKEN || "").trim();
  if (!token) return resp(500, { error: "Falta CALENDLY_TOKEN en Netlify" });

  const q = event.queryStringParameters || {};
  const n = Math.min(6, Math.max(1, parseInt(q.n, 10) || 3));
  const desde = Math.min(23, Math.max(0, parseInt(q.desde, 10) || 13));

  // Calendly solo deja pedir ventanas de hasta 7 días, y nada en el pasado.
  const ahora = new Date();
  const start = new Date(ahora.getTime() + 60 * 60 * 1000);
  const end = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000 - 60 * 1000);
  const url = "https://api.calendly.com/event_type_available_times"
    + "?event_type=" + encodeURIComponent("https://api.calendly.com/event_types/" + EVENT_TYPE)
    + "&start_time=" + encodeURIComponent(start.toISOString())
    + "&end_time=" + encodeURIComponent(end.toISOString());

  let data;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token, "User-Agent": "investorcr-landing/1.0" } });
    if (!r.ok) return resp(502, { error: "Calendly respondió " + r.status });
    data = await r.json();
  } catch (e) {
    return resp(502, { error: "No se pudo consultar Calendly" });
  }

  const todos = (data.collection || [])
    .filter((s) => s.status === "available" && s.scheduling_url)
    .map((s) => ({ inicio: s.start_time, url: s.scheduling_url }));

  // Primero los de la tarde (hora CR >= desde), uno por día para dar variedad; si faltan, se completa.
  const tarde = todos.filter((s) => horaCR(s.inicio) >= desde);
  const porDia = (lista) => {
    const vistos = {}; const out = [];
    for (const s of lista) { const dia = s.inicio.slice(0, 10); if (!vistos[dia]) { vistos[dia] = true; out.push(s); } }
    return out;
  };
  let elegidos = porDia(tarde);
  if (elegidos.length < n) for (const s of tarde) if (elegidos.length < n && !elegidos.includes(s)) elegidos.push(s);
  if (elegidos.length < n) for (const s of todos) if (elegidos.length < n && !elegidos.includes(s)) elegidos.push(s);
  elegidos = elegidos.slice(0, n).sort((a, b) => a.inicio.localeCompare(b.inicio));

  return resp(200, { espacios: elegidos, total: todos.length }, 120);
};
