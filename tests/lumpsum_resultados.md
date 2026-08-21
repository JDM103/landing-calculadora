# ¿Qué hacer con $60k de entrada? · Resultados del test

Cliente: $60,000 hoy + $5,000/mes · glide 70/100/70 TQQQ→SPY→SJC · costos incluidos (SWIFT $65, setup $2,000, 1%/año en el sleeve de mercado). Ventanas semanales de arranque sobre toda la historia del motor.

**Datos cargados:** pxdata.js tiene **1,905 semanas, de 1990.01 a 2026.50**.

## Con filtro 9m · meta $2M

| Qué hacer con los $60k | 3 años mediana | 3 años P10 | 5 años mediana | 5 años P10 | % gana a LS (5 años) |
|---|---|---|---|---|---|
| LS (todo de una) | $397,738 | $267,986 | $847,874 | $514,448 | — |
| DCA6 | $387,712 | $258,221 | $838,635 | $512,554 | 33.7% |
| DCA12 | $379,386 | $254,152 | $822,069 | $513,611 | 29.8% |
| QQQ-10 | $387,911 | $254,542 | $829,465 | $522,305 | 44.1% |
| QQQ-20 | $380,252 | $260,151 | $770,719 | $519,970 | 26.7% |
| QQQ-hold | $356,033 | $258,784 | $735,701 | $494,832 | 4.4% |

## Sin filtro · meta $2M (acá es donde el DCA protege)

| Qué hacer con los $60k | 1 año mediana | 1 año P10 | 1 año Peor | 3 años mediana | 3 años P10 | 3 años Peor |
|---|---|---|---|---|---|---|
| LS (todo de una) | $151,672 | $65,386 | $8,841 | $421,310 | $182,262 | $26,606 |
| DCA6 | $147,839 | $72,879 | $10,522 | $416,524 | $179,064 | $20,841 |
| DCA12 | $141,373 | $83,634 | $16,887 | $407,423 | $178,484 | $19,595 |
| QQQ-10 | $148,500 | $67,679 | $10,200 | $409,497 | $181,168 | $21,260 |
| QQQ-20 | $141,949 | $73,865 | $10,200 | $393,266 | $170,355 | $19,428 |
| QQQ-hold | $139,608 | $89,610 | $28,219 | $374,700 | $192,587 | $41,429 |

## Conclusiones

**1 · Lump sum vs DCA.** El lump sum gana la mayoría de las veces: el DCA6 solo le gana en el 33.7% de las ventanas a 5 años con filtro (35.2% a 1 año sin filtro). Esperar tiene precio mediano: **−$9,277 el DCA6 y −$19,484 el DCA12** a 5 años con filtro (−$7,764 y −$16,490 sin filtro). La plata fuera del mercado pierde más veces de las que se salva.

**2 · Lo que el DCA compra en la cola — y por cuánto tiempo.** Sin filtro, a 1 año el DCA sí amortigua el arranque malo: el P10 sube de $65,386 (LS) a $83,634 (DCA12) y el peor caso de $8,841 a $16,887. Pero esa protección se evapora a 3 años: el P10 queda igual ($182k vs $178k) y el peor caso del DCA12 termina PEOR que el del LS ($19,595 vs $26,606), porque las tandas tardías compraron caro antes de la misma caída. Con filtro, la protección ya viene incluida y es mejor que cualquier DCA sin filtro: el LS con filtro tiene P10 de $97,418 y peor caso de $70,376 a 1 año. La compuerta hace el trabajo que le pedirías al DCA.

**3 · Guardar los $60k en QQQ esperando la caída para pasarlos a TQQQ.** QQQ-10 es la única variante que compite: gana el 44.1% de las ventanas con una diferencia mediana de **$0** — una moneda al aire, sin ventaja real. La razón está en la velocidad de las caídas: una de −10% vs el máximo de 39 semanas llega en mediana en **16 semanas**, y el 26% de las ventanas YA arrancan en caída, así que el gatillo se dispara casi de inmediato y terminás hecho un LS con vuelto. Esperar la de −20% es otra historia: llega en mediana a las **187 semanas** (3.6 años, y solo el 13% arranca en caída) — te quedás años fuera y por eso QQQ-20 gana solo el 26.7% con mediana de −$33,407. Y hay una incoherencia de doctrina: a −18% el filtro 9m **vende todo**, así que una regla que compra TQQQ en plena caída rema exactamente en contra del sistema (por eso con filtro la diferencia mediana es $0: cuando la rotación por fin dispara, la señal ya te tiene en efectivo).

**4 · QQQ sin rotar nunca.** Es la forma cara de tener miedo: en mediana cuesta **−$45,066 a 3 años y −$80,595 a 5** (con filtro), y solo le gana al lump sum en el 4.4% de las ventanas a 5 años.

La conclusión no cambia con la meta: con $1M y $3M el DCA6 gana 33.3%/33.8%, QQQ-10 42.5%/44.5% y QQQ-hold 9.4%/4.4% de las ventanas a 5 años con filtro.

## Estado de la señal

Últimas 8 semanas del archivo (QQQ vs máximo de 39 semanas · señal 9m, 1 = adentro):

```
t=2026.367  -0.3%  señal=1
t=2026.386  +0.0%  señal=1
t=2026.405  +0.0%  señal=1
t=2026.424  -4.5%  señal=1
t=2026.444  -2.3%  señal=1
t=2026.463  +0.0%  señal=1
t=2026.482  -4.5%  señal=1
t=2026.501  -3.7%  señal=1
```

La última semana del archivo está **ADENTRO** (−3.7% del máximo, lejos del −18% de salida).

## Recomendación para el cliente de $60k + $5k/mes

La señal está adentro: los $60k entran **de una** según el glidepath, y los $5k mensuales siguen su camino normal. Si el día real de la entrada la señal estuviera afuera, la regla de la casa manda: se espera en efectivo hasta la reentrada — la compuerta es el filtro, no un DCA ni una espera en QQQ. Y para dimensionar la decisión: los $60k son apenas el 4.8–6.2% de todo lo que va a aportar en 15–25 años; la disciplina del aporte mensual pesa mucho más que el arranque.

Simulaciones sobre datos históricos; no garantizan resultados futuros.
