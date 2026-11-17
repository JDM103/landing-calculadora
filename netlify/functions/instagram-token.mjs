/* Renueva cada semana el token de Instagram que usa instagram-dm.mjs.
 *
 * Por qué existe: el token de larga duración vence a los 60 días. Sin esto, la respuesta
 * automática dejaría de funcionar un día sin avisar. Meta permite renovarlo cuando tiene más
 * de 24 horas y todavía no venció; el token nuevo se guarda en Netlify Blobs (store
 * "instagram", clave "token") y de ahí lo lee instagram-dm.mjs.
 *
 * Si alguna vez pasa más de 60 días sin renovarse (sitio pausado, por ejemplo), hay que
 * generar un token nuevo en Meta y ponerlo en IG_ACCESS_TOKEN; ver README de la carpeta.
 */
import { getStore } from "@netlify/blobs";

export default async () => {
  const store = getStore("instagram");
  const actual = ((await store.get("token")) || process.env.IG_ACCESS_TOKEN || "").trim();
  if (!actual) { console.error("No hay token de Instagram que renovar"); return; }

  const r = await fetch("https://graph.instagram.com/refresh_access_token"
    + `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(actual)}`);
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.access_token) {
    console.error("No se pudo renovar el token de Instagram:", JSON.stringify(res.error || res));
    return;
  }
  await store.set("token", res.access_token);
  console.log("Token de Instagram renovado; vence en", Math.round((res.expires_in || 0) / 86400), "días");
};

export const config = { schedule: "@weekly" };
