/* Motor de la regla: recalcula señal, posiciones, capital y caídas con cualquier parámetro.
   Misma especificación que /edge/data/especificacion.md. Sin dependencias. */
(function(root){
  function diasCal(a,b){ // a,b enteros yyyymmdd
    function u(x){ return Date.UTC(Math.floor(x/10000), Math.floor(x/100)%100-1, x%100); }
    return Math.max(1, Math.round((u(b)-u(a))/864e5));
  }
  function simular(D, A, P, L){
    var s=D[A], d=s.d, c=s.c, a=s.a, y=s.y, n=d.length, L_=L||1;
    var ini=0; while(ini<n && d[ini]<D.inicio[A]) ini++;           // desde dónde se miden los resultados (igual que /edge)
    var iniV=0; while(iniV<n && d[iniV]<(D.video&&D.video[A]||D.inicio[A])) iniV++; // desde dónde arranca el video
    if(iniV>ini) iniV=ini;
    var w=P.sem*5, b=P.banda/100, X=-P.x/100, Y=-P.y/100;
    var sma=new Float64Array(n), mx=new Float64Array(n), iS=new Uint8Array(n), iM=new Uint8Array(n), sig=new Uint8Array(n);
    var sum=0, dq=[], hd=0;
    var inS=1, inM=1;
    for(var i=0;i<n;i++){
      sum+=c[i]; if(i>=P.sma) sum-=c[i-P.sma];
      sma[i]= i>=P.sma-1 ? sum/P.sma : NaN;
      while(dq.length>hd && c[dq[dq.length-1]]<=c[i]) dq.pop();
      dq.push(i); while(dq[hd]<=i-w) hd++;
      mx[i]= i>=w-1 ? c[dq[hd]] : NaN;
      if(isFinite(sma[i])){ if(inS && c[i]<sma[i]*(1-b)) inS=0; else if(!inS && c[i]>sma[i]*(1+b)) inS=1; }
      if(isFinite(mx[i])){ var dist=c[i]/mx[i]-1; if(inM && dist<X) inM=0; else if(!inM && dist>=Y) inM=1; }
      iS[i]=inS; iM[i]=inM; sig[i]=(inS&&inM)?1:0;
    }
    var rEtf=new Float64Array(n), rTb=new Float64Array(n), rAct=new Float64Array(n), pos=new Float64Array(n), rR=new Float64Array(n);
    for(i=1;i<n;i++){
      rEtf[i]=a[i]/a[i-1]-1;
      rTb[i]=Math.pow(1/(1-y[i]/100*91/360), diasCal(d[i-1],d[i])/91)-1;
      rAct[i]= L_===1 ? rEtf[i] : L_*rEtf[i]-(L_-1)*rTb[i]-0.0095/252;
      pos[i]= i>=2 ? sig[i-2] : 1;
      rR[i]= pos[i]*rAct[i]+(1-pos[i])*rTb[i]-Math.abs(pos[i]-pos[i-1])*0.0005;
    }
    pos[0]=1;
    // capital y caídas desde iniV (ambos arrancan en 1); métricas desde ini
    var eqR=new Float64Array(n), eqB=new Float64Array(n), ddR=new Float64Array(n), ddB=new Float64Array(n), ddRmin=new Float64Array(n), ddBmin=new Float64Array(n);
    var mR=1, mB=1, cR=1, cB=1, minR=0, minB=0, sumEx=0, nEx=0, sumEx2=0, cambios=0, exp=0, capR=1, capB=1;
    for(i=iniV;i<n;i++){
      if(i>iniV){ cR*=1+rR[i]; cB*=1+rAct[i]; }
      if(i>ini){ capR*=1+rR[i]; capB*=1+rAct[i]; var ex=rR[i]-rTb[i]; sumEx+=ex; sumEx2+=ex*ex; nEx++; if(pos[i]!==pos[i-1]) cambios++; exp+=pos[i]; }
      eqR[i]=cR; eqB[i]=cB; if(cR>mR) mR=cR; if(cB>mB) mB=cB;
      ddR[i]=cR/mR-1; ddB[i]=cB/mB-1;
      if(i>=ini){ if(ddR[i]<minR) minR=ddR[i]; if(ddB[i]<minB) minB=ddB[i]; }
      ddRmin[i]=minR; ddBmin[i]=minB;
    }
    var dias=n-1-ini, anios=dias/252, mean=sumEx/nEx, sd=Math.sqrt((sumEx2-nEx*mean*mean)/(nEx-1));
    // la caída máxima de las métricas se mide con el capital reiniciado en ini
    minR=0; minB=0; var pR=1,pB=1,xR=1,xB=1;
    for(i=ini+1;i<n;i++){ xR*=1+rR[i]; xB*=1+rAct[i]; if(xR>pR) pR=xR; if(xB>pB) pB=xB; var dR=xR/pR-1, dB=xB/pB-1; if(dR<minR) minR=dR; if(dB<minB) minB=dB; }
    // sharpe de comprar y mantener
    var sB=0,sB2=0; for(i=ini+1;i<n;i++){ var e2=rAct[i]-rTb[i]; sB+=e2; sB2+=e2*e2; }
    var mB2=sB/nEx, sdB=Math.sqrt((sB2-nEx*mB2*mB2)/(nEx-1));
    var met={
      cagr:Math.pow(capR,252/dias)-1, sharpe:mean/sd*Math.sqrt(252), dd:minR, cambiosAnio:cambios/anios, exposicion:exp/nEx,
      bh:{cagr:Math.pow(capB,252/dias)-1, sharpe:mB2/sdB*Math.sqrt(252), dd:minB}
    };
    // eventos: cambios de señal (día en que se calcula) con el indicador que disparó
    var ev=[];
    for(i=Math.max(1,iniV);i<n;i++){
      if(sig[i]===sig[i-1]) continue;
      var fS=iS[i]!==iS[i-1], fM=iM[i]!==iM[i-1];
      ev.push({i:i, tipo:sig[i]===1?'entrada':'salida', causa:(fS&&fM)?'ambos':(fS?'promedio':'maximo')});
    }
    return {ini:ini, iniV:iniV, rR:rR, rAct:rAct, rTb:rTb, n:n, d:d, c:c, sma:sma, mx:mx, iS:iS, iM:iM, sig:sig, pos:pos, eqR:eqR, eqB:eqB, ddR:ddR, ddB:ddB, ddRmin:ddRmin, ddBmin:ddBmin, ev:ev, met:met, P:P, L:L_, A:A};
  }
  /* Base por activo y apalancamiento: retornos diarios del activo y del efectivo (se calcula una vez). */
  function base(D, A, L){
    var s=D[A], d=s.d, a=s.a, y=s.y, n=d.length, L_=L||1;
    var ini=0; while(ini<n && d[ini]<D.inicio[A]) ini++;
    var rAct=new Float64Array(n), rTb=new Float64Array(n);
    for(var i=1;i<n;i++){
      var rEtf=a[i]/a[i-1]-1;
      rTb[i]=Math.pow(1/(1-y[i]/100*91/360), diasCal(d[i-1],d[i])/91)-1;
      rAct[i]= L_===1 ? rEtf : L_*rEtf-(L_-1)*rTb[i]-0.0095/252;
    }
    return {ini:ini, n:n, rAct:rAct, rTb:rTb, c:s.c, d:d};
  }
  /* Trayecto del capital con una versión de la regla, muestreado cada `paso` días desde ini (arranca en 1).
     Sin regla: P=null. Devuelve Float32Array de puntos y el índice de cada punto. */
  function trayecto(B, P, paso){
    var n=B.n, ini=B.ini, c=B.c, rAct=B.rAct, rTb=B.rTb, out=[], idx=[];
    var cap=1, i;
    if(!P){
      for(i=ini;i<n;i++){ if(i>ini) cap*=1+rAct[i]; if((i-ini)%paso===0||i===n-1){ out.push(cap); idx.push(i); } }
      return {v:Float32Array.from(out), i:idx};
    }
    var w=P.sem*5, b=P.banda/100, X=-P.x/100, Y=-P.y/100, m=P.sma;
    var sum=0, dq=new Int32Array(n), hd=0, tl=0, inS=1, inM=1, sig2=1, sig1=1, pos=1, posPrev=1, sma, mx;
    for(i=0;i<n;i++){
      sum+=c[i]; if(i>=m) sum-=c[i-m];
      sma= i>=m-1 ? sum/m : NaN;
      while(tl>hd && c[dq[tl-1]]<=c[i]) tl--;
      dq[tl++]=i; while(dq[hd]<=i-w) hd++;
      mx= i>=w-1 ? c[dq[hd]] : NaN;
      if(sma===sma){ if(inS && c[i]<sma*(1-b)) inS=0; else if(!inS && c[i]>sma*(1+b)) inS=1; }
      if(mx===mx){ var dist=c[i]/mx-1; if(inM && dist<X) inM=0; else if(!inM && dist>=Y) inM=1; }
      var sig=(inS&&inM)?1:0;
      posPrev=pos; pos= i>=2 ? sig2 : 1; sig2=sig1; sig1=sig;
      if(i>ini){ cap*=1+(pos*rAct[i]+(1-pos)*rTb[i]-Math.abs(pos-posPrev)*0.0005); }
      if(i>=ini && ((i-ini)%paso===0||i===n-1)){ out.push(cap); idx.push(i); }
    }
    return {v:Float32Array.from(out), i:idx};
  }
  root.MOTOR={simular:simular, base:base, trayecto:trayecto};
})(typeof window!=='undefined'?window:module.exports);
