# Horarios de un click (Calendly → la landing)

`horarios.js`: la página /medicos, después de recibir nombre, especialidad y
WhatsApp, pide los próximos espacios libres de la llamada de médicos y los
muestra como tres botones (la hora más tarde libre de cada día). Cada botón abre
el link de reserva de Calendly con la hora ya elegida y los datos precargados.

Necesita en Netlify → Site configuration → Environment variables:

| Variable | Dónde sale |
|---|---|
| `CALENDLY_TOKEN` | Calendly → Integraciones → API y webhooks → Personal Access Token (el mismo que está en el registro de Windows) |

Sin esa variable la función responde 500 y la página simplemente no muestra
los tres botones: el Calendly abierto y el WhatsApp siguen funcionando.

Probar en vivo: `https://investorcr.com/.netlify/functions/horarios?n=3`
(responde `{"espacios":[{"inicio":"…Z","url":"https://calendly.com/…/2026-…Z"}],"total":24}`).

# API de conversiones de Meta (Calendly → Meta)

Cuando alguien reserva la llamada de médicos, Calendly le avisa a
`calendly-capi.js` y la función le manda el evento **Schedule** a Meta desde el
servidor. El píxel del navegador manda ese mismo evento con **el mismo
`event_id`**, así que Meta deduplica y la agenda se cuenta una sola vez.

Por qué importa: buena parte del tráfico entra por el navegador interno de
Instagram, donde el píxel se pierde seguido. El aviso del servidor llega igual.

```
Médico reserva en Calendly
         │
         ├── navegador: fbq('Schedule', …, {eventID:'cal_<uuid>'})   ← se puede perder
         │
         └── Calendly → /.netlify/functions/calendly-capi
                        → Graph API: Schedule con event_id 'cal_<uuid>'   ← siempre llega
```

## Puesta en marcha

### 1 · Variables de entorno en Netlify

Site configuration → Environment variables:

| Variable | Dónde sale | Obligatoria |
|---|---|---|
| `META_CAPI_TOKEN` | Administrador de eventos → el píxel → Configuración → *Generar token de acceso* | sí |
| `CALENDLY_SIGNING_KEY` | la devuelve el paso 3 al crear el webhook | sí |
| `META_PIXEL_ID` | por defecto `2090464615301934` | no |
| `META_TEST_EVENT_CODE` | Administrador de eventos → *Probar eventos*; **borrar al terminar la prueba** | no |
| `CALENDLY_EVENT_TYPE` | uuid del tipo de evento; por defecto el de médicos | no |

El token nunca va en el repo. Solo en Netlify.

### 2 · Publicar

La función se despliega sola con el sitio. Queda en:

```
https://investorcr.com/.netlify/functions/calendly-capi
```

### 3 · Dar de alta el webhook en Calendly

Una sola vez, con `CALENDLY_TOKEN` en el entorno (ya está en el registro de Windows):

```bash
node netlify/functions/registrar-webhook.js
```

Guardá la `signing_key` que imprime y ponela en Netlify como
`CALENDLY_SIGNING_KEY`. Sin esa clave la función acepta cualquier POST.

### 4 · Comprobar

1. Administrador de eventos → **Probar eventos**, copiá el código y ponelo en
   `META_TEST_EVENT_CODE`.
2. Reservá una cita de prueba en el Calendly de médicos.
3. Tienen que aparecer **dos** `Schedule` (navegador y servidor) marcados como
   deduplicados, o uno solo si el navegador bloqueó el píxel.
4. Borrá `META_TEST_EVENT_CODE`.

Los logs de cada aviso quedan en Netlify → Functions → `calendly-capi`.

## Detalles que importan

- **Se manda:** correo, teléfono, nombre y apellido, todo en SHA-256 como pide
  Meta. El teléfono sale de la pregunta del formulario de Calendly y se le
  agrega el 506 si viene sin código de país.
- **No se manda** IP ni las cookies `fbc`/`fbp`: viven en el navegador y el
  webhook no las trae.
- **`event_time`** es cuándo reservó, no cuándo es la cita.
- **Solo cuenta la llamada de médicos.** El webhook de Calendly es por usuario,
  así que llegan todas las reservas (clientes, diagnósticos, apertura de cuenta).
  La función descarta las que no son del tipo de evento `medicos`
  (`83aa89b0-4502-4f3b-8cad-69d665b6d0a0`); si no, cada llamada de cliente
  contaría como conversión del anuncio.
- Las cancelaciones se ignoran: no son una conversión.
- Ante un error de Meta la función igual responde 200, para que Calendly no
  reintente y termine duplicando el aviso. El error queda en los logs.

# Simulación en vivo de tres reglas (/live)

`live.js`: la página interna `/live` (noindex) muestra, barra de 30 minutos por barra,
cómo se habrían comportado Atalaya actual, la Atalaya de 30 minutos (mejor punto de la
malla de `research/edges/atalaya-intradia`) y Concretum (momentum intradía, versión del
paper) sobre QQQ con $100,000 de mentira cada una desde el 27 de octubre de 2026. Se
reconstruye entera en cada llamada; no guarda estado.

**Solo lee precios.** El único host que usa es `data.alpaca.markets`; no hay ninguna
llamada al host de trading ni a cuentas. Las keys sirven únicamente para leer datos.

Necesita en Netlify → Site configuration → Environment variables:

| Variable | Dónde sale |
|---|---|
| `APCA_API_KEY_ID` | Alpaca → API keys. Conviene que sean de una **cuenta paper**: para leer datos sirven igual y no pueden mover plata |
| `APCA_API_SECRET_KEY` | la pareja de la anterior |

Sin esas variables la función responde 500 y la página muestra el aviso. Cachea 60 s.
Datos SIP del plan gratis: 15 minutos de atraso, así que cada barra aparece un cuarto
de hora después de cerrar. Para verla en localhost sin función: `node "C:\Users\Dell\repos\Negocio\research\edges\live-sim\correr_local.js"`
genera `live/data.json` (no se commitea) y la página lo lee cuando corre en localhost.

Probar en vivo: `https://investorcr.com/.netlify/functions/live`.

## atalaya-vivo.js · datos para /atalaya/vivo (Atalaya en tiempo real)

Solo lectura de Alpaca (mismas variables `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` que `live.js`). Devuelve los cierres
diarios de QQQ (~700 días, sin la barra de hoy mientras no cierre), las barras de 5 min de hoy (IEX) y el último precio
de QQQ, TQQQ, QLD y SPY. La página calcula los niveles (SMA 200 ±3%, máximo 39 semanas −12/−6, M39 semanal −18%) y
recibe el precio tick a tick por el WebSocket público de Yahoo Finance (sin keys). Caché: diario 10 min, resto 5 s.

Probar en vivo: `https://investorcr.com/.netlify/functions/atalaya-vivo`.
Probar en local con funciones: `node research/edges/live-sim/servidor_local.js` → `http://localhost:8812/atalaya/vivo/`.

# Instagram: palabra clave (reemplaza a ManyChat)

`instagram-dm.mjs`: cuando alguien manda un DM o responde una story de @joseinvestor.cr con la
palabra **CURSO**, la función contesta con un botón que abre /curso (con UTM `instagram / dm / curso`,
que /curso ya guarda en el Sheet) y una pregunta, en voseo. Si Meta rechaza el botón, sale en texto con el link. Texto fijo, sin modelo. Las palabras y sus
mensajes están en el objeto `PALABRAS` al inicio del archivo: agregar otra es agregar una línea.

`instagram-token.mjs`: tarea semanal que renueva el token (vence a los 60 días) y lo guarda en
Netlify Blobs.

## Puesta en marcha (una sola vez)

### 1 · App de Meta
developers.facebook.com → la app (sirve la del tracker de ads o una nueva tipo Business) →
agregar el producto **Instagram** → *API setup with Instagram login*. Ahí:
- Copiar el **Instagram app secret**.
- *Generate access token* para @joseinvestor.cr aceptando los permisos `instagram_business_basic`
  e `instagram_business_manage_messages`. Ese es el token de larga duración.
- En la app de Instagram del celular: Configuración → Mensajes y respuestas a historias →
  Herramientas conectadas → **Permitir acceso a los mensajes**. Sin eso Meta no manda los DMs.

### 2 · Variables de entorno en Netlify

| Variable | Valor |
|---|---|
| `IG_VERIFY_TOKEN` | una frase inventada cualquiera |
| `IG_APP_SECRET` | el Instagram app secret del paso 1 |
| `IG_ACCESS_TOKEN` | el token del paso 1 |
| `META_APP_SECRET` | opcional: App settings → Basic → App secret, solo si la firma falla con el otro |

### 3 · Publicar
La función se despliega con el sitio y queda en
`https://investorcr.com/.netlify/functions/instagram-dm`.

### 4 · Dar de alta el webhook en Meta
En la misma pantalla de *API setup with Instagram login* → Configure webhooks: Callback URL la de
arriba, Verify token la frase de `IG_VERIFY_TOKEN`, y suscribir el campo **messages** (y
**comments** si algún día hay Advanced Access). Luego activar la suscripción de la cuenta:

```bash
curl -X POST "https://graph.instagram.com/v27.0/me/subscribed_apps?subscribed_fields=messages&access_token=EL_TOKEN"
```

Tiene que responder `{"success": true}`. Por último, pasar la app a **Live** (Meta solo manda
avisos de gente real con la app publicada).

### 5 · Comprobar
Desde una cuenta que NO sea la de Jose ni tenga rol en la app, mandar "curso" por DM. Tiene que
llegar el link en segundos. Los logs quedan en Netlify → Functions → `instagram-dm`:
- "Firma inválida": probar poniendo también `META_APP_SECRET`.
- "Meta rechazó la respuesta": el JSON del error dice si es el token o un permiso.
- No aparece nada en los logs: el aviso no está llegando; revisar paso 1 (acceso a mensajes),
  paso 4 (suscripción) y que la app esté Live. Si con todo eso solo llegan los mensajes de
  cuentas con rol en la app, Meta está pidiendo Advanced Access (revisión de app) para el
  público, y ahí se decide si se pide la revisión.

## Detalles que importan
- Solo contesta a quien escribió primero y una vez por mensaje; ignora los mensajes propios.
- "concurso" o "cursos" no disparan; "Quiero el curso" sí.
- Los comentarios en publicaciones están programados (respuesta privada al comentario) pero
  Meta solo manda ese aviso con Advanced Access, que requiere revisión de app y verificación
  del negocio.
- Siempre responde 200 a Meta para que no reintente y el mensaje no salga repetido.
- Antes de cancelar ManyChat: desconectarlo de la cuenta de Instagram, para que no contesten
  los dos a la vez.
