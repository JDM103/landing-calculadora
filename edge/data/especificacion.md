# Especificación de la regla A2 (para reproducirla con cualquier herramienta o IA)

## Datos
- Precios: cierre diario y cierre ajustado de QQQ (desde 1999-03) y SPY (desde 1993-01), Yahoo Finance. Archivos: `qqq_precios_yahoo.csv`, `spy_precios_yahoo.csv`. La señal se calcula con la columna `Close`; los retornos con `Adj Close` (incluye dividendos).
- Efectivo: T-bill a 3 meses, serie DTB3 de FRED (`tbill_3m_fred_dtb3.csv`), en porcentaje anual. Retorno diario del efectivo: `(1 / (1 - y/100 * 91/360)) ^ (días_calendario/91) - 1`, usando la tasa conocida el día anterior.

## Indicador 1: media móvil con banda
- `SMA200(t)` = promedio simple de los últimos 200 cierres, incluido el de hoy.
- Estado inicial: dentro.
- Si está dentro y `Cierre(t) < SMA200(t) × 0.97` → pasa a fuera.
- Si está fuera y `Cierre(t) > SMA200(t) × 1.03` → pasa a dentro.
- En cualquier otro caso mantiene el estado.

## Indicador 2: distancia al máximo
- `Max39(t)` = máximo de los últimos 195 cierres (39 semanas × 5), incluido el de hoy.
- `Dist(t) = Cierre(t) / Max39(t) - 1` (siempre ≤ 0).
- Estado inicial: dentro.
- Si está dentro y `Dist(t) < -0.12` → pasa a fuera.
- Si está fuera y `Dist(t) >= -0.06` → pasa a dentro.

## Señal A2
- `A2(t) = 1` si ambos indicadores están dentro; `0` si alguno está fuera.
- Variante AVG: `A2(t) = (ind1 + ind2) / 2`, es decir 0, 0.5 o 1.

## Señal B (objetivo de volatilidad) y C2
- `Vol60(t)` = desviación estándar de los últimos 60 retornos diarios × √252.
- `B_bruto(t) = mín(1, 0.12 / Vol60(t))`.
- `B(t)` = `B_bruto(t)` solo si difiere del último `B` fijado en 5 puntos o más; si no, se mantiene el anterior.
- `C2(t) = A2(t) × B(t)`.

## Ejecución
- La señal calculada con el cierre del día `t` se ejecuta al cierre del día `t+1`. La posición que gana el retorno del día `t+2` es la señal de `t`. En pandas: `posicion = señal.shift(2)`.
- Retorno diario de la estrategia: `posición × retorno_ETF + (1 - posición) × retorno_tbill - |Δposición| × 0.0005` (5 puntos básicos por cada unidad de peso cambiada).

## Métricas
- CAGR: `(capital_final)^(252 / días) - 1`.
- Volatilidad: desviación estándar de los retornos diarios × √252.
- Sharpe: media de (retorno - tbill) dividida por la desviación estándar de (retorno - tbill), × √252.
- Caída máxima: mínimo de `capital / máximo acumulado - 1`.

## Períodos
- QQQ completo: 2000-04-04 a 2026-09-18. SPY completo: 1994-03-01 a 2026-09-18.
- Subperíodos: 2000-04-04 a 2009-12-31; 2010-01-01 a 2019-12-31; 2016-09-19 a 2026-09-18.

## Archivos con el cálculo ya hecho
- `qqq_diario.csv`, `spy_diario.csv`: por día, cierre, SMA200 y sus bandas, máximo de 39 semanas y sus umbrales, estado de cada indicador, señales A2, B y C2, posiciones vigentes y retornos diarios del ETF, del T-bill y de cada estrategia.
- `qqq_anual.csv`, `spy_anual.csv`: retorno por año calendario.
- `qqq_malla_960.csv`, `spy_malla_960.csv`: las 960 combinaciones de parámetros probadas, con Sharpe, CAGR y caída por período.
- `resumen.json`: todas las cifras de la página.
