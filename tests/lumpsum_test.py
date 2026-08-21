"""
Cómo correrlo (desde la raíz de landing-calculadora):
  python tests/lumpsum_test.py                 # meta $2M por defecto
  python tests/lumpsum_test.py 3000000         # otra meta
  PXDATA=/otra/ruta/pxdata.js python tests/lumpsum_test.py
Requiere numpy. Tarda ~1 min.
Imprime, con y sin filtro 9m, para horizontes de 1/3/5/10 años: mediana, P10, P90,
peor ventana, % de ventanas en que cada variante le gana al lump sum y la diferencia mediana.

Lump-sum deployment test on Jose's own FPF engine data (admin/pxdata.js).
Replicates simHistFW() rules: weekly bars, monthly wires, SWIFT $65, setup $2,000,
1%/yr mgmt on the market sleeve, glidepath 70/100/70 on phiPeak (ratchet), SJC floor,
optional 9m filter (PX.sig.QQQ, decided at close i, applied to week i+1 return).

Client: $60,000 today + $5,000/month. Meta (freedom point) parametrized.

Strategies for the $60k (monthly $5k always follows the normal plan):
  LS       : wire all $60k at t=0 into the plan sleeve (what the engine does today)
  DCA6     : $10k extra per month for 6 months (rest in cash @2%)
  DCA12    : $5k extra per month for 12 months (rest in cash @2%)
  QQQ-10   : $60k in QQQ; move to plan sleeve (≈TQQQ) when QQQ closes ≥10% below 39w high
  QQQ-15   : same, 15%
  QQQ-20   : same, 20%
  QQQ-hold : $60k in QQQ, never rotates (reference)
  CASH-hold: $60k never deployed (reference, 2%)
"""
import json, numpy as np, sys

import os
PXPATH = os.environ.get('PXDATA', os.path.join(os.getcwd(), 'admin', 'pxdata.js'))
s = open(PXPATH).read()
s = s[s.index('{'):].rstrip().rstrip(';')
PX = json.loads(s)
t = np.array(PX['t']); n = len(t)
P = {k: np.array(PX[k], dtype=float) for k in ['SPY','QQQ','QLD','TQQQ']}
SIG = np.array(PX['sig']['QQQ'], dtype=int)   # 9m filter: 1 = in

SWIFT, SETUP, MGMT = 65.0, 2000.0, 0.01
cashW = 1.02**(1/52) - 1
sjcW = 1.08**(1/52) - 1
mgmtW = MGMT/52

def month_of(x):
    y = np.floor(x); return (np.floor((x - y)*12 + 1e-6)).astype(int)
mo = month_of(t)
newmonth = np.zeros(n, dtype=bool); newmonth[1:] = mo[1:] != mo[:-1]

# 39-week high of QQQ closes (inclusive of current week), as the page's filter does
hi39 = np.array([P['QQQ'][max(0,i-38):i+1].max() for i in range(n)])
ddQQQ = P['QQQ']/hi39 - 1.0

# weekly returns (from i-1 to i)
R = {k: np.concatenate([[0.0], P[k][1:]/P[k][:-1] - 1]) for k in P}

def fwW(phi, p1=0.70, p2=1.00, Ff=0.70):
    """vectorized glidepath weights [wL, wE, wF]"""
    wL = np.where(phi<=p1, 1-phi/p1, 0.0)
    wE = np.where(phi<=p1, phi/p1, np.where(phi<=p2, 1-Ff*(phi-p1)/(p2-p1), 1-Ff))
    wF = np.where(phi<=p1, 0.0, np.where(phi<=p2, Ff*(phi-p1)/(p2-p1), Ff))
    return wL, wE, wF

def simulate(strategy, H, meta, lump=60000.0, ap=5000.0, timing=False,
             f1='TQQQ', f2='SPY', costs=True, seeds=None):
    """Vectorized over all start weeks s in [0, n-H). Returns final balance per start."""
    starts = np.arange(0, n-H) if seeds is None else seeds
    S = len(starts)
    eq = np.zeros(S); sjc = np.zeros(S); L = np.zeros(S); cash = np.zeros(S)
    setupL = np.full(S, SETUP if costs else 0.0)
    feeS = SWIFT if costs else 0.0
    phiPeak = np.zeros(S); pocket = np.zeros(S)
    months_since = np.zeros(S, dtype=int)
    rotated = np.zeros(S, dtype=bool)
    peak = np.zeros(S); maxdd = np.zeros(S)

    def wire(amount, mask=None):
        nonlocal eq, setupL, pocket
        a = np.where(mask, amount, 0.0) if mask is not None else np.full(S, amount)
        a = np.where(a>0, a, 0.0)
        net = np.where(a>0, a - feeS, 0.0)
        pay = np.minimum(setupL, np.maximum(net,0)); net = net - pay; setupL = setupL - pay
        eq = eq + np.maximum(net, 0.0)
        pocket = pocket + a

    # ---- t=0 deployment of the lump
    if strategy == 'LS':
        wire(lump)
    elif strategy.startswith('DCA'):
        k = int(strategy[3:]); cash[:] = lump; tranche = lump/k
    elif strategy.startswith('QQQ'):
        # lump goes to QQQ sleeve L (pays SWIFT+setup like any wire)
        a = lump; net = a - feeS; pay = np.minimum(setupL, net); net = net - pay; setupL = setupL - pay
        L[:] = net; pocket += a
        thr = None if strategy=='QQQ-hold' else -int(strategy.split('-')[1])/100
    elif strategy == 'CASH-hold':
        cash[:] = lump; pocket += lump

    idx0 = starts
    for j in range(1, H+1):
        i = idx0 + j                       # global week index per start
        tot = eq + sjc + L + cash
        phi = tot/meta; phiPeak = np.maximum(phiPeak, phi)
        wL, wE, wF = fwW(phiPeak)
        eqW = wL + wE                      # f3 = SJC -> not in market sleeve
        inv = np.ones(S, dtype=bool) if not timing else (SIG[i-1]==1)
        r1 = np.where(inv, R[f1][i], cashW); r2 = np.where(inv, R[f2][i], cashW)
        eqRet = np.where(eqW>1e-9, (wL*r1 + wE*r2)/np.maximum(eqW,1e-9), 0.0)
        rQ = np.where(inv, R['QQQ'][i], cashW)
        eq = eq*(1+eqRet); L = L*(1+rQ); sjc = sjc*(1+sjcW); cash = cash*(1+cashW)
        if costs: eq = eq*(1-mgmtW); L = L*(1-mgmtW)
        # monthly wire of the regular contribution (+ DCA tranche)
        nm = newmonth[i]
        if nm.any():
            months_since = months_since + nm
            extra = np.zeros(S)
            if strategy.startswith('DCA'):
                due = nm & (months_since <= k)
                extra = np.where(due, np.minimum(tranche, cash), 0.0)
                cash = cash - extra
                # DCA tranches were already counted in pocket at t=0? no: count here
                wire(ap + extra, nm)
                pocket = pocket - np.where(nm, extra, 0.0)  # avoid double count (lump counted below)
            else:
                wire(ap, nm)
        # rotation rule for the QQQ sleeve: decided at close i, executed next week
        # (merge now, earns plan return from i+1)
        if strategy.startswith('QQQ') and thr is not None:
            trig = (~rotated) & (ddQQQ[i] <= thr)
            eq = eq + np.where(trig, L, 0.0); L = np.where(trig, 0.0, L); rotated |= trig
        # ratchet into SJC floor
        tSJC = wF
        invested = eq + sjc
        want = tSJC*invested
        mv = np.clip(want - sjc, 0, None); mv = np.minimum(mv, eq)
        sjc = sjc + mv; eq = eq - mv
        b = eq + sjc + L + cash
        peak = np.maximum(peak, b)
        dd = np.where(peak>0, b/peak - 1, 0.0); maxdd = np.minimum(maxdd, dd)
    if strategy.startswith('DCA') or strategy=='CASH-hold':
        pocket = pocket + lump
    return eq + sjc + L + cash, maxdd, starts

def pct(a, p): return float(np.percentile(a, p))

def extras():
    """Datos de apoyo que la respuesta necesita: velocidad de las caídas, estado de la señal, peso de los $60k."""
    print("\n" + "="*100); print("DATOS DE APOYO"); print("="*100)
    print(f"pxdata.js: {n} semanas, de {t[0]:.2f} a {t[-1]:.2f}")
    for X in (10, 15, 20):
        thr = -X/100; waits = []
        for s0 in range(0, n-520):
            hit = np.where(ddQQQ[s0+1:s0+521] <= thr)[0]
            waits.append(hit[0]+1 if len(hit) else 999)
        w = np.array(waits); ok = w[w<999]
        print(f"Caída de -{X}% vs máx 39s: espera mediana {np.median(ok):.0f} sem · P75 {np.percentile(ok,75):.0f} · P90 {np.percentile(ok,90):.0f} · ya en caída al arrancar: {100*np.mean(w==1):.0f}% de las ventanas")
    print("\nÚltimas 8 semanas del archivo (QQQ vs máximo de 39 semanas · señal 9m, 1=adentro):")
    for i in range(n-8, n):
        print(f"  t={t[i]:.3f}  {100*ddQQQ[i]:+.1f}%  señal={SIG[i]}")
    for yrs in (15, 20, 25):
        tot = 5000*12*yrs
        print(f"$5k/mes x {yrs} años = ${tot:,.0f} aportados -> los $60k son {100*60000/(tot+60000):.1f}% de todo lo que va a poner")

if __name__ == '__main__':
    meta = float(sys.argv[1]) if len(sys.argv)>1 else 2_000_000.0
    strategies = ['LS','DCA6','DCA12','QQQ-10','QQQ-15','QQQ-20','QQQ-hold','CASH-hold']
    for timing in (False, True):
        print("\n" + "="*100)
        print(f"FILTRO 9m: {'SÍ' if timing else 'NO'} · meta ${meta:,.0f} · $60k hoy + $5k/mes · glide 70/100/70 TQQQ→SPY→SJC · costos incluidos")
        print("="*100)
        for years in (1, 3, 5, 10):
            H = years*52
            res = {}
            for st in strategies:
                fin, mdd, starts = simulate(st, H, meta, timing=timing)
                res[st] = (fin, mdd)
            base = res['LS'][0]
            print(f"\n--- Horizonte {years} años · {len(base)} ventanas semanales de arranque ({t[0]:.0f}–{t[starts[-1]]:.0f}) ---")
            print(f"{'Estrategia':10s} {'Mediana':>12s} {'P10':>12s} {'P90':>12s} {'Peor':>12s} {'% gana a LS':>12s} {'Med dif vs LS':>14s} {'MaxDD med':>10s}")
            for st in strategies:
                fin, mdd = res[st]
                win = 100*np.mean(fin > base) if st!='LS' else float('nan')
                dif = np.median(fin - base) if st!='LS' else 0.0
                print(f"{st:10s} {np.median(fin):>12,.0f} {pct(fin,10):>12,.0f} {pct(fin,90):>12,.0f} {fin.min():>12,.0f} {win:>11.1f}% {dif:>14,.0f} {100*np.median(mdd):>9.1f}%")
    extras()
