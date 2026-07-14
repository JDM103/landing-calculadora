/**
 * Empowered Investor — Webhook de leads del wizard de retiro (landing-calculadora/wizard.html).
 *
 * Hace TRES cosas al recibir un POST:
 *   1) Agrega la fila del lead al Google Sheet (header-driven: crea columnas solas).
 *   2) Te AVISA que entró un lead: email siempre + WhatsApp (CallMeBot) si está configurado.
 *   3) Si el payload trae 'reporte' (leads calificados con correo): copia el template de Google Slides,
 *      reemplaza los tokens {{...}} con los numeros del cliente, lo exporta a PDF y se lo manda al correo.
 *
 * DESPLEGAR / ACTUALIZAR:
 *  1. Google Sheet -> Extensiones -> Apps Script. Borra lo que haya, pega TODO esto, Guarda.
 *  2. Implementar -> Gestionar implementaciones -> editar -> "Nueva version".
 *  3. La primera vez pide mas permisos (Slides, Drive, Gmail, conexiones externas): autorizalos.
 *  4. Corre verAlias() y probarReporte() desde el editor para verificar.
 *  5. Para la ALERTA por WhatsApp: segui las instrucciones de CallMeBot mas abajo y corre probarAlerta().
 */

var SHEET_NAME = 'Leads';
var TEMPLATE_ID = '11ZoBZJ_vyMCOsxmqUxmnc3JqE4oSOEYDVtqfO1x3J24';  // Google Slides "Tu Reporte Completo de Retiro"
var CORREO_DESDE = 'Jose - Empowered Investor';                    // nombre visible del remitente

// Direccion DESDE la que sale el correo. NO lleva contrasena: Apps Script usa OAuth.
//   - Vacio ('')  -> sale desde la cuenta de Google que es duena del script (la que autoriza).
//   - 'jose@investorcr.com' -> solo funciona si esa direccion esta como "Enviar como" verificado
//     en esa cuenta de Gmail (Config -> Cuentas -> Enviar como), o si esa cuenta ES la duena del script.
// Para ver que direcciones estan disponibles, corre verAlias() y mira el log.
var CORREO_FROM = 'jose@investorcr.com';

// ─────────────────────────────────────────────────────────────────────────────
// ALERTA A JOSE cuando entra un lead (email siempre + WhatsApp opcional)
// ─────────────────────────────────────────────────────────────────────────────
// A que correo llega la alerta. Vacio ('') = la cuenta dueña del script.
var ALERTA_EMAIL = '';
// true  = avisar SOLO de leads que dieron contacto (etapa 'reporte_solicitado').
// false = avisar de TODOS los leads (incluye los que solo vieron sus numeros).
var ALERTA_SOLO_CALIFICADOS = false;

// WhatsApp por CallMeBot (GRATIS, ~2 min de setup). Si dejas estos dos vacios, el WhatsApp se salta.
//   COMO ACTIVARLO (una vez):
//   1. Agenda el numero de CallMeBot en tus contactos: +34 644 51 95 23
//      (si no responde, confirma el numero vigente en callmebot.com/blog/free-api-whatsapp-messages/)
//   2. Desde TU WhatsApp, mandale a ese numero el mensaje EXACTO:  I allow callmebot to send me messages
//   3. Te contesta con tu apikey. Pegala abajo en CALLMEBOT_APIKEY.
//   4. Pone tu numero con codigo de pais y SIN '+', ej. Costa Rica: '50670558296'.
var CALLMEBOT_PHONE  = '';   // ej. '50670558296'
var CALLMEBOT_APIKEY = '';   // ej. '123456'

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  var reporteOk = null;
  try {
    var data = JSON.parse(e.postData.contents);

    // 'reporte' es solo para el PDF/correo, NO va al Sheet: lo sacamos antes de escribir la fila.
    var reporte = data.reporte || null;
    delete data.reporte;

    // 1) Fila en el Sheet (header-driven). Se hace SIEMPRE primero: nunca perdemos el lead.
    _appendFila(data);

    // 2) Alerta a Jose (email + WhatsApp). Envuelta en su propio try: una alerta que falle NUNCA
    //    puede impedir que el lead quede guardado ni que el reporte salga.
    try { _notificarLead(data); } catch (errA) { /* ignorar: la alerta es best-effort */ }

    // 3) Reporte por correo (solo calificados con correo valido).
    if (reporte && data.correo && String(data.correo).indexOf('@') > -1 && data.etapa === 'reporte_solicitado') {
      try {
        _generarYEnviarReporte(reporte, data.correo);
        reporteOk = true;
      } catch (err2) {
        reporteOk = 'error: ' + err2;   // el lead igual quedo guardado en el Sheet
      }
    }
    return _json({ ok: true, reporte: reporteOk });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function _appendFila(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  var headers = [];
  if (sh.getLastColumn() > 0 && sh.getLastRow() > 0) {
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String);
  }
  Object.keys(data).forEach(function (k) { if (headers.indexOf(k) === -1) headers.push(k); });
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var row = headers.map(function (h) { return data[h] !== undefined ? data[h] : ''; });
  sh.appendRow(row);
}

/** Formatea un numero con separadores de miles (para las alertas). */
function _n(v) {
  var n = Number(v || 0);
  return isNaN(n) ? '0' : n.toLocaleString('en-US');
}

/**
 * Avisa a Jose que entro un lead. Email siempre; WhatsApp por CallMeBot si esta configurado.
 * El mensaje resume quien es el lead y sus numeros, para decidir rapido si vale la pena llamarlo.
 */
function _notificarLead(data) {
  var califica = (data.califica === true || String(data.califica) === 'true');
  var etapa = data.etapa || '';
  var dioContacto = (etapa === 'reporte_solicitado');

  // Si solo querés alertas de leads con contacto, cortamos aca.
  if (ALERTA_SOLO_CALIFICADOS && !dioContacto) return;

  var titulo = dioContacto ? '📕 LEAD CALIFICADO — pidio el Reporte'
             : (califica ? '📥 Lead calificado (sin contacto)'
                         : '👀 Lead (no calificado)');

  var nombre = ((data.nombre || '') + ' ' + (data.apellido || '')).trim();
  var lineas = [
    titulo,
    nombre ? ('Nombre: ' + nombre) : null,
    data.whatsapp ? ('WhatsApp: ' + data.whatsapp) : null,
    data.correo ? ('Correo: ' + data.correo) : null,
    data.intencion ? ('Intencion: ' + data.intencion) : null,
    'Edad: ' + (data.edad_hoy || '?') + ' -> retiro ' + (data.edad_retiro || '?'),
    'Meta: CRC ' + _n(data.meta_col) + '/mes',
    'Salario: CRC ' + _n(data.salario_col),
    'Pension Estado: CRC ' + _n(data.pension_estatal_col) + ' (IVM ' + _n(data.ivm_col) + ' + ROP ' + _n(data.rop_col) + ')',
    'Brecha: CRC ' + _n(data.brecha_col) + '/mes',
    'Capital: $' + _n(data.capital_usd) + ' | Aporte: $' + _n(data.aporte_usd) + '/mes',
    'Perfil: ' + (data.perfil || '-'),
    'Tiempo en la calc: ' + (data.tiempo_calculadora || '-'),
    'Cuando: ' + (data.timestamp || '')
  ].filter(function (x) { return x; });
  var cuerpo = lineas.join('\n');

  // 1) EMAIL (siempre; no requiere ningun setup)
  var para = ALERTA_EMAIL || Session.getEffectiveUser().getEmail();
  if (para) {
    MailApp.sendEmail(para, titulo + ' · Empowered Investor', cuerpo);
  }

  // 2) WHATSAPP por CallMeBot (solo si esta configurado)
  if (CALLMEBOT_PHONE && CALLMEBOT_APIKEY) {
    var url = 'https://api.callmebot.com/whatsapp.php'
      + '?phone=' + encodeURIComponent(CALLMEBOT_PHONE)
      + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY)
      + '&text=' + encodeURIComponent(cuerpo);
    UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  }
}

/** Copia el template, reemplaza los tokens {{...}} con los valores de `reporte`, exporta PDF y lo manda por correo. */
function _generarYEnviarReporte(reporte, correo) {
  var nombre = reporte.nombre || '';
  var copia = DriveApp.getFileById(TEMPLATE_ID).makeCopy('Reporte de Retiro - ' + nombre + ' ' + (reporte.apellido || ''));
  var pres = SlidesApp.openById(copia.getId());

  Object.keys(reporte).forEach(function (k) {
    if (k === 'link_calendly_utm') return;   // este NO va como texto crudo: se pone como hipervinculo (abajo)
    pres.replaceAllText('{{' + k + '}}', String(reporte[k] == null ? '' : reporte[k]));
  });

  // El link de Calendly: en vez de volcar la URL larga como texto, reemplazamos el token por un
  // texto corto y clickeable ("Reservar mi sesion...") con la URL como hipervinculo. Asi el reporte
  // se ve limpio y el link sigue funcionando (con el prefill del lead).
  _tokenAHipervinculo(pres, '{{link_calendly_utm}}', 'Reservar mi sesion de 30 min, sin costo →',
                      reporte.link_calendly_utm || 'https://calendly.com/empoweredinvestor/reunion-de-30-minutos');

  pres.saveAndClose();

  var pdf = DriveApp.getFileById(copia.getId()).getAs('application/pdf')
              .setName('Reporte Completo de Retiro - Empowered Investor.pdf');

  var asunto = 'Tu Reporte Completo de Retiro - Empowered Investor';
  var cuerpo =
      'Hola ' + nombre + ',\n\n' +
      'Adjunto va tu Reporte Completo de Retiro, hecho con los numeros que ingresaste en la calculadora.\n\n' +
      'Adentro vas a encontrar tu brecha, tu proyeccion, tu perfil sugerido y como funciona invertir con cuenta propia ' +
      'en EE.UU. (broker, custodio, SIPC), ademas de los siguientes pasos segun tu caso.\n\n' +
      'Cuando quieras, agenda una sesion de diagnostico de 30 minutos, sin costo: revisamos tus numeros juntos. ' +
      'El link esta dentro del reporte.\n\n' +
      'Pura vida,\nJose\nEmpowered Investor\n\n' +
      'No se garantizan retornos. Los resultados pasados no garantizan resultados futuros. Herramienta educativa.';

  var opciones = { attachments: [pdf], name: CORREO_DESDE };
  if (CORREO_FROM) opciones.from = CORREO_FROM;   // solo surte efecto si es un alias valido/verificado
  GmailApp.sendEmail(correo, asunto, cuerpo, opciones);

  DriveApp.getFileById(copia.getId()).setTrashed(true);
}

/**
 * Reemplaza `token` (ej. '{{link_calendly_utm}}') por `label` en TODO el Slides y le pone `url` como
 * hipervinculo (azul, subrayado). Recorre shapes, celdas de tabla y grupos. Asi el reporte muestra
 * un texto clickeable corto en vez de una URL kilometrica volcada como texto.
 */
function _tokenAHipervinculo(pres, token, label, url) {
  pres.replaceAllText(token, label);              // token -> texto amigable (en todo el documento)
  var slides = pres.getSlides();
  for (var i = 0; i < slides.length; i++) {
    _linkEnElementos(slides[i].getPageElements(), label, url);
  }
}

function _linkEnElementos(els, label, url) {
  for (var j = 0; j < els.length; j++) {
    var tipo = els[j].getPageElementType();
    if (tipo === SlidesApp.PageElementType.SHAPE) {
      _linkEnTexto(els[j].asShape().getText(), label, url);
    } else if (tipo === SlidesApp.PageElementType.TABLE) {
      var tbl = els[j].asTable();
      for (var r = 0; r < tbl.getNumRows(); r++) {
        for (var c = 0; c < tbl.getNumColumns(); c++) {
          _linkEnTexto(tbl.getCell(r, c).getText(), label, url);
        }
      }
    } else if (tipo === SlidesApp.PageElementType.GROUP) {
      _linkEnElementos(els[j].asGroup().getChildren(), label, url);
    }
  }
}

function _linkEnTexto(textRange, label, url) {
  if (!textRange) return;
  var matches = textRange.find(label);
  if (!matches) return;
  for (var m = 0; m < matches.length; m++) {
    matches[m].getTextStyle().setLinkUrl(url).setForegroundColor('#1155CC').setUnderline(true);
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Webhook activo').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * DIAGNOSTICO: corre esto desde el editor y mira Ver -> Registros.
 * Te dice desde que cuenta corre el script y que direcciones "Enviar como" tenes disponibles.
 */
function verAlias() {
  Logger.log('Cuenta que corre el script: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Alias "Enviar como" disponibles: ' + JSON.stringify(GmailApp.getAliases()));
  Logger.log('CORREO_FROM configurado: ' + CORREO_FROM);
}

/**
 * PRUEBA DE LA ALERTA: corre esta funcion desde el editor. Te manda a vos la alerta de un lead
 * de ejemplo (email + WhatsApp si CallMeBot esta configurado), sin tocar el Sheet ni el reporte.
 */
function probarAlerta() {
  _notificarLead({
    etapa: 'reporte_solicitado', califica: true,
    nombre: 'Prueba', apellido: 'Alerta', whatsapp: '8888-8888', correo: 'prueba@correo.com',
    intencion: 'Acompanamiento', edad_hoy: 40, edad_retiro: 65,
    meta_col: 5000000, salario_col: 3500000, pension_estatal_col: 2100000,
    ivm_col: 1680000, rop_col: 420000, brecha_col: 2900000,
    capital_usd: 50000, aporte_usd: 1000, perfil: 'Crecimiento',
    tiempo_calculadora: '3 min 12 s', timestamp: new Date().toISOString()
  });
  Logger.log('Alerta de prueba enviada (revisa tu correo y, si configuraste CallMeBot, tu WhatsApp).');
}

/**
 * PRUEBA MANUAL: corre esta funcion desde el editor para mandarte un reporte de prueba a tu propio correo.
 */
function probarReporte() {
  var reporte = {
    nombre: 'Prueba', apellido: 'Montero', fecha: '10 de julio de 2026',
    meta_mensual: '$4,000', edad_retiro: '65', pension_total: '$3,250', brecha: '$750',
    vf_mercado: '$420,000', vf_max: '$520,000', total_proyectado: '$3,900',
    perfil_sugerido: 'Crecimiento',
    veredicto_texto: 'Con lo que podes aportar y un poco de constancia, tu meta es alcanzable.',
    perfil_texto: 'Tu brecha es grande, pero tenes tiempo. Esa combinacion pide estrategias de crecimiento con riesgo administrado.',
    aporte_usd: '$600', aportado_total: '$180,000',
    link_calendly_utm: 'https://calendly.com/empoweredinvestor/reunion-de-30-minutos?utm_source=wizard'
  };
  var miCorreo = Session.getActiveUser().getEmail();
  _generarYEnviarReporte(reporte, miCorreo);
  Logger.log('Reporte de prueba enviado a ' + miCorreo);
}
