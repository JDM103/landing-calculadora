# Reglas de trabajo — investorcr.com (landing-calculadora)

Reglas OBLIGATORIAS para cualquier AI o colaborador que toque este repo:

## 1 · Todo cambio pasa primero por local host
- Ningún cambio se considera terminado sin verse en local. El sitio se sirve con
  `python -m http.server 8811` desde la raíz de este repo.
- Al terminar un cambio, SIEMPRE entregar el link exacto de local host para revisarlo
  (ej. `http://localhost:8811/panel/`, `http://localhost:8811/quiz/`).
- Verificar antes de entregar: 0 errores de consola y sin desborde horizontal en móvil
  (390px de ancho).

## 2 · Publicar SOLO con consentimiento explícito
- Publicar = hacer push a `main` (Netlify despliega automático). Está PROHIBIDO sin que
  Jose lo pida claramente con la palabra **"publica"** / "publicá" (o equivalente inequívoco).
- "Ok", "listo", "me gusta", "perfecto" NO son consentimiento para publicar.
- El consentimiento aplica al cambio conversado; si en el push viajan otros commits
  pendientes, avisarlo.
- Commitear local sin push está bien y es lo esperado.

## 3 · Convenciones del sitio
- Estático puro: una carpeta por ruta con su `index.html`, CSS embebido, sin frameworks
  ni build step.
- Páginas públicas: canonical + entrada en `sitemap.xml` + enlace desde alguna página
  pública. Páginas internas/semi-privadas: `<meta name="robots" content="noindex">`,
  sin sitemap y sin enlaces.
- Identidad: Bai Jamjuree; paleta --tinta #0d0f14/#15191E, --menta #63FCAF,
  --peri #556DFB, --crema #FEF9F3. og:image: `/assets/logo-fondo-negro.png`.
- Copy en voseo costarricense, voz de amigo; evitar los tells de escritura AI
  (contrastes "no es X, es Y", rayas de coletilla, triadas, jerga sin traducir).

## 4 · Sistema de clientes (repo aparte)
- El backend (Supabase: panel, reportes, señal, cierre de mes) vive en
  `c:/Users/Dell/repos/ei-sistema` — leer su README antes de tocar functions.
- El research cuantitativo (M39 vs LRS, laboratorio de señales) vive en
  `c:/Users/Dell/repos/ei-research` — leer `LEEME-TRASPASO.md`.
