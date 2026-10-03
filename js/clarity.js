/* Microsoft Clarity · investorcr.com
 *
 * Grabaciones de sesión y mapas de calor. Un solo lugar para el ID del proyecto.
 *
 * Cómo se usa en una página:
 *   <script defer src="/js/clarity.js"></script>
 * en el <head>. Carga el tag oficial de Clarity y etiqueta la sesión con los UTM
 * del anuncio y la ruta, para poder filtrar grabaciones por campaña o creativo.
 *
 * Las páginas pueden llamar clarity("event", nombre) y clarity("set", clave, valor)
 * sin comprobar nada: el stub encola las llamadas hasta que el tag termine de cargar.
 */
(function () {
  "use strict";

  var PROJECT_ID = "ys1dmvj2ex";

  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", PROJECT_ID);

  // Etiquetas para filtrar en Clarity: de qué anuncio vino la persona y en qué página está.
  try {
    var q = new URLSearchParams(location.search);
    ["utm_source", "utm_campaign", "utm_content"].forEach(function (k) {
      var v = q.get(k);
      if (v) window.clarity("set", k, v);
    });
    if (!q.get("utm_source") && q.get("fbclid")) window.clarity("set", "utm_source", "meta");
    window.clarity("set", "pagina", location.pathname);
  } catch (e) {}
})();
