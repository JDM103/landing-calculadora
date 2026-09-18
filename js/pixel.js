/* Píxel de Meta · investorcr.com
 *
 * Un solo lugar para el ID: cambialo acá y queda cambiado en todas las páginas
 * que carguen este archivo.
 *
 * Cómo se usa en una página:
 *   <script src="/js/pixel.js"></script>
 * en el <head>, junto al gtag. Nada más. El PageView se dispara solo.
 *
 * Las páginas ya llaman a fbq() para sus propios eventos, siempre con un
 * "typeof fbq === 'function'" adelante, así que no se rompen si el píxel no
 * está configurado.
 */
(function () {
  "use strict";

  // ⬇⬇ PEGÁ ACÁ EL ID DEL PÍXEL (solo números, lo da el Administrador de eventos de Meta) ⬇⬇
  var PIXEL_ID = "2090464615301934"; // Pixel InvestorCR

  // Sin ID configurado no se carga nada: ni script de Meta, ni requests.
  if (!/^\d{6,}$/.test(PIXEL_ID)) return;

  // Código base de Meta (el oficial, sin el <noscript> porque sin JS tampoco
  // funcionaría el resto de la página).
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
  (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
})();
