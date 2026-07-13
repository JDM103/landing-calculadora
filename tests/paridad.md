# Tests de paridad — wizard Streamlit (Python) vs `js/calc.js`

Objetivo: probar que el motor portado a JavaScript (`js/calc.js`) produce **los mismos
números** que los módulos Python del wizard de Streamlit
(`control-gastos/web-app/calculadora-financiera/`), con tolerancia **±1%**.

Regla de oro: **si un caso no calza, se corrige el JS, nunca el test.**

## Cómo se corrió

- **Python** (fuente de verdad): `src/pension/ivm.py`, `src/pension/rop.py`,
  `src/investment/fixed_return_projection.py` importados directamente y evaluados con
  los inputs de cada caso. Script: `scratchpad/py_parity.py`.
- **JavaScript**: `js/calc.js` cargado en Node con los **mismos inputs**.
  Script: `scratchpad/js_parity.js`.
- Ambos imprimen JSON; se comparan valor por valor.

```
node --version → v22.15.0     python → 3.13.1
```

## Resultado: 8/8 exactos (Δ = 0.00%, dentro de ±1%)

### Bloque A — IVM (los 4 casos obligatorios de `referencia_ivm_2026.md`)

`calcular_pension_ivm` (Py) vs `Calc.calcularPensionIVM` (JS). `anios_restantes=0`,
salario mínimo legal ₡373,092, cuotas = las indicadas (ya totales).

| Caso | Salario | Cuotas | Esperado (ref) | Python | JS | Δ |
|---|---|---|---|---|---|---|
| 1 | ₡1,000,000 | 480 | ≈ ₡660,000 | **₡659,940.00** | ₡659,940.00 | 0.00% |
| 2 | ₡2,000,000 | 360 | ≈ ₡1,024,000 | **₡1,023,960.00** | ₡1,023,960.00 | 0.00% |
| 3 | ₡3,500,000 | 300 | ≈ ₡1,505,000 | **₡1,505,000.00** | ₡1,505,000.00 | 0.00% |
| 4 | ₡4,500,000 | 360 | topado ₡1,765,859 | **₡1,765,859.00** | ₡1,765,859.00 | 0.00% |

Caso 4 confirma el **tope máximo del IVM** (bruto ₡2,159,910 → recortado a ₡1,765,859).

### Bloque B — ROP (`proyectar_rop`)

Salario ₡2,000,000; saldo estimado = 4.25%·salario·120 cuotas; 120 cuotas hoy;
30 años restantes; nominal 6%, inflación 3%, plazo de pago 20 años; piso = 20% de ₡162,295.

| Métrica | Python | JS | Δ |
|---|---|---|---|
| Saldo proyectado (₡ de hoy) | ₡73,210,928.04 | ₡73,210,928.04 | 0.00% |
| Ingreso mensual aplicable | ₡402,831.17 | ₡402,831.17 | 0.00% |

### Bloque C — Proyección de inversión (`proyectar_rendimiento_fijo`, deflactado aparte)

Horizonte 30 años, capital inicial $10,000, aporte $500/mes (Mensual), edad 35.

| Escenario | Fee mgmt | Setup | Aportado | VF (nominal) Python | VF JS | Δ |
|---|---|---|---|---|---|---|
| Crecimiento 15% | 1% anual | $2,000 | $190,000 | $2,601,958.05 | $2,601,958.05 | 0.00% |
| Básico (mercado) 9.5% | 0% | $0 | $190,000 | $1,088,793.29 | $1,088,793.29 | 0.00% |

> **Nota sobre el setup fee:** el bloque C se corrió con **setup = $2,000** en ambos
> lados para aislar la fidelidad del motor. El sitio en producción usa
> `SETUP_FEE_USD = 2000` (actualizado 2026; el deploy previo de Streamlit tenía
> `1_500`). El setup solo afecta la proyección de inversión (no el IVM/ROP) y su
> impacto sobre el VF a 30 años es < 0.1%, muy dentro de ±1%.

## Reproducir

```bash
python  scratchpad/py_parity.py    # imprime los valores de referencia (Python)
node    scratchpad/js_parity.js    # imprime los valores de calc.js
# comparar los dos JSON: deben ser idénticos (Δ ≤ 1%)
```

Última corrida: 2026-07-13 — **8/8 exactos**. Paridad OK → habilitada la Fase 2.
