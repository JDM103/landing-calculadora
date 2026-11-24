/* /ig · página interna de Jose: bienvenidas a seguidores nuevos y médicos para seguir
 *
 * Qué hace: guarda lo que el script local (Negocio/herramientas/instagram/seguidores/seguidores.py)
 * lee de Instagram, para que Jose lo vea desde el celular o la compu, y guarda las marcas
 * "ya le escribí" / "ya lo seguí". También le pasa al script la lista de chats de Instagram
 * (con el token que ya vive en Netlify) para saber a quién ya se le escribió.
 *
 * Clave: los datos traen perfiles de terceros y nombres de clientes, así que todo pide la cabecera
 * x-clave. Acá solo está la huella SHA-256 de la clave; la clave vive en la compu de Jose
 * (clave-pagina.txt, fuera de este repo) y en el navegador donde abrió el link con #k=.
 *
 * Rutas:
 *   GET  /api/ig/datos                → { datos, marcas }
 *   PUT  /api/ig/datos                → guarda lo que manda el script
 *   POST /api/ig/marca                → { usuario, tipo: "escrito"|"seguido"|"cerrado"|"fuera", valor: true|false }
 *   GET  /api/ig/conversaciones?after → una página de chats: { usuarios: [{u, t}], after }
 *   GET  /api/ig/chats?after          → una página de chats con sus últimos 6 mensajes, para Seguimientos
 *
 * Almacén: store "ig-seguidores" de Netlify Blobs, claves "datos" y "marcas".
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { leerToken } from "./instagram-dm.mjs";

const HUELLA = "c7cee7bf7c8de248168bad54174689be3a65c668f4416f6a24cf21df9a76706c";
const GRAPH = "https://graph.instagram.com/v27.0";
const USUARIO_OK = /^[a-z0-9._]{1,40}$/;
const CUENTA = (process.env.IG_CUENTA || "joseinvestor.cr").toLowerCase();

const json = (code, body) => new Response(JSON.stringify(body), {
  status: code,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export function claveValida(clave, huella = HUELLA) {
  const a = createHash("sha256").update(String(clave || "").trim()).digest();
  const b = Buffer.from(huella, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function aplicarMarca(marcas, { usuario, tipo, valor }, hoy) {
  const u = String(usuario || "").toLowerCase();
  if (!USUARIO_OK.test(u) || !["escrito", "seguido", "cerrado", "fuera"].includes(tipo)) return null;
  const m = { escrito: {}, seguido: {}, cerrado: {}, fuera: {}, ...(marcas || {}) };
  m[tipo] = { ...m[tipo] };
  if (valor) m[tipo][u] = hoy; else delete m[tipo][u];
  return m;
}

/* Un chat de la API de Instagram → { u, t, mensajes: [{ yo, t, texto }] }, del más nuevo al más viejo.
 * "yo" dice si el mensaje lo mandó la cuenta de Jose. Los mensajes no se guardan en ningún lado:
 * la página los pide cada vez que abre Seguimientos. */
export function resumirChat(c, cuenta = CUENTA) {
  const gente = ((c && c.participants && c.participants.data) || []);
  const es = (p) => String((p && p.username) || "").toLowerCase() === cuenta;
  const otro = gente.find((p) => p.username && !es(p));
  if (!otro) return null;
  const miId = String((gente.find(es) || {}).id || "");
  const mensajes = ((c.messages && c.messages.data) || []).map((m) => ({
    yo: es(m.from) || (!!miId && String((m.from || {}).id || "") === miId),
    t: m.created_time || "",
    texto: String(m.message || "").slice(0, 280),
  })).sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
  return { u: String(otro.username).toLowerCase(), t: c.updated_time || "", mensajes };
}

export default async (req) => {
  if (!claveValida(req.headers.get("x-clave"))) return json(401, { error: "Clave incorrecta" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/ig\/?/, "").replace(/\/$/, "");
  // lectura "strong": al marcar varios seguidos, cada marca lee la anterior ya guardada y no la pisa
  const store = getStore({ name: "ig-seguidores", consistency: "strong" });

  try {
    if (ruta === "datos" && req.method === "GET") {
      const [datos, marcas] = await Promise.all([
        store.get("datos", { type: "json" }), store.get("marcas", { type: "json" })]);
      return json(200, { datos: datos || null, marcas: marcas || { escrito: {}, seguido: {} } });
    }
    if (ruta === "datos" && req.method === "PUT") {
      const d = await req.json();
      if (!d || !Array.isArray(d.seguidores) || !Array.isArray(d.sugeridos)) return json(400, { error: "Faltan listas" });
      await store.setJSON("datos", d);
      return json(200, { ok: true, seguidores: d.seguidores.length, sugeridos: d.sugeridos.length });
    }
    if (ruta === "marca" && req.method === "POST") {
      const hoy = new Date().toISOString().slice(0, 10);
      const m = aplicarMarca(await store.get("marcas", { type: "json" }), await req.json(), hoy);
      if (!m) return json(400, { error: "Marca inválida" });
      await store.setJSON("marcas", m);
      return json(200, { ok: true });
    }
    if (ruta === "conversaciones" && req.method === "GET") {
      const token = await leerToken();
      if (!token) return json(500, { error: "Falta el token de Instagram" });
      const q = new URLSearchParams({ platform: "instagram", fields: "participants,updated_time", limit: "50", access_token: token });
      const after = url.searchParams.get("after");
      if (after) q.set("after", after);
      const r = await fetch(GRAPH + "/me/conversations?" + q);
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.data)) return json(502, { error: "Instagram no contestó la lista de chats", codigo: r.status });
      const usuarios = [];
      for (const c of d.data) for (const p of (c.participants && c.participants.data) || []) {
        if (p.username) usuarios.push({ u: String(p.username).toLowerCase(), t: c.updated_time || "" });
      }
      const sigue = d.paging && d.paging.next && new URL(d.paging.next).searchParams.get("after");
      return json(200, { usuarios, after: sigue || "" });
    }
    if (ruta === "chats" && req.method === "GET") {
      const token = await leerToken();
      if (!token) return json(500, { error: "Falta el token de Instagram" });
      /* ?n= mensajes por chat (6 por defecto, tope 30): con más se alcanza a ver el primer mensaje,
       * que es el que dice de dónde vino la persona (palabra NOVIEMBRE, CURSO o DM de bienvenida). */
      const n = Math.min(30, Math.max(1, parseInt(url.searchParams.get("n"), 10) || 6));
      const q = new URLSearchParams({
        platform: "instagram", limit: n > 12 ? "10" : "20", access_token: token,
        fields: `participants,updated_time,messages.limit(${n}){created_time,from,message}`,
      });
      const after = url.searchParams.get("after");
      if (after) q.set("after", after);
      const r = await fetch(GRAPH + "/me/conversations?" + q);
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.data)) {
        return json(502, { error: "Instagram no contestó los chats", codigo: r.status,
          meta: String((d.error && d.error.message) || "").slice(0, 200) });
      }
      const sigue = d.paging && d.paging.next && new URL(d.paging.next).searchParams.get("after");
      return json(200, { chats: d.data.map((c) => resumirChat(c)).filter(Boolean), after: sigue || "" });
    }
    return json(404, { error: "Ruta no existe" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e).slice(0, 300) });
  }
};

export const config = { path: "/api/ig/*" };
