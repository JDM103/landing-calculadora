/* Instagram → respuesta automática por palabra clave (reemplaza a ManyChat)
 *
 * Qué hace: cuando alguien le escribe a @joseinvestor.cr un DM (o responde una story) con una
 * palabra clave, Meta le avisa a esta función y la función contesta con el mensaje fijo de esa
 * palabra. Hoy solo existe CURSO, que manda el link de /curso. No usa ningún modelo: es texto
 * fijo escrito por Jose, así sale igual siempre y no cuesta nada.
 *
 * Reglas de Meta que esto respeta: solo se le contesta a quien escribió primero, dentro de las
 * 24 horas, y una vez por mensaje. Los comentarios en publicaciones también están soportados
 * (respuesta privada al comentario), pero Meta solo manda ese aviso con Advanced Access.
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   IG_VERIFY_TOKEN   · cualquier frase inventada; la misma que se pega en Meta al dar de alta el webhook
 *   IG_APP_SECRET     · "Instagram app secret" (Meta → la app → Instagram → API setup with Instagram login)
 *   META_APP_SECRET   · opcional: el App Secret de App settings → Basic, por si Meta firma con ese
 *   IG_ACCESS_TOKEN   · token de larga duración de la cuenta (dura 60 días; instagram-token.mjs lo renueva)
 *
 * Puesta en marcha: ver README de la carpeta, sección "Instagram: palabra clave".
 */
import crypto from "node:crypto";

const GRAPH = "https://graph.instagram.com/v27.0";

/* Palabras clave. La clave va en minúscula y sin tildes; se busca como palabra suelta dentro
 * del mensaje, así entran "CURSO", "curso", "quiero el curso" y no entra "concurso". */
export const PALABRAS = {
  curso: [
    "Hola, buenas. Aquí está el curso de Bienestar financiero, son 7 capítulos cortos:",
    "https://investorcr.com/curso/?utm_source=instagram&utm_medium=dm&utm_campaign=curso",
    "Usted es médico o de otra área?",
    "Gracias, Jose.",
  ].join("\n\n"),
};

const limpio = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function buscarPalabra(texto) {
  const t = limpio(texto);
  for (const p of Object.keys(PALABRAS)) {
    if (new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`).test(t)) return p;
  }
  return null;
}

/* Firma de Meta: cabecera "sha256=<hmac del cuerpo crudo>". Se acepta si calza con cualquiera
 * de los dos secretos, porque según cómo se haya creado la app Meta firma con uno u otro. */
export function firmaValida(header, raw, secretos) {
  const lista = secretos.map((s) => String(s || "").trim()).filter(Boolean);
  if (!lista.length || !header) return false;
  const recibido = Buffer.from(String(header).replace(/^sha256=/, ""));
  return lista.some((s) => {
    const esperado = Buffer.from(crypto.createHmac("sha256", s).update(raw, "utf8").digest("hex"));
    return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
  });
}

/* Saca del aviso lo que hay que contestar: [{ tipo, destino, palabra, id }].
 * Los DMs y las respuestas a stories llegan en entry.messaging; los comentarios llegan en
 * entry.changes (o en entry.field / entry.value según la variante de login). */
export function pendientes(hook) {
  const out = [];
  const lotes = Array.isArray(hook) ? hook : [hook];
  for (const h of lotes) {
    if (!h || h.object !== "instagram") continue;
    for (const e of h.entry || []) {
      const cuenta = String(e.id || "");
      for (const m of e.messaging || []) {
        const msg = m.message;
        const de = String((m.sender || {}).id || "");
        // Los ecos son los mensajes que manda la propia cuenta: contestarlos haría un ciclo.
        if (!msg || msg.is_echo || !de || de === cuenta) continue;
        const palabra = buscarPalabra(msg.text);
        if (palabra) out.push({ tipo: "dm", destino: { id: de }, palabra, id: msg.mid || "" });
      }
      const cambios = (e.changes || []).slice();
      if (e.field) cambios.push({ field: e.field, value: e.value });
      for (const c of cambios) {
        if (c.field !== "comments" || !c.value) continue;
        const v = c.value;
        if (String((v.from || {}).id || "") === cuenta) continue; // comentario de la propia cuenta
        const palabra = buscarPalabra(v.text);
        if (palabra && v.id) out.push({ tipo: "comentario", destino: { comment_id: v.id }, palabra, id: v.id });
      }
    }
  }
  return out;
}

/* El token vive en Netlify Blobs cuando ya fue renovado alguna vez; si no, sale de la variable. */
export async function leerToken() {
  try {
    const { getStore } = await import("@netlify/blobs");
    const guardado = await getStore("instagram").get("token");
    if (guardado) return guardado.trim();
  } catch (e) { /* sin Blobs (pruebas locales) se usa la variable */ }
  return (process.env.IG_ACCESS_TOKEN || "").trim();
}

/* Meta reintenta un aviso si no recibe 200 a tiempo. Esto evita contestar dos veces el mismo
 * mensaje mientras la función siga caliente; no sobrevive a un arranque en frío. */
const vistos = new Set();

export async function responder(p, token, fetchFn = fetch) {
  if (p.id && vistos.has(p.id)) return { enviado: false, motivo: "repetido" };
  if (p.id) { vistos.add(p.id); if (vistos.size > 500) vistos.clear(); }
  const r = await fetchFn(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: p.destino, message: { text: PALABRAS[p.palabra] } }),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Meta rechazó la respuesta:", p.tipo, p.palabra, JSON.stringify(res));
    return { enviado: false, motivo: "meta", meta: res };
  }
  console.log("Respuesta enviada:", p.tipo, p.palabra);
  return { enviado: true };
}

const texto = (code, body) => new Response(body, { status: code, headers: { "Content-Type": "text/plain" } });

export default async (req) => {
  const url = new URL(req.url);

  // Alta del webhook: Meta manda un GET con la frase y espera de vuelta el reto.
  if (req.method === "GET") {
    const frase = (process.env.IG_VERIFY_TOKEN || "").trim();
    const calza = frase && url.searchParams.get("hub.mode") === "subscribe"
      && url.searchParams.get("hub.verify_token") === frase;
    return calza ? texto(200, url.searchParams.get("hub.challenge") || "") : texto(403, "no");
  }
  if (req.method !== "POST") return texto(405, "solo GET y POST");

  const raw = await req.text();
  if (!firmaValida(req.headers.get("x-hub-signature-256"), raw,
    [process.env.IG_APP_SECRET, process.env.META_APP_SECRET])) {
    console.warn("Firma inválida:", JSON.stringify({
      largoCuerpo: raw.length, tieneHeader: !!req.headers.get("x-hub-signature-256"),
    }));
    return texto(401, "firma inválida");
  }

  let hook;
  try { hook = JSON.parse(raw); } catch (e) { return texto(400, "cuerpo no es JSON"); }

  const lista = pendientes(hook);
  if (lista.length) {
    const token = await leerToken();
    if (!token) console.error("Falta IG_ACCESS_TOKEN: no se pudo contestar", lista.length);
    else for (const p of lista) {
      try { await responder(p, token); } catch (e) { console.error("Fallo al contestar:", e.message); }
    }
  }
  // Siempre 200: si Meta recibe un error reintenta por 36 horas y el mensaje saldría repetido.
  return texto(200, "ok");
};
