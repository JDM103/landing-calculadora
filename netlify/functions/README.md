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
- Las cancelaciones se ignoran: no son una conversión.
- Ante un error de Meta la función igual responde 200, para que Calendly no
  reintente y termine duplicando el aviso. El error queda en los logs.
