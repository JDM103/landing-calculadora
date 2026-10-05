/**
 * Empowered Investor — Webhook de leads del wizard de retiro (landing-calculadora/wizard.html).
 *
 * Hace CUATRO cosas al recibir un POST:
 *   1) Agrega la fila del lead al Google Sheet (header-driven: crea columnas solas).
 *   2) Te AVISA que entró un lead: email siempre + WhatsApp (CallMeBot) si está configurado.
 *   3) Si el payload trae 'reporte' (leads calificados con correo): copia el template de Google Slides,
 *      reemplaza los tokens {{...}} con los numeros del cliente, lo exporta a PDF y se lo manda al correo.
 *   4) Da de alta el lead en MailerLite (solo si dio correo), con su origen y sus numeros como campos.
 *
 * DESPLEGAR / ACTUALIZAR:
 *  1. Google Sheet -> Extensiones -> Apps Script. Borra lo que haya, pega TODO esto, Guarda.
 *  2. Implementar -> Gestionar implementaciones -> editar -> "Nueva version".
 *  3. La primera vez pide mas permisos (Slides, Drive, Gmail, conexiones externas): autorizalos.
 *  4. Corre verAlias() y probarReporte() desde el editor para verificar.
 *  5. Para la ALERTA por WhatsApp: segui las instrucciones de CallMeBot mas abajo y corre probarAlerta().
 *  6. Para MAILERLITE: corre guardarTokenMailerLite() una vez, despues verGruposMailerLite() para
 *     sacar los IDs de tus grupos, pegalos en GRUPOS_ML, y proba con probarMailerLite().
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

// Etapas que disparan el envio del Reporte en PDF (si el payload trae 'reporte' y un correo valido).
//   reporte_solicitado  -> wizard.html (modelo viejo)
//   reporte_solicitada  -> landing nueva, boton del reporte
//   llamada_solicitada  -> landing nueva, boton de la llamada (tambien le prometemos el reporte)
var ETAPAS_CON_REPORTE = ['reporte_solicitado', 'reporte_solicitada', 'llamada_solicitada'];

// ─────────────────────────────────────────────────────────────────────────────
// MAILERLITE: alta automatica del lead en la lista
// ─────────────────────────────────────────────────────────────────────────────
// El token NO va en este archivo: el repo landing-calculadora es PUBLICO. Vive en las
// Propiedades del script (Configuracion del proyecto -> Propiedades del script), que no
// se commitean. Para guardarlo, corre guardarTokenMailerLite() una vez desde el editor.
//
// SETUP (una vez):
//  1. MailerLite -> Integrations -> MailerLite API -> Generate new token. Copialo.
//  2. En el editor de Apps Script, abri guardarTokenMailerLite(), pega el token en la
//     linea que dice PEGA_TU_TOKEN_AQUI, corre la funcion, y despues BORRA el token de
//     la funcion y guarda. Queda almacenado en las propiedades del script.
//  3. Corre verGruposMailerLite() y mira el log: te lista tus grupos con sus IDs.
//  4. Pega esos IDs en GRUPOS_ML abajo.
//  5. Corre probarMailerLite() para dar de alta un correo de prueba.

var ML_API = 'https://connect.mailerlite.com/api';

// A que grupo entra cada lead segun lo que hizo. Dejar '' = no asignar grupo (entra a la
// lista general igual). Podes usar el mismo ID en los tres si no querés segmentar todavia.
// IDs reales de la cuenta (creados el 29/07/2026). Para verlos de nuevo: verGruposMailerLite().
var GRUPOS_ML = {
  llamada:    '194371895936681787',   // "Calculadora - Pidio llamada"  <- el lead mas caliente
  reporte:    '194371896334091324',   // "Calculadora - Descargo plan"
  newsletter: '194371895531931055',   // "Newsletter"  <- se suscribio desde /newsletter/
  otro:       '194371896334091324'    // cualquier otra etapa con correo (ej. descarga_pdf)
};

// true  = solo dar de alta leads que pidieron reporte o llamada.
// false = dar de alta a cualquiera que haya dejado un correo valido.
var ML_SOLO_CALIFICADOS = false;

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  var reporteOk = null;
  var mlOk = null;
  try {
    var data = JSON.parse(e.postData.contents);

    // Lotes de eventos de la landing (/medicos): van a OTRO spreadsheet, nunca a Leads, y sin alertas.
    if (data.tipo === 'eventos') {
      return _json({ ok: true, eventos: _appendEventos(data) });
    }

    // 'reporte' es solo para el PDF/correo, NO va al Sheet: lo sacamos antes de escribir la fila.
    var reporte = data.reporte || null;
    delete data.reporte;

    // 1) Fila en el Sheet (header-driven). Se hace SIEMPRE primero: nunca perdemos el lead.
    _appendFila(data);

    // 2) Alerta a Jose (email + WhatsApp). Envuelta en su propio try: una alerta que falle NUNCA
    //    puede impedir que el lead quede guardado ni que el reporte salga.
    try { _notificarLead(data); } catch (errA) { /* ignorar: la alerta es best-effort */ }

    // 2b) Alta en MailerLite. Tambien best-effort por la misma razon: si MailerLite esta caido
    //     o el token expiro, el lead ya quedo en el Sheet y el reporte igual sale.
    try { mlOk = _syncMailerLite(data); } catch (errM) { mlOk = 'error: ' + errM; }

    // 3) Reporte por correo. Etapas que lo piden: el wizard viejo ('reporte_solicitado') y la
    //    landing nueva ('reporte_solicitada' y 'llamada_solicitada', porque la llamada tambien
    //    promete el reporte). Cualquier payload con 'reporte' + correo valido lo dispara.
    if (reporte && data.correo && String(data.correo).indexOf('@') > -1 && ETAPAS_CON_REPORTE.indexOf(data.etapa) > -1) {
      try {
        _generarYEnviarReporte(reporte, data.correo);
        reporteOk = true;
      } catch (err2) {
        reporteOk = 'error: ' + err2;   // el lead igual quedo guardado en el Sheet
      }
    }
    return _json({ ok: true, reporte: reporteOk, mailerlite: mlOk });
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
  var etapa = data.etapa || '';
  var dioContacto = !!(data.correo && String(data.correo).indexOf('@') > -1);

  // Si solo querés alertas de leads con contacto, cortamos aca.
  if (ALERTA_SOLO_CALIFICADOS && !dioContacto) return;

  var titulo = etapa === 'medicos_wa' ? '🩺 LEAD MEDICO: pidio la llamada de claridad'
             : etapa === 'llamada_solicitada' ? '📞 LEAD: pidio una LLAMADA'
             : (etapa === 'reporte_solicitada' || etapa === 'reporte_solicitado') ? '📕 LEAD: pidio el Reporte'
             : (data.califica === true || String(data.califica) === 'true') ? '📥 Lead calificado (sin contacto)'
             : '👀 Lead (sin contacto)';

  // El payload cambia segun el origen (landing nueva vs wizard viejo): mostramos lo que venga.
  var L = [titulo];
  function add(lbl, v) {
    if (v === undefined || v === null || v === '' || v === 0 || v === '0') return;
    L.push(lbl + ': ' + v);
  }
  var nombre = ((data.nombre || '') + ' ' + (data.apellido || '')).trim();

  // Landing de medicos (/medicos): solo pide especialidad, nombre y WhatsApp. El correo va corto,
  // con el link para escribirle de una vez y de que anuncio vino.
  if (etapa === 'medicos_wa') {
    add('Nombre', nombre);
    add('Especialidad', data.especialidad);
    add('WhatsApp', data.whatsapp ? ('+' + data.whatsapp + '  ->  https://wa.me/' + data.whatsapp) : '');
    add('Anuncio', [data.utm_source, data.utm_campaign, data.utm_content].filter(String).join(' / '));
    add('Pagina', data.pagina);
    add('Cuando', data.timestamp);
    _enviarAlerta(titulo, L.join('\n'));
    return;
  }
  // Newsletter (linktree / home): solo nombre, correo y de donde vino.
  if (etapa === 'newsletter') {
    titulo = '📰 Newsletter: nuevo suscriptor';
    L = [titulo];
    add('Nombre', nombre);
    add('Correo', data.correo);
    add('Origen', [data.utm_source, data.utm_medium, data.utm_campaign].filter(String).join(' / '));
    add('Cuando', data.timestamp);
    _enviarAlerta(titulo, L.join('\n'));
    return;
  }

  // Wizard / calculadora: solo se muestran los numeros que vinieron (nada de "undefined" ni "$0").
  add('Nombre', nombre);
  add('WhatsApp', data.whatsapp);
  add('Correo', data.correo);
  add('Que quiere', data.autocalificacion || data.intencion);   // landing | wizard
  var edad = data.edad || data.edad_hoy;
  if (edad) add('Edad', edad + (data.edad_retiro ? (' -> retiro ' + data.edad_retiro) : ''));
  if (Number(data.meta_usd) || Number(data.meta_col)) add('Meta', '$' + _n(data.meta_usd) + '/mes  (CRC ' + _n(data.meta_col) + ')');
  if (Number(data.salario_usd) || Number(data.salario_col)) add('Salario', '$' + _n(data.salario_usd) + '  (CRC ' + _n(data.salario_col) + ')');
  if (Number(data.pension_col || data.pension_estatal_col)) add('Pension de la Caja', 'CRC ' + _n(data.pension_col || data.pension_estatal_col) + '/mes'
      + (data.toco_techo_ivm ? '  [TOPE del IVM]' : ''));
  // Landing nueva: meta de capital + los 4 aportes calculados.
  if (Number(data.capital_objetivo_usd)) add('Capital objetivo', '$' + _n(data.capital_objetivo_usd));
  if (data.aporte_8_usd) {
    L.push('Aportes/mes -> 8%: $' + _n(data.aporte_8_usd) + ' | 15%: $' + _n(data.aporte_15_usd)
           + ' | retiro 8%: $' + _n(data.aporte_retiro8_usd) + ' | ambas: $' + _n(data.aporte_combo_usd));
  }
  // Wizard viejo.
  if (Number(data.brecha_col)) add('Brecha', 'CRC ' + _n(data.brecha_col) + '/mes');
  add('Perfil', data.perfil);
  add('Toggles abiertos', (data.toggles_total ? (data.toggles_total + '  (' + data.toggles_abiertos + ')') : ''));
  add('Tiempo en la calc', data.tiempo_calculadora);
  add('Cuando', data.timestamp);
  _enviarAlerta(titulo, L.join('\n'));
}

/** Manda la alerta: email siempre; WhatsApp por CallMeBot solo si esta configurado. */
function _enviarAlerta(titulo, cuerpo) {
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

// ─────────────────────────────────────────────────────────────────────────────
// MAILERLITE
// ─────────────────────────────────────────────────────────────────────────────

/** Lee el token de las Propiedades del script. Devuelve '' si no esta configurado. */
function _tokenML() {
  return PropertiesService.getScriptProperties().getProperty('MAILERLITE_TOKEN') || '';
}

/** Llamada cruda a la API de MailerLite. Devuelve {code, body}. */
function _ml(metodo, ruta, payload) {
  var token = _tokenML();
  if (!token) throw new Error('Falta MAILERLITE_TOKEN. Corre guardarTokenMailerLite() una vez.');
  var opciones = {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    },
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload) opciones.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(ML_API + ruta, opciones);
  return { code: res.getResponseCode(), body: res.getContentText() };
}

/**
 * Da de alta (o actualiza) el lead en MailerLite.
 *
 * El endpoint es un upsert no destructivo: 201 si es nuevo, 200 si ya existia, y no borra
 * campos ni grupos que no vengan en el payload. Asi que si la misma persona vuelve a llenar
 * la calculadora, se actualizan sus numeros sin perder el historial ni sacarla de sus grupos.
 *
 * Devuelve un string corto para el log/respuesta, o null si no habia nada que hacer.
 */
function _syncMailerLite(data) {
  var correo = String(data.correo || '').trim();
  if (correo.indexOf('@') === -1) return null;          // sin correo no hay nada que dar de alta
  if (!_tokenML()) return 'sin token';

  var etapa = data.etapa || '';
  var esLlamada = etapa === 'llamada_solicitada';
  var esReporte = etapa === 'reporte_solicitada' || etapa === 'reporte_solicitado';
  var esNewsletter = etapa === 'newsletter';

  // El del newsletter pidio explicitamente los correos, asi que nunca se filtra.
  if (ML_SOLO_CALIFICADOS && !esLlamada && !esReporte && !esNewsletter) return 'omitido (no calificado)';

  var grupo = esLlamada ? GRUPOS_ML.llamada
            : esReporte ? GRUPOS_ML.reporte
            : esNewsletter ? GRUPOS_ML.newsletter
            : GRUPOS_ML.otro;

  // Los campos deben existir en MailerLite (Subscribers -> Fields) o se ignoran en silencio.
  // 'name' y 'last_name' son campos por defecto y siempre existen.
  var campos = {
    name: data.nombre || '',
    last_name: data.apellido || '',
    phone: data.whatsapp || ''
  };
  function set(k, v) {
    if (v === undefined || v === null || v === '' || v === 0) return;
    campos[k] = v;
  }
  set('origen', data.utm_source);                        // instagram, bio, story, whatsapp...
  set('campana', data.utm_campaign);
  set('etapa_funnel', etapa);
  set('que_quiere', data.autocalificacion || data.intencion);
  set('edad', data.edad || data.edad_hoy);
  set('edad_retiro', data.edad_retiro);
  set('meta_mensual_usd', data.meta_usd);
  set('capital_objetivo_usd', data.capital_objetivo_usd);

  var r = _ml('post', '/subscribers', { email: correo, fields: campos, groups: grupo ? [grupo] : [] });

  if (r.code === 200) return 'actualizado';
  if (r.code === 201) return 'creado';
  if (r.code === 401) return 'error 401: token invalido o revocado';
  if (r.code === 422) return 'error 422 (validacion): ' + r.body.slice(0, 200);
  return 'error ' + r.code + ': ' + r.body.slice(0, 200);
}

/**
 * SETUP, correr UNA VEZ: guarda el token de MailerLite en las Propiedades del script.
 * Pega tu token abajo, corre la funcion, y DESPUES borra el token de aca y guarda.
 * Nunca dejes el token escrito en este archivo: el repo es publico.
 */
function guardarTokenMailerLite() {
  // Pega tu token entre las comillas de esta linea, y SOLO de esta linea.
  var TOKEN = 'PEGA_TU_TOKEN_AQUI';

  // La validacion NO compara contra el texto completo del placeholder a proposito: si comparara,
  // un "reemplazar todo" en el editor cambiaria las dos ocurrencias, la condicion daria verdadero
  // siempre y la funcion tiraria el error aunque el token estuviera bien pegado.
  if (!TOKEN || TOKEN.indexOf('PEGA_TU') === 0 || TOKEN.length < 40) {
    throw new Error('Pega tu token de MailerLite en la variable TOKEN (la linea de arriba) antes de correr esto.');
  }
  PropertiesService.getScriptProperties().setProperty('MAILERLITE_TOKEN', TOKEN.trim());
  Logger.log('Token guardado (' + TOKEN.length + ' caracteres). Ahora borra el token de esta');
  Logger.log('funcion, guarda, y corre probarMailerLite() para verificar.');
}

/**
 * DIAGNOSTICO: lista tus grupos de MailerLite con sus IDs y cuanta gente tiene cada uno.
 * Copia los IDs que te interesen a GRUPOS_ML arriba.
 */
function verGruposMailerLite() {
  var r = _ml('get', '/groups?limit=100');
  if (r.code !== 200) {
    Logger.log('Error ' + r.code + ': ' + r.body);
    return;
  }
  var grupos = JSON.parse(r.body).data || [];
  if (!grupos.length) {
    Logger.log('No tenes grupos creados en MailerLite. Podes dejar GRUPOS_ML vacio: los leads');
    Logger.log('entran igual a la lista general y los segmentas despues por el campo "origen".');
    return;
  }
  Logger.log('Tus grupos de MailerLite (pega el ID en GRUPOS_ML):');
  grupos.forEach(function (g) {
    Logger.log('  ID ' + g.id + '  ->  "' + g.name + '"  (' + (g.active_count || 0) + ' activos)');
  });
}

/**
 * PRUEBA: da de alta un correo de prueba en MailerLite con la misma ruta que usa un lead real.
 * Cambia el correo por uno tuyo. Despues borralo desde el panel de MailerLite.
 */
function probarMailerLite() {
  var resultado = _syncMailerLite({
    etapa: 'llamada_solicitada',
    nombre: 'Prueba', apellido: 'MailerLite',
    correo: 'prueba+ml@investorcr.com',      // <- cambialo por un correo tuyo
    whatsapp: '8888-8888',
    utm_source: 'instagram', utm_campaign: 'prueba_manual',
    autocalificacion: 'Acompanamiento',
    edad: 40, edad_retiro: 65,
    meta_usd: 4000, capital_objetivo_usd: 650000
  });
  Logger.log('Resultado: ' + resultado);
  Logger.log('Si dice "creado" o "actualizado", la integracion quedo lista.');
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

  // Red de seguridad: si el template tiene un token que este payload no trae, lo borramos para que
  // el PDF NUNCA muestre un '{{algo}}' crudo. (Pasa cuando cambia el modelo de datos del funnel.)
  _limpiarTokensSobrantes(pres, reporte);

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

/**
 * Borra los tokens del template que ESTE payload no trajo, para que el PDF nunca muestre un
 * '{{algo}}' crudo. OJO: replaceAllText es literal (no acepta regex), por eso vamos con la lista
 * exacta de tokens del template. Si agregas un token nuevo al Slides, agregalo aca tambien.
 */
var TOKENS_TEMPLATE = ['nombre','apellido','fecha','meta_mensual','edad_retiro','pension_total',
  'brecha','vf_mercado','vf_max','total_proyectado','perfil_sugerido','veredicto_texto',
  'perfil_texto','aporte_usd','aportado_total','link_calendly_utm'];

function _limpiarTokensSobrantes(pres, reporte) {
  TOKENS_TEMPLATE.forEach(function (k) {
    if (reporte[k] === undefined || reporte[k] === null || reporte[k] === '') {
      try { pres.replaceAllText('{{' + k + '}}', ''); } catch (e) {}
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTOS DE LA LANDING (/medicos): el embudo completo, en un spreadsheet APARTE
// ─────────────────────────────────────────────────────────────────────────────
// La landing manda lotes {tipo:"eventos", uid, sid, utm_*, ua, eventos:[{ts, seq, ev, valor}]}.
// NO se mezclan con la pestaña Leads: van al spreadsheet "Eventos Landing - Empowered Investor",
// que se crea solo la primera vez (en el Drive de la cuenta duena del script) y cuyo ID queda en
// las Propiedades del script. No lleva datos personales: ids aleatorios, UTM y acciones.
//   Pestaña "Eventos":        una fila por evento, cruda. Es la primera pestaña a proposito,
//                             para poder exportarla como CSV.
//   Pestaña "Embudo diario":  sesiones por dia y origen con cada paso del embudo.
//                             La regenera resumenEmbudoDiario() (a mano o con el trigger).
// SETUP (una vez): nueva version de la implementacion; corre verSheetEventos() para ver el link;
// corre instalarTriggerEmbudo() para que el resumen se actualice solo cada manana a las 6.
var EVENTOS_SHEET_NOMBRE = 'Eventos Landing - Empowered Investor';
var EVENTOS_TZ = 'America/Costa_Rica';
var EVENTOS_HEADERS = ['ts', 'fecha', 'hora', 'uid', 'sid', 'seq', 'ev', 'valor', 'pagina',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer',
  'dispositivo', 'so', 'navegador', 'ancho', 'alto', 'idioma', 'ua'];

function _ssEventos() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('EVENTOS_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* lo borraron: se crea otro */ }
  }
  var ss = SpreadsheetApp.create(EVENTOS_SHEET_NOMBRE);
  var sh = ss.getSheets()[0];
  sh.setName('Eventos');
  sh.getRange(1, 1, 1, EVENTOS_HEADERS.length).setValues([EVENTOS_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  ss.insertSheet('Embudo diario');
  props.setProperty('EVENTOS_SHEET_ID', ss.getId());
  return ss;
}

function _appendEventos(d) {
  var evs = d.eventos || [];
  if (!evs.length) return 0;
  var nav = _parsearUA(d.ua || '');
  var rows = evs.map(function (e) {
    var ts = e.ts || new Date().toISOString();
    var f = new Date(ts);
    if (isNaN(f.getTime())) f = new Date();
    return [ts, Utilities.formatDate(f, EVENTOS_TZ, 'yyyy-MM-dd'), Utilities.formatDate(f, EVENTOS_TZ, 'HH:mm:ss'),
      d.uid || '', d.sid || '', e.seq || '', e.ev || '', e.valor === undefined ? '' : e.valor, d.pagina || '',
      d.utm_source || '', d.utm_medium || '', d.utm_campaign || '', d.utm_content || '', d.utm_term || '',
      d.referrer || '', nav.dispositivo, nav.so, nav.navegador, d.ancho || '', d.alto || '', d.idioma || '',
      String(d.ua || '').slice(0, 200)];
  });
  var sh = _ssEventos().getSheetByName('Eventos');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, EVENTOS_HEADERS.length).setValues(rows);
  return rows.length;
}

function _parsearUA(ua) {
  var so = /iPhone|iPad/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows'
         : /Mac OS/i.test(ua) ? 'macOS' : 'otro';
  var navegador = /Instagram/i.test(ua) ? 'InstagramApp' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'FacebookApp'
         : /CriOS|Chrome/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'otro';
  var dispositivo = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobile|iPhone|Android/i.test(ua) ? 'movil' : 'escritorio';
  return { so: so, navegador: navegador, dispositivo: dispositivo };
}

/** Reconstruye "Embudo diario": una fila por dia y origen (ig, fb, ...) mas una fila "todos" por dia. */
function resumenEmbudoDiario() {
  var ss = _ssEventos();
  var sh = ss.getSheetByName('Eventos');
  var last = sh.getLastRow();
  var H = {}; EVENTOS_HEADERS.forEach(function (h, i) { H[h] = i; });
  var ses = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, EVENTOS_HEADERS.length).getValues().forEach(function (r) {
      var sid = r[H.sid]; if (!sid) return;
      var s = ses[sid] || (ses[sid] = { fecha: r[H.fecha], origen: r[H.utm_source] || 'directo',
        autoplay: 0, sonido: 0, p25: 0, p50: 0, p75: 0, p100: 0, form: 0, cta: 0, lead: 0, wa: 0, scroll: 0, seg: 0, video_seg: 0 });
      var ev = r[H.ev], v = String(r[H.valor] === undefined ? '' : r[H.valor]);
      if (ev === 'vsl_autoplay' || ev === 'vsl_play') s.autoplay = 1;
      else if (ev === 'vsl_sonido') s.sonido = 1;
      else if (ev === 'vsl_progreso') { var p = Number(v); if (p >= 25) s.p25 = 1; if (p >= 50) s.p50 = 1; if (p >= 75) s.p75 = 1; if (p >= 100) s.p100 = 1; }
      else if (ev === 'form_visible') s.form = 1;
      else if (ev === 'click_agendar') s.cta = 1;
      else if (ev === 'medicos_lead') s.lead = 1;
      else if (ev === 'lead_whatsapp_abierto') s.wa = 1;
      else if (ev === 'scroll') s.scroll = Math.max(s.scroll, Number(v) || 0);
      else if (ev === 'salida') {
        try {
          var o = JSON.parse(v);
          s.seg = Math.max(s.seg, Number(o.seg) || 0); s.scroll = Math.max(s.scroll, Number(o.scroll) || 0);
          s.video_seg = Math.max(s.video_seg, Number(o.video_seg) || 0); if (o.sonido) s.sonido = 1;
        } catch (e2) {}
      }
    });
  }
  var FLAGS = ['autoplay', 'sonido', 'p25', 'p50', 'p75', 'p100', 'form', 'cta', 'lead', 'wa'];
  var agg = {};
  function sumar(k, s) {
    var a = agg[k] || (agg[k] = { n: 0, scroll: 0, seg: 0, video_seg: 0 });
    a.n++; FLAGS.forEach(function (f) { a[f] = (a[f] || 0) + s[f]; });
    a.scroll += s.scroll; a.seg += s.seg; a.video_seg += s.video_seg;
  }
  Object.keys(ses).forEach(function (sid) { var s = ses[sid]; sumar(s.fecha + '|' + s.origen, s); sumar(s.fecha + '|todos', s); });
  var head = ['fecha', 'origen', 'sesiones', 'video arranco', 'activo sonido', 'vio 25%', 'vio 50%', 'vio 75%', 'vio 100%',
    'vio el formulario', 'toco agendar', 'leads', 'abrio WhatsApp', 'scroll prom %', 'seg en pagina prom', 'seg de video prom'];
  var out = Object.keys(agg).sort().map(function (k) {
    var a = agg[k], p = k.split('|');
    return [p[0], p[1], a.n, a.autoplay, a.sonido, a.p25, a.p50, a.p75, a.p100, a.form, a.cta, a.lead, a.wa,
      Math.round(a.scroll / a.n), Math.round(a.seg / a.n), Math.round(a.video_seg / a.n)];
  });
  var sr = ss.getSheetByName('Embudo diario') || ss.insertSheet('Embudo diario');
  sr.clearContents();
  sr.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sr.setFrozenRows(1);
  if (out.length) sr.getRange(2, 1, out.length, head.length).setValues(out);
  Logger.log('Embudo diario: ' + out.length + ' filas a partir de ' + Object.keys(ses).length + ' sesiones. ' + ss.getUrl());
}

/** Una vez: el resumen se regenera solo cada manana a las 6 (hora del script). */
function instalarTriggerEmbudo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'resumenEmbudoDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('resumenEmbudoDiario').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Trigger diario instalado. Spreadsheet: ' + _ssEventos().getUrl());
}

/** Muestra en el registro el link del spreadsheet de eventos (lo crea si todavia no existe). */
function verSheetEventos() {
  Logger.log('Eventos Landing: ' + _ssEventos().getUrl());
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
