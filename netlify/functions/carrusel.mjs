/* /carrusel · borradores y fotos de los carruseles de Instagram (Netlify Blobs)
 *
 * Qué hace: guarda los borradores (guion + caption + fondos por slide) y las fotos que Jose
 * sube desde el celular, para que el mismo proyecto se vea en la compu y en el celular.
 * La skill /carrusel (Claude Code por Remote Control) también deja borradores acá.
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   CARRUSEL_TOKEN · clave que manda la página y el script subir_borrador.py (cabecera x-token)
 *
 * Rutas (todas piden la cabecera x-token):
 *   GET    /api/carrusel/borradores          → [{id, nombre, slides, actualizado}]
 *   GET    /api/carrusel/borradores/:id      → el borrador completo (JSON)
 *   PUT    /api/carrusel/borradores/:id      → guarda el JSON del cuerpo
 *   DELETE /api/carrusel/borradores/:id
 *   GET    /api/carrusel/fotos               → [{id, tipo}] de la más nueva a la más vieja
 *   POST   /api/carrusel/fotos               → cuerpo binario (image/jpeg|png|webp) → {id}
 *   GET    /api/carrusel/fotos/:id           → la imagen
 *   DELETE /api/carrusel/fotos/:id
 *
 * Almacén: store "carrusel" de Netlify Blobs. Claves borradores/<id>.json y fotos/<id>.
 */
import { getStore } from "@netlify/blobs";

const json = (code, body) => new Response(JSON.stringify(body), {
  status: code,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const ID_OK = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TIPOS = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async (req) => {
  const esperado = process.env.CARRUSEL_TOKEN;
  if (!esperado) return json(503, { error: "Falta CARRUSEL_TOKEN en Netlify" });
  const token = req.headers.get("x-token") || "";
  if (token !== esperado) return json(401, { error: "Clave incorrecta" });

  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/api\/carrusel\/?/, "").split("/").filter(Boolean);
  const [tipo, id] = partes;
  const store = getStore("carrusel");

  try {
    if (tipo === "borradores") {
      if (!id) {
        const { blobs } = await store.list({ prefix: "borradores/" });
        const lista = [];
        for (const b of blobs) {
          const d = await store.get(b.key, { type: "json" });
          if (d) lista.push({ id: d.id, nombre: d.nombre || "Sin nombre", slides: (d.slides || []).length, actualizado: d.actualizado || 0 });
        }
        lista.sort((a, b) => b.actualizado - a.actualizado);
        return json(200, lista);
      }
      if (!ID_OK.test(id)) return json(400, { error: "id inválido" });
      const key = "borradores/" + id + ".json";
      if (req.method === "GET") {
        const d = await store.get(key, { type: "json" });
        return d ? json(200, d) : json(404, { error: "No existe" });
      }
      if (req.method === "PUT") {
        const d = await req.json();
        d.id = id;
        d.actualizado = Date.now();
        await store.setJSON(key, d);
        return json(200, { ok: true, actualizado: d.actualizado });
      }
      if (req.method === "DELETE") {
        await store.delete(key);
        return json(200, { ok: true });
      }
    }

    if (tipo === "fotos") {
      if (!id) {
        if (req.method === "POST") {
          const ct = (req.headers.get("content-type") || "").split(";")[0].trim();
          if (!TIPOS.has(ct)) return json(400, { error: "Solo jpeg, png o webp" });
          const buf = await req.arrayBuffer();
          if (buf.byteLength > 6 * 1024 * 1024) return json(413, { error: "Foto muy pesada (máximo 6 MB)" });
          const nuevo = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
          await store.set("fotos/" + nuevo, buf, { metadata: { tipo: ct } });
          return json(200, { id: nuevo, tipo: ct });
        }
        const { blobs } = await store.list({ prefix: "fotos/" });
        const lista = blobs.map(b => ({ id: b.key.slice(6) })).sort((a, b) => (a.id < b.id ? 1 : -1));
        return json(200, lista);
      }
      if (!ID_OK.test(id)) return json(400, { error: "id inválido" });
      const key = "fotos/" + id;
      if (req.method === "GET") {
        const e = await store.getWithMetadata(key, { type: "arrayBuffer" });
        if (!e) return json(404, { error: "No existe" });
        return new Response(e.data, { status: 200, headers: { "Content-Type": (e.metadata && e.metadata.tipo) || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
      }
      if (req.method === "DELETE") {
        await store.delete(key);
        return json(200, { ok: true });
      }
    }
    return json(404, { error: "Ruta no existe" });
  } catch (e) {
    return json(500, { error: String(e && e.message || e).slice(0, 300) });
  }
};

export const config = { path: "/api/carrusel/*" };
