/* =============================================================================
 * calc.js — Motor de cálculo compartido del funnel de retiro (Empowered Investor)
 *
 * Portado 1:1 desde el wizard de Streamlit (Calculadora_de_Retiro_Lead_Magnet.py
 * y sus módulos src/pension/{ivm,rop}.py, src/investment/fixed_return_projection.py,
 * src/finance/annuity.py). La paridad numérica con el Python está verificada en
 * tests/paridad.md (±1%, incluidos los 4 casos del IVM de referencia_ivm_2026.md).
 *
 * MONEDAS: la INVERSIÓN vive en dólares; la PENSIÓN ESTATAL y la META en colones.
 * Se convierten con el tipo de cambio (tc) que el usuario define en el Paso 1.
 *
 * Uso en navegador:  <script src="js/calc.js"></script>  → window.Calc
 * Uso en Node:       const Calc = require('./js/calc.js')  (para los tests)
 * ========================================================================== */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.Calc = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // CONFIGURACIÓN (espejo de las constantes del wizard de Streamlit)
  // ---------------------------------------------------------------------------
  var CFG = {
    // Regulatorios IVM/ROP 2026 (única fuente de verdad: src/pension/*)
    SALARIO_MINIMO_LEGAL: 373092.0,          // Decreto 45303-MTSS, 2026
    MONTO_MINIMO_DEFAULT: 162295.0,          // pensión mínima IVM 2026
    MONTO_MAXIMO_DEFAULT: 1765859.0,         // tope máximo IVM 2026
    CUOTAS_MINIMAS_ORDINARIA: 300,
    CUOTAS_MINIMAS_PROPORCIONAL: 180,
    INCREMENTO_PCT_POR_CUOTA_EXTRA: 0.0833,
    INCREMENTO_PCT_POR_MES_POSTERGACION: 0.1333,
    TOPE_PCT_CON_POSTERGACION: 125.0,

    APORTE_ROP_PCT: 4.25,
    PISO_PCT_SOBRE_PENSION_MINIMA_IVM: 20.0,
    FECHA_CORTE_TRANSITORIO: new Date(Date.UTC(2030, 1, 19)), // 2030-02-19
    ROP_NOMINAL_PCT: 6.0,
    ROP_PLAZO_PAGO_ANIOS: 20.0,
    ROP_ANIO_INICIO: 2000,

    // Inversión
    INFLACION_PCT: 3.0,
    TASA_MERCADO_PCT: 9.5,                    // S&P 500 nominal a largo plazo (~6.5% real) → Portafolio Básico
    TASA_ACTIVA_MIN_PCT: 12.0,               // Portafolio de Crecimiento (piso del rango)
    TASA_ACTIVA_MAX_PCT: 15.0,               // Portafolio de Crecimiento (tope del rango)
    FEE_ANUAL_PCT: 1.0,                       // management fee anual
    SETUP_FEE_USD: 2000.0,                    // fee único inicial en US$ (valor actualizado 2026)
    TASA_RETIRO_CLASICA_PCT: 4.0,            // regla del 4%
    SJC_TASA_PCT: 8.0,                        // ingreso pasivo (alianza San José Capital)
    TC_DEFAULT: 460.0,

    // Calificación del lead
    CAPITAL_CALIFICADO: 10000,
    APORTE_CALIFICADO: 500,
    HORIZONTE_CALIFICADO: 10,
    CALIFICA_TAMBIEN_POR_FLUJO: true,
  };

  // Tabla de cuantía básica (art. 24): [límite superior del tramo (múltiplos del
  // salario mínimo) | null = "8 o más", cuantía básica %].
  var TABLA_CUANTIA_BASICA = [
    [2.0, 52.5], [3.0, 51.0], [4.0, 49.4], [5.0, 47.8],
    [6.0, 46.2], [8.0, 44.6], [null, 43.0],
  ];

  // ---------------------------------------------------------------------------
  // IVM  (port de src/pension/ivm.py)
  // ---------------------------------------------------------------------------
  function cuantiaBasicaPct(salarioPromedio, salarioMinimoLegal) {
    if (salarioMinimoLegal <= 0) return TABLA_CUANTIA_BASICA[TABLA_CUANTIA_BASICA.length - 1][1];
    var ratio = salarioPromedio / salarioMinimoLegal;
    for (var i = 0; i < TABLA_CUANTIA_BASICA.length; i++) {
      var limite = TABLA_CUANTIA_BASICA[i][0], pct = TABLA_CUANTIA_BASICA[i][1];
      if (limite === null || ratio < limite) return pct;
    }
    return TABLA_CUANTIA_BASICA[TABLA_CUANTIA_BASICA.length - 1][1];
  }

  function calcularPensionIVM(opts) {
    var salarioPromedio = opts.salarioPromedioReferencia;
    var cuotasHoy = opts.cuotasIvmHoy;
    var aniosRestantes = opts.aniosRestantes;
    var salarioMinimo = opts.salarioMinimoLegal != null ? opts.salarioMinimoLegal : CFG.SALARIO_MINIMO_LEGAL;
    var mesesPostergacion = opts.mesesPostergacion || 0;
    var montoMinimo = opts.montoMinimo != null ? opts.montoMinimo : CFG.MONTO_MINIMO_DEFAULT;
    var montoMaximo = opts.montoMaximo != null ? opts.montoMaximo : CFG.MONTO_MAXIMO_DEFAULT;

    var mesesFuturos = Math.max(0, aniosRestantes) * 12;
    var cuotasTotales = Math.trunc(cuotasHoy + mesesFuturos);
    var basicaPct = cuantiaBasicaPct(salarioPromedio, salarioMinimo);

    if (cuotasTotales < CFG.CUOTAS_MINIMAS_PROPORCIONAL) {
      return {
        cumpleRequisitos: false,
        motivo: "Con " + cuotasTotales + " cuotas no se alcanza el mínimo de " +
          CFG.CUOTAS_MINIMAS_PROPORCIONAL + " cuotas para una vejez proporcional.",
        esProporcional: false, cuotasTotales: cuotasTotales, cuantiaBasicaPct: basicaPct,
        cuantiaAdicionalPct: 0.0, incrementoPostergacionPct: 0.0, porcentajeReconocido: 0.0,
        factorProporcional: 0.0, montoBruto: 0.0, montoMensual: 0.0,
      };
    }

    var adicionalPct, incrementoPostergacionPct, porcentajeReconocido, montoBruto,
      factorProporcional, esProporcional, motivo;

    if (cuotasTotales >= CFG.CUOTAS_MINIMAS_ORDINARIA) {
      var cuotasExtra = cuotasTotales - CFG.CUOTAS_MINIMAS_ORDINARIA;
      adicionalPct = cuotasExtra * CFG.INCREMENTO_PCT_POR_CUOTA_EXTRA;
      incrementoPostergacionPct = mesesPostergacion * CFG.INCREMENTO_PCT_POR_MES_POSTERGACION;
      porcentajeReconocido = Math.min(basicaPct + adicionalPct + incrementoPostergacionPct, CFG.TOPE_PCT_CON_POSTERGACION);
      montoBruto = salarioPromedio * porcentajeReconocido / 100.0;
      factorProporcional = 1.0;
      esProporcional = false;
      motivo = "Cumple los requisitos de vejez ordinaria (300 cuotas o más).";
    } else {
      adicionalPct = 0.0;
      incrementoPostergacionPct = 0.0;
      porcentajeReconocido = basicaPct;
      factorProporcional = cuotasTotales / CFG.CUOTAS_MINIMAS_ORDINARIA;
      var pensionCompleta = salarioPromedio * basicaPct / 100.0;
      montoBruto = pensionCompleta * factorProporcional;
      esProporcional = true;
      motivo = "Vejez proporcional: " + cuotasTotales + " cuotas (" +
        Math.round(factorProporcional * 100) + "% de la pensión completa).";
    }

    var montoMensual = Math.max(montoMinimo, Math.min(montoBruto, montoMaximo));

    return {
      cumpleRequisitos: true, motivo: motivo, esProporcional: esProporcional,
      cuotasTotales: cuotasTotales, cuantiaBasicaPct: basicaPct, cuantiaAdicionalPct: adicionalPct,
      incrementoPostergacionPct: incrementoPostergacionPct, porcentajeReconocido: porcentajeReconocido,
      factorProporcional: factorProporcional, montoBruto: montoBruto, montoMensual: montoMensual,
    };
  }

  // ---------------------------------------------------------------------------
  // ROP  (port de src/pension/rop.py)
  // ---------------------------------------------------------------------------
  function tasaRealAnualPct(rentabilidadNominalPct, inflacionPct) {
    return ((1.0 + rentabilidadNominalPct / 100.0) / (1.0 + inflacionPct / 100.0) - 1.0) * 100.0;
  }

  function _valorFuturo(saldoActual, aporteMensual, tasaMensual, meses) {
    if (meses <= 0) return saldoActual;
    if (tasaMensual === 0) return saldoActual + aporteMensual * meses;
    var crecimiento = Math.pow(1.0 + tasaMensual, meses);
    return saldoActual * crecimiento + aporteMensual * (crecimiento - 1.0) / tasaMensual;
  }

  function _pagoAnualidad(valorFuturo, tasaMensual, meses) {
    if (meses <= 0) return 0.0;
    if (tasaMensual === 0) return valorFuturo / meses;
    return valorFuturo * tasaMensual / (1.0 - Math.pow(1.0 + tasaMensual, -meses));
  }

  function proyectarRop(opts) {
    var salarioBruto = opts.salarioBrutoActual;
    var saldoActualRop = opts.saldoActualRop;
    var cuotasRopHoy = opts.cuotasRopHoy;
    var aniosRestantes = opts.aniosRestantes;
    var rentabilidadNominalPct = opts.rentabilidadNominalPct;
    var inflacionPct = opts.inflacionPct;
    var plazoPagoAnios = opts.plazoPagoAnios;
    var montoMinimoIvm = opts.montoMinimoIvm;
    var fechaRetiro = opts.fechaRetiroEstimada;

    var hoy = new Date();
    if (!fechaRetiro) {
      fechaRetiro = new Date(Date.UTC(hoy.getFullYear() + Math.max(0, aniosRestantes), hoy.getMonth(), 1));
    }

    var mesesFuturos = Math.max(0, aniosRestantes) * 12;
    var cuotasRopAlRetiro = Math.trunc(cuotasRopHoy + mesesFuturos);

    var aporteMensual = salarioBruto * CFG.APORTE_ROP_PCT / 100.0;
    var rentabilidadRealPct = tasaRealAnualPct(rentabilidadNominalPct, inflacionPct);
    var tasaMensual = rentabilidadRealPct / 100.0 / 12.0;

    var saldoProyectado = _valorFuturo(saldoActualRop, aporteMensual, tasaMensual, mesesFuturos);
    var ingresoTransitorio = cuotasRopAlRetiro > 0 ? saldoProyectado / cuotasRopAlRetiro : 0.0;

    var mesesPago = Math.max(1, Math.round(plazoPagoAnios * 12));
    var ingresoAnualidad = _pagoAnualidad(saldoProyectado, tasaMensual, mesesPago);

    var modalidad = fechaRetiro < CFG.FECHA_CORTE_TRANSITORIO ? "transitoria" : "anualidad";
    var ingresoAplicable = modalidad === "transitoria" ? ingresoTransitorio : ingresoAnualidad;

    var piso = montoMinimoIvm * CFG.PISO_PCT_SOBRE_PENSION_MINIMA_IVM / 100.0;
    ingresoAplicable = Math.max(ingresoAplicable, piso);

    return {
      modalidadAplicable: modalidad, fechaRetiroEstimada: fechaRetiro, saldoProyectado: saldoProyectado,
      aporteMensual: aporteMensual, rentabilidadRealAnualPct: rentabilidadRealPct,
      cuotasRopAlRetiro: cuotasRopAlRetiro, ingresoMensualTransitorio: ingresoTransitorio,
      ingresoMensualAnualidad: ingresoAnualidad, ingresoMensualAplicable: ingresoAplicable,
      pisoPensionMinima: piso,
    };
  }

  // ---------------------------------------------------------------------------
  // PROYECCIÓN DE INVERSIÓN  (port de src/investment/fixed_return_projection.py + annuity.py)
  // ---------------------------------------------------------------------------
  var FREQ_TO_MONTHS = { "Mensual": 1, "Trimestral": 3, "Semestral": 6, "Anual": 12, "Cada 2 años": 24, "Cada 3 años": 36 };

  function monthlyRateFromAnnual(annualRate) {
    return Math.pow(1.0 + annualRate, 1.0 / 12.0) - 1.0;
  }

  function proyectarRendimientoFijo(opts) {
    var anios = opts.anios;
    var rendimientoAnualPct = opts.rendimientoAnualPct;
    var aporteInicial = opts.aporteInicial || 0;
    var aportePeriodico = opts.aportePeriodico || 0;
    var frecuencia = opts.frecuencia || "Mensual";
    var edadActual = opts.edadActual;
    var setupFee = opts.setupFee || 0.0;
    var costoSwift = opts.costoSwift || 0.0;
    var managementFeeAnualPct = opts.managementFeeAnualPct || 0.0;
    var anioActual = opts.anioActual != null ? opts.anioActual : new Date().getFullYear();
    var mesesSinManagement = opts.mesesSinManagement || 0;

    var meses = Math.max(1, anios * 12);
    var everyN = FREQ_TO_MONTHS[frecuencia] != null ? FREQ_TO_MONTHS[frecuencia] : 1;
    var rMonth = monthlyRateFromAnnual(rendimientoAnualPct / 100.0);
    var feeManejoMensual = managementFeeAnualPct / 100.0 / 12.0;

    var costoSetup = Math.max(0.0, setupFee);
    var comisionesSwiftCum = 0.0;
    var comisionesManejoCum = 0.0;
    var numeroTransferencias = 0;
    var balance;

    if (aporteInicial > 0) {
      comisionesSwiftCum += costoSwift;
      numeroTransferencias += 1;
      balance = Math.max(0.0, aporteInicial - costoSwift - costoSetup);
    } else {
      balance = 0.0;
    }

    var aportadoBrutoCum = aporteInicial;
    var costosServicioCum = costoSetup + comisionesSwiftCum;
    var puntos = [{ anioIndex: 0, anioCalendario: anioActual, edadCliente: edadActual, aportadoBrutoCum: aportadoBrutoCum, balance: balance }];

    for (var m = 1; m <= meses; m++) {
      balance *= (1.0 + rMonth);
      var feeMes = m > mesesSinManagement ? balance * feeManejoMensual : 0.0;
      balance -= feeMes;
      comisionesManejoCum += feeMes;
      costosServicioCum += feeMes;

      if (aportePeriodico > 0 && (everyN <= 1 || m % everyN === 0)) {
        var montoNeto = Math.max(0.0, aportePeriodico - costoSwift);
        balance += montoNeto;
        aportadoBrutoCum += aportePeriodico;
        comisionesSwiftCum += costoSwift;
        costosServicioCum += costoSwift;
        numeroTransferencias += 1;
      }

      if (m % 12 === 0) {
        var anioIdx = m / 12;
        puntos.push({ anioIndex: anioIdx, anioCalendario: anioActual + anioIdx, edadCliente: edadActual + anioIdx, aportadoBrutoCum: aportadoBrutoCum, balance: balance });
      }
    }

    var valorFinal = puntos[puntos.length - 1].balance;
    return {
      puntos: puntos, valorFinal: valorFinal, aportadoBrutoTotal: aportadoBrutoCum,
      costoSetup: costoSetup, comisionesSwiftTotales: comisionesSwiftCum,
      comisionesManejoTotales: comisionesManejoCum, costosServicioTotales: costosServicioCum,
      numeroTransferencias: numeroTransferencias, rendimientoGenerado: valorFinal - aportadoBrutoCum,
    };
  }

  // ---------------------------------------------------------------------------
  // DECUMULACIÓN  (port de src/investment/decumulation.py) — para escenarios de retiro
  // ---------------------------------------------------------------------------
  function simularDecumulacion(opts) {
    var valorInicial = opts.valorInicial;
    var tasaRetiroAnualPct = opts.tasaRetiroAnualPct;
    var crecimientoAnualPct = opts.crecimientoAnualPct;
    var edadInicio = opts.edadInicio;
    var anioInicio = opts.anioCalendarioInicio;
    var horizonte = opts.horizonteAnios != null ? opts.horizonteAnios : 50;
    var TOL = 1e-9;

    var retiroAnual = valorInicial * tasaRetiroAnualPct / 100.0;
    var balance = valorInicial;
    var puntos = [{ anioIndex: 0, anioCalendario: anioInicio, edadCliente: edadInicio, balance: balance }];
    var anioAgotamiento = null;

    for (var anio = 1; anio <= horizonte; anio++) {
      balance = balance * (1.0 + crecimientoAnualPct / 100.0) - retiroAnual;
      if (balance <= 0) {
        puntos.push({ anioIndex: anio, anioCalendario: anioInicio + anio, edadCliente: edadInicio + anio, balance: 0.0 });
        anioAgotamiento = anio;
        break;
      }
      puntos.push({ anioIndex: anio, anioCalendario: anioInicio + anio, edadCliente: edadInicio + anio, balance: balance });
    }

    var diferencia = crecimientoAnualPct - tasaRetiroAnualPct;
    var tendencia = diferencia > TOL ? "crece" : (diferencia < -TOL ? "decrece" : "estable");
    return { puntos: puntos, retiroAnual: retiroAnual, tendencia: tendencia, anioAgotamiento: anioAgotamiento, seAgota: anioAgotamiento !== null };
  }

  // ---------------------------------------------------------------------------
  // ORQUESTACIÓN  (port de pension_estado() y calcular() del wizard)
  // ---------------------------------------------------------------------------
  function _tc(d) {
    var v = parseFloat(d.tc);
    return v && v > 0 ? v : CFG.TC_DEFAULT;
  }

  function pensionEstado(d) {
    var salario = parseFloat(d.salario) || 0;
    var cuotasCot = parseInt(d.cuotas_cot, 10) || 0;
    var saldoRop = parseFloat(d.saldo_rop) || 0;
    var sinEstado = !!d.sin_estado;
    var anios = Math.max(1, (parseInt(d.edad_ret, 10) || 65) - (parseInt(d.edad_hoy, 10) || 35));

    if (sinEstado || salario <= 0) {
      return { pensionTotal: 0.0, ivmMonto: 0.0, ropMonto: 0.0, cumpleIvm: true, ivmObj: null, ropObj: null };
    }

    var ivm = calcularPensionIVM({
      salarioPromedioReferencia: salario, cuotasIvmHoy: cuotasCot, aniosRestantes: anios,
      salarioMinimoLegal: CFG.SALARIO_MINIMO_LEGAL, mesesPostergacion: 0,
      montoMinimo: CFG.MONTO_MINIMO_DEFAULT, montoMaximo: CFG.MONTO_MAXIMO_DEFAULT,
    });
    var ivmMonto = ivm.cumpleRequisitos ? ivm.montoMensual : 0.0;

    var cuotasRopMax = Math.max(0, new Date().getFullYear() - CFG.ROP_ANIO_INICIO) * 12;
    var cuotasRopHoy = Math.min(cuotasCot, cuotasRopMax);
    if (saldoRop <= 0) {
      saldoRop = salario * CFG.APORTE_ROP_PCT / 100.0 * cuotasRopHoy;
    }
    var rop = proyectarRop({
      salarioBrutoActual: salario, saldoActualRop: saldoRop, cuotasRopHoy: cuotasRopHoy,
      aniosRestantes: anios, rentabilidadNominalPct: CFG.ROP_NOMINAL_PCT, inflacionPct: CFG.INFLACION_PCT,
      plazoPagoAnios: CFG.ROP_PLAZO_PAGO_ANIOS, montoMinimoIvm: CFG.MONTO_MINIMO_DEFAULT,
    });
    return {
      pensionTotal: ivmMonto + rop.ingresoMensualAplicable, ivmMonto: ivmMonto,
      ropMonto: rop.ingresoMensualAplicable, cumpleIvm: ivm.cumpleRequisitos, ivmObj: ivm, ropObj: rop,
    };
  }

  function calcular(d) {
    var tc = _tc(d);
    var edadHoy = parseInt(d.edad_hoy, 10);
    var edadRet = parseInt(d.edad_ret, 10);
    var anios = Math.max(1, edadRet - edadHoy);
    var desired = parseFloat(d.ingreso_deseado);           // ₡/mes
    var capital = parseFloat(d.capital) || 0;              // US$
    var aporte = parseFloat(d.aporte) || 0;               // US$
    var sinEstado = !!d.sin_estado;

    var pe = pensionEstado(d);
    var pensionEstatal = pe.pensionTotal;

    function proj(rate, fee) {
      return proyectarRendimientoFijo({
        anios: anios, rendimientoAnualPct: rate, aporteInicial: capital, aportePeriodico: aporte,
        frecuencia: "Mensual", edadActual: edadHoy, managementFeeAnualPct: fee,
        setupFee: fee ? CFG.SETUP_FEE_USD : 0.0,
      });
    }
    function defl(v) { return v / Math.pow(1.0 + CFG.INFLACION_PCT / 100.0, anios); }
    function ingresoHoy(vf, tasa) { return defl(vf) * tasa / 100.0 / 12.0; }   // US$/mes en valor de hoy
    function serieBal(res) { return res.puntos.map(function (p) { return [p.edadCliente, defl(p.balance)]; }); }

    var rMkt = proj(CFG.TASA_MERCADO_PCT, 0.0);
    var rMin = proj(CFG.TASA_ACTIVA_MIN_PCT, CFG.FEE_ANUAL_PCT);
    var rMax = proj(CFG.TASA_ACTIVA_MAX_PCT, CFG.FEE_ANUAL_PCT);

    var vfMkt = defl(rMkt.valorFinal), vfMin = defl(rMin.valorFinal), vfMax = defl(rMax.valorFinal);
    var aportado = defl(rMkt.puntos[rMkt.puntos.length - 1].aportadoBrutoCum);
    var serieAportado = rMkt.puntos.map(function (p) { return [p.edadCliente, defl(p.aportadoBrutoCum)]; });

    var ingActMin = ingresoHoy(rMin.valorFinal, CFG.TASA_RETIRO_CLASICA_PCT);
    var ingActMax = ingresoHoy(rMax.valorFinal, CFG.TASA_RETIRO_CLASICA_PCT);
    var ingSjcMin = ingresoHoy(rMin.valorFinal, CFG.SJC_TASA_PCT);
    var ingSjcMax = ingresoHoy(rMax.valorFinal, CFG.SJC_TASA_PCT);

    var brecha = Math.max(0.0, desired - pensionEstatal);
    var brechaPct = desired <= 0 ? 0.0 : brecha / desired * 100.0;
    var brechaUsd = brecha / tc;

    var ratio = brecha / Math.max(desired, 1);
    var perfil;
    if (anios >= 15 && ratio >= 0.5) perfil = "Crecimiento";
    else if (anios >= 10 && ratio >= 0.25) perfil = "Balanceado";
    else perfil = "Conservador";

    var totalMin = pensionEstatal + ingActMin * tc;       // piso (4%, tope bajo)
    var totalMax = pensionEstatal + ingSjcMax * tc;       // tope (8%, tope alto)

    return {
      anios: anios, edadRet: edadRet, desired: desired, pensionEstatal: pensionEstatal,
      ivmMonto: pe.ivmMonto, ropMonto: pe.ropMonto, cumpleIvm: pe.cumpleIvm,
      brecha: brecha, brechaPct: brechaPct, brechaUsd: brechaUsd, perfil: perfil,
      vfMkt: vfMkt, vfMin: vfMin, vfMax: vfMax, aportado: aportado,
      ingActMin: ingActMin, ingActMax: ingActMax, ingSjcMin: ingSjcMin, ingSjcMax: ingSjcMax,
      totalMin: totalMin, totalMax: totalMax,
      meta4Usd: brechaUsd * 12 * 25, meta8Usd: brechaUsd * 12 * 12.5,
      serieMarket: serieBal(rMkt), serieA15: serieBal(rMax), serieA12: serieBal(rMin), serieAportado: serieAportado,
      capital: capital, aporte: aporte, sinEstado: sinEstado,
      ivmObj: pe.ivmObj, ropObj: pe.ropObj, salario: parseFloat(d.salario) || 0, cuotasCot: parseInt(d.cuotas_cot, 10) || 0,
      tc: tc,
    };
  }

  function califica(r) {
    var capOk = (r.capital >= CFG.CAPITAL_CALIFICADO)
      || (CFG.CALIFICA_TAMBIEN_POR_FLUJO && (r.capital + r.aporte * 12 >= CFG.CAPITAL_CALIFICADO))
      || (r.aporte >= CFG.APORTE_CALIFICADO);
    return capOk && (r.anios >= CFG.HORIZONTE_CALIFICADO);
  }

  return {
    CFG: CFG,
    cuantiaBasicaPct: cuantiaBasicaPct,
    calcularPensionIVM: calcularPensionIVM,
    tasaRealAnualPct: tasaRealAnualPct,
    proyectarRop: proyectarRop,
    monthlyRateFromAnnual: monthlyRateFromAnnual,
    proyectarRendimientoFijo: proyectarRendimientoFijo,
    simularDecumulacion: simularDecumulacion,
    pensionEstado: pensionEstado,
    calcular: calcular,
    califica: califica,
  };
});
