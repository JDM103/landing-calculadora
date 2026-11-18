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
 *   POST /api/ig/marca                → { usuario, tipo: "escrito"|"seguido", valor: true|false }
 *   GET  /api/ig/conversaciones?after → una página de chats: { usuarios: [{u, t}], after }
 *
 * Almacén: store "ig-seguidores" de Netlify Blobs, claves "datos" y "marcas".
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { leerToken } from "./instagram-dm.mjs";

const HUELLA = "46dc6b2d2511fa898f7ec0e3a49c5a455906d1031a8331764638941dc28ad945";
const GRAPH = "https://graph.instagram.com/v27.0";
const USUARIO_OK = /^[a-z0-9._]{1,40}$/;

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
  if (!USUARIO_OK.test(u) || !["escrito", "seguido"].includes(tipo)) return null;
  const m = { escrito: {}, seguido: {}, ...(marcas || {}) };
  m[tipo] = { ...m[tipo] };
  if (valor) m[tipo][u] = hoy; else delete m[tipo][u];
  return m;
}

export default async (req) => {
  if (!claveValida(req.headers.get("x-clave"))) return json(401, { error: "Clave incorrecta" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/ig\/?/, "").replace(/\/$/, "");
  const store = getStore("ig-seguidores");

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
    return json(404, { error: "Ruta no existe" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e).slice(0, 300) });
  }
};

export const config = { path: "/api/ig/*" };
