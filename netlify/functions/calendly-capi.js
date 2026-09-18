/* Calendly → API de conversiones de Meta
 *
 * Qué hace: cuando alguien reserva una llamada en Calendly, Calendly le pega a
 * esta función y la función le avisa a Meta desde el servidor que hubo un
 * "Schedule". Así la conversión llega aunque el navegador del médico bloquee el
 * píxel (pasa seguido en el navegador interno de Instagram y en iOS).
 *
 * Deduplicación: el id que mandamos acá ("cal_" + uuid del invitado) es el mismo
 * que manda el píxel desde la página, así que Meta entiende que son el mismo
 * hecho y no cuenta la agenda dos veces.
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   META_CAPI_TOKEN        · token de la API de conversiones (Administrador de eventos)
 *   META_PIXEL_ID          · opcional, por defecto el píxel InvestorCR
 *   CALENDLY_SIGNING_KEY   · clave de firma del webhook, para no aceptar avisos falsos
 *   META_TEST_EVENT_CODE   · opcional, solo mientras se prueba en "Probar eventos"
 *
 * Alta del webhook en Calendly (una sola vez, ver README de la carpeta).
 */
"use strict";

const crypto = require("crypto");

const GRAPH = "https://graph.facebook.com/v21.0";
const PIXEL_ID = process.env.META_PIXEL_ID || "2090464615301934";

const ok = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const bad = (code, msg) => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

/* Meta pide los datos personales en SHA-256, normalizados antes de hashear. */
const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const norm = (v) => String(v || "").trim().toLowerCase();

function hashEmail(v) {
  const e = norm(v);
  return e.includes("@") ? sha256(e) : null;
}

/* Teléfono: solo dígitos, con código de país. Los números de Costa Rica llegan
 * de Calendly como "+506 8888 8888"; si viene sin código, se asume 506. */
function hashPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 8) d = "506" + d;
  return d.length >= 8 ? sha256(d) : null;
}

function hashName(v) {
  const n = norm(v).replace(/[^\p{L}\s'-]/gu, "").trim();
  return n ? sha256(n) : null;
}

/* Calendly manda el nombre completo en "name" y, si el formulario los separa,
 * también first_name / last_name. */
function partirNombre(inv) {
  let fn = inv.first_name || "";
  let ln = inv.last_name || "";
  if (!fn && inv.name) {
    const p = String(inv.name).trim().split(/\s+/);
    fn = p.shift() || "";
    ln = p.join(" ");
  }
  return { fn, ln };
}

/* El teléfono viene de una pregunta del formulario, no de un campo fijo. */
function buscarTelefono(inv) {
  if (inv.text_reminder_number) return inv.text_reminder_number;
  const qs = Array.isArray(inv.questions_and_answers) ? inv.questions_and_answers : [];
  for (const qa of qs) {
    const q = norm(qa.question);
    if (/tel|phone|whats|celular|m[oó]vil/.test(q) && qa.answer) return qa.answer;
  }
  return null;
}

/* Firma del webhook: "t=<timestamp>,v1=<hmac>" sobre "<timestamp>.<cuerpo>". */
function firmaValida(header, rawBody, key) {
  if (!key) return true; // sin clave configurada no se valida (ver README)
  if (!header) return false;
  const partes = Object.fromEntries(
    String(header).split(",").map((p) => p.split("=").map((x) => x.trim()))
  );
  if (!partes.t || !partes.v1) return false;
  // Se rechaza lo que tenga más de 5 minutos, para que no reenvíen un aviso viejo.
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > 300) return false;
  const esperado = crypto.createHmac("sha256", key).update(`${partes.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return bad(405, "solo POST");

  const token = process.env.META_CAPI_TOKEN;
  if (!token) return bad(500, "falta META_CAPI_TOKEN");

  const raw = event.body || "";
  if (!firmaValida(event.headers["calendly-webhook-signature"], raw, process.env.CALENDLY_SIGNING_KEY)) {
    return bad(401, "firma inválida");
  }

  let hook;
  try { hook = JSON.parse(raw); } catch (e) { return bad(400, "cuerpo no es JSON"); }

  // Solo interesa la reserva nueva; las cancelaciones no son una conversión.
  if (hook.event !== "invitee.created") return ok({ ignorado: hook.event });

  const inv = hook.payload || {};
  const uuid = String(inv.uri || "").match(/invitees\/([0-9a-f-]+)/i);
  if (!uuid) return bad(400, "no vino el uri del invitado");

  const { fn, ln } = partirNombre(inv);
  const tracking = inv.tracking || {};

  const user_data = {};
  const em = hashEmail(inv.email);         if (em) user_data.em = [em];
  const ph = hashPhone(buscarTelefono(inv)); if (ph) user_data.ph = [ph];
  const hfn = hashName(fn);                if (hfn) user_data.fn = [hfn];
  const hln = hashName(ln);                if (hln) user_data.ln = [hln];

  const payload = {
    data: [{
      event_name: "Schedule",
      // Cuándo reservó, no cuándo es la cita: Meta atribuye por el momento de la acción.
      event_time: Math.floor(new Date(inv.created_at || Date.now()).getTime() / 1000),
      event_id: "cal_" + uuid[1],
      event_source_url: tracking.utm_source
        ? `https://investorcr.com/medicos/?utm_source=${encodeURIComponent(tracking.utm_source)}`
        : "https://investorcr.com/medicos/",
      action_source: "website",
      user_data,
      custom_data: {
        content_name: "llamada medicos",
        content_category: tracking.utm_campaign || ""
      }
    }]
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  const r = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const res = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error("Meta rechazó el evento:", JSON.stringify(res));
    // 200 igual: si devolvemos error, Calendly reintenta y se duplica el aviso.
    return ok({ enviado: false, meta: res });
  }
  console.log("Schedule enviado:", payload.data[0].event_id, JSON.stringify(res));
  return ok({ enviado: true, event_id: payload.data[0].event_id, meta: res });
};
