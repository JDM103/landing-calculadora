/* Da de alta (o lista) el webhook de Calendly que alimenta la API de conversiones.
 *
 *   node netlify/functions/registrar-webhook.js          → lista los webhooks actuales
 *   node netlify/functions/registrar-webhook.js --crear  → crea el que falta
 *
 * Necesita CALENDLY_TOKEN en el entorno. En Windows está en el registro:
 *   $env:CALENDLY_TOKEN = [Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\Environment','CALENDLY_TOKEN',$null)
 *
 * Al crear, imprime la signing_key. Esa clave va a Netlify como
 * CALENDLY_SIGNING_KEY y no se puede volver a consultar después.
 */
"use strict";

const TOKEN = process.env.CALENDLY_TOKEN;
const USER = "https://api.calendly.com/users/b3d238cd-622d-4075-b1a7-da895cdfe549";
const DESTINO = "https://investorcr.com/.netlify/functions/calendly-capi";

async function api(path, opts = {}) {
  const r = await fetch("https://api.calendly.com" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body)}`);
  return body;
}

(async () => {
  if (!TOKEN) { console.error("Falta CALENDLY_TOKEN en el entorno."); process.exit(1); }

  const org = (await api("/users/" + USER.split("/").pop())).resource.current_organization;

  if (!process.argv.includes("--crear")) {
    const { collection } = await api(
      `/webhook_subscriptions?organization=${encodeURIComponent(org)}&user=${encodeURIComponent(USER)}&scope=user`
    );
    console.log(`Webhooks actuales (${collection.length}):`);
    collection.forEach((w) => console.log(`  ${w.state}  ${w.callback_url}  [${w.events.join(", ")}]`));
    console.log("\nPara crear el que falta:  node netlify/functions/registrar-webhook.js --crear");
    return;
  }

  const creado = await api("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: DESTINO,
      events: ["invitee.created"],
      organization: org,
      user: USER,
      scope: "user"
    })
  });

  console.log("Webhook creado:", creado.resource.uri);
  console.log("\n  CALENDLY_SIGNING_KEY = " + creado.resource.signing_key);
  console.log("\nCopiala a Netlify ahora: no se puede volver a consultar.");
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
